import { engine } from "../engine/client";
import { ProcessKind, Prop, type CycleSegmentResult, type ProcessSpec, type StateInput, type ThermoState } from "../engine/types";

export async function editableSpec(segment: CycleSegmentResult, from: ThermoState | undefined, to: ThermoState | undefined, fluid: string): Promise<ProcessSpec> {
  const kind = segment.kind.toLowerCase();
  if ((kind === "compressor" || kind === "pump") && from && to && Math.abs(from.T - to.T) < 1e-5) {
    return { kind: ProcessKind.Isothermal, target: Prop.P, value: to.p };
  }
  if (kind === "compressor" || kind === "pump") {
    const efficiency = await inferEfficiency(fluid, from, to, ProcessKind.Compression, 0.8);
    return { kind: ProcessKind.Compression, target: Prop.P, value: to?.p ?? 1e6, efficiency };
  }
  if (kind === "expander" || kind === "turbine") {
    const efficiency = await inferEfficiency(fluid, from, to, ProcessKind.Expansion, 0.85);
    return { kind: ProcessKind.Expansion, target: Prop.P, value: to?.p ?? 1e5, efficiency };
  }
  if (kind === "valve") return { kind: ProcessKind.Isenthalpic, target: Prop.P, value: to?.p ?? 1e5 };
  if (kind === "separator" && to && Number.isFinite(to.Q) && to.Q >= 0 && to.Q <= 1) {
    return { kind: ProcessKind.Isobaric, target: Prop.Q, value: to.Q };
  }
  if (kind === "mixer") return { kind: ProcessKind.Isobaric, target: Prop.H, value: to?.h ?? 3e5 };
  // Pressure and temperature are dependent at saturation. Enthalpy identifies
  // the intended state through boiling, condensation and two-phase exchangers.
  return { kind: ProcessKind.Isobaric, target: Prop.H, value: to?.h ?? 3e5 };
}

async function inferEfficiency(fluid: string, from: ThermoState | undefined, to: ThermoState | undefined, kind: ProcessKind, fallback: number): Promise<number> {
  if (!from || !to) return fallback;
  const input: StateInput = { a: Prop.P, va: from.p, b: Prop.H, vb: from.h };
  let ideal;
  try {
    ideal = await engine.process(fluid, input, { kind, target: Prop.P, value: to.p, efficiency: 1 });
  } catch {
    return fallback;
  }
  if (!ideal.ok) return fallback;
  const numerator = kind === ProcessKind.Compression ? ideal.end.h - from.h : from.h - to.h;
  const denominator = kind === ProcessKind.Compression ? to.h - from.h : from.h - ideal.end.h;
  const efficiency = numerator / denominator;
  return Number.isFinite(efficiency) && efficiency > 0 && efficiency <= 1 ? efficiency : fallback;
}
