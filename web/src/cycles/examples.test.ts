import { describe, expect, it, vi } from "vitest";
import { CYCLES, defaultParams } from "./catalog";
import { editableSpec } from "./examples";
import { engine } from "../engine/client";
import { ProcessKind, Prop, type ProcessSpec, type StateInput, type ThermoState } from "../engine/types";
import { computeChains, computePointStates } from "../state/compute";
import { useStore } from "../state/store";
import { processSpecForEndpoints } from "../state/connections";
import { buildScene } from "../charts/scene";
import { analyzeEnergy } from "../state/energy";

// Keep the real store and middleware, with an in-memory persistence backend.
vi.mock("zustand/middleware", async (importOriginal) => {
  const actual = await importOriginal<typeof import("zustand/middleware")>();
  const storage = new Map();
  const persist: typeof actual.persist = (config, options) => actual.persist(config, {
    ...options,
    storage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => { storage.set(key, value); },
      removeItem: (key) => { storage.delete(key); },
    },
  });
  return { ...actual, persist };
});

// Exercise the same calculations as the worker with the committed browser WASM build.
vi.mock("../engine/client", async () => {
  const { default: createThermo } = await import("../engine/generated/thermo.mjs");
  const m = await createThermo();
  const { CYCLES } = await import("./catalog");
  const files = import.meta.glob<string>("../../public/fluids/*.json", { query: "?raw", import: "default" });
  for (const fluid of new Set(CYCLES.flatMap((cycle) => cycle.fluids))) {
    const loaded = m.loadFluid(await files[`../../public/fluids/${fluid}.json`]());
    if (!loaded.ok) throw new Error(loaded.error);
  }
  return { engine: {
    state: async (fluid: string, input: StateInput) => m.state(fluid, input.a, input.va, input.b, input.vb),
    process: async (fluid: string, input: StateInput, spec: ProcessSpec) => m.process(fluid, input, spec),
    cycle: async (fluid: string, id: string, params: Record<string, number>) => m.cycle(id, fluid, params),
  } };
});

const theme = { surface: "white", text: "black", textMuted: "gray", axis: "gray", font: "sans-serif",
  iso: {}, dome: "gray", domeFill: "gray", paths: ["red"], accent: "blue" };

function expectSameState(actual: ThermoState, expected: ThermoState) {
  for (const prop of ["T", "p", "rho", "h", "s"] as const) {
    expect(Math.abs(actual[prop] - expected[prop]), prop).toBeLessThanOrEqual(Math.max(1e-6, Math.abs(expected[prop]) * 1e-4));
  }
}

for (const def of CYCLES) {
  describe(def.name, () => {
    for (const fluid of def.fluids) {
      it(`imports every state and connection for ${fluid}`, async () => {
        useStore.setState({ points: [], chains: [], exampleSnapshot: null });
        const result = await engine.cycle(fluid, def.id, defaultParams(def, fluid));
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error(result.error);
        const states = new Map(result.states.map((state) => [state.id, state.state]));
        const connections = await Promise.all(result.segments.map(async (segment) => ({
          ...segment,
          path: Array.from(segment.path),
          spec: await editableSpec(segment, states.get(segment.from), states.get(segment.to), fluid),
        })));
        useStore.getState().loadExampleSnapshot(def.id, def.name, result.states.map(({ id, state }) => ({
          id, label: id, input: { a: Prop.P, va: state.p, b: Prop.H, vb: state.h },
        })), connections);
        const imported = useStore.getState();
        const points = await computePointStates(fluid, imported.points, imported.chains);
        expect(points).toHaveLength(result.states.length);
        for (const point of points) {
          expect(point.error, point.point.label).toBeUndefined();
          expect(point.state, point.point.label).not.toBeNull();
          expectSameState(point.state!, states.get(point.point.label)!);
        }
        // Move each independent point and immediately recompute the entire graph.
        // No mounted panel or React effect is needed to repair its targets.
        for (const point of imported.points.filter((point) => !point.derivedFromStepId)) {
          useStore.setState({ points: imported.points, chains: imported.chains });
          const input = { ...point.input, va: point.input.va * 1.0001, vb: point.input.vb + Math.max(1, Math.abs(point.input.vb) * 0.0001) };
          const moved = await engine.state(fluid, input);
          expect(moved.ok, `move ${point.label}`).toBe(true);
          if (!moved.ok) throw new Error(moved.error);
          useStore.getState().updatePoint(point.id, { input }, moved.state, new Map(points.map(({ point, state }) => [point.id, state!])));
          const graph = useStore.getState();
          const movedPoints = await computePointStates(fluid, graph.points, graph.chains);
          const movedChains = await computeChains(fluid, graph.chains, movedPoints);
          for (const step of movedChains[0].steps) {
            const connection = graph.chains[0].steps.find((candidate) => candidate.id === step.id)!;
            const labels = new Map(graph.points.map((point) => [point.id, point.label]));
            const context = `moving ${point.label}, ${labels.get(connection.fromPointId!)} → ${labels.get(connection.toPointId!)} (${step.spec.kind})`;
            expect(step.error, context).toBeUndefined();
            expect(step.result, context).not.toBeNull();
          }
          const movedScene = buildScene({
            theme, units: imported.units, info: null, saturation: null, isolines: null,
            points: movedPoints, chains: movedChains, cycle: null, exampleSnapshot: imported.exampleSnapshot,
            showOverlays: { points: true, chains: true, cycle: false },
          });
          expect(movedScene.markers).toHaveLength(result.states.length);
          expect(movedScene.lines, `moving ${point.label}`).toHaveLength(result.segments.length);
        }
        useStore.setState({ points: imported.points, chains: imported.chains });
        // Check both the initial import and the endpoint retargeting performed by ChainEditor.
        for (const sync of [false, true]) {
          const chains = sync ? imported.chains.map((chain) => ({
            ...chain,
            steps: chain.steps.map((step) => {
              const to = imported.points.find((point) => point.id === step.toPointId)!;
              const fitted = processSpecForEndpoints(step.spec.kind, to.input);
              return { ...step, spec: { ...fitted, ...(step.spec.efficiency !== undefined ? { efficiency: step.spec.efficiency } : {}) } };
            }),
          })) : imported.chains;
          const computed = await computeChains(fluid, chains, points);
          expect(computed[0].steps).toHaveLength(result.segments.length);
          for (const [i, step] of computed[0].steps.entries()) {
            const segment = result.segments[i];
            const context = `${segment.from} → ${segment.to} ${segment.component}${sync ? " after editor sync" : ""}`;
            expect(step.error, context).toBeUndefined();
            expect(step.result, context).not.toBeNull();
            expectSameState(step.result!.start, states.get(segment.from)!);
            expectSameState(step.result!.end, states.get(segment.to)!);
            expect(step.result!.path.length, context).toBeGreaterThanOrEqual(12);
            expect(Array.from(step.result!.path).filter((_, index) => index % 6 !== 5).every(Number.isFinite), context).toBe(true);
          }
          const scene = buildScene({
            theme,
            units: imported.units, info: null, saturation: null, isolines: null,
            points, chains: computed, cycle: null, exampleSnapshot: imported.exampleSnapshot,
            showOverlays: { points: true, chains: true, cycle: false },
          });
          expect(scene.markers).toHaveLength(result.states.length);
          expect(scene.lines).toHaveLength(result.segments.length);
        }
      });
    }
  });
}

// A move must preserve the whole editable graph, including properties shared
// through several connections and targets belonging to derived outlets.
it("propagates a moved pressure through a cycle and retargets its compressor", async () => {
  const input = (p: number, h: number): StateInput => ({ a: Prop.P, va: p, b: Prop.H, vb: h });
  useStore.setState({
    points: [
      { id: "a", label: "a", input: input(1e5, 3e5) },
      { id: "b", label: "b", input: input(5e5, 0), derivedFromStepId: "compressor" },
      { id: "c", label: "c", input: input(5e5, 2e5) },
      { id: "d", label: "d", input: input(5e5, 1e5) },
      { id: "e", label: "e", input: input(5e5, 1.5e5) },
    ],
    chains: [{ id: "cycle", start: input(1e5, 3e5), steps: [
      { id: "compressor", fromPointId: "a", toPointId: "b", spec: { kind: ProcessKind.Compression, target: Prop.P, value: 5e5, efficiency: 0.73 } },
      { id: "bc", fromPointId: "b", toPointId: "c", spec: { kind: ProcessKind.Isobaric, target: Prop.H, value: 2e5 } },
      { id: "cd", fromPointId: "c", toPointId: "d", spec: { kind: ProcessKind.Isobaric, target: Prop.H, value: 1e5 } },
      { id: "de", fromPointId: "d", toPointId: "e", spec: { kind: ProcessKind.Isobaric, target: Prop.H, value: 1.5e5 } },
      { id: "eb", fromPointId: "e", toPointId: "b", spec: { kind: ProcessKind.Isobaric, target: Prop.H, value: 0 } },
    ] }],
    exampleSnapshot: null,
  });
  useStore.getState().updatePoint("d", { input: input(6e5, 1.1e5) });
  const { points, chains } = useStore.getState();
  expect(points.map((point) => point.input.va)).toEqual([1e5, 6e5, 6e5, 6e5, 6e5]);
  expect(chains[0].steps[0].spec).toEqual({ kind: ProcessKind.Compression, target: Prop.P, value: 6e5, efficiency: 0.73 });
});

it("recalculates paths from current endpoints without waiting for the connection panel", async () => {
  const input = (p: number, h: number): StateInput => ({ a: Prop.P, va: p, b: Prop.H, vb: h });
  const points = [
    { id: "a", label: "a", input: input(1e5, 3e5) },
    { id: "b", label: "b", input: input(1e5, 3.1e5) },
  ];
  const computed = await computeChains("Nitrogen", [{ id: "chain", start: points[0].input, steps: [{
    id: "ab", fromPointId: "a", toPointId: "b",
    spec: { kind: ProcessKind.Isobaric, target: Prop.H, value: 2e5 },
  }] }], await computePointStates("Nitrogen", points));
  expect(computed[0].steps[0].error).toBeUndefined();
  expect(computed[0].steps[0].result?.end.h).toBeCloseTo(3.1e5, 3);
});

// Compare editable-loop energy against the independently implemented C++ cycle
// solvers, including both sides of recuperators and irreversible throttling.
it.each([
  ["vapor_compression", "R134a"], ["transcritical", "CarbonDioxide"],
  ["reverse_brayton", "Helium"], ["brayton", "Air"],
  ["brayton", "CarbonDioxide"], ["rankine", "Water"],
])("matches the %s energy and performance metrics for %s", async (id, fluid) => {
  const def = CYCLES.find((cycle) => cycle.id === id)!;
  const result = await engine.cycle(fluid, id, defaultParams(def, fluid));
  if (!result.ok) throw new Error(result.error);
  useStore.setState({ points: [], chains: [], exampleSnapshot: null });
  const states = new Map(result.states.map(({ id, state }) => [id, state]));
  const connections = await Promise.all(result.segments.map(async (segment) => ({
    ...segment, path: Array.from(segment.path),
    spec: await editableSpec(segment, states.get(segment.from), states.get(segment.to), fluid),
  })));
  useStore.getState().loadExampleSnapshot(id, def.name, result.states.map(({ id, state }) => ({
    id, label: id, input: { a: Prop.P, va: state.p, b: Prop.H, vb: state.h },
  })), connections);
  const graph = useStore.getState();
  const points = await computePointStates(fluid, graph.points, graph.chains);
  const computed = await computeChains(fluid, graph.chains, points);
  const loops = analyzeEnergy(graph.chains, computed, graph.exampleSnapshot);
  expect(loops).toHaveLength(1);
  expect(loops[0].status).toBe("closed");
  const totals = loops[0].totals!;
  expect(totals.balanced).toBe(true);
  expect(Math.abs(totals.residual)).toBeLessThan(1);
  const metrics = new Map(result.metrics.map((metric) => [metric.key, metric.value]));
  const close = (actual: number | null, key: string) => {
    const expected = metrics.get(key)!;
    expect(actual, key).not.toBeNull();
    expect(Math.abs(actual! - expected), key).toBeLessThan(Math.max(1e-5, Math.abs(expected) * 1e-5));
  };
  if (id === "vapor_compression" || id === "transcritical") {
    close(totals.workIn, "w_comp"); close(totals.heatIn, "q_evap"); close(totals.heatOut, "q_cond");
    close(totals.coolingCOP, "cop_cooling"); close(totals.heatingCOP, "cop_heating");
  } else if (id === "reverse_brayton") {
    close(-totals.netWork, "w_net"); close(totals.heatIn, "q_load"); close(totals.coolingCOP, "cop");
  } else {
    close(totals.netWork, "w_net"); close(totals.heatIn, "q_in"); close(totals.efficiency, "eta_th");
  }
});

it("hydrates older saved units without losing custom choices or energy defaults", () => {
  const current = useStore.getInitialState();
  const merge = useStore.persist.getOptions().merge!;
  const legacy = merge({ unitSystem: "us", units: { specific_energy: "kWh/kg" } }, current);
  expect(legacy.units).toMatchObject({ mass_flow: "lb/h", power: "Btu/h", specific_energy: "kWh/kg" });
  expect(legacy.energyMassFlow).toBeNull();
  expect(merge(undefined, current).units).toEqual(current.units);
  const saved = merge({ energyMassFlow: 0.25, units: { power: "MW" } }, current);
  expect(saved.energyMassFlow).toBe(0.25);
  expect(saved.units.power).toBe("MW");
});
