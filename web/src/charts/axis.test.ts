import { describe, expect, it } from "vitest";
import { UNITS } from "../units/units";
import { Axis, ticks } from "./axis";

const K = UNITS.temperature[0];
const C = UNITS.temperature[1];
const bar = UNITS.pressure[0];

describe("axis", () => {
  it("maps linear and log values to pixels and back", () => {
    const lin = new Axis(100, 300, false, 0, 200);
    expect(lin.toPx(200)).toBe(100);
    expect(lin.fromPx(50)).toBe(150);
    const log = new Axis(1e3, 1e7, true, 0, 400);
    expect(log.toPx(1e5)).toBeCloseTo(200);
    expect(log.fromPx(300)).toBeCloseTo(1e6);
  });

  it("zooms around the cursor", () => {
    const a = new Axis(0, 100, false, 0, 100);
    const [lo, hi] = a.zoomed(0.5, 20);
    expect(lo).toBeCloseTo(10);
    expect(hi).toBeCloseTo(60);
  });

  it("produces round ticks in display units", () => {
    const a = new Axis(273.15, 373.15, false, 0, 500);
    const t = ticks(a, C, 500);
    expect(t[0].label).toBe("0");
    expect(t.at(-1)!.label).toBe("100");
    expect(t[1].value).toBeCloseTo(273.15 + 20);
    expect(ticks(new Axis(80, 300, false, 0, 600), K, 600).map((x) => x.label)).toContain("100");
  });

  it("produces decade ticks on log axes", () => {
    const t = ticks(new Axis(1e4, 1e7, true, 0, 300), bar, 300);
    const labels = t.filter((x) => x.label).map((x) => x.label);
    // 100 px per decade: label 1 and 3 (nearly evenly spaced in log space).
    expect(labels).toEqual(["0.1", "0.3", "1", "3", "10", "30", "100"]);
  });
});
