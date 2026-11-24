import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Gauge, RefreshCw, X } from "lucide-react";

import "./UsageMeters.css";

import type { ProviderUsage, UsageWindow } from "../../shared/protocol.ts";
import { useT, type Translate } from "../lib/i18n.ts";
import { useSettings, type UsageCount, type UsageGlance } from "../lib/settings.ts";
import { formatPercent, formatRate, formatResetIn, formatRunsOut, glanceWindow, HIGH_PERCENT, meterPercent, meterText, sidebarUsage, PROVIDER_MARK, PROVIDER_NAME, usageName, useUsage, windowLabel, windowPace } from "../lib/usage.ts";
import { AgentMark } from "./AgentMark.tsx";

/** chips the strip beside Settings holds before the rest fold into "+N" */
const MAX_CHIPS = 4;

function level(window: UsageWindow | null): string {
  return window !== null && window.used_percent >= HIGH_PERCENT ? " is-high" : "";
}

/** Why the numbers shown are old or missing; null while they are fresh. */
function problemText(t: Translate, usage: ProviderUsage): string | null {
  const name = PROVIDER_NAME[usage.id];
  return usage.problem === "expired" ? t("Sign-in expired. Open {name} to renew it.", { name })
    : usage.problem === "rate_limited" ? t("{name} asked to slow down. These are the last numbers.", { name })
    : usage.problem === "failed" ? t("{name} could not be reached.", { name })
    : usage.problem === "locked" ? t("The server cannot open the keychain holding this sign-in.")
    : null;
}

/** An expired sign-in or an unreachable provider is an error; slowed down or locked, the last numbers stand. */
function isError(usage: ProviderUsage): boolean {
  return usage.problem === "expired" || usage.problem === "failed";
}

/** "Runs out in 2d 4h" when the limit runs out before it resets at the pace so far; null when it lasts. */
function runsOutText(usage: ProviderUsage, window: UsageWindow | null, now: number): string | null {
  return window && formatRunsOut(window, usage.checked_at, now);
}

function Chip({ usage, count, glance, now, paced }: { usage: ProviderUsage; count: UsageCount; glance: UsageGlance; now: number; paced: boolean }) {
  const window = glanceWindow(usage, glance);
  // the hairline warns of a limit that runs out before it resets while its share is still low
  const fast = paced && runsOutText(usage, window, now) !== null;
  return (
    <span className={`usage-chip${level(window)}${fast ? " is-fast" : ""}${usage.problem ? " has-problem" : ""}`}>
      <AgentMark agent={PROVIDER_MARK[usage.id]} size={14} />
      <span className="usage-chip-value">{window ? formatPercent(meterPercent(window, count)) : "—"}</span>
      <span className="usage-chip-bar" style={{ "--fill": `${window ? meterPercent(window, count) : 0}%` } as CSSProperties} />
    </span>
  );
}

function Provider({ usage, now, count, paced }: { usage: ProviderUsage; now: number; count: UsageCount; paced: boolean }) {
  const t = useT();
  const name = PROVIDER_NAME[usage.id];
  const problem = problemText(t, usage);
  const checked = Date.parse(usage.checked_at ?? "");
  const checkedText = Number.isFinite(checked) ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(checked) : null;
  return (
    <section className="usage-provider" aria-label={usageName(usage)}>
      <header className="usage-provider-head">
        <AgentMark agent={PROVIDER_MARK[usage.id]} size={16} />
        <span className="usage-provider-name">{name}</span>
        {usage.plan && <span className="usage-plan">{usage.plan}</span>}
        {usage.account && <span className="usage-account" title={usage.account}>{usage.account}</span>}
      </header>
      {checkedText && <p className="usage-note">{t("Last refreshed {time}", { time: checkedText })}</p>}
      {problem && <p className={`usage-note${isError(usage) ? " is-problem" : ""}`}>{problem}</p>}
      {usage.windows.map((window, index) => {
        const reset = formatResetIn(window.resets_at, now);
        const value = meterPercent(window, count);
        // Settings → Subscription usage → Show pace, off by default
        const pace = paced ? windowPace(window, usage.checked_at, now) : null;
        const runsOut = paced ? runsOutText(usage, window, now) : null;
        return (
          <div key={index} className={`usage-row${level(window)}`}>
            <span className="usage-row-label">{windowLabel(window)}</span>
            <span className="usage-row-value">{meterText(window, count)}</span>
            <span className="usage-bar" role="meter" aria-label={windowLabel(window)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-valuetext={meterText(window, count)}>
              {/* a sliver above 0 still shows as a bar, not a dot */}
              <span style={{ width: value > 0 ? `max(4px, ${value}%)` : 0 }} />
              {/* where an even pace would be by now, counted as the bar counts: used past it, or left short of it, is ahead of pace */}
              {pace && <i className="usage-bar-pace" style={{ left: `${count === "left" ? 100 - pace.elapsed * 100 : pace.elapsed * 100}%` }} />}
            </span>
            {reset && <span className="usage-row-reset" title={window.resets_at && Number.isFinite(Date.parse(window.resets_at)) ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(Date.parse(window.resets_at)) : undefined}>{t("Resets in {time}", { time: reset })}</span>}
            {pace && pace.perHour > 0 && (
              <span className="usage-row-pace">
                {formatRate(window, pace)}
                {runsOut && <span className="usage-row-runs-out"> · {runsOut}</span>}
              </span>
            )}
          </div>
        );
      })}
      {usage.windows.length === 0 && !problem && <p className="usage-note">{t("No limits reported")}</p>}
    </section>
  );
}

/**
 * The plan limits of the subscriptions signed in on the server's PC, beside Settings: per
 * provider its logo and the limit chosen in Settings (week or session); the whole strip opens every limit
 * with its reset time.
 */
const RAIL_WINDOW = { session: "5h", day: "24h", week: "7d", month: "1mo" } as const;

function RailMeter({ usage, count, glance }: { usage: ProviderUsage; count: UsageCount; glance: UsageGlance }) {
  const t = useT();
  const name = usage.id === "opencode" ? "OpenCode Go" : PROVIDER_NAME[usage.id];
  const window = glanceWindow(usage, glance);
  const windows = (usage.id === "opencode" || usage.id === "codex") && usage.windows.length > 0
    ? usage.windows
    : window ? [window] : [];
  return <span className="usage-rail-provider">
    <span className="usage-rail-name" title={usageName(usage)}>
      <AgentMark agent={PROVIDER_MARK[usage.id]} size={11} /><span data-short={usage.id === "opencode" ? "OC Go" : undefined}>{name}</span>
    </span>
    {usage.problem && <span className="usage-rail-stale" aria-hidden="true" />}
    {windows.length > 0 ? windows.map((item, index) =>
      <span key={index} className={`usage-rail-limit${level(item)}`} title={`${windowLabel(item)} · ${meterText(item, count)}`}
        aria-label={`${windowLabel(item)} · ${meterText(item, count)}`}>
        <span>{item.scope ?? RAIL_WINDOW[item.kind]}</span><strong>{formatPercent(meterPercent(item, count))}</strong>
      </span>) : <span className="usage-rail-limit">—</span>}
    {usage.problem && <span className="usage-rail-problem">{problemText(t, usage)}</span>}
  </span>;
}

export function UsageMeters({ open, onOpenChange, compact = false }: { open: boolean; onOpenChange(open: boolean): void; compact?: boolean }) {
  const t = useT();
  const { settings, update } = useSettings();
  const { report, loading, refresh } = useUsage(settings.showUsage);
  const [otherAccounts, setOtherAccounts] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const headingId = useId();

  // reset countdowns and run-out warnings move on between reports, popover closed or open
  useEffect(() => {
    if (!settings.showUsage) return;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, [settings.showUsage, open]);
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const updatePosition = () => {
      const bounds = triggerRef.current?.getBoundingClientRect();
      const sidebar = triggerRef.current?.closest(".sidebar-shell")?.getBoundingClientRect();
      const viewport = window.visualViewport;
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;
      const panelWidth = Math.min(width - 24, Math.max(230, (sidebar?.width ?? 350) - 24), 332);
      const anchored = Boolean(bounds && bounds.width && bounds.top > 188 && bounds.top < height && bounds.right > 0 && bounds.left >= 0 && bounds.left < width);
      dialog.classList.toggle("is-anchored", anchored);
      if (anchored && bounds) {
        dialog.style.setProperty("--usage-width", `${panelWidth}px`);
        dialog.style.setProperty("--usage-left", `${Math.max(12, Math.min(bounds.left, width - panelWidth - 12))}px`);
        dialog.style.setProperty("--usage-bottom", `${height - bounds.top + 8}px`);
        dialog.style.setProperty("--usage-max-height", `${Math.min(410, bounds.top - 20)}px`);
      }
    };
    updatePosition();
    if (!dialog.open) dialog.showModal();
    window.addEventListener("resize", updatePosition);
    window.visualViewport?.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.visualViewport?.removeEventListener("resize", updatePosition);
    };
  }, [open]);

  const close = () => {
    dialogRef.current?.close();
    onOpenChange(false);
  };

  const count = settings.usageCount;
  // an account hidden in Settings is left out of the strip and the popover alike
  const shown = report ? sidebarUsage(report.providers, settings.usageOrder, settings.usageHidden, otherAccounts) : [];
  const visible = shown.length > 0 || otherAccounts || !report
    ? shown
    : sidebarUsage(report.providers, settings.usageOrder, settings.usageHidden, true);
  const folded = shown.length > MAX_CHIPS ? shown.length - (MAX_CHIPS - 1) : 0;
  const chips = folded > 0 ? shown.slice(0, MAX_CHIPS - 1) : shown;
  const summary = shown.map((usage) => {
    const window = glanceWindow(usage, settings.usageGlance);
    const runsOut = settings.usagePace ? runsOutText(usage, window, now) : null;
    return `${usageName(usage)} ${window ? meterText(window, count) : "—"}${runsOut ? ` (${runsOut})` : ""}`;
  }).join(", ");

  return (
    <div className={`usage${compact ? " is-rail" : ""}`}>
      <button
        type="button"
        className="usage-strip"
        ref={triggerRef}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t("Subscription usage")}
        aria-describedby={compact && shown.length > 0 ? `${headingId}-rail` : undefined}
        title={compact && shown.length > 0 ? undefined : summary || t("Subscription usage")}
        onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); onOpenChange(true); }}
      >
        {compact && shown.length > 0 ? <>
          <span className="usage-rail-header"><Gauge aria-hidden="true" /><span>{t(count === "left" ? "Remaining" : "Used")}</span></span>
          <span className="usage-rail-meters" id={`${headingId}-rail`}>
            {shown.map(usage => <RailMeter key={usage.key} usage={usage} count={count} glance={settings.usageGlance} />)}
          </span>
        </> : <>
        <Gauge aria-hidden="true" /><span className="usage-label">{t("Usage")}</span>
        {chips.map((usage) => <Chip key={usage.key} usage={usage} count={count} glance={settings.usageGlance} now={now} paced={settings.usagePace} />)}
        {folded > 0 && <span className="usage-more">+{folded}</span>}
        </>}
      </button>
      {open && createPortal(
        <dialog
          ref={dialogRef}
          className="usage-popover"
          aria-labelledby={headingId}
          onClick={(event) => {
            if (event.target !== event.currentTarget) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
          }}
          onCancel={(event) => { event.preventDefault(); close(); }}
        >
          <header className="usage-popover-head">
            <h2 id={headingId}>{t("Subscription usage")}</h2>
            <div className="usage-popover-actions">
              {settings.showUsage && <button type="button" className="icon-button" aria-label={t("Refresh")} title={t("Refresh")} aria-busy={loading} onClick={() => { if (!loading) refresh(); }}>
                <RefreshCw aria-hidden="true" className={loading ? "is-spinning" : undefined} />
              </button>}
              <button type="button" className="icon-button" aria-label={t("Close")} title={t("Close")} autoFocus onClick={close}>
                <X aria-hidden="true" />
              </button>
            </div>
          </header>
          <div className="usage-popover-body">
            {!settings.showUsage ? <>
              <p className="usage-note">{t("Enable to read subscription limits for accounts signed in on this server.")}</p>
              <button type="button" className="btn btn-ghost" onClick={() => update({ showUsage: true })}>{t("Show plan limits")}</button>
            </> : visible.length === 0 && <p className="usage-note" role="status">{loading ? t("Loading…") : !report ? t("Usage is unavailable. Refresh to try again.") : report.providers.length > 0 && report.providers.every((usage) => settings.usageHidden.includes(usage.key)) ? t("Accounts are hidden in Settings → Subscription usage.") : t("No subscription limits reported. Native token counts are under Context.")}</p>}
            {visible.map((usage) => <Provider key={usage.key} usage={usage} now={now} count={count} paced={settings.usagePace} />)}
            {settings.showUsage && (otherAccounts || shown.some((usage) => usage.problem !== "expired")) && report?.providers.some((usage) => usage.problem === "expired" && !settings.usageHidden.includes(usage.key)) && <button type="button" className="btn btn-ghost" aria-expanded={otherAccounts} onClick={() => setOtherAccounts(!otherAccounts)}>{t(otherAccounts ? "Hide other accounts" : "Other accounts")}</button>}
          </div>
        </dialog>,
        document.body,
      )}
    </div>
  );
}
