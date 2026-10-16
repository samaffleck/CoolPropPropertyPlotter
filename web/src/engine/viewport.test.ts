import { expect, it, vi } from "vitest";
import type { ThermoModule } from "./generated/thermo.mjs";
import { Prop, type ThermoPoint, type Viewport } from "./types";
import { chartAuto } from "./viewport";
import { UNIT_SYSTEMS } from "../units/units";

const view: Viewport = { x: Prop.T, y: Prop.P, xLog: false, yLog: true, xMin: 200, xMax: 400, yMin: 1e5, yMax: 1e6 };
const units = UNIT_SYSTEMS[0].units;

function moduleStub() {
  const chart = vi.fn(() => ({ ok: true as const, isolines: [], domain: { Tmin: 200, Tmax: 400, pmin: 1e5, pmax: 1e6 } }));
  const point = vi.fn((_fluid: string, _a: number, T: number) => ({
    ok: true as const, point: { T, h: T * 1000 } as ThermoPoint,
  }));
  return { chart, point, state: vi.fn() };
}

it("skips all selection probes when no isoline families are enabled", () => {
  const m = moduleStub();
  const result = chartAuto(m as unknown as ThermoModule, "Nitrogen", view, view, [], units, 10);
  expect(m.state).not.toHaveBeenCalled();
  expect(m.point).not.toHaveBeenCalled();
  expect(m.chart).toHaveBeenCalledExactlyOnceWith("Nitrogen", view, []);
  expect(result).toEqual({ ok: true, isolines: [], domain: { Tmin: 200, Tmax: 400, pmin: 1e5, pmax: 1e6 } });
});

it("still probes enabled families and draws them in the overscanned viewport", () => {
  const m = moduleStub();
  const expanded = { ...view, xMin: 130, xMax: 470 };
  chartAuto(m as unknown as ThermoModule, "Nitrogen", view, expanded, [Prop.H], units, 10);
  expect(m.state).not.toHaveBeenCalled();
  expect(m.point).toHaveBeenCalledTimes(121);
  expect(m.chart).toHaveBeenCalledOnce();
  const [, curveView, groups] = (m.chart.mock.calls[0] as unknown as [string, Viewport, { prop: number; values: number[] }[]]);
  expect(curveView).toBe(expanded);
  expect(groups[0].prop).toBe(Prop.H);
  expect(groups[0].values.length).toBeGreaterThan(0);
});
