import { describe, expect, it, vi } from "vitest";
import { CYCLES, defaultParams } from "./catalog";
import { editableSpec } from "./examples";
import { engine } from "../engine/client";
import { Prop, type ProcessSpec, type StateInput, type ThermoState } from "../engine/types";
import { computeChains, computePointStates } from "../state/compute";
import { useStore } from "../state/store";
import { processSpecForEndpoints } from "../state/connections";
import { buildScene } from "../charts/scene";

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
            theme: { surface: "white", text: "black", textMuted: "gray", axis: "gray", font: "sans-serif",
              iso: {}, dome: "gray", domeFill: "gray", paths: ["red"], accent: "blue" },
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
