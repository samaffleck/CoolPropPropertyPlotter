// Type declarations for the Emscripten module built from core/bindings/wasm.cpp.
import type {
  ChartResult,
  CycleResult,
  FluidInfo,
  ProcessResult,
  ProcessSpec,
  Prop,
  Result,
  Saturation,
  StateInput,
  ThermoState,
  Viewport,
} from "../types";

export interface ThermoModule {
  loadFluid(json: string): Result<object>;
  fluidInfo(name: string): FluidInfo | null;
  state(fluid: string, a: Prop, va: number, b: Prop, vb: number): Result<{ state: ThermoState }>;
  saturation(fluid: string): Saturation;
  chart(fluid: string, vp: Viewport, isolines: { prop: Prop; values: number[] }[]): Result<ChartResult>;
  process(fluid: string, start: StateInput, spec: ProcessSpec): Result<ProcessResult>;
  cycle(id: string, fluid: string, params: Record<string, number>): Result<CycleResult>;
}

export default function createThermo(opts?: { locateFile?: (path: string) => string }): Promise<ThermoModule>;
