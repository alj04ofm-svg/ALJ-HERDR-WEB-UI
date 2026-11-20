import { useSyncExternalStore } from "react";
import { isTaskList, isTaskProjects, type TaskSnapshot, type WorkspaceTask } from "../../shared/tasks.ts";

class TaskResponseError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

async function requestTasks(body?: TaskSnapshot): Promise<TaskSnapshot> {
  const response = await fetch("/api/tasks", {
    method: body ? "PUT" : "GET",
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
    headers: body ? { "content-type": "application/json", "x-herdr-tasks": "1" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new TaskResponseError(response.status, data?.error?.message ?? "Tasks are unavailable. Check your connection and try again.");
  }
  if (typeof data?.revision !== "string" || !isTaskList(data.tasks) || (data.projects !== undefined && !isTaskProjects(data.projects)) || (data.archived_projects !== undefined && !isTaskProjects(data.archived_projects))) {
    throw new Error("The bridge returned an unreadable task board.");
  }
  return data;
}

type BoardState = {
  snapshot: TaskSnapshot | null;
  pending: "load" | "save" | null;
  error: string;
  conflict: boolean;
  unavailable: boolean;
  started: ReadonlyMap<string, string>;
};

const TASK_TIMING_KEY = "herdr-web-ui:task-timing:v1";
type TaskTiming = { startedAt: string; updatedAt: string };

function savedTaskTiming(tasks: WorkspaceTask[]): Map<string, string> {
  const timing = new Map<string, string>();
  try {
    const saved = JSON.parse(localStorage.getItem(TASK_TIMING_KEY) ?? "{}") as Record<string, TaskTiming>;
    for (const task of tasks) {
      if (task.archived || task.stage !== "doing") continue;
      const hint = saved?.[task.id];
      // The bridge records the last edit, so a task changed elsewhere may have gone out of Doing.
      if (hint?.updatedAt === task.updated_at && Number.isFinite(Date.parse(hint.startedAt))) {
        timing.set(task.id, hint.startedAt);
      }
    }
  } catch { /* Browser storage is optional. */ }
  return timing;
}

function saveTaskTiming(tasks: WorkspaceTask[], started: ReadonlyMap<string, string>) {
  const entries = tasks.flatMap(task => {
    const startedAt = started.get(task.id);
    if (!startedAt || task.archived || task.stage !== "doing") return [];
    return [[task.id, { startedAt, updatedAt: task.updated_at }]];
  });
  try { localStorage.setItem(TASK_TIMING_KEY, JSON.stringify(Object.fromEntries(entries))); }
  catch { /* Keep timestamps in memory when storage is blocked. */ }
}

export function createTaskStore() {
  let state: BoardState = { snapshot: null, pending: null, error: "", conflict: false, unavailable: false, started: new Map() };
  const listeners = new Set<() => void>();
  let lastCaptureProject = "";
  const publish = (update: Partial<BoardState>) => {
    state = { ...state, ...update };
    for (const listener of listeners) listener();
  };
  async function persist(snapshot: TaskSnapshot, updateTiming?: (timing: Map<string, string>) => void) {
    publish({ pending: "save", error: "" });
    try {
      const next = await requestTasks(snapshot);
      const started = new Map(state.started);
      updateTiming?.(started);
      saveTaskTiming(next.tasks, started);
      publish({ snapshot: next, started });
      return true;
    } catch (error) {
      publish({ error: (error as Error).message, conflict: error instanceof TaskResponseError && error.status === 409 });
      return false;
    } finally {
      publish({ pending: null });
    }
  }
  return {
    read: () => state,
    lastCaptureProject: () => lastCaptureProject,
    rememberCaptureProject(project: string) { lastCaptureProject = project; },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async load() {
      if (state.pending) return false;
      publish({ pending: "load", error: "" });
      try {
        const snapshot = await requestTasks();
        const started = savedTaskTiming(snapshot.tasks);
        for (const task of snapshot.tasks) {
          if (task.archived || task.stage !== "doing" || started.has(task.id)) continue;
          const previous = state.snapshot?.tasks.find(entry => entry.id === task.id);
          const at = state.started.get(task.id);
          if (at && previous?.updated_at === task.updated_at) started.set(task.id, at);
        }
        publish({ snapshot, started, conflict: false, unavailable: false });
        return true;
      } catch (error) {
        const unavailable = error instanceof TaskResponseError && [401, 403, 404, 405].includes(error.status);
        publish({ error: (error as Error).message, unavailable, ...(unavailable && { snapshot: null, started: new Map() }) });
        return false;
      } finally {
        publish({ pending: null });
      }
    },
    async save(task: WorkspaceTask, startedAt?: string) {
      const { snapshot, pending, conflict } = state;
      if (!snapshot || pending || conflict) return false;
      const previous = snapshot.tasks.find(entry => entry.id === task.id);
      const updated = { ...task, title: task.title.trim(), project: task.project.trim(), updated_at: new Date().toISOString() };
      const tasks = previous
        ? snapshot.tasks.map(entry => entry.id === task.id ? updated : entry)
        : [...snapshot.tasks, updated];
      return persist({ ...snapshot, tasks }, started => {
        if (updated.archived || updated.stage !== "doing") started.delete(updated.id);
        else if (!previous || previous.archived || previous.stage !== "doing") started.set(updated.id, startedAt ?? updated.updated_at);
      });
    },
    async addProject(project: string) {
      const { snapshot, pending, conflict } = state;
      if (!snapshot || pending || conflict) return false;
      const projects = [...new Set([...(snapshot.projects ?? []), project])];
      if (!isTaskProjects(projects)) { publish({ error: "The project name or project limit is invalid." }); return false; }
      return persist({ ...snapshot, projects });
    },
    async organize(next: TaskSnapshot) {
      const { snapshot, pending, conflict } = state;
      if (!snapshot || snapshot.revision !== next.revision || pending || conflict) return false;
      if (!isTaskProjects(next.projects) || (next.archived_projects !== undefined && !isTaskProjects(next.archived_projects)) || !isTaskList(next.tasks)) {
        publish({ error: "A project path or the board size exceeds its limit." });
        return false;
      }
      return persist(next);
    },
    dismissError() { publish({ error: "" }); },
  };
}

export type TaskStore = ReturnType<typeof createTaskStore>;

export function useTaskStore(store: TaskStore) {
  return useSyncExternalStore(store.subscribe, store.read);
}

export function taskId(): string {
  return Array.from(crypto.getRandomValues(new Uint32Array(4)), word => word.toString(16).padStart(8, "0")).join("");
}

export function localTaskDay(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function taskElapsed(iso: string, now: number): string {
  const minutes = Math.floor(Math.max(0, now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "<1m";
  const hours = Math.floor(minutes / 60);
  if (hours < 1) return `${minutes}m`;
  const days = Math.floor(hours / 24);
  return days ? `${days}d ${hours % 24}h` : `${hours}h ${minutes % 60}m`;
}

export function taskClock(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}
