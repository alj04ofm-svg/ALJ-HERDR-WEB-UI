import { mkdir, chmod, readFile, rm } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import type { BusinessChat, MessagePage, MessagingAdapter, LinkChallengeKind, TelegramLinkRequest } from "../../shared/messaging.ts";
import release from "./wacli-release.json";

/** Owns only its explicitly linked account's wacli child. Never invokes a send command. */
export class WhatsAppAdapter implements MessagingAdapter {
  private child: Bun.Subprocess | null = null;
  private connection: "live" | "reconnecting" | "offline" = "offline";
  private store: string;
  constructor(directory: string, id: string, private executable: string, private expectedSha = release.binarySha256) {
    if (!/^[a-f0-9-]{36}$/.test(id) || !isAbsolute(executable)) throw Error("Invalid WhatsApp adapter configuration");
    this.store = join(directory, id);
  }
  status() { return this.connection; }
  private async verified() {
    if (new Bun.CryptoHasher("sha256").update(await readFile(this.executable)).digest("hex") !== this.expectedSha) throw Error("WhatsApp binary identity changed");
  }
  private environment() {
    // Do not inherit another account, webhook, media or provider configuration.
    return { PATH: process.env.PATH || "/usr/bin:/bin", HOME: this.store, LANG: "C.UTF-8", WACLI_SYNC_MAX_MESSAGES: "100000", WACLI_SYNC_MAX_DB_SIZE: "536870912" };
  }
  private async json(args: string[], signal: AbortSignal): Promise<any> {
    await this.verified(); signal.throwIfAborted();
    const child = Bun.spawn([this.executable, "--store", this.store, "--read-only", "--json", ...args], { env: this.environment(), stdin: "ignore", stdout: "pipe", stderr: "ignore" });
    const kill = () => { child.kill("SIGKILL"); }; signal.addEventListener("abort", kill, { once: true }); if (signal.aborted) kill();
    const timer = setTimeout(kill, 10_000); timer.unref?.();
    try {
      const reader = child.stdout.getReader(), chunks: Uint8Array[] = []; let size = 0;
      try { while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > 4_000_000) { child.kill(); throw Error("WhatsApp result is too large"); } chunks.push(next.value); } } finally { reader.releaseLock(); }
      if (await child.exited !== 0) throw Error("WhatsApp archive is unavailable"); signal.throwIfAborted();
      const value = JSON.parse(Buffer.concat(chunks).toString("utf8")); if (value.success !== true) throw Error("WhatsApp archive read failed"); return value.data;
    } finally { clearTimeout(timer); signal.removeEventListener("abort", kill); if (child.exitCode === null) { child.kill("SIGKILL"); await child.exited; } }
  }
  private async follow(auth: boolean, signal: AbortSignal, challenge?: (kind: LinkChallengeKind, display?: string) => Promise<string>, phone?: string) {
    await this.verified(); signal.throwIfAborted();
    await mkdir(this.store, { recursive: true, mode: 0o700 }); await chmod(this.store, 0o700);
    signal.throwIfAborted();
    const args = auth ? ["auth", "--follow", "--full-history", "--history-size-mb", "512", ...(phone ? ["--phone", phone] : [])] : ["sync", "--follow"];
    const child = Bun.spawn([this.executable, "--store", this.store, "--json", "--events", ...args], { env: this.environment(), stdin: "ignore", stdout: "ignore", stderr: "pipe" });
    this.child = child; this.connection = "reconnecting";
    const kill = () => { child.kill(); }; signal.addEventListener("abort", kill, { once: true }); if (signal.aborted) kill();
    let connected = false, resolveReady!: () => void, rejectReady!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    void (async () => {
      const reader = child.stderr.getReader(), decoder = new TextDecoder(); let line = "";
      try {
        while (true) {
          const next = await reader.read(); if (next.done) break; line += decoder.decode(next.value, { stream: true });
          let boundary: number;
          while ((boundary = line.indexOf("\n")) >= 0) {
            if (boundary > 65_536) throw Error("Invalid WhatsApp event");
            const raw = line.slice(0, boundary); line = line.slice(boundary + 1);
            let event: any; try { event = JSON.parse(raw); } catch { continue; }
            if (event.event === "qr_code" && auth && !connected && typeof event.data?.code === "string" && event.data.code.length <= 4096) void challenge?.("qr", event.data.code).catch(() => {});
            if (event.event === "pair_code" && auth && !connected && typeof event.data?.code === "string" && event.data.code.length <= 32) void challenge?.("pair_code", event.data.code).catch(() => {});
            if (event.event === "connected") { connected = true; this.connection = "live"; resolveReady(); }
            if (event.event === "disconnected") this.connection = "reconnecting";
            if (["logged_out", "stream_replaced", "connect_failure"].includes(event.event)) { this.connection = "offline"; child.kill(); }
          }
          if (line.length > 65_536) throw Error("Invalid WhatsApp event");
        }
      } catch { child.kill(); } finally { reader.releaseLock(); }
    })();
    void child.exited.finally(() => { signal.removeEventListener("abort", kill); if (this.child === child) { this.child = null; this.connection = "offline"; } rejectReady(Error("WhatsApp connection closed")); });
    await ready;
  }
  async link(_input: TelegramLinkRequest, challenge: (kind: LinkChallengeKind, display?: string) => Promise<string>, signal: AbortSignal) { await this.follow(true, signal, challenge, _input.phone); }
  async resume(signal: AbortSignal) { const data = await this.json(["auth", "status"], signal); if (data.authenticated !== true) return false; await this.follow(false, signal); return true; }
  async chats(signal: AbortSignal): Promise<BusinessChat[]> {
    const data = await this.json(["chats", "list", "--limit", "100"], signal); if (!Array.isArray(data)) throw Error("Invalid WhatsApp conversations");
    return data.map(row => ({ id: String(row.jid), title: String(row.name || row.jid).slice(0, 200), kind: row.kind === "group" ? "group" : row.kind === "channel" || String(row.jid).endsWith("@newsletter") ? "channel" : "direct" }));
  }
  async messages(chatId: string, before: string | null, signal: AbortSignal): Promise<MessagePage> {
    const data = await this.json(["messages", "list", "--chat", chatId, "--limit", "50", ...(before ? ["--cursor", before] : [])], signal);
    if (!data || !Array.isArray(data.messages)) throw Error("Invalid WhatsApp history");
    return { messages: data.messages.map((row: any) => {
      if (row.ChatJID !== chatId) throw Error("Wrong WhatsApp conversation");
      return { id: String(row.MsgID), chat_id: chatId, text: String(row.DisplayText || row.Text || "").slice(0, 50_000), date: String(row.Timestamp), outgoing: Boolean(row.FromMe), has_attachment: Boolean(row.MediaType) };
    }), before: data.page?.has_more === true && typeof data.page.next_cursor === "string" ? data.page.next_cursor : null };
  }
  async close() {
    const child = this.child; this.child = null; this.connection = "offline";
    if (child) { child.kill(); const timer = setTimeout(() => child.kill("SIGKILL"), 2000); timer.unref?.(); try { await child.exited; } finally { clearTimeout(timer); } }
  }
  async forget() { await this.close(); await rm(this.store, { recursive: true, force: true }); }
}
