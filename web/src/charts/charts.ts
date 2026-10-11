import { Prop } from "../engine/types";

export type ChartId = "Ts" | "Ph" | "hs" | "Pv" | "PT" | "Th";

export interface ChartDef {
  id: ChartId;
  label: string;
  title: string;
  x: Prop;
  y: Prop;
  xLog: boolean;
  yLog: boolean;
  /** Isoline families offered on this chart, in legend order. */
  families: Prop[];
}

export const CHARTS: ChartDef[] = [
  { id: "Ts", label: "T–s", title: "Temperature–entropy", x: Prop.S, y: Prop.T, xLog: false, yLog: false, families: [Prop.P, Prop.H, Prop.D, Prop.Q] },
  { id: "Ph", label: "p–h", title: "Pressure–enthalpy", x: Prop.H, y: Prop.P, xLog: false, yLog: true, families: [Prop.T, Prop.S, Prop.D, Prop.Q] },
  { id: "hs", label: "h–s", title: "Enthalpy–entropy (Mollier)", x: Prop.S, y: Prop.H, xLog: false, yLog: false, families: [Prop.P, Prop.T, Prop.Q] },
  { id: "Pv", label: "p–v", title: "Pressure–specific volume", x: Prop.V, y: Prop.P, xLog: true, yLog: true, families: [Prop.T, Prop.S, Prop.Q] },
  { id: "PT", label: "p–T", title: "Pressure–temperature (phase diagram)", x: Prop.T, y: Prop.P, xLog: false, yLog: true, families: [Prop.D, Prop.H] },
  { id: "Th", label: "T–h", title: "Temperature–enthalpy", x: Prop.H, y: Prop.T, xLog: false, yLog: false, families: [Prop.P, Prop.Q] },
];

export const chartById = (id: ChartId) => CHARTS.find((c) => c.id === id) ?? CHARTS[0];

/** Families that are spaced logarithmically. */
export const LOG_FAMILIES = new Set<Prop>([Prop.P, Prop.D, Prop.V]);

export const FAMILY_NAMES: Record<Prop, string> = {
  [Prop.T]: "Isotherms",
  [Prop.P]: "Isobars",
  [Prop.D]: "Isochores",
  [Prop.V]: "Isochores",
  [Prop.H]: "Isenthalps",
  [Prop.S]: "Isentropes",
  [Prop.U]: "Constant u",
  [Prop.Q]: "Quality",
};
