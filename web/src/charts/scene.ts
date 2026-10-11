// Builds the renderer scene for a thermodynamic chart from computed data.
import { statePoint } from "../engine/curve";
import { Prop, type ChartResult, type CycleResult, type FluidInfo, type Saturation } from "../engine/types";
import type { ChainResult, PointResult } from "../state/compute";
import type { ExampleSnapshot } from "../state/store";
import { COORDINATES } from "../units/properties";
import { formatCompact, toDisplay, unitOf, type UnitChoice } from "../units/units";
import type { Scene, SceneLine, SceneMarker } from "./renderer";
import type { ChartTheme } from "./theme";

const FAMILY_KEY: Record<Prop, string> = {
  [Prop.T]: "T",
  [Prop.P]: "P",
  [Prop.D]: "D",
  [Prop.V]: "D",
  [Prop.H]: "H",
  [Prop.S]: "S",
  [Prop.U]: "H",
  [Prop.Q]: "Q",
};

export function familyColor(theme: ChartTheme, family: Prop) {
  return theme.iso[FAMILY_KEY[family]];
}

export function isolineLabel(prop: Prop, valueSI: number, units: UnitChoice): string {
  const meta = COORDINATES[prop];
  const unit = unitOf(units, meta.quantity);
  const v = formatCompact(toDisplay(unit, valueSI), 4);
  switch (prop) {
    case Prop.Q:
      return `x=${formatCompact(valueSI, 2)}`;
    case Prop.S:
      return `s=${v}`;
    case Prop.H:
      return `h=${v}`;
    default:
      return `${v} ${unit.label}`;
  }
}

export interface SceneInput {
  theme: ChartTheme;
  units: UnitChoice;
  info: FluidInfo | null;
  saturation: Saturation | null;
  isolines: ChartResult | null;
  points: PointResult[];
  chains: ChainResult[];
  cycle: CycleResult | null;
  exampleSnapshot: ExampleSnapshot | null;
  showOverlays: { points: boolean; chains: boolean; cycle: boolean };
}

export function buildScene(o: SceneInput): Scene {
  const { theme } = o;
  const lines: SceneLine[] = [];
  const markers: SceneMarker[] = [];
  const hasOverlay =
    (o.showOverlays.cycle && !!o.cycle) || (o.showOverlays.chains && o.chains.some((c) => c.steps.length > 0));

  if (o.saturation) {
    lines.push({ data: o.saturation.dome, color: "transparent", width: 0, fill: theme.domeFill });
  }
  for (const iso of o.isolines?.isolines ?? []) {
    lines.push({
      data: iso.data,
      color: familyColor(theme, iso.prop),
      width: 1,
      alpha: hasOverlay ? 0.45 : 0.8,
      dash: iso.prop === Prop.Q ? [4, 3] : undefined,
      label: isolineLabel(iso.prop, iso.value, o.units),
    });
  }
  if (o.saturation) {
    lines.push({ data: o.saturation.dome, color: theme.dome, width: 1.75 });
    const ci = o.saturation.criticalIndex;
    if (ci > 0) {
      markers.push({ point: o.saturation.dome.slice(ci * 6, ci * 6 + 6), color: theme.dome, shape: "diamond", size: 3.5, label: "CP" });
    }
  }

  if (o.showOverlays.points) {
    for (const p of o.points) {
      if (p.state) markers.push({ point: statePoint(p.state), color: theme.accent, label: p.point.label, id: p.point.id });
    }
  }

  if (o.showOverlays.chains) {
    o.chains.forEach((c, ci) => {
      const color = theme.paths[ci % theme.paths.length];
      for (const st of c.steps) {
        if (!st.result) continue;
        const connection = c.chain.steps.find((step) => step.id === st.id);
        const endpoints: [string, string] | undefined = connection?.fromPointId && connection.toPointId
          ? [connection.fromPointId, connection.toPointId]
          : undefined;
        lines.push({ data: st.result.path, color, width: 2.5, arrows: true, emphasis: true, connectedPointIds: endpoints });
        if (!endpoints) {
          markers.push({ point: statePoint(st.result.start), color });
          markers.push({ point: statePoint(st.result.end), color });
        }
      }
      if (c.start && !c.chain.steps.some((st) => st.fromPointId && st.toPointId)) markers.push({ point: statePoint(c.start), color });
    });
  }

  if (o.showOverlays.cycle && o.cycle) {
    const color = theme.paths[0];
    for (const seg of o.cycle.segments) {
      const minor = seg.kind === "separator" || seg.kind === "mixer";
      lines.push({
        data: seg.path,
        color,
        width: minor ? 1.5 : 2.5,
        dash: minor ? [5, 4] : undefined,
        arrows: !minor,
        emphasis: true,
      });
    }
    for (const s of o.cycle.states) markers.push({ point: statePoint(s.state), color, label: s.id });
  }
  return { lines, markers };
}
