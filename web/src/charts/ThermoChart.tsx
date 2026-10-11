import { Download, Maximize2, MoreHorizontal, RotateCcw, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { engine, latestOnly } from "../engine/client";
import { curveValue, statePoint } from "../engine/curve";
import { ProcessKind, Prop, type ProcessSpec, type StateInput, type ThermoState, type Viewport } from "../engine/types";
import { useIsolines } from "../state/compute";
import { useData } from "../state/data";
import type { PointResult } from "../state/compute";
import { useStore } from "../state/store";
import { COORDINATES, stateValue } from "../units/properties";
import { formatNumber, toDisplay, unitOf } from "../units/units";
import { chartById, CHARTS, FAMILY_NAMES } from "./charts";
import { MARGIN, Renderer } from "./renderer";
import { buildScene, familyColor } from "./scene";
import { useChartTheme } from "./theme";
import { Select } from "../components/ui";
import { PROCESS_KINDS } from "../panels/ProcessPanel";

const axisTitle = (prop: Prop, unitLabel: string) => `${COORDINATES[prop].label}, ${COORDINATES[prop].symbol} [${unitLabel}]`;

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

export function ThermoChart({ resultsOpen, onToggleResults }: { resultsOpen: boolean; onToggleResults: () => void }) {
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
  const updatePoint = useStore((s) => s.updatePoint);
  const removePoint = useStore((s) => s.removePoint);
  const addChain = useStore((s) => s.addChain);
  const setMode = useStore((s) => s.setMode);
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
  const draggedMarkerRef = useRef<{ id: string; point: Float64Array; input?: StateInput } | null>(null);
  const linePreviewRef = useRef<Float64Array | null>(null);
  const viewRef = useRef<Viewport | undefined>(storedView);
  const hoverRef = useRef<{ px: number; py: number } | null>(null);
  const frame = useRef(0);
  const drawRef = useRef<() => void>(() => {});
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [linesOpen, setLinesOpen] = useState(false);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [drawKind, setDrawKind] = useState<ProcessKind | null>(null);
  const [readout, setReadout] = useState<{ px: number; py: number; state: ThermoState | null } | null>(null);
  const selectedPoint = data.points.find(({ point }) => point.id === selectedPointId);

  useEffect(() => {
    if (selectedPointId && !data.points.some(({ point, state }) => point.id === selectedPointId && state)) setSelectedPointId(null);
  }, [data.points, selectedPointId]);
  useEffect(() => {
    if (mode !== "explore") setDrawKind(null);
  }, [mode]);

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
    const preview = draggedMarkerRef.current;
    const previewLine = linePreviewRef.current;
    const frameScene = preview || previewLine
      ? {
          ...scene,
          markers: preview ? scene.markers.map((marker) => marker.id === preview.id ? { ...marker, point: preview.point } : marker) : scene.markers,
          lines: previewLine ? [...scene.lines, { data: previewLine, color: theme.accent, width: 2, dash: [4, 3] }] : scene.lines,
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

  const schedule = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(draw);
  }, [draw]);

  useEffect(() => {
    viewRef.current = storedView;
    schedule();
  }, [storedView, schedule]);
  useEffect(schedule, [schedule]);
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
    let pointDrag: { id: string; marker: (typeof scene.markers)[number]; moved: boolean; input?: StateInput; last: { px: number; py: number } } | null = null;
    let lineDrag: {
      kind: ProcessKind;
      startPoint: Float64Array;
      startInput: StateInput;
      startState?: ThermoState;
      startMarkerId?: string;
      start: { px: number; py: number };
      moved: boolean;
      endPoint?: Float64Array;
      endInput?: StateInput;
      endState?: ThermoState;
      endMarkerId?: string;
    } | null = null;
    let pinch: { d: number; vp: Viewport; mx: number; my: number } | null = null;
    const findPoint = (pos: { px: number; py: number }, vp: Viewport) => {
      const r = rendererRef.current;
      if (!r || mode === "cycle") return null;
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
        lineDrag = null;
        draggedMarkerRef.current = null;
        linePreviewRef.current = null;
      } else {
        const marker = findPoint(pos, vp);
        if (drawKind !== null && mode === "explore" && region(pos.px, pos.py) === "plot") {
          const snapped = marker ? null : rendererRef.current?.snapToLine(pos, scene, vp);
          const { x, y } = rendererRef.current!.axes(vp);
          const xValue = marker ? curveValue(marker.point, 0, chart.x) : snapped?.x ?? x.fromPx(pos.px);
          const yValue = marker ? curveValue(marker.point, 0, chart.y) : snapped?.y ?? y.fromPx(pos.py);
          const pointResult = marker?.id ? data.points.find(({ point }) => point.id === marker.id) : undefined;
          const startInput = pointResult?.point.input ?? { a: chart.x, va: xValue, b: chart.y, vb: yValue };
          const startPoint = marker?.point ?? pointFromCoordinates(chart.x, xValue, chart.y, yValue);
          lineDrag = {
            kind: drawKind,
            startPoint,
            startInput,
            startState: pointResult?.state ?? undefined,
            startMarkerId: marker?.id,
            start: pos,
            moved: false,
          };
          drag = null;
          pointDrag = null;
          linePreviewRef.current = null;
          setSelectedPointId(null);
          canvas.style.cursor = "grabbing";
        } else if (marker?.id) {
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
      if (lineDrag && r && viewRef.current) {
        if (Math.hypot(pos.px - lineDrag.start.px, pos.py - lineDrag.start.py) > 4) lineDrag.moved = true;
        if (lineDrag.moved) {
          const vp = viewRef.current;
          const px = Math.max(MARGIN.left, Math.min(r.width - MARGIN.right, pos.px));
          const py = Math.max(MARGIN.top, Math.min(r.height - MARGIN.bottom, pos.py));
          const marker = findPoint({ px, py }, vp);
          const existing = marker?.id && marker.id !== lineDrag.startMarkerId
            ? data.points.find(({ point }) => point.id === marker.id)
            : undefined;
          const snapped = existing ? null : r.snapToLine({ px, py }, scene, vp);
          const { x, y } = r.axes(vp);
          const xValue = existing ? curveValue(existing.state ? statePoint(existing.state) : marker!.point, 0, chart.x) : snapped?.x ?? x.fromPx(px);
          const yValue = existing ? curveValue(existing.state ? statePoint(existing.state) : marker!.point, 0, chart.y) : snapped?.y ?? y.fromPx(py);
          const endPoint = existing?.state
            ? statePoint(existing.state)
            : marker && existing
              ? marker.point
              : pointFromCoordinates(chart.x, xValue, chart.y, yValue);
          lineDrag.endPoint = endPoint;
          lineDrag.endInput = existing?.point.input ?? { a: chart.x, va: xValue, b: chart.y, vb: yValue };
          lineDrag.endState = existing?.state ?? undefined;
          lineDrag.endMarkerId = existing?.point.id;
          const path = new Float64Array(12);
          path.set(lineDrag.startPoint);
          path.set(endPoint, 6);
          linePreviewRef.current = path;
          canvas.style.cursor = existing ? "copy" : "crosshair";
          schedule();
        }
        return;
      }
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
          setReadout(null);
          updateView(next);
          return;
        }
      }
      // Hover readout.
      const vp = viewRef.current;
      if (!vp || !r) return;
      if (e.pointerType !== "touch") canvas.style.cursor = findPoint(pos, vp) ? "grab" : "crosshair";
      if (e.pointerType === "touch") return;
      if (region(pos.px, pos.py) !== "plot" || pos.px > r.width - MARGIN.right || pos.py < MARGIN.top) {
        hoverRef.current = null;
        setReadout(null);
        schedule();
        return;
      }
      const snapped = r.snapToLine(pos, scene, vp);
      const hoverPos = snapped ? { px: snapped.px, py: snapped.py } : pos;
      hoverRef.current = hoverPos;
      schedule();
      const { x, y } = r.axes(vp);
      probe(hoverPos.px, hoverPos.py, snapped?.x ?? x.fromPx(pos.px), snapped?.y ?? y.fromPx(pos.py));
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      const r = rendererRef.current;
      const vp = viewRef.current;
      if (lineDrag) {
        const completed = lineDrag;
        lineDrag = null;
        linePreviewRef.current = null;
        canvas.style.cursor = "crosshair";
        schedule();
        if (completed.moved && completed.endInput && completed.endPoint) {
          void (async () => {
            const startResult = completed.startState
              ? { ok: true as const, state: completed.startState }
              : await engine.state(fluid, completed.startInput);
            if (!startResult.ok) return;
            const endResult = completed.endState
              ? { ok: true as const, state: completed.endState }
              : await engine.state(fluid, completed.endInput!);
            if (!endResult.ok) return;

            const definition = PROCESS_KINDS.find(({ kind }) => kind === completed.kind);
            if (!definition) return;
            const startState = startResult.state;
            const desiredEnd = endResult.state;
            const candidates = definition.targets.filter((prop) =>
              Number.isFinite(stateValue(startState, prop)) && Number.isFinite(stateValue(desiredEnd, prop)),
            );
            const changesChartAxis = (prop: Prop) =>
              Math.abs(stateValue(desiredEnd, prop) - stateValue(startState, prop)) > Math.max(1e-9, Math.abs(stateValue(startState, prop)) * 1e-8);
            const target = candidates.find((prop) => (prop === chart.x || prop === chart.y) && changesChartAxis(prop))
              ?? candidates.find(changesChartAxis)
              ?? candidates[0];
            if (target === undefined) return;

            const efficiency = completed.kind === ProcessKind.Compression ? 0.8
              : completed.kind === ProcessKind.Expansion ? 0.85
              : undefined;
            const spec: ProcessSpec = {
              kind: completed.kind,
              target,
              value: stateValue(desiredEnd, target),
              ...(efficiency === undefined ? {} : { efficiency }),
            };
            const calculated = await engine.process(fluid, completed.startInput, spec);
            if (!calculated.ok) return;

            // A dropped endpoint on a pinned state only counts as a snap if the selected
            // process actually reaches that state in the current chart coordinates.
            if (completed.endMarkerId) {
              const actual = statePoint(calculated.end);
              const expected = statePoint(desiredEnd);
              const matches = (prop: Prop) => {
                const a = curveValue(actual, 0, prop);
                const b = curveValue(expected, 0, prop);
                return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= Math.max(1e-7, Math.abs(b) * 1e-5);
              };
              if (!matches(chart.x) || !matches(chart.y)) return;
            }
            addChain(completed.startInput, spec);
            setSelectedPointId(null);
            setMode("process");
          })().catch(() => {});
        }
        return;
      }
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
        if (clickTimer.current) clearTimeout(clickTimer.current);
        clickTimer.current = setTimeout(() => {
          const m = useStore.getState().mode;
          if (m === "explore") setSelectedPointId(addPoint(input));
          else if (m === "process") addChain(input);
          clickTimer.current = null;
        }, 500);
      }
      drag = null;
    };
    const onLeave = () => {
      hoverRef.current = null;
      setReadout(null);
      schedule();
    };
    const onDouble = (e: MouseEvent) => {
      e.preventDefault();
      if (clickTimer.current) clearTimeout(clickTimer.current);
      clickTimer.current = null;
      setView(chartId, undefined);
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
  }, [updateView, schedule, probe, chart, chartId, addPoint, addChain, updatePoint, setView, scene, mode, fluid, drawKind, data.points, setMode]);

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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 flex-nowrap items-center gap-2 border-b border-line px-3">
        <Select
          className="w-24"
          label="Chart type"
          value={chartId}
          onChange={setChart}
          options={CHARTS.map((c) => ({ value: c.id, label: c.label }))}
        />
        {mode === "explore" && (
          <Select
            className="w-36 shrink-0"
            label="Draw process line"
            value={drawKind ?? ""}
            onChange={(kind) => setDrawKind(kind === "" ? null : kind as ProcessKind)}
            options={[{ value: "" as const, label: "Draw line…" }, ...PROCESS_KINDS.map(({ kind, label }) => ({ value: kind, label }))]}
          />
        )}
        <div className="flex items-center gap-1">
          {families.includes(Prop.Q) && <span className="rounded-full bg-accent/10 px-2 py-1 text-xs font-medium text-accent">Quality</span>}
          <div className="relative">
            <ToolButton label="More chart options" onClick={() => setLinesOpen((open) => !open)}>
              <MoreHorizontal size={16} />
            </ToolButton>
            {linesOpen && (
              <div className="absolute left-0 top-9 z-20 w-52 rounded-lg border border-line bg-surface p-2 shadow-xl">
                {chart.families.map((f) => {
                  const on = families.includes(f);
                  return (
                    <button
                      key={f}
                      onClick={() => toggleFamily(chartId, f)}
                      aria-pressed={on}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-ink-2 hover:bg-surface-2"
                    >
                      <span
                        className="inline-block h-0.5 w-3 rounded"
                        style={{ background: on ? familyColor(theme, f) : "var(--border)", opacity: f === Prop.Q ? 0.8 : 1 }}
                      />
                      <span className="flex-1">{FAMILY_NAMES[f]}</span>
                      {on && <span aria-hidden>✓</span>}
                    </button>
                  );
                })}
                <div className="mt-1 border-t border-line pt-1">
                  <button
                    onClick={() => {
                      setView(chartId, undefined);
                      setLinesOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-ink-2 hover:bg-surface-2"
                  >
                    <RotateCcw size={14} /> Reset view
                  </button>
                  <button
                    onClick={() => {
                      fit();
                      setLinesOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-ink-2 hover:bg-surface-2"
                  >
                    <Maximize2 size={14} /> Fit to content
                  </button>
                  <label className="flex items-center justify-between px-2 py-1.5 text-xs text-ink-2" htmlFor="line-density">
                    Density
                    <select
                      id="line-density"
                      className="rounded border border-line bg-surface px-1.5 py-1"
                      value={density}
                      onChange={(e) => useStore.getState().setDensity(Number(e.target.value))}
                    >
                      {[6, 10, 16].map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>
                  <button
                    onClick={() => {
                      exportPng();
                      setLinesOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-ink-2 hover:bg-surface-2"
                  >
                    <Download size={14} /> Export PNG
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1">
          {iso.loading && <span className="mr-1 text-[11px] text-ink-3" aria-label="Computing isolines">···</span>}
          {mode !== "explore" && (
            <button onClick={onToggleResults} aria-expanded={resultsOpen} className={`rounded-md px-2.5 py-1.5 text-xs ${resultsOpen ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink"}`}>
              Results
            </button>
          )}
        </div>
      </div>
      <div ref={containerRef} className="relative min-h-0 flex-1 touch-none select-none">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 cursor-crosshair"
          aria-label={`${chart.title} chart for ${fluid}`}
          title={drawKind ? `Drag to draw a ${PROCESS_KINDS.find(({ kind }) => kind === drawKind)?.label ?? "process"} · endpoints snap to states` : "Drag a point to move it · click to add a state · double-click to reset view"}
          role="img"
        />
        {selectedPoint?.state && (
          <SelectedPointCard
            point={selectedPoint}
            onClose={() => setSelectedPointId(null)}
            onRemove={() => {
              removePoint(selectedPoint.point.id);
              setSelectedPointId(null);
            }}
          />
        )}
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

function SelectedPointCard({ point, onClose, onRemove }: { point: PointResult; onClose: () => void; onRemove: () => void }) {
  const units = useStore((s) => s.units);
  const state = point.state!;
  const fields = [
    ["Temperature", state.T, "temperature"],
    ["Pressure", state.p, "pressure"],
    ["Enthalpy", state.h, "specific_energy"],
    ["Entropy", state.s, "specific_entropy"],
    ["Density", state.rho, "density"],
  ] as const;
  return (
    <section className="absolute left-[76px] top-3 z-10 w-72 max-w-[calc(100%-88px)] rounded-xl border border-line bg-surface/95 p-3 shadow-xl backdrop-blur" aria-label={`State ${point.point.label}`}>
      <div className="mb-2 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-ink">State {point.point.label}</div>
          <div className="text-xs capitalize text-ink-3">{state.phase}</div>
        </div>
        <button onClick={onRemove} title="Remove state" aria-label="Remove state" className="rounded p-1 text-ink-3 hover:bg-surface-2 hover:text-danger"><Trash2 size={14} /></button>
        <button onClick={onClose} title="Close state details" aria-label="Close state details" className="rounded p-1 text-ink-3 hover:bg-surface-2 hover:text-ink"><X size={14} /></button>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        {fields.map(([label, value, quantity]) => {
          const unit = unitOf(units, quantity);
          return (
            <div key={label}>
              <div className="text-xs text-ink-3">{label}</div>
              <div className="tabular text-ink">{formatNumber(toDisplay(unit, value), 4)} <span className="text-ink-3">{unit.label}</span></div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 border-t border-line pt-2 text-xs text-ink-3">Drag the point on the graph to move it.</div>
    </section>
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
