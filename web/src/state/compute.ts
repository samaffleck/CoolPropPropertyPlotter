// React hooks that derive thermodynamic data from the store via the worker.
import { useEffect, useRef, useState } from "react";
import { engine } from "../engine/client";
import {
  Prop,
  type ChartResult,
  type CycleResult,
  type FluidInfo,
  type FluidSummary,
  type ProcessResult,
  type ProcessSpec,
  type Saturation,
  type StateInput,
  type ThermoState,
  type Viewport,
} from "../engine/types";
import type { UnitChoice } from "../units/units";
import type { PinnedPoint, ProcessChain } from "./store";

/** Runs `fn` whenever `deps` change and keeps the latest result; stale results are dropped. */
function useAsync<T>(fn: () => Promise<T> | null, deps: unknown[], delay = 0): { data: T | null; loading: boolean; error: string | null } {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: false, error: null });
  const seq = useRef(0);
  useEffect(() => {
    const id = ++seq.current;
    const start = () => {
      const p = fn();
      if (!p) {
        setState({ data: null, loading: false, error: null });
        return;
      }
      setState((s) => ({ ...s, loading: true }));
      p.then(
        (data) => id === seq.current && setState({ data, loading: false, error: null }),
        (e: Error) => id === seq.current && setState((s) => ({ ...s, loading: false, error: e.message })),
      );
    };
    if (delay > 0) {
      const t = setTimeout(start, delay);
      return () => clearTimeout(t);
    }
    start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

let catalogPromise: Promise<FluidSummary[]> | null = null;
export function useCatalog(): FluidSummary[] {
  const [list, setList] = useState<FluidSummary[]>([]);
  useEffect(() => {
    catalogPromise ??= fetch(`${import.meta.env.BASE_URL}fluids.json`).then((r) => r.json());
    void catalogPromise.then((l) => setList([...l].sort((a, b) => a.name.localeCompare(b.name))));
  }, []);
  return list;
}

export const useFluidInfo = (fluid: string) => useAsync<FluidInfo | null>(() => engine.info(fluid), [fluid]);
export const useSaturation = (fluid: string) => useAsync<Saturation>(() => engine.saturation(fluid), [fluid]);

const ISOLINE_OVERSCAN = 0.35;

function withIsolineOverscan(view: Viewport): Viewport {
  const fraction = ISOLINE_OVERSCAN;
  const expand = (min: number, max: number, log: boolean): [number, number] => {
    if (log) {
      const lo = Math.log(min), span = Math.log(max) - lo;
      return [Math.exp(lo - span * fraction), Math.exp(lo + span * (1 + fraction))];
    }
    const span = max - min;
    return [min - span * fraction, max + span * fraction];
  };
  const [xMin, xMax] = expand(view.xMin, view.xMax, view.xLog);
  const [yMin, yMax] = expand(view.yMin, view.yMax, view.yLog);
  return { ...view, xMin, xMax, yMin, yMax };
}

export function useIsolines(fluid: string, view: Viewport | undefined, families: Prop[], units: UnitChoice, density: number) {
  const selected = useRef<{ key: string; groups: { prop: Prop; values: number[] }[] } | null>(null);
  const selectionKey = `${fluid}:${view?.x}:${view?.y}:${view?.xLog}:${view?.yLog}:${families.join(",")}:${JSON.stringify(units)}:${density}`;
  return useAsync<ChartResult | null>(
    () => {
      if (!view) return null;
      const expanded = withIsolineOverscan(view);
      const cached = selected.current;
      if (cached?.key === selectionKey) {
        return engine.chart(fluid, expanded, cached.groups).then((r) => (r.ok ? r : Promise.reject(new Error(r.error))));
      }
      const expandedDensity = Math.round(density * (1 + 2 * ISOLINE_OVERSCAN));
      return engine.chartAuto(fluid, expanded, families, units, expandedDensity).then((r) => {
        if (!r.ok) return Promise.reject(new Error(r.error));
        const values = new Map<Prop, number[]>();
        for (const isoline of r.isolines) {
          const group = values.get(isoline.prop) ?? [];
          if (!group.includes(isoline.value)) group.push(isoline.value);
          values.set(isoline.prop, group);
        }
        selected.current = { key: selectionKey, groups: [...values].map(([prop, values]) => ({ prop, values })) };
        return r;
      });
    },
    [fluid, view && JSON.stringify(view), selectionKey],
    120,
  );
}

export interface PointResult {
  point: PinnedPoint;
  state: ThermoState | null;
  error?: string;
}

const pointStateCache = new Map<string, Promise<{ state: ThermoState | null; error?: string }>>();

export function computePointState(fluid: string, input: StateInput) {
  const key = `${fluid}:${input.a}:${input.va}:${input.b}:${input.vb}`;
  let result = pointStateCache.get(key);
  if (!result) {
    result = engine.state(fluid, input)
      .then((r) => r.ok ? { state: r.state } : { state: null, error: r.error })
      .catch((error: Error) => {
        pointStateCache.delete(key);
        throw error;
      });
    pointStateCache.set(key, result);
    if (pointStateCache.size > 128) pointStateCache.delete(pointStateCache.keys().next().value!);
  }
  return result;
}

export function usePointStates(fluid: string, points: PinnedPoint[]) {
  return useAsync<PointResult[]>(
    () => Promise.all(points.map(async (point) => {
      return { point, ...(await computePointState(fluid, point.input)) };
    })),
    [fluid, JSON.stringify(points)],
  );
}

export interface StepResult {
  id: string;
  spec: ProcessSpec;
  result: ProcessResult | null;
  error?: string;
}

export interface ChainResult {
  chain: ProcessChain;
  start: ThermoState | null;
  error?: string;
  steps: StepResult[];
}

export const continueFrom = (s: ThermoState): StateInput => ({ a: Prop.P, va: s.p, b: Prop.H, vb: s.h });

export function useChains(fluid: string, chains: ProcessChain[]) {
  return useAsync<ChainResult[]>(
    () =>
      Promise.all(
        chains.map(async (chain): Promise<ChainResult> => {
          const s0 = await engine.state(fluid, chain.start);
          if (!s0.ok) return { chain, start: null, error: s0.error, steps: [] };
          const steps: StepResult[] = [];
          let from: StateInput = continueFrom(s0.state);
          let broken = false;
          for (const st of chain.steps) {
            if (broken) {
              steps.push({ id: st.id, spec: st.spec, result: null, error: "Previous step failed" });
              continue;
            }
            const r = await engine.process(fluid, from, st.spec);
            if (r.ok) {
              steps.push({ id: st.id, spec: st.spec, result: r });
              from = continueFrom(r.end);
            } else {
              steps.push({ id: st.id, spec: st.spec, result: null, error: r.error });
              broken = true;
            }
          }
          return { chain, start: s0.state, steps };
        }),
      ),
    [fluid, JSON.stringify(chains)],
  );
}

export function useCycle(enabled: boolean, fluid: string, cycleId: string, params: Record<string, number>) {
  return useAsync<{ ok: true; result: CycleResult } | { ok: false; error: string }>(
    () =>
      enabled
        ? engine.cycle(fluid, cycleId, params).then((r) => (r.ok ? { ok: true as const, result: r } : { ok: false as const, error: r.error }))
        : null,
    [enabled, fluid, cycleId, JSON.stringify(params)],
    60,
  );
}
