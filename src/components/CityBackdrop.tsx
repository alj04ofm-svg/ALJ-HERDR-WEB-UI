import { memo, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { Clock3, CloudSun, Compass, Pause, Play, Rabbit, Sailboat, Ship } from "lucide-react";
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
const constructionFloors = [0, 1, 2, 3, 4, 5];
const weatherModes = ["auto", "clear", "fog", "rain"] as const;
type MarinaWeather = typeof weatherModes[number];
type LiveWeather = "clear" | "cloudy" | "rain" | "fog" | "storm";
const bannerMessages = [
  "Do what matters first.",
  "Give the agent a failing test.",
  "Pick one thing to finish.",
  "Ask what could invalidate it.",
  "Reopen with a clear next step.",
  "Tell the agent what must stay.",
  "Small steps still count.",
  "Ask for files and line numbers.",
  "Try the hardest case first.",
  "Give each agent a clear owner.",
  "Check what users see on failure.",
  "Protect your focus.",
  "Send a runnable example.",
  "Write down the decision.",
  "Ask the agent to check its diff.",
  "Make the next step clear.",
  "Set a clear stopping point.",
  "Read the first failing line.",
  "Let the quiet work compound.",
  "Ask for the smallest safe fix.",
  "Keep a way to roll back.",
  "Turn a hunch into a check.",
  "Leave a note for tomorrow.",
  "Make it work, then polish.",
  "Ask what the tests missed.",
  "Name the input and output.",
  "Check a real user flow.",
  "Leave it easier to use.",
  "Review one change at a time.",
  "Move one priority forward.",
  "Ask for evidence before merging.",
  "Read the diff before shipping.",
  "Take a breath. Start again.",
  "Finish what moves the work.",
  "Have the agent list unknowns.",
  "Write a test for the old bug.",
  "Clear one blocker before lunch.",
  "Re-run the check after edits.",
  "Make the handoff easy to resume.",
  "Timebox the investigation.",
] as const;

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
const clampPoint = ({ x, y }: Point): Point => ({
  x: Math.max(9, Math.min(91, x)),
  y: Math.max(73, Math.min(93, y)),
});

const CityScene = memo(function CityScene({ moving, weather, paused, manualBoats, event, discovery }: {
  moving: boolean; weather: MarinaWeather | LiveWeather; paused: boolean; manualBoats: boolean; event: RegattaScene; discovery: Landmark | null;
}) {
  const [cycle, setCycle] = useState(0);
  const [bannerPass, setBannerPass] = useState(0);
  const [day, setDay] = useState(dayNumber);
  const [rebuilt, setRebuilt] = useState<{ day: number; versions: Record<number, number>; cleared?: number } | null>(null);
  useEffect(() => {
    const sync = () => setDay(dayNumber());
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const timer = window.setTimeout(sync, tomorrow.getTime() - now.getTime());
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [day]);
  const dailyBuildings = rebuilt?.day === day ? rebuilt : null;
  const vacantLot = dailyBuildings?.cleared ?? (day % 3 === 0 ? day % waterfront.length : -1);
  const buildable = rebuildOrder.filter(index => index !== vacantLot);
  const start = (cycle + day) % buildable.length;
  const eventPhase = (cycle + day) % 7;
  const district = eventPhase === 0;
  const sites = buildable.slice(start).concat(buildable.slice(0, start)).slice(0, district ? 3 : eventPhase === 3 ? 2 : 1);
  const lead = sites[0];
  const closingLot = district && day % 2 === 0 && vacantLot < 0 ? sites.at(-1) : undefined;

  useEffect(() => { setBannerPass(0); }, [day]);

  return <div className={`city-backdrop${moving ? " is-animated" : ""}${paused ? " is-paused" : ""}`} data-weather={event?.weather ?? weather} data-regatta-light={event ? (event.sunset ? "sunset" : "floodlit") : undefined} data-discovery={discovery ?? undefined} aria-hidden="true">
    <div className="city-panorama">
      <span className="city-skyline-lights">
        {skylineLights.map((style, index) => <i key={index} style={style} />)}
      </span>
    </div>
    <div className="city-sky-haze" />
    <div className="city-gulls"><i /><i /><i /></div>
    <div className="city-site-clock" key={day} onAnimationIteration={event => {
      if (event.target !== event.currentTarget || event.animationName !== "city-clock") return;
      if (district) {
        const versions = { ...dailyBuildings?.versions };
        for (const site of sites) versions[site] = (versions[site] ?? 0) + 1;
        setRebuilt({ day, versions, cleared: closingLot ?? dailyBuildings?.cleared });
      }
      setCycle(index => index + 1);
    }}>
      {waterfront.map(({ x, height, width }, index) => {
        const working = moving && sites.includes(index);
        const variant = index + day + (dailyBuildings?.versions[index] ?? 0);
        const architecture = waterfront[variant % waterfront.length]!.architecture;
        const nextArchitecture = waterfront[(variant + 1) % waterfront.length]!.architecture;
        const alternate = working && district;
        const clearing = working && index === closingLot;
        return <div className="city-site" key={index} data-target={working} data-replacement={alternate} data-architecture={architecture}
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
          {working && <div className="city-sequence" key={cycle} data-arrival={cycle % 2 === 0 ? "west" : "east"}>
            {index === lead && (district
              ? <><span className="city-meteor" /><span className="city-district-flash" /></>
              : <div className="city-flight"><span /></div>)}
            {(district || index === lead) && <div className="city-impact" />}
            <div className="city-collapse"><i /><i /><i /></div>
            <div className="city-impact-dust"><i /><i /></div>
            <div className="city-impact-glint" />
            <span className="city-rubble" />
            {[-1, 1].map(direction => <div className="city-evacuation" key={direction} style={{ "--evac-direction": direction } as CSSProperties}>
              {crowd.map(person => <span key={person} style={{ "--evac-person": person } as CSSProperties}><i /></span>)}
            </div>)}
            <div className="city-works">
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
                <span className="city-floor-crew"><i /><i /></span>
              </div>)}
              <span className="city-inspection-lift"><i /><b /></span>
              <span className="city-ground-crew"><i /><i /><i /></span>
            </div>
          </div>}
        </div>;
      })}
    </div>
    <Rabbit className="city-roof-sign" />
    <span className="city-discovery-beacon" />
    <div className="city-quay-clock"><i /></div>
    <div className="city-promenade">
      <span className="city-pedestrian" />
      <span className="city-pedestrian" />
      <span className="city-pedestrian" />
      <span className="city-pedestrian" />
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
      <div className="city-vessel city-yacht city-docked-yacht"><i /></div>
      <div className="city-vessel city-yacht city-docked-yacht city-guest-yacht"><i /></div>
      <div className="city-water-taxi"><i /><b /><span /></div>
    </div>
    <div className="city-bridge-traffic" />
    <div className="city-lantern" />
    <div className="city-plane" onAnimationIteration={event => {
      if (event.target === event.currentTarget && event.animationName === "city-banner-pass") {
        setBannerPass(pass => (pass + 1) % bannerMessages.length);
      }
    }}>
      <span />
      <b className="city-plane-banner">{bannerMessages[(bannerPass + (day % 10) * 4) % bannerMessages.length]}</b>
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

export function CityBackdrop({ animated, sceneHost, liveWeather }: {
  animated: boolean;
  sceneHost: HTMLElement | null;
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

  return <>
    {sceneHost ? createPortal(scene, sceneHost) : scene}
    {animated && <div className={`city-interactions${paused || !pageVisible ? " is-paused" : ""}`} ref={playArea} onKeyDown={event => {
      if (open && event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        toggle.current?.focus();
      }
    }}>
      <div className="city-tools">
        <button ref={toggle} type="button" className="icon-button" aria-label={t("Marina controls")} title={t("Marina controls")}
          aria-expanded={open} aria-controls={open ? controlId : undefined} onClick={() => setOpen(value => !value)}><Sailboat aria-hidden="true" /></button>
        <button type="button" className="icon-button" aria-label={t(paused ? "Resume marina" : "Pause marina")} title={t(paused ? "Resume marina" : "Pause marina")}
          onClick={togglePause} disabled={reduceMotion}>{paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}</button>
      </div>
      <CityRegatta open={open} controlsId={controlId} paused={paused || !pageVisible} reduced={reduceMotion} onScene={setRaceScene}>
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
