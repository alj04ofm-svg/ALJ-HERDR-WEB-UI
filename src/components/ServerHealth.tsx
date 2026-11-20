import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Activity, RefreshCw, X } from "lucide-react";
import type { ServerHealth as Health } from "../../shared/protocol.ts";
import { fetchServerHealth } from "../lib/api.ts";
import { useT } from "../lib/i18n.ts";
import { useFocusTrap } from "../lib/useFocusTrap.ts";
import { usePhoneSheetBack } from "../lib/sheetHistory.ts";
import "./ServerHealth.css";

const size = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
export function ServerHealth({ anchor, onClose }: { anchor: HTMLElement; onClose(): void }) {
  const t = useT();
  const dialog = useFocusTrap<HTMLDivElement>(true);
  const [health, setHealth] = useState<Health | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const refresh = useRef<() => void>(() => {});
  const [top, setTop] = useState(52);
  const [right, setRight] = useState(8);
  usePhoneSheetBack(onClose);
  useLayoutEffect(() => {
    const position = () => {
      const rect = anchor.getBoundingClientRect();
      setTop(rect.bottom + 6);
      const width = Math.min(332, window.innerWidth - 16);
      setRight(Math.min(window.innerWidth - width - 8, Math.max(8, window.innerWidth - rect.right)));
    };
    position();
    window.addEventListener("resize", position);
    return () => window.removeEventListener("resize", position);
  }, [anchor]);
  useEffect(() => {
    let alive = true;
    let pending = false;
    let controller: AbortController | null = null;
    const read = async () => {
      if (!alive || pending || document.hidden) return;
      pending = true; setBusy(true);
      controller = new AbortController();
      const timeout = window.setTimeout(() => controller?.abort(), 10_000);
      try { const value = await fetchServerHealth(controller.signal); if (alive) { setHealth(value); setFailed(false); } }
      catch { if (alive) setFailed(true); }
      finally { window.clearTimeout(timeout); pending = false; if (alive) setBusy(false); }
    };
    refresh.current = () => void read();
    void read();
    const timer = window.setInterval(() => void read(), 15_000);
    const visible = () => { if (!document.hidden) void read(); };
    document.addEventListener("visibilitychange", visible);
    return () => { alive = false; controller?.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.isComposing) { event.preventDefault(); event.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [onClose]);
  const rows = health ? [
    { label: t("Memory available"), value: size(health.memory.available_bytes), detail: t("{amount} total", { amount: size(health.memory.total_bytes) }), optimum: 1, used: health.memory.available_bytes / health.memory.total_bytes },
    { label: t("Disk available"), value: health.disk ? size(health.disk.available_bytes) : t("Not reported"), detail: health.disk ? t("{amount} total", { amount: size(health.disk.total_bytes) }) : "", optimum: 1, used: health.disk ? health.disk.available_bytes / health.disk.total_bytes : null },
    { label: t("Swap used"), value: health.swap ? size(health.swap.total_bytes - health.swap.free_bytes) : t("Not reported"), detail: health.swap ? t("{amount} total", { amount: size(health.swap.total_bytes) }) : "", optimum: 0, used: health.swap && health.swap.total_bytes > 0 ? 1 - health.swap.free_bytes / health.swap.total_bytes : null },
  ] : [];
  return createPortal(<div className="server-health-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div style={{ top, right }} className="server-health" role="dialog" aria-modal="true" aria-labelledby="server-health-title" ref={dialog} tabIndex={-1}>
      <header className="fm-tools-heading"><div><h2 id="server-health-title"><Activity aria-hidden="true" />{t("VPS health")}</h2><p>{t("The server hosting this workspace. Updates while this panel is open.")}</p></div><button className="icon-button" title={t("Refresh")} aria-label={t("Refresh")} disabled={busy} onClick={() => refresh.current()}><RefreshCw aria-hidden="true" /></button><button className="icon-button" aria-label={t("Close")} onClick={onClose}><X aria-hidden="true" /></button></header>
      <div className="server-health-body">
        {failed && <p className="server-health-error" role="alert">{t("Health refresh failed. Retry to get current measurements.")}</p>}
        {!health && !failed && <p role="status">{t("Loading…")}</p>}
        {health && <>
          <div className="server-health-load"><span>{t("CPU load · 1 / 5 / 15 min")}</span><strong>{health.load_average?.map((value) => value.toFixed(2)).join(" / ") ?? t("Not reported")}</strong><small>{t("{n} CPU cores · load is demand, not CPU usage", { n: health.cpu_count })}</small></div>
          <dl className="server-health-metrics">{rows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd><strong>{row.value}</strong><span>{row.detail}</span></dd>{row.used !== null && <meter min={0} max={1} low={0.2} high={0.8} optimum={row.optimum} value={Math.max(0, Math.min(1, row.used))} aria-label={row.label} />}</div>)}</dl>
          <p className="server-health-meta">{t("Uptime: {hours} hours", { hours: Math.floor(health.uptime_seconds / 3600) })} · {health.platform}</p>
          <p className="server-health-meta">{t("Measured at {time}", { time: new Date(health.measured_at).toLocaleTimeString() })}{failed ? ` · ${t("Last successful reading")}` : ""}</p>
        </>}
      </div>
    </div>
  </div>, document.body);
}
