import { useCallback, useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, RefreshCw, X } from "lucide-react";
import type { ConversationMetadata } from "../../shared/protocol.ts";
import type { PaneModelSettings } from "../../shared/protocol.ts";
import { useMachineApi } from "../lib/machineContext.tsx";
import { modelLabel } from "../lib/modelName.ts";
import { useFocusTrap } from "../lib/useFocusTrap.ts";
import { useSheetSwipe } from "../lib/sheets.ts";
import { useT } from "../lib/i18n.ts";
import "./ModelControl.css";

export function ModelControl({ paneId, agent, metadata, connected }: { paneId: string; agent: string | null; metadata?: ConversationMetadata | null; connected: boolean }) {
  const t = useT();
  const api = useMachineApi();
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<PaneModelSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const id = useId();
  const trap = useFocusTrap<HTMLDivElement>(open);
  const close = useCallback(() => { if (!busy) setOpen(false); }, [busy]);
  useSheetSwipe(trap, open && !busy ? close : null);
  const accept = useCallback((next: PaneModelSettings) => { setSettings(next); setModel(next.model ?? ""); setEffort(next.effort ?? ""); }, []);
  // Always re-read native values after reload; never persist a cosmetic model preference.
  useEffect(() => {
    let live = true; setSettings(null); setError(""); setNotice(""); setOpen(false); setLoading(false);
    if (agent === "codex" && connected) {
      setLoading(true);
      void api.fetchPaneModelSettings(paneId).then(next => { if (live) accept(next); }).catch(() => {}).finally(() => { if (live) setLoading(false); });
    }
    return () => { live = false; };
  }, [paneId, agent, connected, api, accept]);
  useEffect(() => {
    if (!open) return;
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.isComposing) { e.preventDefault(); e.stopPropagation(); close(); } };
    window.addEventListener("keydown", escape, true); return () => window.removeEventListener("keydown", escape, true);
  }, [open, close]);
  const refresh = async () => {
    setLoading(true); setError(""); setNotice("");
    try { accept(await api.fetchPaneModelSettings(paneId)); }
    catch (e) { setError(e instanceof Error ? e.message : t("Could not read native settings. Try Refresh.")); }
    finally { setLoading(false); }
  };
  const apply = async (field: "model" | "effort") => {
    if (!settings?.supported || !settings.thread_id || !settings.model || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const actual = await api.changePaneModelSettings({ pane_id: paneId, expected: { thread_id: settings.thread_id, model: settings.model, effort: settings.effort }, ...(field === "model" ? { model } : { effort }) });
      accept(actual); setNotice(t("Applied."));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Could not apply native settings. Refresh before retrying."));
      // A timeout is an unknown outcome: read once, never retry a mutation.
      try { accept(await api.fetchPaneModelSettings(paneId)); } catch { setSettings(null); }
    } finally { setBusy(false); }
  };
  const native = settings?.supported;
  const shownModel = native ? settings.model : metadata?.model;
  const shownEffort = native ? settings.effort : metadata?.reasoning_effort;
  const label = shownModel ? modelLabel(shownModel) : null;
  const current = settings?.models.find(m => m.id === settings.model);
  return <>
    <button type="button" className="composer-model-info model-control" aria-label={t("Model and reasoning")} aria-haspopup="dialog" aria-expanded={open}
      title={native ? t("Change model or reasoning effort") : t("Last recorded settings. Open to check native controls.")} onClick={() => { setOpen(true); void refresh(); }}>
      <span className={`composer-model${label?.named ? "" : " is-id"}`}>{label?.text ?? t("Model —")}</span>
      {shownEffort && <span className="composer-reasoning"><span className="composer-reasoning-dot" aria-hidden="true">·</span><span className="composer-reasoning-short">{shownEffort}</span></span>}
      <ChevronDown className="model-control-chevron" aria-hidden="true" />
    </button>
    {open && createPortal(<div className="modal-scrim" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal model-settings" ref={trap} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1} aria-busy={busy || loading}>
        <header><h2 id={id}>{t("Model and reasoning")}</h2><button type="button" className="icon-button" aria-label={t("Close")} onClick={close} disabled={busy}><X aria-hidden="true" /></button></header>
        {loading && <p role="status">{t("Reading native settings…")}</p>}
        {!loading && !native && !error && <p role="status">{settings?.reason ?? t("Native settings are unavailable. Try Refresh.")}</p>}
        {native && <>
          <div className="model-settings-field"><label htmlFor={`${id}-model`}>{t("Model")}</label><div><select className="select" id={`${id}-model`} value={model} onChange={e => setModel(e.target.value)} disabled={busy || loading}>
            {!settings.models.some(m => m.id === settings.model) && <option value={settings.model!}>{settings.model} ({t("Current")})</option>}
            {settings.models.map(m => <option key={m.id} value={m.id}>{m.label}{m.id === settings.model ? ` (${t("Current")})` : ""}</option>)}
          </select><button type="button" className="btn" disabled={!connected || busy || loading || model === settings.model} onClick={() => void apply("model")}>{t("Apply model")}</button></div></div>
          <div className="model-settings-field"><label htmlFor={`${id}-effort`}>{t("Reasoning effort")}</label><div><select className="select" id={`${id}-effort`} value={effort} onChange={e => setEffort(e.target.value)} disabled={busy || loading || !current?.efforts.length}>
            {!current?.efforts.some(e => e.id === settings.effort) && <option value={settings.effort ?? ""}>{settings.effort ?? t("Not reported")}</option>}
            {current?.efforts.map(e => <option key={e.id} value={e.id}>{e.id}{e.id === settings.effort ? ` (${t("Current")})` : ""}</option>)}
          </select><button type="button" className="btn" disabled={!connected || busy || loading || !effort || effort === settings.effort} onClick={() => void apply("effort")}>{t("Apply effort")}</button></div>
          </div>
          <p className="model-settings-note">{t("For this session’s next turn.")}</p>
        </>}
        {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
        <footer><button type="button" className="btn" disabled={busy || loading || !connected} onClick={() => void refresh()}><RefreshCw aria-hidden="true" />{t("Refresh")}</button><button type="button" className="btn" disabled={busy} onClick={close}>{t("Done")}</button></footer>
      </div>
    </div>, document.body)}
  </>;
}
