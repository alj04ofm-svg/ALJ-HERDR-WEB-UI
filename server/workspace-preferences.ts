import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { SharedWorkspacePreferences } from "../shared/protocol.ts";
import { isWorkspacePreferencesData, WORKSPACE_PREFERENCES_MAX_BYTES } from "../shared/workspace-preferences.ts";
import { badRequest, conflictResponse, errorResponse, isJsonObject, jsonResponse } from "./http.ts";

export class WorkspacePreferencesStore {
  private readonly path: string;
  constructor(stateDir: string) { this.path = join(stateDir, "workspace-preferences.json"); }
  read(): SharedWorkspacePreferences {
    let raw: string;
    try { raw = readFileSync(this.path, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { revision: "empty", data: { tabs: {}, prompts: [] } }; throw error; }
    if (Buffer.byteLength(raw) > WORKSPACE_PREFERENCES_MAX_BYTES + 1024) throw new Error("Workspace metadata exceeds its storage limit");
    let value: unknown;
    try { value = JSON.parse(raw); }
    catch { throw new Error("Workspace metadata needs recovery; original file preserved"); }
    if (!isJsonObject(value) || value.version !== 1 || typeof value.revision !== "string" || !isWorkspacePreferencesData(value.data)) throw new Error("Workspace metadata needs recovery; original file preserved");
    return { revision: value.revision, data: value.data };
  }
  replace(expected: string, data: SharedWorkspacePreferences["data"]): SharedWorkspacePreferences | "conflict" | "busy" {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const lock = `${this.path}.lock`;
    try { mkdirSync(lock, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return "busy"; throw error; }
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      if (this.read().revision !== expected) return "conflict";
      const next = { revision: randomUUID(), data };
      writeFileSync(temporary, JSON.stringify({ version: 1, ...next }), { mode: 0o600, flag: "wx" });
      renameSync(temporary, this.path);
      return next;
    } finally { rmSync(temporary, { force: true }); rmSync(lock, { recursive: true, force: true }); }
  }
}

export async function handleWorkspacePreferences(request: Request, store: WorkspacePreferencesStore): Promise<Response> {
  const noStore = (response: Response) => { response.headers.set("cache-control", "no-store"); return response; };
  try {
    if (request.method === "GET") return noStore(jsonResponse(store.read()));
    if (request.method !== "PUT") return noStore(jsonResponse({ error: { code: "method_not_allowed", message: "Use GET or PUT" } }, 405, { allow: "GET, PUT" }));
    if (request.headers.get("x-herdr-workspace") !== "1") return noStore(badRequest("invalid_request", "Use workspace controls from this app"));
    if (!request.headers.get("content-type")?.startsWith("application/json")) return noStore(badRequest("invalid_request", "Use a JSON workspace snapshot"));
    const reader = request.body?.getReader();
    if (!reader) return noStore(badRequest("invalid_request", "A workspace snapshot is required"));
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > WORKSPACE_PREFERENCES_MAX_BYTES) { await reader.cancel(); return noStore(jsonResponse({ error: { code: "too_large", message: "Workspace snapshot exceeds 2 MiB" } }, 413)); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    let input: unknown;
    try { input = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { return noStore(badRequest("invalid_request", "Invalid workspace snapshot JSON")); }
    if (!isJsonObject(input) || Object.keys(input).some(key => key !== "revision" && key !== "data") || typeof input.revision !== "string" || input.revision.length > 128 || !isWorkspacePreferencesData(input.data)) return noStore(badRequest("invalid_request", "Invalid workspace snapshot"));
    const result = store.replace(input.revision, input.data);
    if (result === "conflict") return noStore(conflictResponse("workspace_changed", "Another device changed the shared workspace. Check it again before saving."));
    if (result === "busy") return noStore(conflictResponse("workspace_busy", "Workspace storage is busy. Check it again before saving."));
    return noStore(jsonResponse(result));
  } catch (error) { return noStore(errorResponse(error)); }
}
