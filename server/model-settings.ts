import { closeSync, openSync, readFileSync, readSync } from "node:fs";
import { join } from "node:path";
import type { ModelChoice, ModelSettingsChange, PaneModelSettings } from "../shared/protocol.ts";
import { codexOpenRollout, codexTranscriptPath, paneCodexHome } from "./codex.ts";
import { sessionSnapshot } from "./herdr/client.ts";

type Binding = { thread: string; terminal: string; home: string };
type NativeThread = { id: string; model?: string | null; reasoningEffort?: string | null; status?: { type: string } };
type NativeRpc = <T>(method: string, params: Record<string, unknown>) => Promise<T>;
export class ModelSettingsError extends Error {
  constructor(readonly code: string, message: string, readonly status = 409) { super(message); }
}
const unsupported = (reason: string): PaneModelSettings => ({ supported: false, reason, thread_id: null, model: null, effort: null, models: [] });

/** Local native catalog only: opening the picker never asks a provider or refreshes credentials. */
export function readModelCatalog(home: string): ModelChoice[] {
  try {
    const data = JSON.parse(readFileSync(join(home, "models_cache.json"), "utf8"));
    if (!Array.isArray(data.models)) return [];
    return data.models.filter((m: Record<string, unknown>) => typeof m.slug === "string" && m.visibility !== "hide" && m.supported_in_api !== false)
      .map((m: Record<string, unknown>) => ({ id: String(m.slug), label: typeof m.display_name === "string" ? m.display_name : String(m.slug),
        efforts: (Array.isArray(m.supported_reasoning_levels) ? m.supported_reasoning_levels : []).filter((e: Record<string, unknown>) => typeof e.effort === "string").map((e: Record<string, unknown>) => ({ id: String(e.effort), description: typeof e.description === "string" ? e.description : String(e.effort) })) }));
  } catch { return []; }
}

/** Only session metadata is read. Large native instruction headers must not truncate into a 500;
 * an incomplete, oversized or unreadable header leaves the control explicitly unsupported. */
export function readNativeThreadId(path: string): string | null {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const bytes = Buffer.alloc(256 * 1024); const length = readSync(fd, bytes, 0, bytes.length, 0);
    const newline = bytes.subarray(0, length).indexOf(10);
    if (newline < 0 && length === bytes.length) return null;
    const first = JSON.parse(bytes.subarray(0, newline < 0 ? length : newline).toString("utf8"));
    const id = first?.type === "session_meta" ? first.payload?.id : null;
    return typeof id === "string" && /^[a-zA-Z0-9-]{8,100}$/.test(id) ? id : null;
  } catch { return null; }
  finally { if (fd !== undefined) closeSync(fd); }
}

async function resolveBinding(paneId: string, configured?: string): Promise<Binding | null> {
  const home = await paneCodexHome(paneId, configured);
  const snapshot = await sessionSnapshot();
  const pane = snapshot.panes.find(p => p.pane_id === paneId);
  if (!pane || (pane.agent ?? pane.agent_session?.agent) !== "codex" || !pane.terminal_id) return null;
  const cwd = pane.foreground_cwd ?? pane.cwd;
  if (!cwd) return null;
  // Use the existing process/screen binding; herdr's reported Codex session alone is not proof.
  let path = await codexOpenRollout(paneId, cwd, home);
  if (!path) {
    // Discovery can return a mere reported-session hint. Accept only the process/screen
    // binding it established, re-read through the stricter bound-rollout helper.
    await codexTranscriptPath(paneId, cwd, home, snapshot.panes);
    path = await codexOpenRollout(paneId, cwd, home);
  }
  if (!path) return null;
  const thread = readNativeThreadId(path);
  return thread ? { thread, terminal: pane.terminal_id, home } : null;
}

/** One bounded connection per operation. It reads settings or updates settings, never resumes a
 * thread, subscribes to status, creates a session, writes config, or starts/sends/steers a turn. */
export async function withNativeSettings<T>(home: string, run: (rpc: NativeRpc) => Promise<T>): Promise<T> {
  const path = join(home, "app-server-control", "app-server-control.sock");
  const failure = () => new ModelSettingsError("native_unavailable", "The running Codex settings service is unavailable. Open its native settings and retry.", 503);
  let socket: WebSocket;
  try { socket = new WebSocket(`ws+unix://${path}:/`); } catch { throw failure(); }
  let sequence = 0;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  let expired = false;
  let rejectOpen: (error: Error) => void = () => {};
  const opened = new Promise<void>((resolve, reject) => { rejectOpen = reject; socket.onopen = () => resolve(); });
  const timer = setTimeout(() => { expired = true; rejectOpen(failure()); for (const p of pending.values()) p.reject(failure()); socket.close(); }, 8000);
  socket.onerror = socket.onclose = () => { rejectOpen(failure()); for (const p of pending.values()) p.reject(failure()); pending.clear(); };
  socket.onmessage = event => {
    try {
      const message = JSON.parse(String(event.data));
      if (message.method || typeof message.id !== "number") return;
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new ModelSettingsError("native_refused", "Codex refused this settings change. Refresh settings and choose a supported value."));
      else request.resolve(message.result);
    } catch { /* Unrelated or malformed native notification is not a result. */ }
  };
  const rpc: NativeRpc = <R>(method: string, params: Record<string, unknown>) => new Promise<R>((resolve, reject) => {
    if (!["initialize", "thread/read", "thread/settings/update"].includes(method)) { reject(new ModelSettingsError("unsupported_operation", "Only native settings operations are supported.", 400)); return; }
    if (expired || socket.readyState !== WebSocket.OPEN) { reject(failure()); return; }
    const id = ++sequence; pending.set(id, { resolve: value => resolve(value as R), reject }); socket.send(JSON.stringify({ id, method, params }));
  });
  try {
    await opened;
    await rpc("initialize", { clientInfo: { name: "herdr_model_settings", title: "Herdr model settings", version: "1" }, capabilities: { experimentalApi: true } });
    socket.send(JSON.stringify({ method: "initialized", params: {} }));
    return await run(rpc);
  } finally { clearTimeout(timer); socket.close(); }
}

export class ModelSettingsService {
  private busy = new Set<string>();
  constructor(private readonly home?: string, private readonly deps: {
    resolve?: (pane: string, home?: string) => Promise<Binding | null>;
    connect?: typeof withNativeSettings;
    catalog?: typeof readModelCatalog;
  } = {}) {}
  private resolve(pane: string) { return (this.deps.resolve ?? resolveBinding)(pane, this.home); }
  private connect<T>(binding: Binding, run: (rpc: NativeRpc) => Promise<T>) { return (this.deps.connect ?? withNativeSettings)(binding.home, run); }
  private async read(rpc: NativeRpc, binding: Binding): Promise<PaneModelSettings> {
    const { thread } = await rpc<{ thread: NativeThread }>("thread/read", { threadId: binding.thread, includeTurns: false });
    if (thread.id !== binding.thread || (!thread.status || thread.status.type === "notLoaded") || !thread.model) return unsupported("The native session is not loaded or does not report its current settings. Open it in Codex first.");
    const models = (this.deps.catalog ?? readModelCatalog)(binding.home);
    if (!models.length) return unsupported("No local native model catalog is available. Open Codex’s model picker first, then refresh here.");
    return { supported: true, reason: null, thread_id: binding.thread, model: thread.model, effort: thread.reasoningEffort ?? null, models };
  }
  async get(pane: string): Promise<PaneModelSettings> {
    const binding = await this.resolve(pane);
    if (!binding) return unsupported("Quick model and effort controls require a verified running local Codex session. Other agents use their own native settings.");
    return this.connect(binding, rpc => this.read(rpc, binding));
  }
  async change(request: ModelSettingsChange): Promise<PaneModelSettings> {
    if (this.busy.has(request.pane_id)) throw new ModelSettingsError("settings_busy", "A settings change is still finishing. Refresh before trying again.");
    this.busy.add(request.pane_id);
    try {
      const binding = await this.resolve(request.pane_id);
      if (!binding || binding.thread !== request.expected.thread_id) throw new ModelSettingsError("session_changed", "The native session changed. Refresh settings before applying.");
      return await this.connect(binding, async rpc => {
        const before = await this.read(rpc, binding);
        if (!before.supported || before.model !== request.expected.model || before.effort !== request.expected.effort) throw new ModelSettingsError("settings_changed", "Native settings changed. Refresh before applying.");
        if (request.model !== undefined && before.effort === null) throw new ModelSettingsError("effort_unknown", "Set a reported reasoning effort before changing the model.", 400);
        const nextModel = request.model ?? before.model;
        const nextEffort = request.effort ?? before.effort;
        const model = before.models.find(m => m.id === nextModel);
        if (!model || (nextEffort !== null && !model.efforts.some(e => e.id === nextEffort))) throw new ModelSettingsError("unsupported_setting", "That model does not support this reasoning effort. Choose a compatible setting.", 400);
        const still = await this.resolve(request.pane_id);
        if (!still || still.thread !== binding.thread || still.terminal !== binding.terminal || still.home !== binding.home) throw new ModelSettingsError("session_changed", "The native session changed. Refresh settings before applying.");
        // Send only the requested field. All other native session settings remain native-owned.
        await rpc("thread/settings/update", { threadId: binding.thread, ...(request.model !== undefined ? { model: request.model } : { effort: request.effort }) });
        const actual = await this.read(rpc, binding);
        if (!actual.supported || actual.model !== nextModel || actual.effort !== nextEffort) throw new ModelSettingsError("change_unconfirmed", "The native change could not be confirmed. Refresh settings before retrying.");
        const confirmed = await this.resolve(request.pane_id);
        if (!confirmed || confirmed.thread !== binding.thread || confirmed.terminal !== binding.terminal || confirmed.home !== binding.home) throw new ModelSettingsError("session_changed", "The native session changed. Refresh settings before applying.");
        return actual;
      });
    } finally { this.busy.delete(request.pane_id); }
  }
}
