import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, KeyboardEvent, MouseEvent } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, FolderPlus, MoreHorizontal, Pencil, Undo2, Check, ChevronDown, ChevronRight, CircleAlert, Clock, Folder, Grid2X2, LoaderCircle, Search, Star, Terminal, WifiOff, X } from "lucide-react";

import type { Machine } from "../../shared/machines.ts";
import { paneStorageId } from "../../shared/machines.ts";
import type { AgentStatus } from "../../shared/protocol.ts";
import { useT } from "../lib/i18n.ts";
import { tabLabel } from "../lib/tabName.ts";
import { MachineContext } from "../lib/machineContext.tsx";
import type { AppActions } from "../lib/actions.ts";
import { agentContext, agentNavigationLabel, agentTabName, groupRows, paneMark, sidebarAgents, type SidebarAgent } from "../lib/sidebarAgents.ts";
import { tabPreferenceKey, updateTabPreference, useWorkspacePreferences } from "../lib/workspacePreferences.ts";
import { knownStatus, paneStatus } from "../lib/status.ts";
import { sidebarMatches } from "../lib/sidebarSearch.ts";
import { useSettings } from "../lib/settings.ts";
import { useSidebarActivity } from "../lib/sidebarActivity.tsx";
import { activityOrder } from "../lib/sidebarOrder.ts";
import { loadSidebarPins, pruneSidebarPins, saveSidebarPins, sidebarPinKey, splitPinnedRows, toggleSidebarPin } from "../lib/sidebarPins.ts";
import { moveSidebarGroup, moveSidebarRow, orderSidebarRows, removeSidebarGroup, saveSidebarLayout, sidebarRowKey, useSidebarLayout, type SidebarLayout } from "../lib/sidebarLayout.ts";
import { RowMenu, type RowMenuItem } from "./RowMenu.tsx";
import { RenameNativeTab, TabCloseConfirmation } from "./SidebarTabActions.tsx";
import { AgentMark, hasAgentMark } from "./AgentMark.tsx";
import { WorkingRing } from "./WorkingRing.tsx";
import { displayPaneTitle } from "./Sidebar.tsx";
import "./AgentSidebar.css";

interface AgentRowBodyProps {
  /** the agent's kind or name; null draws a terminal, for a shell */
  mark: string | null;
  /** the kind the mark draws, left off the second line: said for a screen reader, since the mark is aria-hidden */
  markKind: string | null;
  title: string;
  online: boolean;
  status?: AgentStatus;
}

/**
 * One agent in a list: the coding agent's mark, what it is working on, who and where it is, and
 * how it is doing.
 */
function AgentRowBody({ mark, markKind, title, online, status }: AgentRowBodyProps) {
  const t = useT();
  const state = online ? knownStatus(status) : "unknown";
  const statusLabel = !online ? t("Disconnected") : {
    working: t("Working"), blocked: t("Needs input"), waiting: t("Waiting"),
    done: t("Finished"), idle: t("Ready"), unknown: "—",
  }[state];
  return <>
    <span className="sidebar-mark" aria-hidden="true">{mark !== null ? <AgentMark agent={mark} size={18} /> : <Terminal />}</span>
    <span className="agent-copy">
      {markKind && <span className="visually-hidden">{markKind}: </span>}
      <span className="agent-title">{title}</span>
    </span>
    <span className="agent-state" data-status={state} data-online={online} role="status" aria-label={statusLabel} title={state === "waiting" ? t("Waiting for background work") : statusLabel}>
      {!online ? <WifiOff aria-hidden="true" /> : state === "working" ? <LoaderCircle aria-hidden="true" /> : state === "blocked" ? <CircleAlert aria-hidden="true" /> : state === "waiting" ? <Clock aria-hidden="true" /> : state === "done" ? <Check aria-hidden="true" /> : null}
      <span className="visually-hidden">{statusLabel}</span>
    </span>

  </>;
}

export interface AgentSidebarProps {
  machines: Machine[];
  selectedMachineId: string;
  selectedPaneId: string | null;
  /** a PC's state in words, for the tooltip of a row whose PC is not connected */
  stateWord(machine: Machine): string;
  onSelect(machineId: string, paneId: string): void;
  onShowTabs(machineId: string, paneId: string): void;
  actions: Pick<AppActions, "closeTab" | "refresh">;
}

/** Settings → Pin agents off: saved pins stay stored, and none of them leads the list */
const NO_PINS: readonly string[] = [];

interface AgentRow { machine: Machine; entry: SidebarAgent }
const rowKey = ({ machine, entry }: AgentRow) => sidebarRowKey(machine.id, entry.pane.pane_id, entry.pane.terminal_id);
type OrganizeTarget = { kind: "row" | "group"; id: string };
type OrganizeMenu = OrganizeTarget & { anchor: HTMLElement; page?: "move" | "pair" };
type DropTarget = { kind: "row"; id: string; groupId: string | null; position: "before" | "after" | "group" } | { kind: "group"; id: string; after: boolean } | { kind: "bucket"; id: string | null };


/**
 * All PCs' live agents form a second list; workspace and PC folds do not hide these rows.
 * Custom groups, labels and order belong to this browser, never the native pane/session.
 * The pinned agents stand first. With Settings → Workspace cards on, herdr's order puts each
 * workspace's agents on a PC in a card under its name, a pinned agent first in its own card and
 * the cards that hold pins first; off (the default), or in Activity order, which mixes
 * workspaces, the rows stand alone.
 */
export function AgentSidebar({ machines, selectedMachineId, selectedPaneId, stateWord, onSelect, onShowTabs, actions }: AgentSidebarProps) {
  const t = useT();
  const listId = useId();
  const [collapsed, setCollapsed] = useState(false);
  const { settings } = useSettings();
  const preferences = useWorkspacePreferences();
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchTrigger = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (searchOpen && !collapsed) searchInput.current?.focus();
  }, [searchOpen, collapsed]);
  const closeSearch = () => {
    setQuery("");
    setSearchOpen(false);
    searchTrigger.current?.focus();
  };
  const [pinned, setPinned] = useState(loadSidebarPins);
  const activity = useSidebarActivity();
  const layout = useSidebarLayout();
  const [menu, setMenu] = useState<OrganizeMenu | null>(null);
  const [tabDialog, setTabDialog] = useState<{ kind: "rename" | "close"; row: string } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const [editing, setEditing] = useState<{ kind: "new" | "row" | "group"; id: string; value: string } | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [dragging, setDragging] = useState<OrganizeTarget | null>(null);
  const dragRef = useRef<OrganizeTarget | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const refocusRow = useRef<string | null>(null);
  const editReturn = useRef<HTMLElement | null>(null);
  useEffect(() => { if (editing) { const frame = requestAnimationFrame(() => { nameInput.current?.focus(); nameInput.current?.select(); }); return () => cancelAnimationFrame(frame); } }, [editing?.kind, editing?.id]);
  const commit = (next: SidebarLayout): boolean => {
    if (!saveSidebarLayout(next)) { setError(t("Could not save sidebar changes. Allow browser storage and try again.")); return false; }
    setError(""); setAnnouncement(t("Sidebar saved in this browser.")); return true;
  };
  // Settings → Agents order: herdr's order, or Activity within each PC (each herdr counts its own changes)
  const byActivity = settings.agentOrder === "activity";
  const rows = useMemo(() => machines.flatMap((machine) => {
    const agents = sidebarAgents(machine.snapshot);
    return (byActivity ? activityOrder(agents, (entry) => entry.pane, activity.seqs(machine.id)) : agents).map((entry): AgentRow => ({ machine, entry }));
  }), [machines, byActivity, activity]);
  const dialogRow = tabDialog ? rows.find(row => rowKey(row) === tabDialog.row) : undefined;
  const dialogTab = dialogRow?.entry.tab;
  const dialogTabs = dialogRow?.machine.snapshot?.tabs.filter(tab => tab.workspace_id === dialogTab?.workspace_id) ?? [];
  const dialogName = dialogTab ? tabLabel(dialogTab, t, dialogTabs.findIndex(tab => tab.tab_id === dialogTab.tab_id) + 1 || dialogTab.number) : "";
  const closeTabDialog = () => setTabDialog(null);
  useEffect(() => {
    if (tabDialog && !dialogTab) setTabDialog(null);
  }, [tabDialog, dialogTab]);
  // pins lead: alone, the pinned rows stand first; in cards, each stays in its own card, first there,
  // and a card that holds one comes before the cards that hold none
  const tabPinKey = ({ machine, entry }: AgentRow): string => tabPreferenceKey(machine.id, entry.workspace.workspace_id, entry.pane.tab_id,
    machine.snapshot?.panes.filter(pane => pane.tab_id === entry.pane.tab_id && pane.workspace_id === entry.workspace.workspace_id) ?? []);
  const tabPins = rows.filter(row => preferences.tabs[tabPinKey(row)]?.pinned).map(({ machine, entry }) => sidebarPinKey(machine.id, entry.pane.pane_id));
  // Both existing pin systems project into this one roster. Stored preferences stay untouched.
  const pinKeys = [...new Set([...(settings.agentPins ? pinned : NO_PINS), ...tabPins])];
  const split = splitPinnedRows(rows, pinKeys, ({ machine, entry }) => sidebarPinKey(machine.id, entry.pane.pane_id));
  useEffect(() => {
    const live = new Set(rows.map(({ machine, entry }) => sidebarPinKey(machine.id, entry.pane.pane_id)));
    const next = pruneSidebarPins(pinned, live, machines);
    if (next.length !== pinned.length) { setPinned(next); saveSidebarPins(next); }
  }, [machines, rows, pinned]);
  // a pin moves the row, and maybe its card, so React may draw a new star: a star that had the
  // keyboard focus hands it to its successor
  const sectionRef = useRef<HTMLElement>(null);
  const refocusPin = useRef<string | null>(null);
  useLayoutEffect(() => {
    const key = refocusPin.current;
    if (key === null) return;
    refocusPin.current = null;
    sectionRef.current?.querySelector<HTMLButtonElement>(`.agent-pin-toggle[data-pin-key="${CSS.escape(key)}"]`)?.focus();
  }, [pinned]);
  const setPin = (key: string, star: HTMLButtonElement): void => {
    if (document.activeElement === star) refocusPin.current = key;
    const row = rows.find(({ machine, entry }) => sidebarPinKey(machine.id, entry.pane.pane_id) === key);
    const tabPinned = row && preferences.tabs[tabPinKey(row)]?.pinned;
    if (tabPinned && !updateTabPreference(tabPinKey(row), { pinned: false })) return;
    const next = tabPinned ? pinned.filter(value => value !== key) : toggleSidebarPin(pinned, key);
    setPinned(next);
    saveSidebarPins(next);
  };
  const ordered = orderSidebarRows([...split.pinned, ...split.rest], layout, rowKey);
  const liveOrder = ordered.map(rowKey);
  const titleOf = (row: AgentRow) => layout.labels[rowKey(row)] ?? agentNavigationLabel(row.entry, row.machine.snapshot?.tabs.filter(tab => tab.workspace_id === row.entry.workspace.workspace_id) ?? []);
  const matches = (row: AgentRow) => { const { machine, entry } = row; return sidebarMatches(query,
    titleOf(row), layout.groups.find(group => group.id === layout.membership[rowKey(row)])?.name ?? "",
    entry.pane.label ?? "", entry.tab?.label ?? "", entry.agent?.name ?? "", entry.agentLabel ?? "",
    displayPaneTitle(entry.pane), entry.pane.title ?? "", entry.agent?.title ?? "", entry.pane.pane_id, entry.pane.cwd ?? "", entry.workspace.label, machine.name); };
  const [idleSince, setIdleSince] = useState<Record<string, number>>({});
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(tick);
  }, []);
  useEffect(() => {
    const idle = split.rest.filter(({ machine, entry }) =>
      machine.state === "connected" && (machine.id !== selectedMachineId || entry.pane.pane_id !== selectedPaneId)
      && paneStatus(entry.pane) === "idle" && !entry.pane.background_tasks);
    const observed = Date.now();
    setIdleSince(previous => {
      const next = Object.fromEntries(idle.map(row => [rowKey(row), previous[rowKey(row)] ?? observed]));
      return idle.length === Object.keys(previous).length && idle.every(row => rowKey(row) in previous) ? previous : next;
    });
  }, [rows, pinned, preferences.tabs, settings.agentPins, selectedMachineId, selectedPaneId]);
  const isLongIdle = (row: AgentRow) => {
    const since = idleSince[rowKey(row)];
    return since !== undefined && paneStatus(row.entry.pane) === "idle" && !row.entry.pane.background_tasks
      && row.machine.state === "connected" && (row.machine.id !== selectedMachineId || row.entry.pane.pane_id !== selectedPaneId)
      && now - since >= 30 * 60_000;
  };
  const visiblePinned = split.pinned.filter(matches);
  const visibleIdle = split.rest.filter(row => isLongIdle(row) && matches(row));
  const visibleIdleKeys = new Set(visibleIdle.map(rowKey));
  const visibleOrdered = ordered.filter(row => matches(row) && !visibleIdleKeys.has(rowKey(row)));
  const custom = layout.groups.length > 0 || layout.order.length > 0;
  const visibleRest = split.rest.filter(row => matches(row) && !visibleIdleKeys.has(rowKey(row)));
  const visibleCount = visiblePinned.length + visibleRest.length + visibleIdle.length;
  const carded = settings.agentCards && !byActivity;
  const groups = !carded ? null : groupRows([...visiblePinned, ...visibleRest], ({ machine, entry }) => JSON.stringify([machine.id, entry.workspace.workspace_id]));
  // herdr names a PC only beside another: the rows' line, and a card's head, do the same
  const machineName = (machine: Machine): string | null => machines.length > 1 ? machine.name : null;

  const moveRow = (id: string, groupId: string | null, target?: { key: string; after: boolean }) => {
    const next = moveSidebarRow(layout, liveOrder, id, groupId, target);
    if (next === layout) return;
    // A successful move reveals its destination; no pane selection or native mutation occurs.
    if (groupId) next.groups = next.groups.map(group => group.id === groupId ? { ...group, collapsed: false } : group);
    commit(next);
  };
  const pairRows = (id: string, targetId: string) => {
    if (id === targetId) return;
    const source = rows.find(row => rowKey(row) === id);
    const target = rows.find(row => rowKey(row) === targetId);
    if (!source || !target) return;
    const existing = layout.membership[targetId];
    if (existing) { moveRow(id, existing, { key: targetId, after: true }); return; }
    if (layout.groups.length >= 100) { setError(t("The sidebar supports up to 100 groups.")); return; }
    const sameWorkspace = source.machine.id === target.machine.id && source.entry.workspace.workspace_id === target.entry.workspace.workspace_id;
    const name = (sameWorkspace ? target.entry.workspace.label : titleOf(target)).trim().slice(0, 100)
      || t("New group");
    const groupId = crypto.randomUUID();
    const grouped = { ...layout, groups: [...layout.groups, { id: groupId, name, collapsed: false }] };
    const withTarget = moveSidebarRow(grouped, liveOrder, targetId, groupId);
    refocusRow.current = id;
    commit(moveSidebarRow(withTarget, liveOrder, id, groupId, { key: targetId, after: true }));
  };
  const stepRow = (id: string, direction: -1 | 1) => {
    const groupId = layout.membership[id] ?? null;
    const peers = ordered.filter(row => (layout.membership[rowKey(row)] ?? null) === groupId);
    const index = peers.findIndex(row => rowKey(row) === id);
    const target = peers[index + direction];
    if (target) { refocusRow.current = id; moveRow(id, groupId, { key: rowKey(target), after: direction === 1 }); }
  };
  useLayoutEffect(() => {
    const key = refocusRow.current;
    if (!key) return;
    refocusRow.current = null;
    sectionRef.current?.querySelector<HTMLButtonElement>(`.agent-organize[data-row-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
  }, [layout]);
  const beginEdit = (target: OrganizeTarget | { kind: "new"; id: string }) => {
    closeMenu();
    editReturn.current = menu?.anchor ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const row = rows.find(row => rowKey(row) === target.id);
    if (target.kind === "row" && !row) return;
    setEditing({ ...target, value: target.kind === "new" ? "" : target.kind === "group" ? layout.groups.find(group => group.id === target.id)?.name ?? "" : titleOf(row!) });
  };
  const closeEditor = () => {
    setEditing(null);
    requestAnimationFrame(() => { if (editReturn.current?.isConnected) editReturn.current.focus({ preventScroll: true }); else sectionRef.current?.querySelector<HTMLButtonElement>(".agent-new-group")?.focus({ preventScroll: true }); });
  };
  const saveName = () => {
    if (!editing?.value.trim()) return;
    const name = editing.value.trim();
    let next = layout;
    if (editing.kind === "new") {
      if (layout.groups.length >= 100) { setError(t("The sidebar supports up to 100 groups.")); return; }
      const id = crypto.randomUUID();
      next = { ...layout, groups: [...layout.groups, { id, name, collapsed: false }] };
      if (editing.id) next = moveSidebarRow(next, liveOrder, editing.id, id);
    } else if (editing.kind === "group") next = { ...layout, groups: layout.groups.map(group => group.id === editing.id ? { ...group, name } : group) };
    else next = { ...layout, labels: { ...layout.labels, [editing.id]: name } };
    if (commit(next)) closeEditor();
  };
  const openMenu = (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>, target: OrganizeTarget) => {
    event.preventDefault(); event.stopPropagation();
    const anchor = event.currentTarget.querySelector<HTMLElement>(target.kind === "row" ? ".agent-organize" : ".agent-group-menu") ?? event.currentTarget;
    setMenu(current => event.type === "click" && current?.anchor === anchor ? null : { ...target, anchor });
  };
  const localKey = (event: KeyboardEvent<HTMLElement>, target: OrganizeTarget) => {
    if (event.key === "F2") { event.preventDefault(); event.stopPropagation(); beginEdit(target); }
    else if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) openMenu(event, target);
    else if (target.kind === "row" && event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault(); event.stopPropagation(); stepRow(target.id, event.key === "ArrowUp" ? -1 : 1);
    }
  };
  const startDrag = (event: DragEvent<HTMLElement>, target: OrganizeTarget) => {
    event.stopPropagation(); closeMenu();
    dragRef.current = target; setDragging(target);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-herdr-sidebar", JSON.stringify(target));
  };
  const endDrag = () => { dragRef.current = null; setDragging(null); setDrop(null); };
  const over = (event: DragEvent<HTMLElement>, target: DropTarget) => {
    if (!dragRef.current || (dragRef.current.kind === "group" && target.kind !== "group")) return;
    if (target.kind === "row" && target.id === dragRef.current.id) { setDrop(null); return; }
    event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move"; setDrop(target);
  };
  const finishDrop = (event: DragEvent<HTMLElement>, target: DropTarget) => {
    const source = dragRef.current;
    if (!source) return;
    event.preventDefault(); event.stopPropagation();
    if (source.kind === "row") {
      const groupId = target.kind === "row" ? target.groupId : target.id;
      if (target.kind === "row" && target.position === "group") pairRows(source.id, target.id);
      else moveRow(source.id, groupId, target.kind === "row" ? { key: target.id, after: target.position === "after" } : undefined);
    } else if (target.kind === "group") commit(moveSidebarGroup(layout, source.id, target.id, target.after));
    endDrag();
  };
  const groupStep = (id: string, direction: -1 | 1) => {
    const index = layout.groups.findIndex(group => group.id === id);
    const target = layout.groups[index + direction];
    if (target) commit(moveSidebarGroup(layout, id, target.id, direction === 1));
  };
  const menuItems = (): RowMenuItem[] => {
    if (!menu) return [];
    if (menu.kind === "group") {
      const index = layout.groups.findIndex(group => group.id === menu.id);
      return [
        { id: "rename", label: t("Rename group"), icon: Pencil, run: () => beginEdit(menu) },
        ...(index > 0 ? [{ id: "up", label: t("Move up"), icon: ArrowUp, run: () => groupStep(menu.id, -1) }] : []),
        ...(index < layout.groups.length - 1 ? [{ id: "down", label: t("Move down"), icon: ArrowDown, run: () => groupStep(menu.id, 1) }] : []),
        { id: "remove", label: t("Remove group"), hint: t("Keep its agents ungrouped"), icon: Undo2, divider: true, run: () => commit(removeSidebarGroup(layout, menu.id)) },
      ];
    }
    const groupId = layout.membership[menu.id] ?? null;
    const back: RowMenuItem = { id: "back", label: t("Back to actions"), icon: ArrowLeft, run: () => setMenu({ ...menu, page: undefined }) };
    if (menu.page === "pair") return [
      back,
      ...ordered.filter(row => rowKey(row) !== menu.id).map(row => ({
        id: rowKey(row), label: titleOf(row), hint: row.entry.workspace.label, icon: Folder, run: () => pairRows(menu.id, rowKey(row)),
      })),
    ];
    if (menu.page === "move") return [
      back,
      ...layout.groups.map(group => ({ id: group.id, label: group.name, icon: Folder, current: groupId === group.id, run: () => moveRow(menu.id, group.id) })),
      { id: "new-group", label: t("New group"), icon: FolderPlus, run: () => beginEdit({ kind: "new", id: menu.id }) },
      ...(groupId ? [{ id: "ungroup", label: t("Ungroup"), icon: Undo2, run: () => moveRow(menu.id, null) }] : []),
    ];
    const peers = ordered.filter(row => (layout.membership[rowKey(row)] ?? null) === groupId);
    const index = peers.findIndex(row => rowKey(row) === menu.id);
    const selected = rows.find(row => rowKey(row) === menu.id);
    const nativeTab = selected?.machine.state === "connected" && selected.entry.tab ? selected : null;
    return [
      ...(nativeTab ? [{ id: "rename-tab", label: t("Rename tab"), icon: Pencil, run: () => setTabDialog({ kind: "rename", row: menu.id }) }] : []),
      { id: "rename", label: t("Sidebar name"), hint: t("On this device"), icon: Pencil, run: () => beginEdit(menu) },
      ...(layout.labels[menu.id] ? [{ id: "native-name", label: t("Use native name"), icon: Undo2, run: () => { const labels = { ...layout.labels }; delete labels[menu.id]; commit({ ...layout, labels }); } }] : []),
      { id: "move-group", label: layout.groups.length ? t("Move to group") : t("New group"), icon: Folder, divider: true,
        run: () => layout.groups.length ? setMenu({ ...menu, page: "move" }) : beginEdit({ kind: "new", id: menu.id }) },
      ...(rows.length > 1 ? [{ id: "pair", label: t("Group with…"), icon: FolderPlus, run: () => setMenu({ ...menu, page: "pair" }) }] : []),
      ...(groupId ? [{ id: "ungroup", label: t("Ungroup"), icon: Undo2, run: () => moveRow(menu.id, null) }] : []),
      ...(index > 0 ? [{ id: "up", label: t("Move up"), icon: ArrowUp, divider: true, run: () => { refocusRow.current = menu.id; stepRow(menu.id, -1); } }] : []),
      ...(index < peers.length - 1 ? [{ id: "down", label: t("Move down"), icon: ArrowDown, run: () => { refocusRow.current = menu.id; stepRow(menu.id, 1); } }] : []),
      ...(nativeTab ? [
        { id: "tab", label: t("Manage tab"), icon: Grid2X2, divider: true, run: () => onShowTabs(nativeTab.machine.id, nativeTab.entry.pane.pane_id) },
        { id: "close-tab", label: t("Close tab"), icon: X, danger: true, run: () => setTabDialog({ kind: "close", row: menu.id }) },
      ] : []),
    ];
  };
  const menuRow = menu?.kind === "row" ? rows.find(row => rowKey(row) === menu.id) : undefined;
  const menuTitle = menu?.page === "pair" ? t("Group with…") : menu?.page === "move" ? t("Move to group")
    : menuRow ? titleOf(menuRow) : layout.groups.find(group => group.id === menu?.id)?.name ?? t("Organize group");

  const agentItem = ({ machine, entry }: AgentRow, grouped: boolean) => {
    const { pane, workspace, tab, agent, agentLabel } = entry;
    const selected = machine.id === selectedMachineId && pane.pane_id === selectedPaneId;
    const online = machine.state === "connected";
    const tabs = machine.snapshot?.tabs.filter((candidate) => candidate.workspace_id === workspace.workspace_id) ?? [];
    const title = titleOf({ machine, entry });
    const task = displayPaneTitle(pane);
    const name = agent?.name?.trim() || null;
    // the name has its own place on the line: the label beside it says the kind instead
    const kindLabel = name !== null && agentLabel === name ? entry.canonicalAgent ?? agent?.title?.trim() ?? null : agentLabel;
    const mark = paneMark(entry);
    const markAgent = mark && hasAgentMark(mark) ? mark : null;
    const parts = { agentLabel: kindLabel, title, markAgent, machineName: machineName(machine), workspaceLabel: workspace.label, tabName: agentTabName(tab, tabs, t) };
    // a row in a card leaves its place to the card's head; the tooltip still says all of it
    const place = agentContext(parts).join(" · ");
    const contextParts = agentContext({ ...parts, grouped, named: name !== null });
    const kind = kindLabel?.trim() || null;
    const markKind = kind && kind !== title.trim() && !contextParts.includes(kind) ? kind : null;
    const tooltip = [...new Set([pane.pane_id, title, task, place, markKind, name, agent?.display_agent, pane.cwd, pane.plan?.current, pane.background_tasks ? `${pane.background_tasks} ${t("Background tasks")}` : null, online ? null : stateWord(machine)].filter(Boolean))].join("\n");
    const pinKey = sidebarPinKey(machine.id, pane.pane_id);
    const isPinned = pinKeys.includes(pinKey);
    const id = rowKey({ machine, entry });
    const groupId = layout.membership[id] ?? null;
    const rowDrop = (event: DragEvent<HTMLElement>): DropTarget => {
      const bounds = event.currentTarget.getBoundingClientRect();
      const fraction = (event.clientY - bounds.top) / bounds.height;
      return { kind: "row", id, groupId, position: fraction < .25 ? "before" : fraction > .75 ? "after" : "group" };
    };
    const status = online ? activity.status(machine.id, pane) : undefined;
    const dropHere = drop?.kind === "row" && drop.id === id;
    return <li className={`agent-item${selected ? " is-selected" : ""}${online ? "" : " is-offline"}${dragging?.id === id ? " is-dragging" : ""}${dropHere ? drop.position === "group" ? " drop-inside" : ` drop-${drop.position}` : ""}`} key={paneStorageId(machine.id, pane.pane_id)} data-machine={machine.id} data-pane={pane.pane_id}
      draggable={!editing} onDragStart={event => startDrag(event, { kind: "row", id })} onDragEnd={endDrag} onDragOver={event => over(event, rowDrop(event))} onDrop={event => finishDrop(event, rowDrop(event))}
      onContextMenu={event => openMenu(event, { kind: "row", id })} onKeyDown={event => localKey(event, { kind: "row", id })}>
      <button type="button" className="agent-select agent-row" disabled={!online} aria-current={selected ? "true" : undefined} title={tooltip} onClick={() => onSelect(machine.id, pane.pane_id)}>
        {/* a saved roster's state is not news: a PC that is away says nothing about its agents */}
        <AgentRowBody mark={mark} markKind={markKind} title={title} online={online} status={status} />
      </button>
      {status === "working" && <WorkingRing />}
      {(settings.agentPins || isPinned) && <button type="button" className={`agent-pin-toggle${isPinned ? " is-pinned" : ""}`} aria-label={`${t("Pin agent")}: ${[title, machineName(machine), workspace.label].filter(Boolean).join(" · ")}`} aria-pressed={isPinned} title={t(isPinned ? "Unpin agent" : "Pin agent")} data-pin-key={pinKey} onClick={(event) => setPin(pinKey, event.currentTarget)}>
        <Star aria-hidden="true" fill={isPinned ? "currentColor" : "none"} />
      </button>}
      <button type="button" className="agent-organize" data-row-key={id} aria-label={`${t("Organize agent")}: ${title}`} aria-haspopup="menu" aria-expanded={menu?.kind === "row" && menu.id === id} title={t("Rename, group or reorder")} onClick={event => openMenu(event, { kind: "row", id })}><MoreHorizontal aria-hidden="true" /></button>
    </li>;
  };

  return <section ref={sectionRef} className={`agents-sidebar${collapsed ? " is-collapsed" : ""}${rows.length === 0 ? " is-empty" : ""}`} aria-label={t("Agents")} onDragLeave={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDrop(null); }}>
    <div className="agent-section-head">
    <button type="button" className="agent-section-toggle sidebar-section-label" aria-expanded={!collapsed} aria-controls={listId} onClick={() => setCollapsed(!collapsed)}>
      {collapsed ? <ChevronRight className="agent-section-caret" aria-hidden="true" /> : <ChevronDown className="agent-section-caret" aria-hidden="true" />}
      <span>{t("Agents")}</span>
      {rows.length > 0 && <span className="agent-section-count">{query ? `${visibleCount}/${rows.length}` : rows.length}</span>}
    </button>
    {rows.length > 0 && <button ref={searchTrigger} type="button" className="agent-new-group"
      aria-label={t("Filter agents")} title={t("Filter agents")} aria-expanded={searchOpen && !collapsed}
      onClick={() => {
        if (searchOpen && !collapsed) closeSearch();
        else { setCollapsed(false); setSearchOpen(true); }
      }}><Search aria-hidden="true" /></button>}
    <button type="button" className="agent-new-group" aria-label={t("New group")} title={t("New group")} onClick={() => { setCollapsed(false); beginEdit({ kind: "new", id: "" }); }}><FolderPlus aria-hidden="true" /></button>
    </div>
    {editing && <form className="agent-name-editor" onSubmit={event => { event.preventDefault(); saveName(); }} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); closeEditor(); } }}>
      <label htmlFor={`${listId}-name`}>{editing.kind === "row" ? t("Sidebar name") : editing.kind === "new" ? t("New group") : t("Rename group")}</label>
      <input ref={nameInput} id={`${listId}-name`} className="input" maxLength={100} value={editing.value} onChange={event => setEditing({ ...editing, value: event.target.value })} />
      <div><button type="button" className="btn" onClick={closeEditor}>{t("Cancel")}</button><button type="submit" className="btn btn-primary" disabled={!editing.value.trim()}>{t("Save")}</button></div>
    </form>}
    {error && <p className="agent-organize-error" role="alert">{error}</p>}
    <span className="visually-hidden" role="status">{announcement}</span>
    {!collapsed && searchOpen && rows.length > 0 && <div className="agent-search">
      <Search aria-hidden="true" />
      <input ref={searchInput} type="search" aria-label={t("Filter agents")} placeholder={t("Find an agent or workspace")} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); closeSearch(); } }} />
      {query && <button type="button" aria-label={t("Clear")} onClick={() => { setQuery(""); searchInput.current?.focus(); }}><X aria-hidden="true" /></button>}
    </div>}
    <div className="agent-list-contents" id={listId} hidden={collapsed}>
      {rows.length === 0 && !custom ? <p className="agent-empty" role="status">{t("No agents running")}</p> : visibleCount === 0 && !custom ? <p className="agent-empty" role="status">{t("No matching agents in the connected roster.")}</p> : <ul className="agent-list">
        {custom ? <>
          {layout.groups.map(group => {
            const members = visibleOrdered.filter(row => layout.membership[rowKey(row)] === group.id);
            const total = ordered.filter(row => layout.membership[rowKey(row)] === group.id).length;
            const selected = members.some(row => row.machine.id === selectedMachineId && row.entry.pane.pane_id === selectedPaneId);
            const folded = group.collapsed && !query;
            const groupDrop = (event: DragEvent<HTMLElement>): DropTarget => ({ kind: "group", id: group.id, after: event.clientY > event.currentTarget.getBoundingClientRect().top + event.currentTarget.getBoundingClientRect().height / 2 });
            const dropHere = drop?.kind === "group" && drop.id === group.id;
            return <li className={`agent-custom-group${selected ? " has-selected" : ""}${dropHere ? dragging?.kind === "group" ? drop.after ? " drop-after" : " drop-before" : " drop-inside" : ""}`} key={group.id} data-group-id={group.id}>
              <div className="agent-custom-head" draggable={!editing} onDragStart={event => startDrag(event, { kind: "group", id: group.id })} onDragEnd={endDrag} onDragOver={event => over(event, groupDrop(event))} onDrop={event => finishDrop(event, groupDrop(event))} onContextMenu={event => openMenu(event, { kind: "group", id: group.id })} onKeyDown={event => localKey(event, { kind: "group", id: group.id })}>
                <button type="button" className="agent-group-toggle" aria-expanded={!folded} aria-controls={`${listId}-${group.id}`} onClick={() => commit({ ...layout, groups: layout.groups.map(item => item.id === group.id ? { ...item, collapsed: !folded } : item) })}>
                  {folded ? <ChevronRight aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}<span>{group.name}</span><span className="agent-group-count">{query ? `${members.length}/${total}` : total}</span>
                </button>
                <button type="button" className="agent-organize agent-group-menu" aria-label={`${t("Organize group")}: ${group.name}`} aria-haspopup="menu" aria-expanded={menu?.kind === "group" && menu.id === group.id} onClick={event => openMenu(event, { kind: "group", id: group.id })}><MoreHorizontal aria-hidden="true" /></button>
              </div>
              <ul className="agent-group-rows" id={`${listId}-${group.id}`} hidden={folded} aria-label={group.name}>
                {members.map(row => agentItem(row, true))}
                {members.length === 0 && <li className={`agent-drop-bucket${drop?.kind === "bucket" && drop.id === group.id ? " drop-inside" : ""}`} onDragOver={event => over(event, { kind: "bucket", id: group.id })} onDrop={event => finishDrop(event, { kind: "bucket", id: group.id })}>{query ? t("No matching agents in the connected roster.") : t("Move agents here using their menu or drag them.")}</li>}
              </ul>
            </li>;
          })}
          <li className={`agent-ungrouped${drop?.kind === "bucket" && drop.id === null ? " drop-inside" : ""}`} onDragOver={event => over(event, { kind: "bucket", id: null })} onDrop={event => finishDrop(event, { kind: "bucket", id: null })}>
            <div className="agent-subheading">{t("Ungrouped")}</div>
            <ul className="agent-group-rows" aria-label={t("Ungrouped")}>{visibleOrdered.filter(row => !layout.membership[rowKey(row)]).map(row => agentItem(row, false))}</ul>
            {dragging?.kind === "row" && <div className="agent-drop-hint">{t("Drop here to ungroup")}</div>}
          </li>
        </> : groups ? groups.map(({ key, rows: members }, index) => {
          const { machine, entry } = members[0]!;
          const headId = `${listId}-group-${index}`;
          const name = [machineName(machine), entry.workspace.label].filter(Boolean).join(" · ");
          // the head is the card's name, not a control: a row opens a pane, and the workspace list opens workspaces
          return <li className={`agent-group${machine.state === "connected" ? "" : " is-offline"}`} key={key}>
            <div className="agent-group-head" id={headId}>
              <span className="agent-group-mark" aria-hidden="true"><Folder /></span>
              <span className="agent-group-name" title={name}>{name}</span>
            </div>
            <ul className="agent-group-rows" aria-labelledby={headId}>{members.map((row) => agentItem(row, true))}</ul>
          </li>;
        }) : <>
          {visiblePinned.length > 0 && <li className="agent-subheading">{t("Pinned")}</li>}
          {visiblePinned.map((row) => agentItem(row, false))}
          {visiblePinned.length > 0 && visibleRest.length > 0 && <li className="agent-subheading">{t("All agents")}</li>}
          {visibleRest.map((row) => agentItem(row, false))}
        </>}
        {visibleIdle.length > 0 && <li className="agent-idle">
          <details open={query ? true : undefined}>
            <summary><Clock aria-hidden="true" /><span>{t("Long idle")}</span><span className="agent-group-count">{visibleIdle.length}</span></summary>
            <ul className="agent-group-rows">{visibleIdle.map(row => agentItem(row, false))}</ul>
          </details>
        </li>}
      </ul>}
    </div>
    {menu && <RowMenu key={`${menu.kind}:${menu.id}:${menu.page ?? "main"}`} anchor={menu.anchor} align="start" title={menuTitle}
      subtitle={menuRow ? [menuRow.entry.workspace.label, machineName(menuRow.machine)].filter(Boolean).join(" · ") : undefined}
      items={menuItems()} onClose={closeMenu} variant="actions" />}
    {dialogRow && dialogTab && tabDialog?.kind === "rename" && <MachineContext.Provider value={dialogRow.machine.id}>
      <RenameNativeTab tab={dialogTab} name={dialogName}
        panes={dialogRow.machine.snapshot?.panes.filter(pane => pane.tab_id === dialogTab.tab_id) ?? []}
        onClose={closeTabDialog} onSaved={() => { actions.refresh(); closeTabDialog(); }} />
    </MachineContext.Provider>}
    {dialogRow && dialogTab && tabDialog?.kind === "close" && <TabCloseConfirmation
      name={dialogName} workspaceName={dialogRow.entry.workspace.label} lastTab={dialogTabs.length === 1}
      onClose={closeTabDialog} onConfirm={async () => { await actions.closeTab(dialogRow.machine.id, dialogTab.tab_id); closeTabDialog(); }} />}
  </section>;
}
