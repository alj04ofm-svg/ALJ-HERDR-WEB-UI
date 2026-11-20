import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { ChevronDown, Flag, Radio, Shuffle, X } from "lucide-react";
import { FLEET_TYPES, RACE_WEATHERS, PREP_MS, START_MS, harborCourse, makeRegatta, raceProgress, type Entrant, type RaceWeather, type RegattaPlan } from "../lib/regatta.ts";
import { useT } from "../lib/i18n.ts";
import "./CityRegatta.css";

export type RegattaScene = { weather: RaceWeather; sunset: boolean } | null;
type Phase = "prepare" | "3" | "2" | "1" | "race" | "finish";

function boatKind(kind: Entrant["kind"], t: ReturnType<typeof useT>) {
  return kind === "jet-ski" ? t("Jet ski") : kind === "speedboat" ? t("Speedboat") : t("Yacht");
}

interface Props {
  open: boolean;
  anchor: RefObject<HTMLButtonElement>;
  onClose(restoreFocus?: boolean): void;
  controlsId: string;
  paused: boolean;
  reduced: boolean;
  onScene(scene: RegattaScene): void;
  children: ReactNode;
}

export function CityRegatta({ open, anchor, onClose, controlsId, paused, reduced, onScene, children }: Props) {
  const t = useT();
  const [custom, setCustom] = useState(false);
  const [count, setCount] = useState(4);
  const [fleet, setFleet] = useState(FLEET_TYPES[0] as typeof FLEET_TYPES[number]);
  const [weather, setWeather] = useState<RaceWeather | "random">("random");
  const [plan, setPlan] = useState<RegattaPlan | null>(null);
  const [pick, setPick] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [leader, setLeader] = useState<number | null>(null);
  const [note, setNote] = useState<"jump" | "spray" | null>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const controls = useRef<HTMLDivElement>(null);
  const fleetFocus = useRef<HTMLSelectElement>(null);
  const headline = useRef<HTMLHeadingElement>(null);
  const finish = useRef<HTMLButtonElement>(null);
  const clock = useRef(0);
  const active = Boolean(phase && phase !== "finish");
  const running = Boolean(plan && phase);
  const winner = plan?.entrants.reduce((best, boat) => boat.finish < best.finish ? boat : best);

  const draw = (quick: boolean) => {
    setPlan(makeRegatta(quick ? 3 + Math.floor(Math.random() * 4) : count, quick ? "mixed" : fleet, quick ? "random" : weather));
    setPick(null);
    setPhase(null);
    setCustom(false);
  };
  const launch = () => {
    if (!plan || pick === null || (paused && !reduced)) return;
    clock.current = 0;
    setLeader(null);
    setNote(null);
    setPhase(reduced ? "finish" : "prepare");
    if (!reduced) onScene({ weather: plan.weather, sunset: plan.sunset });
    headline.current?.focus();
  };
  const dismiss = () => {
    setPlan(null);
    setPhase(null);
    onScene(null);
    requestAnimationFrame(() => document.getElementById(controlsId)?.querySelector<HTMLButtonElement>(".regatta-quick")?.focus());
  };

  useEffect(() => {
    if (open && plan && !phase) fleetFocus.current?.focus({ preventScroll: true });
    if (open && phase === "finish" && headline.current === document.activeElement) finish.current?.focus({ preventScroll: true });
  }, [open, plan, phase]);

  useLayoutEffect(() => {
    const panel = controls.current;
    const scene = panel?.parentElement;
    const composer = scene?.closest(".terminal-host")?.querySelector(".composer");
    const trigger = anchor.current;
    if (!panel || !scene || !trigger) return;
    const measure = () => {
      const bounds = scene.getBoundingClientRect();
      const button = trigger.getBoundingClientRect();
      const width = panel.offsetWidth;
      const left = button.left < bounds.left + bounds.width / 2 ? button.left : button.right - width;
      const top = Math.max(6, button.bottom - bounds.top + 6);
      panel.style.setProperty("--regatta-left", `${Math.max(6, Math.min(bounds.width - width - 6, left - bounds.left))}px`);
      panel.style.setProperty("--regatta-top", `${top}px`);
      panel.style.setProperty("--marina-space", `${(composer?.getBoundingClientRect().top ?? bounds.bottom) - bounds.top}px`);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(scene);
    observer.observe(trigger);
    observer.observe(panel);
    if (composer) observer.observe(composer);
    measure();
    return () => observer.disconnect();
  }, [anchor, open]);

  useEffect(() => {
    if (!open) return;
    const dismissOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || controls.current?.contains(event.target) ||
        anchor.current?.closest(".city-tools")?.contains(event.target) || event.target.closest(".city-racer")) return;
      onClose(false);
    };
    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
  }, [anchor, onClose, open]);

  useEffect(() => {
    const track = overlay.current;
    const host = track?.closest(".terminal-host");
    if (!track || !host || !plan || !running || reduced) return;
    const entrants = plan.entrants;
    const composer = host.querySelector(".composer");
    const scene = host.closest(".app")?.querySelector(".city-backdrop") ?? host.querySelector(".city-backdrop");
    const craft = [...track.querySelectorAll<HTMLElement>(".regatta-craft")];
    const gate = track.querySelector<HTMLElement>(".regatta-start-gate");
    const line = track.querySelector<HTMLElement>(".regatta-finish-gate");
    const ramp = track.querySelector<HTMLElement>(".regatta-ramp");
    const crowd = track.querySelector<HTMLElement>(".regatta-quay");
    let course: ReturnType<typeof harborCourse>;
    const measure = () => {
      const area = track.getBoundingClientRect();
      const water = scene?.getBoundingClientRect();
      const shore = water ? water.top + water.height * .683 - area.top : area.height * .683;
      course = harborCourse(area.width, area.height, shore, composer ? composer.getBoundingClientRect().top - area.top : area.height * .90);
      gate?.style.setProperty("--gate-x", `${course.start}px`);
      line?.style.setProperty("--gate-x", `${course.end}px`);
      track.style.setProperty("--race-top", `${course.top - 5}px`);
      track.style.setProperty("--race-depth", `${course.depth + 10}px`);
      crowd?.style.setProperty("--regatta-shore", `${shore}px`);
      ramp?.style.setProperty("--ramp-x", `${course.start + (course.end - course.start) * .55}px`);
      ramp?.style.setProperty("--ramp-y", `${course.top + course.depth * (plan.entrants.findIndex(boat => boat.maneuver === "jump") + .5) / plan.entrants.length}px`);
      paint(clock.current);
    };
    function paint(time: number) {
      const racingTime = Math.max(0, time - START_MS);
      let front = -1;
      let frontProgress = -1;
      let report: "jump" | "spray" | null = null;
      entrants.forEach((boat, index) => {
        const node = craft[index];
        if (!node) return;
        const progress = raceProgress(boat, racingTime);
        if (progress > frontProgress || (progress === frontProgress && boat.finish < entrants[front]!.finish)) {
          front = index;
          frontProgress = progress;
        }
        const rampDistance = Math.abs(progress - .55);
        const jump = boat.maneuver === "jump" && rampDistance < .05 ? (1 - rampDistance / .05) * 19 : 0;
        const spray = boat.maneuver === "spray" && Math.abs(progress - .71) < .044;
        if (jump > 0) report = "jump";
        else if (spray) report = "spray";
        const x = course.start + progress * (course.end - course.start);
        const y = course.top + course.depth * (index + .5) / entrants.length + Math.sin(progress * Math.PI * 2) * course.bend - jump;
        node.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
        const stunt = jump > 0 ? "jump" : spray ? "spray" : "";
        if (node.dataset.stunt !== stunt) node.dataset.stunt = stunt;
      });
      return { front, report };
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    if (composer) observer.observe(composer);
    let frame = 0;
    let previous: number | null = null;
    let lastPhase: Phase | null = null;
    let lastLeader = -1;
    let lastReport: "jump" | "spray" | null = null;
    const end = START_MS + Math.max(...plan.entrants.map(boat => boat.finish)) + 260;
    function tick(at: number) {
      if (previous !== null) clock.current = Math.min(end, clock.current + Math.min(50, at - previous));
      previous = at;
      const time = clock.current;
      const current = time >= end ? "finish" : time >= START_MS ? "race"
        : time >= PREP_MS + 2000 ? "1" : time >= PREP_MS + 1000 ? "2" : time >= PREP_MS ? "3" : "prepare";
      const { front, report } = paint(time);
      if (current !== lastPhase) { lastPhase = current; setPhase(current); }
      if (current === "race" && front !== lastLeader) { lastLeader = front; setLeader(front); }
      if (report && report !== lastReport) { lastReport = report; setNote(report); }
      if (current === "finish") { onScene(null); return; }
      frame = requestAnimationFrame(tick);
    }
    if (!paused && active) frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [plan, running, reduced, paused, active, onScene]);

  const name = leader === null ? "" : plan?.entrants[leader]?.name ?? "";
  const setpiece = phase === "prepare" ? (plan?.reporter === 0 ? t("Crews are launching. Spectators are gathering on the quay.")
    : plan?.reporter === 1 ? t("The floodlights are up. Marshals are clearing the channel.") : t("Pit crews have the boats on the start line."))
    : phase === "race" ? note === "jump" ? t("A boat has taken the ramp!") : note === "spray" ? t("A tight pass sends spray across the course.")
      : name ? t("{boat} leads", { boat: name }) : t("Race in progress") : "";
  const result = winner && phase === "finish" ? t("{boat} wins!", { boat: winner.name }) : "";
  const weatherName = plan?.weather === "fog" ? t("Coastal fog") : plan?.weather === "rain" ? t("Rain showers") : t("Clear skies");

  return <>
    {plan && phase && !reduced && <div className="regatta-overlay" ref={overlay} data-phase={phase} data-paused={paused} aria-hidden="true">
      <div className="regatta-quay">
        {[12, 26, 73, 86].map((x, group) => <div className="regatta-stand" key={x} style={{ left: `${x}%` }}>
          <span className="regatta-floodlight" />
          {Array.from({ length: 5 }, (_, person) => <span className="regatta-person" key={person}
            style={{ "--spectator-slot": person, "--spectator-from": `${group < 2 ? -65 - person * 9 : 60 + person * 8}px` } as CSSProperties}><i /></span>)}
        </div>)}
      </div>
      <div className="regatta-start-gate"><i /><i /><i /></div>
      <div className="regatta-finish-gate" />
      <div className="regatta-ramp" />
      {plan.entrants.map((boat, index) => <div className="regatta-craft" key={boat.name} data-kind={boat.kind}
        data-winner={phase === "finish" && boat === winner} style={{ "--livery": `${index * 46}deg` } as CSSProperties}>
        <span className={`city-vessel city-${boat.kind}`} />
        <span className="regatta-splash" /><b>{index + 1}</b>
      </div>)}
    </div>}
    {open && <div className="city-marina-controls regatta-controls" id={controlsId} ref={controls} role="group" aria-label={t("Marina controls")}>
      {plan ? <>
        <div className="regatta-heading">
          <h2 ref={headline} tabIndex={-1}>{t("Harbor Grand Prix")}</h2>
          <button type="button" className="icon-button" aria-label={t(active ? "Cancel race" : "Back to marina")} onClick={dismiss}><X aria-hidden="true" /></button>
        </div>
        {!phase ? <div className="regatta-grid">
          <label>{t("Pick your winner")}
            <select className="select" ref={fleetFocus} value={pick ?? ""} onChange={event => setPick(event.target.value === "" ? null : Number(event.target.value))}>
              <option value="">{t("Choose a boat")}</option>
              {plan.entrants.map((boat, index) => <option key={boat.name} value={index}>{index + 1}. {boat.name}</option>)}
            </select>
          </label>
          <p>{weatherName} · {plan.sunset ? t("Sunset") : t("Under floodlights")}{pick !== null && plan.entrants[pick] && <> · {boatKind(plan.entrants[pick].kind, t)}</>}</p>
          <button type="button" className="btn btn-primary" disabled={pick === null || (paused && !reduced)} onClick={launch}><Flag aria-hidden="true" />{t(reduced ? "Show race result" : "Start race")}</button>
        </div> : phase === "finish" ? <div className="regatta-results">
          <strong>{result}</strong>
          <p>{plan.entrants[pick ?? -1] === winner ? t("You picked the winner.") : t("Your pick was {boat}.", { boat: plan.entrants[pick ?? -1]?.name ?? "" })}</p>
          <details><summary>{t("Results")}</summary><ol>{[...plan.entrants].sort((a, b) => a.finish - b.finish).map(boat => <li key={boat.name}><span>{boat.name}</span><time>{(boat.finish / 1000).toFixed(2)}s</time></li>)}</ol></details>
          <button type="button" className="btn" ref={finish} onClick={() => draw(false)}>{t("Race again")}</button>
        </div> : <div className="regatta-live">
          <strong>{paused ? t("Race paused") : phase === "prepare" ? t("Preparing the marina") : phase === "race" ? t("Race in progress") : phase}</strong>
          <p><Radio aria-hidden="true" />{setpiece || t("Waiting for the green light.")}</p>
        </div>}
      </> : <>
        <div className="city-marina-actions">
          <button type="button" className="btn btn-primary regatta-quick" onClick={() => draw(true)}><Shuffle aria-hidden="true" />{t("Quick race")}</button>
          <button type="button" className="btn" aria-expanded={custom} onClick={() => setCustom(value => !value)}>{t("Race setup")}</button>
          <button type="button" className="icon-button regatta-close" aria-label={t("Close")} onClick={() => onClose()}><X aria-hidden="true" /></button>
        </div>
        {custom ? <form className="regatta-grid" onSubmit={event => { event.preventDefault(); draw(false); }}>
          <label>{t("Fleet size")}<select className="select" value={count} onChange={event => setCount(Number(event.target.value))}>{[2, 3, 4, 5, 6].map(n => <option key={n}>{n}</option>)}</select></label>
          <label>{t("Boat class")}<select className="select" value={fleet} onChange={event => setFleet(event.target.value as typeof fleet)}>
            {FLEET_TYPES.map(kind => <option key={kind} value={kind}>{kind === "mixed" ? t("Mixed fleet") : boatKind(kind, t)}</option>)}
          </select></label>
          <label>{t("Race weather")}<select className="select" value={weather} onChange={event => setWeather(event.target.value as typeof weather)}>
            <option value="random">{t("Random")}</option>
            {RACE_WEATHERS.map(kind => <option value={kind} key={kind}>{kind === "clear" ? t("Clear skies") : kind === "fog" ? t("Coastal fog") : t("Rain showers")}</option>)}
          </select></label>
          <button type="submit" className="btn">{t("Show lineup")}</button>
        </form> : <details className="regatta-more"><summary>{t("Marina")} <ChevronDown aria-hidden="true" /></summary>{children}</details>}
      </>}
    </div>}
    {phase && <span className="visually-hidden" role="status">{result || (phase === "prepare" ? setpiece : phase === "race" ? t("Race in progress") : phase)}</span>}
  </>;
}
