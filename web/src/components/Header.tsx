import { Monitor, Moon, Ruler, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useStore, type ThemePref } from "../state/store";
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
  const sys = UNIT_SYSTEMS.find((s) => s.id === unitSystem);
  return (
    <div ref={root} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 items-center gap-2 rounded-lg px-2.5 text-[13px] text-ink-2 hover:bg-surface-2 hover:text-ink"
        aria-expanded={open}
      >
        <Ruler size={16} />
        <span className="hidden sm:inline">{sys ? sys.label.split(" (")[0] : "Custom"} units</span>
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

const THEMES: { id: ThemePref; icon: typeof Sun; label: string }[] = [
  { id: "light", icon: Sun, label: "Light" },
  { id: "system", icon: Monitor, label: "System" },
  { id: "dark", icon: Moon, label: "Dark" },
];

function ThemeToggle() {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  return (
    <div className="flex rounded-lg bg-surface-2 p-0.5" role="radiogroup" aria-label="Theme">
      {THEMES.map(({ id, icon: Icon, label }) => (
        <button
          key={id}
          role="radio"
          aria-checked={theme === id}
          title={label}
          onClick={() => setTheme(id)}
          className={`rounded-md p-1.5 ${theme === id ? "bg-surface text-ink shadow-sm" : "text-ink-3 hover:text-ink"}`}
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  );
}

export function Header() {
  return (
    <header className="flex items-center gap-2 border-b border-line px-3 py-2 sm:gap-3 sm:px-4">
      <a href="#" className="flex items-center gap-2" aria-label="ThermoPlot home">
        <img src="/favicon.svg" alt="" className="h-7 w-7 shrink-0" />
        <span className="hidden text-[15px] font-semibold tracking-tight text-ink md:inline">ThermoPlot</span>
      </a>
      <div className="mx-1 hidden h-6 w-px bg-line md:block" />
      <FluidPicker />
      <div className="ml-auto flex items-center gap-1">
        <UnitsMenu />
        <ThemeToggle />
        <a
          href="https://github.com/samaffleck/CoolPropPropertyPlotter"
          target="_blank"
          rel="noreferrer"
          className="hidden rounded-lg p-2 text-ink-2 hover:bg-surface-2 hover:text-ink sm:block"
          aria-label="Source on GitHub"
        >
          <svg viewBox="0 0 16 16" width="17" height="17" fill="currentColor" aria-hidden>
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
        </a>
      </div>
    </header>
  );
}
