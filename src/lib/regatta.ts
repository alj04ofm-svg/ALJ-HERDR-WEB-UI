export const FLEET_TYPES = ["mixed", "speedboat", "jet-ski", "yacht"] as const;
export const RACE_WEATHERS = ["clear", "fog", "rain"] as const;
export type FleetType = typeof FLEET_TYPES[number];
export type RaceWeather = typeof RACE_WEATHERS[number];

const NAMES = [
  "Hull Yeah", "Pier Pressure", "Buoy Problems", "Stern Warning", "Dockside Menace",
  "Full of Ship", "Wet Regret", "Wake and Bake", "Boaty McBad Idea", "Tax Evasion",
  "Here for the Spray", "Certified Pond Scum",
];

export interface Entrant {
  name: string;
  kind: Exclude<FleetType, "mixed">;
  finish: number;
  rhythm: number;
  phase: number;
  maneuver: "jump" | "spray" | null;
}
export interface RegattaPlan {
  entrants: Entrant[];
  weather: RaceWeather;
  sunset: boolean;
  reporter: number;
}
export const PREP_MS = 2800;
export const START_MS = PREP_MS + 3000;

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap]!, copy[index]!];
  }
  return copy;
}

export function makeRegatta(count: number, fleet: FleetType, weather: RaceWeather | "random", random = Math.random): RegattaPlan {
  const names = shuffled(NAMES, random).slice(0, Math.max(2, Math.min(6, Math.floor(count))));
  const order = shuffled(names, random);
  const incidents = shuffled(names, random);
  return {
    entrants: names.map((name, index) => ({
      name,
      kind: fleet === "mixed" ? FLEET_TYPES[1 + index % 3]! as Entrant["kind"] : fleet,
      finish: 10600 + order.indexOf(name) * 310 + random() * 220,
      rhythm: .08 + random() * .045,
      phase: random() * Math.PI * 2,
      maneuver: name === incidents[0] ? "jump" : name === incidents[1] ? "spray" : null,
    })),
    weather: weather === "random" ? RACE_WEATHERS[Math.floor(random() * RACE_WEATHERS.length)]! : weather,
    sunset: random() < .5,
    reporter: Math.floor(random() * 3),
  };
}

export function raceProgress(boat: Entrant, elapsed: number): number {
  const portion = Math.max(0, Math.min(1, elapsed / boat.finish));
  return portion + Math.sin(portion * Math.PI) * Math.sin(portion * Math.PI * 2 + boat.phase) * boat.rhythm;
}

export interface Course { start: number; end: number; top: number; depth: number; bend: number }
export function harborCourse(width: number, height: number, shore: number, composerTop: number): Course {
  const margin = Math.max(18, Math.min(52, width * .055));
  const top = Math.min(Math.max(0, height - 28), Math.max(height * .63, shore + 12));
  const bottom = Math.min(height - 12, Math.max(top + 22, composerTop - 16));
  // Compact or open composer layouts can leave a single visible channel. Keep the fleet's
  // positions within the water, even if some lanes have to run behind the composer.
  return { start: margin, end: Math.max(margin + 1, width - margin), top, depth: Math.max(12, bottom - top), bend: Math.min(12, (bottom - top) * .20) };
}
