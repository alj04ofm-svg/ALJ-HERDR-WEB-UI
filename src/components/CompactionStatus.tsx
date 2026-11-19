import { useEffect, useState } from "react";
import { Layers } from "lucide-react";
import type { ConversationMetadata } from "../../shared/protocol.ts";
import { useT } from "../lib/i18n.ts";
import { usePageVisible } from "../lib/visibility.ts";

export function CompactionStatus({ value }: { value: NonNullable<ConversationMetadata["compaction"]> }) {
  const t = useT();
  const visible = usePageVisible();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!visible || value.state !== "running") return;
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, [visible, value.state]);
  if (value.state !== "running") return null;
  const started = value.started_at ? Date.parse(value.started_at) : NaN;
  const seconds = Number.isFinite(started) ? Math.max(0, Math.floor((now - started) / 1000)) : null;
  return <aside className="chat-compaction-status">
    <div role="status"><Layers aria-hidden="true" /><strong>{t("Compacting context")}</strong></div>
    <p>{t("Summarizing earlier context so work can continue. Your conversation stays here.")}</p>
    <div className="chat-compaction-track" role="progressbar" aria-label={t("Compacting context")} />
    <small>{seconds !== null && <span aria-hidden="true">{t("Observed for {seconds}s", { seconds })} · </span>}{t("Time remaining is not reported by the agent.")}</small>
  </aside>;
}
