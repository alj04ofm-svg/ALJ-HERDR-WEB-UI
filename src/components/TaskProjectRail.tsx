import { useRef, useState, type DragEvent, type FormEvent } from "react";
import { Archive, ArrowDown, ArrowUp, ArrowUpRight, Ellipsis, Folder, GitMerge, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";
import type { TaskSnapshot } from "../../shared/tasks.ts";
import { archivedProject, inProject, projectLabel, projectParent, PROJECT_SEPARATOR, type ProjectChange } from "../lib/taskProjects.ts";
import { useFocusTrap } from "../lib/useFocusTrap.ts";
import { WorkingRing } from "./WorkingRing.tsx";

const PROJECT_DRAG = "application/x-herdr-task-project";
export type ProjectPanel = { path: string; mode: "actions" | "rename" | "merge" | "archive" | "delete"; target?: string };

export function TaskProjectRail({ snapshot, projects, selected, archived, open, busyProject, canChange, disabled, onSelect, onArchive, onCreate, onPanel, onCommit }: {
  snapshot: TaskSnapshot | null; projects: string[]; selected: string; archived: boolean; open: boolean; busyProject: string;
  canChange: boolean; disabled: boolean; onSelect(path: string): void; onArchive(): void; onCreate(): void;
  onPanel(panel: ProjectPanel, origin?: HTMLElement): void; onCommit(change: ProjectChange): void;
}) {
  const [drag, setDrag] = useState("");
  const [drop, setDrop] = useState<{ path: string; edge: "before" | "after" | "merge" } | null>(null);
  const active = projects.filter(path => !archivedProject(snapshot, path));
  const roots = snapshot?.archived_projects?.filter(path => archivedProject(snapshot, projectParent(path)) === undefined) ?? [];
  const available = archived ? roots : active;
  const order = (paths: string[]): string[] => {
    const names = new Set(paths);
    function children(parent: string): string[] {
      return paths.filter(path => (names.has(projectParent(path)) ? projectParent(path) : "") === parent)
        .flatMap(path => [path, ...children(path)]);
    }
    return children("");
  };
  function destination(event: DragEvent<HTMLElement>, path: string) {
    if (!canChange || !drag || drag === path || !event.dataTransfer.types.includes(PROJECT_DRAG)) return null;
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientY - bounds.top) / bounds.height;
    if ((ratio <= .25 || ratio >= .75) && projectParent(path) === projectParent(drag)) return ratio <= .25 ? "before" : "after";
    return !inProject(path, drag) && !inProject(drag, path) ? "merge" : null;
  }
  return <nav className="task-projects" aria-label="Projects">
    <div className="task-project-heading">
      <h3>Projects</h3>
      <button className="icon-button task-project-add" type="button" aria-label="New project" title="New project" aria-expanded={open} disabled={!canChange} onClick={onCreate}><Plus aria-hidden="true" /></button>
    </div>
    <div className="task-project-links">
      <button type="button" aria-pressed={!selected && !archived} disabled={disabled} onClick={() => onSelect("")}><Folder aria-hidden="true" /><span>All projects</span></button>
      {order(available).map(path => <div key={path} className="task-project-row" data-active={selected === path} data-drop={drop?.path === path ? drop.edge : undefined}
        draggable={canChange && !archived}
        onDragStart={event => { event.dataTransfer.setData(PROJECT_DRAG, path); event.dataTransfer.effectAllowed = "move"; setDrag(path); }}
        onDragEnd={() => { setDrag(""); setDrop(null); }}
        onDragOver={event => {
          const edge = destination(event, path);
          if (!edge) { if (drop) setDrop(null); return; }
          event.preventDefault(); event.dataTransfer.dropEffect = "move"; if (drop?.path !== path || drop.edge !== edge) setDrop({ path, edge });
        }}
        onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop(null); }}
        onDrop={event => {
          const edge = destination(event, path);
          setDrag(""); setDrop(null);
          if (!edge) return;
          event.preventDefault();
          const source = event.dataTransfer.getData(PROJECT_DRAG);
          if (source !== drag) return;
          if (edge === "merge") onPanel({ path: source, mode: "merge", target: path }, event.currentTarget.querySelector("button") ?? undefined);
          else onCommit({ kind: "move", path: source, target: path, after: edge === "after" });
        }}>
        <button type="button" className="task-project-link" aria-pressed={selected === path} aria-label={path} title={path} disabled={disabled}
          data-child={active.includes(projectParent(path))}
          onClick={() => onSelect(path)}
          onDoubleClick={event => { if (canChange) onPanel({ path, mode: "actions" }, event.currentTarget); }}
          onContextMenu={event => { if (canChange) { event.preventDefault(); onPanel({ path, mode: "actions" }, event.currentTarget); } }}
          onKeyDown={event => { if (canChange && (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) { event.preventDefault(); onPanel({ path, mode: "actions" }, event.currentTarget); } }}>
          <Folder aria-hidden="true" /><span>{projectLabel(path)}</span>
        </button>
        <button type="button" className="task-project-menu" aria-label={`Actions for ${path}`} title="Project actions" disabled={!canChange}
          onClick={event => onPanel({ path, mode: "actions" }, event.currentTarget)}><Ellipsis aria-hidden="true" /></button>
        {busyProject === path && <WorkingRing />}
      </div>)}
      <button type="button" className="task-project-archive" aria-pressed={archived && !selected} disabled={disabled} onClick={onArchive}><Archive aria-hidden="true" /><span>Archive</span></button>
    </div>
    <select className="select task-project-mobile" aria-label="Project" value={archived && !selected ? "archive:" : selected ? "project:" + selected : ""} disabled={disabled} onChange={event => {
      if (event.target.value === "archive:") onArchive(); else onSelect(event.target.value.slice(8));
    }}>
      <option value="">All projects</option>{active.map(path => <option key={path} value={"project:" + path}>{path}</option>)}
      <option value="archive:">Archive</option>{roots.map(path => <option key={path} value={"project:" + path}>{path} (archived)</option>)}
    </select>
    <button type="button" className="icon-button task-mobile-project-menu" aria-label="Project actions" disabled={!selected || !canChange}
      onClick={event => onPanel({ path: selected, mode: "actions" }, event.currentTarget)}><Ellipsis aria-hidden="true" /></button>
  </nav>;
}

export function TaskProjectActions({ panel, snapshot, projects, busy, blocked, feedback, onPanel, onClose, onCommit }: {
  panel: ProjectPanel; snapshot: TaskSnapshot; projects: string[]; busy: boolean; blocked: boolean; feedback: string;
  onPanel(panel: ProjectPanel): void; onClose(): void; onCommit(change: ProjectChange): void;
}) {
  const { path, mode } = panel;
  const [value, setValue] = useState(() => mode === "rename" ? projectLabel(path) : panel.target ?? "");
  const field = useRef<HTMLInputElement>(null);
  const surface = useFocusTrap<HTMLFormElement>(true, { shouldRestore: () => false });
  const archive = archivedProject(snapshot, path);
  const taskCount = snapshot.tasks.filter(task => inProject(task.project, path)).length;
  const children = projects.filter(name => name !== path && inProject(name, path));
  const siblings = projects.filter(name => projectParent(name) === projectParent(path) && !archivedProject(snapshot, name));
  const index = siblings.indexOf(path);
  const destinations = projects.filter(name => !inProject(name, path) && !inProject(path, name) && !archivedProject(snapshot, name));
  const result = (event: FormEvent) => {
    event.preventDefault();
    if (mode === "actions" || busy) return;
    if (mode === "merge") { if (destinations.includes(value)) onCommit({ kind: mode, path, target: value }); return; }
    if (mode === "rename") {
      const name = value.trim();
      if (!name || name.includes("/")) { field.current?.reportValidity(); return; }
      const prefix = projectParent(path);
      onCommit({ kind: mode, path, target: prefix ? prefix + PROJECT_SEPARATOR + name : name });
      return;
    }
    onCommit({ kind: mode, path });
  };
  const label = { actions: "Project actions", rename: "Rename project", merge: "Merge project", archive: "Archive project", delete: "Delete empty project" }[mode];
  return <div className="task-action-scrim" onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <form ref={surface} tabIndex={-1} className="task-project-actions" aria-label={label} onSubmit={result}>
      <header><div><h3>{label}</h3><p>{path}</p></div>
        <button type="button" autoFocus={mode === "actions"} className="icon-button" aria-label="Close project actions" disabled={busy} onClick={onClose}><X aria-hidden="true" /></button>
      </header>
      {feedback && <p className="task-action-feedback" role="status">{feedback}</p>}
      <fieldset disabled={busy || blocked}>
        {mode === "actions" ? <div className="task-action-grid">
          <button type="button" className="btn" onClick={() => onPanel({ path, mode: "rename" })}><Pencil aria-hidden="true" />Rename</button>
          {!archive && <button type="button" className="btn" disabled={!destinations.length} onClick={() => onPanel({ path, mode: "merge" })}><GitMerge aria-hidden="true" />Merge into…</button>}
          {archive === path ? <button type="button" className="btn" onClick={() => onCommit({ kind: "restore", path })}><RotateCcw aria-hidden="true" />Restore project</button>
            : snapshot.archived_projects && !archive && <button type="button" className="btn" onClick={() => onPanel({ path, mode: "archive" })}><Archive aria-hidden="true" />Archive</button>}
          {!archive && <><button type="button" className="btn" disabled={index < 1} onClick={() => onCommit({ kind: "move", path, target: siblings[index - 1]!, after: false })}><ArrowUp aria-hidden="true" />Move up</button>
            <button type="button" className="btn" disabled={index < 0 || index === siblings.length - 1} onClick={() => onCommit({ kind: "move", path, target: siblings[index + 1]!, after: true })}><ArrowDown aria-hidden="true" />Move down</button></>}
          <button type="button" className="btn" disabled={Boolean(taskCount || children.length)} onClick={() => onPanel({ path, mode: "delete" })}><Trash2 aria-hidden="true" />Delete empty project</button>
        </div> : <>
          {mode === "rename" && <label>Project name<input className="input" autoFocus ref={field} value={value} pattern="[^/]+" maxLength={120} required onChange={event => setValue(event.target.value)} /></label>}
          {mode === "merge" && <label>Merge into<select autoFocus required className="select" value={value} onChange={event => setValue(event.target.value)}><option value="">Choose a project</option>{destinations.map(name => <option key={name}>{name}</option>)}</select></label>}
          {mode === "merge" && <p>Move {taskCount} {taskCount === 1 ? "task" : "tasks"} and {children.length} {children.length === 1 ? "subproject" : "subprojects"} into the destination. Task details and history stay with each task.</p>}
          {mode === "archive" && <p>Hide this project and its tasks from active views. Restore it from Archive whenever you need it.</p>}
          {mode === "delete" && <p>Permanently remove this empty project.</p>}
          <footer><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="submit" className="btn btn-primary" disabled={(mode === "merge" || mode === "rename") && !value.trim()}><ArrowUpRight aria-hidden="true" />{label}</button></footer>
        </>}
      </fieldset>
    </form>
  </div>;
}
