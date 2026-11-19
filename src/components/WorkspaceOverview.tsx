import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, Check, CircleAlert, Clipboard, LayoutDashboard, Plus, Search, Trash2, X } from "lucide-react";
import type { Machine } from "../../shared/machines.ts";
import { useT } from "../lib/i18n.ts";
import { tabLabel } from "../lib/tabName.ts";
import { paneStatus, STATUS_WORD } from "../lib/status.ts";
import { machineDisplayName } from "../lib/workspaceBrand.ts";
import { CAPTURE_LIMIT, CAPTURE_STORAGE_KEY, readCaptures, writeCaptures, type CaptureState, type Capture } from "../lib/quickCapture.ts";
import { copyText } from "../lib/clipboard.ts";
import { useFocusTrap } from "../lib/useFocusTrap.ts";
import { usePhoneSheetBack } from "../lib/sheetHistory.ts";
import { useSheetSwipe } from "../lib/sheets.ts";
import { AgentMark } from "./AgentMark.tsx";
import "./WorkspaceOverview.css";

export function WorkspaceOverview({ machines, onSelect, onClose }: { machines: Machine[]; onSelect(machineId: string, paneId: string): void; onClose(): void }) {
  const t = useT(), surface = useFocusTrap<HTMLDivElement>(true);
  const latest = useRef(machines); latest.current = machines;
  const [query, setQuery] = useState(""), [filter, setFilter] = useState("all");
  const [copyError, setCopyError] = useState(false);
  const [error, setError] = useState(false), [notice, setNotice] = useState(false), [text, setText] = useState("");
  const [capture, setCapture] = useState<CaptureState>(() => { try { return readCaptures(); } catch { return { revision: "", items: [] }; } });
  const [captureError, setCaptureError] = useState(() => { try { readCaptures(); return false; } catch { return true; } });
  usePhoneSheetBack(onClose); useSheetSwipe(surface, onClose);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.isComposing) { event.preventDefault(); event.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", escape, true); return () => window.removeEventListener("keydown", escape, true);
  }, [onClose]);
  useEffect(() => {
    const refresh = (event: StorageEvent) => { if (event.key !== null && event.key !== CAPTURE_STORAGE_KEY) return; try { setCapture(readCaptures()); setCaptureError(false); } catch { setCaptureError(true); } };
    window.addEventListener("storage", refresh); return () => window.removeEventListener("storage", refresh);
  }, []);
  const rows = machines.filter(machine => machine.state === "connected").flatMap(machine => (machine.snapshot?.panes ?? []).filter(pane => pane.agent).map(pane => {
    const tab = machine.snapshot?.tabs.find(item => item.tab_id === pane.tab_id && item.workspace_id === pane.workspace_id);
    const workspace = machine.snapshot?.workspaces.find(item => item.workspace_id === pane.workspace_id);
    const name = tab ? tabLabel(tab, t, (machine.snapshot?.tabs.filter(item => item.workspace_id === pane.workspace_id).indexOf(tab) ?? 0) + 1) : pane.pane_id;
    return { machine, pane, name, workspace: workspace?.label ?? pane.workspace_id, status: paneStatus(pane) };
  }));
  const attention = rows.filter(row => row.status === "blocked").length, working = rows.filter(row => row.status === "working").length;
  const q = query.trim().toLocaleLowerCase();
  const visible = rows.filter(row => (filter === "all" || row.status === filter) && (!q || [row.name, row.workspace, row.machine.name, row.pane.agent, row.pane.pane_id].join(" ").toLocaleLowerCase().includes(q)));
  const save = (items: Capture[]) => { try { setCapture(writeCaptures(capture.revision, items)); setCaptureError(false); setNotice(false); return true; } catch { setCaptureError(true); return false; } };
  const reload = () => { try { setCapture(readCaptures()); setCaptureError(false); } catch { setCaptureError(true); } };
  return createPortal(<div className="modal-scrim overview-scrim" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal workspace-overview" role="dialog" aria-modal="true" aria-labelledby="workspace-overview-title" ref={surface} tabIndex={-1}>
      <header className="overview-header"><div><LayoutDashboard aria-hidden="true" /><h2 id="workspace-overview-title">{t("Workspace overview")}</h2><p>{t("Your work, at a glance.")}</p></div><button className="icon-button" type="button" aria-label={t("Close")} onClick={onClose}><X aria-hidden="true" /></button></header>
      <div className="overview-body"><section className="overview-agents" aria-label={t("Agents")}>
        <div className="overview-summary" role="status"><span><i className="overview-live-dot" aria-hidden="true" />{t("{count} connected PCs", { count: machines.filter(machine => machine.state === "connected").length })}</span><span>{t("{count} agents", { count: rows.length })}</span></div>
        <div className="overview-filters" aria-label={t("Filter agents")}><button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>{t("All agents")}<span>{rows.length}</span></button><button type="button" aria-pressed={filter === "blocked"} onClick={() => setFilter("blocked")}><CircleAlert aria-hidden="true" />{t("Needs you")}<span>{attention}</span></button><button type="button" aria-pressed={filter === "working"} onClick={() => setFilter("working")}>{t("Working")}<span>{working}</span></button></div>
        <label className="overview-search"><Search aria-hidden="true" /><input type="search" value={query} onChange={event => setQuery(event.target.value)} aria-label={t("Find an agent or workspace")} placeholder={t("Find an agent or workspace")} /></label>
        {error && <p role="alert">{t("This agent changed or disconnected. Choose its current entry.")}</p>}
        <ul className="overview-roster">{visible.map(row => <li key={JSON.stringify([row.machine.id, row.pane.pane_id, row.pane.terminal_id])}><button type="button" onClick={() => {
          const current = latest.current.find(machine => machine.id === row.machine.id && machine.state === "connected");
          const matches = current?.snapshot?.panes.filter(pane => pane.pane_id === row.pane.pane_id && pane.terminal_id === row.pane.terminal_id && pane.tab_id === row.pane.tab_id && pane.workspace_id === row.pane.workspace_id) ?? [];
          if (matches.length !== 1) { setError(true); return; } onSelect(row.machine.id, row.pane.pane_id); onClose();
        }}><AgentMark agent={row.pane.agent!} size={20} /><span className="overview-row-label"><strong>{row.name}</strong><small>{row.workspace} · {machineDisplayName(row.machine)}</small></span><span className={`overview-state is-${row.status}`}>{t(STATUS_WORD[row.status])}</span><ArrowUpRight aria-hidden="true" /></button></li>)}</ul>
        {!visible.length && <p className="overview-empty" role="status">{filter === "blocked" && !q ? t("Nothing needs your input right now.") : t("No matching agents in the connected roster.")}</p>}
      </section><section className="overview-capture" aria-labelledby="quick-capture-title"><header><h3 id="quick-capture-title">{t("Quick capture")}</h3><span>{t("On this device")}</span></header><p>{t("Keep a thought or next step. Nothing is sent to an agent.")}</p>
        <form onSubmit={event => { event.preventDefault(); if (text.trim() && capture.items.length < CAPTURE_LIMIT && save([...capture.items, { id: crypto.randomUUID(), text: text.trim(), done: false }])) setText(""); }}><textarea className="input" aria-label={t("Capture a thought")} placeholder={t("Capture a thought")} value={text} maxLength={2000} rows={3} onChange={event => setText(event.target.value)} /><button className="btn" type="submit" disabled={!text.trim() || capture.items.length >= CAPTURE_LIMIT || captureError}><Plus aria-hidden="true" />{t("Add note")}</button><span>{capture.items.length}/{CAPTURE_LIMIT}</span></form>
        {captureError && <div role="alert"><p>{t("Notes could not be saved or changed in another tab. Your text is still here. Reload notes before editing.")}</p><button type="button" className="btn" onClick={reload}>{t("Reload notes")}</button></div>}
        <ul className="capture-list">{capture.items.map(item => <li key={item.id} className={item.done ? "is-done" : undefined}><button className="capture-check" type="button" aria-pressed={item.done} aria-label={item.done ? t("Mark note incomplete") : t("Mark note complete")} disabled={captureError} onClick={() => save(capture.items.map(note => note.id === item.id ? { ...note, done: !note.done } : note))}><Check aria-hidden="true" /></button><p>{item.text}</p><div><button type="button" className="icon-button" aria-label={t("Copy note")} onClick={() => { void copyText(item.text).then(ok => { setNotice(ok); setCopyError(!ok); }).catch(() => setCopyError(true)); }}><Clipboard aria-hidden="true" /></button><button type="button" className="icon-button" aria-label={t("Delete note")} disabled={captureError} onClick={() => save(capture.items.filter(note => note.id !== item.id))}><Trash2 aria-hidden="true" /></button></div></li>)}</ul>
        {!capture.items.length && <p className="overview-empty">{t("A clear space for your next idea.")}</p>}{copyError && <p role="alert">{t("Could not copy the note. Check clipboard access.")}</p>}{notice && <p role="status">{t("Copied")}</p>}
      </section></div>
    </div></div>, document.body);
}
