import { useSyncExternalStore } from "react";
import type { HerdrPane, WorkspacePreferencesData } from "../../shared/protocol.ts";
import { isWorkspacePreferencesData } from "../../shared/workspace-preferences.ts";

export interface TabPreference { pinned?: boolean; settled?: boolean }
interface Preferences { tabs: Record<string, TabPreference>; prompts: { id: string; text: string }[]; previous: Record<string, string> }
const KEY = "herdr-web-ui:workspace-preferences:v1";
const empty = (): Preferences => ({ tabs: {}, prompts: [], previous: {} });
let value: Preferences | null = null;
const listeners = new Set<() => void>();
function read(): Preferences {
  if (value) return value;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (raw && typeof raw === "object") {
      const tabs: Preferences["tabs"] = {};
      for (const [key, item] of Object.entries(raw.tabs ?? {}).slice(0, 1000)) {
        if (item && typeof item === "object") tabs[key] = { pinned: (item as TabPreference).pinned === true, settled: (item as TabPreference).settled === true };
      }
      const previous: Record<string, string> = {};
      for (const [key, text] of Object.entries(raw.previous ?? {}).slice(-50)) if (typeof text === "string" && text.length <= 100_000) previous[key] = text;
      const prompts = Array.isArray(raw.prompts) ? raw.prompts.filter((p: unknown): p is { id: string; text: string } => Boolean(p && typeof p === "object" && typeof (p as { id?: unknown }).id === "string" && typeof (p as { text?: unknown }).text === "string" && (p as { text: string }).text.length <= 100_000)).slice(0, 20) : [];
      return value = { tabs, previous, prompts };
    }
  } catch { /* Blocked storage and old corrupt records do not block navigation. */ }
  return value = empty();
}
function write(next: Preferences): boolean {
  try { localStorage.setItem(KEY, JSON.stringify(next)); }
  catch { return false; }
  value = next;
  for (const listener of listeners) listener();
  return true;
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
if (typeof window !== "undefined") window.addEventListener("storage", (event) => { if (event.key === KEY || event.key === null) { value = null; for (const listener of listeners) listener(); } });
export function useWorkspacePreferences() { return useSyncExternalStore(subscribe, read); }
/** Only owner metadata crosses devices. Drafts, previous prompts and pending input stay local. */
export function workspaceSnapshot(): WorkspacePreferencesData {
  const current = read(); return { tabs: current.tabs, prompts: current.prompts };
}
/** Compare local state as well: another browser tab must not lose an edit made during preview. */
export function applyWorkspaceSnapshot(data: WorkspacePreferencesData, expectedLocal: string): boolean {
  if (!isWorkspacePreferencesData(data) || JSON.stringify(workspaceSnapshot()) !== expectedLocal) return false;
  return write({ ...read(), tabs: data.tabs, prompts: data.prompts });
}
/** Native identity, including every terminal, prevents a recycled tab ID inheriting an old pin. */
export function tabPreferenceKey(machineId: string, workspaceId: string, tabId: string, panes: readonly HerdrPane[]): string {
  return JSON.stringify([machineId, workspaceId, tabId, panes.map(pane => [pane.pane_id, pane.terminal_id]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))]);
}
export function updateTabPreference(key: string, patch: TabPreference): boolean {
  const old = read();
  return write({ ...old, tabs: { ...old.tabs, [key]: { ...old.tabs[key], ...patch } } });
}
export function savePrompt(text: string): boolean {
  const old = read();
  if (!text.trim() || text.length > 100_000 || old.prompts.length >= 20) return false;
  return write({ ...old, prompts: [...old.prompts, { id: crypto.randomUUID(), text }] });
}
export function deletePrompt(id: string): boolean { const old = read(); return write({ ...old, prompts: old.prompts.filter(p => p.id !== id) }); }
export function rememberPrompt(key: string, text: string): void {
  const old = read();
  const previous = Object.fromEntries([...Object.entries(old.previous).filter(([id]) => id !== key), [key, text]].slice(-50));
  write({ ...old, previous });
}
