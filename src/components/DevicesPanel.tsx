import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Pencil, RefreshCw, Trash2, X } from "lucide-react";

import "./DevicesPanel.css";

import { ApiError, fetchDevices, pairDevice, renameDevice, revokeDevice, startPairing } from "../lib/api.ts";
import { copyText } from "../lib/clipboard.ts";
import { deviceLabel } from "../lib/phone.ts";
import type { HealthAuth, PairedDevice, PairingCode } from "../../shared/protocol.ts";
import { QrCode } from "./QrCode.tsx";
import { currentLocale, t as tt, useT } from "../lib/i18n.ts";

const POLL_MS = 3000;

export interface DevicesPanelProps {
  /** an address the phone can open right now (Settings → Phone knows it), for the QR code; null shows the code alone */
  pairUrl: string | null;
  /** how this browser got in */
  auth: HealthAuth | null;
  /** after this browser paired itself: the health check tells the rest of the app */
  onPaired?: () => void;
}

export const VIA: Record<NonNullable<HealthAuth["via"]>, string> = {
  local: "You are on the PC itself.",
  tailscale: "You are in as this PC's Tailscale login.",
  device: "This is a paired device.",
  token: "You are in with the access token.",
  open: "This browser is in only because nothing is paired yet: from anywhere that can reach this address, so would anyone.",
};

function lastSeen(value: string | null): string {
  if (value === null) return tt("never");
  const minutes = Math.round((Date.now() - Date.parse(value)) / 60_000);
  if (minutes < 2) return tt("just now");
  if (minutes < 60) return tt("{n} min ago", { n: minutes });
  if (minutes < 60 * 48) return tt("{n} h ago", { n: Math.round(minutes / 60) });
  return new Date(value).toLocaleDateString(currentLocale());
}

/** Settings → Devices: the paired devices, and a code to pair one more. */
export function DevicesPanel({ pairUrl, auth, onPaired }: DevicesPanelProps) {
  const t = useT();
  const [devices, setDevices] = useState<PairedDevice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [pairing, setPairing] = useState(false);
  /** the demo, or an older server: there is no device list here */
  const [unavailable, setUnavailable] = useState(false);
  const [code, setCode] = useState<PairingCode | null>(null);
  const [left, setLeft] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; label: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [justPaired, setJustPaired] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const known = useRef<Set<string> | null>(null);
  const issued = useRef<PairingCode | null>(null);
  const pairCodeFocus = useRef<HTMLParagraphElement>(null);
  const pairCard = useRef<HTMLDivElement>(null);
  const pairButton = useRef<HTMLButtonElement>(null);
  const restorePairFocus = useRef(false);

  const load = useCallback(async (watch = issued.current) => {
    try {
      const list = await fetchDevices();
      if (watch && issued.current !== watch) return;
      const previous = known.current;
      known.current = new Set(list.map((d) => d.id));
      setDevices(list);
      setListError(null);
      setUnavailable(false);
      if (watch && previous) {
        const fresh = list.find((d) => !previous.has(d.id));
        if (fresh) {
          restorePairFocus.current = Boolean(pairCard.current?.contains(document.activeElement));
          setJustPaired(fresh.label);
          issued.current = null;
          setCode(null);
        }
      }
    } catch (e) {
      if (watch && issued.current !== watch) return;
      if (e instanceof ApiError && e.status === 404) setUnavailable(true);
      setListError(e instanceof ApiError && e.status === 404 ? t("Devices are managed on a real server.") : e instanceof Error ? e.message : String(e));
    }
  }, [t]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (code) pairCodeFocus.current?.focus();
    else if (restorePairFocus.current) {
      restorePairFocus.current = false;
      pairButton.current?.focus();
    }
  }, [code]);

  // while a code is out: count it down, and watch for the device it lets in
  useEffect(() => {
    if (code === null) return;
    const tick = () => {
      const ms = Date.parse(code.expires_at) - Date.now();
      if (ms <= 0) {
        restorePairFocus.current = Boolean(pairCard.current?.contains(document.activeElement));
        issued.current = null;
        setCode(null);
        setError(t("The pairing code expired. Get a new code to connect your device."));
        return;
      }
      setLeft(`${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}`);
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    let stopped = false;
    let poll: number;
    const pollDevices = async () => {
      await load(code);
      if (!stopped) poll = window.setTimeout(() => void pollDevices(), POLL_MS);
    };
    poll = window.setTimeout(() => void pollDevices(), POLL_MS);
    return () => { stopped = true; window.clearInterval(timer); window.clearTimeout(poll); };
  }, [code, load]);

  const pair = async (self = false) => {
    if (pairing) return;
    setPairing(true);
    setJustPaired(null);
    setError(null);
    setLinkCopied(false);
    try {
      const fresh = await startPairing();
      if (self) {
        await pairDevice(fresh.code, deviceLabel(navigator.userAgent, navigator.maxTouchPoints ?? 0));
        issued.current = null;
        setCode(null);
        await load();
        onPaired?.();
      } else {
        issued.current = fresh;
        setCode(fresh);
      }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setPairing(false); }
  };
  const rename = async () => {
    if (!renaming) return;
    try { await renameDevice(renaming.id, renaming.label); setRenaming(null); await load(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const revoke = async (id: string) => {
    if (confirming !== id) { setConfirming(id); window.setTimeout(() => setConfirming((c) => (c === id ? null : c)), 4000); return; }
    setConfirming(null);
    try { await revokeDevice(id); await load(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const spaced = code ? `${code.code.slice(0, 3)} ${code.code.slice(3)}` : "";
  const qrValue = code && pairUrl ? `${pairUrl.replace(/\/$/, "")}/#pair=${code.code}` : null;

  return (
    <div className="devices-panel">
      {justPaired !== null && <p className="settings-hint" role="status">{t("Paired: {name}.", { name: justPaired })}</p>}
      {code === null ? (
        <div className="devices-pair-start">
          <div>
            <p className="settings-label">{t("Connect your phone")}</p>
            <p className="settings-description">{t("Get a six-digit code to sign in on another device.")}</p>
          </div>
          <button ref={pairButton} type="button" className="btn btn-primary" onClick={() => void pair()} disabled={unavailable || devices === null || pairing}>{t(pairing ? "Loading…" : "Pair a device")}</button>
        </div>
      ) : (
        <div className="devices-pairing" ref={pairCard}>
          <div className="devices-pair-details">
            <p className="settings-label">{t("On the other device, enter this code")}</p>
            <p ref={pairCodeFocus} tabIndex={-1} className="devices-code">{spaced}</p>
            <p className="settings-description">
              {t(qrValue !== null ? "Or scan the QR code: it opens the app with the code filled in." : "Open the app's address on that device and enter it.")}
              {left && <> {t("Expires in {time}.", { time: left })}</>}
            </p>
            {qrValue !== null && (
              <p className="devices-link">
                <span className="settings-description">{t("Or send this link to it:")}</span>
                <a ref={linkRef} href={qrValue}>{t("Pairing link")}</a>
                <button type="button" className="btn btn-ghost" onClick={() => void copyText(qrValue, linkRef.current).then((ok) => { if (ok) { setLinkCopied(true); window.setTimeout(() => setLinkCopied(false), 1600); } })}>{t(linkCopied ? "Copied" : "Copy")}</button>
              </p>
            )}
            <div className="phone-actions">
              <button type="button" className="btn" disabled={pairing} onClick={() => void pair()}><RefreshCw aria-hidden="true" />{t("New code")}</button>
              <button type="button" className="btn btn-ghost" disabled={pairing} onClick={() => { issued.current = null; restorePairFocus.current = true; setCode(null); }}>{t("Done")}</button>
            </div>
          </div>
          {qrValue !== null && <QrCode value={qrValue} label={t("Scan to pair this device")} />}
        </div>
      )}
      {auth?.via !== undefined && <p className={auth.via === "open" ? "settings-hint devices-open" : "settings-description"}>{t(VIA[auth.via])}</p>}
      {auth?.via === "open" && <div className="phone-actions"><button type="button" className="btn btn-primary" disabled={pairing} onClick={() => void pair(true)}>{t("Pair this device now")}</button></div>}
      <p className="settings-description">{t("A paired device gets in on its own, from anywhere it can reach this server, until you revoke it here. A code comes from this screen on the PC or on a device already paired, or from the pair command in the PC's terminal.")}</p>
      {listError && <div className="devices-load-error" role="status">
        <p className="settings-hint">{listError}</p>
        {!unavailable && <button type="button" className="btn" onClick={() => void load()}>{t("Retry")}</button>}
      </div>}
      {devices === null ? listError === null && <p className="settings-hint" role="status">{t("Loading…")}</p> : devices.length === 0 ? (
        <p className="settings-hint">{t("No devices paired yet.")}</p>
      ) : (
        <ul className="devices-list">
          {devices.map((d) => (
            <li key={d.id} className="devices-row">
              {renaming?.id === d.id ? (
                <form className="devices-rename" onSubmit={(e) => { e.preventDefault(); void rename(); }}>
                  <input className="input" value={renaming.label} maxLength={48} autoFocus aria-label={t("Device name")} onChange={(e) => setRenaming({ id: d.id, label: e.target.value })} />
                  <button type="submit" className="icon-button" aria-label={t("Save name")}><Check /></button>
                  <button type="button" className="icon-button" aria-label={t("Cancel")} onClick={() => setRenaming(null)}><X /></button>
                </form>
              ) : (
                <>
                  <div className="devices-name">
                    <span className="settings-label">{d.label}{d.current && <span className="devices-current">{t("this device")}</span>}</span>
                    <span className="settings-description">{t("Last seen {when}", { when: lastSeen(d.last_seen_at) })}</span>
                  </div>
                  <div className="devices-actions">
                    <button type="button" className="icon-button" aria-label={t("Rename {name}", { name: d.label })} onClick={() => setRenaming({ id: d.id, label: d.label })}><Pencil /></button>
                    <button type="button" className={`btn ${confirming === d.id ? "btn-danger" : "btn-ghost"}`} onClick={() => void revoke(d.id)}>
                      <Trash2 aria-hidden="true" />{t(confirming === d.id ? "Revoke?" : "Revoke")}
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {error !== null && <p className="settings-hint" role="alert">{error}</p>}
    </div>
  );
}
