// Canvas 2D renderer for thermodynamic charts. Stateless: render() draws a full frame.
import { curveLength, curveValue } from "../engine/curve";
import type { Prop } from "../engine/types";
import type { Unit } from "../units/units";
import { Axis, ticks } from "./axis";

export interface SceneLine {
  data: Float64Array; // flat curve, SI
  color: string;
  width: number;
  dash?: number[];
  alpha?: number;
  label?: string;
  labelAt?: number; // preferred position along the visible part, 0..1
  arrows?: boolean;
  fill?: string; // fill the closed polygon
  emphasis?: boolean; // drawn above everything else
}

export interface SceneMarker {
  point: Float64Array; // one vertex, SI
  color: string;
  id?: string;
  label?: string;
  shape?: "dot" | "diamond";
  size?: number;
}

export interface Scene {
  lines: SceneLine[];
  markers: SceneMarker[];
}

export interface View {
  x: Prop;
  y: Prop;
  xLog: boolean;
  yLog: boolean;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export interface Theme {
  surface: string;
  text: string;
  textMuted: string;
  grid: string;
  gridMinor: string;
  axis: string;
  font: string;
}

export const MARGIN = { left: 66, right: 18, top: 14, bottom: 46 };

export interface FrameOptions {
  scene: Scene;
  view: View;
  xUnit: Unit;
  yUnit: Unit;
  xTitle: string;
  yTitle: string;
  theme: Theme;
  hover?: { px: number; py: number } | null;
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const clampPx = (v: number) => Math.max(-1e5, Math.min(1e5, v));

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  width = 0;
  height = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
  }

  resize(width: number, height: number) {
    const dpr = window.devicePixelRatio || 1;
    this.width = width;
    this.height = height;
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    if (this.canvas.width !== pixelWidth) this.canvas.width = pixelWidth;
    if (this.canvas.height !== pixelHeight) this.canvas.height = pixelHeight;
    // The backing bitmap uses device pixels; the CSS box must stay in logical pixels.
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  snapToLine(pos: { px: number; py: number }, scene: Scene, view: View, radius = 10) {
    const { x, y } = this.axes(view);
    let best: { px: number; py: number; x: number; y: number; distance: number } | null = null;
    for (const line of scene.lines) {
      const n = curveLength(line.data);
      for (let i = 1; i < n; i++) {
        const x0 = curveValue(line.data, i - 1, view.x);
        const y0 = curveValue(line.data, i - 1, view.y);
        const x1 = curveValue(line.data, i, view.x);
        const y1 = curveValue(line.data, i, view.y);
        if (![x0, y0, x1, y1].every(Number.isFinite)) continue;
        const px0 = x.toPx(x0), py0 = y.toPx(y0), px1 = x.toPx(x1), py1 = y.toPx(y1);
        const dx = px1 - px0, dy = py1 - py0;
        const t = Math.max(0, Math.min(1, ((pos.px - px0) * dx + (pos.py - py0) * dy) / (dx * dx + dy * dy || 1)));
        const px = px0 + t * dx, py = py0 + t * dy;
        const distance = Math.hypot(pos.px - px, pos.py - py);
        if (distance <= radius && (!best || distance < best.distance)) {
          best = { px, py, x: x.fromPx(px), y: y.fromPx(py), distance };
        }
      }
    }
    return best;
  }

  axes(view: View): { x: Axis; y: Axis } {
    return {
      x: new Axis(view.xMin, view.xMax, view.xLog, MARGIN.left, this.width - MARGIN.right),
      y: new Axis(view.yMin, view.yMax, view.yLog, this.height - MARGIN.bottom, MARGIN.top),
    };
  }

  render(o: FrameOptions) {
    const { ctx, width, height } = this;
    const { theme, view } = o;
    const { x: ax, y: ay } = this.axes(view);
    const plot = { x0: MARGIN.left, y0: MARGIN.top, x1: width - MARGIN.right, y1: height - MARGIN.bottom };

    ctx.save();
    ctx.fillStyle = theme.surface;
    ctx.fillRect(0, 0, width, height);
    if (plot.x1 - plot.x0 < 40 || plot.y1 - plot.y0 < 40) {
      ctx.restore();
      return;
    }

    const xt = ticks(ax, o.xUnit, plot.x1 - plot.x0);
    const yt = ticks(ay, o.yUnit, plot.y1 - plot.y0);

    // Grid
    ctx.lineWidth = 1;
    for (const t of xt) {
      const px = Math.round(ax.toPx(t.value)) + 0.5;
      ctx.strokeStyle = t.label ? theme.grid : theme.gridMinor;
      ctx.beginPath();
      ctx.moveTo(px, plot.y0);
      ctx.lineTo(px, plot.y1);
      ctx.stroke();
    }
    for (const t of yt) {
      const py = Math.round(ay.toPx(t.value)) + 0.5;
      ctx.strokeStyle = t.label ? theme.grid : theme.gridMinor;
      ctx.beginPath();
      ctx.moveTo(plot.x0, py);
      ctx.lineTo(plot.x1, py);
      ctx.stroke();
    }

    // Data
    ctx.save();
    ctx.beginPath();
    ctx.rect(plot.x0, plot.y0, plot.x1 - plot.x0, plot.y1 - plot.y0);
    ctx.clip();

    const project = (d: Float64Array, i: number): [number, number] => [
      clampPx(ax.toPx(curveValue(d, i, view.x))),
      clampPx(ay.toPx(curveValue(d, i, view.y))),
    ];
    const ordered = [...o.scene.lines.filter((l) => !l.emphasis), ...o.scene.lines.filter((l) => l.emphasis)];
    const screen = new Map<SceneLine, [number, number][][]>();

    for (const line of ordered) {
      const runs: [number, number][][] = [];
      let run: [number, number][] = [];
      const n = curveLength(line.data);
      for (let i = 0; i < n; i++) {
        const [px, py] = project(line.data, i);
        if (Number.isFinite(px) && Number.isFinite(py)) {
          run.push([px, py]);
        } else if (run.length) {
          runs.push(run);
          run = [];
        }
      }
      if (run.length) runs.push(run);
      screen.set(line, runs);

      ctx.globalAlpha = line.alpha ?? 1;
      if (line.fill) {
        ctx.fillStyle = line.fill;
        ctx.beginPath();
        for (const r of runs) {
          r.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
        }
        ctx.fill();
      }
      if (line.width > 0) {
        ctx.strokeStyle = line.color;
        ctx.lineWidth = line.width;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.setLineDash(line.dash ?? []);
        ctx.beginPath();
        for (const r of runs) {
          r.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (line.arrows) for (const r of runs) this.arrow(r, line.color, line.width);
      ctx.globalAlpha = 1;
    }

    // Markers: merge coincident ones, then reserve label positions so isoline labels avoid them.
    const placed: Box[] = [];
    const markers = this.layoutMarkers(o.scene.markers, project, plot, placed, theme);

    // Isoline labels, placed greedily to avoid collisions.
    ctx.font = `500 11px ${theme.font}`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    const inset = { x0: plot.x0 + 4, y0: plot.y0 + 4, x1: plot.x1 - 4, y1: plot.y1 - 4 };
    for (const line of ordered) {
      if (!line.label) continue;
      this.placeLabel(line, screen.get(line) ?? [], inset, placed, theme);
    }

    // Markers
    for (const m of markers) {
      const r = m.size;
      ctx.beginPath();
      if (m.shape === "diamond") {
        ctx.moveTo(m.px, m.py - r - 1);
        ctx.lineTo(m.px + r + 1, m.py);
        ctx.lineTo(m.px, m.py + r + 1);
        ctx.lineTo(m.px - r - 1, m.py);
        ctx.closePath();
      } else {
        ctx.arc(m.px, m.py, r, 0, Math.PI * 2);
      }
      ctx.fillStyle = theme.surface;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = m.color;
      ctx.stroke();
    }
    ctx.font = `600 12px ${theme.font}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (const m of markers) {
      if (!m.label || !m.labelPos) continue;
      ctx.lineWidth = 3;
      ctx.strokeStyle = theme.surface;
      ctx.strokeText(m.label, m.labelPos[0], m.labelPos[1]);
      ctx.fillStyle = theme.text;
      ctx.fillText(m.label, m.labelPos[0], m.labelPos[1]);
    }
    ctx.restore();

    // Hover crosshair
    if (o.hover) {
      const { px, py } = o.hover;
      if (px >= plot.x0 && px <= plot.x1 && py >= plot.y0 && py <= plot.y1) {
        ctx.strokeStyle = theme.textMuted;
        ctx.globalAlpha = 0.6;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(Math.round(px) + 0.5, plot.y0);
        ctx.lineTo(Math.round(px) + 0.5, plot.y1);
        ctx.moveTo(plot.x0, Math.round(py) + 0.5);
        ctx.lineTo(plot.x1, Math.round(py) + 0.5);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
    }

    // Axes frame, ticks and titles
    ctx.strokeStyle = theme.axis;
    ctx.lineWidth = 1;
    ctx.strokeRect(plot.x0 + 0.5, plot.y0 + 0.5, plot.x1 - plot.x0 - 1, plot.y1 - plot.y0 - 1);
    ctx.fillStyle = theme.textMuted;
    ctx.font = `400 11px ${theme.font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    let lastRight = -Infinity;
    for (const t of xt) {
      if (!t.label) continue;
      const px = ax.toPx(t.value);
      const w = ctx.measureText(t.label).width;
      if (px - w / 2 < lastRight + 6) continue;
      ctx.fillText(t.label, px, plot.y1 + 6);
      lastRight = px + w / 2;
    }
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    let lastTop = Infinity;
    for (const t of yt) {
      if (!t.label) continue;
      const py = ay.toPx(t.value);
      if (py + 6 > lastTop - 2) continue;
      ctx.fillText(t.label, plot.x0 - 6, py);
      lastTop = py - 6;
    }
    ctx.fillStyle = theme.text;
    ctx.font = `500 12px ${theme.font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(o.xTitle, (plot.x0 + plot.x1) / 2, height - 6);
    ctx.save();
    ctx.translate(14, (plot.y0 + plot.y1) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = "middle";
    ctx.fillText(o.yTitle, 0, 0);
    ctx.restore();
    ctx.restore();
  }

  private layoutMarkers(
    input: SceneMarker[],
    project: (d: Float64Array, i: number) => [number, number],
    plot: Box,
    placed: Box[],
    theme: Theme,
  ) {
    type Laid = { px: number; py: number; color: string; shape?: "dot" | "diamond"; size: number; label?: string; labelPos?: [number, number] };
    const out: Laid[] = [];
    for (const m of input) {
      const [px, py] = project(m.point, 0);
      if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
      const same = out.find((o) => Math.abs(o.px - px) < 2.5 && Math.abs(o.py - py) < 2.5 && o.color === m.color);
      if (same) {
        if (m.label) same.label = same.label ? `${same.label}, ${m.label}` : m.label;
        continue;
      }
      out.push({ px, py, color: m.color, shape: m.shape, size: m.size ?? 4.5, label: m.label });
    }
    const { ctx } = this;
    ctx.font = `600 12px ${theme.font}`;
    // Reserve the markers themselves first so labels never cover another state.
    for (const m of out) placed.push({ x0: m.px - m.size - 1, y0: m.py - m.size - 1, x1: m.px + m.size + 1, y1: m.py + m.size + 1 });
    for (const m of out) {
      if (!m.label) continue;
      const w = ctx.measureText(m.label).width;
      const g = m.size + 3;
      const candidates: [number, number][] = [
        [m.px + g, m.py - g - 2],
        [m.px + g, m.py + g + 2],
        [m.px - g - w, m.py - g - 2],
        [m.px - g - w, m.py + g + 2],
        [m.px + g + 2, m.py],
        [m.px - g - w - 2, m.py],
        [m.px - w / 2, m.py - g - 9],
        [m.px - w / 2, m.py + g + 9],
      ];
      let chosen = candidates[0];
      for (const [x, y] of candidates) {
        const box = { x0: x - 1, y0: y - 7, x1: x + w + 1, y1: y + 7 };
        if (box.x0 < plot.x0 || box.x1 > plot.x1 || box.y0 < plot.y0 || box.y1 > plot.y1) continue;
        if (placed.some((b) => overlaps(b, box))) continue;
        chosen = [x, y];
        break;
      }
      m.labelPos = chosen;
      placed.push({ x0: chosen[0] - 1, y0: chosen[1] - 7, x1: chosen[0] + w + 1, y1: chosen[1] + 7 });
    }
    return out;
  }

  private arrow(run: [number, number][], color: string, width: number) {
    if (run.length < 2) return;
    // Arc-length midpoint.
    let total = 0;
    for (let i = 1; i < run.length; i++) total += Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]);
    if (total < 24) return;
    let acc = 0;
    for (let i = 1; i < run.length; i++) {
      const seg = Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]);
      if (acc + seg >= total / 2 && seg > 0) {
        const t = (total / 2 - acc) / seg;
        const x = run[i - 1][0] + t * (run[i][0] - run[i - 1][0]);
        const y = run[i - 1][1] + t * (run[i][1] - run[i - 1][1]);
        const ang = Math.atan2(run[i][1] - run[i - 1][1], run[i][0] - run[i - 1][0]);
        const s = 4 + width * 1.6;
        const { ctx } = this;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(ang);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(s, 0);
        ctx.lineTo(-s * 0.7, s * 0.65);
        ctx.lineTo(-s * 0.7, -s * 0.65);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        return;
      }
      acc += seg;
    }
  }

  private placeLabel(line: SceneLine, runs: [number, number][][], inset: Box, placed: Box[], theme: Theme) {
    const { ctx } = this;
    const inside = (p: [number, number]) => p[0] > inset.x0 && p[0] < inset.x1 && p[1] > inset.y0 && p[1] < inset.y1;
    // Longest visible stretch of the line.
    let best: [number, number][] = [];
    for (const r of runs) {
      let cur: [number, number][] = [];
      for (const p of r) {
        if (inside(p)) {
          cur.push(p);
        } else {
          if (cur.length > best.length) best = cur;
          cur = [];
        }
      }
      if (cur.length > best.length) best = cur;
    }
    if (best.length < 2) return;
    const cum = [0];
    for (let i = 1; i < best.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(best[i][0] - best[i - 1][0], best[i][1] - best[i - 1][1]));
    }
    const total = cum[cum.length - 1];
    const text = line.label!;
    const w = ctx.measureText(text).width + 6;
    if (total < w * 1.6) return;
    const at = (s: number): [number, number] => {
      let i = 1;
      while (i < cum.length - 1 && cum[i] < s) i++;
      const t = (s - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1]);
      return [best[i - 1][0] + t * (best[i][0] - best[i - 1][0]), best[i - 1][1] + t * (best[i][1] - best[i - 1][1])];
    };
    const pref = line.labelAt ?? 0.5;
    for (const f of [pref, pref + 0.15, pref - 0.15, pref + 0.3, pref - 0.3, 0.85, 0.15]) {
      if (f < 0.08 || f > 0.92) continue;
      const s = f * total;
      const [cx, cy] = at(s);
      const [ax, ay] = at(Math.max(0, s - w / 2));
      const [bx, by] = at(Math.min(total, s + w / 2));
      let ang = Math.atan2(by - ay, bx - ax);
      if (ang > Math.PI / 2) ang -= Math.PI;
      if (ang < -Math.PI / 2) ang += Math.PI;
      const hw = (Math.abs(Math.cos(ang)) * w + Math.abs(Math.sin(ang)) * 12) / 2;
      const hh = (Math.abs(Math.sin(ang)) * w + Math.abs(Math.cos(ang)) * 12) / 2;
      const box = { x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh };
      if (box.x0 < inset.x0 || box.x1 > inset.x1 || box.y0 < inset.y0 || box.y1 > inset.y1) continue;
      if (placed.some((b) => overlaps(b, box))) continue;
      placed.push(box);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ang);
      ctx.lineWidth = 4;
      ctx.strokeStyle = theme.surface;
      ctx.strokeText(text, 0, 0);
      ctx.fillStyle = line.color;
      ctx.fillText(text, 0, 0);
      ctx.restore();
      return;
    }
  }
}
