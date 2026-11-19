import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { Machine } from "../../shared/machines.ts";
import type { HerdrPane } from "../../shared/protocol.ts";
import { useT } from "../lib/i18n.ts";
import "./WorkingNow.css";

/** Uses the existing roster and status pushes. Never watches background transcripts. */
export function WorkingNow({ machines, onSelect }: { machines: Machine[]; onSelect(machineId: string, paneId: string): void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const rows = machines.filter((machine) => machine.state === "connected").flatMap((machine) => {
    // Older bridges have native PaneInfo only; enhanced fields are deliberately optional.
    const panes: HerdrPane[] = machine.snapshot?.panes ?? [];
    return panes.filter((pane) => pane.agent && (pane.agent_status === "working" || pane.agent_status === "blocked" || pane.background_wait)).map((pane) => {
      const tab = machine.snapshot?.tabs.find((item) => item.tab_id === pane.tab_id);
      const workspace = machine.snapshot?.workspaces.find((item) => item.workspace_id === pane.workspace_id);
      return { machine, pane, workspace, name: tab?.label || pane.label || pane.title || pane.display_agent || pane.agent || pane.pane_id };
    });
  });
  if (!rows.length) return null;
  const working = rows.filter(({ pane }) => pane.agent_status === "working" && !pane.background_wait).length;
  const blocked = rows.filter(({ pane }) => pane.agent_status === "blocked").length;
  const waiting = rows.filter(({ pane }) => pane.agent_status !== "blocked" && pane.background_wait).length;
  return <section className="working-now" aria-label={t("Workspace activity")}>
    <button className="working-now-toggle" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
      {open ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}<span>{t("Workspace activity")}</span>
      <span className="working-now-count">{[working > 0 ? t("{n} working", { n: working }) : null, blocked > 0 ? t("Needs you · {n}", { n: blocked }) : null, waiting > 0 ? t("{n} waiting", { n: waiting }) : null].filter(Boolean).join(" · ")}</span>
    </button>
    {open && <ul>{rows.map(({ machine, pane, workspace, name }) => <li key={`${machine.id}:${pane.pane_id}`}>
      <button type="button" onClick={() => onSelect(machine.id, pane.pane_id)}>
        <span className="working-now-name">{name}<small>{workspace?.label ? `${workspace.label} · ` : ""}{machine.name}</small></span>
        <span className={pane.agent_status === "blocked" ? "working-now-waiting" : ""}>
          {pane.agent_status === "blocked" ? t("Needs you") : pane.background_wait ? t("Waiting for background work") : pane.plan?.current || t("Working…")}
          {pane.plan && <small>{t("{done} of {total} plan steps recorded complete", { done: pane.plan.done, total: pane.plan.total })}</small>}
        </span>
      </button>
    </li>)}</ul>}
  </section>;
}
