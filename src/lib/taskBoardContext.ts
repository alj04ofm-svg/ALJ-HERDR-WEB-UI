import { createContext } from "react";
import type { TaskStore } from "./workspaceTasks.ts";

export type TaskBoardMode = "board" | "capture";

export const TaskBoardContext = createContext<{
  store: TaskStore;
  mode: TaskBoardMode | null;
  show(mode: TaskBoardMode): void;
} | null>(null);
