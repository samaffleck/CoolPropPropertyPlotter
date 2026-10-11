import type { UnitChoice } from "../units/units";
import type { ProcessSpec, Prop, StateInput, Viewport } from "./types";

export interface AxesSpec {
  x: Prop;
  y: Prop;
  xLog: boolean;
  yLog: boolean;
}

type Base = { id: number; fluid: string };

export type Request = Base &
  (
    | { op: "info" }
    | { op: "state"; input: StateInput }
    | { op: "saturation" }
    | { op: "chart"; viewport: Viewport; isolines: { prop: Prop; values: number[] }[] }
    | { op: "chartAuto"; viewport: Viewport; families: Prop[]; units: UnitChoice; density: number }
    | { op: "defaultView"; axes: AxesSpec }
    | { op: "process"; start: StateInput; spec: ProcessSpec }
    | { op: "cycle"; cycle: string; params: Record<string, number> }
  );

export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type RequestBody = DistributiveOmit<Request, "id">;

export type Response =
  | { id: number; ok: true; result: unknown; ms: number }
  | { id: number; ok: false; error: string };
