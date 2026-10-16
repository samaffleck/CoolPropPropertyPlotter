// Metadata for thermodynamic properties: labels, symbols, unit families and how to read them.
import { Prop, type ThermoPoint, type ThermoState } from "../engine/types";
import type { Quantity } from "./units";

export interface PropertyMeta {
  key: keyof ThermoState;
  symbol: string;
  label: string;
  quantity: Quantity;
}

export const STATE_PROPERTIES: PropertyMeta[] = [
  { key: "T", symbol: "T", label: "Temperature", quantity: "temperature" },
  { key: "p", symbol: "p", label: "Pressure", quantity: "pressure" },
  { key: "rho", symbol: "ρ", label: "Density", quantity: "density" },
  { key: "v", symbol: "v", label: "Specific volume", quantity: "specific_volume" },
  { key: "h", symbol: "h", label: "Enthalpy", quantity: "specific_energy" },
  { key: "s", symbol: "s", label: "Entropy", quantity: "specific_entropy" },
  { key: "u", symbol: "u", label: "Internal energy", quantity: "specific_energy" },
  { key: "Q", symbol: "x", label: "Vapour quality", quantity: "fraction" },
  { key: "cp", symbol: "cₚ", label: "Isobaric heat capacity", quantity: "specific_entropy" },
  { key: "cv", symbol: "cᵥ", label: "Isochoric heat capacity", quantity: "specific_entropy" },
  { key: "gamma", symbol: "γ", label: "Heat capacity ratio", quantity: "ratio" },
  { key: "w", symbol: "a", label: "Speed of sound", quantity: "speed" },
  { key: "mu", symbol: "μ", label: "Viscosity", quantity: "viscosity" },
  { key: "k", symbol: "λ", label: "Thermal conductivity", quantity: "conductivity" },
  { key: "Pr", symbol: "Pr", label: "Prandtl number", quantity: "ratio" },
  { key: "Z", symbol: "Z", label: "Compressibility factor", quantity: "ratio" },
  { key: "muJT", symbol: "μJT", label: "Joule-Thomson coefficient", quantity: "jt_coefficient" },
  { key: "sigma", symbol: "σ", label: "Surface tension", quantity: "surface_tension" },
];

export interface CoordinateMeta {
  prop: Prop;
  key: "T" | "p" | "rho" | "v" | "h" | "s" | "u" | "Q";
  symbol: string;
  label: string;
  quantity: Quantity;
}

/** Properties that can be used as flash inputs, chart axes and isolines. */
export const COORDINATES: Record<Prop, CoordinateMeta> = {
  [Prop.T]: { prop: Prop.T, key: "T", symbol: "T", label: "Temperature", quantity: "temperature" },
  [Prop.P]: { prop: Prop.P, key: "p", symbol: "p", label: "Pressure", quantity: "pressure" },
  [Prop.D]: { prop: Prop.D, key: "rho", symbol: "ρ", label: "Density", quantity: "density" },
  [Prop.V]: { prop: Prop.V, key: "v", symbol: "v", label: "Specific volume", quantity: "specific_volume" },
  [Prop.H]: { prop: Prop.H, key: "h", symbol: "h", label: "Enthalpy", quantity: "specific_energy" },
  [Prop.S]: { prop: Prop.S, key: "s", symbol: "s", label: "Entropy", quantity: "specific_entropy" },
  [Prop.U]: { prop: Prop.U, key: "u", symbol: "u", label: "Internal energy", quantity: "specific_energy" },
  [Prop.Q]: { prop: Prop.Q, key: "Q", symbol: "x", label: "Quality", quantity: "fraction" },
};

export const INPUT_PROPS: Prop[] = [Prop.T, Prop.P, Prop.H, Prop.S, Prop.D, Prop.V, Prop.U, Prop.Q];

export function stateValue(s: ThermoPoint, prop: Prop): number {
  return s[COORDINATES[prop].key];
}
