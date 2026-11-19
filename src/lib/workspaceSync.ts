import type { SharedWorkspacePreferences, WorkspacePreferencesData } from "../../shared/protocol.ts";
import { isWorkspacePreferencesData, WORKSPACE_PREFERENCES_MAX_BYTES } from "../../shared/workspace-preferences.ts";

export class WorkspaceSyncError extends Error {
  constructor(readonly kind: "unavailable" | "conflict" | "failed" | "unknown") { super(kind); }
}
/** Explicit requests only. No polling, queued writes, retries or provider/native calls. */
async function request(data?: { revision: string; data: WorkspacePreferencesData }): Promise<SharedWorkspacePreferences> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const body = data === undefined ? undefined : JSON.stringify(data);
    if (body && new TextEncoder().encode(body).byteLength > WORKSPACE_PREFERENCES_MAX_BYTES) throw new WorkspaceSyncError("failed");
    const response = await fetch("/api/workspace-preferences", {
      method: data === undefined ? "GET" : "PUT", cache: "no-store", signal: controller.signal,
      headers: data === undefined ? undefined : { "content-type": "application/json", "x-herdr-workspace": "1" }, body,
    });
    if (response.status === 404 || response.status === 405) throw new WorkspaceSyncError("unavailable");
    if (response.status === 409) throw new WorkspaceSyncError("conflict");
    if (!response.ok) throw new WorkspaceSyncError(data && response.status >= 500 ? "unknown" : "failed");
    const result: unknown = await response.json();
    if (!result || typeof result !== "object" || !("revision" in result) || typeof result.revision !== "string" || result.revision.length > 128
      || !("data" in result) || !isWorkspacePreferencesData(result.data)) throw new WorkspaceSyncError(data ? "unknown" : "failed");
    return { revision: result.revision, data: result.data };
  } catch (error) {
    if (error instanceof WorkspaceSyncError) throw error;
    throw new WorkspaceSyncError(data ? "unknown" : "failed");
  } finally { clearTimeout(timer); }
}
export function fetchSharedWorkspace(): Promise<SharedWorkspacePreferences> { return request(); }
export function saveSharedWorkspace(revision: string, data: WorkspacePreferencesData): Promise<SharedWorkspacePreferences> { return request({ revision, data }); }
