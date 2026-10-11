// Axis scale (data <-> pixels) and tick generation. Data is SI; ticks are nice in display units.
import { formatCompact, formatTick, fromDisplay, toDisplay, type Unit } from "../units/units";
import { niceStep } from "./nice";

export class Axis {
  constructor(
    public lo: number,
    public hi: number,
    public log: boolean,
    public px0: number,
    public px1: number,
  ) {}

  private t(v: number) {
    return this.log ? Math.log(v) : v;
  }

  toPx(v: number): number {
    const a = this.t(this.lo);
    const b = this.t(this.hi);
    return this.px0 + ((this.t(v) - a) / (b - a)) * (this.px1 - this.px0);
  }

  fromPx(px: number): number {
    const a = this.t(this.lo);
    const b = this.t(this.hi);
    const u = a + ((px - this.px0) / (this.px1 - this.px0)) * (b - a);
    return this.log ? Math.exp(u) : u;
  }

  /** Zoom by `factor` (<1 zooms in) keeping the value under pixel `px` fixed. */
  zoomed(factor: number, px: number): [number, number] {
    const a = this.t(this.lo);
    const b = this.t(this.hi);
    const c = this.t(this.fromPx(px));
    const lo = c + (a - c) * factor;
    const hi = c + (b - c) * factor;
    return this.log ? [Math.exp(lo), Math.exp(hi)] : [lo, hi];
  }

  /** Shift by a pixel delta. */
  panned(dpx: number): [number, number] {
    return [this.fromPx(this.px0 - dpx), this.fromPx(this.px1 - dpx)];
  }
}

export interface Tick {
  value: number; // SI
  label: string | null; // null = minor gridline
}

export function ticks(axis: Axis, unit: Unit, pixelSpan: number): Tick[] {
  const a = toDisplay(unit, axis.lo);
  const b = toDisplay(unit, axis.hi);
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const out: Tick[] = [];
  if (axis.log) {
    if (!(lo > 0)) return out;
    const decades = Math.log10(hi / lo);
    const perDecadePx = pixelSpan / Math.max(decades, 1e-9);
    const labelled = perDecadePx > 220 ? [1, 2, 3, 5, 7] : perDecadePx > 110 ? [1, 2, 5] : perDecadePx > 50 ? [1, 3] : [1];
    const decadeStride = perDecadePx > 28 ? 1 : Math.ceil(28 / perDecadePx);
    for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) {
      for (let m = 1; m < 10; m++) {
        const v = Number((m * 10 ** e).toPrecision(6));
        if (v < lo || v > hi) continue;
        const isLabel = labelled.includes(m) && (m !== 1 || e % decadeStride === 0) && (m === 1 || decadeStride === 1);
        if (!isLabel && perDecadePx < 40) continue;
        out.push({ value: fromDisplay(unit, v), label: isLabel ? formatCompact(v) : null });
      }
    }
    return out;
  }
  const step = niceStep(hi - lo, Math.max(2, pixelSpan / 90));
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) {
    const clean = Math.abs(v) < step * 1e-9 ? 0 : Number(v.toPrecision(12));
    out.push({ value: fromDisplay(unit, clean), label: formatTick(clean, step) });
  }
  return out;
}
