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

export function useIsolines(fluid: string, view: Viewport | undefined, families: Prop[], units: UnitChoice, density: number) {
  return useAsync<ChartResult | null>(
    () =>
      view
        ? engine.chartAuto(fluid, view, families, units, density).then((r) => (r.ok ? r : Promise.reject(new Error(r.error))))
        : null,
    [fluid, view && JSON.stringify(view), families.join(","), JSON.stringify(units), density],
    120,
  );
}

export interface PointResult {
  point: PinnedPoint;
  state: ThermoState | null;
  error?: string;
}

export function usePointStates(fluid: string, points: PinnedPoint[]) {
  return useAsync<PointResult[]>(
    () =>
      Promise.all(
        points.map(async (point) => {
          const r = await engine.state(fluid, point.input);
          return r.ok ? { point, state: r.state } : { point, state: null, error: r.error };
        }),
      ),
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
