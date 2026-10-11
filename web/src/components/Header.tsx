import { Ruler } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import { UNIT_SYSTEMS, UNITS, type Quantity } from "../units/units";
import { FluidPicker } from "./FluidPicker";
import { Select } from "./ui";

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

function UnitsMenu() {
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
        className="flex h-9 items-center gap-2 rounded-lg px-2.5 text-[13px] text-ink-2 hover:bg-surface-2 hover:text-ink"
        aria-expanded={open}
      >
        <Ruler size={16} />
        <span className="hidden sm:inline">Units</span>
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
      <FluidPicker />
      <div className="ml-auto flex items-center gap-1">
        <UnitsMenu />
      </div>
    </header>
  );
}
