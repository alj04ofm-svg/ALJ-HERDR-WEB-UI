import type { ConversationPart } from "../../shared/protocol.ts";
import { recentActivity } from "../lib/liveActivity.ts";
import { useT } from "../lib/i18n.ts";
import "./LiveActivity.css";

/** Derived from the transcript already on screen; no requests, timers or model usage. */
export function LiveActivity({ parts }: { parts: readonly ConversationPart[] }) {
  const t = useT();
  const groups = recentActivity(parts);
  if (groups.length === 0) return null;
  return <ol className="live-activity-digest" aria-label={t("Recorded activity")}>
    {groups.map((group, index) => <li key={`${index}:${group.label}`}>
      <span>{group.label}</span>
      <span className="live-activity-count">{t(group.count === 1 ? "{n} action" : "{n} actions", { n: group.count })}</span>
      {group.failed > 0 && <span className="live-activity-failed">{t("{n} failed", { n: group.failed })}</span>}
    </li>)}
  </ol>;
}
