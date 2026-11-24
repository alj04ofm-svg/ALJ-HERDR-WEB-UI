/** The owner's reusable English work briefs. Selecting one edits a draft; Send stays explicit. */
export const WORK_PROMPTS = {
  plan: `Look at the latest request, the project rules and current work. Pick up to three outcomes, in the order that removes the biggest dependency or gets something usable in my hands fastest.

For each, give the smallest useful deliverable, its acceptance check, and the risk most likely to break the plan. If my request is broad, name what you would defer and why. End with the first move and any decision that genuinely needs me. Keep this pass to planning.`,
  update: `Give me a status update I can act on. Check the actual deliverable and the latest available results before answering. Start with what I can use now, link it, and tell me how to open or try it.

Then cover what's left, the highest-impact blocker, and the next step currently under way. Distinguish source, preview, and live. If you know only that a build or fixture passed, say exactly that. Keep this pass to reporting.`,
  audit: `Audit the current deliverable through the real user journey. Inspect what exists, then follow the main action from the first click or command to the visible or saved result. Try a failure or recovery path wherever it could lose work, mislead the user, or expose private data.

Rank findings by impact and separate reproduced failures from code-supported risks. Fix the highest-value issues already in scope. Rerun the original journey and report the evidence, remaining issues, and live status.`,
  continue: `Pick up the latest unfinished request. Check the current worktree or deliverable and any active jobs before repeating an action. Preserve earlier decisions, drafts, and active work. If the latest instruction narrows the task, follow it.

Take the next authorized step and finish what it unlocks. If blocked, advance independent work and name the exact blocker. If everything is already done, tell me what I can use and how you know.`,
  finish: `Finish the agreed scope and take ownership through delivery. Compare each requested outcome with the current result, then do the smallest remaining work that makes it usable. Preserve existing data, preferences, and active jobs.

Verify the real workflow, ship through the authorized project process, and check the delivered version. Give me the link or usable result, the action you tested, and any concrete limitation. A passing build alone is an intermediate result.`,
  team: `If delegation is permitted and useful, give each specialist an independent deliverable, a clear editing boundary, and one verification target. Keep shared files, deployment, and the final decision with one coordinator. Work directly if delegation offers no advantage.

Resolve overlapping changes, integrate the result, and test the combined user journey. Report the result and anything still blocked.`,
  design: `Open the current interface or artifact and do the main thing a real user comes here to do. Find the three biggest moments of friction. Prioritize clarity, orientation, and the next action before styling. Keep the established identity, content, features, and user preferences.

Make a focused pass using the existing components and tokens. Check desktop and phone, keyboard, readability, and reduced motion where relevant. Test the same journey again and report the improvement and what is live.`,
  handoff: `Bring this work to a checkpoint another person or agent can use without rereading the thread. Finish authorized steps already in progress, verify the result, and preserve active work.

In the existing handoff location, record the goal, current result, relevant links or paths, what you actually checked, what's live, and the exact next action. Include any blocker and the smallest input that would clear it.`,
  priority: `Given what I've asked for and what's actually open, tell me the one move that creates the most value in the next hour. Compare it with the tempting lower-value work and tell me what can wait.

Give me a clear finish line and a fast reality check. If the next step is already authorized, take it and show me the result. Otherwise give me the decision in one sentence.`,
  screenshot: `Use the screenshot, error text, or behavior I just showed you as the starting point. Identify the visible symptom, then reproduce it on the closest authorized surface. Check the live and source versions if they may differ.

Trace the cause before changing anything. Make the smallest durable fix, repeat the action that failed, and check the nearest regression. If you only reproduced it in a fixture, say so. Keep screenshots and live data out of public changes.`,
  live: `Open the same URL, screen, or entry point I would use. Check that it serves the intended version, then perform the action that matters and inspect the result after refresh when persistence is relevant. Use an isolated account or fixture when the real action would affect data or active work.

If preview and live differ, locate the first point of drift and correct it through the approved process. Tell me what you clicked, what happened, and which parts used real services versus mocks.`,
  sharing: `Review the exact repo, build, link, or file I intend to share as if you were a stranger opening it. Look for credentials, private URLs and host paths, personal transcripts or tasks, config, screenshots, and unintended access in the shareable surface and relevant published history. Report locations without exposing secret values.

Verify which features work on a fresh install with the recipient's own accounts. Fix in-scope packaging or documentation issues. If exposure is confirmed, flag the action the owner needs before sharing. State what the checks covered.`,
  recover: `A job, deploy, connection, or integration looks stuck. Find the first failing step using the smallest useful probe. Distinguish a confirmed failure from an operation that may already have succeeded. Preserve partial outputs, open sessions, and pending work.

Recover or retry once the outcome is safe to repeat. Verify the original action from the user's side. If still blocked, explain what you ruled out and the exact external change needed.`,
  experiment: `Test the riskiest assumption behind the idea I just described. Define one observable success measure, then use the smallest viable prototype or before-and-after check. Keep it separate from live data and avoid creating infrastructure unless the test requires it.

Show the result, what surprised you, and whether to ship, revise, or drop it. If the evidence supports a small authorized improvement, land that improvement and verify it in the normal workflow.`,
} as const;

export type WorkPromptId = keyof typeof WORK_PROMPTS;

/** Preserve an existing voice note or draft; refuse a prompt that would be silently truncated. */
export function appendWorkPrompt(draft: string, id: WorkPromptId, maxLength: number): string | null {
  const next = draft.trim().length === 0 ? WORK_PROMPTS[id] : `${draft}\n\n${WORK_PROMPTS[id]}`;
  return next.length <= maxLength ? next : null;
}
