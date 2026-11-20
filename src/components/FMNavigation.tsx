import { Suspense, lazy, useState, useCallback } from "react";
import { Grid2X2, LayoutDashboard, MessageCircle, Pin, Plus, Wrench, X } from "lucide-react";
import type { Machine } from "../../shared/machines.ts";
import { MachineContext } from "../lib/machineContext.tsx";
const WorkspaceOverview = lazy(() => import("./WorkspaceOverview.tsx").then(module => ({ default: module.WorkspaceOverview })));
const WorkspaceTools = lazy(() => import("./WorkspaceTools.tsx").then(module => ({ default: module.WorkspaceTools })));
const Communications = lazy(() => import("./Communications.tsx").then(module => ({ default: module.Communications })));
import { WorkspaceSync } from "./WorkspaceSync.tsx";
import { SidebarTabActions } from "./SidebarTabActions.tsx";
import { WorkflowNavigation } from "./WorkflowNavigation.tsx";
import { tabLabel } from "../lib/tabName.ts";
import type { AppActions } from "../lib/actions.ts";
import "./FMNavigation.css";
import { useT } from "../lib/i18n.ts";
import { RowMenu } from "./RowMenu.tsx";
import { createPortal } from "react-dom";
import { useFocusTrap } from "../lib/useFocusTrap.ts";
export function FMNavigation({ machines, selectedMachineId, selectedPaneId, actions, onSelect }: { machines: Machine[]; selectedMachineId: string; selectedPaneId: string | null; actions: AppActions; onSelect(machine: string, pane: string | null): void }) {
  const [surface, setSurface] = useState("");
  const [toolsAnchor, setToolsAnchor] = useState<HTMLElement | null>(null);
  const closeTools = useCallback(() => setToolsAnchor(null), []);
  const t = useT();
  const organizer = useFocusTrap<HTMLElement>(surface === "tabs");
  const [query, setQuery] = useState("");
  const select = (machine: string, pane: string) => { onSelect(machine, pane); setSurface(""); };
  return <><nav className="fm-navigation" aria-label={t("Workspace tools")}>
    <button type="button" onClick={actions.openNewSession}><Plus aria-hidden="true" /><span>{t("New workspace")}</span></button>
    <button type="button" aria-label={t("Tools")} aria-haspopup="menu" aria-expanded={toolsAnchor !== null} onClick={event => setToolsAnchor(toolsAnchor ? null : event.currentTarget)}><Wrench aria-hidden="true" /><span>{t("Tools")}</span></button>
  </nav>
    {toolsAnchor && <RowMenu anchor={toolsAnchor} align="start" title={t("Tools")} onClose={closeTools} items={[
      { id: "overview", label: t("Workspace overview"), icon: LayoutDashboard, run: () => setSurface("overview") },
      { id: "communications", label: t("Comms"), icon: MessageCircle, run: () => setSurface("communications") },
      { id: "tabs", label: t("Organize tabs"), icon: Pin, run: () => setSurface("tabs") },
      { id: "tools", label: t("Workspace tools"), icon: Grid2X2, run: () => setSurface("tools") },
    ]} />}

    <Suspense fallback={<p role="status">Loading workspace tools…</p>}>
    {surface === "overview" && <WorkspaceOverview machines={machines} onSelect={select} onClose={() => setSurface("")} />}
    {surface === "communications" && <Communications onClose={() => setSurface("")} />}
    {surface === "tools" && <WorkspaceTools paneId={selectedPaneId} onClose={() => setSurface("")} onOpened={pane => { actions.refresh(); select(selectedMachineId, pane); }} onAllActions={() => { setSurface(""); actions.openPalette(); }} />}
    {surface === "tabs" && createPortal(
      <div className="modal-scrim" onMouseDown={event => { if (event.target === event.currentTarget) setSurface(""); }}>
        <section className="modal fm-tab-organizer" ref={organizer} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="fm-organizer-title"
          onKeyDown={event => {
            if (event.key !== "Escape" || !event.currentTarget.contains(event.target as Node)) return;
            event.preventDefault();
            event.stopPropagation();
            setSurface("");
          }}>
          <header>
            <h2 className="modal-title" id="fm-organizer-title">{t("Organize tabs")}</h2>
            <button type="button" className="icon-button" aria-label={t("Close")} onClick={() => setSurface("")}><X /></button>
          </header>
          <input type="search" className="input" aria-label={t("Search workspaces and tabs")} placeholder={t("Search workspaces and tabs")} value={query} onChange={event => setQuery(event.target.value)} />
          <WorkflowNavigation machines={machines} selectedMachineId={selectedMachineId} selectedPaneId={selectedPaneId} onSelect={select} />
          <div className="fm-tab-list">
            {machines.map(machine => <MachineContext.Provider key={machine.id} value={machine.id}>
              {machine.snapshot?.workspaces.map(workspace => {
                const tabs = machine.snapshot?.tabs.filter(tab => tab.workspace_id === workspace.workspace_id) ?? [];
                return tabs.map((tab, index) => {
                  const panes = machine.snapshot?.panes.filter(pane => pane.tab_id === tab.tab_id) ?? [];
                  const name = tabLabel(tab, t, index + 1);
                  if (![name, workspace.label, machine.name].join(" ").toLowerCase().includes(query.toLowerCase())) return null;
                  return <SidebarTabActions key={tab.tab_id} tab={tab} panes={panes} name={name} workspaceName={workspace.label}
                    lastTab={tabs.length === 1} online={machine.state === "connected"} actions={actions}
                    renderRow={(handlers, action) => <div className="fm-organizer-row"
                      onContextMenu={event => {
                        event.preventDefault();
                        const anchor = event.currentTarget.querySelector<HTMLElement>(".fm-tab-actions");
                        if (anchor) handlers.menu(anchor);
                      }}>
                      <button type="button" className="fm-organizer-select" disabled={machine.state !== "connected" || !panes[0]}
                        onClick={() => { if (panes[0]) select(machine.id, panes[0].pane_id); }}
                        onKeyDown={event => {
                          if (event.key === "F2") {
                            event.preventDefault();
                            handlers.rename();
                          } else if (event.key === "ContextMenu" || event.shiftKey && event.key === "F10") {
                            event.preventDefault();
                            const anchor = event.currentTarget.parentElement?.querySelector<HTMLElement>(".fm-tab-actions");
                            if (anchor) handlers.menu(anchor);
                          }
                        }}>
                        <strong>{name}</strong>
                        <small>{workspace.label}{machines.length > 1 ? ` · ${machine.name}` : ""}</small>
                      </button>
                      {action}
                    </div>} />;
                });
              })}
            </MachineContext.Provider>)}
          </div>
          <WorkspaceSync />
        </section>
      </div>,
      document.body,
    )}
    </Suspense>
  </>;
}
