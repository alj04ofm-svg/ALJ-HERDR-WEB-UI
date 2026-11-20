import { expect, test } from "bun:test";
import { harborCourse, makeRegatta, raceProgress } from "./regatta.ts";

function seeded(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

test("a custom fleet honors the setup, carves out distinct finishes and varies winners", () => {
  const winners = new Set<string>();
  for (let seed = 1; seed < 25; seed++) {
    const race = makeRegatta(6, "jet-ski", "fog", seeded(seed));
    expect(race.weather).toBe("fog");
    expect(race.entrants.every(boat => boat.kind === "jet-ski")).toBe(true);
    expect(new Set(race.entrants.map(boat => boat.name)).size).toBe(6);
    const order = race.entrants.map(boat => boat.finish).sort((a, b) => a - b);
    expect(order[1]!-order[0]!).toBeGreaterThan(85);
    winners.add(race.entrants.find(boat => boat.finish === order[0])!.name);
    expect(race.entrants.filter(boat => boat.maneuver === "jump")).toHaveLength(1);
  }
  expect(winners.size).toBeGreaterThan(6);
});

test("boats cross the finish once and the compact course stays below the quay", () => {
  for (const boat of makeRegatta(6, "mixed", "random", seeded(20)).entrants) {
    let previous = 0;
    for (let elapsed = 0; elapsed < boat.finish; elapsed += 100) {
      const now = raceProgress(boat, elapsed);
      expect(now).toBeGreaterThanOrEqual(previous);
      expect(now).toBeLessThan(1);
      previous = now;
    }
    expect(raceProgress(boat, boat.finish)).toBe(1);
  }
  expect(harborCourse(1100, 840, 562, 685).top).toBeGreaterThan(562);
  const course = harborCourse(320, 370, 260, 241);
  expect(course.top + course.depth).toBeLessThan(370);
  expect(course.top).toBeGreaterThan(260);
});
