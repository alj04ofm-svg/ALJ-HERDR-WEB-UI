import { useSyncExternalStore } from "react";

export interface SidebarGroup { id: string; name: string; collapsed: boolean }
export interface SidebarLayout {
  version: 1;
  groups: SidebarGroup[];
  order: string[];
  membership: Record<string, string>;
  labels: Record<string, string>;
}
export const SIDEBAR_LAYOUT_KEY = "herdr-web-ui:sidebar-layout:v1";
export const emptySidebarLayout = (): SidebarLayout => ({ version: 1, groups: [], order: [], membership: {}, labels: {} });
const validKey = (key: unknown): key is string => typeof key === "string" && key.length > 0 && key.length <= 1024;
/** Terminal identity stops a recycled native pane ID inheriting another task's organization. */
export const sidebarRowKey = (machineId: string, paneId: string, terminalId: string): string => JSON.stringify([machineId, paneId, terminalId]);
export function sanitizeSidebarLayout(raw: unknown): SidebarLayout {
  const result = emptySidebarLayout();
  if (!raw || typeof raw !== "object" || (raw as SidebarLayout).version !== 1) return result;
  const value = raw as SidebarLayout;
  const ids = new Set<string>();
  if (Array.isArray(value.groups)) for (const group of value.groups.slice(0, 100)) {
    if (!group || !validKey(group.id) || ids.has(group.id) || typeof group.name !== "string" || !group.name.trim()) continue;
    ids.add(group.id);
    result.groups.push({ id: group.id, name: group.name.trim().slice(0, 100), collapsed: group.collapsed === true });
  }
  result.order = Array.isArray(value.order) ? [...new Set(value.order.filter(validKey))].slice(0, 5000) : [];
  const entries = (record: unknown) => record && typeof record === "object" && !Array.isArray(record) ? Object.entries(record).slice(0, 5000) : [];
  result.membership = Object.fromEntries(entries(value.membership).filter(([key, id]) => validKey(key) && typeof id === "string" && ids.has(id)));
  result.labels = Object.fromEntries(entries(value.labels).flatMap(([key, label]) => validKey(key) && typeof label === "string" && label.trim() ? [[key, label.trim().slice(0, 100)]] : []));
  return result;
}
export function orderSidebarRows<T>(rows: readonly T[], layout: SidebarLayout, keyOf: (row: T) => string): T[] {
  const ranks = new Map(layout.order.map((key, index) => [key, index]));
  return [...rows].sort((a, b) => (ranks.get(keyOf(a)) ?? Infinity) - (ranks.get(keyOf(b)) ?? Infinity));
}
/** Only reorder the requested row. Missing/offline rows and their metadata remain saved. */
export function moveSidebarRow(layout: SidebarLayout, liveOrder: readonly string[], key: string, groupId: string | null, target?: { key: string; after: boolean }): SidebarLayout {
  if (!liveOrder.includes(key) || (groupId !== null && !layout.groups.some(group => group.id === groupId)) || target?.key === key) return layout;
  const order = [...new Set([...layout.order, ...liveOrder])].filter(id => id !== key);
  const at = target ? order.indexOf(target.key) : -1;
  order.splice(at < 0 ? order.length : at + (target?.after ? 1 : 0), 0, key);
  const membership = { ...layout.membership };
  if (groupId === null) delete membership[key]; else membership[key] = groupId;
  return { ...layout, order, membership };
}
export function moveSidebarGroup(layout: SidebarLayout, id: string, targetId: string, after: boolean): SidebarLayout {
  if (id === targetId || !layout.groups.some(group => group.id === id) || !layout.groups.some(group => group.id === targetId)) return layout;
  const groups = layout.groups.filter(group => group.id !== id);
  groups.splice(groups.findIndex(group => group.id === targetId) + (after ? 1 : 0), 0, layout.groups.find(group => group.id === id)!);
  return { ...layout, groups };
}
export function removeSidebarGroup(layout: SidebarLayout, id: string): SidebarLayout {
  return { ...layout, groups: layout.groups.filter(group => group.id !== id), membership: Object.fromEntries(Object.entries(layout.membership).filter(([, group]) => group !== id)) };
}

let current: SidebarLayout | null = null;
const listeners = new Set<() => void>();
function read(): SidebarLayout {
  if (current) return current;
  try { return current = sanitizeSidebarLayout(JSON.parse(localStorage.getItem(SIDEBAR_LAYOUT_KEY) ?? "null")); }
  catch { return current = emptySidebarLayout(); }
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function saveSidebarLayout(next: SidebarLayout): boolean {
  try { localStorage.setItem(SIDEBAR_LAYOUT_KEY, JSON.stringify(next)); }
  catch { return false; }
  current = next;
  for (const listener of listeners) listener();
  return true;
}
if (typeof window !== "undefined") window.addEventListener("storage", event => {
  if (event.key !== SIDEBAR_LAYOUT_KEY && event.key !== null) return;
  current = null;
  for (const listener of listeners) listener();
});
export function useSidebarLayout(): SidebarLayout { return useSyncExternalStore(subscribe, read); }
