import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, CalendarDays, Check, CheckCheck, Columns3, List, Radio, Sparkles, Copy, Maximize2, Minimize2, Plus, RefreshCw, Search, X } from "lucide-react";
import { TASK_STAGES, TASK_STAGE_LABELS, type TaskStage, type WorkspaceTask } from "../../shared/tasks.ts";
import type { Machine } from "../../shared/machines.ts";
import { sidebarAgents, agentNavigationLabel } from "../lib/sidebarAgents.ts";
import { paneStatus } from "../lib/status.ts";
import { TaskCapture } from "./TaskCapture.tsx";
import { useT } from "../lib/i18n.ts";
import { copyText } from "../lib/clipboard.ts";
import { usePhoneSheetBack } from "../lib/sheetHistory.ts";
import { useSheetSwipe } from "../lib/sheets.ts";
import { nativeModalOver, useFocusTrap } from "../lib/useFocusTrap.ts";
import { createTaskStore, localTaskDay, taskId, type TaskStore, useTaskStore } from "../lib/workspaceTasks.ts";
import "./TaskBoard.css";

const VIEW_OPTIONS = [
  { id: "today", label: "Today" },
  { id: "waiting", label: "Needs attention" },
  { id: "archive", label: "Archive" },
] as const;
type TaskFilter = "all" | typeof VIEW_OPTIONS[number]["id"];
type Layout = "list" | "board" | "agents";
const LAYOUTS = [{ id: "list", label: "List", Icon: List }, { id: "board", label: "Board", Icon: Columns3 }, { id: "agents", label: "Agents", Icon: Radio }] as const;
const LAYOUT_KEY = "herdr-web-ui:tasks-layout";
type Editor = { original: WorkspaceTask; draft: WorkspaceTask; isNew: boolean };
const DRAG_TYPE = "application/x-herdr-task";

function newTask(scope: WorkspaceTask["scope"], project: string, stage: TaskStage): WorkspaceTask {
  const now = new Date().toISOString();
  return { id: taskId(), title: "", notes: "", stage, scope, priority: "normal", project, due: "", checklist: [], archived: false, created_at: now, updated_at: now };
}

function dueLabel(date: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(`${date}T12:00:00`));
}

function BoardCard({ task, today, canMove, onEdit, onMove }: {
  task: WorkspaceTask; today: string; canMove: boolean;
  onEdit(): void; onMove(stage: TaskStage): void;
}) {
  return <article className="task-card" data-task-id={task.id}
    draggable={canMove} onDragStart={event => {
      event.dataTransfer.setData(DRAG_TYPE, task.id);
      event.dataTransfer.effectAllowed = "move";
    }}>
    <button type="button" className="task-card-open" onClick={onEdit}>
      <span className="task-card-title">{task.title}</span>
      {task.notes && <span className="task-note-preview">{task.notes}</span>}
    </button>
    <div className="task-card-meta">
      <span className="task-card-project" title={task.project || undefined}>{task.project || (task.scope === "business" ? "Business" : "Personal")}</span>
      {task.priority !== "normal" && <span className="task-priority">{task.priority === "urgent" ? "Urgent" : "High"}</span>}
      {task.due && <time dateTime={task.due} className={task.due < today && task.stage !== "done" ? "task-overdue" : undefined}><CalendarDays aria-hidden="true" />{dueLabel(task.due)}{task.due_time && ` · ${task.due_time}`}</time>}
      {!!task.checklist.length && <span className="task-card-check" aria-label={`${task.checklist.filter(item => item.done).length} of ${task.checklist.length} checklist items complete`}><CheckCheck aria-hidden="true" />{task.checklist.filter(item => item.done).length}/{task.checklist.length}</span>}
    </div>
    <select className="select task-card-stage" aria-label={`Move ${task.title}`} value={task.stage} disabled={!canMove} onChange={event => onMove(event.target.value as TaskStage)}>
      {TASK_STAGES.map(stage => <option key={stage} value={stage}>{TASK_STAGE_LABELS[stage]}</option>)}
    </select>
  </article>;
}

function NotesEditor({ editor, projects, itemText, setItemText, patch, onBack, onSave, onReload, busy, conflict, externallyChanged }: {
  editor: Editor; projects: string[]; itemText: string; setItemText(value: string): void;
  patch(values: Partial<WorkspaceTask>): void; onBack(): void; onSave(task: WorkspaceTask): void;
  onReload(): void; busy: boolean; conflict: boolean; externallyChanged: boolean;
}) {
  const { draft, isNew } = editor;
  const title = useRef<HTMLInputElement>(null);
  const listId = useId();
  const canAdd = Boolean(itemText.trim()) && draft.checklist.length < 100;
  const createItem = () => ({ id: taskId(), title: itemText.trim(), done: false });
  const addItem = () => {
    if (!canAdd) return;
    patch({ checklist: [...draft.checklist, createItem()] });
    setItemText("");
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave(canAdd ? { ...draft, checklist: [...draft.checklist, createItem()] } : draft);
  };
  useEffect(() => { title.current?.focus(); }, [draft.id]);
  return <form className="task-editor" aria-label={isNew ? "New task" : "Task details"} onSubmit={submit}>
    <header className="task-editor-header">
      <button type="button" className="icon-button" aria-label="Back to board" disabled={busy} onClick={onBack}><ArrowLeft aria-hidden="true" /></button>
      <h3>{isNew ? "New task" : "Task details"}</h3>
    </header>
    {externallyChanged && <div className="task-feedback" role="alert">
      <span>This task changed on another device. Load that version to continue editing.</span>
      <button type="button" className="btn" onClick={onReload}>Load saved task</button>
    </div>}
    <fieldset className="task-editor-fields" disabled={busy}>
      <label>Title<input ref={title} className="input" required maxLength={240} value={draft.title} onChange={event => patch({ title: event.target.value })} placeholder="What needs to happen?" /></label>
      <label className="task-notes-field">Notes<textarea className="input" rows={6} maxLength={12000} value={draft.notes} onChange={event => patch({ notes: event.target.value })} placeholder="Add context, links, or next steps…" /></label>
      <div className="task-editor-row">
        <label>Stage<select className="select" value={draft.stage} onChange={event => patch({ stage: event.target.value as TaskStage })}>{TASK_STAGES.map(stage => <option key={stage} value={stage}>{TASK_STAGE_LABELS[stage]}</option>)}</select></label>
        <label>Priority<select className="select" value={draft.priority} onChange={event => patch({ priority: event.target.value as WorkspaceTask["priority"] })}><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
        <label>Project<input className="input" list={listId} maxLength={120} value={draft.project} onChange={event => patch({ project: event.target.value })} placeholder="Optional" /></label>
        <datalist id={listId}>{projects.map(name => <option key={name} value={name} />)}</datalist>
        <label>Due date<input className="input" type="date" value={draft.due} onChange={event => patch({ due: event.target.value, ...(!event.target.value && { due_time: undefined }) })} /></label>
        <label>Due time<input className="input" type="time" value={draft.due_time ?? ""} disabled={!draft.due} onChange={event => patch({ due_time: event.target.value || undefined })} /></label>
        <label>Area<select className="select" value={draft.scope} onChange={event => patch({ scope: event.target.value as WorkspaceTask["scope"] })}><option value="business">Business</option><option value="personal">Personal</option></select></label>
      </div>
      <fieldset className="task-checklist">
        <legend>Checklist</legend>
        {draft.checklist.map(item => <div className="task-check-item" key={item.id}>
          <label><input type="checkbox" checked={item.done} onChange={event => patch({ checklist: draft.checklist.map(entry => entry.id === item.id ? { ...entry, done: event.target.checked } : entry) })} /><span>{item.title}</span></label>
          <button type="button" className="icon-button" aria-label={`Remove ${item.title}`} onClick={() => patch({ checklist: draft.checklist.filter(entry => entry.id !== item.id) })}><X aria-hidden="true" /></button>
        </div>)}
        <div className="task-check-add">
          <input className="input" aria-label="Checklist item" maxLength={240} value={itemText} onChange={event => setItemText(event.target.value)} placeholder="Add a checklist item" onKeyDown={event => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); addItem(); }
          }} />
          <button className="icon-button" type="button" aria-label="Add checklist item" disabled={!canAdd} onClick={addItem}><Plus aria-hidden="true" /></button>
        </div>
      </fieldset>
    </fieldset>
    <footer className="task-editor-footer">
      <label className="task-archive"><input type="checkbox" checked={draft.archived} disabled={busy} onChange={event => patch({ archived: event.target.checked })} />Archived</label>
      <button className="btn btn-primary" type="submit" disabled={busy || conflict || externallyChanged || !draft.title.trim()}><Check aria-hidden="true" />{busy ? "Saving…" : "Save task"}</button>
    </footer>
  </form>;
}

export function TaskBoard({ onClose, store: suppliedStore, machines = [], onSelect }: { onClose(): void; store?: TaskStore; machines?: Machine[]; onSelect?(machine: string, pane: string): void }) {
  const [store] = useState(() => suppliedStore ?? createTaskStore());
  const { snapshot, error, pending, conflict } = useTaskStore(store);
  const [view, setView] = useState<TaskFilter>("all");
  const [layout, setLayout] = useState<Layout>(() => {
    try { if (localStorage.getItem(LAYOUT_KEY) === "board") return "board"; } catch { /* layout is optional */ }
    return "list";
  });
  const [createProject, setCreateProject] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [parent, setParent] = useState("");
  const [capture, setCapture] = useState(false);
  const [captureNote, setCaptureNote] = useState("");
  const captureButton = useRef<HTMLButtonElement>(null);
  const [captureTask, setCaptureTask] = useState<string | null>(null);
  const [phoneStage, setPhoneStage] = useState<TaskStage | null>(null);
  const [scope, setScope] = useState<"all" | WorkspaceTask["scope"]>("all");
  const [project, setProject] = useState("");
  const [query, setQuery] = useState("");
  const t = useT();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [itemText, setItemText] = useState("");
  const [confirm, setConfirm] = useState<"close" | "board" | "reload" | null>(null);
  const [status, setStatus] = useState("");
  const [copyError, setCopyError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [dropStage, setDropStage] = useState<TaskStage | null>(null);
  const heading = useId();
  const surface = useFocusTrap<HTMLElement>(true);
  const newButton = useRef<HTMLButtonElement>(null);
  const keepEditing = useRef<HTMLButtonElement>(null);
  const editorOpener = useRef<HTMLElement | null>(null);
  const dirty = editor !== null && (JSON.stringify(editor.draft) !== JSON.stringify(editor.original) || Boolean(itemText.trim()));
  const unsaved = dirty || Boolean(captureNote.trim() || folderName.trim());
  const busy = pending === "save";
  const activeTask = editor && snapshot?.tasks.find(task => task.id === editor.draft.id);
  const externallyChanged = Boolean(editor && !editor.isNew && (!activeTask || JSON.stringify(activeTask) !== JSON.stringify(editor.original)));

  function restoreBoardFocus() {
    requestAnimationFrame(() => {
      const panel = surface.current;
      if (!panel || panel.contains(document.activeElement)) return;
      (panel.querySelector<HTMLInputElement>(".task-editor-fields input") ?? newButton.current ?? panel).focus({ preventScroll: true });
    });
  }
  function keepEdit() {
    setConfirm(null);
    restoreBoardFocus();
  }
  async function refreshBoard() {
    surface.current?.focus({ preventScroll: true });
    await store.load();
    restoreBoardFocus();
  }
  function exitEditor() {
    setEditor(null);
    setItemText("");
    requestAnimationFrame(() => {
      const candidate = editorOpener.current;
      (candidate?.isConnected ? candidate : newButton.current)?.focus({ preventScroll: true });
    });
  }
  function attemptExit(intent: "close" | "board") {
    if (store.read().pending === "save") return false;
    if ((intent === "close" ? unsaved : dirty)) { setConfirm(intent); return false; }
    if (intent === "close") onClose();
    else exitEditor();
    return true;
  }
  usePhoneSheetBack(() => attemptExit("close"));
  useSheetSwipe(surface, busy || unsaved ? null : () => attemptExit("close"));
  useEffect(() => { void store.load(); }, [store]);
  useEffect(() => { if (confirm) keepEditing.current?.focus(); }, [confirm]);
  useEffect(() => {
    // An async update can remove the focused button before the next frame restores focus.
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || event.defaultPrevented || nativeModalOver(surface.current)) return;
      if (event.target !== document.body && event.target !== document.documentElement) return;
      event.preventDefault();
      event.stopPropagation();
      if (confirm) keepEdit();
      else if (capture) closeCapture();
      else attemptExit(editor ? "board" : "close");
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  });

  function edit(task: WorkspaceTask, isNew = false) {
    if (busy || dirty) { if (dirty) setStatus("Save or close the current task before opening another."); return; }
    editorOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setStatus("");
    setCopyError("");
    setEditor({ original: task, draft: { ...task }, isNew });
    setItemText("");
  }
  function discard() {
    if (confirm === "close") onClose();
    if (confirm === "board") exitEditor();
    if (confirm === "reload" && editor) {
      if (activeTask) setEditor({ original: activeTask, draft: { ...activeTask }, isNew: false });
      else { exitEditor(); setStatus("This task is no longer on the board."); }
      setItemText("");
      restoreBoardFocus();
    }
    setConfirm(null);
  }
  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== "Escape" || event.nativeEvent.isComposing || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    if (confirm) keepEdit();
    else if (capture) closeCapture();
    else attemptExit(editor ? "board" : "close");
  }
  async function update(task: WorkspaceTask, fromEditor = false) {
    setStatus("");
    const saved = await store.save(task);
    if (!saved) return;
    if (task.id === captureTask) { setCaptureNote(""); setCaptureTask(null); }
    setStatus(fromEditor ? task.archived ? "Task archived." : "Task saved." : `Moved to ${TASK_STAGE_LABELS[task.stage]}.`);
    if (fromEditor) exitEditor();
    else {
      setPhoneStage(task.stage);
      requestAnimationFrame(() => {
        if (surface.current?.contains(document.activeElement)) return;
        const card = surface.current?.querySelector<HTMLElement>(`[data-task-id="${task.id}"] .task-card-open`);
        (card?.getClientRects().length ? card : newButton.current)?.focus({ preventScroll: true });
      });
    }
  }

  const today = localTaskDay();
  const tasks = snapshot?.tasks ?? [];
  const queryText = query.trim().toLocaleLowerCase();
  const visible = tasks.filter(task => task.archived === (view === "archive")
    && (scope === "all" || task.scope === scope)
    && (!project || (task.project === project || task.project.startsWith(`${project} / `)))
    && (!queryText || `${task.title} ${task.notes} ${task.project}`.toLocaleLowerCase().includes(queryText))
    && (view !== "today" || (task.stage !== "done" && (task.stage === "doing" || task.priority === "urgent" || Boolean(task.due && task.due <= today))))
    && (view !== "waiting" || task.stage === "needs-you" || task.stage === "review"));
  const projects = [...new Set([...(snapshot?.projects ?? []), ...tasks.map(task => task.project).filter(Boolean)])].sort((a, b) => a.localeCompare(b));
  const open = tasks.filter(task => !task.archived && task.stage !== "done").length;
  const completed = tasks.filter(task => !task.archived && task.stage === "done").length;
  const lanes = TASK_STAGES.map(stage => ({ stage, tasks: visible.filter(task => task.stage === stage) }));
  const selectedStage = phoneStage ?? (lanes.find(lane => lane.stage === "doing" && lane.tasks.length)?.stage
    ?? lanes.find(lane => lane.tasks.length)?.stage ?? "inbox");
  const filtered = scope !== "all" || Boolean(project || queryText);
  const canMove = !pending && !dirty && !conflict;

  async function copyBrief() {
    setCopyError("");
    try {
      const brief = visible.filter(task => task.stage !== "done").map(task =>
        `- ${task.title} [${task.scope}; ${task.stage}; ${task.priority}${task.due ? `; due ${task.due}` : ""}${task.project ? `; project ${task.project}` : ""}]\n${task.notes}\n${task.checklist.map(item => `  [${item.done ? "x" : " "}] ${item.title}`).join("\n")}`,
      );
      const copied = await copyText(`Task planning brief — ${today}\nSuggest priorities and blockers. Keep all actions and messages for my approval.\n\n${brief.join("\n\n")}`);
      if (!copied) {
        setCopyError("Clipboard access is unavailable. Open a task to copy its notes.");
        return;
      }
      setStatus("Planning brief copied.");
    } catch { setCopyError("Clipboard access is unavailable. Open a task to copy its notes."); }
  }
  function clearFilters() { setScope("all"); setProject(""); setQuery(""); }
  function startTask(stage: TaskStage = "inbox") {
    if (view !== "all") setView("all");
    setPhoneStage(stage);
    edit(newTask(scope === "personal" ? "personal" : "business", project, stage), true);
  }
  function closeCapture() {
    setCapture(false);
    requestAnimationFrame(() => captureButton.current?.focus({ preventScroll: true }));
  }
  function chooseLayout(next: Layout) {
    setLayout(next);
    if (next === "agents") return;
    try { localStorage.setItem(LAYOUT_KEY, next); } catch { /* layout is optional */ }
  }
  async function addProject(event: FormEvent) {
    event.preventDefault();
    const name = folderName.trim();
    const path = parent ? `${parent} / ${name}` : name;
    if (!name || path.length > 120) { setStatus("Use a project path of up to 120 characters."); return; }
    if (name.includes("/")) { setStatus("Use the parent project field to create a subproject."); return; }
    if (projects.includes(path) || await store.addProject(path)) {
      setProject(path); setView("all"); setFolderName(""); setParent(""); setCreateProject(false);
      setStatus(`${path} is ready.`);
    }
  }
  const live = machines.flatMap(machine => machine.state === "connected" ? sidebarAgents(machine.snapshot).flatMap(entry => {
    const state = paneStatus(entry.pane);
    return state === "working" || state === "blocked" ? [{ machine, entry, state }] : [];
  }) : []);
  const cards = (entries: WorkspaceTask[]) => entries.map(task => <BoardCard key={task.id} task={task} today={today}
    canMove={canMove && !task.archived} onEdit={() => edit(task)} onMove={stage => void update({ ...task, stage })} />);

  return createPortal(<div className="modal-scrim task-scrim" onClick={event => { if (event.currentTarget === event.target) attemptExit("close"); }}>
    <section className="modal task-workspace" ref={surface} data-expanded={expanded} data-editing={Boolean(editor)} role="dialog"
      aria-modal="true" aria-labelledby={heading} tabIndex={-1} onKeyDown={onKeyDown}>
      <header className="task-header">
        <div className="task-heading">
          <div><h2 id={heading}>{t("Tasks")}</h2>{snapshot && <p>{open} open <span aria-hidden="true">·</span> {completed} done</p>}</div>
        </div>
        <div className="task-header-actions">
          <button type="button" ref={newButton} className="btn btn-primary task-create" disabled={!snapshot || Boolean(pending) || dirty || conflict} onClick={() => startTask()}><Plus aria-hidden="true" /><span>New task</span></button>
          <button type="button" className="icon-button task-expand" aria-label={expanded ? "Restore board size" : "Expand board"} title={expanded ? "Restore board size" : "Expand board"} onClick={() => setExpanded(value => !value)}>{expanded ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}</button>
          <button type="button" className="icon-button" aria-label="Close tasks" title="Close tasks" disabled={busy} onClick={() => attemptExit("close")}><X aria-hidden="true" /></button>
        </div>
      </header>
      {confirm && <div className="task-feedback task-confirm" role="alert">
        <span>Discard your unsaved edit?</span>
        <button type="button" ref={keepEditing} className="btn" onClick={keepEdit}>Keep editing</button>
        <button type="button" className="btn" onClick={discard}>Discard edit</button>
      </div>}
      {(error || copyError) && <div className="task-feedback" role="alert">
        <span>{error || copyError}{error && dirty ? " Your edit is still here." : ""}</span>
        {error && <button type="button" className="btn" disabled={Boolean(pending)} onClick={() => void refreshBoard()}>Load latest board</button>}
      </div>}
      {(status || pending) && <p className="task-status" role="status">{pending === "save" ? "Saving task…" : pending === "load" && snapshot ? "Refreshing tasks…" : status}</p>}
      <div className="task-workspace-body">
        <div className="task-content">
          <div className="task-controls">
            <div className="task-views" role="group" aria-label="Task views">
              {LAYOUTS.map(({ id, label, Icon }) => <button type="button" key={id} aria-pressed={layout === id} onClick={() => chooseLayout(id)}><Icon aria-hidden="true" /><span>{label}</span></button>)}
            </div>
            <div className="task-utility">
              <button type="button" className="icon-button" title="Refresh tasks" aria-label="Refresh tasks" disabled={Boolean(pending)} onClick={() => void refreshBoard()}><RefreshCw aria-hidden="true" /></button>
              <button type="button" className="icon-button" title="Copy planning brief" aria-label="Copy planning brief" disabled={!visible.some(task => task.stage !== "done")} onClick={() => void copyBrief()}><Copy aria-hidden="true" /></button>
            </div>
          </div>
          {layout === "agents" ? <div className="task-list task-live">
            <p>Work and requests from connected agents. Add anything you want to track as a task.</p>
            {live.length ? live.map(({ machine, entry, state }) => {
              const title = agentNavigationLabel(entry, machine.snapshot?.tabs.filter(tab => tab.workspace_id === entry.workspace.workspace_id) ?? []);
              return <article key={`${machine.id}:${entry.pane.pane_id}`} className="task-live-row">
                <div><strong>{title}</strong><small>{entry.workspace.label} · {machine.name}</small>{entry.pane.plan?.current && <small>{entry.pane.plan.current}</small>}</div>
                <span data-state={state}>{state === "blocked" ? "Needs input" : "Working"}</span>
                {onSelect && <button type="button" className="btn" disabled={unsaved || busy} onClick={() => { onClose(); onSelect(machine.id, entry.pane.pane_id); }}>Open agent</button>}
                <button type="button" className="btn" disabled={!snapshot || !canMove} onClick={() => edit({
                  ...newTask("business", project, state === "blocked" ? "needs-you" : "inbox"),
                  title: (entry.pane.plan?.current || title).slice(0, 240),
                  notes: `From ${title} in ${entry.workspace.label} (${machine.name}).`,
                }, true)}><Plus aria-hidden="true" /> Add to tasks</button>
              </article>;
            }) : <div className="task-empty"><h3>No agents need attention</h3><p>Working agents and requests for input appear here.</p></div>}
          </div> : <>
          <div className="task-filters">
            <label className="task-search"><Search aria-hidden="true" /><input className="input" type="search" aria-label="Search tasks" placeholder="Search tasks" value={query} onChange={event => setQuery(event.target.value)} /></label>
            <select className="select task-filter" aria-label="Task area" value={scope} onChange={event => setScope(event.target.value as typeof scope)}><option value="all">All areas</option><option value="business">Business</option><option value="personal">Personal</option></select>
            <select className="select task-filter" aria-label="Task filter" value={view} onChange={event => setView(event.target.value as TaskFilter)}><option value="all">All tasks</option>{VIEW_OPTIONS.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}</select>
            <select className="select task-filter" aria-label="Project" value={project} onChange={event => setProject(event.target.value)}><option value="">All projects</option>{projects.map(name => <option key={name} value={name}>{name}</option>)}</select>
            <button className="icon-button task-project-add" type="button" aria-label="New project" title="New project" aria-expanded={createProject} disabled={!snapshot || !canMove} onClick={() => { setCreateProject(value => !value); setParent(project); }}><Plus aria-hidden="true" /></button>
          </div>
          {createProject && <form className="task-project-form" onSubmit={event => void addProject(event)}>
            <input autoFocus className="input" aria-label="Project name" placeholder="Project name" value={folderName} onChange={event => setFolderName(event.target.value)} maxLength={120} required />
            <select className="select" aria-label="Parent project" value={parent} onChange={event => setParent(event.target.value)}><option value="">Top level</option>{projects.map(name => <option key={name}>{name}</option>)}</select>
            <button className="btn btn-primary" type="submit" disabled={!canMove}>Create project</button>
          </form>}
          {!snapshot ? <p className="task-empty" role="status">{error ? "The board could not be loaded." : "Loading tasks…"}</p>
            : !visible.length && (filtered || view !== "all" || !tasks.some(task => !task.archived)) ? <div className="task-empty">
              <h3>{filtered ? "No matching tasks" : view === "archive" ? "No archived tasks" : view === "today" ? "Nothing due today" : view === "waiting" ? "Nothing needs attention" : "Your board is empty"}</h3>
              {filtered ? <button type="button" className="btn" onClick={clearFilters}>Clear filters</button> : view === "all" && <button type="button" className="btn" onClick={() => startTask()}><Plus aria-hidden="true" />Add a task</button>}
            </div> : layout === "board" && view !== "archive" ? <>
              <label className="task-phone-lane"><span>Stage</span><select className="select" value={selectedStage} onChange={event => setPhoneStage(event.target.value as TaskStage)}>{lanes.map(lane => <option key={lane.stage} value={lane.stage}>{TASK_STAGE_LABELS[lane.stage]} ({lane.tasks.length})</option>)}</select></label>
              <div className="task-columns">
                {lanes.map(lane => <section className="task-column" key={lane.stage} data-stage={lane.stage} data-phone-active={selectedStage === lane.stage}
                  data-drop={dropStage === lane.stage} aria-label={TASK_STAGE_LABELS[lane.stage]}
                  onDragOver={event => {
                    if (!canMove || !event.dataTransfer.types.includes(DRAG_TYPE)) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setDropStage(lane.stage);
                  }}
                  onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropStage(null); }}
                  onDragEnd={() => setDropStage(null)}
                  onDrop={event => {
                    setDropStage(null);
                    if (!canMove || !event.dataTransfer.types.includes(DRAG_TYPE)) return;
                    event.preventDefault();
                    const task = visible.find(entry => entry.id === event.dataTransfer.getData(DRAG_TYPE));
                    if (task && task.stage !== lane.stage) void update({ ...task, stage: lane.stage });
                  }}>
                  <header><span className="task-lane-dot" aria-hidden="true" /><h3>{TASK_STAGE_LABELS[lane.stage]}</h3><span className="task-lane-count">{lane.tasks.length}</span><button type="button" className="icon-button" disabled={!canMove} aria-label={`Add to ${TASK_STAGE_LABELS[lane.stage]}`} onClick={() => startTask(lane.stage)}><Plus aria-hidden="true" /></button></header>
                  <div className="task-stack">{cards(lane.tasks)}{!lane.tasks.length && <p className="task-lane-empty">No tasks</p>}</div>
                </section>)}
              </div>
            </> : <div className="task-list">{lanes.filter(lane => lane.tasks.length > 0).map(lane => <section className="task-list-group" key={lane.stage} aria-label={TASK_STAGE_LABELS[lane.stage]}>
              <h3>{TASK_STAGE_LABELS[lane.stage]} <small>{lane.tasks.length}</small></h3>
              {cards(lane.tasks)}
            </section>)}</div>}
          </>}
          {!editor && snapshot && <div className="task-capture-dock">
            {capture ? <TaskCapture note={captureNote} onNote={setCaptureNote} onClose={closeCapture} onDraft={(fields, question) => {
              const task = { ...newTask(scope === "personal" ? "personal" : "business", project, "inbox"), ...fields };
              setCapture(false); setCaptureTask(task.id); edit(task, true);
              setStatus(question || "Review the draft and save when it’s ready.");
              if (layout === "agents") chooseLayout("list");
              setView("all");
            }} /> : <button ref={captureButton} className="btn task-capture-trigger" disabled={!canMove} onClick={() => setCapture(true)}><Sparkles aria-hidden="true" /> Quick capture</button>}
          </div>}
        </div>
        {editor && <NotesEditor editor={editor} projects={projects} itemText={itemText} setItemText={setItemText}
          patch={values => { setEditor(previous => previous && ({ ...previous, draft: { ...previous.draft, ...values } })); setConfirm(null); }}
          onBack={() => attemptExit("board")} onSave={task => void update(task, true)}
          onReload={() => { if (dirty) setConfirm("reload"); else if (activeTask) setEditor({ original: activeTask, draft: { ...activeTask }, isNew: false }); else exitEditor(); }}
          busy={busy} conflict={conflict || pending === "load"} externallyChanged={externallyChanged} />}
      </div>
    </section>
  </div>, document.body);
}
