import { useCallback, useState } from "react";
import { Bookmark, CalendarCheck, ClipboardList, Flag, Play, CheckCheck, ChevronDown, Users, RotateCcw, ScanLine, SlidersHorizontal } from "lucide-react";
import { PromptLibrary } from "./PromptLibrary.tsx";
import { useWorkspacePreferences } from "../lib/workspacePreferences.ts";
import { RowMenu } from "./RowMenu.tsx";
import { useT } from "../lib/i18n.ts";
import type { WorkPromptId } from "../lib/workPrompts.ts";
import "./WorkPrompts.css";

/** One entry point for the owner's recurring briefs, using the app's native menu/sheet. */
export function WorkPrompts({ onChoose, disabled, draft, draftKey, onInsert }: { onChoose(id: WorkPromptId): void; disabled: boolean; draft: string; draftKey: string; onInsert(text: string): void }) {
  const t = useT();
  const preferences = useWorkspacePreferences();
  const [library, setLibrary] = useState(false);
  const closeLibrary = useCallback(() => setLibrary(false), []);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = useCallback(() => setAnchor(null), []);
  return <>
    <button type="button" className="composer-work-prompts composer-briefs" disabled={disabled} aria-label={t("Work prompts")} aria-haspopup="menu" aria-expanded={anchor !== null} title={t("Work prompts")} onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}><ClipboardList aria-hidden="true" /><span>{t("Work prompts")}</span><ChevronDown className="composer-briefs-chevron" aria-hidden="true" /></button>
    {library && <PromptLibrary draft={draft} onInsert={onInsert} onClose={closeLibrary} />}
    {anchor && <RowMenu anchor={anchor} align="start" variant="descriptions" title={t("Work prompts")} subtitle={t("Adds an editable brief to your message.")} onClose={close} items={[
      { id: "continue", label: t("Continue all work"), icon: Play, hint: t("Resume unfinished work without repeating completed actions"), run: () => onChoose("continue") },
      { id: "plan", label: t("Plan the day"), icon: CalendarCheck, hint: t("Priorities, outcomes, dependencies and first action"), run: () => onChoose("plan") },
      { id: "update", label: t("Full update"), icon: ClipboardList, hint: t("Progress, evidence, blockers and next steps"), run: () => onChoose("update") },
      { id: "finish", divider: true, label: t("Finish everything"), icon: CheckCheck, hint: t("Complete the agreed scope through verified delivery"), run: () => onChoose("finish") },
      { id: "team", label: t("Specialist team"), icon: Users, hint: t("Delegate clear tasks, integrate and verify the result"), run: () => onChoose("team") },
      { id: "audit", label: t("Audit and improve"), icon: ScanLine, hint: t("Find gaps, fix authorized issues and verify"), run: () => onChoose("audit") },
      { id: "design", label: t("Design review"), icon: SlidersHorizontal, hint: t("Improve clarity, usability and visual polish"), run: () => onChoose("design") },
      { id: "handoff", label: t("Finish and hand off"), icon: Flag, hint: t("Verify the outcome and leave a clear handoff"), run: () => onChoose("handoff") },
      { id: "library", divider: true, label: t("Saved prompts"), icon: Bookmark, hint: t("Your reusable briefs on this device"), run: () => setLibrary(true) },
      ...(preferences.previous[draftKey] ? [{ id: "recall", label: t("Recall previous prompt"), icon: RotateCcw, hint: t("Adds text to your draft; does not resend"), run: () => onInsert(preferences.previous[draftKey]!) }] : []),
    ]} />}
  </>;
}
