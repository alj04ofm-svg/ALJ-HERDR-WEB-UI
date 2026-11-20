/** Owner-private task board. Tasks never send input or start native agents. */
export const TASK_STAGES = ["inbox", "next", "doing", "needs-you", "review", "done"] as const;
export const TASK_STAGE_LABELS: Record<TaskStage, string> = { inbox: "Inbox", next: "Next", doing: "Doing", "needs-you": "Needs you", review: "Review", done: "Done" };
export type TaskStage = typeof TASK_STAGES[number];
export interface WorkspaceTask {
  id: string;
  title: string;
  notes: string;
  stage: TaskStage;
  scope: "business" | "personal";
  priority: "normal" | "high" | "urgent";
  project: string;
  due: string;
  due_time?: string;
  checklist: { id: string; title: string; done: boolean }[];
  archived: boolean;
  created_at: string;
  updated_at: string;
}
export interface TaskSnapshot { revision: string; tasks: WorkspaceTask[]; projects?: string[] }
export const TASK_MAX_BYTES = 2 * 1024 * 1024;
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
const timestamp = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v));
const keys = ["id", "title", "notes", "stage", "scope", "priority", "project", "due", "due_time", "checklist", "archived", "created_at", "updated_at"];
export function isTaskProjects(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 500 && new Set(value).size === value.length
    && value.every((name: unknown) => text(name, 120) && name.trim() === name && Boolean(name));
}

export function isTaskList(v: unknown): v is WorkspaceTask[] {
  if (!Array.isArray(v) || v.length > 1000) return false;
  const ids = new Set<string>();
  return v.every(t => {
    if (!object(t) || Object.keys(t).some(k => !keys.includes(k)) || !text(t.id, 80) || !/^[\w-]+$/.test(t.id) || ids.has(t.id)) return false;
    ids.add(t.id);
    if (!text(t.title, 240) || !t.title.trim() || !text(t.notes, 12000) || !TASK_STAGES.includes(t.stage as TaskStage) || !["business", "personal"].includes(t.scope as string) || !["normal", "high", "urgent"].includes(t.priority as string) || !text(t.project, 120) || typeof t.archived !== "boolean" || !timestamp(t.created_at) || !timestamp(t.updated_at)) return false;
    if (typeof t.due !== "string" || (t.due !== "" && (!/^\d{4}-\d{2}-\d{2}$/.test(t.due) || !Number.isFinite(Date.parse(t.due)) || new Date(t.due).toISOString().slice(0,10) !== t.due))) return false;
    if (t.due_time !== undefined && (typeof t.due_time !== "string" || (t.due_time !== "" && (!t.due || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t.due_time))))) return false;
    if (!Array.isArray(t.checklist) || t.checklist.length > 100) return false;
    const checks = new Set<string>();
    return t.checklist.every(c => {
      if (!object(c) || Object.keys(c).some(k => !["id", "title", "done"].includes(k)) || !text(c.id, 80) || !/^[\w-]+$/.test(c.id) || checks.has(c.id) || !text(c.title, 240) || !c.title.trim() || typeof c.done !== "boolean") return false;
      checks.add(c.id); return true;
    });
  });
}
