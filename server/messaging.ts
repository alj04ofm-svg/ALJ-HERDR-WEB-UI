import { mkdir, readFile, rename, writeFile, chmod, rm } from "node:fs/promises";
import { join } from "node:path";
import type { BusinessChat, LinkChallengeKind, MessagingAccount, MessagingAdapter, MessagingOverview, MessagingProvider, TelegramLinkRequest } from "../shared/messaging.ts";
import { badRequest, conflictResponse, jsonResponse } from "./http.ts";
interface SavedAccount { id: string; provider: MessagingProvider; label: string; scope: "business" | "personal"; revision: string; selected_chat_ids: string[]; chat_categories: Record<string, "business" | "personal"> }
interface Live { saved: SavedAccount; adapter: MessagingAdapter | null; state: MessagingAccount["state"]; challenge: MessagingAccount["challenge"]; answer?: (value: string) => void; reject?: (error: Error) => void; controller: AbortController; chats: Map<string, BusinessChat>; busy: boolean }
const noStore = (response: Response) => { response.headers.set("cache-control", "no-store"); return response; };
export class MessagingService {
  private accounts = new Map<string, Live>();
  private ready: Promise<void>;
  private corrupt = false;
  private storedBytes: string | null = null;
  private mutating = false;
  private writing: Promise<void> = Promise.resolve();
  constructor(private directory: string, private factories: Partial<Record<MessagingProvider, (id: string) => MessagingAdapter>> = {}) { this.ready = this.load(); }
  private async load() {
    try {
      const bytes = await readFile(join(this.directory, "accounts.json"), "utf8");
      const data: unknown = JSON.parse(bytes);
      if (!Array.isArray(data) || data.length > 8) throw Error("Invalid account store");
      for (const a of data) {
        if (!a || typeof a.id !== "string" || !/^[a-f0-9-]{36}$/.test(a.id) || this.accounts.has(a.id) || !["telegram", "whatsapp"].includes(a.provider) || typeof a.label !== "string" || a.label.length > 80 || !["business", "personal"].includes(a.scope) || typeof a.revision !== "string" || !Array.isArray(a.selected_chat_ids) || a.selected_chat_ids.length > 100 || !a.selected_chat_ids.every((id: unknown) => typeof id === "string" && id.length > 0 && id.length <= 180) || new Set(a.selected_chat_ids).size !== a.selected_chat_ids.length) throw Error("Invalid account store");
        const categories: unknown = a.chat_categories ?? {};
        if (!categories || typeof categories !== "object" || Array.isArray(categories) || Object.keys(categories).length > 100 || Object.entries(categories).some(([id, value]) => !id || id.length > 180 || !["business", "personal"].includes(String(value)))) throw Error("Invalid conversation categories");
        this.accounts.set(a.id, { saved: { id: a.id, provider: a.provider, label: a.label, scope: a.scope, revision: a.revision, selected_chat_ids: [...a.selected_chat_ids], chat_categories: { ...categories } as SavedAccount["chat_categories"] }, adapter: null, state: "disconnected", challenge: null, controller: new AbortController(), chats: new Map(), busy: false });
      }
      this.storedBytes = bytes;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") { this.accounts.clear(); this.corrupt = true; } }
  }
  private persist() {
    const snapshot = JSON.stringify([...this.accounts.values()].map(a => a.saved));
    const task = this.writing.then(async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 }); await chmod(this.directory, 0o700);
      const temp = join(this.directory, `.accounts-${crypto.randomUUID()}.tmp`);
      const lock = join(this.directory, ".accounts-write-lock");
      // A crashed writer leaves a fail-closed lock for explicit recovery; never steal it.
      await mkdir(lock, { mode: 0o700 });
      try {
        let current: string | null = null;
        try { current = await readFile(join(this.directory, "accounts.json"), "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        if (current !== this.storedBytes) throw Error("Account store changed in another process");
        await writeFile(temp, snapshot, { mode: 0o600, flag: "wx" });
        await rename(temp, join(this.directory, "accounts.json")); this.storedBytes = snapshot;
      } finally { await rm(temp, { force: true }).catch(() => {}); await rm(lock, { recursive: true, force: true }); }
    });
    this.writing = task.catch(() => {}); return task;
  }
  private view(a: Live): MessagingAccount { return { ...a.saved, selected_chat_ids: [...a.saved.selected_chat_ids], chat_categories: { ...a.saved.chat_categories }, state: a.state, sync_state: a.adapter?.status?.() ?? "offline", challenge: a.challenge }; }
  private cancel(a: Live) { a.controller.abort(); a.reject?.(Error("Link cancelled")); a.answer = undefined; a.reject = undefined; a.challenge = null; a.state = "disconnected"; const old = a.adapter; a.adapter = null; a.chats.clear(); if (old) void old.close().catch(() => {}); }
  private async read<T>(a: Live, work: () => Promise<T>): Promise<T> {
    const signal = a.controller.signal; signal.throwIfAborted();
    let rejectRead: (error: Error) => void = () => {};
    const cancelled = new Promise<never>((_, reject) => { rejectRead = reject; });
    const abort = () => rejectRead(Error("Connection changed")); signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => { this.cancel(a); rejectRead(Error("Messaging request timed out")); }, 12_000); timer.unref?.();
    try { return await Promise.race([work(), cancelled]); } finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
  }
  async stop() { await this.ready; for (const a of this.accounts.values()) this.cancel(a); await this.writing; }
  async handle(request: Request): Promise<Response> {
    await this.ready;
    if (this.corrupt) return noStore(jsonResponse({ error: { code: "messaging_recovery", message: "Messaging settings need recovery. The original file was preserved." } }, 503));
    const mutating = !["GET", "HEAD"].includes(request.method);
    if (mutating && this.mutating) return noStore(conflictResponse("messaging_busy", "Wait for the current messaging change to finish"));
    if (mutating) this.mutating = true;
    try { return noStore(await this.route(request)); }
    catch { return noStore(jsonResponse({ error: { code: "messaging_failed", message: "Messaging operation failed. No message was sent. Check the connection before trying again." } }, 502)); }
    finally { if (mutating) this.mutating = false; }
  }
  private async route(request: Request): Promise<Response> {
    const url = new URL(request.url), path = url.pathname.slice("/api/messaging".length), method = request.method;
    if (path === "" && method === "GET") return jsonResponse({ providers: (["telegram", "whatsapp"] as const).map(id => ({ id, available: Boolean(this.factories[id]) })), accounts: [...this.accounts.values()].map(a => this.view(a)) } satisfies MessagingOverview);
    let body: Record<string, unknown> = {};
    if (!["GET", "HEAD"].includes(method)) {
      if (request.headers.get("x-herdr-messaging") !== "1") return badRequest("messaging_control", "Use messaging controls from this app");
      if (!request.headers.get("content-type")?.startsWith("application/json")) return badRequest("invalid_json", "Expected JSON");
      // Stream cap applies even when Content-Length is absent or dishonest.
      const reader = request.body?.getReader(); let size = 0; const chunks: Uint8Array[] = [];
      if (reader) { try { while (true) { const item = await reader.read(); if (item.done) break; size += item.value.length; if (size > 16_384) { await reader.cancel(); return jsonResponse({ error: { code: "too_large", message: "Messaging request is too large" } }, 413); } chunks.push(item.value); } } finally { reader.releaseLock(); } }
      try { const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } const value: unknown = JSON.parse(new TextDecoder().decode(bytes)); if (!value || typeof value !== "object" || Array.isArray(value)) throw Error(); body = value as Record<string, unknown>; } catch { return badRequest("invalid_json", "Expected a JSON object"); }
    }
    if (["/telegram/link", "/whatsapp/link"].includes(path) && method === "POST") {
      const provider = path.startsWith("/whatsapp/") ? "whatsapp" : "telegram";
      const factory = this.factories[provider];
      if (!factory) return jsonResponse({ error: { code: "adapter_unavailable", message: `${provider} connection adapter is not enabled on this server` } }, 503);
      if (this.accounts.size >= 8 || [...this.accounts.values()].some(a => a.state === "connecting" || a.state === "challenge")) return conflictResponse("link_busy", "Finish or cancel the current connection first");
      if ((provider === "telegram" && (!Number.isSafeInteger(body.api_id) || (body.api_id as number) <= 0 || typeof body.api_hash !== "string" || !/^[a-f0-9]{32}$/i.test(body.api_hash) || typeof body.phone !== "string" || !/^\+[0-9]{7,15}$/.test(body.phone))) || typeof body.label !== "string" || !body.label.trim() || body.label.length > 80 || !["business", "personal"].includes(String(body.scope))) return badRequest("invalid_link", "Check the application ID, hash, international phone number and account label");
      if (provider === "whatsapp" && body.phone !== undefined && (typeof body.phone !== "string" || !/^\+[0-9]{7,15}$/.test(body.phone))) return badRequest("invalid_phone", "Use an international phone number or choose QR linking");
      const id = crypto.randomUUID(), controller = new AbortController();
      const live: Live = { saved: { id, provider, label: body.label.trim(), scope: body.scope as "business" | "personal", revision: crypto.randomUUID(), selected_chat_ids: [], chat_categories: {} }, adapter: factory(id), controller, state: "connecting", challenge: null, chats: new Map(), busy: false };
      this.accounts.set(id, live);
      try { await this.persist(); } catch { this.accounts.delete(id); this.cancel(live); throw Error("Cannot save account"); }
      const timer = setTimeout(() => this.cancel(live), 180_000); timer.unref?.();
      const ask = (kind: LinkChallengeKind, display?: string) => new Promise<string>((resolve, reject) => {
        if (controller.signal.aborted) { reject(Error("Cancelled")); return; }
        live.reject?.(Error("Sign-in step changed"));
        live.challenge = { id: crypto.randomUUID(), kind, ...(display ? { display } : {}) }; live.state = "challenge";
        live.answer = value => { live.answer = undefined; live.reject = undefined; live.challenge = null; live.state = "connecting"; resolve(value); }; live.reject = reject;
      });
      void live.adapter!.link(body as unknown as TelegramLinkRequest, ask, controller.signal).then(() => { if (!controller.signal.aborted) { live.state = "connected"; live.reject?.(Error("Sign-in complete")); live.reject = undefined; live.answer = undefined; live.challenge = null; } }).catch(() => { if (!controller.signal.aborted) { live.state = "failed"; live.challenge = null; live.answer = undefined; live.reject = undefined; const adapter = live.adapter; live.adapter = null; void adapter?.close().catch(() => {}); } }).finally(() => clearTimeout(timer));
      return jsonResponse(this.view(live), 202);
    }
    const match = /^\/accounts\/([a-f0-9-]{36})(?:\/(link|answer|cancel|resume|chats|selection|messages))?$/.exec(path);
    if (!match) return jsonResponse({ error: { code: "not_found", message: "Unknown messaging endpoint" } }, 404);
    const a = this.accounts.get(match[1]!); if (!a) return jsonResponse({ error: { code: "account_missing", message: "Messaging account is unavailable" } }, 404);
    if (a.state === "connected" && a.adapter?.status?.() === "offline") { this.cancel(a); a.state = "failed"; }
    const action = match[2];
    if (action === "link" && method === "GET") return jsonResponse(this.view(a));
    if (action === "answer" && method === "POST") {
      if (!a.challenge || ["qr", "pair_code"].includes(a.challenge.kind) || !a.answer || body.challenge_id !== a.challenge.id || typeof body.value !== "string" || !body.value || body.value.length > 512) return conflictResponse("challenge_changed", "This sign-in step changed. Check the current connection state.");
      a.answer(body.value); return jsonResponse(this.view(a), 202);
    }
    if (action === "resume" && method === "POST") {
      if (a.state === "connected" || a.state === "connecting" || a.state === "challenge") return conflictResponse("account_busy", "This account is already connected or connecting");
      const factory = this.factories[a.saved.provider]; if (!factory) return conflictResponse("adapter_unavailable", "Connection adapter is unavailable");
      this.cancel(a); a.controller = new AbortController(); a.adapter = factory(a.saved.id); a.state = "connecting";
      if (!a.adapter.resume) { this.cancel(a); return conflictResponse("relink_required", "Remove this connection and sign in again"); }
      const controller = a.controller, adapter = a.adapter;
      const timer = setTimeout(() => { if (a.controller === controller) this.cancel(a); }, 15_000); timer.unref?.();
      const fail = () => { if (!controller.signal.aborted) { a.state = "failed"; a.adapter = null; void adapter.close().catch(() => {}); } };
      void adapter.resume!(controller.signal).then(ok => { if (!controller.signal.aborted) { if (ok) a.state = "connected"; else fail(); } }).catch(fail).finally(() => clearTimeout(timer));
      return jsonResponse(this.view(a), 202);
    }
    if (action === "cancel" && method === "POST") { this.cancel(a); return jsonResponse(this.view(a)); }
    if (!action && method === "DELETE") { this.cancel(a); await this.factories[a.saved.provider]?.(a.saved.id).forget?.(); this.accounts.delete(a.saved.id); try { await this.persist(); } catch { this.accounts.set(a.saved.id, a); throw Error(); } return new Response(null, { status: 204 }); }
    if (!a.adapter || a.state !== "connected" || a.controller.signal.aborted) return conflictResponse("account_offline", "Connect this account before opening its conversations");
    if (action === "chats" && method === "GET") {
      if (a.busy) return conflictResponse("messaging_busy", "Wait for the current request to finish"); a.busy = true;
      try { const chats = await this.read(a, () => a.adapter!.chats(a.controller.signal)); if (a.controller.signal.aborted) throw Error();
        if (chats.length > 100 || new Set(chats.map(c => c.id)).size !== chats.length || chats.some(c => typeof c.id !== "string" || !c.id || c.id.length > 180 || typeof c.title !== "string" || c.title.length > 200 || !["direct", "group", "channel"].includes(c.kind))) throw Error("Invalid conversation response");
        const folders = a.adapter!.folders?.() ?? [];
        if (folders.length > 100 || new Set(folders.map(folder => folder.id)).size !== folders.length || folders.some(folder => !folder.id || folder.id.length > 180 || typeof folder.title !== "string" || folder.title.length > 200 || typeof folder.partial !== "boolean" || !Array.isArray(folder.chat_ids) || folder.chat_ids.length > 100 || new Set(folder.chat_ids).size !== folder.chat_ids.length || folder.chat_ids.some(id => !chats.some(chat => chat.id === id)))) throw Error("Invalid conversation folders");
        a.chats = new Map(chats.map(chat => [chat.id, chat])); return jsonResponse({ chats, folders, limit: 100, partial: true }); } finally { a.busy = false; }
    }
    if (action === "selection" && method === "PUT") {
      if (a.saved.revision !== body.revision) return conflictResponse("selection_changed", "Conversation selection changed. Reload before saving.");
      if (!Array.isArray(body.chat_ids) || body.chat_ids.length > 100 || !body.chat_ids.every(id => typeof id === "string" && (a.chats.has(id) || a.saved.selected_chat_ids.includes(id))) || new Set(body.chat_ids).size !== body.chat_ids.length) return badRequest("invalid_selection", "Choose conversations from this account's current list");
      const categories = body.chat_categories ?? a.saved.chat_categories;
      if (!categories || typeof categories !== "object" || Array.isArray(categories) || Object.keys(categories).length > 100 || Object.entries(categories).some(([id, value]) => (!a.chats.has(id) && !Object.hasOwn(a.saved.chat_categories, id)) || !["business", "personal"].includes(String(value)))) return badRequest("invalid_categories", "Categorize conversations from this account's list");
      const previous = a.saved; a.saved = { ...a.saved, revision: crypto.randomUUID(), selected_chat_ids: body.chat_ids as string[], chat_categories: { ...categories } as SavedAccount["chat_categories"] };
      try { await this.persist(); } catch { a.saved = previous; throw Error(); } return jsonResponse(this.view(a));
    }
    if (action === "messages" && method === "GET") {
      const chat = url.searchParams.get("chat_id"), before = url.searchParams.get("before"), view = url.searchParams.get("view") ?? "priority";
      if (!["priority", "business", "personal", "all"].includes(view)) return badRequest("invalid_view", "Choose a valid conversation view");
      const permitted = () => Boolean(chat && (view === "all" ? a.chats.has(chat) : view === "priority" ? a.saved.selected_chat_ids.includes(chat) : a.saved.chat_categories[chat] === view));
      if (!permitted()) return jsonResponse({ error: { code: "chat_not_selected", message: "Load this account’s conversations or choose a priority chat before opening it" } }, 403);
      if (before !== null && (before.length > 2048 || (a.saved.provider === "telegram" ? !/^[1-9][0-9]{0,9}$/.test(before) : !/^[A-Za-z0-9_+/.=-]+$/.test(before)))) return badRequest("invalid_cursor", "Invalid message cursor");
      if (a.busy) return conflictResponse("messaging_busy", "Wait for the current request to finish"); a.busy = true;
      const revision = a.saved.revision;
      try {
        const page = await this.read(a, () => a.adapter!.messages(chat!, before, a.controller.signal));
        const messages = Array.isArray(page) ? page : page.messages;
        const cursor = Array.isArray(page) ? messages.at(-1)?.id ?? null : page.before;
        if (cursor !== null && (typeof cursor !== "string" || cursor.length > 2048 || !/^[A-Za-z0-9_+/.=-]+$/.test(cursor))) throw Error("Invalid history cursor");
        if (a.controller.signal.aborted || !permitted() || (view !== "all" && revision !== a.saved.revision)) return conflictResponse("selection_changed", "Conversation selection changed. Discard the previous result.");
        if (messages.length > 50 || new Set(messages.map(m => m.id)).size !== messages.length || messages.some(message => message.chat_id !== chat || typeof message.id !== "string" || (!message.id || message.id.length > 180) || typeof message.text !== "string" || message.text.length > 50_000 || typeof message.date !== "string" || !Number.isFinite(Date.parse(message.date)) || typeof message.outgoing !== "boolean" || typeof message.has_attachment !== "boolean")) throw Error("Invalid message response");
        return jsonResponse({ messages, partial: true, before: cursor });
      } finally { a.busy = false; }
    }
    return jsonResponse({ error: { code: "method_not_allowed", message: "This messaging action is unavailable" } }, 405);
  }
}
