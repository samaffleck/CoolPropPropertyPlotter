// Types shared by the worker and the UI. They mirror core/bindings/wasm.cpp; all values are SI.

export const Prop = {
  T: 0,
  P: 1,
  D: 2,
  V: 3,
  H: 4,
  S: 5,
  U: 6,
  Q: 7,
} as const;
export type Prop = (typeof Prop)[keyof typeof Prop];

export const ProcessKind = {
  Isobaric: 0,
  Isothermal: 1,
  Isentropic: 2,
  Isenthalpic: 3,
  Isochoric: 4,
  Compression: 5,
  Expansion: 6,
} as const;
export type ProcessKind = (typeof ProcessKind)[keyof typeof ProcessKind];

export interface FluidSummary {
  name: string;
  aliases: string;
  cas: string;
  ashrae34: string;
  formula: string;
  molarMass: number;
  Tcrit: number;
  pcrit: number;
  Ttriple: number;
  ptriple: number;
  Tmax: number;
  pmax: number;
  gwp100: number | null;
  odp: number | null;
}

export interface FluidInfo extends FluidSummary {
  rhocrit: number;
  hcrit: number;
  scrit: number;
  Tmin: number;
  acentric: number;
  hasMeltingLine: boolean;
}

export interface ThermoState {
  phase: string;
  T: number;
  p: number;
  rho: number;
  v: number;
  h: number;
  s: number;
  u: number;
  Q: number;
  cp: number;
  cv: number;
  gamma: number;
  w: number;
  mu: number;
  k: number;
  Pr: number;
  Z: number;
  beta: number;
  kappaT: number;
  muJT: number;
  sigma: number;
}

/** Flat curve: [T, p, rho, h, s, Q] per vertex; a NaN temperature marks a break. */
export type CurveData = Float64Array;
export const CURVE_STRIDE = 6;

export interface Viewport {
  x: Prop;
  y: Prop;
  xLog: boolean;
  yLog: boolean;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  tolerance?: number;
}

export interface StateInput {
  a: Prop;
  va: number;
  b: Prop;
  vb: number;
}

export interface ProcessSpec {
  kind: ProcessKind;
  target: Prop;
  value: number;
  efficiency?: number;
}

export interface Saturation {
  dome: CurveData;
  criticalIndex: number;
  melting: CurveData;
}

export interface Isoline {
  prop: Prop;
  value: number;
  data: CurveData;
}

export interface ChartResult {
  isolines: Isoline[];
  domain: { Tmin: number; Tmax: number; pmin: number; pmax: number };
}

export interface ProcessResult {
  start: ThermoState;
  end: ThermoState;
  path: CurveData;
  q: number;
  w: number;
}

export interface CycleStateResult {
  id: string;
  label: string;
  flow: number;
  state: ThermoState;
}

export interface CycleSegmentResult {
  from: string;
  to: string;
  component: string;
  kind: string;
  path: CurveData;
}

export interface Metric {
  key: string;
  label: string;
  quantity: string;
  group: "performance" | "exergy" | "design";
  value: number;
}

export interface ExchangerProfile {
  name: string;
  q: Float64Array;
  Thot: Float64Array;
  Tcold: Float64Array;
  minApproach: number;
}

export interface CycleResult {
  states: CycleStateResult[];
  segments: CycleSegmentResult[];
  metrics: Metric[];
  exchangers: ExchangerProfile[];
  warnings: string[];
}

export type Result<T> = ({ ok: true } & T) | { ok: false; error: string };
