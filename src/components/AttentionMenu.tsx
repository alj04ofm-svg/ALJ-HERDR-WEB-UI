import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { CheckCircle2, CircleAlert, Inbox, TriangleAlert } from "lucide-react";
import { paneStorageId, type Machine } from "../../shared/machines.ts";
import { useT } from "../lib/i18n.ts";
import { composerDrafts } from "../lib/composerDraft.ts";
import { pendingMessages } from "../lib/pendingMessages.ts";
import { agentNavigationLabel, sidebarAgents } from "../lib/sidebarAgents.ts";
import { paneStatus } from "../lib/status.ts";
import { RowMenu, type RowMenuItem } from "./RowMenu.tsx";
import "./AttentionMenu.css";

export function AttentionMenu({ machines, canInteract, onSelect }: {
  machines: Machine[];
  canInteract: boolean;
  onSelect(machine: string, pane: string): void;
}) {
  const t = useT();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [seen, setSeen] = useState<ReadonlyMap<string, string>>(new Map());
  const issueRevision = useSyncExternalStore(composerDrafts.subscribe, composerDrafts.issueRevision);
  const queueRevision = useSyncExternalStore(pendingMessages.subscribe, pendingMessages.revision);
  useEffect(() => {
    const ready = new Set(machines.flatMap(machine => (machine.snapshot?.panes ?? [])
      .filter(pane => paneStatus(pane) === "done").map(pane => paneStorageId(machine.id, pane.pane_id))));
    setSeen(previous => {
      const current = new Map([...previous].filter(([owner]) => ready.has(owner)));
      return current.size === previous.size ? previous : current;
    });
  }, [machines]);
  const items = useMemo(() => {
    const ranks: RowMenuItem[][] = [[], [], []];
    for (const machine of machines) {
      if (!machine.snapshot) continue;
      for (const entry of sidebarAgents(machine.snapshot)) {
        const pane = entry.pane;
        const owner = paneStorageId(machine.id, pane.pane_id);
        const state = machine.state === "connected" ? paneStatus(pane) : null;
        const sendIssue = canInteract && composerDrafts.sendIssue(`herdr-web-ui:composer-draft:${owner}`);
        const review = canInteract && (sendIssue || pendingMessages.read(owner).some(row => row.state === "uncertain" || row.state === "held" || row.error));
        if (state !== "blocked" && state !== "done" && !review) continue;
        const completion = JSON.stringify([pane.terminal_id, entry.agent?.title ?? null]);
        const done = state === "done" && seen.get(owner) !== completion;
        if (state !== "blocked" && !review && !done) continue;
        const kind = state === "blocked" ? 0 : review ? 1 : 2;
        ranks[kind]!.push({
          id: owner,
          label: agentNavigationLabel(entry, machine.snapshot.tabs.filter(tab => tab.workspace_id === pane.workspace_id)),
          hint: [kind === 0 ? t("Needs input") : kind === 1 ? sendIssue ? t("Review interrupted send") : t("Review pending messages") : t("Ready to review"), entry.workspace.label, machine.name].join(" · "),
          icon: kind === 0 ? CircleAlert : kind === 1 ? TriangleAlert : CheckCircle2,
          run: () => {
            if (state === "done") setSeen(previous => new Map(previous).set(owner, completion));
            onSelect(machine.id, pane.pane_id);
          },
        });
      }
    }
    return ranks.flat();
    // The revision invalidates reads from the queue store for other panes too.
  }, [machines, canInteract, onSelect, queueRevision, issueRevision, seen, t]);
  const title = t("Needs attention");
  return <>
    <button type="button" className="icon-button header-attention" aria-haspopup="menu" aria-expanded={anchor !== null}
      title={title} aria-label={items.length ? `${title} (${items.length})` : title}
      onClick={event => setAnchor(anchor ? null : event.currentTarget)}>
      <Inbox aria-hidden="true" />{items.length > 0 && <span aria-hidden="true">{Math.min(items.length, 99)}</span>}
    </button>
    {anchor && <RowMenu anchor={anchor} title={title} variant="descriptions" items={items}
      header={<div className="attention-heading"><strong>{title}</strong>{items.length === 0 && <p>{t("No agents need attention right now.")}</p>}</div>}
      onClose={() => setAnchor(null)} />}
  </>;
}
