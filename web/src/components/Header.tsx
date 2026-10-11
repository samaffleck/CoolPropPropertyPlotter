import { BookOpen, ChevronDown, Ruler } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cycleById, CYCLES, defaultParams } from "../cycles/catalog";
import { engine } from "../engine/client";
import { ProcessKind, Prop, type CycleSegmentResult, type ProcessSpec, type StateInput, type ThermoState } from "../engine/types";
import { useStore } from "../state/store";
import { UNIT_SYSTEMS, UNITS, type Quantity } from "../units/units";
import { Select } from "./ui";

function ExamplesMenu() {
  const fluid = useStore((s) => s.fluid);
  const setCycle = useStore((s) => s.setCycle);
  const loadSnapshot = useStore((s) => s.loadExampleSnapshot);
  const [open, setOpen] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const loadExample = async (id: string) => {
    const def = cycleById(id);
    if (!def) return;
    setLoadingId(id);
    setError(null);
    setCycle(id);
    try {
      const current = useStore.getState();
      const result = await engine.cycle(current.fluid, id, defaultParams(def, current.fluid));
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const stateById = new Map(result.states.map((state) => [state.id, state.state]));
      const connections = await Promise.all(result.segments.map(async (segment) => ({
        from: segment.from,
        to: segment.to,
        component: segment.component,
        kind: segment.kind,
        path: Array.from(segment.path, (value) => Number.isFinite(value) ? value : null),
        spec: await editableSpec(segment, stateById.get(segment.from), stateById.get(segment.to), current.fluid),
      })));
      loadSnapshot(
        id,
        def.name,
        result.states.map((state) => ({
          id: state.id,
          label: state.id,
          input: { a: Prop.P, va: state.state.p, b: Prop.H, vb: state.state.h },
        })),
        connections,
      );
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The example could not be loaded.");
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div ref={root} className="relative">
      <button
        onClick={() => { setError(null); setOpen((value) => !value); }}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex h-9 items-center gap-2 rounded-lg px-2.5 text-[13px] text-ink-2 hover:bg-surface-2 hover:text-ink"
      >
        <BookOpen size={16} />
        <span>Examples</span>
        <ChevronDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div role="menu" aria-label="Load an example" className="absolute left-0 top-11 z-30 max-h-[min(70vh,32rem)] w-80 overflow-y-auto rounded-xl border border-line bg-surface py-1 shadow-2xl">
          {CYCLES.map((cycle) => {
            const exampleFluid = cycle.fluids.includes(fluid) ? fluid : cycle.fluids[0];
            return (
              <button
                key={cycle.id}
                role="menuitem"
                onClick={() => void loadExample(cycle.id)}
                disabled={loadingId !== null}
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-2 disabled:opacity-60"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-ink">{cycle.name}</span>
                  <span className="block truncate text-[11px] text-ink-3">{exampleFluid}</span>
                </span>
                {loadingId === cycle.id && <span className="text-[11px] text-ink-3">Loading…</span>}
              </button>
            );
          })}
          {error && <div role="alert" className="border-t border-line px-3 py-2 text-xs text-danger">{error}</div>}
        </div>
      )}
    </div>
  );
}

async function editableSpec(segment: CycleSegmentResult, from: ThermoState | undefined, to: ThermoState | undefined, fluid: string): Promise<ProcessSpec> {
  const kind = segment.kind.toLowerCase();
  if ((kind === "compressor" || kind === "pump") && from && to && Math.abs(from.T - to.T) < 1e-5) {
    return { kind: ProcessKind.Isothermal, target: Prop.P, value: to.p };
  }
  if (kind === "compressor" || kind === "pump") {
    const efficiency = await inferEfficiency(fluid, from, to, ProcessKind.Compression, 0.8);
    return { kind: ProcessKind.Compression, target: Prop.P, value: to?.p ?? 1e6, efficiency };
  }
  if (kind === "expander" || kind === "turbine") {
    const efficiency = await inferEfficiency(fluid, from, to, ProcessKind.Expansion, 0.85);
    return { kind: ProcessKind.Expansion, target: Prop.P, value: to?.p ?? 1e5, efficiency };
  }
  if (kind === "valve") return { kind: ProcessKind.Isenthalpic, target: Prop.P, value: to?.p ?? 1e5 };
  if (kind === "separator" && to && Number.isFinite(to.Q) && to.Q >= 0 && to.Q <= 1) {
    return { kind: ProcessKind.Isobaric, target: Prop.Q, value: to.Q };
  }
  if (kind === "mixer") return { kind: ProcessKind.Isobaric, target: Prop.H, value: to?.h ?? 3e5 };
  return { kind: ProcessKind.Isobaric, target: Prop.T, value: to?.T ?? (from?.T ?? 300) };
}

async function inferEfficiency(fluid: string, from: ThermoState | undefined, to: ThermoState | undefined, kind: ProcessKind, fallback: number): Promise<number> {
  if (!from || !to) return fallback;
  const input: StateInput = { a: Prop.P, va: from.p, b: Prop.H, vb: from.h };
  let ideal;
  try {
    ideal = await engine.process(fluid, input, { kind, target: Prop.P, value: to.p, efficiency: 1 });
  } catch {
    return fallback;
  }
  if (!ideal.ok) return fallback;
  const numerator = kind === ProcessKind.Compression ? ideal.end.h - from.h : from.h - to.h;
  const denominator = kind === ProcessKind.Compression ? to.h - from.h : from.h - ideal.end.h;
  const efficiency = numerator / denominator;
  return Number.isFinite(efficiency) && efficiency > 0 && efficiency <= 1 ? efficiency : fallback;
}

const QUANTITY_LABELS: Partial<Record<Quantity, string>> = {
  temperature: "Temperature",
  pressure: "Pressure",
  specific_energy: "Enthalpy / energy",
  specific_entropy: "Entropy / heat capacity",
  density: "Density",
  specific_volume: "Specific volume",
  temperature_difference: "Temperature difference",
  viscosity: "Viscosity",
  conductivity: "Conductivity",
  fraction: "Fractions",
};

export function UnitsMenu() {
  const unitSystem = useStore((s) => s.unitSystem);
  const units = useStore((s) => s.units);
  const setUnitSystem = useStore((s) => s.setUnitSystem);
  const setUnit = useStore((s) => s.setUnit);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  return (
    <div ref={root} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2 hover:text-ink"
        aria-expanded={open}
        aria-label="Units"
        title="Units"
      >
        <Ruler size={16} />
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-30 w-80 rounded-xl border border-line bg-surface p-3 shadow-2xl">
          <div className="mb-3 grid grid-cols-2 gap-1">
            {UNIT_SYSTEMS.map((s) => (
              <button
                key={s.id}
                onClick={() => setUnitSystem(s.id)}
                className={`rounded-md border px-2 py-1.5 text-left text-xs ${s.id === unitSystem ? "border-accent bg-accent/10 text-ink" : "border-line text-ink-2 hover:bg-surface-2"}`}
              >
                <div className="font-medium">{s.label.split(" (")[0]}</div>
                <div className="text-[11px] text-ink-3">{s.label.match(/\((.*)\)/)?.[1]}</div>
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-1.5">
            {(Object.keys(QUANTITY_LABELS) as Quantity[]).map((q) => (
              <div key={q} className="flex items-center justify-between gap-2">
                <span className="text-xs text-ink-2">{QUANTITY_LABELS[q]}</span>
                <Select
                  className="w-32"
                  label={QUANTITY_LABELS[q]}
                  value={units[q]}
                  options={UNITS[q].map((u) => ({ value: u.id, label: u.label }))}
                  onChange={(v) => setUnit(q, v)}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function Header({ onHome }: { onHome: () => void }) {
  return (
    <header className="flex items-center gap-3 border-b border-line px-3 py-2 sm:px-4">
      <button onClick={onHome} className="flex shrink-0 items-center" aria-label="Home">
        <img src="/favicon.svg" alt="" className="h-7 w-7 shrink-0" />
      </button>
      <ExamplesMenu />
      <a
        href="https://github.com/samaffleck/ThermoPlot"
        target="_blank"
        rel="noreferrer"
        aria-label="ThermoPlot on GitHub"
        title="ThermoPlot on GitHub"
        className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2 hover:text-ink"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[17px] w-[17px] fill-current">
          <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.387.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.09-.745.083-.729.083-.729 1.205.084 1.84 1.237 1.84 1.237 1.07 1.834 2.807 1.304 3.492.997.108-.775.418-1.305.762-1.605-2.665-.3-5.466-1.334-5.466-5.931 0-1.31.467-2.381 1.235-3.221-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.292-1.552 3.295-1.23 3.295-1.23.647 1.653.24 2.873.12 3.176.77.84 1.233 1.911 1.233 3.221 0 4.61-2.804 5.628-5.475 5.922.43.372.823 1.102.823 2.222 0 1.606-.015 2.896-.015 3.286 0 .319.216.694.825.576C20.565 22.092 24 17.595 24 12.297c0-6.627-5.373-12-12-12" />
        </svg>
      </a>
    </header>
  );
}
