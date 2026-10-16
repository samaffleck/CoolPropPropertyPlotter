import { ProcessKind, Prop, type ProcessSpec, type StateInput, type ThermoState } from "../engine/types";
import type { PinnedPoint, ProcessChain } from "./store";
import { stateValue } from "../units/properties";

export function sharedPropertyForProcess(kind: ProcessKind): Prop | null {
  switch (kind) {
    case ProcessKind.Isobaric: return Prop.P;
    case ProcessKind.Isothermal: return Prop.T;
    case ProcessKind.Isentropic: return Prop.S;
    case ProcessKind.Isenthalpic: return Prop.H;
    case ProcessKind.Isochoric: return Prop.D;
    default: return null;
  }
}

export function processDerivesEndpoint(kind: ProcessKind): boolean {
  return kind === ProcessKind.Compression || kind === ProcessKind.Expansion;
}

export function inputValue(input: StateInput, prop: Prop): number | undefined {
  if (input.a === prop) return input.va;
  if (input.b === prop) return input.vb;
  return undefined;
}

export function setInputValue(input: StateInput, prop: Prop, value: number): StateInput {
  if (input.a === prop) return { ...input, va: value };
  if (input.b === prop) return { ...input, vb: value };
  return input;
}

export function replaceInputProperty(input: StateInput, oldProp: Prop, prop: Prop, value: number): StateInput {
  if (input.a === oldProp) return { ...input, a: prop, va: value };
  if (input.b === oldProp) return { ...input, b: prop, vb: value };
  return input;
}

export function processSpecForEndpoints(kind: ProcessKind, to: StateInput): ProcessSpec {
  const efficiency = kind === ProcessKind.Compression ? 0.8 : kind === ProcessKind.Expansion ? 0.85 : undefined;
  if (kind === ProcessKind.Compression || kind === ProcessKind.Expansion) {
    return { kind, target: Prop.P, value: inputValue(to, Prop.P) ?? 1e6, efficiency };
  }
  const held = sharedPropertyForProcess(kind)!;
  const target = to.a !== held ? to.a : to.b;
  return { kind, target, value: inputValue(to, target) ?? 0 };
}

/** Apply an edit to the whole connected graph, also used for drag previews. */
export function updateConnectedPoints(
  points: PinnedPoint[], chains: ProcessChain[], id: string, patch: Partial<PinnedPoint>, state?: ThermoState, currentStates = new Map<string, ThermoState>(),
): { points: PinnedPoint[]; chains: ProcessChain[] } {
  const previous = points.find((point) => point.id === id);
  if (!previous) return { points, chains };
  if (!patch.input) return { points: points.map((point) => point.id === id ? { ...point, ...patch } : point), chains };
  const steps = chains.flatMap((chain) => chain.steps);
  const heldByPoint = new Map<string, Set<Prop>>();
  for (const step of steps) {
    const prop = sharedPropertyForProcess(step.spec.kind);
    if (prop === null) continue;
    for (const endpoint of [step.fromPointId, step.toPointId]) {
      if (!endpoint) continue;
      const held = heldByPoint.get(endpoint) ?? new Set<Prop>();
      held.add(prop);
      heldByPoint.set(endpoint, held);
    }
  }
  const withProperty = (point: PinnedPoint, prop: Prop, value: number): PinnedPoint => {
    // A process sets its outlet's other properties; only its target is editable.
    const driver = steps.find((step) => step.id === point.derivedFromStepId);
    if (driver && prop !== driver.spec.target) return point;
    let input = setInputValue(point.input, prop, value);
    if (inputValue(input, prop) === undefined) {
      const replace = heldByPoint.get(point.id)?.has(input.a) ? input.b : input.a;
      input = replaceInputProperty(input, replace, prop, value);
    }
    return { ...point, input };
  };
  // Keep every connection's held property in the input basis before changing
  // another value (e.g. a P,T junction must retain T when P changes).
  points = points.map((point) => {
    const current = currentStates.get(point.id);
    if (!current) return point;
    for (const prop of heldByPoint.get(point.id) ?? []) {
      if (inputValue(point.input, prop) === undefined) point = withProperty(point, prop, stateValue(current, prop));
    }
    return point;
  });
  let edited = { ...points.find((point) => point.id === id)!, ...patch };
  for (const prop of heldByPoint.get(id) ?? []) {
    const value = state ? stateValue(state, prop) : inputValue(edited.input, prop) ?? inputValue(previous.input, prop);
    if (value !== undefined) edited = withProperty(edited, prop, value);
  }
  const byId = new Map(points.map((point) => [point.id, point.id === id ? edited : point]));
  // Walk each equality constraint in both directions. Visit each (point,
  // property) once so branches and closed cycles are independent of step order.
  const queue = [...(heldByPoint.get(id) ?? [])].flatMap((prop) => {
    const driver = steps.find((step) => step.id === edited.derivedFromStepId);
    const value = state ? stateValue(state, prop) : inputValue(edited.input, prop);
    return (driver && prop !== driver.spec.target) || value === undefined ? [] : [{ id, prop, value }];
  });
  const visited = new Set<string>();
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    const key = `${current.id}:${current.prop}`;
    if (visited.has(key)) continue;
    visited.add(key);
    for (const step of steps) {
      if (sharedPropertyForProcess(step.spec.kind) !== current.prop) continue;
      const peerId = step.fromPointId === current.id ? step.toPointId : step.toPointId === current.id ? step.fromPointId : undefined;
      const peer = peerId ? byId.get(peerId) : undefined;
      if (!peer) continue;
      byId.set(peer.id, withProperty(peer, current.prop, current.value));
      queue.push({ id: peer.id, prop: current.prop, value: current.value });
    }
  }
  const nextPoints = points.map((point) => byId.get(point.id)!);
  const nextChains = chains.map((chain) => ({ ...chain, steps: chain.steps.map((step) => {
    const to = step.toPointId ? byId.get(step.toPointId) : undefined;
    const value = to ? inputValue(to.input, step.spec.target) : undefined;
    // Non-target properties of a derived outlet are placeholders, never targets.
    return value === undefined || (to?.derivedFromStepId && to.derivedFromStepId !== step.id)
      ? step : { ...step, spec: { ...step.spec, value } };
  }) }));
  return { points: nextPoints, chains: nextChains };
}
