import { create } from "zustand";
import { persist } from "zustand/middleware";
import { CHARTS, type ChartId } from "../charts/charts";
import { cycleById, CYCLES } from "../cycles/catalog";
import { ProcessKind, Prop, type ProcessSpec, type StateInput, type Viewport } from "../engine/types";
import { inputValue, setInputValue, sharedPropertyForProcess } from "./connections";
import { UNIT_SYSTEMS, type Quantity, type UnitChoice } from "../units/units";

export type Mode = "explore" | "process" | "cycle";
export type ThemePref = "system" | "light" | "dark";

export interface PinnedPoint {
  id: string;
  label: string;
  input: StateInput;
}

export interface ProcessStep {
  id: string;
  spec: ProcessSpec;
  fromPointId?: string;
  toPointId?: string;
}

export interface ProcessEndpoints {
  fromPointId?: string;
  toPointId?: string;
}

export interface ProcessChain {
  id: string;
  start: StateInput;
  steps: ProcessStep[];
}

export interface SnapshotConnection {
  id: string;
  fromPointId: string;
  toPointId: string;
  component: string;
  kind: string;
  path: (number | null)[];
}

export interface ExampleSnapshot {
  id: string;
  cycleId: string;
  name: string;
  pointIds: Record<string, string>;
  connections: SnapshotConnection[];
}

export interface ExampleSnapshotInput {
  id: string;
  label: string;
  input: StateInput;
}

export interface ExampleSnapshotConnectionInput {
  from: string;
  to: string;
  component: string;
  kind: string;
  path: (number | null)[];
  spec: ProcessSpec;
}

interface AppState {
  fluid: string;
  chartId: ChartId;
  mode: Mode;
  theme: ThemePref;
  unitSystem: string;
  units: UnitChoice;
  families: Record<ChartId, Prop[]>;
  /** Viewport per chart; cleared when the fluid changes. */
  views: Partial<Record<ChartId, Viewport>>;
  points: PinnedPoint[];
  selectedPointId: string | null;
  chains: ProcessChain[];
  exampleSnapshot: ExampleSnapshot | null;
  cycleId: string;

  setFluid: (fluid: string) => void;
  setChart: (id: ChartId) => void;
  setMode: (mode: Mode) => void;
  setUnitSystem: (id: string) => void;
  setUnit: (q: Quantity, unit: string) => void;
  toggleFamily: (chart: ChartId, family: Prop) => void;
  setView: (chart: ChartId, vp: Viewport | undefined) => void;
  addPoint: (input: StateInput, label?: string) => string;
  setSelectedPoint: (id: string | null) => void;
  updatePoint: (id: string, patch: Partial<PinnedPoint>) => void;
  removePoint: (id: string) => void;
  clearPoints: () => void;
  loadExampleSnapshot: (cycleId: string, name: string, states: ExampleSnapshotInput[], connections: ExampleSnapshotConnectionInput[]) => void;
  removeExampleConnection: (id: string) => void;
  addChain: (start: StateInput, firstStep?: ProcessSpec, endpoints?: ProcessEndpoints) => void;
  updateChain: (id: string, patch: Partial<ProcessChain>) => void;
  removeChain: (id: string) => void;
  addStep: (chainId: string, spec: ProcessSpec, endpoints?: ProcessEndpoints) => void;
  updateStep: (chainId: string, stepId: string, patch: Partial<ProcessStep>) => void;
  removeStep: (chainId: string, stepId: string) => void;
  setCycle: (id: string) => void;
}

const uid = () => Math.random().toString(36).slice(2, 9);
const defaultFamilies = Object.fromEntries(CHARTS.map((c): [ChartId, Prop[]] => [c.id, []])) as Record<ChartId, Prop[]>;
const nextLabel = (used: string[]) => {
  for (let i = 1; ; i++) if (!used.includes(String(i))) return String(i);
};

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      fluid: "Nitrogen",
      chartId: "Ts",
      mode: "explore",
      theme: "system",
      unitSystem: "cryo",
      units: UNIT_SYSTEMS[0].units,
      families: defaultFamilies,
      views: {},
      points: [],
      selectedPointId: null,
      chains: [],
      exampleSnapshot: null,
      cycleId: CYCLES[0].id,

      setFluid: (fluid) => {
        if (fluid === get().fluid) return;
        set({
          fluid,
          views: {},
          points: [],
          selectedPointId: null,
          chains: [],
          exampleSnapshot: null,
        });
      },
      setChart: (chartId) => set({ chartId }),
      setMode: (mode) => set({ mode }),
      setUnitSystem: (id) => {
        const sys = UNIT_SYSTEMS.find((s) => s.id === id);
        if (sys) set({ unitSystem: id, units: { ...sys.units } });
      },
      setUnit: (q, unit) => set((s) => ({ units: { ...s.units, [q]: unit }, unitSystem: "custom" })),
      toggleFamily: (chart, family) =>
        set((s) => {
          const cur = s.families[chart] ?? [];
          const next = cur.includes(family) ? cur.filter((f) => f !== family) : [...cur, family];
          return { families: { ...s.families, [chart]: next } };
        }),
      setView: (chart, vp) =>
        set((s) => {
          const views = { ...s.views };
          if (vp) views[chart] = vp;
          else delete views[chart];
          return { views };
        }),
      addPoint: (input, label) => {
        const id = uid();
        set((s) => ({ points: [...s.points, { id, label: label ?? nextLabel(s.points.map((p) => p.label)), input }] }));
        return id;
      },
      setSelectedPoint: (id) => set({ selectedPointId: id }),
      updatePoint: (id, patch) => set((s) => {
        const previous = s.points.find((point) => point.id === id);
        if (!previous) return {};
        let nextInput = patch.input ?? previous.input;
        if (patch.input) {
          const lockedProps = [...new Set(s.chains.flatMap((chain) => chain.steps.flatMap((step) => {
            if (step.fromPointId !== id && step.toPointId !== id) return [];
            const prop = sharedPropertyForProcess(step.spec.kind);
            return prop !== null && inputValue(previous.input, prop) !== undefined ? [prop] : [];
          })))].slice(0, 2);
          if (lockedProps.length >= 2 && lockedProps.some((prop) => inputValue(nextInput, prop) === undefined)) {
            nextInput = {
              a: lockedProps[0], va: inputValue(previous.input, lockedProps[0])!,
              b: lockedProps[1], vb: inputValue(previous.input, lockedProps[1])!,
            };
          } else if (lockedProps.length === 1) {
            const prop = lockedProps[0];
            if (inputValue(nextInput, prop) === undefined) {
              const otherProp = nextInput.a === prop ? nextInput.b : nextInput.a;
              const otherValue = inputValue(nextInput, otherProp)!;
              nextInput = { a: prop, va: inputValue(previous.input, prop)!, b: otherProp, vb: otherValue };
            }
          }
        }
        let points = s.points.map((point) => point.id === id ? { ...point, ...patch, input: nextInput } : point);
        for (const chain of s.chains) {
          for (const step of chain.steps) {
            const prop = sharedPropertyForProcess(step.spec.kind);
            if (prop === null || step.fromPointId !== id && step.toPointId !== id) continue;
            const updated = points.find((point) => point.id === id);
            const peerId = step.fromPointId === id ? step.toPointId : step.fromPointId;
            const peer = points.find((point) => point.id === peerId);
            const value = updated ? inputValue(updated.input, prop) : undefined;
            if (!peer || value === undefined || inputValue(peer.input, prop) === undefined) continue;
            points = points.map((point) => point.id === peerId
              ? { ...point, input: setInputValue(point.input, prop, value) }
              : point);
          }
        }
        return { points };
      }),
      removePoint: (id) => set((s) => {
        const snapshot = s.exampleSnapshot;
        const pointIds = Object.fromEntries(Object.entries(snapshot?.pointIds ?? {}).filter(([, pointId]) => pointId !== id));
        const snapshotPointIds = new Set(Object.values(snapshot?.pointIds ?? {}));
        const removedSnapshotPoint = snapshotPointIds.has(id);
        const exampleSnapshot = snapshot && removedSnapshotPoint
          ? { ...snapshot, pointIds, connections: snapshot.connections.filter((connection) => connection.fromPointId !== id && connection.toPointId !== id) }
          : snapshot;
        return {
          points: s.points.filter((p) => p.id !== id),
          selectedPointId: s.selectedPointId === id ? null : s.selectedPointId,
          exampleSnapshot: snapshot && removedSnapshotPoint && !Object.keys(pointIds).length ? null : exampleSnapshot,
          chains: s.chains.map((chain) => ({
            ...chain,
            steps: chain.steps.filter((step) => step.fromPointId !== id && step.toPointId !== id),
          })),
        };
      }),
      clearPoints: () => set({
        points: [],
        selectedPointId: null,
        exampleSnapshot: null,
        chains: [],
      }),
      loadExampleSnapshot: (cycleId, name, states, connectionInputs) => set((s) => {
        const previousIds = new Set(Object.values(s.exampleSnapshot?.pointIds ?? {}));
        const points = s.points.filter((point) => !previousIds.has(point.id));
        const usedLabels = new Set(points.map((point) => point.label));
        const pointIds: Record<string, string> = {};
        const importedPoints = states.map(({ id: stateId, label: requestedLabel, input }) => {
          const pointId = uid();
          const label = usedLabels.has(requestedLabel) ? nextLabel([...usedLabels]) : requestedLabel;
          usedLabels.add(label);
          pointIds[stateId] = pointId;
          return { id: pointId, label, input };
        });
        const connections = connectionInputs.flatMap((connection) => {
          const fromPointId = pointIds[connection.from];
          const toPointId = pointIds[connection.to];
          return fromPointId && toPointId ? [{ ...connection, id: uid(), fromPointId, toPointId }] : [];
        });
        const steps = connections.map((connection) => ({
          id: connection.id,
          spec: connection.spec,
          fromPointId: connection.fromPointId,
          toPointId: connection.toPointId,
        }));
        return {
          mode: "explore",
          points: [...points, ...importedPoints],
          selectedPointId: null,
          chains: [{
            id: uid(),
            start: importedPoints[0]?.input ?? { a: Prop.P, va: 1e5, b: Prop.H, vb: 3e5 },
            steps,
          }],
          exampleSnapshot: { id: uid(), cycleId, name, pointIds, connections },
        };
      }),
      removeExampleConnection: (id) => set((s) => s.exampleSnapshot
        ? { exampleSnapshot: { ...s.exampleSnapshot, connections: s.exampleSnapshot.connections.filter((connection) => connection.id !== id) } }
        : {}),
      addChain: (start, firstStep, endpoints) => {
        const current = get().chains[0];
        if (current) {
          if (!firstStep) return;
          const stepId = uid();
          set((s) => ({
            chains: s.chains[0]
              ? [{ ...s.chains[0], steps: [...s.chains[0].steps, { id: stepId, spec: firstStep, ...endpoints }] }]
              : [],
          }));
          return;
        }
        const id = uid();
        const stepId = firstStep ? uid() : undefined;
        set({
          chains: [{ id, start, steps: firstStep && stepId ? [{ id: stepId, spec: firstStep, ...endpoints }] : [] }],
        });
      },
      updateChain: (id, patch) => set((s) => ({ chains: s.chains.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
      removeChain: (id) => set((s) => ({ chains: s.chains.filter((c) => c.id !== id) })),
      addStep: (chainId, spec, endpoints) =>
        set((s) => ({
          chains: s.chains.map((c) => (c.id === chainId ? { ...c, steps: [...c.steps, { id: uid(), spec, ...endpoints }] } : c)),
        })),
      updateStep: (chainId, stepId, patch) =>
        set((s) => ({
          chains: s.chains.map((c) =>
            c.id === chainId ? { ...c, steps: c.steps.map((st) => {
              if (st.id !== stepId) return st;
              return { ...st, ...patch };
            }) } : c,
          ),
        })),
      removeStep: (chainId, stepId) =>
        set((s) => ({
          chains: s.chains.map((c) => (c.id === chainId ? { ...c, steps: c.steps.filter((st) => st.id !== stepId) } : c)),
          exampleSnapshot: s.exampleSnapshot ? {
            ...s.exampleSnapshot,
            connections: s.exampleSnapshot.connections.filter((connection) => connection.id !== stepId),
          } : null,
        })),
      setCycle: (id) => {
        const def = cycleById(id);
        if (!def) return;
        const current = get();
        const previousFluid = current.fluid;
        const fluid = def.fluids.includes(previousFluid) ? previousFluid : def.fluids[0];
        set({
          cycleId: id,
          fluid,
          views: fluid === previousFluid ? get().views : {},
          ...(fluid === previousFluid ? {} : { points: [], selectedPointId: null, chains: [], exampleSnapshot: null }),
        });
      },
    }),
    {
      name: "thermoplot",
      version: 10,
      migrate: (persisted) => {
        type LegacyStep = Omit<ProcessStep, "generatedEndpoint" | "endpointLabel"> & { generatedEndpoint?: boolean; endpointLabel?: string };
        type LegacyChain = Omit<ProcessChain, "steps"> & { steps: LegacyStep[] };
        type LegacyState = Omit<AppState, "chains"> & { cycleParams?: Record<string, number>; chains?: LegacyChain[] };
        const old = { ...(persisted as LegacyState) };
        delete old.cycleParams;
        const families = Object.fromEntries(CHARTS.map((chart) => [
          chart.id,
          (old.families?.[chart.id] ?? []).filter((family) => family !== Prop.Q),
        ])) as Record<ChartId, Prop[]>;
        const pointIds = new Set((old.points ?? []).map((point) => point.id));
        const chains = (old.chains ?? []).slice(0, 1).map((chain) => ({
          ...chain,
          steps: chain.steps.flatMap((step) => {
            if (step.generatedEndpoint || !step.fromPointId || !step.toPointId
              || !pointIds.has(step.fromPointId) || !pointIds.has(step.toPointId)) return [];
            const { generatedEndpoint: _generatedEndpoint, endpointLabel: _endpointLabel, ...directStep } = step;
            return [directStep];
          }),
        }));
        const snapshotSteps = (old.exampleSnapshot?.connections ?? []).flatMap((connection) => {
          const from = old.points?.find((point) => point.id === connection.fromPointId);
          const to = old.points?.find((point) => point.id === connection.toPointId);
          if (!from || !to) return [];
          const kind = connection.kind.toLowerCase();
          const destinationValue = (prop: Prop) => {
            if (to.input.a === prop) return to.input.va;
            if (to.input.b === prop) return to.input.vb;
            return prop === Prop.P ? 1e5 : 3e5;
          };
          let spec: ProcessSpec;
          if (kind === "compressor" || kind === "pump") {
            spec = { kind: ProcessKind.Compression, target: Prop.P, value: destinationValue(Prop.P), efficiency: 0.8 };
          } else if (kind === "expander" || kind === "turbine") {
            spec = { kind: ProcessKind.Expansion, target: Prop.P, value: destinationValue(Prop.P), efficiency: 0.85 };
          } else if (kind === "valve") {
            spec = { kind: ProcessKind.Isenthalpic, target: Prop.P, value: destinationValue(Prop.P) };
          } else {
            spec = { kind: ProcessKind.Isobaric, target: Prop.H, value: destinationValue(Prop.H) };
          }
          return [{
            id: connection.id,
            spec,
            fromPointId: connection.fromPointId,
            toPointId: connection.toPointId,
          }];
        });
        if (snapshotSteps.length) {
          const chain = chains[0] ?? { id: uid(), start: old.points?.[0]?.input ?? { a: Prop.P, va: 1e5, b: Prop.H, vb: 3e5 }, steps: [] };
          const stepIds = new Set(chain.steps.map((step) => step.id));
          chains.splice(0, chains.length, { ...chain, steps: [...chain.steps, ...snapshotSteps.filter((step) => !stepIds.has(step.id))] });
        }
        return { ...old, theme: "system", families, chains };
      },
      partialize: (s) => ({
        fluid: s.fluid,
        chartId: s.chartId,
        mode: s.mode,
        unitSystem: s.unitSystem,
        units: s.units,
        families: s.families,
        points: s.points,
        chains: s.chains,
        exampleSnapshot: s.exampleSnapshot,
        cycleId: s.cycleId,
      }),
    },
  ),
);

export const DEFAULT_STEP: ProcessSpec = { kind: ProcessKind.Compression, target: Prop.P, value: 10e5, efficiency: 0.8 };
