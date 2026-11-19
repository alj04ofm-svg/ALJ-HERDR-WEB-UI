import type { PaneInfo } from "../../shared/protocol.ts";

/** Display priority only. Stable ties keep native order; no move/focus/input is sent. */
export function workActivityRank(panes: readonly Pick<PaneInfo, "agent_status">[]): number {
  if (panes.some((pane) => pane.agent_status === "blocked")) return 0;
  if (panes.some((pane) => pane.agent_status === "working")) return 1;
  if (panes.some((pane) => pane.agent_status === "done")) return 2;
  return 3;
}
