import { ProcessKind, Prop, type ProcessSpec, type StateInput } from "../engine/types";

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
