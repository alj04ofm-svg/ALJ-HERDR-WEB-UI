import { archivedProject } from "../lib/taskProjects.ts";
import { useContext, useEffect, useState } from "react";
import { ClipboardList } from "lucide-react";
import { createTaskStore, taskClock, taskElapsed, useTaskStore } from "../lib/workspaceTasks.ts";
import { TaskBoardContext } from "../lib/taskBoardContext.ts";
import { useT } from "../lib/i18n.ts";
import "./TaskSidebarButton.css";

export function TaskSidebarButton({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const context = useContext(TaskBoardContext);
  const [fallback] = useState(createTaskStore);
  const store = context?.store ?? fallback;
  const open = Boolean(context?.mode);
  const [now, setNow] = useState(Date.now);
  const { snapshot, started, pending, unavailable } = useTaskStore(store);
  const tasks = snapshot?.tasks.filter(task => !task.archived && !archivedProject(snapshot, task.project) && task.stage !== "done") ?? [];
  const active = tasks
    .filter(task => task.stage === "doing")
    .reduce<(typeof tasks)[number] | null>((best, task) => {
      const at = started.get(task.id) ?? task.updated_at;
      return !best || Date.parse(at) > Date.parse(started.get(best.id) ?? best.updated_at) ? task : best;
    }, null);
  const startedAt = active && started.get(active.id);
  useEffect(() => {
    if (open) return;
    const refresh = () => {
      if (document.visibilityState === "visible") void store.load();
    };
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [open, store]);
  useEffect(() => {
    if (!startedAt) return;
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 30_000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  if (!context || (unavailable && !open)) return null;
  const remaining = `${tasks.length} open`;
  const meta = active
    ? startedAt ? `Started ${taskClock(startedAt)} · ${taskElapsed(startedAt, now)}` : `Updated ${taskClock(active.updated_at)}`
    : snapshot ? remaining : pending ? "Loading tasks" : "Open task board";
  const compactMeta = active ? startedAt ? taskElapsed(startedAt, now) : taskClock(active.updated_at) : snapshot ? remaining : "";
  const tasksLabel = t("Tasks");
  const label = active ? `${tasksLabel} · ${active.title} · ${meta} · ${remaining}` : `${tasksLabel} · ${meta}`;
  return <button type="button" className="task-sidebar-button" data-compact={compact} data-active={Boolean(active)}
      aria-haspopup="dialog" aria-expanded={open} aria-label={label} title={label} onClick={() => context.show("board")}>
      <span className="task-sidebar-icon"><ClipboardList aria-hidden="true" /></span>
      <span className="task-sidebar-copy" aria-hidden="true">
        <strong>{active?.title ?? tasksLabel}</strong>
        <small>{compact ? compactMeta : meta}</small>
      </span>
      {snapshot && active && <span className="task-sidebar-count" aria-hidden="true">{tasks.length}</span>}
    </button>;
}
