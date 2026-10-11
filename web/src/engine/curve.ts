import { CURVE_STRIDE, Prop, type ThermoState } from "./types";

/** Value of a coordinate at vertex i of a flat curve ([T, p, rho, h, s, Q] per vertex). */
export function curveValue(d: Float64Array, i: number, prop: Prop): number {
  const o = i * CURVE_STRIDE;
  switch (prop) {
    case Prop.T:
      return d[o];
    case Prop.P:
      return d[o + 1];
    case Prop.D:
      return d[o + 2];
    case Prop.V:
      return 1 / d[o + 2];
    case Prop.H:
      return d[o + 3];
    case Prop.S:
      return d[o + 4];
    case Prop.Q:
      return d[o + 5];
    default:
      return NaN;
  }
}

export const curveLength = (d: Float64Array) => d.length / CURVE_STRIDE;

/** A single state as a one-vertex curve, so markers and lines share coordinate lookup. */
export function statePoint(s: ThermoState): Float64Array {
  return Float64Array.of(s.T, s.p, s.rho, s.h, s.s, s.Q);
}
