import { describe, expect, test } from "bun:test";
import { appendWorkPrompt, WORK_PROMPTS } from "./workPrompts.ts";

describe("work prompt draft safety", () => {
  test("keeps an existing voice note verbatim before the brief", () => {
    const draft = "  Check the models hub first.\nKeep the live agents running.  ";
    const next = appendWorkPrompt(draft, "audit", 20_000);
    expect(next).toBe(`${draft}\n\n${WORK_PROMPTS.audit}`);
  });

  test("blank drafts become editable briefs without leading whitespace", () => {
    expect(appendWorkPrompt(" \n ", "update", 20_000)).toBe(WORK_PROMPTS.update);
  });

  test.each(["continue", "finish", "team", "priority", "screenshot", "live", "sharing", "recover", "experiment"] as const)("%s stays editable and preserves a dictated request", (id) => {
    const draft = "First fix the existing owner report. Keep the live jobs running.";
    expect(appendWorkPrompt(draft, id, 20_000)).toBe(`${draft}\n\n${WORK_PROMPTS[id]}`);
    expect(appendWorkPrompt(draft, id, draft.length)).toBeNull();
  });

  test("accepts exact capacity and refuses overflow without truncation", () => {
    const draft = "Review the phone layout.";
    const length = draft.length + 2 + WORK_PROMPTS.design.length;
    expect(appendWorkPrompt(draft, "design", length)).toBe(`${draft}\n\n${WORK_PROMPTS.design}`);
    expect(appendWorkPrompt(draft, "design", length - 1)).toBeNull();
    expect(appendWorkPrompt("", "design", WORK_PROMPTS.design.length - 1)).toBeNull();
  });
});
