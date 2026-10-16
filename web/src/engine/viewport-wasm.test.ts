import { beforeAll, describe, expect, it, vi } from "vitest";
import createThermo, { type ThermoModule } from "./generated/thermo.mjs";
import { chartAuto, defaultView } from "./viewport";
import { CHARTS } from "../charts/charts";
import { Prop, type StateInput } from "./types";
import { UNIT_SYSTEMS } from "../units/units";

const fluids = ["Nitrogen", "Water", "R134a", "CarbonDioxide", "Helium"];
let m: ThermoModule;
let full: ThermoModule;

beforeAll(async () => {
  m = await createThermo();
  const files = import.meta.glob<string>("../../public/fluids/*.json", { query: "?raw", import: "default" });
  for (const fluid of fluids) {
    const result = m.loadFluid(await files[`../../public/fluids/${fluid}.json`]());
    if (!result.ok) throw new Error(result.error);
  }
  // Reference path uses the full state calculations that viewport probes used before.
  full = { ...m, point: (...args) => {
    const result = m.state(...args);
    return result.ok ? { ok: true, point: result.state } : result;
  } };
});

for (const fluid of fluids) {
  describe(fluid, () => {
    it("matches full-state coordinates in single-phase and saturated states", () => {
      const info = m.fluidInfo(fluid)!;
      const inputs: StateInput[] = [
        { a: Prop.T, va: info.Tcrit * 1.2, b: Prop.P, vb: info.pcrit / 2 },
        ...[0, 0.5, 1].map((Q) => ({ a: Prop.T, va: (info.Ttriple + info.Tcrit) / 2, b: Prop.Q, vb: Q })),
      ];
      for (const { a, va, b, vb } of inputs) {
        const actual = m.point(fluid, a, va, b, vb);
        const expected = m.state(fluid, a, va, b, vb);
        expect(actual.ok).toBe(true);
        expect(expected.ok).toBe(true);
        if (!actual.ok || !expected.ok) throw new Error("Flash failed");
        expect(Object.keys(actual.point).sort()).toEqual(["T", "p", "rho", "v", "h", "s", "u", "Q"].sort());
        for (const key of Object.keys(actual.point) as (keyof typeof actual.point)[]) {
          expect(actual.point[key], key).toBe(expected.state[key]);
        }
        // Internal energy remains available as an input and output coordinate.
        const fromU = m.point(fluid, Prop.D, actual.point.rho, Prop.U, actual.point.u);
        expect(fromU.ok).toBe(true);
        if (fromU.ok) expect(fromU.point.T).toBeCloseTo(expected.state.T, 5);
      }
    });

    it("preserves flash error results", () => {
      expect(m.point(fluid, Prop.P, 1e5, Prop.P, 2e5)).toEqual(m.state(fluid, Prop.P, 1e5, Prop.P, 2e5));
      expect(m.point(fluid, Prop.T, NaN, Prop.P, 1e5)).toEqual(m.state(fluid, Prop.T, NaN, Prop.P, 1e5));
    });

    for (const chart of CHARTS) {
      it(`preserves the ${chart.id} viewport and isolines without full-state probes`, () => {
        const state = vi.fn(() => { throw new Error("Viewport requested a full state"); });
        const optimized = { ...m, state };
        const actualView = defaultView(optimized, fluid, chart);
        expect(actualView).toEqual(defaultView(full, fluid, chart));
        const actual = chartAuto(optimized, fluid, actualView, actualView, chart.families, UNIT_SYSTEMS[0].units, 10);
        const expected = chartAuto(full, fluid, actualView, actualView, chart.families, UNIT_SYSTEMS[0].units, 10);
        expect(actual).toEqual(expected);
        expect(state).not.toHaveBeenCalled();
      });
    }
  });
}
