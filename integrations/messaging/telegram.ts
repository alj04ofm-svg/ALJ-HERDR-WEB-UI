import { mkdir, readFile, rename, rm, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import type { TelegramClient, Api } from "./node_modules/teleproto/index.js";
import type { BusinessChat, BusinessMessage, ConversationFolder, LinkChallengeKind, MessagingAdapter, TelegramLinkRequest } from "../../shared/messaging.ts";
import { folderMembers, type FolderDialog } from "./folders.ts";
/** No message sends, read receipts, contacts writes, background history import or automatic auth-form submission. */
export class TelegramAdapter implements MessagingAdapter {
  private client: TelegramClient | null = null;
  private nativeFolders: ConversationFolder[] = [];
  folders(): ConversationFolder[] { return this.nativeFolders.map(folder => ({ ...folder, chat_ids: [...folder.chat_ids] })); }
  private peers = new Map<string, Api.TypeInputPeer>();
  constructor(private directory: string, private id: string) { if (!/^[a-f0-9-]{36}$/.test(id)) throw Error("Invalid account"); }
  status(): "live" | "offline" { return this.client?.connected ? "live" : "offline"; }
  private path() { return join(this.directory, `${this.id}.json`); }
  private async create(apiId: number, apiHash: string, session: string, signal: AbortSignal) {
    const client = await createTelegramClient(apiId, apiHash, session, signal); this.client = client; return client;
  }
  async link(input: TelegramLinkRequest, challenge: (kind: LinkChallengeKind) => Promise<string>, signal: AbortSignal) {
    signal.throwIfAborted(); const client = await this.create(input.api_id, input.api_hash, "", signal);
    const abort = () => { void client.disconnect().catch(() => {}); }; signal.addEventListener("abort", abort, { once: true });
    try {
      await client.start({ phoneNumber: input.phone, phoneCode: () => challenge("code"), password: () => challenge("password"), emailAddress: () => challenge("email"), emailVerification: () => challenge("email_code"), firstAndLastNames: async () => { throw Error("Account creation is not supported"); }, acceptTermsOfService: async () => false, onError: async () => true });
      signal.throwIfAborted();
      await mkdir(this.directory, { recursive: true, mode: 0o700 }); await chmod(this.directory, 0o700);
      const temp = join(this.directory, `.${this.id}-${crypto.randomUUID()}.tmp`);
      try { await writeFile(temp, JSON.stringify({ api_id: input.api_id, api_hash: input.api_hash, session: client.session.save() }), { mode: 0o600, flag: "wx" }); signal.throwIfAborted(); await rename(temp, this.path()); } finally { await rm(temp, { force: true }).catch(() => {}); }
    } finally { signal.removeEventListener("abort", abort); }
  }
  async resume(signal: AbortSignal): Promise<boolean> {
    const value = JSON.parse(await readFile(this.path(), "utf8"));
    if (!Number.isSafeInteger(value.api_id) || typeof value.api_hash !== "string" || !/^[a-f0-9]{32}$/i.test(value.api_hash) || typeof value.session !== "string" || !value.session) throw Error("Invalid session");
    signal.throwIfAborted(); const client = await this.create(value.api_id, value.api_hash, value.session, signal);
    const abort = () => { void client.disconnect().catch(() => {}); }; signal.addEventListener("abort", abort, { once: true });
    try { await client.connect(); signal.throwIfAborted(); if (!(await client.checkAuthorization())) { await this.close(); return false; } return true; }
    finally { signal.removeEventListener("abort", abort); }
  }
  async chats(signal: AbortSignal): Promise<BusinessChat[]> {
    signal.throwIfAborted(); if (!this.client) throw Error("Disconnected");
    // Dialog discovery may carry provider previews internally. Expose metadata only and never persist previews.
    const dialogs = await this.client.getDialogs({ limit: 100 }); signal.throwIfAborted();
    this.peers.clear(); const result: BusinessChat[] = [];
    for (const dialog of dialogs) { if (!dialog.id || dialog.isCommunity) continue; const id = dialog.id.toString(); this.peers.set(id, dialog.inputEntity); result.push({ id, title: (dialog.title || dialog.name || id).slice(0, 200), kind: dialog.isGroup ? "group" : dialog.isChannel ? "channel" : "direct" }); }
    // Folder definitions are read-only. Never update/reorder the user's Telegram folders.
    const [{ Api }, { getPeerId }] = await Promise.all([import("./node_modules/teleproto/index.js"), import("./node_modules/teleproto/Utils.js")]);
    const inventory: FolderDialog[] = dialogs.filter(dialog => !dialog.isCommunity && dialog.id).map(dialog => {
      const entity = dialog.entity, native = dialog.dialog;
      const user = entity instanceof Api.User ? entity : null;
      const muteUntil = native instanceof Api.Dialog ? native.notifySettings.muteUntil : undefined;
      return { id: dialog.id!.toString(), kind: dialog.isGroup ? "group" : dialog.isChannel ? "channel" : "direct", contact: Boolean(user?.contact), bot: Boolean(user?.bot), archived: dialog.folderId === 1, unread: dialog.unreadCount > 0 || (native instanceof Api.Dialog && Boolean(native.unreadMark)), muted: muteUntil === undefined ? null : muteUntil > Math.floor(Date.now() / 1000) };
    });
    const selfId = dialogs.find(dialog => dialog.entity instanceof Api.User && dialog.entity.self)?.id?.toString();
    const peerId = (peer: Api.TypeInputPeer) => peer instanceof Api.InputPeerSelf ? selfId || "" : getPeerId(peer);
    const filters = await this.client.getDialogFilters(); signal.throwIfAborted();
    this.nativeFolders = filters.filters.flatMap(filter => {
      if (!(filter instanceof Api.DialogFilter) && !(filter instanceof Api.DialogFilterChatlist)) return [];
      const rule = filter instanceof Api.DialogFilter ? filter : {};
      return [{ id: String(filter.id), title: filter.title.text.slice(0, 200), chat_ids: folderMembers({ ...rule, include: filter.includePeers.map(peer => peerId(peer)).filter(Boolean), pinned: filter.pinnedPeers.map(peer => peerId(peer)).filter(Boolean), exclude: filter instanceof Api.DialogFilter ? filter.excludePeers.map(peer => peerId(peer)).filter(Boolean) : [] }, inventory), partial: true }];
    });
    return result;
  }
  async messages(chatId: string, before: string | null, signal: AbortSignal): Promise<BusinessMessage[]> {
    signal.throwIfAborted(); const peer = this.peers.get(chatId); if (!peer || !this.client) throw Error("Refresh conversation list");
    const { Api } = await import("./node_modules/teleproto/index.js");
    signal.throwIfAborted();
    const records = await this.client.getMessages(peer, { limit: 50, offsetId: before ? Number(before) : 0 }); signal.throwIfAborted();
    return records.filter(message => message instanceof Api.Message).map(message => ({ id: String(message.id), chat_id: chatId, text: (message.message || "").slice(0, 50_000), date: new Date(message.date * 1000).toISOString(), outgoing: Boolean(message.out), has_attachment: Boolean(message.media) }));
  }
  async close() { const client = this.client; this.client = null; this.peers.clear(); this.nativeFolders = []; if (client) await client.destroy(); }
  async forget() { await this.close(); await rm(this.path(), { force: true }); }
}

// In this pinned SDK these values count total attempts, not retries after the first.
export async function createTelegramClient(apiId: number, apiHash: string, session: string, signal: AbortSignal) {
    const [{ TelegramClient }, { StringSession }, { Logger, LogLevel }] = await Promise.all([
      import("./node_modules/teleproto/index.js"), import("./node_modules/teleproto/sessions/index.js"), import("./node_modules/teleproto/extensions/Logger.js"),
    ]);
    signal.throwIfAborted();
    const client = new TelegramClient(new StringSession(session), apiId, apiHash, { connectionRetries: 1, requestRetries: 3, autoReconnect: false, floodSleepThreshold: 0, baseLogger: new Logger(LogLevel.NONE), deviceModel: "Herdr Business Inbox", appVersion: "1.0", langCode: "en", systemLangCode: "en" });
    return client;
  }
