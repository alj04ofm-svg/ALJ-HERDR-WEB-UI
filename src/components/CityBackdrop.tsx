import { memo, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { Clock3, CloudSun, Compass, Pause, Play, Rabbit, Sailboat, Ship } from "lucide-react";
import { harborBanner } from "../lib/harborBanners.ts";
import { useT } from "../lib/i18n.ts";
import { useMediaQuery } from "../lib/useMediaQuery.ts";
import { usePageVisible } from "../lib/visibility.ts";
import { CityRegatta, type RegattaScene } from "./CityRegatta.tsx";
import "./CityBackdrop.css";

const waterfront = [
  { x: 18, height: 53, width: 6.7, architecture: "brick", columns: 6, rows: 7 },
  { x: 34, height: 76, width: 5.2, architecture: "glass", columns: 8, rows: 15 },
  { x: 56, height: 85, width: 5.7, architecture: "deco", columns: 6, rows: 12 },
  { x: 76, height: 48, width: 7.2, architecture: "stone", columns: 7, rows: 6 },
] as const;
const rebuildOrder = [2, 1, 3, 0];
const dayNumber = (date = new Date()) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
const waterfronts = ["harbor", "london", "singapore"] as const;
const residents = [
  { berth: 7, pace: 77, offset: 12, near: true },
  { berth: 24, pace: 96, offset: 46 },
  { berth: 41, pace: 85, offset: 38, near: true },
  { berth: 59, pace: 74, offset: 21 },
  { berth: 73, pace: 103, offset: 57, near: true },
  { berth: 88, pace: 89, offset: 72 },
  { berth: 15, pace: 49, offset: 24, near: true },
  { berth: 32, pace: 101, offset: 83 },
  { berth: 51, pace: 87, offset: 55 },
  { berth: 68, pace: 96, offset: 16, near: true },
  { berth: 81, pace: 91, offset: 30 },
  { berth: 95, pace: 72, offset: 9 },
];
const giantChase = [6, 0, 9];
const debris = Array.from({ length: 10 }, (_, index) => ({
  "--debris-x": `${13 + (index * 29 % 75)}%`,
  "--debris-y": `${14 + (index * 17 % 70)}%`,
  "--debris-size": `${1 + index % 4}px`,
  "--debris-wind": `${(index * 19 % 39) - 19}px`,
  "--debris-spin": `${(index * 83 % 330) - 165}deg`,
  "--debris-delay": `${index % 7 * .065}s`,
} as CSSProperties));
const constructionFloors = [0, 1, 2, 3, 4, 5];
const weatherModes = ["auto", "clear", "fog", "rain"] as const;
type MarinaWeather = typeof weatherModes[number];
type LiveWeather = "clear" | "cloudy" | "rain" | "fog" | "storm";
// The façade sprites provide the edge of each building. Each slot covers a small part of its window grid.
const windowLights = waterfront.map(({ columns, rows }, lot) => Array.from({ length: 9 }, (_, index) => {
  const column = (index * 3 + Math.floor(index / 2) + lot) % columns;
  const row = (index * 4 + Math.floor(index / 2) + lot) % rows;
  return {
    "--city-room-x": `${(column + .5) / columns * 100}%`,
    "--city-room-y": `${20 + (row + .5) / rows * 70}%`,
    "--city-room-w": `${48 / columns}%`,
    "--city-room-h": `${35 / rows}%`,
    "--city-room-period": `${29 + (index * 11 + lot * 7) % 43}s`,
    "--city-room-delay": `-${(index * 23 + lot * 11) % 37}s`,
  } as CSSProperties;
}));

// Positions and sizes match the lit windows in the panorama's 1536×1024 source image.
const skylineLights = ([
  [52, 496, 5, 9], [137, 434, 7, 10], [228, 431, 5, 14], [297, 451, 4, 7],
  [471, 517, 6, 11], [579, 472, 6, 10], [642, 529, 6, 11], [778, 354, 5, 9],
  [753, 467, 7, 12], [784, 497, 5, 10], [909, 474, 5, 8], [1139, 590, 7, 16],
  [1175, 448, 6, 10], [1198, 438, 6, 12], [1285, 506, 6, 11], [1345, 444, 5, 7],
  [1433, 587, 5, 14], [1508, 448, 5, 9],
] as const).map(([x, y, width, height], index) => ({
  "--city-room-x": `${x / 1536 * 100}%`,
  "--city-room-y": `${y / 1024 * 100}%`,
  "--city-room-w": `${width / 1536 * 100}%`,
  "--city-room-h": `${height / 1024 * 100}%`,
  "--city-room-period": `${51 + index * 7 % 29}s`,
  "--city-room-delay": `-${index * 13 % 41}s`,
} as CSSProperties));
const rainDrops = Array.from({ length: 22 }, (_, index) => ({
  left: `${(index * 37 + 7) % 101}%`,
  "--rain-duration": `${580 + index % 6 * 125}ms`,
  "--rain-delay": `-${index * 113 % 910}ms`,
  "--rain-length": `${11 + index % 5 * 4}px`,
} as CSSProperties));
const rainRipples = [
  { left: "12%", top: "83%" }, { left: "27%", top: "94%" }, { left: "46%", top: "76%" },
  { left: "58%", top: "90%" }, { left: "77%", top: "82%" }, { left: "94%", top: "91%" },
];
const landmarks = [
  { id: "rabbit", icon: Rabbit },
  { id: "taxi", icon: Ship },
  { id: "clock", icon: Clock3 },
] as const;
type Landmark = typeof landmarks[number]["id"];
type Point = { x: number; y: number };
const initialBoats = [{ x: 21, y: 73 }, { x: 28, y: 76 }];
const crowd = [0, 1, 2, 3, 4, 5];
function Resident({ index, giant = false }: { index: number; giant?: boolean }) {
  return <span className="city-resident" data-resident={index} data-giant={giant || undefined} data-fantasy={index >= 6 || undefined} style={{
    "--resident-column": `${index % 3 * 50}%`,
    "--resident-row": `${Math.floor(index % 6 / 3) * 100}%`,
    "--resident-step-offset": `-${(index * 131) % 760}ms`,
  } as CSSProperties}><i /><b /></span>;
}

const clampPoint = ({ x, y }: Point): Point => ({
  x: Math.max(9, Math.min(91, x)),
  y: Math.max(73, Math.min(93, y)),
});

const CityScene = memo(function CityScene({ moving, weather, paused, manualBoats, event, discovery }: {
  moving: boolean; weather: MarinaWeather | LiveWeather; paused: boolean; manualBoats: boolean; event: RegattaScene; discovery: Landmark | null;
}) {
  const [cycle, setCycle] = useState(0);
  const [bannerPass, setBannerPass] = useState(0);
  const [skyTime, setSkyTime] = useState(() => new Date());
  const day = dayNumber(skyTime);
  const [city, setCity] = useState(() => dayNumber() % waterfronts.length);
  const [rebuilt, setRebuilt] = useState<{ day: number; versions: Record<number, number>; cleared?: number } | null>(null);
  useEffect(() => {
    const sync = () => { if (!document.hidden) setSkyTime(new Date()); };
    const timer = window.setTimeout(sync, 300_000 - skyTime.getTime() % 300_000);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [skyTime]);
  const publicWorksDay = Math.floor(day / 2);
  const publicWorksLot = rebuildOrder[publicWorksDay % rebuildOrder.length]!;
  // The public works site advances on the marina's local clock, even when no browser is open.
  const publicWorksPhase = (day % 2) * 2 + Number(skyTime.getHours() >= 12);
  const civicProject = moving && publicWorksPhase < 3;
  const dailyBuildings = rebuilt?.day === day ? rebuilt : null;
  const vacancy = dailyBuildings?.cleared ?? (day % 3 === 0 ? day % waterfront.length : -1);
  const vacantLot = civicProject && vacancy === publicWorksLot ? (vacancy + 1) % waterfront.length : vacancy;
  const buildable = rebuildOrder.filter(index => index !== vacantLot && !(civicProject && index === publicWorksLot));
  const start = (cycle + day) % buildable.length;
  const eventPhase = (cycle + day) % 7;
  const district = eventPhase === 0 && !event;
  const giantVisit = moving && district && cycle > 0 && Math.floor((cycle + day) / 7) % 2 === 0;
  const sites = buildable.slice(start).concat(buildable.slice(0, start)).slice(0, district ? 3 : eventPhase === 3 ? 2 : 1);
  const lead = sites[0];
  const activeSites = moving && !event && (district || eventPhase === 3) ? sites : [];
  const available = residents.map((_, index) => index).filter(index => !giantVisit || !giantChase.includes(index));
  const crewSize = giantVisit ? 3 : 2;
  const crew = activeSites.map((_, position) => Array.from({ length: crewSize }, (_, member) =>
    available[(cycle + position * crewSize + member) % available.length]!));
  const assigned = crew.flat();
  const closingLot = district && day % 2 === 0 && vacantLot < 0 ? sites.at(-1) : undefined;
  const currentCity = moving ? city : day % waterfronts.length;
  const nextCity = (currentCity + 1) % waterfronts.length;
  const month = skyTime.getMonth();
  const season = ["winter", "spring", "summer", "autumn"][Math.floor((month + 1) / 3) % 4];
  const hour = skyTime.getHours() + skyTime.getMinutes() / 60;
  const dayLength = season === "summer" ? 16 : season === "winter" ? 9 : 12;
  const daylight = Math.max(0, Math.cos((hour - 13) * Math.PI / dayLength));
  const twilight = Math.max(0, 1 - Math.abs(daylight - .26) * 4);

  useEffect(() => { setBannerPass(0); }, [day]);

  return <div className={`city-backdrop${moving ? " is-animated" : ""}${paused ? " is-paused" : ""}`}
    data-city={waterfronts[currentCity]} data-season={season} data-weather={event?.weather ?? weather}
    data-regatta-light={event ? (event.sunset ? "sunset" : "floodlit") : undefined}
    data-discovery={discovery ?? undefined} aria-hidden="true"
    style={{ "--city-daylight": daylight, "--city-twilight": twilight } as CSSProperties}>
    <div className="city-panorama">
      {(moving && district ? [currentCity, nextCity] : [currentCity]).map((index, position) =>
        <div key={index} className={`city-panorama-plate${position ? " is-arriving" : ""}`}
          data-view={waterfronts[index]}>
          {daylight > .07 && <div className="city-panorama-day" />}
        </div>)}
      {currentCity === 0 && <span className="city-skyline-lights">
        {skylineLights.map((style, index) => <i key={index} style={style} />)}
      </span>}
    </div>
    <div className="city-sky-haze" />
    <div className="city-gulls"><i /><i /><i /></div>
    <div className="city-site-clock" key={day} onAnimationIteration={event => {
      if (event.target !== event.currentTarget || event.animationName !== "city-clock") return;
      if (district) {
        const versions = { ...dailyBuildings?.versions };
        for (const site of sites) versions[site] = (versions[site] ?? 0) + 1;
        setRebuilt({ day, versions, cleared: closingLot ?? dailyBuildings?.cleared });
        setCity(nextCity);
      }
      setCycle(index => index + 1);
    }}>
      {waterfront.map(({ x, height, width }, index) => {
        const publicWorks = civicProject && index === publicWorksLot && index !== vacantLot ? publicWorksPhase : undefined;
        const siteCrew = crew[activeSites.indexOf(index)];
        const working = siteCrew !== undefined;
        const variant = index + day + (dailyBuildings?.versions[index] ?? 0);
        const architecture = waterfront[variant % waterfront.length]!.architecture;
        const nextArchitecture = waterfront[(variant + 1) % waterfront.length]!.architecture;
        const alternate = working && district;
        const clearing = working && index === closingLot;
        return <div className="city-site" key={index} data-target={working} data-replacement={alternate} data-architecture={architecture} data-public-works={publicWorks}
          style={{ "--city-lot": `${x}%`, "--city-height": `${height}%`, "--city-width": `${width}cqw` } as CSSProperties}>
          {index === vacantLot ? <span className="city-quay-lot" /> : <>
          <span className="city-building">
            <span className="city-facade" />
            <span className="city-room-lights">
              {windowLights[index]?.map((style, room) => <i key={room} style={style} />)}
            </span>
          </span>
          <span className="city-reflection" />
          {clearing ? <span className="city-quay-lot is-opening" />
            : alternate && <div className="city-site-replacement" data-architecture={nextArchitecture}><span className="city-facade" /></div>}
          </>}
          {publicWorks !== undefined && <div className="city-civic-works">
            <span className="city-civic-frame" />
            <span className="city-crane-mast" /><span className="city-civic-jib" />
            <span className="city-site-fencing" />
          </div>}
          {working && <div className="city-sequence" key={cycle} data-district={district}
            style={{ "--city-damage-lag": `${district ? sites.indexOf(index) * .35 : 0}s` } as CSSProperties}>
            {index === lead && district && !giantVisit && <span className="city-meteor" />}
            <div className="city-collapse"><i /><i /></div>
            <div className="city-debris">{debris.map((style, fragment) => <i key={fragment} style={style} />)}</div>
            <span className="city-rubble" />
            <div className="city-impact-dust"><i /><i /><i /></div>
            <div className="city-works" data-architecture={alternate ? nextArchitecture : undefined}>
              <span className="city-foundation" />
              <span className="city-site-fencing" />
              <span className="city-scaffold" />
              <span className="city-safety-lamps"><i /><i /><i /></span>
              <div className="city-excavator"><i /><b /><em /></div>
              <div className="city-crane">
                <span className="city-crane-mast" /><span className="city-crane-jib" /><span className="city-crane-counterweight" />
              </div>
              <span className="city-work-lights" />
              <span className="city-site-truck" />
              {!clearing && constructionFloors.map(floor => <div className="city-install" key={floor} style={{
                "--city-floor": floor,
                "--city-module-offset": `${100 - floor * 20}%`,
              } as CSSProperties}>
                <span className="city-frame" />
                <span className="city-module" />
                <span className="city-hoist"><i /><b /></span>
              </div>)}
              <span className="city-inspection-lift"><i /><b /></span>
              <span className="city-ground-crew">
                {siteCrew.map((person, member) => <span className="city-crew-route"
                  data-route={member === 1 && !clearing ? "lift" : "quay"} key={person}><Resident index={person} /></span>)}
              </span>
            </div>
          </div>}
        </div>;
      })}
    </div>
    <Rabbit className="city-roof-sign" />
    <span className="city-discovery-beacon" />
    <div className="city-quay-clock"><i /></div>
    <div className="city-promenade">
      {giantVisit && lead !== undefined && <div className="city-giant-visit" key={cycle}
        style={{ "--giant-stop": `${waterfront[lead]!.x}%` } as CSSProperties}>
        <span className="city-giant"><Resident index={0} giant /></span>
        {giantChase.map((person, position) => <span className="city-giant-chase" key={person}
          style={{ "--giant-queue": position } as CSSProperties}><Resident index={person} /></span>)}
      </div>}
      {residents.map(({ berth, pace, offset, near }, index) => giantVisit && giantChase.includes(index) ? null : <span className="city-pedestrian" key={index}
        data-direction={index % 2 === 0 ? "east" : "west"}
        data-assigned={assigned.includes(index)}
        data-near={near}
        style={{
          "--resident-berth": `${berth}%`,
          "--resident-duration": `${pace}s`,
          "--resident-delay": `-${offset}s`,
        } as CSSProperties}><Resident index={index} /></span>)}
    </div>
    <div className="city-water-lights" />
    <div className="city-ripples" />
    <div className="city-ferry-berth"><i /><i /><i />
      <div className="city-boarding">
        <span className="city-gangway" />
        <span className="city-boarding-line">{crowd.slice(0, 4).map(person => <i key={person} style={{ "--boarding-person": person } as CSSProperties} />)}</span>
      </div>
    </div>
    <div className="city-river">
      {!manualBoats && <div className="city-vessel city-yacht" />}
      {!event && <div className="city-vessel city-yacht city-yacht-returning" />}
      {!manualBoats && <div className="city-vessel city-jet-ski" />}
      {!event && <div className="city-vessel city-jet-ski city-jet-ski-second" />}
      <div className="city-vessel city-yacht city-docked-yacht" data-berth="west"><i /></div>
      <div className="city-vessel city-yacht city-docked-yacht city-guest-yacht" data-berth="east"><i /></div>
      <div className="city-water-taxi"><i /><b /><span /></div>
    </div>
    <div className="city-bridge-traffic" />
    <div className="city-lantern" />
    <div className="city-plane" onAnimationIteration={event => {
      if (event.target === event.currentTarget && event.animationName === "city-banner-pass") {
        setBannerPass(pass => pass + 1);
      }
    }}>
      <span />
      <b className="city-plane-banner">{harborBanner(day, bannerPass)}</b>
    </div>
    <div className="city-weather-fog"><i /><i /></div>
    <div className="city-weather-rain">
      {rainDrops.map((style, index) => <i key={index} className="city-rain-drop" style={style} />)}
      {rainRipples.map((style, index) => <i key={index} className="city-rain-ring"
        style={{ ...style, "--rain-delay": `-${index * 275}ms` } as CSSProperties} />)}
    </div>
    <div className="city-veil" />
  </div>;
});

export function CityBackdrop({ animated, sceneHost, toolsHost, liveWeather }: {
  animated: boolean;
  sceneHost: HTMLElement | null;
  toolsHost: HTMLElement | null;
  liveWeather?: LiveWeather | null;
}) {
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const pageVisible = usePageVisible();
  const t = useT();
  const racers = [t("Yacht"), t("Jet ski")] as const;
  const discoveries = {
    rabbit: t("Neon rabbit"),
    taxi: t("Water taxi stop"),
    clock: t("Quay clock"),
  };
  const moving = animated && !reduceMotion;
  const controlId = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const playArea = useRef<HTMLDivElement>(null);
  const dragOffset = useRef<Point>({ x: 0, y: 0 });
  const [open, setOpen] = useState(false);
  const [weather, setWeather] = useState<MarinaWeather>(() => {
    try {
      const saved = localStorage.getItem("herdr-web-ui:marina-weather");
      return weatherModes.find(mode => mode === saved) ?? "auto";
    } catch { return "auto"; }
  });
  const [boats, setBoats] = useState<Point[]>(initialBoats);
  const [paused, setPaused] = useState(() => {
    try { return localStorage.getItem("herdr-web-ui:marina-paused") === "1"; } catch { return false; }
  });
  const [raceScene, setRaceScene] = useState<RegattaScene>(null);
  const [explore, setExplore] = useState(false);
  const [discovery, setDiscovery] = useState<Landmark | null>(null);
  const togglePause = () => {
    const next = !paused;
    setPaused(next);
    try { localStorage.setItem("herdr-web-ui:marina-paused", next ? "1" : "0"); } catch {}
  };
  const placeBoat = (index: number, position: Point) => {
    setBoats(previous => previous.map((boat, at) => index === at ? position : boat));
  };
  const beginDrag = (event: PointerEvent<HTMLButtonElement>, position: Point) => {
    const area = playArea.current?.getBoundingClientRect();
    if (!area?.width || !area.height || !event.isPrimary || event.button !== 0) return;
    dragOffset.current = {
      x: position.x - (event.clientX - area.left) / area.width * 100,
      y: position.y - (event.clientY - area.top) / area.height * 100,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveBoat = (event: PointerEvent<HTMLButtonElement>, index: number) => {
    const area = playArea.current?.getBoundingClientRect();
    if (!area?.width || !area.height || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    placeBoat(index, clampPoint({
      x: (event.clientX - area.left) / area.width * 100 + dragOffset.current.x,
      y: (event.clientY - area.top) / area.height * 100 + dragOffset.current.y,
    }));
  };
  const step = (event: KeyboardEvent, index: number, point: Point) => {
    const offsets: Record<string, Point> = {
      ArrowLeft: { x: -4, y: 0 }, ArrowRight: { x: 4, y: 0 }, ArrowUp: { x: 0, y: -4 }, ArrowDown: { x: 0, y: 4 },
    };
    const offset = offsets[event.key];
    if (!offset) return;
    event.preventDefault();
    placeBoat(index, clampPoint({ x: point.x + offset.x, y: point.y + offset.y }));
  };
  const manualBoats = open || raceScene !== null;
  const scene = <CityScene moving={moving} weather={weather === "auto" ? liveWeather ?? weather : weather}
    paused={paused || !pageVisible} manualBoats={manualBoats} event={raceScene} discovery={open && explore ? discovery : null} />;
  const tools = <div className="city-tools">
    <button ref={toggle} type="button" className="icon-button" aria-label={t("Marina controls")} title={t("Marina controls")}
      aria-expanded={open} aria-controls={open ? controlId : undefined} onClick={() => setOpen(value => !value)}><Sailboat aria-hidden="true" /></button>
    <button type="button" className="icon-button" aria-label={t(paused ? "Resume marina" : "Pause marina")} title={t(paused ? "Resume marina" : "Pause marina")}
      onClick={togglePause} disabled={reduceMotion}>{paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}</button>
  </div>;

  return <>
    {sceneHost ? createPortal(scene, sceneHost) : scene}
    {animated && <div className={`city-interactions${paused || !pageVisible ? " is-paused" : ""}`} data-tools-in-sky={!!toolsHost} ref={playArea} onKeyDown={event => {
      if (open && event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        toggle.current?.focus();
      }
    }}>
      {toolsHost ? createPortal(tools, toolsHost) : tools}
      <CityRegatta open={open} anchor={toggle} onClose={(restoreFocus = true) => { setOpen(false); if (restoreFocus) toggle.current?.focus(); }}
        controlsId={controlId} paused={paused || !pageVisible} reduced={reduceMotion} onScene={setRaceScene}>
        <div className="city-marina-tools">
          <button type="button" className="btn" aria-expanded={explore} onClick={() => { setExplore(value => !value); setDiscovery(null); }}><Compass aria-hidden="true" />{t("Explore the waterfront")}</button>
          <button type="button" className="icon-button" aria-label={t("Reset boats")} title={t("Reset boats")}
            onClick={() => setBoats(initialBoats)}><Ship aria-hidden="true" /></button>
          <label className="city-weather-control">
            <CloudSun aria-hidden="true" />
            <select className="select" aria-label={t("Marina weather")} value={weather} onChange={event => {
              const mode = weatherModes.find(option => option === event.currentTarget.value);
              if (!mode) return;
              setWeather(mode);
              try { localStorage.setItem("herdr-web-ui:marina-weather", mode); } catch {}
            }}>
              <option value="auto">{t("Auto")}</option>
              <option value="clear">{t("Clear skies")}</option>
              <option value="fog">{t("Coastal fog")}</option>
              <option value="rain">{t("Rain showers")}</option>
            </select>
          </label>
        </div>
        {explore ? <div className="city-landmarks">
          {landmarks.map(({ id, icon: Icon }) => <button className="btn" key={id} type="button" aria-pressed={id === discovery} onClick={() => setDiscovery(id)}>
            <Icon aria-hidden="true" /> {discoveries[id]}
          </button>)}
          <p role="status">{discovery ? t("Look for the marker in the scene.") : t("Choose a landmark to highlight it in the city.")}</p>
        </div> : <p>{t("Drag either boat or move it with the arrow keys.")}</p>}
      </CityRegatta>
      {open && !raceScene && boats.map(({ x, y }, index) => <button type="button" key={index}
        className={`city-racer city-racer-${index}`}
        aria-label={racers[index]} aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
        style={{ top: `${y}%`, left: `${x}%` }}
        onPointerDown={event => beginDrag(event, { x, y })} onPointerMove={event => moveBoat(event, index)}
        onKeyDown={event => step(event, index, { x, y })}>
        <span className={`city-vessel ${index === 0 ? "city-yacht" : "city-jet-ski"}`} aria-hidden="true" />
      </button>)}
    </div>}
  </>;
}
