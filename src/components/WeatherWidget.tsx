import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type Ref } from "react";
import { createPortal } from "react-dom";
import { Cloud, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, LocateFixed, Search, SlidersHorizontal, Sun, X } from "lucide-react";
import type { WeatherCondition, WeatherCoordinates, WeatherLocation } from "../../shared/protocol.ts";
import { useT } from "../lib/i18n.ts";
import { useSettings } from "../lib/settings.ts";
import { usePhoneSheetBack } from "../lib/sheetHistory.ts";
import { useSheetSwipe } from "../lib/sheets.ts";
import { useFocusTrap } from "../lib/useFocusTrap.ts";
import { englishWeatherLabel, locateWeather, searchWeatherLocations, useLocalWeather, WeatherRequestError } from "../lib/useLocalWeather.ts";
import { DEFAULT_WEATHER, type WeatherPreferences } from "../lib/weatherPreferences.ts";
import "./WeatherWidget.css";

export type SceneWeather = Exclude<WeatherCondition, "snow">;

const ICONS = { clear: Sun, cloudy: Cloud, rain: CloudRain, fog: CloudFog, snow: CloudSnow, storm: CloudLightning };

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: number | undefined;
    const tick = () => {
      if (document.hidden) return;
      const next = new Date();
      setNow(next);
      timer = window.setTimeout(tick, 60_000 - next.getTime() % 60_000);
    };
    const onVisibility = () => {
      window.clearTimeout(timer);
      tick();
    };
    document.addEventListener("visibilitychange", onVisibility);
    tick();
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  return now;
}

function lookupError(code: string, t: ReturnType<typeof useT>) {
  if (code === "weather_demo") return t("Live weather is available on a connected app.");
  if (code === "not_found") return t("This bridge needs an update for live weather.");
  if (code === "weather_busy") return t("Weather is busy. Try again shortly.");
  if (code === "invalid_request") return t("Enter a city or town name.");
  return t("Weather is temporarily unavailable.");
}

interface WeatherDialogProps {
  prefs: WeatherPreferences;
  onPrefs: (patch: Partial<WeatherPreferences>) => void;
  onDevice: (coords: WeatherCoordinates) => void;
  onClose: () => void;
  onRetry: () => void;
  failure: string | null;
  place?: string;
}

function WeatherDialog({ prefs, onPrefs, onDevice, onClose, onRetry, failure, place }: WeatherDialogProps) {
  const t = useT();
  const id = useId();
  const surface = useFocusTrap<HTMLDivElement>(true);
  const searchField = useRef<HTMLInputElement>(null);
  useSheetSwipe(surface, onClose);
  usePhoneSheetBack(onClose);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<WeatherLocation[] | null>(null);
  const [pending, setPending] = useState<"city" | "device" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  const begin = (mode: "city" | "device") => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setError(null);
    setMatches(null);
    setPending(mode);
    return controller;
  };
  const search = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (query.trim().length < 2 || pending) return;
    const controller = begin("city");
    try {
      const result = await searchWeatherLocations({ query: query.trim(), language: "en" },
        AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]));
      if (!controller.signal.aborted) setMatches(result.locations.flatMap(location => {
        const label = englishWeatherLabel(location.label);
        return label ? [{ ...location, label }] : [];
      }));
    } catch (reason: unknown) {
      if (!controller.signal.aborted) setError(lookupError(reason instanceof WeatherRequestError ? reason.code : "", t));
    } finally {
      if (!controller.signal.aborted) setPending(null);
    }
  };
  const useDeviceLocation = () => {
    const controller = begin("device");
    locateWeather((coords) => {
      if (controller.signal.aborted) return;
      onDevice(coords);
      onPrefs({ location: "device" });
      setPending(null);
    }, () => {
      if (controller.signal.aborted) return;
      setPending(null);
      setError(t("Location is unavailable. Allow access or search for a city."));
    });
  };
  return createPortal(
    <div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal weather-dialog" ref={surface} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}
        onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
        <header className="modal-header">
          <h2 className="modal-title" id={id}>{t("Sky widget")}</h2>
          <button type="button" className="icon-button" aria-label={t("Close")} onClick={onClose}><X aria-hidden="true" /></button>
        </header>
        <div className="modal-body weather-dialog-body">
          <section className="weather-dialog-section">
            <h3>{t("Weather location")}</h3>
            <p>{t("Search sends the city name to Photon. Approximate coordinates go to Photon for the device’s city name and to MET Norway for weather. The bridge keeps coordinates in memory only.")}</p>
            <form className="weather-search" onSubmit={(event) => void search(event)}>
              <input ref={searchField} type="search" className="input" aria-label={t("City or town")} placeholder={t("City or town")} value={query}
                maxLength={100} disabled={pending !== null} onChange={(event) => { setQuery(event.currentTarget.value); setMatches(null); setError(null); }} />
              <button type="submit" className="btn" disabled={pending !== null || query.trim().length < 2}>
                <Search aria-hidden="true" />{t("Find city")}
              </button>
            </form>
            {pending && <p role="status">{pending === "device" ? t("Finding your location…") : t("Searching for cities…")}</p>}
            {error && <p className="weather-error" role="alert">{error}</p>}
            {matches && matches.length === 0 && <p role="status">{t("No cities found. Try a nearby town or include the country.")}</p>}
            {matches && matches.length > 0 && <ul className="weather-results" aria-label={t("Matching cities")}>
              {matches.map((match) => <li key={match.label}><button type="button" className="btn" onClick={() => {
                onPrefs({ location: match });
                setMatches(null);
                setQuery("");
                searchField.current?.focus({ preventScroll: true });
              }}>{match.label}</button></li>)}
            </ul>}
            <div className="weather-location-actions">
              <button type="button" className="btn" onClick={useDeviceLocation} disabled={pending !== null}>
                <LocateFixed aria-hidden="true" />{t("Use device location")}
              </button>
              {prefs.location && <button type="button" className="btn btn-ghost" onClick={() => {
                active.current?.abort();
                setMatches(null);
                setError(null);
                setPending(null);
                onPrefs({ location: null });
              }}>{t("Turn weather off")}</button>}
            </div>
            {place && <p role="status">{t("Weather for {place}", { place })}</p>}
            {failure && <div className="weather-location-actions">
              <p className="weather-error" role="alert">{lookupError(failure, t)}</p>
              <button type="button" className="btn btn-ghost" onClick={onRetry}>{t("Retry")}</button>
            </div>}
            <p className="weather-attribution">
              <a href="https://api.met.no/doc/TermsOfService" target="_blank" rel="noreferrer">MET Norway</a>
              <span aria-hidden="true"> / </span>
              <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>
              <span aria-hidden="true"> · </span>
              <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a>
            </p>
          </section>
          <section className="weather-dialog-section">
            <h3>{t("Widget appearance")}</h3>
            <div className="weather-appearance">
              <label>{t("Sky position")}
                <select className="select" value={prefs.position} onChange={(event) => onPrefs({ position: event.currentTarget.value as WeatherPreferences["position"] })}>
                  <option value="left">{t("Top left")}</option><option value="right">{t("Top right")}</option>
                </select>
              </label>
              <label>{t("Widget size")}
                <select className="select" value={prefs.size} onChange={(event) => onPrefs({ size: event.currentTarget.value as WeatherPreferences["size"] })}>
                  <option value="small">{t("Small")}</option><option value="regular">{t("Regular")}</option><option value="large">{t("Large")}</option>
                </select>
              </label>
              <label>{t("Widget font")}
                <select className="select" value={prefs.font} onChange={(event) => onPrefs({ font: event.currentTarget.value as WeatherPreferences["font"] })}>
                  <option value="system">{t("System")}</option><option value="mono">{t("Monospace")}</option>
                </select>
              </label>
              <label>{t("Widget style")}
                <select className="select" value={prefs.style} onChange={(event) => onPrefs({ style: event.currentTarget.value as WeatherPreferences["style"] })}>
                  <option value="glass">{t("Glass card")}</option><option value="sky">{t("Sky lettering")}</option>
                </select>
              </label>
            </div>
          </section>
          <fieldset className="weather-dialog-section weather-fields">
            <legend>{t("Show in the sky")}</legend>
            <label><input type="checkbox" checked={prefs.time} onChange={(event) => onPrefs({ time: event.currentTarget.checked })} />{t("Device time")}</label>
            <label><input type="checkbox" checked={prefs.date} onChange={(event) => onPrefs({ date: event.currentTarget.checked })} />{t("Date")}</label>
            <label><input type="checkbox" checked={prefs.temperature} onChange={(event) => onPrefs({ temperature: event.currentTarget.checked })} />{t("Temperature")}</label>
            <label><input type="checkbox" checked={prefs.place} onChange={(event) => onPrefs({ place: event.currentTarget.checked })} />{t("Weather location")}</label>
            <label className="weather-scene-toggle"><input type="checkbox" checked={prefs.matchScene} onChange={(event) => onPrefs({ matchScene: event.currentTarget.checked })} />{t("Match the marina to local weather")}</label>
            <label className="weather-unit">{t("Temperature unit")}
              <select className="select" value={prefs.unit} onChange={(event) => onPrefs({ unit: event.currentTarget.value === "F" ? "F" : "C" })}>
                <option value="C">°C</option><option value="F">°F</option>
              </select>
            </label>
          </fieldset>
        </div>
        <footer className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={() => onPrefs({ ...DEFAULT_WEATHER, location: prefs.location })}>{t("Reset widget")}</button>
          <button type="button" className="btn btn-primary" onClick={onClose}>{t("Done")}</button>
        </footer>
      </div>
    </div>, document.body,
  );
}

export function WeatherWidget({ onSceneWeather, toolsHostRef }: {
  onSceneWeather?: (weather: SceneWeather | null) => void;
  toolsHostRef: Ref<HTMLDivElement>;
}) {
  const t = useT();
  const { settings: { weatherWidget: prefs }, update } = useSettings();
  const [open, setOpen] = useState(false);
  const [device, setDevice] = useState<WeatherCoordinates | null>(null);
  const [retry, setRetry] = useState(0);
  const now = useClock();
  const formatters = useMemo(() => ({
    time: new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }),
    date: new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }),
    temperature: new Intl.NumberFormat("en-US", { style: "unit", unit: prefs.unit === "F" ? "fahrenheit" : "celsius", maximumFractionDigits: 0 }),
  }), [prefs.unit]);
  const weather = useLocalWeather(prefs.location, device, setDevice, prefs.temperature || prefs.matchScene || prefs.place, retry, prefs.place);
  const data = weather.kind === "ready" ? weather.data : null;
  const scene = prefs.matchScene && data ? data.condition === "snow" ? "cloudy" : data.condition : null;
  useEffect(() => {
    onSceneWeather?.(scene);
    return () => onSceneWeather?.(null);
  }, [scene, onSceneWeather]);
  const Icon = data && prefs.temperature ? ICONS[data.condition] : prefs.time || prefs.date ? CloudSun : SlidersHorizontal;
  const condition = data?.condition;
  const description = condition === "clear" ? t("Clear skies") : condition === "cloudy" ? t("Cloudy") :
    condition === "fog" ? t("Fog") : condition === "rain" ? t("Rain") :
    condition === "snow" ? t("Snow") : condition === "storm" ? t("Thunderstorms") : "";
  let detail = prefs.date ? formatters.date.format(now) : "";
  const namedPlace = data?.place ?? (prefs.location === "device" ? undefined : englishWeatherLabel(prefs.location?.label));
  const place = namedPlace ?? (prefs.location === "device" ? t("This device") : undefined);
  const cityName = prefs.place ? namedPlace?.split(",")[0] : undefined;
  if (prefs.temperature && weather.kind === "loading") detail = t("Getting weather…");
  if (prefs.temperature && weather.kind === "needs-location") detail = t("Set location");
  if (prefs.temperature && weather.kind === "failed") detail = t("Weather unavailable");
  if (cityName) detail = detail ? `${cityName} · ${detail}` : cityName;
  const temperature = data && prefs.temperature ? formatters.temperature.format(prefs.unit === "F" ? data.temperature * 1.8 + 32 : data.temperature) : "";
  const time = prefs.time ? formatters.time.format(now) : "";
  return <>
    <div className="sky-widget-row" data-position={prefs.position}>
      <button className="sky-widget" type="button" data-size={prefs.size} data-font={prefs.font} data-style={prefs.style}
        aria-haspopup="dialog" aria-label={`${t("Sky widget")}${[time, temperature, description, detail].filter(Boolean).map((part) => `, ${part}`).join("")}`}
        onClick={() => setOpen(true)}>
        <Icon aria-hidden="true" />
        {(time || temperature || detail) && <span className="sky-widget-copy" aria-hidden="true">
          {(time || temperature) && <span className="sky-widget-values">
            {time && <time dateTime={now.toISOString()}>{time}</time>}
            {temperature && <span className="sky-widget-temp">{temperature}</span>}
          </span>}
          {detail && <span className="sky-widget-detail">{detail}</span>}
        </span>}
      </button>
      <div className="sky-widget-tools" ref={toolsHostRef} />
    </div>
    {open && <WeatherDialog prefs={prefs}
      onPrefs={(patch) => {
        if (patch.location !== undefined && patch.location !== "device") setDevice(null);
        if (patch.location) setRetry(count => count + 1);
        update({ weatherWidget: { ...prefs, ...patch } });
      }} onDevice={setDevice} onClose={() => setOpen(false)} onRetry={() => setRetry(count => count + 1)}
      place={place} failure={weather.kind === "failed" ? weather.code : null} />}
  </>;
}
