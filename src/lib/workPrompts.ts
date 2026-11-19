/** The owner's reusable English work briefs. Selecting one edits a draft; Send stays explicit. */
export const WORK_PROMPTS = {
  plan: `Plan the current project from its actual state. Read the project instructions, agreed goals and existing progress notes; preserve active work and name anything you cannot verify.

Choose the three most valuable outcomes, ordered by impact, urgency and dependencies. For each, give the next concrete action, responsible existing owner, definition of done, evidence needed and any genuine blocker. Separate essential work from optional improvements. Use estimates only when supported.

Finish with the best first action. This is a planning request: do not change the project, start agents or rerun expensive checks just to make the plan.`,
  update: `Give me an evidence-backed update on the work assigned to this tab. Reconcile the agreed goal with the actual files, running work and existing check results; do not rely on old summaries alone.

Explain what is usable now, what is deployed, what exists only in tested source, what is in progress, what remains and what is blocked. Include important defects, missing dependencies, risks and decisions, with concrete evidence and links where available. Separate facts from assumptions and flag unknowns plainly.

Finish with the next actions in priority order and the exact input needed for each blocker. Be thorough without repeating the conversation. This is a status request: preserve the project and reuse valid evidence instead of launching new work or expensive checks.`,
  audit: `Audit this project end to end against the agreed goal and the real user journey, then fix the important issues within the scope already authorized. Read the project instructions and inspect the actual implementation and interface.

Cover functionality, unfinished features, navigation, forms, data integrity, authorization boundaries, error recovery, loading and empty states, accessibility, desktop and phone layouts, performance, reliability and deployment. Trace important paths from user action to saved result. Rank findings by impact; distinguish reproduced failures, code-supported risks and unverified hypotheses. Give each finding evidence and a concrete remedy.

Complete the highest-value authorized fixes without damaging working features, user preferences, data or active work. Coordinate shared resources, run focused checks and verify affected real interactions. Keep the audit and correction pass bounded; do not invent findings or start an endless polish loop.

Report coverage, findings, fixes, actual checks, remaining limitations and live versus source status. Ask only for a real missing decision or approval required by the project's rules; otherwise continue useful work.`,
  continue: `Continue the unfinished work assigned to this tab toward its agreed outcome. Reconcile the latest instructions, existing task list, actual source, live state and active owners before acting. Preserve earlier constraints and completed work; do not restart the project or repeat completed actions.

Pick the next useful task that is ready, resolve dependencies in order and carry authorized work through implementation, focused checks, integration and deployment when already allowed. Coordinate shared resources and avoid duplicate agents, jobs or external actions. When one task is blocked, record the exact missing input and continue independent work.

Keep going until the agreed outcome is usable and verified, or no authorized progress remains. Give brief updates only when something meaningful changes. Finish with what actually works, evidence or a usable link, remaining blockers and the next action. Do not claim completion from a plan or passing build alone.`,
  finish: `Finish the entire current agreed scope, including the small missing pieces that prevent real use. Compare the acceptance criteria with actual behavior and existing evidence, make a finite remaining-work list, then execute it in dependency order.

Implement, integrate, check and, where authorized, deploy the result through the normal process with rollback available. Verify the complete user journey and affected desktop and phone interactions. Preserve user data, preferences, working features, active jobs and unrelated changes. Reuse valid checks; repeat only where changes or unresolved risk justify it.

Do not stop at suggestions or ask whether to continue work that is already authorized. Respect genuine spending, deletion, security and external-action boundaries. If a required step is blocked, state precisely what prevents it and complete independent work first.

Return the usable result or live link, what you actually clicked or checked, material limitations and any exact blocker. Mark the task complete only when its acceptance criteria are met.`,
  team: `Complete this tab’s agreed task. Use a small team of specialists if the workspace allows delegation. First read the project instructions, reconcile active owners and identify work that can safely proceed in parallel. Use sub-agents only where the environment and project rules support them; otherwise explain the limit and continue directly.

Choose the fewest specialists needed, such as implementation, design, testing or research. Give each a concrete deliverable, acceptance criteria and non-overlapping file or task ownership. Share the goal and constraints, keep one coordinator responsible for integration, and avoid duplicate work, standing agents and competing builds or deployments. Use a separate reviewer only for changes that warrant independent review.

Integrate the specialists' results, resolve conflicts and verify the combined result yourself. Continue through authorized delivery; do not present delegated work as complete before it is integrated and checked. Close temporary agents when finished. Preserve data, active work, resource locks and approval boundaries; this prompt does not authorize new spending or outside contact.

Report the result, each specialist's contribution, combined verification, usable link when deployed and any remaining blocker.`,
  design: `Review and improve this product's design and usability using its established identity and real user tasks. Inspect the interface before editing.

Check hierarchy, spacing, typography, consistency, navigation, readability, touch targets, keyboard access, contrast, responsive layouts and honest loading, empty, error and success states. Find clutter, hidden controls, unnecessary steps and slow interactions. Preserve factual content, working features and user preferences.

Implement the few changes that make the biggest practical difference within the authorized scope. Use shared components and design tokens; make the main action and current state obvious. Verify the affected journey at desktop and phone widths. Check keyboard operation and reduced motion wherever the change affects them.

Report what improved, why it helps, what was checked, what remains and whether it is live. Do not claim perfection or keep making cosmetic passes after acceptance.`,
  handoff: `Close out the current task with a verified result and a useful handoff. Read the agreed goal, project instructions, latest changes and existing check results; compare them with the acceptance criteria and actual user journey.

Complete safe remaining work already authorized. Run only checks justified by changes or unresolved risks. If deployment is authorized and ready, finish through the normal process with rollback and verify the served result. Otherwise name the precise missing prerequisite. Preserve active work and user data; do not infer permission for new spending, deletion, outside contact or unrelated restarts.

Update the existing handoff document when the project workflow calls for it: goal, changes, verified results, paths or links, live versus source status, limitations and next exact action. Release owned resources and close temporary agents. End with a concise owner update. Never label unchecked or blocked work complete.`,
} as const;

export type WorkPromptId = keyof typeof WORK_PROMPTS;

/** Preserve an existing voice note or draft; refuse a prompt that would be silently truncated. */
export function appendWorkPrompt(draft: string, id: WorkPromptId, maxLength: number): string | null {
  const next = draft.trim().length === 0 ? WORK_PROMPTS[id] : `${draft}\n\n${WORK_PROMPTS[id]}`;
  return next.length <= maxLength ? next : null;
}
