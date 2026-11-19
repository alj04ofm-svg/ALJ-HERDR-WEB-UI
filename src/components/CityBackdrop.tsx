import { memo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { Binoculars, Building2, Flag, Footprints, LifeBuoy, Pause, Play, Rabbit, Ship, Waves, X } from "lucide-react";
import { useT } from "../lib/i18n.ts";
import { useMediaQuery } from "../lib/useMediaQuery.ts";
import "./CityBackdrop.css";

const waterfront = [
  { x: 18, height: 53, width: 6.7, architecture: "brick" },
  { x: 34, height: 76, width: 5.2, architecture: "glass" },
  { x: 56, height: 85, width: 5.7, architecture: "deco" },
  { x: 76, height: 48, width: 7.2, architecture: "stone" },
] as const;
const rebuildOrder = [2, 1, 3, 0];
const blockHeights = [50, 72, 63];
const constructionFloors = [0, 1, 2, 3, 4, 5];
const buoys = [
  { x: 8, y: 75, icon: LifeBuoy },
  { x: 32, y: 53, icon: Waves },
  { x: 81, y: 43, icon: Binoculars },
  { x: 76, y: 66, icon: Footprints },
] as const;
type Point = { x: number; y: number };
const raceLanes = [77, 89] as const;
const initialBoats = [{ x: 30, y: raceLanes[0] }, { x: 44, y: raceLanes[1] }];
const initialRabbit = { x: 16, y: 59 };
const clampPoint = ({ x, y }: Point, boat: boolean): Point => ({
  x: Math.max(7, Math.min(93, x)),
  y: Math.max(boat ? 73 : 59, Math.min(boat ? 93 : 71, y)),
});

const CityScene = memo(function CityScene({ moving, paused = false }: { moving: boolean; paused?: boolean }) {
  const [cycle, setCycle] = useState(0);
  const lot = rebuildOrder[cycle % rebuildOrder.length];

  return <div className={`city-backdrop${moving ? " is-animated" : ""}${paused ? " is-paused" : ""}`} aria-hidden="true">
    <div className="city-panorama" />
    <div className="city-sky-haze" />
    <div className="city-gulls"><i /><i /><i /></div>
    <div className="city-site-clock" onAnimationIteration={event => {
      if (event.target === event.currentTarget && event.animationName === "city-clock") setCycle(index => index + 1);
    }}>
      {waterfront.map(({ x, height, width, architecture }, index) => {
        const working = moving && index === lot;
        return <div className="city-site" key={index} data-target={working} data-architecture={architecture}
          style={{ "--city-lot": `${x}%`, "--city-height": `${height}%`, "--city-width": `${width}cqw` } as CSSProperties}>
          <span className="city-building"><span className="city-facade" /></span>
          <span className="city-reflection" />
          {working && <div className="city-sequence" key={cycle} data-arrival={cycle % 2 === 0 ? "west" : "east"}>
            <div className="city-flight"><span /></div>
            <div className="city-impact" />
            <span className="city-rubble" />
            <span className="city-evacuation"><i /><i /><i /></span>
            <div className="city-works">
              <span className="city-foundation" />
              <span className="city-crane" />
              {constructionFloors.map(floor => <div className="city-install" key={floor} style={{
                "--city-floor": floor,
                "--city-module-offset": `${100 - floor * 20}%`,
              } as CSSProperties}>
                <span className="city-frame" />
                <span className="city-module" />
              </div>)}
              <span className="city-worker" />
              <span className="city-worker" />
            </div>
          </div>}
        </div>;
      })}
    </div>
    <div className="city-promenade">
      <span className="city-pedestrian" />
      <span className="city-pedestrian" />
      <span className="city-pedestrian" />
      <span className="city-pedestrian" />
    </div>
    <div className="city-water-lights" />
    <div className="city-ripples" />
    <div className="city-river">
      <div className="city-vessel city-yacht" />
      <div className="city-vessel city-yacht city-yacht-returning" />
      <div className="city-vessel city-jet-ski" />
      <div className="city-vessel city-jet-ski city-jet-ski-second" />
    </div>
    <div className="city-bridge-traffic" />
    <div className="city-lantern" />
    <div className="city-plane"><span /></div>
    <div className="city-veil" />
  </div>;
});

export function CityBackdrop({ animated }: { animated: boolean }) {
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const t = useT();
  const racers = [t("Yacht"), t("Jet ski")] as const;
  const discoveries = [
    t("An old tug rings the bridge bell."),
    t("A rubber duck has stowed away on the yacht."),
    t("The marina telescope points to a rooftop garden."),
    t("The promenade runners are halfway through their evening loop."),
  ];
  const moving = animated && !reduceMotion;
  const playground = useRef<HTMLDialogElement>(null);
  const playArea = useRef<HTMLDivElement>(null);
  const dragOffset = useRef<Point>({ x: 0, y: 0 });
  const [open, setOpen] = useState(false);
  const rabbitButton = useRef<HTMLButtonElement>(null);
  const [rabbit, setRabbit] = useState(initialRabbit);
  const [boats, setBoats] = useState<Point[]>(initialBoats);
  const [paused, setPaused] = useState(() => {
    try { return localStorage.getItem("herdr-web-ui:marina-paused") === "1"; } catch { return false; }
  });
  const [race, setRace] = useState<{ winner: 0 | 1; finished: boolean } | null>(null);
  const [bounce, setBounce] = useState(0);
  const [discovery, setDiscovery] = useState<number | null>(null);
  const [found, setFound] = useState<number[]>([]);
  const [domino, setDomino] = useState(false);
  const [ferry, setFerry] = useState(0);
  const running = race !== null && !race.finished;
  const togglePause = () => {
    const next = !paused;
    setPaused(next);
    try { localStorage.setItem("herdr-web-ui:marina-paused", next ? "1" : "0"); } catch {}
  };
  const setBoat = (index: number, position: Point) => setBoats(previous => previous.map((boat, at) => index === at ? position : boat));
  const beginDrag = (event: PointerEvent<HTMLButtonElement>, position: Point) => {
    const area = playArea.current?.getBoundingClientRect();
    if (!area?.width || !area.height || !event.isPrimary || event.button !== 0) return;
    dragOffset.current = {
      x: position.x / 100 * area.width - (event.clientX - area.left),
      y: position.y / 100 * area.height - (event.clientY - area.top),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const target = (event: PointerEvent<HTMLButtonElement>, boat: boolean): Point | undefined => {
    const area = playArea.current?.getBoundingClientRect();
    if (!area?.width || !area.height || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    return clampPoint({
      x: (event.clientX - area.left + dragOffset.current.x) / area.width * 100,
      y: (event.clientY - area.top + dragOffset.current.y) / area.height * 100,
    }, boat);
  };
  const step = (event: KeyboardEvent, point: Point, boat: boolean): Point | undefined => {
    const offsets: Record<string, Point> = {
      ArrowLeft: { x: -4, y: 0 }, ArrowRight: { x: 4, y: 0 }, ArrowUp: { x: 0, y: -4 }, ArrowDown: { x: 0, y: 4 },
    };
    const offset = offsets[event.key];
    if (!offset) return;
    event.preventDefault();
    return clampPoint({ x: point.x + offset.x, y: point.y + offset.y }, boat);
  };
  const showBunny = () => {
    setRabbit(initialRabbit);
    rabbitButton.current?.focus({ preventScroll: true });
    setBounce(count => count + 1);
  };
  const startRace = () => {
    setRace({ winner: Math.random() < .5 ? 0 : 1, finished: reduceMotion });
    setBoats(raceLanes.map(y => ({ x: 10, y })));
  };

  return <>
    <CityScene moving={moving} paused={paused || open} />
    {animated && <div className="city-tools">
      <button type="button" className="icon-button" aria-label={t("City playground")} title={t("City playground")} onClick={() => {
        playground.current?.showModal();
        setOpen(true);
      }}><Building2 aria-hidden="true" /></button>
      <button type="button" className="icon-button" aria-label={t(paused ? "Resume marina" : "Pause marina")} title={t(paused ? "Resume marina" : "Pause marina")}
        onClick={togglePause} disabled={reduceMotion}>{paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}</button>
    </div>}
    {animated && <dialog ref={playground} className="city-playground" aria-label={t("City playground")} onClose={() => {
      setOpen(false);
      setDomino(false);
      setRace(null);
      setFerry(0);
    }}>
      <header>
        <h2>{t("City playground")}</h2>
        <div className="city-discovery-progress">
          <progress aria-label={t("Explore the marina")} value={found.length} max={buoys.length} />
          <span aria-hidden="true">{found.length} / {buoys.length}</span>
        </div>
        <div className="city-playground-controls">
          <button type="button" className="icon-button" aria-label={t(paused ? "Resume marina" : "Pause marina")} title={t(paused ? "Resume marina" : "Pause marina")}
            onClick={togglePause} disabled={reduceMotion}>{paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}</button>
          <button className="icon-button" type="button" aria-label={t("Close")} onClick={() => playground.current?.close()}><X aria-hidden="true" /></button>
        </div>
      </header>
      <div className={`city-playground-map${paused ? " is-paused" : ""}`} ref={playArea}>
        {open && <CityScene moving={moving} paused={paused} />}
        <div className={`city-domino${domino ? " is-falling" : ""}`} aria-hidden="true">
          {blockHeights.map((height, index) => <span key={height} style={{ "--drop-delay": `${index * 180}ms`, "--city-site-h": `${height}px` } as CSSProperties} onAnimationEnd={index === blockHeights.length - 1 ? () => setDomino(false) : undefined} />)}
        </div>
        {buoys.map(({ x, y, icon: Icon }, index) => <button key={index} className={`city-hotspot${found.includes(index) ? " is-found" : ""}`}
          type="button" style={{ left: `${x}%`, top: `${y}%` }} aria-label={t("Explore the marina")} aria-pressed={found.includes(index)}
          onClick={() => { setDiscovery(index); setFound(previous => previous.includes(index) ? previous : [...previous, index]); }}><Icon aria-hidden="true" /></button>)}
        {found.length === buoys.length && <button type="button" className="city-hotspot city-ferry-signal"
          aria-label={t("Signal the ghost ferry")} onClick={() => { setDiscovery(null); setFerry(n => n + 1); }}>
          <Ship aria-hidden="true" />
        </button>}
        {ferry > 0 && <div key={ferry} className="city-vessel city-yacht city-ghost-ferry" aria-hidden="true" />}
        {boats.map(({ x, y }, index) => <button type="button" key={index}
          className={`city-racer city-racer-${index}${running ? " is-racing" : ""}${race?.winner === index ? " is-first" : ""}`}
          aria-label={racers[index]} aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight" disabled={running}
          style={{ top: `${y}%`, left: `${race?.finished ? 58 : x}%` }}
          onAnimationEnd={() => { if (race && index !== race.winner) { setRace({ ...race, finished: true }); setBoats(raceLanes.map(y => ({ x: 58, y }))); } }}
          onPointerDown={event => beginDrag(event, { x, y })}
          onPointerMove={event => {
            const point = target(event, true);
            if (point) { setRace(null); setBoat(index, point); }
          }}
          onKeyDown={event => { const point = step(event, { x, y }, true); if (point) { setRace(null); setBoat(index, point); } }}>
          <span className={`city-vessel ${index === 0 ? "city-yacht" : "city-jet-ski"}`} />
        </button>)}
        <button type="button" ref={rabbitButton} className="city-rabbit" aria-label={t("Move the bunny")} aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
          style={{ left: `${rabbit.x}%`, top: `${rabbit.y}%` }}
          onPointerDown={event => beginDrag(event, rabbit)}
          onPointerMove={event => {
            const point = target(event, false);
            if (point) setRabbit(point);
          }}
          onPointerUp={() => setBounce(count => count + 1)}
          onKeyDown={event => { const point = step(event, rabbit, false); if (point) setRabbit(point); }}
          onClick={event => { if (event.detail === 0) setBounce(count => count + 1); }}>
          <span key={bounce} className={bounce > 0 && moving && !paused ? "is-hopping" : ""}><Rabbit aria-hidden="true" /></span>
        </button>
      </div>
      <footer>
        <p aria-live="polite">{race?.finished ? t("{boat} wins!", { boat: racers[race.winner] })
          : discovery !== null ? discoveries[discovery]
          : ferry > 0 ? t("A ghost ferry has slipped out of the harbor.")
          : t("Drag the boats on the water or the bunny along the dock.")}</p>
        <div className="city-playground-controls">
          <button type="button" className="btn" onClick={showBunny}><Rabbit aria-hidden="true" />{t("Find the bunny")}</button>
          <button type="button" className="btn" disabled={running || (paused && !reduceMotion)} onClick={startRace}><Flag aria-hidden="true" />{t("Race boats")}</button>
          <button type="button" className="icon-button" aria-label={t("Reset boats")} title={t("Reset boats")} disabled={running} onClick={() => { setRace(null); setBoats(initialBoats); }}><Ship aria-hidden="true" /></button>
          <button type="button" className="btn" disabled={domino || paused} onClick={() => setDomino(true)}>{t("Tip the block towers")}</button>
        </div>
      </footer>
    </dialog>}
  </>;
}
