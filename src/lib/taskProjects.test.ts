import { expect, test } from "bun:test";
import type { TaskSnapshot, WorkspaceTask } from "../../shared/tasks.ts";
import { archivedProject, changeTaskProjects, taskProjects } from "./taskProjects.ts";

const task = (id: string, project: string): WorkspaceTask => ({
  id, project, title: "Review edit", notes: "Keep this", stage: "doing", scope: "business", priority: "normal",
  due: "2026-12-03", archived: false, checklist: [{ id: "check", title: "Read draft", done: true }],
  created_at: "2026-11-20T00:00:00.000Z", updated_at: "2026-11-20T00:00:00.000Z",
});
const board: TaskSnapshot = {
  revision: "revision",
  projects: ["Studio", "Studio / Edit", "Video", "Video / Edit", "Empty"],
  tasks: [task("1", "Studio / Edit"), task("2", "Video / Edit"), task("3", "Studio extras")],
  archived_projects: [],
};

function apply(snapshot: TaskSnapshot, change: Parameters<typeof changeTaskProjects>[1]): TaskSnapshot {
  const result = changeTaskProjects(snapshot, change);
  if (typeof result === "string") throw new Error(result);
  return result;
}

test("merges colliding subprojects and preserves distinct tasks with the same title", () => {
  const result = apply(board, { kind: "merge", path: "Studio", target: "Video" });
  expect(result.projects?.filter(path => path === "Video / Edit")).toHaveLength(1);
  expect(result.projects).not.toContain("Studio");
  expect(result.tasks).toEqual([{ ...board.tasks[0]!, project: "Video / Edit" }, ...board.tasks.slice(1)]);
  expect(result.revision).toBe(board.revision);
});

test("rename and reorder preserve project descendants and older implicit projects", () => {
  const reordered = apply(board, { kind: "move", path: "Studio", target: "Video", after: true });
  expect(taskProjects(reordered).filter(path => !path.includes(" / "))).toEqual(["Video", "Studio", "Empty", "Studio extras"]);
  const renamed = apply(reordered, { kind: "rename", path: "Studio", target: "New Studio" });
  expect(renamed.projects).toContain("New Studio / Edit");
  expect(renamed.tasks[0]?.project).toBe("New Studio / Edit");
  expect(renamed.tasks[2]).toEqual(board.tasks[2]);
});

test("archive is reversible independently of task state and blocks ambiguous merges", () => {
  const result = apply(board, { kind: "archive", path: "Studio / Edit" });
  expect(archivedProject(result, "Studio / Edit")).toBe("Studio / Edit");
  expect(result.tasks).toEqual(board.tasks);
  expect(changeTaskProjects(result, { kind: "merge", path: "Studio", target: "Video" })).toContain("Restore overlapping");
  expect(apply(result, { kind: "restore", path: "Studio / Edit" }).archived_projects).toEqual([]);
  expect(changeTaskProjects(board, { kind: "delete", path: "Studio" })).toContain("Move the tasks");
  expect(apply(board, { kind: "delete", path: "Empty" }).projects).not.toContain("Empty");
});
