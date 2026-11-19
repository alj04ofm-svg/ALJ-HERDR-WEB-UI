/** Pure projection of Telegram folder rules; no message bodies or provider actions. */
export interface FolderDialog { id: string; kind: "direct" | "group" | "channel"; contact: boolean; bot: boolean; archived: boolean; unread: boolean; muted: boolean | null }
export interface FolderRule { include: string[]; pinned: string[]; exclude: string[]; contacts?: boolean; nonContacts?: boolean; groups?: boolean; broadcasts?: boolean; bots?: boolean; excludeMuted?: boolean; excludeRead?: boolean; excludeArchived?: boolean }
export function folderMembers(rule: FolderRule, dialogs: FolderDialog[]): string[] {
  const byId = new Map(dialogs.map(dialog => [dialog.id, dialog]));
  const included = new Set([...rule.pinned, ...rule.include]), excluded = new Set(rule.exclude);
  const matches = (dialog: FolderDialog) => {
    if (excluded.has(dialog.id)) return false;
    if (included.has(dialog.id)) return true;
    if (rule.excludeArchived && dialog.archived || rule.excludeRead && !dialog.unread || rule.excludeMuted && dialog.muted !== false) return false;
    return dialog.kind === "group" ? Boolean(rule.groups) : dialog.kind === "channel" ? Boolean(rule.broadcasts) : dialog.bot ? Boolean(rule.bots) : dialog.contact ? Boolean(rule.contacts) : Boolean(rule.nonContacts);
  };
  return [...new Set([...rule.pinned, ...dialogs.map(dialog => dialog.id)])].filter(id => { const dialog = byId.get(id); return Boolean(dialog && matches(dialog)); });
}
