import { create } from "zustand";
import { persist } from "zustand/middleware";
import { CHARTS, type ChartId } from "../charts/charts";
import { cycleById, CYCLES, defaultParams } from "../cycles/catalog";
import { ProcessKind, Prop, type ProcessSpec, type StateInput, type Viewport } from "../engine/types";
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
}

export interface ProcessChain {
  id: string;
  name: string;
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
}

interface AppState {
  fluid: string;
  chartId: ChartId;
  mode: Mode;
  theme: ThemePref;
  unitSystem: string;
  units: UnitChoice;
  families: Record<ChartId, Prop[]>;
  density: number;
  /** Viewport per chart; cleared when the fluid changes. */
  views: Partial<Record<ChartId, Viewport>>;
  points: PinnedPoint[];
  selectedPointId: string | null;
  chains: ProcessChain[];
  exampleSnapshot: ExampleSnapshot | null;
  cycleId: string;
  cycleParams: Record<string, number>;

  setFluid: (fluid: string) => void;
  setChart: (id: ChartId) => void;
  setMode: (mode: Mode) => void;
  setUnitSystem: (id: string) => void;
  setUnit: (q: Quantity, unit: string) => void;
  toggleFamily: (chart: ChartId, family: Prop) => void;
  setDensity: (d: number) => void;
  setView: (chart: ChartId, vp: Viewport | undefined) => void;
  addPoint: (input: StateInput, label?: string) => string;
  setSelectedPoint: (id: string | null) => void;
  updatePoint: (id: string, patch: Partial<PinnedPoint>) => void;
  removePoint: (id: string) => void;
  clearPoints: () => void;
  loadExampleSnapshot: (cycleId: string, name: string, states: ExampleSnapshotInput[], connections: ExampleSnapshotConnectionInput[]) => void;
  removeExampleConnection: (id: string) => void;
  addChain: (start: StateInput, firstStep?: ProcessSpec) => string;
  updateChain: (id: string, patch: Partial<ProcessChain>) => void;
  removeChain: (id: string) => void;
  addStep: (chainId: string, spec: ProcessSpec) => void;
  updateStep: (chainId: string, stepId: string, spec: ProcessSpec) => void;
  removeStep: (chainId: string, stepId: string) => void;
  setCycle: (id: string) => void;
  setCycleParam: (key: string, value: number) => void;
  resetCycleParams: () => void;
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
      density: 10,
      views: {},
      points: [],
      selectedPointId: null,
      chains: [],
      exampleSnapshot: null,
      cycleId: CYCLES[0].id,
      cycleParams: defaultParams(CYCLES[0], CYCLES[0].fluids[0]),

      setFluid: (fluid) => {
        if (fluid === get().fluid) return;
        const def = cycleById(get().cycleId);
        set({
          fluid,
          views: {},
          points: [],
          selectedPointId: null,
          chains: [],
          exampleSnapshot: null,
          ...(def ? { cycleParams: defaultParams(def, fluid) } : {}),
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
      setDensity: (density) => set({ density }),
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
      updatePoint: (id, patch) => set((s) => ({ points: s.points.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
      removePoint: (id) => set((s) => {
        if (!s.exampleSnapshot) return { points: s.points.filter((p) => p.id !== id), selectedPointId: s.selectedPointId === id ? null : s.selectedPointId };
        const pointIds = Object.fromEntries(Object.entries(s.exampleSnapshot.pointIds).filter(([, pointId]) => pointId !== id));
        const snapshotPointIds = new Set(Object.values(s.exampleSnapshot.pointIds));
        const removedSnapshotPoint = snapshotPointIds.has(id);
        const exampleSnapshot = removedSnapshotPoint
          ? { ...s.exampleSnapshot, pointIds, connections: s.exampleSnapshot.connections.filter((connection) => connection.fromPointId !== id && connection.toPointId !== id) }
          : s.exampleSnapshot;
        return {
          points: s.points.filter((p) => p.id !== id),
          selectedPointId: s.selectedPointId === id ? null : s.selectedPointId,
          exampleSnapshot: Object.keys(pointIds).length ? exampleSnapshot : null,
        };
      }),
      clearPoints: () => set({ points: [], selectedPointId: null, exampleSnapshot: null }),
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
        return {
          mode: "explore",
          points: [...points, ...importedPoints],
          selectedPointId: null,
          exampleSnapshot: { id: uid(), cycleId, name, pointIds, connections },
        };
      }),
      removeExampleConnection: (id) => set((s) => s.exampleSnapshot
        ? { exampleSnapshot: { ...s.exampleSnapshot, connections: s.exampleSnapshot.connections.filter((connection) => connection.id !== id) } }
        : {}),
      addChain: (start, firstStep) => {
        const id = uid();
        set((s) => ({
          chains: [
            ...s.chains,
            {
              id,
              name: `Connection ${s.chains.length + 1}`,
              start,
              steps: firstStep ? [{ id: uid(), spec: firstStep }] : [],
            },
          ],
        }));
        return id;
      },
      updateChain: (id, patch) => set((s) => ({ chains: s.chains.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
      removeChain: (id) => set((s) => ({ chains: s.chains.filter((c) => c.id !== id) })),
      addStep: (chainId, spec) =>
        set((s) => ({
          chains: s.chains.map((c) => (c.id === chainId ? { ...c, steps: [...c.steps, { id: uid(), spec }] } : c)),
        })),
      updateStep: (chainId, stepId, spec) =>
        set((s) => ({
          chains: s.chains.map((c) =>
            c.id === chainId ? { ...c, steps: c.steps.map((st) => (st.id === stepId ? { ...st, spec } : st)) } : c,
          ),
        })),
      removeStep: (chainId, stepId) =>
        set((s) => ({
          chains: s.chains.map((c) => (c.id === chainId ? { ...c, steps: c.steps.filter((st) => st.id !== stepId) } : c)),
        })),
      setCycle: (id) => {
        const def = cycleById(id);
        if (!def) return;
        const current = get();
        const previousFluid = current.fluid;
        const fluid = def.fluids.includes(previousFluid) ? previousFluid : def.fluids[0];
        set({
          cycleId: id,
          cycleParams: id === current.cycleId ? current.cycleParams : defaultParams(def, fluid),
          fluid,
          views: fluid === previousFluid ? get().views : {},
          ...(fluid === previousFluid ? {} : { points: [], selectedPointId: null, chains: [], exampleSnapshot: null }),
        });
      },
      setCycleParam: (key, value) => set((s) => ({ cycleParams: { ...s.cycleParams, [key]: value } })),
      resetCycleParams: () => {
        const def = cycleById(get().cycleId);
        if (def) set({ cycleParams: defaultParams(def, get().fluid) });
      },
    }),
    {
      name: "thermoplot",
      version: 5,
      migrate: (persisted) => {
        const old = persisted as AppState;
        const families = Object.fromEntries(CHARTS.map((chart) => [
          chart.id,
          (old.families?.[chart.id] ?? []).filter((family) => family !== Prop.Q),
        ])) as Record<ChartId, Prop[]>;
        return { ...old, theme: "system", families };
      },
      partialize: (s) => ({
        fluid: s.fluid,
        chartId: s.chartId,
        mode: s.mode,
        unitSystem: s.unitSystem,
        units: s.units,
        families: s.families,
        density: s.density,
        points: s.points,
        chains: s.chains,
        exampleSnapshot: s.exampleSnapshot,
        cycleId: s.cycleId,
        cycleParams: s.cycleParams,
      }),
    },
  ),
);

export const DEFAULT_STEP: ProcessSpec = { kind: ProcessKind.Compression, target: Prop.P, value: 10e5, efficiency: 0.8 };
