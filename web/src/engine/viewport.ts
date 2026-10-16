// Viewport calculations run in the worker; kept separate so they can also be verified against WASM.
import type { ThermoModule as Module } from "./generated/thermo.mjs";
import { pickIsolineValues } from "../charts/autoIsolines";
import { stateValue } from "../units/properties";
import type { AxesSpec } from "./protocol";
import { curveValue } from "./curve";
import { CURVE_STRIDE, Prop, type Viewport } from "./types";

const lerp = (lo: number, hi: number, log: boolean, t: number) =>
  log ? Math.exp(Math.log(lo) + t * (Math.log(hi) - Math.log(lo))) : lo + t * (hi - lo);

/** A default view: from the triple point to well above the critical point. */
export function defaultView(m: Module, fluid: string, axes: AxesSpec): Viewport {
  const info = m.fluidInfo(fluid);
  if (!info) throw new Error(`Unknown fluid ${fluid}`);
  const Tlo = Math.max(info.Ttriple || info.Tmin, info.Tmin);
  const Thi = Math.min(info.Tmax, 1.6 * info.Tcrit);
  const plo = Math.max(Number.isFinite(info.ptriple) ? info.ptriple : 0, info.pcrit / 500);
  const phi = Math.min(info.pmax, 5 * info.pcrit);

  const xs: number[] = [];
  const ys: number[] = [];
  const add = (x: number, y: number) => {
    if (Number.isFinite(x) && Number.isFinite(y)) xs.push(x), ys.push(y);
  };
  const sat = m.saturation(fluid);
  for (let i = 0; i < sat.dome.length / CURVE_STRIDE; i++) {
    const T = curveValue(sat.dome, i, Prop.T);
    const p = curveValue(sat.dome, i, Prop.P);
    if (T >= Tlo && p >= plo) add(curveValue(sat.dome, i, axes.x), curveValue(sat.dome, i, axes.y));
  }
  const N = 8;
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const r = m.point(fluid, Prop.T, lerp(Tlo, Thi, false, i / N), Prop.P, lerp(plo, phi, true, j / N));
      if (r.ok) add(stateValue(r.point, axes.x), stateValue(r.point, axes.y));
    }
  }
  const range = (v: number[], prop: Prop, log: boolean): [number, number] => {
    if (prop === Prop.T) return [Tlo, Thi];
    if (prop === Prop.P) return [plo, phi];
    let lo = Math.min(...v);
    let hi = Math.max(...v);
    if (log) {
      const pad = 0.03 * Math.log(hi / lo);
      return [lo * Math.exp(-pad), hi * Math.exp(pad)];
    }
    const pad = 0.03 * (hi - lo);
    lo -= pad;
    hi += pad;
    return [lo, hi];
  };
  const [xMin, xMax] = range(xs, axes.x, axes.xLog);
  const [yMin, yMax] = range(ys, axes.y, axes.yLog);
  return { ...axes, xMin, xMax, yMin, yMax };
}

/** Probe the viewport to find each family's value range, pick round values, and compute curves. */
export function chartAuto(m: Module, fluid: string, vp: Viewport, curveVp: Viewport, families: Prop[], units: Parameters<typeof pickIsolineValues>[3], density: number) {
  if (families.length === 0) return m.chart(fluid, curveVp, []);
  const ranges = new Map<Prop, [number, number]>(families.map((f) => [f, [Infinity, -Infinity]]));
  const samples = new Map<Prop, number[]>(families.map((f) => [f, []]));
  const N = 10;
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const r = m.point(fluid, vp.x, lerp(vp.xMin, vp.xMax, vp.xLog, i / N), vp.y, lerp(vp.yMin, vp.yMax, vp.yLog, j / N));
      if (!r.ok) continue;
      for (const f of families) {
        const v = stateValue(r.point, f);
        const rg = ranges.get(f)!;
        if (Number.isFinite(v)) {
          rg[0] = Math.min(rg[0], v), rg[1] = Math.max(rg[1], v);
          samples.get(f)!.push(v);
        }
      }
    }
  }
  const groups = families.map((f) => {
    let [lo, hi] = ranges.get(f)!;
    if (f === Prop.H) {
      // Sparse, extreme flashes in broad T–s viewports can otherwise swamp the useful enthalpy range.
      const values = samples.get(f)!.sort((a, b) => a - b);
      if (values.length >= 10) {
        const last = values.length - 1;
        const robustLo = values[Math.floor(last * 0.1)];
        const robustHi = values[Math.ceil(last * 0.9)];
        if (robustHi > robustLo) [lo, hi] = [robustLo, robustHi];
      }
    }
    return { prop: f, values: pickIsolineValues(f, lo, hi, units, density) };
  });
  return m.chart(fluid, curveVp, groups);
}
