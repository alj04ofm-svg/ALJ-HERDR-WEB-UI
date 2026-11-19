/** Browser-owned notes only. No native input, provider action or cross-device synchronization. */
export interface Capture { id: string; text: string; done: boolean }
export interface CaptureState { revision: string; items: Capture[] }
const KEY = "herdr-web-ui:quick-capture:v1";
export const CAPTURE_LIMIT = 50;
export function parseCaptures(raw: string | null): CaptureState {
  if (raw === null) return { revision: "", items: [] };
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object") throw new Error("Invalid capture data");
  const state = value as CaptureState;
  if (typeof state.revision !== "string" || !Array.isArray(state.items) || state.items.length > CAPTURE_LIMIT) throw new Error("Invalid capture data");
  const ids = new Set<string>();
  for (const item of state.items) {
    if (!item || typeof item.id !== "string" || !item.id || ids.has(item.id) || typeof item.text !== "string" || !item.text.trim() || item.text.length > 2000 || typeof item.done !== "boolean") throw new Error("Invalid capture data");
    ids.add(item.id);
  }
  return { revision: state.revision, items: state.items.map(({ id, text, done }) => ({ id, text, done })) };
}
export function readCaptures(): CaptureState { return parseCaptures(localStorage.getItem(KEY)); }
/** Detect another tab's edit before saving; storage does not provide a cross-tab transaction. */
export function writeCaptures(expected: string, items: Capture[]): CaptureState {
  const current = readCaptures();
  if (current.revision !== expected) throw new Error("Capture changed");
  const next = parseCaptures(JSON.stringify({ revision: crypto.randomUUID(), items }));
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
export const CAPTURE_STORAGE_KEY = KEY;
