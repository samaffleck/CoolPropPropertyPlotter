import { describe, expect, it } from "vitest";
import { ProcessKind, Prop, type ThermoState } from "../engine/types";
import type { ChainResult } from "./compute";
import { analyzeEnergy } from "./energy";
import type { ExampleSnapshot, ProcessChain } from "./store";

// Independent energy balances in J/kg; each edge satisfies q − w = Δh.
function network(edges: [string, string, number, number][], enthalpyOffset = 0) {
  const chain: ProcessChain = {
    id: "chain", start: { a: Prop.P, va: 1e5, b: Prop.H, vb: 3e5 },
    steps: edges.map(([from, to], index) => ({
      id: `edge-${index}`, fromPointId: from, toPointId: to,
      spec: { kind: ProcessKind.Isobaric, target: Prop.H, value: 1e5 },
    })),
  };
  const result: ChainResult = {
    chain, start: null,
    steps: edges.map(([, , q, w], index) => ({
      id: chain.steps[index].id, spec: chain.steps[index].spec,
      result: {
        start: { h: enthalpyOffset } as ThermoState,
        end: { h: enthalpyOffset + q - w } as ThermoState,
        q, w, path: new Float64Array(),
      },
    })),
  };
  return { chain, result };
}

const powerEdges: [string, string, number, number][] = [
  ["1", "2", 0, -10000], ["2", "3", 100000, 0],
  ["3", "4", 0, 40000], ["4", "1", -70000, 0],
];

describe("cycle energy balances", () => {
  it("calculates a power cycle independently of connection order and enthalpy reference", () => {
    for (const offset of [0, -1e7, 2e9]) {
      const { chain, result } = network(powerEdges, offset);
      chain.steps.reverse(); result.steps.reverse();
      const loops = analyzeEnergy([chain], [result]);
      expect(loops).toHaveLength(1);
      expect(loops[0].status).toBe("closed");
      expect(loops[0].totals).toMatchObject({
        heatIn: 100000, heatOut: 70000, workIn: 10000, workOut: 40000,
        netHeat: 30000, netWork: 30000, residual: 0, balanced: true,
        efficiency: 0.3, coolingCOP: null, heatingCOP: null,
      });
    }
  });

  it("calculates cooling and heating COP with positive input/output magnitudes", () => {
    const { chain, result } = network([
      ["1", "2", 0, -50000], ["2", "3", -200000, 0],
      ["3", "4", 0, 0], ["4", "1", 150000, 0],
    ]);
    expect(analyzeEnergy([chain], [result])[0].totals).toMatchObject({
      netWork: -50000, heatIn: 150000, heatOut: 200000,
      coolingCOP: 3, heatingCOP: 4, efficiency: null, balanced: true,
    });
  });

  it("excludes paired recuperator duties from external heat and COP", () => {
    const { chain, result } = network([
      ["1", "2", 0, -100000], ["2", "3", -120000, 0],
      ["3", "4", -200000, 0], ["4", "5", 0, 10000],
      ["5", "6", 30000, 0], ["6", "1", 200000, 0],
    ]);
    const snapshot = { connections: [2, 5].map((i) => ({ id: `edge-${i}`, kind: "hx" })) } as ExampleSnapshot;
    const totals = analyzeEnergy([chain], [result], snapshot)[0].totals;
    expect(totals).toMatchObject({ heatIn: 30000, heatOut: 120000, netWork: -90000, balanced: true });
    expect(totals?.coolingCOP).toBeCloseTo(1 / 3);
    expect(totals?.heatingCOP).toBeCloseTo(4 / 3);
    // Explicit user settings override imported recuperator metadata.
    chain.steps[2].heatTransfer = "external";
    expect(analyzeEnergy([chain], [result], snapshot)[0].totals?.balanced).toBe(false);
  });

  it("flags an unpaired internal duty and withholds performance ratios", () => {
    const { chain, result } = network(powerEdges);
    chain.steps[1].heatTransfer = "internal";
    expect(analyzeEnergy([chain], [result])[0].totals).toMatchObject({
      residual: -100000, balanced: false, efficiency: null, coolingCOP: null, heatingCOP: null,
    });
  });

  it("reports an energy imbalance even when the connections form a closed shape", () => {
    const { chain, result } = network(powerEdges);
    result.steps[3].result!.q = -60000;
    expect(analyzeEnergy([chain], [result])[0].totals).toMatchObject({ residual: 10000, balanced: false, efficiency: null });
  });

  it("does not divide by zero or classify a negligible-work loop", () => {
    const { chain, result } = network([["1", "2", 10000, 0], ["2", "1", -10000, 0]]);
    expect(analyzeEnergy([chain], [result])[0].totals).toMatchObject({
      balanced: true, efficiency: null, coolingCOP: null, heatingCOP: null,
    });
  });
});

describe("network topology and incomplete calculations", () => {
  it("keeps disconnected cycles separate, including cycles spread across chains", () => {
    const first = network(powerEdges);
    const second = network(powerEdges.map(([from, to, q, w]) => [`b${from}`, `b${to}`, q * 2, w * 2]));
    second.chain.steps.forEach((step, i) => { step.id = `other-${i}`; second.result.steps[i].id = step.id; });
    const splitChain = { ...first.chain, id: "split", steps: first.chain.steps.splice(2) };
    const loops = analyzeEnergy([first.chain, second.chain, splitChain], [first.result, second.result]);
    expect(loops.map((loop) => loop.status)).toEqual(["closed", "closed"]);
    expect(loops.map((loop) => loop.totals?.netWork)).toEqual([30000, 60000]);
  });

  it("retains per-connection energy while withholding totals on open paths", () => {
    const { chain, result } = network(powerEdges.slice(0, 3));
    const loop = analyzeEnergy([chain], [result])[0];
    expect(loop.status).toBe("open"); expect(loop.totals).toBeNull();
    expect(loop.connections[0]).toMatchObject({ q: 0, w: -10000 });
  });

  it.each([
    [...powerEdges, ["2", "5", 1000, 0] as [string, string, number, number]],
    [["1", "2", 1, 0], ["1", "2", 1, 0], ["2", "1", -2, 0]] as [string, string, number, number][],
    [["1", "2", 0, 1], ["3", "2", 0, 1], ["2", "1", 0, -2]] as [string, string, number, number][],
  ].map((edges) => ({ edges })))("withholds totals on splits, duplicate edges and mergers", ({ edges }) => {
    const { chain, result } = network(edges);
    expect(analyzeEnergy([chain], [result])[0]).toMatchObject({ status: "branched", totals: null });
  });

  it("requires a directed circuit, not just an undirected closed shape", () => {
    const { chain, result } = network([["1", "2", 0, 1], ["3", "2", 0, 1], ["3", "1", 0, 1]]);
    expect(analyzeEnergy([chain], [result])[0].totals).toBeNull();
  });

  it.each([null, NaN, Infinity])("withholds totals when a closed loop contains invalid results (%s)", (q) => {
    const { chain, result } = network(powerEdges);
    if (q === null) result.steps[1].result = null;
    else result.steps[1].result!.q = q;
    const loop = analyzeEnergy([chain], [result])[0];
    expect(loop).toMatchObject({ status: "invalid", totals: null });
    expect(loop.connections.find((connection) => connection.id === "edge-1")?.q).toBeNull();
  });

  it("does not treat separator and mixer legs as heaters", () => {
    for (const kind of ["separator", "mixer"]) {
      const { chain, result } = network(powerEdges);
      const snapshot = { connections: [{ id: "edge-1", kind }] } as ExampleSnapshot;
      const loop = analyzeEnergy([chain], [result], snapshot)[0];
      expect(loop).toMatchObject({ status: "invalid", totals: null });
      expect(loop.connections.find((connection) => connection.id === "edge-1")?.reason).toContain("stream mass flows");
    }
  });

  it("handles missing endpoints, self-loops, missing results and an empty graph", () => {
    expect(analyzeEnergy([], [])).toEqual([]);
    const { chain } = network([["1", "1", 0, 0]]);
    expect(analyzeEnergy([chain], [])[0].totals).toBeNull();
    chain.steps[0].toPointId = undefined;
    expect(analyzeEnergy([chain], [])[0].totals).toBeNull();
  });
});

