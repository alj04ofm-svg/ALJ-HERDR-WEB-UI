import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Boxes, Check, RotateCcw, Workflow, X } from "lucide-react";
import type { PluginActions, PluginAction } from "../../shared/protocol.ts";
import { useMachineApi } from "../lib/machineContext.tsx";
import { Ownership, runPluginActionToEnd } from "../lib/pluginRun.ts";
import { useFocusTrap } from "../lib/useFocusTrap.ts";
import { usePhoneSheetBack } from "../lib/sheetHistory.ts";
import { useSheetSwipe } from "../lib/sheets.ts";
import { withReadDeadline } from "../lib/readDeadline.ts";
import { useT } from "../lib/i18n.ts";

import "./WorkspaceTools.css";

const WEB_ACTIONS: Record<string, string> = {
  "cloudmanic.herdr-plus.projects": "layouts", "cloudmanic.herdr-plus.quick-actions": "quick-actions",
  "herdr-projects.open-popup": "projects", "herdr-projects.new": "new-project", "herdr-projects.adopt-workspace": "adopt", "herdr-projects.doctor": "project-check",
  "herdr-workflows.launch": "workflows", "ntindle.herdr-resurrect.save": "save", "ntindle.herdr-resurrect.snapshots": "snapshots", "ntindle.herdr-resurrect.restore-preview": "preview",
};
const TOOL_ACTIONS: Record<string, readonly string[]> = {
  "cloudmanic.herdr-plus": ["projects", "quick-actions"],
  "herdr-projects": ["open-popup", "new", "adopt-workspace", "doctor"],
  "herdr-workflows": ["launch"],
  "ntindle.herdr-resurrect": ["save", "snapshots", "restore-preview"],
};

export function WorkspaceTools({ paneId, onClose, onOpened, onAllActions }: {
  paneId: string | null;
  onClose(): void;
  onOpened(paneId: string): void;
  onAllActions(): void;
}) {
  const t = useT();
  const api = useMachineApi();
  const dialog = useFocusTrap<HTMLDivElement>(true);
  const owner = useRef(new Ownership());
  const [plugins, setPlugins] = useState<PluginActions[] | null>(null);
  const [actionNames, setActionNames] = useState<Record<string, string>>({});
  const [running, setRunning] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useSheetSwipe(dialog, onClose);
  usePhoneSheetBack(() => { onClose(); });

  useEffect(() => {
    const claims = owner.current;
    const alive = claims.claim();
    const controller = new AbortController();
    void withReadDeadline((signal) => api.fetchPluginActions(signal), 10_000, controller.signal).then(
      (list) => { if (alive()) { setPlugins(list.filter((p) => TOOL_ACTIONS[p.plugin_id])); setActionNames(Object.fromEntries((list.find((p) => p.plugin_id === "fm.workspace-tools")?.actions ?? []).map((a) => [a.action_id, a.title]))); } },
      (err: unknown) => { if (alive()) setError(err instanceof Error ? err.message : String(err)); },
    );
    return () => { claims.end(); controller.abort(); };
  }, [api]);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      event.preventDefault(); event.stopPropagation(); onClose();
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [onClose]);

  async function run(plugin: PluginActions, action: PluginAction) {
    // A workspace action needs the user's explicit pane, never another client's focus.
    if (running !== null || paneId === null) return;
    const alive = owner.current.claim();
    setRunning(`${plugin.plugin_id}.${action.action_id}`); setError(null); setNotice(null);
    try {
      const result = await runPluginActionToEnd(api, { plugin_id: "fm.workspace-tools", action_id: WEB_ACTIONS[`${plugin.plugin_id}.${action.action_id}`]!, pane_id: paneId }, alive);
      if (!result) return;
      if (result.status === "failed") setError(result.output ?? t("Action failed."));
      else if (result.opened_pane_id !== null) onOpened(result.opened_pane_id);
      else setNotice(t("Action completed. Interactive tools open in the terminal."));
    } catch (err) { if (alive()) setError(err instanceof Error ? err.message : String(err)); }
    finally { if (alive()) setRunning(null); }
  }

  return <div className="fm-tools-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="fm-tools" role="dialog" aria-modal="true" aria-labelledby="fm-tools-title" tabIndex={-1} ref={dialog}>
      <header className="fm-tools-heading"><div><h2 id="fm-tools-title">{t("Workspace tools")}</h2><p>{t("Your upgrades, connected to this workspace.")}</p></div><button className="icon-button" aria-label={t("Close")} onClick={onClose}><X /></button></header>
      <div className="fm-tools-list">
        {plugins === null && !error && <p role="status">{t("Loading…")}</p>}
        {plugins?.length === 0 && <p>{t("No plugins installed.")}</p>}
        {plugins?.map((plugin) => <section className="fm-tool" key={plugin.plugin_id}>
          <div className="fm-tool-icon" aria-hidden="true">{plugin.plugin_id === "herdr-workflows" ? <Workflow /> : plugin.plugin_id === "ntindle.herdr-resurrect" ? <RotateCcw /> : <Boxes />}</div>
          <div className="fm-tool-content"><div className="fm-tool-heading"><h3>{plugin.name}</h3><span>v{plugin.version}</span></div>
            <p>{plugin.plugin_id === "cloudmanic.herdr-plus" ? t("Saved layouts and quick actions.") : plugin.plugin_id === "herdr-projects" ? t("Coordinate tasks and shared project memory.") : plugin.plugin_id === "herdr-workflows" ? t("Run repeatable, explicitly chosen workflows.") : t("Save your session or preview recovery.")}</p>
            <div className="fm-tool-actions">{plugin.actions.filter((a) => TOOL_ACTIONS[plugin.plugin_id]?.includes(a.action_id)).map((action) => <button className="btn" key={action.action_id} disabled={running !== null || !plugin.enabled || paneId === null} onClick={() => void run(plugin, action)} aria-busy={running === `${plugin.plugin_id}.${action.action_id}`}>{running === `${plugin.plugin_id}.${action.action_id}` ? t("Running…") : actionNames[WEB_ACTIONS[`${plugin.plugin_id}.${action.action_id}`]!] ?? action.title}<ArrowUpRight aria-hidden="true" /></button>)}</div>
          </div>
        </section>)}
      </div>
      {error && <p className="fm-tools-result is-error" role="alert">{error}</p>}
      {notice && <p className="fm-tools-result" role="status"><Check aria-hidden="true" />{notice}</p>}
      <footer className="fm-tools-footer"><span>{t("Nothing runs until you choose an action.")}</span><button className="btn btn-ghost" onClick={onAllActions}>{t("All actions")}<ArrowUpRight aria-hidden="true" /></button></footer>
    </div>
  </div>;
}
