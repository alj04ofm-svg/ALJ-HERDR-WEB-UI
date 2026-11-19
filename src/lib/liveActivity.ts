import { patchFiles, patchText } from "../../shared/patch.ts";
import type { ConversationPart } from "../../shared/protocol.ts";
import { toolVerbKind } from "./toolVerbs.ts";
import { isTodoTool } from "./todos.ts";
import { t } from "./i18n.ts";

function commandActivity(input: string): "tests" | "types" | "build" | null {
  let args: unknown;
  try { args = JSON.parse(input); } catch { return null; }
  if (typeof args !== "object" || args === null) return null;
  const command = (args as Record<string, unknown>)["cmd"] ?? (args as Record<string, unknown>)["command"];
  if (typeof command !== "string") return null;
  // Recognize a simple runner invocation, never quoted code, arbitrary prose or tool output.
  const match = /^(?:bun|npm|pnpm|yarn)\s+(?:run\s+)?(test(?:[\w:-]*)|vitest|jest|playwright|typecheck|check:types|tsc|build)(?:\s|$)/.exec(command.trim());
  if (!match) return null;
  return /^(typecheck|check:types|tsc)$/.test(match[1]!) ? "types" : match[1] === "build" ? "build" : "tests";
}

/** Describe the latest recorded action, without claiming completion or inferring a percentage. */
export function latestActivity(parts: readonly ConversationPart[]): string | null {
  for (let index = parts.length - 1; index >= 0; index--) {
    const part = parts[index]!;
    if (part.kind === "thinking") return t("Thinking…");
    if (part.kind !== "tool") continue;
    if (part.error) return t("Latest action failed");
    if (isTodoTool(part.name)) return t("Latest: plan update");
    if (part.skill) return t("Latest: skill instructions");
    const kind = toolVerbKind(part.name, part.input);
    if (kind === "read") return t("Latest: file read");
    if (kind === "edit" || kind === "write") return t("Latest: file edit");
    if (kind === "run") {
      const command = commandActivity(part.input);
      if (command === "tests") return t("Latest: running tests");
      if (command === "types") return t("Latest: checking types");
      if (command === "build") return t("Latest: building the app");
      return t("Latest: command run");
    }
    if (/^(grep|glob|search|find|web_search|web\.run|web__run)$/i.test(part.name)) return t("Latest: search");
    if (/^(task|spawn_agent|collaboration\.spawn_agent)$/i.test(part.name)) return t("Latest: task coordination");
    return t("Other activity");
  }
  return null;
}

/** Three recent groups of recorded calls, not inferred outcomes or generated commentary. */
export function recentActivity(parts: readonly ConversationPart[]): { label: string; count: number; failed: number }[] {
  const groups: { label: string; count: number; failed: number }[] = [];
  for (const part of parts) {
    if (part.kind !== "tool" || part.skill || isTodoTool(part.name)) continue;
    const kind = toolVerbKind(part.name, part.input);
    const label = kind === "read" ? t("File reads") : kind === "edit" || kind === "write" ? t("File edits")
      : kind === "run" ? t("Terminal commands") : /^(grep|glob|search|find|web_search|web\.run|web__run)$/i.test(part.name) ? t("Searches") : t("Other activity");
    const previous = groups.at(-1);
    if (previous?.label === label) { previous.count++; previous.failed += Number(part.error === true); }
    else { groups.push({ label, count: 1, failed: Number(part.error === true) }); if (groups.length > 3) groups.shift(); }
  }
  return groups;
}


/** File paths explicitly named in tool inputs. Shell commands and prose are not parsed as paths. */
export function recordedFiles(parts: readonly ConversationPart[]): string[] {
  const paths = new Set<string>();
  for (let index = parts.length - 1; index >= 0 && paths.size < 20; index--) {
    const part = parts[index]!;
    if (part.kind !== "tool" || part.skill || part.arguments_omitted) continue;
    const patch = patchText(part.input);
    if (patch !== null) {
      for (const path of patchFiles(patch)) paths.add(path);
      continue;
    }
    const verb = toolVerbKind(part.name, part.input);
    if (verb !== "read" && verb !== "edit" && verb !== "write") continue;
    try {
      const input = JSON.parse(part.input) as Record<string, unknown> | null;
      const path = input?.file_path ?? input?.notebook_path ?? input?.path;
      if (typeof path === "string" && path.trim() && !/[\r\n]/.test(path)) paths.add(path.trim());
    } catch {
      // An unstructured tool argument has no reliable file path.
    }
  }
  return [...paths].slice(0, 20);
}
