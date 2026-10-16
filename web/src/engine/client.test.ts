import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProcessKind, Prop, type ProcessSpec, type StateInput, type ThermoState } from "./types";
import type { Request, Response } from "./protocol";

class TestWorker {
  static current: TestWorker;
  requests: Request[] = [];
  onmessage: ((event: MessageEvent<Response>) => void) | null = null;
  respond?: (request: Request) => unknown;
  constructor() { TestWorker.current = this; }
  postMessage(request: Request) {
    this.requests.push(request);
    if (this.respond) queueMicrotask(() => this.reply(request, this.respond!(request)));
  }
  reply(request: Request, result: unknown, ok = true) {
    const data: Response = ok ? { id: request.id, ok: true, result, ms: 0 } : { id: request.id, ok: false, error: "transport failure" };
    this.onmessage!({ data } as MessageEvent<Response>);
  }
}

const input: StateInput = { a: Prop.P, va: 1e5, b: Prop.H, vb: 3e5 };
const spec: ProcessSpec = { kind: ProcessKind.Compression, target: Prop.P, value: 5e5, efficiency: 0.8 };
const state = { T: 300, p: 1e5, h: 3e5, s: 2000, rho: 1 } as ThermoState;
const end = { ...state, p: 5e5, h: 5e5, T: 500 };
const result = { ok: true, start: state, end, path: new Float64Array(12), q: 0, w: -2e5 };

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("Worker", TestWorker);
});
afterEach(() => vi.unstubAllGlobals());

it("shares in-flight and completed process results including their paths", async () => {
  const { engine } = await import("./client");
  const first = engine.process("Nitrogen", input, spec);
  const second = engine.process("Nitrogen", { ...input }, { ...spec });
  expect(first).toBe(second);
  const worker = TestWorker.current;
  expect(worker.requests).toHaveLength(1);
  worker.reply(worker.requests[0], result);
  expect(await first).toBe(result);
  expect(await engine.process("Nitrogen", input, spec)).toBe(result);
  expect(worker.requests).toHaveLength(1);
});

it("reuses the endpoint process when computing its connection", async () => {
  const { computePointStates, computeChains } = await import("../state/compute");
  const worker = TestWorker.current;
  worker.respond = (request) => request.op === "state" ? { ok: true, state } : result;
  const points = [
    { id: "a", label: "1", input },
    { id: "b", label: "2", input: { ...input, va: 5e5 }, derivedFromStepId: "ab" },
  ];
  const chains = [{ id: "chain", start: input, steps: [{ id: "ab", fromPointId: "a", toPointId: "b", spec }] }];
  const resolved = await computePointStates("Nitrogen", points, chains);
  const computed = await computeChains("Nitrogen", chains, resolved);
  expect(resolved[1].state).toBe(end);
  expect(computed[0].steps[0].result).toBe(result);
  expect(worker.requests.filter((request) => request.op === "process")).toHaveLength(1);
});

it("recalculates when fluid, inlet, target, kind, or efficiency changes", async () => {
  const { engine } = await import("./client");
  const worker = TestWorker.current;
  worker.respond = () => result;
  await engine.process("Nitrogen", input, spec);
  await engine.process("Water", input, spec);
  await engine.process("Nitrogen", { ...input, vb: 4e5 }, spec);
  await engine.process("Nitrogen", input, { ...spec, value: 6e5 });
  await engine.process("Nitrogen", input, { ...spec, kind: ProcessKind.Expansion });
  await engine.process("Nitrogen", input, { ...spec, efficiency: 0.9 });
  expect(worker.requests).toHaveLength(6);
});

it("retries failed calculations and transport failures", async () => {
  const { engine } = await import("./client");
  const worker = TestWorker.current;
  const failed = engine.process("Nitrogen", input, spec);
  worker.reply(worker.requests[0], { ok: false, error: "solver failure" });
  expect((await failed).ok).toBe(false);
  const rejected = engine.process("Nitrogen", input, spec);
  worker.reply(worker.requests[1], null, false);
  await expect(rejected).rejects.toThrow("transport failure");
  const retry = engine.process("Nitrogen", input, spec);
  worker.reply(worker.requests[2], result);
  expect(await retry).toBe(result);
});

it("bounds retained results and keeps recently used entries", async () => {
  const { engine } = await import("./client");
  const worker = TestWorker.current;
  worker.respond = () => result;
  for (let i = 0; i < 128; i++) await engine.process("Nitrogen", input, { ...spec, value: i });
  await engine.process("Nitrogen", input, { ...spec, value: 0 });
  await engine.process("Nitrogen", input, { ...spec, value: 128 });
  await engine.process("Nitrogen", input, { ...spec, value: 0 });
  expect(worker.requests).toHaveLength(129);
  await engine.process("Nitrogen", input, { ...spec, value: 1 });
  expect(worker.requests).toHaveLength(130);
});
