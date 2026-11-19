/** GET /api/pane/model-settings?pane_id=… reads the existing native session only.
 * POST takes one changed field plus the exact settings read by the user; it never starts a turn.
 * Codex controls use its running local app-server. Other runtimes report unsupported explicitly.
 */
export interface ModelChoice {
  id: string;
  label: string;
  efforts: { id: string; description: string }[];
}
export interface PaneModelSettings {
  supported: boolean;
  reason: string | null;
  thread_id: string | null;
  model: string | null;
  effort: string | null;
  models: ModelChoice[];
}
export interface ModelSettingsChange {
  pane_id: string;
  expected: { thread_id: string; model: string; effort: string | null };
  model?: string;
  effort?: string;
}
