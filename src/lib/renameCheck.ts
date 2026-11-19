import type { HerdrPane, SessionSnapshot } from "../../shared/protocol.ts";

export type RenameCheck = { state: "confirmed" | "different"; label: string } | { state: "unavailable" };

/** Confirms current state only; it cannot attribute a missing mutation receipt. Never guesses a new target. */
export function checkTabRename(snapshot: Pick<SessionSnapshot, "tabs" | "workspaces" | "panes">, workspaceId: string, tabId: string, expectedLabel: string, originalPanes: readonly Pick<HerdrPane, "pane_id" | "terminal_id">[]): RenameCheck {
  const tabs = snapshot.tabs.filter((tab) => tab.tab_id === tabId);
  if (tabs.length !== 1 || tabs[0]!.workspace_id !== workspaceId ||
    snapshot.workspaces.filter((workspace) => workspace.workspace_id === workspaceId).length !== 1) return { state: "unavailable" };
  const panes = snapshot.panes.filter((pane) => pane.tab_id === tabId);
  if (!originalPanes.length || panes.length !== originalPanes.length ||
    new Set(originalPanes.map((pane) => pane.pane_id)).size !== originalPanes.length ||
    panes.some((pane) => pane.workspace_id !== workspaceId || pane.restore_error || !pane.terminal_id) ||
    originalPanes.some((original) => panes.filter((pane) => pane.pane_id === original.pane_id && pane.terminal_id === original.terminal_id).length !== 1)) return { state: "unavailable" };
  const label = tabs[0]!.label;
  return { state: label === expectedLabel ? "confirmed" : "different", label: label ?? "" };
}
