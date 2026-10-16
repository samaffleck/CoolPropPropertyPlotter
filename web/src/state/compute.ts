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
import { sharedPropertyForProcess } from "./connections";
import { stateValue } from "../units/properties";

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

export function useIsolines(fluid: string, view: Viewport | undefined, families: Prop[], units: UnitChoice) {
  const density = 10;
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
      return engine.chartAuto(fluid, view, families, units, density, expanded).then((r) => {
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

function inputFromState(state: ThermoState, basis: StateInput): StateInput {
  return { a: basis.a, va: stateValue(state, basis.a), b: basis.b, vb: stateValue(state, basis.b) };
}

export function usePointStates(fluid: string, points: PinnedPoint[], chains: ProcessChain[] = []) {
  return useAsync<PointResult[]>(
    async () => {
      const resolved = new Map<string, PointResult>();
      const independent = points.filter((point) => !point.derivedFromStepId);
      const base = await Promise.all(independent.map(async (point) => ({
        point,
        ...(await computePointState(fluid, point.input)),
      })));
      base.forEach((point) => resolved.set(point.point.id, point));

      const pending = points.filter((point) => point.derivedFromStepId);
      for (let pass = 0; pass < pending.length && pending.length; pass++) {
        let progress = false;
        for (let i = pending.length - 1; i >= 0; i--) {
          const point = pending[i];
          const step = chains.flatMap((chain) => chain.steps).find((candidate) => candidate.id === point.derivedFromStepId);
          const from = step?.fromPointId ? resolved.get(step.fromPointId) : undefined;
          if (!step || !from?.state) continue;
          try {
            const result = await engine.process(fluid, inputFromState(from.state, from.point.input), step.spec);
            resolved.set(point.id, {
              point,
              state: result.ok ? result.end : null,
              ...(!result.ok ? { error: result.error } : {}),
            });
          } catch (error) {
            resolved.set(point.id, { point, state: null, error: error instanceof Error ? error.message : "Could not calculate this process endpoint." });
          }
          pending.splice(i, 1);
          progress = true;
        }
        if (!progress) break;
      }
      pending.forEach((point) => resolved.set(point.id, {
        point,
        state: null,
        error: "This process endpoint depends on a state that could not be calculated.",
      }));
      return points.map((point) => resolved.get(point.id) ?? { point, state: null });
    },
    [fluid, JSON.stringify(points), JSON.stringify(chains)],
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

export function useChains(fluid: string, chains: ProcessChain[], points: PointResult[]) {
  return useAsync<ChainResult[]>(
    () =>
      Promise.all(
        chains.map(async (chain): Promise<ChainResult> => {
          const steps: StepResult[] = [];
          const pointById = new Map(points.map((point) => [point.point.id, point]));
          const firstFrom = chain.steps[0]?.fromPointId ? pointById.get(chain.steps[0].fromPointId) : undefined;
          for (const st of chain.steps) {
            const fromPoint = st.fromPointId ? pointById.get(st.fromPointId) : undefined;
            const toPoint = st.toPointId ? pointById.get(st.toPointId) : undefined;
            if (st.fromPointId === st.toPointId) {
              steps.push({ id: st.id, spec: st.spec, result: null, error: "Choose two different state points." });
              continue;
            }
            if (!fromPoint || !toPoint) {
              steps.push({ id: st.id, spec: st.spec, result: null, error: "The connection references a state point that no longer exists." });
              continue;
            }
            if (!fromPoint.state || !toPoint.state) {
              steps.push({ id: st.id, spec: st.spec, result: null, error: "One of the selected state points could not be calculated." });
              continue;
            }
            const held = sharedPropertyForProcess(st.spec.kind);
            if (held !== null) {
              const fromValue = stateValue(fromPoint.state, held);
              const toValue = stateValue(toPoint.state, held);
              if (Math.abs(fromValue - toValue) > Math.max(1e-6, Math.abs(fromValue) * 1e-8)) {
                steps.push({ id: st.id, spec: st.spec, result: null });
                continue;
              }
            }
            const r = await engine.process(fluid, inputFromState(fromPoint.state, fromPoint.point.input), st.spec);
            if (!r.ok) {
              steps.push({ id: st.id, spec: st.spec, result: null, error: r.error });
              continue;
            }
            const actual = r.end;
            const expected = toPoint.state;
            const matches = ([actualValue, expectedValue]: [number, number]) =>
              Number.isFinite(actualValue) && Number.isFinite(expectedValue)
              && Math.abs(actualValue - expectedValue) <= Math.max(1e-6, Math.abs(expectedValue) * 1e-4);
            const reachesTarget = [
              [actual.T, expected.T], [actual.p, expected.p], [actual.rho, expected.rho],
              [actual.h, expected.h], [actual.s, expected.s],
            ].every((values) => matches(values as [number, number]));
            if (!reachesTarget) {
              steps.push({ id: st.id, spec: st.spec, result: null, error: "The selected end point does not match this process." });
              continue;
            }
            steps.push({ id: st.id, spec: st.spec, result: r });
          }
          return { chain, start: firstFrom?.state ?? null, steps };
        }),
      ),
    [fluid, JSON.stringify(chains), JSON.stringify(points)],
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
