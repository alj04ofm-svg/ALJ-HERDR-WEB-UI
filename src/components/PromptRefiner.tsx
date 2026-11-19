import { useEffect, useRef, useState } from "react";
import { Sparkles, Undo2, X } from "lucide-react";
import { fetchRefineStatus, refinePrompt, ApiError } from "../lib/api.ts";
import { useT } from "../lib/i18n.ts";

/** The textarea is the review surface. A rewrite never sends, silently retries or overwrites edits. */
export function PromptRefiner({ text, agent, disabled, active, onApply, onNote }: {
  text: string; agent: string | null; disabled: boolean; active: boolean;
  onApply(text: string): void; onNote(note: string | null, error?: boolean): void;
}) {
  const t = useT();
  const pending = useRef<AbortController | null>(null);
  const current = useRef({ text, disabled, active });
  current.current = { text, disabled, active };
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [undo, setUndo] = useState<{ before: string; after: string } | null>(null);
  useEffect(() => () => { pending.current?.abort(); pending.current = null; }, []);
  useEffect(() => { if ((!active || disabled) && pending.current) { pending.current.abort(); pending.current = null; setBusy(false); onNote(null); } }, [active, disabled, onNote]);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const check = () => { void fetchRefineStatus(controller.signal).then((ready) => { if (!controller.signal.aborted) setAvailable(ready); }).catch(() => { if (!controller.signal.aborted) setAvailable(false); }); };
    check(); window.addEventListener("focus", check);
    return () => { controller.abort(); window.removeEventListener("focus", check); };
  }, [active]);
  const refine = async () => {
    if (pending.current || disabled || !available || !active || !text.trim()) return;
    const before = text;
    const request = new AbortController();
    pending.current = request; setBusy(true); onNote(t("Refining prompt…"));
    try {
      const after = await refinePrompt(before, agent, AbortSignal.any([request.signal, AbortSignal.timeout(100_000)]));
      if (pending.current !== request || !current.current.active) return;
      if (current.current.disabled || current.current.text !== before) { onNote(t("Your draft changed while refining. Your edits were kept; refine again when ready.")); return; }
      setUndo({ before, after }); onApply(after); onNote(t("Prompt refined. Review it before sending."));
    } catch (error) {
      if (pending.current !== request || request.signal.aborted) return;
      onNote(error instanceof ApiError && error.code === "refine_not_configured"
        ? t("Sign in to Codex on the server to refine prompts.")
        : t("Could not refine the prompt. Your draft is unchanged. Try again."), true);
    } finally { if (pending.current === request) { pending.current = null; setBusy(false); } }
  };
  return <>
    <button className="composer-work-prompts composer-refine" type="button" aria-label={t(busy ? "Cancel refinement" : "AI rewrite")} title={t(busy ? "Cancel refinement" : available ? "Rewrite with Codex Luna · High, then review before sending" : "Prompt refinement needs an updated server and Codex sign-in")} disabled={!busy && (disabled || !active)} aria-busy={busy} onClick={() => {
      if (busy) { pending.current?.abort(); pending.current = null; setBusy(false); onNote(null); } else if (!available) onNote(t("Sign in to Codex on the server to refine prompts."), true);
      else if (!text.trim()) onNote(t("Write a draft first. AI rewrite edits it for review; it never sends."));
      else void refine();
    }}>{busy ? <X aria-hidden="true" /> : <Sparkles aria-hidden="true" />}<span>{t("AI rewrite")}</span></button>
    {undo && text === undo.after && <button className="icon-button" type="button" aria-label={t("Undo refinement")} title={t("Undo refinement")} disabled={disabled || busy} onClick={() => { onApply(undo.before); setUndo(null); onNote(null); }}><Undo2 aria-hidden="true" /></button>}
    {busy && <span className="visually-hidden" role="status">{t("Refining prompt…")}</span>}
  </>;
}
