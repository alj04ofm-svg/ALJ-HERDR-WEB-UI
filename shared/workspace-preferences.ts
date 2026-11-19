import type { WorkspacePreferencesData } from "./protocol.ts";

export const WORKSPACE_PREFERENCES_MAX_BYTES = 2 * 1024 * 1024;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
/** Reject rather than silently truncate an explicit shared snapshot. */
export function isWorkspacePreferencesData(value: unknown): value is WorkspacePreferencesData {
  if (!object(value) || Object.keys(value).some(key => key !== "tabs" && key !== "prompts") || !object(value.tabs) || !Array.isArray(value.prompts)) return false;
  const tabs = Object.entries(value.tabs);
  if (tabs.length > 1000 || value.prompts.length > 20) return false;
  if (!tabs.every(([key, item]) => {
    if (key.length > 8192 || !object(item) || Object.keys(item).some(field => field !== "pinned" && field !== "settled")) return false;
    if (![item.pinned, item.settled].every(flag => flag === undefined || typeof flag === "boolean")) return false;
    // Exact machine/workspace/tab/pane+terminal identity, never a title or inferred target.
    try {
      const tuple: unknown = JSON.parse(key);
      return Array.isArray(tuple) && tuple.length === 4 && tuple.slice(0, 3).every(part => typeof part === "string" && part.length > 0)
        && Array.isArray(tuple[3]) && tuple[3].length > 0 && tuple[3].length <= 128
        && tuple[3].every((pane: unknown) => Array.isArray(pane) && pane.length === 2 && pane.every(id => typeof id === "string" && id.length > 0));
    } catch { return false; }
  })) return false;
  const ids = new Set<string>();
  return value.prompts.every((prompt: unknown) => {
    if (!object(prompt) || Object.keys(prompt).some(key => key !== "id" && key !== "text") || typeof prompt.id !== "string" || prompt.id.length === 0 || prompt.id.length > 128
      || typeof prompt.text !== "string" || !prompt.text.trim() || prompt.text.length > 100_000 || ids.has(prompt.id)) return false;
    ids.add(prompt.id); return true;
  }) && new TextEncoder().encode(JSON.stringify(value)).byteLength <= WORKSPACE_PREFERENCES_MAX_BYTES;
}
