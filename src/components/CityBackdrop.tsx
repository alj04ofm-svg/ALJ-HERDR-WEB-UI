import { memo, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { Binoculars, Clock3, CloudSun, Flag, Footprints, LampWallUp, Pause, Play, Rabbit, Sailboat, Ship, Waves } from "lucide-react";
import { useT } from "../lib/i18n.ts";
import { useMediaQuery } from "../lib/useMediaQuery.ts";
import { usePageVisible } from "../lib/visibility.ts";
import "./CityBackdrop.css";

const waterfront = [
  { x: 18, height: 53, width: 6.7, architecture: "brick", columns: 6, rows: 7 },
  { x: 34, height: 76, width: 5.2, architecture: "glass", columns: 8, rows: 15 },
  { x: 56, height: 85, width: 5.7, architecture: "deco", columns: 6, rows: 12 },
  { x: 76, height: 48, width: 7.2, architecture: "stone", columns: 7, rows: 6 },
] as const;
const rebuildOrder = [2, 1, 3, 0];
const constructionFloors = [0, 1, 2, 3, 4, 5];
const weatherModes = ["auto", "clear", "fog", "rain"] as const;
type MarinaWeather = typeof weatherModes[number];
type LiveWeather = "clear" | "cloudy" | "rain" | "fog" | "storm";
const bannerMessages = [
  "ALJ",
  "Reproduce it first.",
  "ALJ",
  "Give AI a runnable example.",
  "ALJ",
  "Read the diff before shipping.",
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
const buoys = [
  { x: 10, y: 46, icon: Rabbit },
  { x: 21, y: 68, icon: Waves },
  { x: 86, y: 53, icon: Binoculars },
  { x: 78, y: 67, icon: Footprints },
  { x: 65, y: 51, icon: Clock3 },
  { x: 51, y: 63, icon: LampWallUp },
] as const;
type Point = { x: number; y: number };
const raceLanes = [73, 76] as const;
const initialBoats = [{ x: 21, y: raceLanes[0] }, { x: 28, y: raceLanes[1] }];
const finishLine = 88;
const crowd = [0, 1, 2, 3, 4, 5];
const clampPoint = ({ x, y }: Point): Point => ({
  x: Math.max(9, Math.min(91, x)),
  y: Math.max(73, Math.min(93, y)),
});

const CityScene = memo(function CityScene({ moving, weather, paused, manualBoats }: {
  moving: boolean; weather: MarinaWeather | LiveWeather; paused: boolean; manualBoats: boolean;
}) {
  const [cycle, setCycle] = useState(0);
  const [bannerPass, setBannerPass] = useState(0);
  const lot = rebuildOrder[cycle % rebuildOrder.length];

  return <div className={`city-backdrop${moving ? " is-animated" : ""}${paused ? " is-paused" : ""}`} data-weather={weather} aria-hidden="true">
    <div className="city-panorama">
      <span className="city-skyline-lights">
        {skylineLights.map((style, index) => <i key={index} style={style} />)}
      </span>
    </div>
    <div className="city-sky-haze" />
    <div className="city-gulls"><i /><i /><i /></div>
    <div className="city-site-clock" onAnimationIteration={event => {
      if (event.target === event.currentTarget && event.animationName === "city-clock") setCycle(index => index + 1);
    }}>
      {waterfront.map(({ x, height, width, architecture }, index) => {
        const working = moving && index === lot;
        return <div className="city-site" key={index} data-target={working} data-architecture={architecture}
          style={{ "--city-lot": `${x}%`, "--city-height": `${height}%`, "--city-width": `${width}cqw` } as CSSProperties}>
          <span className="city-building">
            <span className="city-facade" />
            <span className="city-room-lights">
              {windowLights[index]?.map((style, room) => <i key={room} style={style} />)}
            </span>
          </span>
          <span className="city-reflection" />
          {working && <div className="city-sequence" key={cycle} data-arrival={cycle % 2 === 0 ? "west" : "east"}>
            <div className="city-flight"><span /></div>
            <div className="city-impact" />
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
              <div className="city-excavator"><i /><b /><em /></div>
              <div className="city-crane">
                <span className="city-crane-mast" /><span className="city-crane-jib" /><span className="city-crane-counterweight" />
              </div>
              <span className="city-work-lights" />
              <span className="city-site-truck" />
              {constructionFloors.map(floor => <div className="city-install" key={floor} style={{
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
    <div className="city-quay-clock"><i /></div>
    <div className="city-promenade">
      <span className="city-pedestrian" />
      <span className="city-pedestrian" />
      <span className="city-pedestrian" />
      <span className="city-pedestrian" />
    </div>
    <div className="city-water-lights" />
    <div className="city-ripples" />
    <div className="city-ferry-berth"><i /><i /><i /></div>
    <div className="city-river">
      {!manualBoats && <div className="city-vessel city-yacht" />}
      <div className="city-vessel city-yacht city-yacht-returning" />
      {!manualBoats && <div className="city-vessel city-jet-ski" />}
      <div className="city-vessel city-jet-ski city-jet-ski-second" />
      <div className="city-vessel city-yacht city-docked-yacht"><i /></div>
      <div className="city-water-taxi"><i /><b /></div>
    </div>
    <div className="city-bridge-traffic" />
    <div className="city-lantern" />
    <div className="city-plane" onAnimationIteration={event => {
      if (event.target === event.currentTarget && event.animationName === "city-banner-pass") {
        setBannerPass(pass => (pass + 1) % bannerMessages.length);
      }
    }}>
      <span />
      <b className="city-plane-banner" data-tip={bannerPass % 2 === 1}>{bannerMessages[bannerPass]}</b>
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
  const discoveries = [
    t("A neon rabbit lights the old market roof."),
    t("A rubber duck has stowed away on the yacht."),
    t("The marina telescope points to a rooftop garden."),
    t("The promenade runners are halfway through their evening loop."),
    t("The clock above the ferry steps is still set by hand."),
    t("Three amber dock lights mark the water taxi’s berth."),
  ];
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
  const [race, setRace] = useState<{ winner: 0 | 1; finished: boolean } | null>(null);
  const [discovery, setDiscovery] = useState<number | null>(null);
  const [found, setFound] = useState<number[]>([]);
  const [ferry, setFerry] = useState(0);
  const running = race !== null && !race.finished;
  const togglePause = () => {
    const next = !paused;
    setPaused(next);
    try { localStorage.setItem("herdr-web-ui:marina-paused", next ? "1" : "0"); } catch {}
  };
  const placeBoat = (index: number, position: Point) => {
    setRace(null);
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
  const startRace = () => {
    setRace({ winner: Math.random() < .5 ? 0 : 1, finished: reduceMotion });
    setBoats(raceLanes.map(y => ({ x: reduceMotion ? finishLine : 10, y })));
    setDiscovery(null);
  };

  const result = race?.finished ? t("{boat} wins!", { boat: racers[race.winner] })
    : running ? t("Race in progress")
    : discovery !== null ? discoveries[discovery]
    : ferry > 0 ? t("A ghost ferry has slipped out of the harbor.")
    : open ? t("Drag either boat or move it with the arrow keys.") : "";
  const manualBoats = open || running;

  const scene = <CityScene moving={moving} weather={weather === "auto" ? liveWeather ?? weather : weather}
    paused={paused || !pageVisible} manualBoats={manualBoats} />;

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
      {open && <div className="city-marina-controls" id={controlId} role="group" aria-label={t("Marina controls")}>
        <div className="city-marina-actions">
          <button type="button" className="btn" disabled={running || (paused && !reduceMotion)} onClick={startRace}>
            <Flag aria-hidden="true" />{t("Race boats")}
          </button>
          <button type="button" className="icon-button" aria-label={t("Reset boats")} title={t("Reset boats")} disabled={running}
            onClick={() => { setRace(null); setBoats(initialBoats); }}><Ship aria-hidden="true" /></button>
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
        <p aria-hidden="true">{result}</p>
      </div>}
      <span className="visually-hidden" role="status">{result}</span>
      {open && buoys.map(({ x, y, icon: Icon }, index) => <button key={index} className={`city-hotspot${found.includes(index) ? " is-found" : ""}`}
        type="button" style={{ left: `${x}%`, top: `${y}%` }} aria-label={t("Explore the marina")} aria-pressed={found.includes(index)} disabled={running}
        onClick={() => { setRace(null); setDiscovery(index); setFound(previous => previous.includes(index) ? previous : [...previous, index]); }}>
        <Icon aria-hidden="true" />
      </button>)}
      {open && found.length === buoys.length && <button type="button" className="city-hotspot city-ferry-signal"
        aria-label={t("Signal the ghost ferry")} disabled={running} onClick={() => { setRace(null); setDiscovery(null); setFerry(n => n + 1); }}>
        <Ship aria-hidden="true" />
      </button>}
      {ferry > 0 && <div key={ferry} className="city-vessel city-yacht city-ghost-ferry" aria-hidden="true" />}
      {manualBoats && boats.map(({ x, y }, index) => <button type="button" key={index}
        className={`city-racer city-racer-${index}${running ? " is-racing" : ""}${race?.winner === index ? " is-first" : ""}`}
        aria-label={racers[index]} aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight" aria-hidden={!open || undefined}
        disabled={running || !open} style={{ top: `${y}%`, left: `${x}%`, "--race-distance": `${finishLine - x}cqw` } as CSSProperties}
        onAnimationEnd={event => {
          if (event.animationName !== "city-race" || !race || race.finished || index === race.winner) return;
          setRace({ ...race, finished: true });
          setBoats(raceLanes.map(lane => ({ x: finishLine, y: lane })));
        }}
        onPointerDown={event => beginDrag(event, { x, y })} onPointerMove={event => moveBoat(event, index)}
        onKeyDown={event => step(event, index, { x, y })}>
        <span className={`city-vessel ${index === 0 ? "city-yacht" : "city-jet-ski"}`} aria-hidden="true" />
      </button>)}
    </div>}
  </>;
}
