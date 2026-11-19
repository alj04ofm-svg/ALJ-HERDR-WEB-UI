import { useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { Layers, X } from "lucide-react";
import type { ConversationMetadata } from "../../shared/protocol.ts";
import { useT } from "../lib/i18n.ts";
import { useFocusTrap } from "../lib/useFocusTrap.ts";
import { usePhoneSheetBack } from "../lib/sheetHistory.ts";
import "./ContextDetails.css";

export function ContextDetails({ metadata, onClose }: { metadata: ConversationMetadata | null; onClose(): void }) {
  const t = useT();
  const id = useId();
  const dialog = useFocusTrap<HTMLDivElement>(true);
  usePhoneSheetBack(onClose);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing) { event.preventDefault(); event.stopPropagation(); onClose(); }
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [onClose]);
  const number = (value: number | undefined | null) => value == null ? t("Not reported") : value.toLocaleString();
  return createPortal(<div className="fm-tools-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="fm-tools context-details" role="dialog" aria-modal="true" aria-labelledby={id} ref={dialog} tabIndex={-1}>
      <header className="fm-tools-heading"><div><h2 id={id}><Layers aria-hidden="true" />{t("Context and tokens")}</h2><p>{t("Native measurements. No extra AI calls.")}</p></div><button type="button" className="icon-button" aria-label={t("Close")} onClick={onClose}><X aria-hidden="true" /></button></header>
      <div className="context-details-body">
        <dl className="context-metrics">
          <div><dt>{t("Latest request tokens")}</dt><dd>{number(metadata?.context?.used)}</dd></div>
          <div><dt>{t("Context window")}</dt><dd>{number(metadata?.context?.window)}</dd></div>
          <div><dt>{t("Session tokens processed")}</dt><dd>{number(metadata?.tokens?.total)}</dd></div>
          <div><dt>{t("Cached input tokens")}</dt><dd>{number(metadata?.tokens?.cached_input)}</dd></div>
          <div><dt>{t("Output tokens")}</dt><dd>{number(metadata?.tokens?.output)}</dd></div>
        </dl>
        <p>{t("Session totals count repeated requests and cached input. They are not your current context size or subscription usage.")}</p>
        <h3>{t("Automatic compaction")}</h3>
        <p>{t("Managed by the agent. Its effective threshold is not reported here; this workspace does not change it.")}</p>
        {metadata?.compaction?.completed_at && <p>{t("Last compaction: {time}", { time: new Date(metadata?.compaction.completed_at).toLocaleString() })}</p>}
        <p>{t("Compaction summarizes earlier context so work can continue. Your conversation remains in the native history. Duration and completion percentage are not reported.")}</p>
      </div>
    </div>
  </div>, document.body);
}
