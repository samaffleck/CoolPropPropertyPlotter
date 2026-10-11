/// <reference lib="webworker" />
// Runs the C++ thermodynamics core (WebAssembly) off the main thread.
import createThermo from "./generated/thermo.mjs";
import wasmUrl from "./generated/thermo.wasm?url";
import { pickIsolineValues } from "../charts/autoIsolines";
import { stateValue } from "../units/properties";
import type { AxesSpec, Request, Response } from "./protocol";
import { curveValue } from "./curve";
import { CURVE_STRIDE, Prop, type ThermoState, type Viewport } from "./types";

type Module = Awaited<ReturnType<typeof createThermo>>;

const modulePromise: Promise<Module> = createThermo({
  locateFile: (path: string) => (path.endsWith(".wasm") ? wasmUrl : path),
});

// Fluids are registered with CoolProp on first use (see core/wasm/all_fluids_CBOR.h).
const loaded = new Map<string, Promise<void>>();

function ensureFluid(m: Module, name: string): Promise<void> {
  let p = loaded.get(name);
  if (!p) {
    p = (async () => {
      const res = await fetch(`${import.meta.env.BASE_URL}fluids/${encodeURIComponent(name)}.json`);
      if (!res.ok) throw new Error(`Could not download fluid data for ${name}`);
      const r = m.loadFluid(await res.text());
      if (!r.ok) throw new Error(r.error);
    })();
    p.catch(() => loaded.delete(name));
    loaded.set(name, p);
  }
  return p;
}

/** Collects the ArrayBuffers of every typed array in a result so they can be transferred. */
function transferables(value: unknown, out: Transferable[] = []): Transferable[] {
  if (ArrayBuffer.isView(value)) {
    out.push(value.buffer as ArrayBuffer);
  } else if (Array.isArray(value)) {
    for (const v of value) transferables(v, out);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) transferables(v, out);
  }
  return out;
}

const lerp = (lo: number, hi: number, log: boolean, t: number) =>
  log ? Math.exp(Math.log(lo) + t * (Math.log(hi) - Math.log(lo))) : lo + t * (hi - lo);

/** A default view: from the triple point to well above the critical point. */
function defaultView(m: Module, fluid: string, axes: AxesSpec): Viewport {
  const info = m.fluidInfo(fluid);
  if (!info) throw new Error(`Unknown fluid ${fluid}`);
  const Tlo = Math.max(info.Ttriple || info.Tmin, info.Tmin);
  const Thi = Math.min(info.Tmax, Math.max(1.6 * info.Tcrit, info.Tcrit + 60));
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
      const r = m.state(fluid, Prop.T, lerp(Tlo, Thi, false, i / N), Prop.P, lerp(plo, phi, true, j / N));
      if (r.ok) add(stateValue(r.state, axes.x), stateValue(r.state, axes.y));
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
function chartAuto(m: Module, fluid: string, vp: Viewport, families: Prop[], units: Parameters<typeof pickIsolineValues>[3], density: number) {
  const ranges = new Map<Prop, [number, number]>(families.map((f) => [f, [Infinity, -Infinity]]));
  const N = 10;
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const r = m.state(fluid, vp.x, lerp(vp.xMin, vp.xMax, vp.xLog, i / N), vp.y, lerp(vp.yMin, vp.yMax, vp.yLog, j / N));
      if (!r.ok) continue;
      for (const f of families) {
        const v = stateValue(r.state as ThermoState, f);
        const rg = ranges.get(f)!;
        if (Number.isFinite(v)) rg[0] = Math.min(rg[0], v), rg[1] = Math.max(rg[1], v);
      }
    }
  }
  const groups = families.map((f) => {
    const [lo, hi] = ranges.get(f)!;
    return { prop: f, values: pickIsolineValues(f, lo, hi, units, density) };
  });
  return m.chart(fluid, vp, groups);
}

async function handle(m: Module, req: Request): Promise<unknown> {
  await ensureFluid(m, req.fluid);
  switch (req.op) {
    case "info":
      return m.fluidInfo(req.fluid);
    case "state":
      return m.state(req.fluid, req.input.a, req.input.va, req.input.b, req.input.vb);
    case "saturation":
      return m.saturation(req.fluid);
    case "chart":
      return m.chart(req.fluid, req.viewport, req.isolines);
    case "chartAuto":
      return chartAuto(m, req.fluid, req.viewport, req.families, req.units, req.density);
    case "defaultView":
      return defaultView(m, req.fluid, req.axes);
    case "process":
      return m.process(req.fluid, req.start, req.spec);
    case "cycle":
      return m.cycle(req.cycle, req.fluid, req.params);
  }
}

self.onmessage = async (e: MessageEvent<Request>) => {
  const req = e.data;
  let res: Response;
  try {
    const m = await modulePromise;
    const t0 = performance.now();
    const result = await handle(m, req);
    res = { id: req.id, ok: true, result, ms: performance.now() - t0 };
  } catch (err) {
    res = { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  self.postMessage(res, transferables(res));
};
