import { Download, Maximize2, RotateCcw, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { engine } from "../engine/client";
import { curveValue, statePoint } from "../engine/curve";
import { ProcessKind, Prop, type ProcessSpec, type StateInput, type ThermoState, type Viewport } from "../engine/types";
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
  const removeChain = useStore((s) => s.removeChain);
  const addChain = useStore((s) => s.addChain);
  const cycleId = useStore((s) => s.cycleId);
  const selectedPointId = useStore((s) => s.selectedPointId);
  const setSelectedPointId = useStore((s) => s.setSelectedPoint);

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
  const pendingPointsRef = useRef(new Map<string, { point: Float64Array; label: string }>());
  const linePreviewRef = useRef<Float64Array | null>(null);
  const viewRef = useRef<Viewport | undefined>(storedView);
  const hoverRef = useRef<{ px: number; py: number } | null>(null);
  const frame = useRef(0);
  const drawRef = useRef<() => void>(() => {});
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedPointCardRef = useRef<HTMLElement | null>(null);
  const [drawKind, setDrawKind] = useState<ProcessKind | null>(null);
  const [readout, setReadout] = useState<{ x: number; y: number; line?: { label: string; color: string } } | null>(null);
  const selectedPoint = data.points.find(({ point }) => point.id === selectedPointId);

  useEffect(() => {
    if (selectedPointId && !data.points.some(({ point }) => point.id === selectedPointId)) setSelectedPointId(null);
  }, [data.points, selectedPointId]);
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
    const previewLine = linePreviewRef.current;
    const pendingPoints = pendingPointsRef.current;
    const frameScene = preview || previewLine || pendingPoints.size > 0
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
            ...(previewLine ? [{ data: previewLine, color: theme.accent, width: 2, dash: [4, 3] }] : []),
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
  useEffect(() => {
    let changed = false;
    for (const { point } of data.points) {
      changed = pendingPointsRef.current.delete(point.id) || changed;
    }
    if (changed) {
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
    let recentClickActions: Array<{ kind: "point" | "chain"; id: string }> = [];
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
        lineDrag = null;
        draggedMarkerRef.current = null;
        linePreviewRef.current = null;
      } else {
        const marker = findPoint(pos, vp);
        if (drawKind !== null && region(pos.px, pos.py) === "plot") {
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
      const { x, y } = r.axes(vp);
      const snapped = r.snapToLine(pos, scene, vp);
      const hoverPos = snapped ? { px: snapped.px, py: snapped.py } : pos;
      const xValue = snapped?.x ?? x.fromPx(pos.px);
      const yValue = snapped?.y ?? y.fromPx(pos.py);
      hoverRef.current = hoverPos;
      setReadout({
        x: xValue,
        y: yValue,
        line: snapped?.label && snapped.labelColor ? { label: snapped.label, color: snapped.labelColor } : undefined,
      });
      schedule();
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
        const id = addPoint(input);
        const point = useStore.getState().points.find((candidate) => candidate.id === id);
        if (point) {
          pendingPointsRef.current.set(id, {
            point: pointFromCoordinates(chart.x, input.va, chart.y, input.vb),
            label: point.label,
          });
        }
        setSelectedPointId(id);
        recentClickActions.push({ kind: "point", id });
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
      setReadout(null);
      schedule();
    };
    const onDouble = (e: MouseEvent) => {
      e.preventDefault();
      if (clickTimer.current) clearTimeout(clickTimer.current);
      clickTimer.current = null;
      for (const action of recentClickActions) {
        if (action.kind === "point") {
          removePoint(action.id);
          pendingPointsRef.current.delete(action.id);
        } else {
          removeChain(action.id);
        }
      }
      recentClickActions = [];
      setSelectedPointId(null);
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
  }, [updateView, schedule, chart, chartId, addPoint, addChain, updatePoint, removePoint, removeChain, setView, scene, mode, fluid, drawKind, data.points]);

  // ---- fit to overlay content ----
  const fit = useCallback(() => {
    const vp = viewRef.current;
    if (!vp) return;
    const pts: Float64Array[] = [];
    if (data.cycle) data.cycle.states.forEach((s) => pts.push(statePoint(s.state)));
    data.chains.forEach((c) => {
      if (c.start) pts.push(statePoint(c.start));
      c.steps.forEach((s) => s.result && pts.push(statePoint(s.result.end)));
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
        <Select
          className="w-24"
          label="Chart type"
          value={chartId}
          onChange={setChart}
          options={CHARTS.map((c) => ({ value: c.id, label: c.label }))}
        />
        {
          <Select
            className="w-36 shrink-0"
            label="Draw connection"
            value={drawKind ?? ""}
            onChange={(kind) => setDrawKind(kind === "" ? null : kind as ProcessKind)}
            options={[{ value: "" as const, label: "Draw connection…" }, ...PROCESS_KINDS.map(({ kind, label, group }) => ({ value: kind, label, group }))]}
          />
        }
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
            onClick={() => setView(chartId, undefined)}
            aria-label="Reset view"
            className="rounded-md p-1.5 text-ink-2 hover:bg-surface-2 hover:text-ink"
          >
            <RotateCcw size={16} />
          </button>
          <button
            onClick={fit}
            aria-label="Fit to content"
            className="rounded-md p-1.5 text-ink-2 hover:bg-surface-2 hover:text-ink"
          >
            <Maximize2 size={16} />
          </button>
          <label className="inline-flex items-center gap-1.5 px-1.5 py-1 text-[13px] text-ink-2" htmlFor="line-density">
            Density
            <select
              id="line-density"
              className="rounded border border-line bg-surface px-1.5 py-1 text-[13px] text-ink"
              value={density}
              onChange={(e) => useStore.getState().setDensity(Number(e.target.value))}
            >
              {[6, 10, 16].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <button
            onClick={exportPng}
            aria-label="Export PNG"
            className="rounded-md p-1.5 text-ink-2 hover:bg-surface-2 hover:text-ink"
          >
            <Download size={16} />
          </button>
        </div>
        <div className="flex items-center gap-1">
          {iso.loading && <span className="mr-1 text-[11px] text-ink-3" aria-label="Computing isolines">···</span>}
          <button onClick={onToggleResults} aria-expanded={resultsOpen} className={`rounded-md px-2.5 py-1.5 text-xs ${resultsOpen ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink"}`}>
            Results
          </button>
        </div>
      </div>
      <div ref={containerRef} className="relative min-h-0 flex-1 touch-none select-none">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 cursor-crosshair"
          aria-label={`${chart.title} chart for ${fluid}`}
          role="img"
        />
        {selectedPoint?.state && (
          <SelectedPointCard
            cardRef={selectedPointCardRef}
            point={selectedPoint}
            chart={chart}
            fluid={fluid}
            onClose={() => setSelectedPointId(null)}
            onRemove={() => {
              removePoint(selectedPoint.point.id);
              setSelectedPointId(null);
            }}
          />
        )}
        {readout && <Readout {...readout} chart={chart} />}
      </div>
    </div>
  );
}

function SelectedPointCard({ cardRef, point, chart, fluid, onClose, onRemove }: {
  cardRef: React.RefObject<HTMLElement | null>;
  point: PointResult;
  chart: ReturnType<typeof chartById>;
  fluid: string;
  onClose: () => void;
  onRemove: () => void;
}) {
  const units = useStore((s) => s.units);
  const updatePoint = useStore((s) => s.updatePoint);
  const state = point.state!;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fields = [
    ["Temperature", Prop.T],
    ["Pressure", Prop.P],
    ["Enthalpy", Prop.H],
    ["Entropy", Prop.S],
    ["Density", Prop.D],
  ] as const;
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
    <section ref={cardRef} tabIndex={-1} className="absolute left-[76px] top-3 z-10 w-72 max-w-[calc(100%-88px)] rounded-xl border border-line bg-surface/95 p-3 shadow-xl backdrop-blur" aria-label={`State ${point.point.label}`}>
      <div className="mb-2 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-ink">State {point.point.label}</div>
          <div className="text-xs capitalize text-ink-3">{state.phase}</div>
        </div>
        <button onClick={onRemove} title="Remove state" aria-label="Remove state" className="rounded p-1 text-ink-3 hover:bg-surface-2 hover:text-danger"><Trash2 size={14} /></button>
        <button onClick={onClose} title="Close state details" aria-label="Close state details" className="rounded p-1 text-ink-3 hover:bg-surface-2 hover:text-ink"><X size={14} /></button>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        {fields.map(([label, prop]) => {
          const unit = unitOf(units, COORDINATES[prop].quantity);
          const displayValue = toDisplay(unit, stateValue(state, prop));
          return (
            <div key={label} className="min-w-0">
              <div className="text-xs text-ink-3">{label}</div>
              <div className="flex items-baseline gap-1 tabular text-ink">
                <InlineEditableValue label={label} value={displayValue} disabled={saving} onCommit={(next) => commitValue(prop, next)} />
                <span className="text-ink-3">{unit.label}</span>
              </div>
            </div>
          );
        })}
      </div>
      {error ? (
        <div role="status" className="mt-2 text-xs text-danger">{error}</div>
      ) : saving ? (
        <div role="status" className="mt-2 text-xs text-ink-3">Updating point…</div>
      ) : (
        <div className="mt-2 border-t border-line pt-2 text-xs text-ink-3">Click a value to edit it.</div>
      )}
    </section>
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
        className="w-[8ch] min-w-[5ch] max-w-full border-0 bg-transparent p-0 text-right font-mono text-ink outline-none focus-visible:underline focus-visible:decoration-accent"
      />
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        setDraft(formatNumber(value, 4));
        setEditing(true);
      }}
      className="cursor-text border-0 bg-transparent p-0 text-right font-mono text-ink decoration-accent underline-offset-2 hover:underline disabled:cursor-wait"
      aria-label={`Edit ${label}`}
    >
      {formatNumber(value, 4)}
    </button>
  );
}

function Readout({ x, y, chart, line }: {
  x: number;
  y: number;
  chart: ReturnType<typeof chartById>;
  line?: { label: string; color: string };
}) {
  const units = useStore((s) => s.units);
  const xUnit = unitOf(units, COORDINATES[chart.x].quantity);
  const yUnit = unitOf(units, COORDINATES[chart.y].quantity);
  const rows: [string, number, string][] = [
    [COORDINATES[chart.x].symbol, toDisplay(xUnit, x), xUnit.label],
    [COORDINATES[chart.y].symbol, toDisplay(yUnit, y), yUnit.label],
  ];
  return (
    <div
      className="pointer-events-none absolute right-6 top-5 z-10 rounded-lg border border-line bg-surface/95 px-3 py-2 text-xs shadow-lg backdrop-blur"
      aria-label="Cursor coordinates"
    >
      {line && <div className="mb-1 border-b border-line pb-1 font-medium" style={{ color: line.color }}>{line.label}</div>}
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
    </div>
  );
}
