import { Download, Eraser, Maximize2, X } from "lucide-react";
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { engine } from "../engine/client";
import { curveValue, statePoint } from "../engine/curve";
import { Prop, type StateInput, type Viewport } from "../engine/types";
import { computePointState, useIsolines } from "../state/compute";
import { useData } from "../state/data";
import type { PointResult } from "../state/compute";
import { useStore } from "../state/store";
import { COORDINATES, stateValue } from "../units/properties";
import { formatNumber, fromDisplay, toDisplay, unitOf } from "../units/units";
import { chartById, CHARTS, FAMILY_NAMES } from "./charts";
import { MARGIN, Renderer } from "./renderer";
import { buildScene, familyColor } from "./scene";
import { useChartTheme } from "./theme";
import { Select } from "../components/ui";
import { FluidPicker } from "../components/FluidPicker";
import { UnitsMenu } from "../components/Header";

const axisTitle = (prop: Prop, unitLabel: string) => `${COORDINATES[prop].label}, ${COORDINATES[prop].symbol} [${unitLabel}]`;
const valuesPanelClass = "absolute right-6 top-5 z-10 w-64 max-w-[calc(100%-2rem)] rounded-xl border border-line bg-surface/95 p-3 shadow-xl backdrop-blur";

function setCoordinate(point: Float64Array, prop: Prop, value: number) {
  switch (prop) {
    case Prop.T: point[0] = value; break;
    case Prop.P: point[1] = value; break;
    case Prop.D: point[2] = value; break;
    case Prop.V: point[2] = 1 / value; break;
    case Prop.H: point[3] = value; break;
    case Prop.S: point[4] = value; break;
    case Prop.Q: point[5] = value; break;
  }
}

function pointFromCoordinates(xProp: Prop, xValue: number, yProp: Prop, yValue: number, base?: Float64Array) {
  const point = base?.slice() ?? new Float64Array(6);
  setCoordinate(point, xProp, xValue);
  setCoordinate(point, yProp, yValue);
  return point;
}

export function ThermoChart() {
  const fluid = useStore((s) => s.fluid);
  const chartId = useStore((s) => s.chartId);
  const setChart = useStore((s) => s.setChart);
  const views = useStore((s) => s.views);
  const setView = useStore((s) => s.setView);
  const familiesByChart = useStore((s) => s.families);
  const toggleFamily = useStore((s) => s.toggleFamily);
  const units = useStore((s) => s.units);
  const mode = useStore((s) => s.mode);
  const statePoints = useStore((s) => s.points);
  const addPoint = useStore((s) => s.addPoint);
  const clearPoints = useStore((s) => s.clearPoints);
  const updatePoint = useStore((s) => s.updatePoint);
  const removePoint = useStore((s) => s.removePoint);
  const cycleId = useStore((s) => s.cycleId);
  const selectedPointId = useStore((s) => s.selectedPointId);
  const setSelectedPointId = useStore((s) => s.setSelectedPoint);

  const chart = chartById(chartId);
  const data = useData();
  const theme = useChartTheme();
  const storedView = views[chartId];
  const families = (familiesByChart[chartId] ?? []).filter((f) => chart.families.includes(f));
  const iso = useIsolines(fluid, storedView, families, units);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const draggedMarkerRef = useRef<{ id: string; point: Float64Array; input?: StateInput } | null>(null);
  const pendingPointsRef = useRef(new Map<string, { point: Float64Array; label: string }>());
  const viewRef = useRef<Viewport | undefined>(storedView);
  const hoverRef = useRef<{ px: number; py: number } | null>(null);
  const frame = useRef(0);
  const drawRef = useRef<() => void>(() => {});
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedPointCardRef = useRef<HTMLElement | null>(null);
  const [readout, setReadout] = useState<{ x: number; y: number; line?: { label: string; color: string } } | null>(null);
  const [hoveredPointId, setHoveredPointId] = useState<string | null>(null);
  const selectedPoint = data.points.find(({ point }) => point.id === selectedPointId);
  const selectedPointRecord = statePoints.find((point) => point.id === selectedPointId);
  const selectedPointForCard = selectedPoint ?? (selectedPointRecord ? { point: selectedPointRecord, state: null } : undefined);
  const hoveredPoint = data.points.find(({ point }) => point.id === hoveredPointId);
  const schedule = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(() => drawRef.current());
  }, []);

  useEffect(() => {
    if (selectedPointId && !data.points.some(({ point }) => point.id === selectedPointId) && !statePoints.some((point) => point.id === selectedPointId)) {
      setSelectedPointId(null);
    }
  }, [data.points, selectedPointId, setSelectedPointId, statePoints]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select, [contenteditable='true'], [role='textbox']"))) return;
      if (!selectedPointId || !data.points.some(({ point }) => point.id === selectedPointId)) return;
      event.preventDefault();
      removePoint(selectedPointId);
      pendingPointsRef.current.delete(selectedPointId);
      if (draggedMarkerRef.current?.id === selectedPointId) draggedMarkerRef.current = null;
      schedule();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [data.points, removePoint, schedule, selectedPointId]);
  useEffect(() => {
    if (!selectedPoint?.state) return;
    const card = selectedPointCardRef.current;
    card?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    card?.focus({ preventScroll: true });
  }, [selectedPoint?.point.id]);
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
        cycle: data.cycle,
        exampleSnapshot: data.exampleSnapshot,
        showOverlays: { points: true, chains: true, cycle: true },
      }),
    [theme, units, data, iso.data],
  );

  const xUnit = unitOf(units, COORDINATES[chart.x].quantity);
  const yUnit = unitOf(units, COORDINATES[chart.y].quantity);

  const draw = useCallback(() => {
    frame.current = 0;
    const r = rendererRef.current;
    const vp = viewRef.current;
    if (!r || !vp) return;
    const preview = draggedMarkerRef.current;
    const pendingPoints = pendingPointsRef.current;
    const frameScene = preview || pendingPoints.size > 0
      ? {
          ...scene,
          markers: [
            ...(preview ? scene.markers.map((marker) => marker.id === preview.id ? { ...marker, point: preview.point } : marker) : scene.markers),
            ...[...pendingPoints].flatMap(([id, pending]) => scene.markers.some((marker) => marker.id === id)
              ? []
              : [{ id, point: pending.point, color: theme.accent, label: pending.label }]),
          ],
          lines: [
            ...scene.lines.map((line) => {
              if (!preview || !line.snapshotPointIds?.includes(preview.id)) return line;
              const marker = scene.markers.find((candidate) => candidate.id === preview.id);
              if (!marker) return line;
              const vertexCount = line.data.length / 6;
              if (vertexCount < 2) return line;
              const movedFrom = line.snapshotPointIds[0] === preview.id;
              const data = line.data.slice();
              for (let vertex = 0; vertex < vertexCount; vertex++) {
                const t = vertex / (vertexCount - 1);
                const weight = movedFrom ? 1 - t : t;
                const point = data.subarray(vertex * 6, vertex * 6 + 6);
                for (const prop of [chart.x, chart.y]) {
                  const oldValue = curveValue(marker.point, 0, prop);
                  const newValue = curveValue(preview.point, 0, prop);
                  const pathValue = curveValue(data, vertex, prop);
                  if (Number.isFinite(pathValue) && Number.isFinite(oldValue) && Number.isFinite(newValue)) {
                    setCoordinate(point, prop, pathValue + weight * (newValue - oldValue));
                  }
                }
              }
              return { ...line, data };
            }),
          ],
        }
      : scene;
    r.render({
      scene: frameScene,
      view: vp,
      xUnit,
      yUnit,
      xTitle: axisTitle(chart.x, xUnit.label),
      yTitle: axisTitle(chart.y, yUnit.label),
      theme,
      hover: hoverRef.current,
    });
  }, [scene, xUnit, yUnit, chart, theme]);
  drawRef.current = draw;

  useEffect(() => {
    viewRef.current = storedView;
    schedule();
  }, [storedView, schedule]);
  useEffect(() => schedule(), [draw, schedule]);
  useEffect(() => {
    const preview = draggedMarkerRef.current;
    if (!preview?.input) return;
    const updated = data.points.some(({ point }) =>
      point.id === preview.id &&
      point.input.a === preview.input!.a && point.input.va === preview.input!.va &&
      point.input.b === preview.input!.b && point.input.vb === preview.input!.vb,
    );
    if (updated) {
      draggedMarkerRef.current = null;
      schedule();
    }
  }, [data.points, schedule]);
  useEffect(() => {
    let changed = false;
    const dataPointIds = new Set(data.points.map(({ point }) => point.id));
    const storedPointIds = new Set(statePoints.map((point) => point.id));
    for (const { point } of data.points) {
      changed = pendingPointsRef.current.delete(point.id) || changed;
    }
    for (const id of pendingPointsRef.current.keys()) {
      if (!storedPointIds.has(id)) changed = pendingPointsRef.current.delete(id) || changed;
    }
    const preview = draggedMarkerRef.current;
    if (preview && !dataPointIds.has(preview.id) && !storedPointIds.has(preview.id)) {
      draggedMarkerRef.current = null;
      changed = true;
    }
    if (changed) {
      schedule();
    }
  }, [data.points, schedule, statePoints]);

  // Canvas sizing.
  useEffect(() => {
    const el = containerRef.current;
    const canvas = canvasRef.current;
    if (!el || !canvas) return;
    rendererRef.current = new Renderer(canvas);
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      rendererRef.current?.resize(Math.max(100, width), Math.max(100, height));
      drawRef.current();
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
    let recentClickActions: string[] = [];
    let drag: { px: number; py: number; vp: Viewport; moved: boolean } | null = null;
    let pointDrag: { id: string; marker: (typeof scene.markers)[number]; moved: boolean; input?: StateInput; last: { px: number; py: number } } | null = null;
    let pinch: { d: number; vp: Viewport; mx: number; my: number } | null = null;
    const findPoint = (pos: { px: number; py: number }, vp: Viewport) => {
      const r = rendererRef.current;
      if (!r) return null;
      const { x, y } = r.axes(vp);
      let closest: { marker: (typeof scene.markers)[number]; distance: number } | null = null;
      for (const marker of scene.markers) {
        if (!marker.id) continue;
        const px = x.toPx(curveValue(marker.point, 0, chart.x));
        const py = y.toPx(curveValue(marker.point, 0, chart.y));
        const distance = Math.hypot(pos.px - px, pos.py - py);
        if (distance <= 14 && (!closest || distance < closest.distance)) closest = { marker, distance };
      }
      return closest?.marker ?? null;
    };

    const onDown = (e: PointerEvent) => {
      const vp = viewRef.current;
      if (!vp) return;
      if (clickTimer.current) {
        clearTimeout(clickTimer.current);
        clickTimer.current = null;
      }
      canvas.setPointerCapture(e.pointerId);
      const pos = local(e);
      pointers.set(e.pointerId, pos);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.px - b.px, a.py - b.py), vp, mx: (a.px + b.px) / 2, my: (a.py + b.py) / 2 };
        drag = null;
        pointDrag = null;
        draggedMarkerRef.current = null;
      } else {
        const marker = findPoint(pos, vp);
        if (marker?.id) {
          pointDrag = { id: marker.id, marker, moved: false, last: pos };
          drag = null;
          canvas.style.cursor = "grabbing";
        } else {
          setSelectedPointId(null);
          pointDrag = null;
          drag = { ...pos, vp, moved: false };
        }
      }
    };
    const onMove = (e: PointerEvent) => {
      const r = rendererRef.current;
      const pos = local(e);
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, pos);
      if (pointDrag && r && viewRef.current) {
        const dx = pos.px - pointDrag.last.px;
        const dy = pos.py - pointDrag.last.py;
        pointDrag.last = pos;
        if (Math.abs(dx) + Math.abs(dy) > 1) pointDrag.moved = true;
        if (pointDrag.moved) {
          const { x, y } = r.axes(viewRef.current);
          const px = Math.max(MARGIN.left, Math.min(r.width - MARGIN.right, pos.px));
          const py = Math.max(MARGIN.top, Math.min(r.height - MARGIN.bottom, pos.py));
          const snapped = r.snapToLine({ px, py }, scene, viewRef.current);
          const xValue = snapped?.x ?? x.fromPx(px);
          const yValue = snapped?.y ?? y.fromPx(py);
          const preview = pointDrag.marker.point.slice();
          setCoordinate(preview, chart.x, xValue);
          setCoordinate(preview, chart.y, yValue);
          pointDrag.input = { a: chart.x, va: xValue, b: chart.y, vb: yValue };
          draggedMarkerRef.current = { id: pointDrag.id, point: preview, input: pointDrag.input };
          setHoveredPointId(null);
          hoverRef.current = null;
          setReadout(null);
          schedule();
        }
        return;
      }
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
          setHoveredPointId(null);
          setReadout(null);
          updateView(next);
          return;
        }
      }
      // Hover readout.
      const vp = viewRef.current;
      if (!vp || !r) return;
      const marker = e.pointerType === "touch" ? null : findPoint(pos, vp);
      if (e.pointerType !== "touch") canvas.style.cursor = marker ? "grab" : "crosshair";
      if (e.pointerType === "touch") {
        setHoveredPointId(null);
        return;
      }
      if (region(pos.px, pos.py) !== "plot" || pos.px > r.width - MARGIN.right || pos.py < MARGIN.top) {
        setHoveredPointId(null);
        hoverRef.current = null;
        setReadout(null);
        schedule();
        return;
      }
      setHoveredPointId(marker?.id ?? null);
      const { x, y } = r.axes(vp);
      const snapped = r.snapToLine(pos, scene, vp);
      const line = snapped?.label && snapped.labelColor ? { label: snapped.label, color: snapped.labelColor } : undefined;
      const xValue = snapped?.x ?? x.fromPx(pos.px);
      const yValue = snapped?.y ?? y.fromPx(pos.py);
      hoverRef.current = snapped ? { px: snapped.px, py: snapped.py } : pos;
      setReadout({
        x: xValue,
        y: yValue,
        line,
      });
      schedule();
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      const r = rendererRef.current;
      const vp = viewRef.current;
      if (pointDrag) {
        const completed = pointDrag;
        pointDrag = null;
        canvas.style.cursor = "crosshair";
        setSelectedPointId(completed.id);
        if (completed.moved && completed.input) {
          void engine.state(fluid, completed.input).then((result) => {
            if (result.ok) updatePoint(completed.id, { input: completed.input });
            else if (draggedMarkerRef.current?.id === completed.id) {
              draggedMarkerRef.current = null;
              schedule();
            }
          }).catch(() => {
            if (draggedMarkerRef.current?.id === completed.id) {
              draggedMarkerRef.current = null;
              schedule();
            }
          });
        } else {
          draggedMarkerRef.current = null;
          schedule();
        }
        drag = null;
        return;
      }
      if (drag && !drag.moved && r && vp && region(drag.px, drag.py) === "plot") {
        const pos = { px: drag.px, py: drag.py };
        const snapped = r.snapToLine(pos, scene, vp);
        const { x, y } = r.axes(vp);
        const input = { a: chart.x, va: snapped?.x ?? x.fromPx(pos.px), b: chart.y, vb: snapped?.y ?? y.fromPx(pos.py) };
        const id = addPoint(input);
        const point = useStore.getState().points.find((candidate) => candidate.id === id);
        if (point) {
          pendingPointsRef.current.set(id, {
            point: pointFromCoordinates(chart.x, input.va, chart.y, input.vb),
            label: point.label,
          });
        }
        setHoveredPointId(null);
        hoverRef.current = null;
        setReadout(null);
        setSelectedPointId(id);
        recentClickActions.push(id);
        schedule();
        if (clickTimer.current) clearTimeout(clickTimer.current);
        clickTimer.current = setTimeout(() => {
          recentClickActions = [];
          clickTimer.current = null;
        }, 500);
      }
      drag = null;
    };
    const onLeave = () => {
      hoverRef.current = null;
      setHoveredPointId(null);
      setReadout(null);
      schedule();
    };
    const onDouble = (e: MouseEvent) => {
      e.preventDefault();
      if (clickTimer.current) clearTimeout(clickTimer.current);
      clickTimer.current = null;
      for (const id of recentClickActions) {
        removePoint(id);
        pendingPointsRef.current.delete(id);
        if (draggedMarkerRef.current?.id === id) draggedMarkerRef.current = null;
      }
      recentClickActions = [];
      setSelectedPointId(null);
      setView(chartId, undefined);
      schedule();
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("dblclick", onDouble);
    return () => {
      if (clickTimer.current) clearTimeout(clickTimer.current);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("dblclick", onDouble);
    };
  }, [updateView, schedule, chart, chartId, addPoint, updatePoint, removePoint, setView, scene, mode, fluid, data.points]);

  // ---- fit to overlay content ----
  const fit = useCallback(() => {
    const vp = viewRef.current;
    if (!vp) return;
    const pts: Float64Array[] = [];
    if (data.saturation) {
      for (let offset = 0; offset < data.saturation.dome.length; offset += 6) {
        pts.push(data.saturation.dome.subarray(offset, offset + 6));
      }
    }
    if (data.cycle) data.cycle.states.forEach((s) => pts.push(statePoint(s.state)));
    data.chains.forEach((c) => {
      if (c.start) pts.push(statePoint(c.start));
      c.steps.forEach((s) => {
        if (s.result) pts.push(statePoint(s.result.start), statePoint(s.result.end));
      });
    });
    data.points.forEach((p) => p.state && pts.push(statePoint(p.state)));
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

  useEffect(() => {
    const snapshot = data.exampleSnapshot;
    if (!snapshot || !storedView) return;
    const ids = Object.values(snapshot.pointIds);
    if (!ids.length || ids.some((id) => !data.points.some((point) => point.point.id === id && point.state))) return;
    const key = `snapshot:${snapshot.id}:${fluid}:${chartId}`;
    if (fittedFor.current === key) return;
    fittedFor.current = key;
    fit();
  }, [data.exampleSnapshot, data.points, storedView, fluid, chartId, fit]);

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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-line px-3 py-1.5">
        <FluidPicker />
        <Select
          className="w-24"
          label="Chart type"
          value={chartId}
          onChange={setChart}
          options={CHARTS.map((c) => ({ value: c.id, label: c.label }))}
        />
        <span aria-hidden className="hidden h-5 w-px bg-line sm:block" />
        <div className="flex flex-wrap items-center gap-0.5" role="group" aria-label="Isoline families">
          {chart.families.map((f) => {
            const on = families.includes(f);
            return (
              <button
                key={f}
                onClick={() => toggleFamily(chartId, f)}
                aria-label={`Toggle ${FAMILY_NAMES[f]}`}
                aria-pressed={on}
                className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[13px] transition-colors ${on ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface-2"}`}
              >
                <span
                  className="inline-block h-0.5 w-3 rounded"
                  style={{ background: on ? familyColor(theme, f) : "var(--border)", opacity: f === Prop.Q ? 0.8 : 1 }}
                />
                <span>{FAMILY_NAMES[f]}</span>
                <span className="w-3 text-center text-ink-2" aria-hidden>{on ? "✓" : ""}</span>
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-x-1 gap-y-1 border-l border-line pl-2">
          <button
            onClick={() => {
              clearPoints();
              pendingPointsRef.current.clear();
              draggedMarkerRef.current = null;
              schedule();
            }}
            title="Clear all points"
            aria-label="Clear all points"
            disabled={statePoints.length === 0}
            className="rounded-md p-1.5 text-ink-2 hover:bg-surface-2 hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <Eraser size={16} />
          </button>
          <button
            onClick={fit}
            title="Fit to content"
            aria-label="Fit to content"
            className="rounded-md p-1.5 text-ink-2 hover:bg-surface-2 hover:text-ink"
          >
            <Maximize2 size={16} />
          </button>
          <button
            onClick={exportPng}
            title="Export PNG"
            aria-label="Export PNG"
            className="rounded-md p-1.5 text-ink-2 hover:bg-surface-2 hover:text-ink"
          >
            <Download size={16} />
          </button>
          <UnitsMenu />
        </div>
        {iso.loading && <span className="text-[11px] text-ink-3" aria-label="Computing isolines">···</span>}
      </div>
      <div ref={containerRef} className="relative min-h-0 flex-1 select-none">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 touch-none cursor-crosshair"
          aria-label={`${chart.title} chart for ${fluid}`}
          role="img"
        />
        {hoveredPoint?.state ? (
          <Readout x={0} y={0} chart={chart} point={hoveredPoint} />
        ) : readout?.line ? (
          <Readout {...readout} chart={chart} />
        ) : selectedPointForCard ? (
          <SelectedPointCard
            cardRef={selectedPointCardRef}
            point={selectedPointForCard}
            chart={chart}
            fluid={fluid}
            onClose={() => setSelectedPointId(null)}
          />
        ) : readout ? <Readout {...readout} chart={chart} /> : null}
      </div>
    </div>
  );
}

function SelectedPointCard({ cardRef, point, chart, fluid, onClose }: {
  cardRef: React.RefObject<HTMLElement | null>;
  point: PointResult;
  chart: ReturnType<typeof chartById>;
  fluid: string;
  onClose: () => void;
}) {
  const units = useStore((s) => s.units);
  const updatePoint = useStore((s) => s.updatePoint);
  const state = point.state!;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!point.state) {
    return (
      <ValueBox ref={cardRef} title={`State ${point.point.label}`} ariaLabel={`State ${point.point.label}`} onClose={onClose} interactive>
        <div className="py-1.5 text-xs text-ink-3">Calculating state…</div>
      </ValueBox>
    );
  }
  const baseFields: Prop[] = [Prop.T, Prop.P, Prop.H, Prop.S, Prop.D, Prop.Q];
  const fields = [...baseFields, ...[chart.x, chart.y].filter((prop) => !baseFields.includes(prop))];
  const commitValue = async (prop: Prop, displayValue: number) => {
    const unit = unitOf(units, COORDINATES[prop].quantity);
    const value = fromDisplay(unit, displayValue);
    const anchor = prop === chart.x ? chart.y : prop === chart.y ? chart.x : chart.x;
    const input: StateInput = { a: anchor, va: stateValue(state, anchor), b: prop, vb: value };
    setSaving(true);
    setError(null);
    try {
      const result = await computePointState(fluid, input);
      if (!result.state) {
        setError(result.error ?? "Could not calculate that state.");
        return false;
      }
      updatePoint(point.point.id, { input });
      return true;
    } catch {
      setError("Could not calculate that state.");
      return false;
    } finally {
      setSaving(false);
    }
  };
  return (
    <ValueBox ref={cardRef} title={`State ${point.point.label}`} ariaLabel={`State ${point.point.label}`} onClose={onClose} interactive>
        {fields.map((prop) => {
          const label = COORDINATES[prop].label;
          const unit = unitOf(units, COORDINATES[prop].quantity);
          const rawValue = stateValue(state, prop);
          const available = prop !== Prop.Q || (Number.isFinite(rawValue) && rawValue >= 0 && rawValue <= 1);
          const displayValue = available ? toDisplay(unit, rawValue) : null;
          return (
            <ValueRow key={label} label={label} unit={unit.label}>
              {displayValue === null ? <span className="w-[9ch] text-right font-mono text-ink-3">—</span> : (
                <InlineEditableValue label={label} value={displayValue} disabled={saving || prop === Prop.Q && !available} onCommit={(next) => commitValue(prop, next)} />
              )}
            </ValueRow>
          );
        })}
      {error && <div role="status" className="mt-2 text-xs text-danger">{error}</div>}
      {saving && <div role="status" className="mt-2 text-xs text-ink-3">Updating point…</div>}
    </ValueBox>
  );
}

interface ValueBoxProps {
  title?: string;
  titleColor?: string;
  ariaLabel: string;
  onClose?: () => void;
  interactive?: boolean;
  children?: ReactNode;
}

const ValueBox = forwardRef<HTMLElement, ValueBoxProps>(function ValueBox({
  title,
  titleColor,
  ariaLabel,
  onClose,
  interactive = false,
  children,
}, ref) {
  return (
    <section ref={ref} tabIndex={onClose ? -1 : undefined} className={`${interactive ? "pointer-events-auto" : "pointer-events-none"} ${valuesPanelClass} max-h-[calc(100%-2.5rem)] overflow-y-auto text-xs ${onClose ? "select-text outline-none" : ""}`} aria-label={ariaLabel}>
      {(title || onClose) && (
        <div className="flex items-start gap-2">
          {title && <div className="min-w-0 flex-1 font-medium text-ink" style={titleColor ? { color: titleColor } : undefined}>{title}</div>}
          {onClose && <button onClick={onClose} title="Close state details" aria-label="Close state details" className="rounded p-1 text-ink-3 hover:bg-surface-2 hover:text-ink"><X size={14} /></button>}
        </div>
      )}
      {children != null && <div className="mt-2 flex flex-col">{children}</div>}
    </section>
  );
});

function ValueRow({ label, unit, children }: { label: string; unit: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(9ch,1fr)_max-content] items-baseline gap-1 py-1.5 first:pt-0 last:pb-0">
      <div className="min-w-0 truncate text-xs text-ink-3">{label}</div>
      <div className="flex min-w-0 w-full justify-end tabular text-right text-ink">{children}</div>
      <div className="whitespace-nowrap text-left text-ink-3">{unit}</div>
    </div>
  );
}

function InlineEditableValue({ label, value, disabled, onCommit }: {
  label: string;
  value: number;
  disabled: boolean;
  onCommit: (value: number) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const skipBlurRef = useRef(false);
  const commit = async () => {
    if (!editing || disabled) return;
    const next = Number(draft);
    setEditing(false);
    if (draft.trim() && Number.isFinite(next)) await onCommit(next);
  };

  if (editing) {
    return (
      <span className="inline-flex w-[9ch] shrink-0">
        <input
          autoFocus
          aria-label={`Edit ${label} value`}
          inputMode="decimal"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            if (skipBlurRef.current) {
              skipBlurRef.current = false;
              return;
            }
            void commit();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              skipBlurRef.current = true;
              event.currentTarget.blur();
              setEditing(false);
            }
          }}
          className="w-full border-0 bg-transparent p-0 text-right font-mono text-ink outline-none focus-visible:underline focus-visible:decoration-accent"
        />
      </span>
    );
  }

  return (
    <span className="inline-flex w-[9ch] shrink-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setDraft(formatNumber(value, 4));
          setEditing(true);
        }}
        className="w-full cursor-text rounded-sm bg-transparent px-0.5 text-right font-mono text-ink hover:bg-accent/5 hover:text-accent disabled:cursor-wait"
        aria-label={`Edit ${label}`}
      >
        {formatNumber(value, 4)}
      </button>
    </span>
  );
}

function Readout({ x, y, chart, line, point }: {
  x: number;
  y: number;
  chart: ReturnType<typeof chartById>;
  line?: { label: string; color: string };
  point?: PointResult;
}) {
  const units = useStore((s) => s.units);
  if (point?.state) {
    const fields: Prop[] = [Prop.T, Prop.P, Prop.H, Prop.S, Prop.D, Prop.Q];
    return (
      <ValueBox title={`State ${point.point.label}`} ariaLabel={`State ${point.point.label}`}>
        {fields.map((prop) => {
          const meta = COORDINATES[prop];
          const unit = unitOf(units, meta.quantity);
          const rawValue = stateValue(point.state!, prop);
          const value = prop !== Prop.Q || (Number.isFinite(rawValue) && rawValue >= 0 && rawValue <= 1)
            ? formatNumber(toDisplay(unit, rawValue), 4)
            : "—";
          return <ValueRow key={prop} label={meta.label} unit={value === "—" ? "" : unit.label}><span className="w-[9ch] text-right font-mono text-ink">{value}</span></ValueRow>;
        })}
      </ValueBox>
    );
  }
  const xUnit = unitOf(units, COORDINATES[chart.x].quantity);
  const yUnit = unitOf(units, COORDINATES[chart.y].quantity);
  const rows: [string, number, string][] = [
    [COORDINATES[chart.x].label, toDisplay(xUnit, x), xUnit.label],
    [COORDINATES[chart.y].label, toDisplay(yUnit, y), yUnit.label],
  ];
  return (
    <ValueBox title={line?.label} titleColor={line?.color} ariaLabel={line ? `Cursor coordinates on ${line.label}` : "Cursor coordinates"}>
      {rows.map(([label, value, unit]) => (
        <ValueRow key={label} label={label} unit={unit}><span className="w-[9ch] text-right font-mono text-ink">{formatNumber(value, 5)}</span></ValueRow>
      ))}
    </ValueBox>
  );
}
