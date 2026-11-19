import { useEffect, useRef, useState } from "react";
import { Cloud } from "lucide-react";
import type { SharedWorkspacePreferences } from "../../shared/protocol.ts";
import { applyWorkspaceSnapshot, useWorkspacePreferences, workspaceSnapshot } from "../lib/workspacePreferences.ts";
import { fetchSharedWorkspace, saveSharedWorkspace, WorkspaceSyncError } from "../lib/workspaceSync.ts";
import { useT } from "../lib/i18n.ts";
import "./WorkspaceSync.css";

export function WorkspaceSync() {
  const t = useT(), preferences = useWorkspacePreferences();
  const [preview, setPreview] = useState<{ shared: SharedWorkspacePreferences; local: string } | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [failed, setFailed] = useState(false);
  const active = useRef(true), inFlight = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const local = JSON.stringify({ tabs: preferences.tabs, prompts: preferences.prompts });
  const current = preview?.local === local ? preview : null;
  const run = async (save: boolean) => {
    if (inFlight.current || save && !current) return;
    inFlight.current = true; setBusy(true); setMessage(""); setFailed(false);
    const captured = JSON.stringify(workspaceSnapshot());
    setPreview(null);
    try {
      const shared = save ? await saveSharedWorkspace(current!.shared.revision, JSON.parse(captured)) : await fetchSharedWorkspace();
      if (!active.current) return;
      if (JSON.stringify(workspaceSnapshot()) !== captured) {
        setFailed(true); setMessage(t("This device changed. Check the shared workspace again before replacing anything."));
      } else {
        setPreview({ shared, local: captured });
        if (save) setMessage(t("Saved to this server. Open Saved prompts on your other device to load it."));
      }
    } catch (error) {
      if (!active.current) return;
      setFailed(true);
      setMessage(error instanceof WorkspaceSyncError && error.kind === "unavailable" ? t("This server does not support shared workspace yet. Your device data is unchanged.")
        : error instanceof WorkspaceSyncError && error.kind === "conflict" ? t("Another device changed the shared workspace. Check again before saving.")
        : error instanceof WorkspaceSyncError && error.kind === "unknown" ? t("Save result is unconfirmed. Check the shared workspace before trying again.")
        : t("Could not access the shared workspace. Check your connection and access."));
    } finally { inFlight.current = false; if (active.current) setBusy(false); }
  };
  return <details className="workspace-sync"><summary><Cloud aria-hidden="true" />{t("Across your devices")}</summary>
    <p className="field-hint">{t("Share pins, settled tabs and saved prompt text through this server. Drafts, attachments and pending messages stay on this device. Nothing is sent to an agent.")}</p>
    <button className="btn" type="button" disabled={busy} onClick={() => void run(false)}>{busy ? t("Loading…") : t("Check shared workspace")}</button>
    {current && <div className="workspace-sync-preview">
      <p>{t("On server: {tabs} tab preferences, {prompts} saved prompts.", { tabs: Object.keys(current.shared.data.tabs).length, prompts: current.shared.data.prompts.length })}</p>
      <p>{t("On this device: {tabs} tab preferences, {prompts} saved prompts.", { tabs: Object.keys(preferences.tabs).length, prompts: preferences.prompts.length })}</p>
      <p className="field-hint">{t("Choose which copy to keep. Loading replaces this device’s pins, settled tabs and saved prompts; saving replaces the server copy. This is manual sharing, not automatic sync.")}</p>
      <div className="workspace-sync-actions"><button className="btn" type="button" disabled={busy} onClick={() => {
        const ok = applyWorkspaceSnapshot(current.shared.data, current.local); setPreview(null); setFailed(!ok);
        setMessage(ok ? t("Loaded on this device. Your drafts are unchanged.") : t("Could not load on this device. Check browser storage and check the shared workspace again."));
      }}>{t("Load server copy")}</button><button className="btn" type="button" disabled={busy} onClick={() => void run(true)}>{t("Save this device’s copy")}</button></div>
    </div>}
    {message && <p className="field-hint" role={failed ? "alert" : "status"}>{message}</p>}
  </details>;
}
