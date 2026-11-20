import type { TaskSnapshot } from "../../shared/tasks.ts";

export const PROJECT_SEPARATOR = " / ";
export const inProject = (path: string, root: string) => path === root || path.startsWith(root + PROJECT_SEPARATOR);
export const projectParent = (path: string) => path.split(PROJECT_SEPARATOR).slice(0, -1).join(PROJECT_SEPARATOR);
export const projectLabel = (path: string) => path.split(PROJECT_SEPARATOR).at(-1) ?? path;
export const archivedProject = (snapshot: TaskSnapshot | null, path: string) =>
  snapshot?.archived_projects?.find(root => inProject(path, root));

export function taskProjects(snapshot: TaskSnapshot | null): string[] {
  if (!snapshot) return [];
  const inherited = [...snapshot.tasks.map(task => task.project), ...(snapshot.archived_projects ?? [])]
    .filter(Boolean).sort((a, b) => a.localeCompare(b));
  return [...new Set([...(snapshot.projects ?? []), ...inherited])];
}

export type ProjectChange =
  | { kind: "rename" | "merge"; path: string; target: string }
  | { kind: "move"; path: string; target: string; after: boolean }
  | { kind: "archive" | "restore" | "delete"; path: string };

export function changeTaskProjects(snapshot: TaskSnapshot, change: ProjectChange): TaskSnapshot | string {
  const { path, kind } = change;
  const projects = taskProjects(snapshot);
  const archives = snapshot.archived_projects;
  if (!projects.includes(path)) return "This project is no longer on the board.";
  if (kind === "archive" || kind === "restore") {
    if (!archives) return "Update the bridge to archive projects.";
    return { ...snapshot, projects, archived_projects: kind === "restore" ? archives.filter(root => root !== path) : [...new Set([...archives, path])] };
  }
  if (kind === "delete") {
    if (snapshot.tasks.some(task => inProject(task.project, path)) || projects.some(name => name !== path && inProject(name, path))) {
      return "Move the tasks and subprojects before deleting this project.";
    }
    return { ...snapshot, projects: projects.filter(name => name !== path), ...(archives && { archived_projects: archives.filter(root => root !== path) }) };
  }
  if (kind === "move") {
    if (path === change.target || !projects.includes(change.target) || projectParent(path) !== projectParent(change.target)) {
      return "Reorder projects within the same parent.";
    }
    const reordered = projects.filter(name => name !== path);
    reordered.splice(reordered.indexOf(change.target) + Number(change.after), 0, path);
    return { ...snapshot, projects: reordered };
  }
  if (kind !== "rename" && kind !== "merge") return snapshot;
  const { target } = change;
  if (target === path) return "Choose a different project name.";
  if (inProject(target, path) || inProject(path, target)) return "Choose a separate project.";
  if (kind === "rename" && projects.some(name => inProject(name, target))) return "A project already uses that name.";
  if (kind === "merge" && (!projects.includes(target) || archivedProject(snapshot, target))) return "Choose an active project.";
  const rewrite = (name: string) => inProject(name, path) ? target + name.slice(path.length) : name;
  // A nested archive must not hide existing destination work, or vice versa.
  if (kind === "merge" && archives?.some(root => inProject(root, path)
    ? projects.some(name => !inProject(name, path) && inProject(name, rewrite(root)))
    : projects.some(name => inProject(name, path) && inProject(rewrite(name), root)))) {
    return "Restore overlapping archived subprojects before merging.";
  }
  return {
    ...snapshot,
    projects: [...new Set(projects.flatMap(name => kind === "merge" && name === path ? [] : [rewrite(name)]))],
    tasks: snapshot.tasks.map(task => inProject(task.project, path) ? { ...task, project: rewrite(task.project) } : task),
    ...(archives && { archived_projects: [...new Set(archives.map(rewrite))] }),
  };
}
