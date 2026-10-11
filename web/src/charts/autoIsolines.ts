// Chooses isoline values for a viewport: round numbers in the user's display units.
import { Prop } from "../engine/types";
import { COORDINATES } from "../units/properties";
import { fromDisplay, toDisplay, unitOf, type UnitChoice } from "../units/units";
import { LOG_FAMILIES } from "./charts";
import { niceLinearValues, niceLogValues } from "./nice";

export const QUALITY_VALUES = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];

export function pickIsolineValues(family: Prop, minSI: number, maxSI: number, units: UnitChoice, target = 10): number[] {
  if (family === Prop.Q) return QUALITY_VALUES;
  if (!(maxSI > minSI)) return [];
  const unit = unitOf(units, COORDINATES[family].quantity);
  const a = toDisplay(unit, minSI);
  const b = toDisplay(unit, maxSI);
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const values = LOG_FAMILIES.has(family) ? niceLogValues(lo, hi, target) : niceLinearValues(lo, hi, target);
  return values.map((v) => fromDisplay(unit, v));
}
