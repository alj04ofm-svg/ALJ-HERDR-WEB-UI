import type { ConversationMetadata } from "../shared/protocol.ts";
import { paneRead } from "./herdr/client.ts";

/** Only a native status row, never an arbitrary mention in prose/tool output. */
export function isCodexCompacting(screen: string): boolean {
  return screen.split(/\r?\n/).some((line) => /^\s*[•●◦]\s+Compacting (?:context|conversation)(?:…|\.{3})(?:\s*\([^\n]*\))?\s*$/i.test(line));
}
const observed = new Map<string, string>();
export function forgetCodexMaintenance(paneId?: string): void {
  if (paneId === undefined) observed.clear(); else observed.delete(paneId);
}
/** Display-only: no inputs, model requests, timers or status subscriptions. */
export async function codexMaintenance(paneId: string, metadata: ConversationMetadata): Promise<ConversationMetadata> {
  try {
    const screen = await paneRead({ paneId, source: "visible", lines: 80, stripAnsi: true });
    if (isCodexCompacting(screen.text)) {
      const started = observed.get(paneId) ?? new Date().toISOString();
      observed.delete(paneId); observed.set(paneId, started);
      if (observed.size > 64) observed.delete(observed.keys().next().value!);
      return { ...metadata, compaction: { state: "running", started_at: started, completed_at: null } };
    }
    observed.delete(paneId);
  } catch { observed.delete(paneId); }
  return metadata;
}
