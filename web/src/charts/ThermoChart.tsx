import { Download, Maximize2, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { engine, latestOnly } from "../engine/client";
import { curveValue, statePoint } from "../engine/curve";
import { Prop, type ThermoState, type Viewport } from "../engine/types";
import { useIsolines } from "../state/compute";
import { useData } from "../state/data";
import { useStore } from "../state/store";
import { COORDINATES } from "../units/properties";
import { formatNumber, toDisplay, unitOf } from "../units/units";
import { chartById, CHARTS, FAMILY_NAMES } from "./charts";
import { MARGIN, Renderer } from "./renderer";
import { buildScene, familyColor } from "./scene";
import { useChartTheme } from "./theme";

const axisTitle = (prop: Prop, unitLabel: string) => `${COORDINATES[prop].label}, ${COORDINATES[prop].symbol} [${unitLabel}]`;

export function ThermoChart() {
  const fluid = useStore((s) => s.fluid);
  const chartId = useStore((s) => s.chartId);
  const setChart = useStore((s) => s.setChart);
  const views = useStore((s) => s.views);
  const setView = useStore((s) => s.setView);
  const familiesByChart = useStore((s) => s.families);
  const toggleFamily = useStore((s) => s.toggleFamily);
  const units = useStore((s) => s.units);
  const density = useStore((s) => s.density);
  const mode = useStore((s) => s.mode);
  const addPoint = useStore((s) => s.addPoint);
  const addChain = useStore((s) => s.addChain);
  const cycleId = useStore((s) => s.cycleId);

  const chart = chartById(chartId);
  const data = useData();
  const theme = useChartTheme();
  const storedView = views[chartId];
  const families = (familiesByChart[chartId] ?? []).filter((f) => chart.families.includes(f));
  const iso = useIsolines(fluid, storedView, families, units, density);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const viewRef = useRef<Viewport | undefined>(storedView);
  const hoverRef = useRef<{ px: number; py: number } | null>(null);
  const frame = useRef(0);
  const [readout, setReadout] = useState<{ px: number; py: number; state: ThermoState | null } | null>(null);

  // Default view per chart/fluid.
  useEffect(() => {
    if (storedView) return;
    let live = true;
    engine
      .defaultView(fluid, { x: chart.x, y: chart.y, xLog: chart.xLog, yLog: chart.yLog })
      .then((vp) => live && setView(chartId, vp))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [storedView, fluid, chartId, chart, setView]);

  const scene = useMemo(
    () =>
      buildScene({
        theme,
        units,
        info: data.info,
        saturation: data.saturation,
        isolines: iso.data,
        points: data.points,
        chains: data.chains,
        cycle: mode === "cycle" ? data.cycle : null,
        showOverlays: { points: mode !== "cycle", chains: mode === "process", cycle: mode === "cycle" },
      }),
    [theme, units, data, iso.data, mode],
  );

  const xUnit = unitOf(units, COORDINATES[chart.x].quantity);
  const yUnit = unitOf(units, COORDINATES[chart.y].quantity);

  const draw = useCallback(() => {
    frame.current = 0;
    const r = rendererRef.current;
    const vp = viewRef.current;
    if (!r || !vp) return;
    r.render({
      scene,
      view: vp,
      xUnit,
      yUnit,
      xTitle: axisTitle(chart.x, xUnit.label),
      yTitle: axisTitle(chart.y, yUnit.label),
      theme,
      hover: hoverRef.current,
    });
  }, [scene, xUnit, yUnit, chart, theme]);

  const schedule = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(draw);
  }, [draw]);

  useEffect(() => {
    viewRef.current = storedView;
    schedule();
  }, [storedView, schedule]);
  useEffect(schedule, [schedule]);

  // Canvas sizing.
  useEffect(() => {
    const el = containerRef.current;
    const canvas = canvasRef.current;
    if (!el || !canvas) return;
    rendererRef.current = new Renderer(canvas);
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      rendererRef.current?.resize(Math.max(100, width), Math.max(100, height));
      draw();
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- interaction ----
  const commitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const updateView = useCallback(
    (vp: Viewport, commitDelay = 180) => {
      viewRef.current = vp;
      schedule();
      clearTimeout(commitTimer.current);
      commitTimer.current = setTimeout(() => setView(chartId, vp), commitDelay);
    },
    [schedule, setView, chartId],
  );

  const probe = useMemo(
    () =>
      latestOnly(
        async (px: number, py: number, x: number, y: number) => ({ px, py, r: await engine.state(fluid, { a: chart.x, va: x, b: chart.y, vb: y }) }),
        ({ px, py, r }) => setReadout(hoverRef.current ? { px, py, state: r.ok ? r.state : null } : null),
      ),
    [fluid, chart],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const local = (e: { clientX: number; clientY: number }) => {
      const b = canvas.getBoundingClientRect();
      return { px: e.clientX - b.left, py: e.clientY - b.top };
    };
    const region = (px: number, py: number) => {
      const r = rendererRef.current!;
      if (px < MARGIN.left && py < r.height - MARGIN.bottom) return "y";
      if (py > r.height - MARGIN.bottom && px > MARGIN.left) return "x";
      return "plot";
    };

    const onWheel = (e: WheelEvent) => {
      const vp = viewRef.current;
      const r = rendererRef.current;
      if (!vp || !r) return;
      e.preventDefault();
      const { px, py } = local(e);
      const where = region(px, py);
      const factor = Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0018));
      const { x, y } = r.axes(vp);
      const next = { ...vp };
      if (where !== "y") [next.xMin, next.xMax] = x.zoomed(factor, px);
      if (where !== "x") [next.yMin, next.yMax] = y.zoomed(factor, py);
      updateView(next);
    };

    const pointers = new Map<number, { px: number; py: number }>();
    let drag: { px: number; py: number; vp: Viewport; moved: boolean } | null = null;
    let pinch: { d: number; vp: Viewport; mx: number; my: number } | null = null;

    const onDown = (e: PointerEvent) => {
      const vp = viewRef.current;
      if (!vp) return;
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, local(e));
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.px - b.px, a.py - b.py), vp, mx: (a.px + b.px) / 2, my: (a.py + b.py) / 2 };
        drag = null;
      } else {
        drag = { ...local(e), vp, moved: false };
      }
    };
    const onMove = (e: PointerEvent) => {
      const r = rendererRef.current;
      const pos = local(e);
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, pos);
      if (pinch && pointers.size === 2 && r) {
        const [a, b] = [...pointers.values()];
        const factor = pinch.d / Math.max(10, Math.hypot(a.px - b.px, a.py - b.py));
        const { x, y } = r.axes(pinch.vp);
        const next = { ...pinch.vp };
        [next.xMin, next.xMax] = x.zoomed(factor, pinch.mx);
        [next.yMin, next.yMax] = y.zoomed(factor, pinch.my);
        updateView(next);
        return;
      }
      if (drag && r) {
        const dx = pos.px - drag.px;
        const dy = pos.py - drag.py;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        if (drag.moved) {
          const { x, y } = r.axes(drag.vp);
          const next = { ...drag.vp };
          [next.xMin, next.xMax] = x.panned(dx);
          [next.yMin, next.yMax] = y.panned(dy);
          hoverRef.current = null;
          setReadout(null);
          updateView(next);
          return;
        }
      }
      // Hover readout.
      const vp = viewRef.current;
      if (!vp || !r || e.pointerType === "touch") return;
      if (region(pos.px, pos.py) !== "plot" || pos.px > r.width - MARGIN.right || pos.py < MARGIN.top) {
        hoverRef.current = null;
        setReadout(null);
        schedule();
        return;
      }
      hoverRef.current = pos;
      schedule();
      const { x, y } = r.axes(vp);
      probe(pos.px, pos.py, x.fromPx(pos.px), y.fromPx(pos.py));
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      const r = rendererRef.current;
      const vp = viewRef.current;
      if (drag && !drag.moved && r && vp && region(drag.px, drag.py) === "plot") {
        const { x, y } = r.axes(vp);
        const input = { a: chart.x, va: x.fromPx(drag.px), b: chart.y, vb: y.fromPx(drag.py) };
        const m = useStore.getState().mode;
        if (m === "explore") addPoint(input);
        else if (m === "process") addChain(input);
      }
      drag = null;
    };
    const onLeave = () => {
      hoverRef.current = null;
      setReadout(null);
      schedule();
    };
    const onDouble = () => setView(chartId, undefined);

    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("dblclick", onDouble);
    return () => {
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("dblclick", onDouble);
    };
  }, [updateView, schedule, probe, chart, chartId, addPoint, addChain, setView]);

  // ---- fit to overlay content ----
  const fit = useCallback(() => {
    const vp = viewRef.current;
    if (!vp) return;
    const pts: Float64Array[] = [];
    if (mode === "cycle" && data.cycle) data.cycle.states.forEach((s) => pts.push(statePoint(s.state)));
    if (mode === "process")
      data.chains.forEach((c) => {
        if (c.start) pts.push(statePoint(c.start));
        c.steps.forEach((s) => s.result && pts.push(statePoint(s.result.end)));
      });
    if (mode === "explore") data.points.forEach((p) => p.state && pts.push(statePoint(p.state)));
    const xs = pts.map((p) => curveValue(p, 0, chart.x)).filter(Number.isFinite);
    const ys = pts.map((p) => curveValue(p, 0, chart.y)).filter(Number.isFinite);
    if (xs.length < 2) return setView(chartId, undefined);
    const span = (v: number[], log: boolean): [number, number] => {
      const lo = Math.min(...v);
      const hi = Math.max(...v);
      if (log) {
        const pad = Math.max(0.12 * Math.log(hi / lo), 0.15);
        return [lo * Math.exp(-pad), hi * Math.exp(pad)];
      }
      const pad = Math.max(0.12 * (hi - lo), 1e-3 * Math.abs(hi) || 1);
      return [lo - pad, hi + pad];
    };
    const [xMin, xMax] = span(xs, chart.xLog);
    const [yMin, yMax] = span(ys, chart.yLog);
    setView(chartId, { ...vp, xMin, xMax, yMin, yMax });
  }, [mode, data, chart, chartId, setView]);

  // Auto-fit once when a new cycle is shown and it does not fit the current view.
  const fittedFor = useRef("");
  useEffect(() => {
    if (mode !== "cycle" || !data.cycle || !storedView) return;
    const key = `${cycleId}|${fluid}|${chartId}`;
    if (fittedFor.current === key) return;
    fittedFor.current = key;
    const inside = data.cycle.states.every((s) => {
      const p = statePoint(s.state);
      const x = curveValue(p, 0, chart.x);
      const y = curveValue(p, 0, chart.y);
      return x >= storedView.xMin && x <= storedView.xMax && y >= storedView.yMin && y <= storedView.yMax;
    });
    if (!inside) fit();
  }, [mode, data.cycle, storedView, cycleId, fluid, chartId, chart, fit]);

  const exportPng = () => {
    canvasRef.current?.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `thermoplot-${fluid}-${chart.id}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
  };

  const hint =
    mode === "explore" ? "Click to pin a state" : mode === "process" ? "Click to start a new process" : "Scroll to zoom · drag to pan";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-3 py-2">
        <div className="flex rounded-md bg-surface-2 p-0.5" role="tablist" aria-label="Chart type">
          {CHARTS.map((c) => (
            <button
              key={c.id}
              role="tab"
              aria-selected={c.id === chartId}
              title={c.title}
              onClick={() => setChart(c.id)}
              className={`rounded px-2.5 py-1 text-[13px] font-medium transition-colors ${
                c.id === chartId ? "bg-surface text-ink shadow-sm" : "text-ink-2 hover:text-ink"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {chart.families.map((f) => {
            const on = families.includes(f);
            return (
              <button
                key={f}
                onClick={() => toggleFamily(chartId, f)}
                aria-pressed={on}
                className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs transition-colors ${
                  on ? "border-line text-ink" : "border-transparent text-ink-3 hover:text-ink-2"
                }`}
              >
                <span
                  className="inline-block h-0.5 w-3 rounded"
                  style={{ background: on ? familyColor(theme, f) : "var(--border)", opacity: f === Prop.Q ? 0.8 : 1 }}
                />
                {FAMILY_NAMES[f]}
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <span className="mr-2 hidden text-[11px] text-ink-3 xl:inline">{iso.loading ? "computing…" : hint}</span>
          <ToolButton label="Fit to content" onClick={fit}>
            <Maximize2 size={15} />
          </ToolButton>
          <ToolButton label="Reset view (double-click chart)" onClick={() => setView(chartId, undefined)}>
            <RotateCcw size={15} />
          </ToolButton>
          <ToolButton label="Download PNG" onClick={exportPng}>
            <Download size={15} />
          </ToolButton>
        </div>
      </div>
      <div ref={containerRef} className="relative min-h-0 flex-1 touch-none select-none">
        <canvas ref={canvasRef} className="absolute inset-0 cursor-crosshair" aria-label={`${chart.title} chart for ${fluid}`} role="img" />
        {readout && <Readout {...readout} />}
      </div>
    </div>
  );
}

function ToolButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={label} aria-label={label} className="rounded-md p-1.5 text-ink-2 hover:bg-surface-2 hover:text-ink">
      {children}
    </button>
  );
}

function Readout({ px, py, state }: { px: number; py: number; state: ThermoState | null }) {
  const units = useStore((s) => s.units);
  const rows: [string, number, string][] = state
    ? [
        ["T", toDisplay(unitOf(units, "temperature"), state.T), unitOf(units, "temperature").label],
        ["p", toDisplay(unitOf(units, "pressure"), state.p), unitOf(units, "pressure").label],
        ["h", toDisplay(unitOf(units, "specific_energy"), state.h), unitOf(units, "specific_energy").label],
        ["s", toDisplay(unitOf(units, "specific_entropy"), state.s), unitOf(units, "specific_entropy").label],
        ["ρ", toDisplay(unitOf(units, "density"), state.rho), unitOf(units, "density").label],
      ]
    : [];
  if (state && Number.isFinite(state.Q)) rows.push(["x", state.Q, ""]);
  const flip = px > 320;
  return (
    <div
      className="pointer-events-none absolute z-10 min-w-40 rounded-lg border border-line bg-surface/95 px-3 py-2 text-xs shadow-lg backdrop-blur"
      style={{ left: flip ? undefined : px + 14, right: flip ? `calc(100% - ${px - 14}px)` : undefined, top: py + 14 }}
    >
      {state ? (
        <>
          <div className="mb-1 font-medium capitalize text-ink">{state.phase}</div>
          <table className="tabular">
            <tbody>
              {rows.map(([k, v, u]) => (
                <tr key={k}>
                  <td className="pr-2 text-ink-3">{k}</td>
                  <td className="pr-1 text-right font-mono text-ink">{formatNumber(v, 5)}</td>
                  <td className="text-ink-3">{u}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <div className="text-ink-3">No equilibrium state here</div>
      )}
    </div>
  );
}
