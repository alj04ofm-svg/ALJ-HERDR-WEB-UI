/** The owner's reusable English work briefs. Selecting one edits a draft; Send stays explicit. */
export const WORK_PROMPTS = {
  plan: `Plan the work we are discussing. Use the latest request, the available project instructions and current evidence. If the goal is implicit, state your best read of it and flag the assumption.

Give up to three outcomes in dependency order. For each, say what would make it done, what to verify, and what could block it. End with the first concrete action and any decision that genuinely needs me. Keep this pass to planning.`,
  update: `Give me a status update on the work we are discussing. Check the current artifacts or recent results you can access and reconcile them with the agreed goal.

Start with what I can use now and link to it when possible. Then give what's in progress, what is blocked, and the next action. Distinguish live, verified locally, and unverified when that difference matters. If you cannot check something, say what evidence is missing. Keep this pass to reporting.`,
  audit: `Audit the current work against its goal and how people actually use it. Inspect the relevant artifacts first and follow the main journey from input to outcome. Check likely failures such as incorrect results, lost data, permission mistakes, inaccessible controls, or poor recovery where they apply.

Rank the findings by impact and give evidence. Fix the highest-value issues already in scope, then check the affected behavior. Report what you reproduced, what you fixed, how you verified it, and what still needs attention.`,
  continue: `Pick up the unfinished work from this conversation. Identify the latest agreed outcome, what is already done, and the next step that advances it. Preserve decisions, constraints, drafts and work in progress.

Carry out that step and any authorized work it unlocks. Keep changes narrow and check the result. If something is blocked, continue independent work and tell me exactly what is needed. If there is no active task, say so briefly.`,
  finish: `Finish the agreed work. Compare the current result with the acceptance criteria and identify the smallest set of remaining steps needed to make it usable.

Do the authorized steps, verify the complete outcome in its normal workflow, and deliver it through the project's established process when allowed. Preserve existing data and active work. Give me the result or link, the checks you ran, and any concrete blocker or limitation.`,
  team: `Complete the current task. If this environment and the project permit delegation, assign independent pieces to the smallest useful team. Give each person or agent a clear deliverable, ownership boundary and verification target. Work directly if delegation is unavailable or offers no advantage.

Keep one coordinator accountable for shared resources, integration and verification. Deliver the combined result and give a concise rundown of what was checked and what still needs attention.`,
  design: `Improve how people use the current deliverable. Start from its intended audience, established identity and primary action. Inspect what exists, then identify the largest sources of friction, confusion or inconsistency.

Make a small set of high-impact changes. Preserve the content and preferences people already rely on. For an interface, check representative screen sizes, keyboard operation, readability and motion where affected. For a document or other artifact, review the real reading or viewing flow. Tell me what improved and what you verified.`,
  handoff: `Bring the current work to a usable checkpoint. Finish safe steps already in scope, verify the result, and leave enough context for someone else to resume without rereading the conversation.

Record the goal, result, relevant links or paths, what you checked, what is live, and the next exact step. Use the existing project handoff location if there is one. Identify anything still blocked and the input needed to proceed.`,
} as const;

export type WorkPromptId = keyof typeof WORK_PROMPTS;

/** Preserve an existing voice note or draft; refuse a prompt that would be silently truncated. */
export function appendWorkPrompt(draft: string, id: WorkPromptId, maxLength: number): string | null {
  const next = draft.trim().length === 0 ? WORK_PROMPTS[id] : `${draft}\n\n${WORK_PROMPTS[id]}`;
  return next.length <= maxLength ? next : null;
}
