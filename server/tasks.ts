import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { TaskSnapshot } from "../shared/tasks.ts";
import { isTaskList, isTaskProjects, TASK_MAX_BYTES } from "../shared/tasks.ts";
import { badRequest, conflictResponse, errorResponse, isJsonObject, jsonResponse } from "./http.ts";

export class TaskStore {
  private readonly path: string;
  constructor(stateDir: string) { this.path = join(stateDir, "tasks.json"); }
  read(): TaskSnapshot {
    let raw: string;
    try { raw = readFileSync(this.path, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { revision: "empty", tasks: [] }; throw error; }
    if (Buffer.byteLength(raw) > TASK_MAX_BYTES + 1024) throw new Error("Task board exceeds its storage limit");
    let value: unknown;
    try { value = JSON.parse(raw); }
    catch { throw new Error("Task board needs recovery; original file preserved"); }
    if (!isJsonObject(value) || value.version !== 1 || typeof value.revision !== "string" || !isTaskList(value.tasks) || (value.projects !== undefined && !isTaskProjects(value.projects))) throw new Error("Task board needs recovery; original file preserved");
    return { revision: value.revision, tasks: value.tasks, ...(value.projects !== undefined && { projects: value.projects }) };
  }
  replace(expected: string, tasks: TaskSnapshot["tasks"], projects?: string[]): TaskSnapshot | "conflict" | "busy" | "too_large" {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const lock = `${this.path}.lock`;
    try { mkdirSync(lock, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return "busy"; throw error; }
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      const previous = this.read();
      if (previous.revision !== expected) return "conflict";
      const folders = projects ?? previous.projects;
      const next = { revision: randomUUID(), tasks, ...(folders !== undefined && { projects: folders }) };
      const encoded = JSON.stringify({ version: 1, ...next });
      if (Buffer.byteLength(encoded) > TASK_MAX_BYTES) return "too_large";
      writeFileSync(temporary, encoded, { mode: 0o600, flag: "wx" });
      renameSync(temporary, this.path);
      return next;
    } finally { rmSync(temporary, { force: true }); rmSync(lock, { recursive: true, force: true }); }
  }
}

export async function handleTasks(request: Request, store: TaskStore): Promise<Response> {
  const noStore = (response: Response) => { response.headers.set("cache-control", "no-store"); return response; };
  try {
    if (request.method === "GET") return noStore(jsonResponse(store.read()));
    if (request.method !== "PUT") return noStore(jsonResponse({ error: { code: "method_not_allowed", message: "Use GET or PUT" } }, 405, { allow: "GET, PUT" }));
    if (request.headers.get("x-herdr-tasks") !== "1") return noStore(badRequest("invalid_request", "Use task controls from this app"));
    if (!request.headers.get("content-type")?.startsWith("application/json")) return noStore(badRequest("invalid_request", "Use a JSON task board"));
    const reader = request.body?.getReader();
    if (!reader) return noStore(badRequest("invalid_request", "A task board is required"));
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > TASK_MAX_BYTES) { await reader.cancel(); return noStore(jsonResponse({ error: { code: "too_large", message: "Task board exceeds 2 MiB" } }, 413)); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    let input: unknown;
    try { input = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { return noStore(badRequest("invalid_request", "Invalid task board JSON")); }
    if (!isJsonObject(input) || Object.keys(input).some(key => !["revision", "tasks", "projects"].includes(key)) || typeof input.revision !== "string" || input.revision.length > 128 || !isTaskList(input.tasks) || (input.projects !== undefined && !isTaskProjects(input.projects))) return noStore(badRequest("invalid_request", "Invalid task board"));
    const result = store.replace(input.revision, input.tasks, input.projects);
    if (result === "too_large") return noStore(jsonResponse({ error: { code: "too_large", message: "Task board exceeds 2 MiB" } }, 413));
    if (result === "conflict") return noStore(conflictResponse("tasks_changed", "Another device changed the task board. Check it again before saving."));
    if (result === "busy") return noStore(conflictResponse("tasks_busy", "Task storage is busy. Check it again before saving."));
    return noStore(jsonResponse(result));
  } catch (error) { return noStore(errorResponse(error)); }
}
