// Promise-based client for the thermodynamics worker.
import type { UnitChoice } from "../units/units";
import type { AxesSpec, RequestBody, Response } from "./protocol";
import type {
  ChartResult,
  CycleResult,
  FluidInfo,
  ProcessResult,
  ProcessSpec,
  Prop,
  Result,
  Saturation,
  StateInput,
  ThermoState,
  Viewport,
} from "./types";

const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
let nextId = 1;

worker.onmessage = (e: MessageEvent<Response>) => {
  const res = e.data;
  const p = pending.get(res.id);
  if (!p) return;
  pending.delete(res.id);
  if (res.ok) p.resolve(res.result);
  else p.reject(new Error(res.error));
};

function call<T>(body: RequestBody): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    worker.postMessage({ ...body, id });
  });
}

// Endpoint calculation and connection rendering ask for the same process. Keep
// the promise so both in-flight and completed results (including paths) are shared.
const processCache = new Map<string, Promise<Result<ProcessResult>>>();
const PROCESS_CACHE_LIMIT = 128;

function process(fluid: string, start: StateInput, spec: ProcessSpec): Promise<Result<ProcessResult>> {
  const key = JSON.stringify([fluid, start.a, start.va, start.b, start.vb, spec.kind, spec.target, spec.value, spec.efficiency ?? 1]);
  const cached = processCache.get(key);
  if (cached) {
    processCache.delete(key);
    processCache.set(key, cached);
    return cached;
  }
  const discard = () => {
    if (processCache.get(key) === result) processCache.delete(key);
  };
  const result = call<Result<ProcessResult>>({ op: "process", fluid, start, spec }).then(
    (value) => {
      if (!value.ok) discard();
      return value;
    },
    (error: unknown) => {
      discard();
      throw error;
    },
  );
  processCache.set(key, result);
  if (processCache.size > PROCESS_CACHE_LIMIT) processCache.delete(processCache.keys().next().value!);
  return result;
}

export const engine = {
  info: (fluid: string) => call<FluidInfo | null>({ op: "info", fluid }),
  state: (fluid: string, input: StateInput) => call<Result<{ state: ThermoState }>>({ op: "state", fluid, input }),
  saturation: (fluid: string) => call<Saturation>({ op: "saturation", fluid }),
  chart: (fluid: string, viewport: Viewport, isolines: { prop: Prop; values: number[] }[]) =>
    call<Result<ChartResult>>({ op: "chart", fluid, viewport, isolines }),
  chartAuto: (fluid: string, viewport: Viewport, families: Prop[], units: UnitChoice, density = 10, curveViewport?: Viewport) =>
    call<Result<ChartResult>>({ op: "chartAuto", fluid, viewport, curveViewport, families, units, density }),
  defaultView: (fluid: string, axes: AxesSpec) => call<Viewport>({ op: "defaultView", fluid, axes }),
  process,
  cycle: (fluid: string, cycle: string, params: Record<string, number>) =>
    call<Result<CycleResult>>({ op: "cycle", fluid, cycle, params }),
};

/**
 * Wraps an async function so that only the latest call's result is delivered; while a call is in
 * flight, further calls are coalesced into one trailing call. Used for hover probes and re-plots.
 */
export function latestOnly<A extends unknown[], R>(fn: (...args: A) => Promise<R>, onResult: (r: R) => void) {
  let running = false;
  let queued: A | null = null;
  const run = async (args: A) => {
    running = true;
    try {
      const r = await fn(...args);
      if (!queued) onResult(r);
    } catch {
      // Callers surface errors through their result types; swallow transport errors here.
    } finally {
      running = false;
      if (queued) {
        const next = queued;
        queued = null;
        void run(next);
      }
    }
  };
  return (...args: A) => {
    if (running) queued = args;
    else void run(args);
  };
}
