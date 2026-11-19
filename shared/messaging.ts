/** All identifiers are opaque strings, including Telegram's 64-bit chat IDs. */
export type MessagingProvider = "telegram" | "whatsapp";
export type LinkChallengeKind = "code" | "password" | "email" | "email_code" | "qr" | "pair_code";
export interface MessagingAccount {
  id: string; provider: MessagingProvider; label: string; scope: "business" | "personal";
  state: "disconnected" | "connecting" | "challenge" | "connected" | "failed";
  sync_state?: "live" | "reconnecting" | "offline";
  revision: string; selected_chat_ids: string[];
  chat_categories: Record<string, "business" | "personal">;
  challenge: { id: string; kind: LinkChallengeKind; display?: string } | null;
}
/** Native provider folder membership within the bounded loaded conversation inventory. */
export interface ConversationFolder { id: string; title: string; chat_ids: string[]; partial: boolean }
export interface ConversationInventory { chats: BusinessChat[]; folders?: ConversationFolder[]; limit?: number; partial?: boolean }
export interface BusinessChat { id: string; title: string; kind: "direct" | "group" | "channel" }
export interface BusinessMessage { id: string; chat_id: string; text: string; date: string; outgoing: boolean; has_attachment: boolean }
export interface MessagingOverview { providers: { id: MessagingProvider; available: boolean }[]; accounts: MessagingAccount[] }
export interface TelegramLinkRequest { api_id: number; api_hash: string; phone: string; label: string; scope: "business" | "personal" }
export interface MessagePage { messages: BusinessMessage[]; before: string | null }
export interface MessagingAdapter {
  link(request: TelegramLinkRequest, challenge: (kind: LinkChallengeKind, display?: string) => Promise<string>, signal: AbortSignal): Promise<void>;
  chats(signal: AbortSignal): Promise<BusinessChat[]>;
  folders?(): ConversationFolder[];
  messages(chatId: string, before: string | null, signal: AbortSignal): Promise<BusinessMessage[] | MessagePage>;
  status?(): "live" | "reconnecting" | "offline";
  resume?(signal: AbortSignal): Promise<boolean>;
  forget?(): Promise<void>;
  close(): Promise<void>;
}
