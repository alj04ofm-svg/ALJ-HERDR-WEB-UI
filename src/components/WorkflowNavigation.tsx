import { useState } from "react";
import { Archive, ArrowUpRight, ChevronDown, ChevronRight, Pin, CircleAlert } from "lucide-react";
import type { Machine } from "../../shared/machines.ts";
import { tabPreferenceKey, useWorkspacePreferences } from "../lib/workspacePreferences.ts";
import { tabLabel } from "../lib/tabName.ts";
import { useT } from "../lib/i18n.ts";
import { AgentMark } from "./AgentMark.tsx";
import "./WorkflowNavigation.css";

export function WorkflowNavigation({ machines, selectedMachineId, selectedPaneId, onSelect }: { machines: Machine[]; selectedMachineId: string; selectedPaneId: string | null; onSelect(machineId: string, paneId: string): void }) {
  const t = useT(), prefs = useWorkspacePreferences();
  const [open, setOpen] = useState<Record<string, boolean>>({ attention: true, pinned: true, settled: false });
  const rows = machines.filter(machine => machine.state === "connected").flatMap(machine => (machine.snapshot?.tabs ?? []).flatMap((tab, index) => {
    const panes = machine.snapshot?.panes.filter(pane => pane.tab_id === tab.tab_id && pane.workspace_id === tab.workspace_id) ?? [];
    if (!panes.length) return [];
    const focused = machine.snapshot?.layouts.find(layout => layout.tab_id === tab.tab_id)?.focused_pane_id;
    const target = panes.find(pane => pane.agent_status === "blocked") ?? panes.find(pane => pane.pane_id === focused) ?? panes[0]!;
    const preference = prefs.tabs[tabPreferenceKey(machine.id, tab.workspace_id, tab.tab_id, panes)];
    return [{ machine, tab, target, preference, name: tabLabel(tab, t, (machine.snapshot?.tabs.filter(candidate => candidate.workspace_id === tab.workspace_id).indexOf(tab) ?? 0) + 1), workspace: machine.snapshot?.workspaces.find(ws => ws.workspace_id === tab.workspace_id)?.label ?? tab.workspace_id }];
  }));
  return <nav className="workflow-navigation" aria-label={t("Your workspace")}>
    {([{ id: "attention", label: t("Needs you"), icon: CircleAlert, rows: rows.filter(row => row.target.agent_status === "blocked") }, { id: "pinned", label: t("Pinned"), icon: Pin, rows: rows.filter(row => row.preference?.pinned) }, { id: "settled", label: t("Settled"), icon: Archive, rows: rows.filter(row => row.preference?.settled) }] as const).map(section => {
      if (!section.rows.length) return null;
      const Icon = section.icon;
      return <section key={section.id} className={`workflow-section is-${section.id}`}>
        <button className="workflow-heading" type="button" aria-expanded={open[section.id]} onClick={() => setOpen(current => ({ ...current, [section.id]: !current[section.id] }))}><Icon aria-hidden="true" /><span>{section.label}</span><span className="workflow-count">{section.rows.length}</span>{open[section.id] ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}</button>
        {open[section.id] && <ul>{section.rows.map(row => <li key={`${row.machine.id}:${row.tab.tab_id}`}><button type="button" className="workflow-target" aria-current={row.machine.id === selectedMachineId && row.target.pane_id === selectedPaneId ? "page" : undefined} onClick={() => onSelect(row.machine.id, row.target.pane_id)}><AgentMark agent={row.target.agent ?? "shell"} size={16} /><span><strong>{row.name}</strong><small>{row.workspace} · {row.machine.name}</small></span><ArrowUpRight aria-hidden="true" /></button></li>)}</ul>}
      </section>;
    })}
  </nav>;
}
