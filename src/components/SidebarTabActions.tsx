import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Archive, ArchiveRestore, Copy, Ellipsis, Pencil, Pin, PinOff, Plus, X } from "lucide-react";
import type { HerdrPane, HerdrTab } from "../../shared/protocol.ts";
import type { AppActions } from "../lib/actions.ts";
import { useMachineApi, useMachineId } from "../lib/machineContext.tsx";
import { useFocusTrap } from "../lib/useFocusTrap.ts";
import { usePhoneSheetBack } from "../lib/sheetHistory.ts";
import { useSheetSwipe } from "../lib/sheets.ts";
import { tabPreferenceKey, updateTabPreference, useWorkspacePreferences } from "../lib/workspacePreferences.ts";
import { copyText } from "../lib/clipboard.ts";
import { useT } from "../lib/i18n.ts";
import { RowMenu } from "./RowMenu.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { ApiError } from "../lib/api.ts";
import { MutationOutcomeUnknown, withMutationDeadline } from "../lib/mutationDeadline.ts";
import { checkTabRename, type RenameCheck } from "../lib/renameCheck.ts";
import { chatReadDeadlineMs } from "../lib/chatReadDeadline.ts";
import "./SidebarTabActions.css";

export function SidebarTabActions({ tab, panes, name, workspaceName, lastTab, online, actions, renderRow }: { tab: HerdrTab; panes: readonly HerdrPane[]; name: string; workspaceName: string; lastTab: boolean; online: boolean; actions: AppActions; renderRow?: (handlers: { rename(): void; menu(anchor: HTMLElement): void }, action: ReactNode) => ReactNode }) {
  const t = useT();
  const machineId = useMachineId();
  const preferences = useWorkspacePreferences();
  const preferenceKey = tabPreferenceKey(machineId, tab.workspace_id, tab.tab_id, panes);
  const preference = preferences.tabs[preferenceKey];
  const [preferenceError, setPreferenceError] = useState<"storage" | "clipboard" | null>(null);
  const setPreference = (patch: { pinned?: boolean; settled?: boolean }) => setPreferenceError(updateTabPreference(preferenceKey, patch) ? null : "storage");
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [closing, setClosing] = useState(false);
  const closeMenu = useCallback(() => setAnchor(null), []);
  const workspaceId = tab.workspace_id;
  const actionButton = <button className="fm-tab-actions" type="button" aria-label={t("Actions for {tab}", { tab: name })} aria-haspopup="menu" aria-expanded={anchor !== null} disabled={!online} onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}><Ellipsis aria-hidden="true" /></button>;
  return <>
    {renderRow ? renderRow({ rename: () => { if (online) setRenaming(true); }, menu: (element) => { if (online) setAnchor(element); } }, actionButton) : actionButton}
    {preferenceError && <p className="sidebar-inline-error" role="alert">{preferenceError === "clipboard" ? t("Could not copy the link. Check clipboard access.") : t("Could not save on this device. Check browser storage.")}</p>}
    {anchor && <RowMenu anchor={anchor} title={name} subtitle={workspaceName} variant="actions" onClose={closeMenu} items={[
      { id: "rename", label: t("Rename tab"), icon: Pencil, run: () => setRenaming(true) },
      { id: "pin", label: preference?.pinned ? t("Unpin tab") : t("Pin tab"), icon: preference?.pinned ? PinOff : Pin, hint: t("On this device"), run: () => setPreference({ pinned: !preference?.pinned }) },
      { id: "settle", label: preference?.settled ? t("Move to active") : t("Move to settled"), icon: preference?.settled ? ArchiveRestore : Archive, hint: t("Keeps agents and terminals running"), run: () => setPreference({ settled: !preference?.settled }) },
      { id: "reference", label: t("Copy tab link"), icon: Copy, run: async () => { const url = new URL(location.href); url.search = new URLSearchParams({ machine: machineId, ws: workspaceId, pane: panes[0]?.pane_id ?? "", view: "chat" }).toString(); setPreferenceError(await copyText(url.href) ? null : "clipboard"); } },
      { id: "new", label: t("New tab"), icon: Plus, run: () => actions.openNewTab({ machineId, workspaceId: tab.workspace_id }) },
      { id: "close", label: t("Close tab"), icon: X, divider: true, danger: true, run: () => setClosing(true) },
    ]} />}
    {renaming && <RenameNativeTab tab={tab} panes={panes} name={name} onClose={() => setRenaming(false)} onSaved={() => { actions.refresh(); setRenaming(false); }} />}
    {closing && <TabCloseConfirmation name={name} workspaceName={workspaceName} lastTab={lastTab} onClose={() => setClosing(false)} onConfirm={async () => { await actions.closeTab(machineId, tab.tab_id); setClosing(false); }} />}
  </>;
}

export function TabCloseConfirmation({ name, workspaceName, lastTab, onClose, onConfirm }: {
  name: string; workspaceName: string; lastTab: boolean; onClose(): void; onConfirm(): Promise<void>;
}) {
  const t = useT();
  return <ConfirmDialog title={t("Close tab {name}?", { name })}
    body={lastTab
      ? t("It is the last tab of {workspace}: the workspace closes with it, and the agents and shells in it stop.", { workspace: workspaceName })
      : t("Closing this tab stops the shells and agents in it.")}
    confirmLabel={t("Close tab")} pendingLabel={t("Closing tab…")} onClose={onClose} onConfirm={onConfirm} />;
}

export function RenameNativeTab({ tab, panes, name, onClose, onSaved }: {
  tab: HerdrTab; panes: readonly HerdrPane[]; name: string; onClose(): void; onSaved(): void;
}) {
  const machineId = useMachineId();
  const api = useMachineApi();
  const tabId = tab.tab_id;
  const workspaceId = tab.workspace_id;
  const paneIdentity = panes.map(({ pane_id, terminal_id }) => ({ pane_id, terminal_id }));
  return <RenameTab key={`${machineId}:${workspaceId}:${tabId}`} name={name} onClose={onClose} onSaved={onSaved}
    onSave={async label => {
      try { await withMutationDeadline(signal => api.renameTab(tabId, label, signal), chatReadDeadlineMs(machineId)); }
      catch (reason) {
        if (reason instanceof ApiError && reason.status >= 400 && reason.status < 500 && reason.status !== 408) throw reason;
        throw new MutationOutcomeUnknown(reason);
      }
    }}
    onCheck={async label => checkTabRename(await api.fetchSession(), workspaceId, tabId, label, paneIdentity)} />;
}

function RenameTab({ name, onClose, onSave, onCheck, onSaved }: { name: string; onClose(): void; onSave(label: string): Promise<void>; onCheck(label: string): Promise<RenameCheck>; onSaved(): void }) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const surface = useFocusTrap<HTMLDivElement>(true, { initialFocus: input });
  const [label, setLabel] = useState(name);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const operations = useRef({ onSave, onCheck, onSaved });
  const expectedLabel = useRef("");
  const inFlight = useRef(false);
  const alive = useRef(true);
  useSheetSwipe(surface, pending ? null : onClose);
  usePhoneSheetBack(() => { if (pending) return false; onClose(); });
  useEffect(() => { alive.current = true; input.current?.select(); return () => { alive.current = false; }; }, []);
  useEffect(() => { if (pending) surface.current?.focus(); }, [pending]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.isComposing) { event.preventDefault(); event.stopPropagation(); if (!pending) onClose(); } };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [pending, onClose]);
  const save = async () => {
    if (inFlight.current || uncertain || !label.trim()) return;
    inFlight.current = true; setPending(true); setError(null);
    expectedLabel.current = label.trim();
    try { await operations.current.onSave(expectedLabel.current); if (alive.current) operations.current.onSaved(); }
    catch (reason) {
      if (!alive.current) return;
      if (reason instanceof MutationOutcomeUnknown) {
        setUncertain(true); setError(t("Rename result is unconfirmed. Check the current name before trying again."));
      } else setError(t("Rename failed: {reason}", { reason: reason instanceof Error ? reason.message : String(reason) }));
    } finally { inFlight.current = false; if (alive.current) setPending(false); }
  };
  const check = async () => {
    if (inFlight.current || !uncertain) return;
    inFlight.current = true; setPending(true);
    try {
      const result = await operations.current.onCheck(expectedLabel.current);
      if (!alive.current) return;
      if (result.state === "confirmed") operations.current.onSaved();
      else setError(result.state === "unavailable" ? t("The tab is unavailable or has moved. Close this dialog and refresh.") : t("Current name: {name}. Close this dialog to review before trying again.", { name: result.label }));
    } catch { if (alive.current) setError(t("Could not check the current name. Check your connection and try again.")); }
    finally { inFlight.current = false; if (alive.current) setPending(false); }
  };
  return createPortal(<div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) onClose(); }}>
    <div className="modal fm-rename-dialog" ref={surface} tabIndex={-1} role="dialog" aria-modal="true" aria-label={t("Rename tab")}>
      <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <header className="modal-header"><h2 className="modal-title">{t("Rename tab")}</h2></header>
        <div className="modal-body"><label className="field"><span className="field-label">{t("Tab name")}</span><input ref={input} className="input" value={label} maxLength={80} required disabled={pending || uncertain} onChange={(event) => setLabel(event.target.value)} /></label>{error && <p role="alert">{error}</p>}</div>
        <footer className="modal-footer"><button className="btn" type="button" disabled={pending} onClick={onClose}>{t("Cancel")}</button>{uncertain ? <button className="btn btn-primary" type="button" disabled={pending} onClick={() => void check()}>{t(pending ? "Checking current name…" : "Check current name")}</button> : <button className="btn btn-primary" type="submit" disabled={pending || !label.trim()}>{t("Save")}</button>}</footer>
      </form>
    </div>
  </div>, document.body);
}
