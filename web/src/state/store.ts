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
  chains: ProcessChain[];
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
  updatePoint: (id: string, patch: Partial<PinnedPoint>) => void;
  removePoint: (id: string) => void;
  clearPoints: () => void;
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
const defaultFamilies = Object.fromEntries(CHARTS.map((c) => [c.id, c.families.includes(Prop.Q) ? [Prop.Q] : []])) as Record<
  ChartId,
  Prop[]
>;
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
      chains: [],
      cycleId: CYCLES[0].id,
      cycleParams: defaultParams(CYCLES[0], CYCLES[0].fluids[0]),

      setFluid: (fluid) => {
        if (fluid === get().fluid) return;
        const def = cycleById(get().cycleId);
        set({
          fluid,
          views: {},
          points: [],
          chains: [],
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
      updatePoint: (id, patch) => set((s) => ({ points: s.points.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
      removePoint: (id) => set((s) => ({ points: s.points.filter((p) => p.id !== id) })),
      clearPoints: () => set({ points: [] }),
      addChain: (start, firstStep) => {
        const id = uid();
        set((s) => ({
          chains: [
            ...s.chains,
            {
              id,
              name: `Process ${s.chains.length + 1}`,
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
        const fluid = def.fluids.includes(get().fluid) ? get().fluid : def.fluids[0];
        set({ cycleId: id, cycleParams: defaultParams(def, fluid), fluid, views: fluid === get().fluid ? get().views : {} });
      },
      setCycleParam: (key, value) => set((s) => ({ cycleParams: { ...s.cycleParams, [key]: value } })),
      resetCycleParams: () => {
        const def = cycleById(get().cycleId);
        if (def) set({ cycleParams: defaultParams(def, get().fluid) });
      },
    }),
    {
      name: "thermoplot",
      version: 3,
      migrate: (persisted) => ({ ...(persisted as AppState), theme: "system", families: defaultFamilies }),
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
        cycleId: s.cycleId,
        cycleParams: s.cycleParams,
      }),
    },
  ),
);

export const DEFAULT_STEP: ProcessSpec = { kind: ProcessKind.Compression, target: Prop.P, value: 10e5, efficiency: 0.8 };
