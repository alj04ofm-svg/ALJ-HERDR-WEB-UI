import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleTasks, TaskStore } from "./tasks.ts";
import type { WorkspaceTask } from "../shared/tasks.ts";

test("projects, times and archives survive reload and stale writes cannot replace them", async () => {
  const state = mkdtempSync(join(tmpdir(), "herdr-tasks-"));
  const path = join(state, "tasks.json");
  const now = new Date().toISOString();
  const task: WorkspaceTask = {
    id: "fictional-test", title: "Review edit", notes: "", stage: "inbox", scope: "business",
    priority: "normal", project: "Studio", due: "2026-12-03", checklist: [], archived: false, created_at: now, updated_at: now,
  };
  writeFileSync(path, JSON.stringify({ version: 1, revision: "old", tasks: [task] }), { mode: 0o600 });
  const put = (body: object) => handleTasks(new Request("http://localhost/api/tasks", {
    method: "PUT", headers: { "content-type": "application/json", "x-herdr-tasks": "1" }, body: JSON.stringify(body),
  }), new TaskStore(state));
  try {
    expect(new TaskStore(state).read()).toEqual({ revision: "old", tasks: [task], archived_projects: [] });
    const projects = ["Studio", "Studio / Editing", "Empty project"];
    const archived = { ...task, due_time: "15:30", archived: true, project: projects[1]! };
    const saved = await put({ revision: "old", tasks: [archived], projects, archived_projects: ["Empty project"] });
    expect(saved.status).toBe(200);
    expect(saved.headers.get("cache-control")).toBe("no-store");
    const { revision } = await saved.json() as { revision: string };
    const next = await put({ revision, tasks: [archived] });
    expect(next.status).toBe(200);
    expect(new TaskStore(state).read()).toMatchObject({ tasks: [archived], projects, archived_projects: ["Empty project"] });
    const original = readFileSync(path, "utf8");
    expect((await put({ revision, tasks: [] })).status).toBe(409);
    expect((await put({ revision, tasks: [{ ...archived, due_time: "25:30" }] })).status).toBe(400);
    expect((await put({ revision, tasks: [archived], projects: ["Studio", "Studio"] })).status).toBe(400);
    expect(readFileSync(path, "utf8")).toBe(original);
  } finally { rmSync(state, { recursive: true, force: true }); }
});
