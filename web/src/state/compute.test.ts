import { beforeEach, expect, it, vi } from "vitest";
import { ProcessKind, Prop, type ProcessSpec, type StateInput, type ThermoState } from "../engine/types";
import type { PinnedPoint, ProcessChain } from "./store";

const engine = vi.hoisted(() => ({ state: vi.fn(), process: vi.fn() }));
vi.mock("../engine/client", () => ({ engine }));

const input: StateInput = { a: Prop.P, va: 1e5, b: Prop.H, vb: 3e5 };
const state = (p: number, h: number) => ({ T: 300, p, h, s: 2000, rho: 1 } as ThermoState);

beforeEach(() => {
  vi.resetModules();
  engine.state.mockReset().mockImplementation(async (_fluid: string, start: StateInput) => ({ ok: true, state: state(start.va, start.vb) }));
  engine.process.mockReset().mockImplementation(async (_fluid: string, start: StateInput, spec: ProcessSpec) => ({
    ok: true, start: state(start.va, start.vb), end: state(spec.value, start.vb + 1000), path: new Float64Array(), q: 0, w: -1000,
  }));
});

function graph(edges: [string, string][]) {
  const steps = edges.map(([fromPointId, toPointId], i) => ({
    id: `${fromPointId}-${toPointId}`, fromPointId, toPointId,
    spec: { kind: ProcessKind.Compression, target: Prop.P, value: (i + 2) * 1e5, efficiency: 0.8 },
  }));
  const points: PinnedPoint[] = [...new Set(edges.flat())].map((id) => {
    const step = steps.find((step) => step.toPointId === id);
    return {
      id, label: id,
      input: step ? { ...input, va: step.spec.value, vb: 0 } : { ...input },
      ...(step ? { derivedFromStepId: step.id } : {}),
    };
  });
  const chains: ProcessChain[] = [{ id: "chain", start: input, steps }];
  return { points, chains };
}

it.each([2, 3, 12])("resolves every endpoint in a chain of %i processes", async (length) => {
  const { computePointStates } = await import("./compute");
  const { points, chains } = graph(Array.from({ length }, (_, i) => [`p${i}`, `p${i + 1}`]));
  const result = await computePointStates("Nitrogen", points, chains);
  expect(result.map(({ point }) => point.id)).toEqual(points.map((point) => point.id));
  for (const [i, point] of result.entries()) {
    expect(point.error, point.point.id).toBeUndefined();
    expect(point.state?.h, point.point.id).toBe(input.vb + i * 1000);
  }
  expect(engine.process).toHaveBeenCalledTimes(length);
});

it("resolves dependencies regardless of point and connection order", async () => {
  const { computePointStates } = await import("./compute");
  const { points, chains } = graph([["a", "b"], ["b", "c"], ["c", "d"], ["d", "e"]]);
  const reordered = [points[3], points[1], points[4], points[0], points[2]];
  chains[0].steps.reverse();
  const result = await computePointStates("Nitrogen", reordered, chains);
  expect(result.map(({ point }) => point.id)).toEqual(["d", "b", "e", "a", "c"]);
  expect(result.map(({ state }) => state?.h)).toEqual([303000, 301000, 304000, 300000, 302000]);
  expect(engine.process).toHaveBeenCalledTimes(4);
});

it("resolves multiple branches sharing an upstream state", async () => {
  const { computePointStates } = await import("./compute");
  const { points, chains } = graph([["a", "b"], ["b", "c"], ["b", "d"], ["c", "e"], ["e", "f"]]);
  const result = await computePointStates("Nitrogen", points, chains);
  expect(result.map(({ state }) => state?.h)).toEqual([300000, 301000, 302000, 302000, 303000, 304000]);
  expect(result.every((point) => !point.error)).toBe(true);
  expect(engine.process).toHaveBeenCalledTimes(5);
});

it.each<{ edges: [string, string][] }>([
  { edges: [["a", "a"]] },
  { edges: [["a", "b"], ["b", "a"], ["b", "c"]] },
])("terminates circular dependencies and preserves unrelated states: $edges", async ({ edges }) => {
  const { computePointStates } = await import("./compute");
  const { points, chains } = graph(edges);
  points.push({ id: "independent", label: "independent", input });
  const result = await computePointStates("Nitrogen", points, chains);
  for (const point of result.slice(0, -1)) {
    expect(point.state).toBeNull();
    expect(point.error).toContain("depends on a state");
  }
  expect(result.at(-1)?.state?.h).toBe(input.vb);
  expect(engine.process).not.toHaveBeenCalled();
});

it("leaves failed branches unresolved while calculating healthy branches", async () => {
  const { computePointStates } = await import("./compute");
  const { points, chains } = graph([["a", "b"], ["b", "c"], ["a", "d"], ["d", "e"]]);
  const calculate = engine.process.getMockImplementation()!;
  engine.process.mockImplementation(async (fluid: string, start: StateInput, spec: ProcessSpec) =>
    spec.value === chains[0].steps[0].spec.value ? { ok: false, error: "Solver failed" } : calculate(fluid, start, spec));
  const result = await computePointStates("Nitrogen", points, chains);
  expect(result[1].error).toBe("Solver failed");
  expect(result[2].state).toBeNull();
  expect(result[2].error).toContain("depends on a state");
  expect(result[3].state?.h).toBe(301000);
  expect(result[4].state?.h).toBe(302000);
  expect(engine.process).toHaveBeenCalledTimes(3);
});

it("terminates when a dependency references a missing connection or inlet", async () => {
  const { computePointStates } = await import("./compute");
  const { points, chains } = graph([["a", "b"], ["b", "c"]]);
  points[1].derivedFromStepId = "missing-step";
  chains[0].steps[1].fromPointId = "missing-point";
  const result = await computePointStates("Nitrogen", points, chains);
  expect(result[0].state?.h).toBe(input.vb);
  for (const point of result.slice(1)) {
    expect(point.state).toBeNull();
    expect(point.error).toContain("depends on a state");
  }
  expect(engine.process).not.toHaveBeenCalled();
});
