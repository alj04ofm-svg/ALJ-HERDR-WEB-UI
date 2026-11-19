import { describe, expect, it } from "bun:test";
import { emptySidebarLayout, moveSidebarGroup, moveSidebarRow, orderSidebarRows, removeSidebarGroup, sanitizeSidebarLayout, sidebarRowKey, saveSidebarLayout, SIDEBAR_LAYOUT_KEY } from "./sidebarLayout.ts";

const fixture = () => ({ ...emptySidebarLayout(), groups: [{ id: "a", name: "Launch", collapsed: false }, { id: "b", name: "Later", collapsed: true }] });
describe("browser sidebar organization", () => {
  it("keeps pane and terminal identity scoped to its machine", () => {
    expect(new Set([sidebarRowKey("local", "p1", "t1"), sidebarRowKey("remote", "p1", "t1"), sidebarRowKey("local", "p1", "t2")]).size).toBe(3);
  });
  it("moves a row into and out of a group without changing labels, identity or its siblings", () => {
    const old = { ...fixture(), labels: { x: "Custom label" } };
    const grouped = moveSidebarRow(old, ["x", "y", "z"], "x", "a");
    expect(grouped.membership).toEqual({ x: "a" });
    expect(orderSidebarRows(["x", "y", "z"], grouped, x => x)).toEqual(["y", "z", "x"]);
    expect(moveSidebarRow(grouped, ["x", "y", "z"], "x", null).membership).toEqual({});
    expect(grouped.labels).toEqual(old.labels);
    expect(old.membership).toEqual({});
  });
  it("uses explicit before/after targets, including moving down from the first position", () => {
    const old = { ...fixture(), order: ["x", "y", "z"] };
    expect(moveSidebarRow(old, old.order, "x", null, { key: "y", after: true }).order).toEqual(["y", "x", "z"]);
    expect(moveSidebarRow(old, old.order, "z", null, { key: "x", after: false }).order).toEqual(["z", "x", "y"]);
  });
  it("refuses foreign targets and self-drops without erasing data", () => {
    const old = fixture();
    expect(moveSidebarRow(old, ["x"], "absent", "a")).toBe(old);
    expect(moveSidebarRow(old, ["x"], "x", "foreign")).toBe(old);
    expect(moveSidebarRow(old, ["x"], "x", "a", { key: "x", after: true })).toBe(old);
  });
  it("retains offline/missing rows, custom labels and collapsed groups through reconciliation/reload", () => {
    const old = { ...fixture(), order: ["offline", "y", "x"], membership: { offline: "b", x: "a" }, labels: { offline: "Keep me", x: "Current" } };
    const next = sanitizeSidebarLayout(JSON.parse(JSON.stringify(moveSidebarRow(old, ["x", "y", "new"], "y", "a"))));
    expect(next.order).toContain("offline");
    expect(next.membership.offline).toBe("b");
    expect(next.labels.offline).toBe("Keep me");
    expect(next.groups[1]?.collapsed).toBe(true);
    const visible = orderSidebarRows(["x", "y", "new"], next, x => x);
    expect(new Set(visible).size).toBe(3);
  });
  it("leaves saved pin/native/activity ordering intact until an explicit custom ordering exists", () => {
    expect(orderSidebarRows(["pin2", "pin1", "native2", "native1"], emptySidebarLayout(), x => x)).toEqual(["pin2", "pin1", "native2", "native1"]);
    expect(orderSidebarRows(["pin2", "pin1", "native2", "native1"], { ...fixture(), order: ["pin1", "pin2"] }, x => x)).toEqual(["pin1", "pin2", "native2", "native1"]);
  });
  it("reorders groups in both directions and leaves memberships untouched", () => {
    const old = { ...fixture(), membership: { x: "a" } };
    const moved = moveSidebarGroup(old, "a", "b", true);
    expect(moved.groups.map(g => g.id)).toEqual(["b", "a"]);
    expect(moved.membership).toBe(old.membership);
    expect(moveSidebarGroup(moved, "a", "b", false).groups.map(g => g.id)).toEqual(["a", "b"]);
  });
  it("removing a group ungroups its rows and preserves saved row order/aliases", () => {
    const old = { ...fixture(), order: ["x", "y"], membership: { x: "a", y: "b" }, labels: { x: "Custom" } };
    const next = removeSidebarGroup(old, "a");
    expect(next.membership).toEqual({ y: "b" });
    expect(next.labels).toEqual(old.labels);
    expect(next.order).toEqual(old.order);
  });
  it("sanitizes corrupt/duplicate values and orphan group references", () => {
    expect(sanitizeSidebarLayout(null)).toEqual(emptySidebarLayout());
    const next = sanitizeSidebarLayout({ version: 1, groups: [{ id: "a", name: "  Work  " }, { id: "a", name: "Duplicate" }, null], order: ["x", "x", false], membership: { x: "a", y: "absent" }, labels: { x: " Custom ", y: false } });
    expect(next).toEqual({ version: 1, groups: [{ id: "a", name: "Work", collapsed: false }], order: ["x"], membership: { x: "a" }, labels: { x: "Custom" } });
  });
  it("does not report success when browser storage refuses the write", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    try {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { setItem: () => { throw new Error("blocked"); } } });
      expect(saveSidebarLayout(fixture())).toBe(false);
    } finally { if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor); else Reflect.deleteProperty(globalThis, "localStorage"); }
  });
  it("persists only organization under its own versioned key", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    const written: Record<string, string> = {};
    try {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { setItem: (key: string, value: string) => { written[key] = value; } } });
      expect(saveSidebarLayout(fixture())).toBe(true);
      expect(Object.keys(written)).toEqual([SIDEBAR_LAYOUT_KEY]);
      expect(sanitizeSidebarLayout(JSON.parse(written[SIDEBAR_LAYOUT_KEY]!))).toEqual(fixture());
    } finally { if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor); else Reflect.deleteProperty(globalThis, "localStorage"); }
  });
});
