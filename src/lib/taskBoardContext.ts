import { createContext } from "react";
import type { TaskSource } from "../../shared/tasks.ts";
import type { TaskStore } from "./workspaceTasks.ts";

export type TaskBoardMode = "board" | "capture";

export const TaskBoardContext = createContext<{
  store: TaskStore;
  mode: TaskBoardMode | null;
  show(mode: TaskBoardMode): void;
  fromReply?: (machine: string, pane: string, reply: TaskSource["reply"]) => void;
  resume: { machine: string; pane: string; reply: NonNullable<TaskSource["reply"]> } | null;
  finishResume(): void;
} | null>(null);
