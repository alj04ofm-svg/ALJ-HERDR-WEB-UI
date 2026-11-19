import { displayPaneTitle } from "./Sidebar.tsx";
import { customTabLabel } from "../lib/tabName.ts";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "../lib/useFocusTrap.ts";
import { useSheetSwipe } from "../lib/sheets.ts";
import { useT } from "../lib/i18n.ts";
import { Activity, ArrowUpRight, CheckCheck, CircleAlert, Folder, Sparkles, X } from "lucide-react";
import { paneStorageId, type Machine } from "../../shared/machines.ts";
import { composerDrafts } from "../lib/composerDraft.ts";
import { MAX_COMPOSER_CHARS } from "../lib/compose.ts";
import type { HerdrPane } from "../../shared/protocol.ts";
import "./ActivityRail.css";

function quickDraft(): { target: string; prompt: string } {
  try { const value = JSON.parse(localStorage.getItem("herdr-web-ui:team-widget-draft") || "null"); return { target: typeof value?.target === "string" && value.target.length < 2000 ? value.target : "", prompt: typeof value?.prompt === "string" ? value.prompt.slice(0, MAX_COMPOSER_CHARS) : "" }; } catch { return { target: "", prompt: "" }; }
}
type Size = "compact" | "comfortable" | "expanded";
function preference(): { size: Size; hidden: boolean; minimized: boolean } {
  try { const value = JSON.parse(localStorage.getItem("herdr-web-ui:team-widget") || "null"); return { size: ["compact", "comfortable", "expanded"].includes(value?.size) ? value.size : "comfortable", hidden: value?.hidden === true, minimized: value?.minimized === true }; } catch { return { size: "comfortable", hidden: false, minimized: false }; }
}
/** A roster projection and explicit draft preparation. No native input or subscriptions. */
export function ActivityRail({ machines, open, onClose, onSelect }: { machines: Machine[]; open: boolean; onClose(): void; onSelect(machineId: string, paneId: string): void }) {
  const t = useT();
  const surface = useFocusTrap<HTMLElement>(open);
  useSheetSwipe(surface, open ? onClose : null);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [open, onClose]);
  const [prefs, setPrefs] = useState(preference), [target, setTarget] = useState(() => quickDraft().target), [prompt, setPrompt] = useState(() => quickDraft().prompt), [notice, setNotice] = useState("");
  useEffect(() => { try { localStorage.setItem("herdr-web-ui:team-widget-draft", JSON.stringify({ target, prompt })); } catch { /* Draft remains available for this visit. */ } }, [target, prompt]);
  const update = (patch: Partial<typeof prefs>) => { const next = { ...prefs, ...patch }; setPrefs(next); try { localStorage.setItem("herdr-web-ui:team-widget", JSON.stringify(next)); } catch { /* Usable for this visit when storage is unavailable. */ } };
  const rows = machines.filter(machine => machine.state === "connected").flatMap(machine => (machine.snapshot?.panes as HerdrPane[] ?? []).filter(pane => pane.agent).map(pane => {
    const tab = machine.snapshot?.tabs.find(item => item.tab_id === pane.tab_id);
    const index = machine.snapshot?.tabs.filter(item => item.workspace_id === pane.workspace_id).findIndex(item => item.tab_id === pane.tab_id) ?? 0;
    return { machine, pane, key: JSON.stringify([machine.id, pane.pane_id, pane.terminal_id, pane.agent_session]), title: (tab ? customTabLabel(tab, index + 1) : null) || displayPaneTitle(pane), workspace: machine.snapshot?.workspaces.find(item => item.workspace_id === pane.workspace_id)?.label || pane.workspace_id };
  })).sort((a, b) => (a.pane.agent_status === "blocked" ? 0 : a.pane.agent_status === "working" ? 1 : 2) - (b.pane.agent_status === "blocked" ? 0 : b.pane.agent_status === "working" ? 1 : 2));
  const active = rows.filter(row => row.pane.agent_status === "working" || row.pane.agent_status === "blocked" || row.pane.background_wait).length;
  // Visibility is a view choice for this visit. Retain legacy size/hidden/minimized preferences and all drafts.
  if (!open) return null;
  const prepare = () => {
    const row = rows.find(item => item.key === target);
    if (!row || !prompt.trim()) { setNotice("Choose a connected agent and write a prompt first."); return; }
    const key = `herdr-web-ui:composer-draft:${paneStorageId(row.machine.id, row.pane.pane_id)}`;
    composerDrafts.refresh(key);
    const draft = composerDrafts.read(key);
    if (draft.sending) { setNotice("This agent has a send in progress. Your quick prompt is retained here."); return; }
    const text = [draft.text, prompt.trim()].filter(Boolean).join("\n\n");
    if (text.length > MAX_COMPOSER_CHARS) { setNotice("The existing draft has no room for this prompt. Both are retained."); return; }
    composerDrafts.set(key, text); setPrompt(""); setNotice(`Draft prepared for ${row.title}. Review it in chat; nothing was sent.`); onSelect(row.machine.id, row.pane.pane_id);
  };
  return createPortal(<div className="modal-scrim team-scrim" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className={`activity-rail size-${prefs.size}`} aria-label={t("Team activity")}>
    <section className="activity-widget" id="team-widget" ref={surface} role="dialog" aria-modal="true" aria-labelledby="team-widget-title" tabIndex={-1}><header className="activity-widget-header"><div><h2 id="team-widget-title">{t("Team activity")}</h2><p>{active} working or waiting · {rows.length} connected</p></div><button className="icon-button" aria-label={t("Close team")} onClick={onClose}><X aria-hidden="true" /></button></header>
      <div className="activity-widget-sizes" role="group" aria-label="Team widget size">{(["compact", "comfortable", "expanded"] as const).map(size => <button key={size} aria-pressed={prefs.size === size} onClick={() => update({ size })}>{size === "comfortable" ? "Medium" : size === "expanded" ? "Large" : "Small"}</button>)}</div>
      <div className="activity-rail-list">{rows.map(row => { const blocked = row.pane.agent_status === "blocked", working = row.pane.agent_status === "working", waiting = row.pane.background_wait; return <article className={`activity-agent${blocked ? " needs-attention" : ""}`} key={row.key}><div className="activity-agent-state">{blocked ? <CircleAlert aria-hidden="true" /> : working ? <Activity aria-hidden="true" /> : <CheckCheck aria-hidden="true" />}<span>{blocked ? "Needs you" : waiting ? "Background work" : working ? "Working" : "Ready"}</span></div><button onClick={() => onSelect(row.machine.id, row.pane.pane_id)}><span>{row.title}</span><ArrowUpRight aria-hidden="true" /></button>{(row.pane.plan?.current || blocked) && <p>{row.pane.plan?.current || "Open to review the request."}</p>}{row.pane.plan && <div className="activity-agent-plan"><CheckCheck aria-hidden="true" /><span>{row.pane.plan.done} of {row.pane.plan.total} steps</span></div>}<footer><Folder aria-hidden="true" /><span>{row.workspace}</span><button aria-label={`Quick prompt ${row.title}`} onClick={() => { setTarget(row.key); setNotice(""); }}>Draft</button></footer></article>; })}{!rows.length && <p className="activity-rail-empty">Connected agents appear here.</p>}</div>
      <form className="activity-quick-prompt" onSubmit={event => { event.preventDefault(); prepare(); }}><label htmlFor="team-prompt-target">Draft for another agent</label><select id="team-prompt-target" value={target} onChange={event => setTarget(event.target.value)}><option value="">Choose an agent…</option>{rows.map(row => <option key={row.key} value={row.key}>{row.title} · {row.workspace}</option>)}</select><textarea aria-label="Quick prompt draft" placeholder="Write the next step…" maxLength={MAX_COMPOSER_CHARS} value={prompt} onChange={event => setPrompt(event.target.value)} rows={2} /><button className="btn btn-primary" disabled={!prompt.trim() || !rows.some(row => row.key === target)}><Sparkles aria-hidden="true" />Prepare draft</button><p role="status">{notice || "Adds to that agent’s draft for review."}</p></form>
    </section>
  </aside></div>, document.body);
}
