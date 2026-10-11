import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FluidSummary } from "../engine/types";
import { useCatalog } from "../state/compute";
import { useStore } from "../state/store";
import { formatNumber, toDisplay, unitOf } from "../units/units";

const CRYOGENS = new Set([
  "Helium", "Hydrogen", "ParaHydrogen", "OrthoHydrogen", "Deuterium", "ParaDeuterium", "OrthoDeuterium", "Neon", "Nitrogen",
  "Air", "Argon", "Oxygen", "Fluorine", "CarbonMonoxide", "Methane", "Krypton", "Xenon",
]);
const NATURAL_REFRIGERANTS = new Set(["Ammonia", "CarbonDioxide", "n-Propane", "IsoButane", "Propylene", "Water", "Ethane", "Ethylene", "DimethylEther"]);

type Category = "Cryogens" | "Refrigerants" | "Natural refrigerants" | "Hydrocarbons" | "Siloxanes" | "Other";
const ORDER: Category[] = ["Cryogens", "Refrigerants", "Natural refrigerants", "Hydrocarbons", "Siloxanes", "Other"];

function categorize(f: FluidSummary): Category {
  if (CRYOGENS.has(f.name)) return "Cryogens";
  if (NATURAL_REFRIGERANTS.has(f.name)) return "Natural refrigerants";
  if (/^R\d|^RC\d|^HFE|^Novec|^SES/.test(f.name)) return "Refrigerants";
  if (/^(MM|MDM|MD\dM|D\d)$/.test(f.name)) return "Siloxanes";
  if (/(ane|ene|yne|Benzene|Toluene|Xylene)$/i.test(f.name) && !/Chloro|Fluoro/.test(f.name)) return "Hydrocarbons";
  return "Other";
}

export function FluidPicker() {
  const fluid = useStore((s) => s.fluid);
  const setFluid = useStore((s) => s.setFluid);
  const units = useStore((s) => s.units);
  const catalog = useCatalog();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (f: FluidSummary) =>
      !q || f.name.toLowerCase().includes(q) || f.aliases.toLowerCase().includes(q) || f.cas.includes(q) || f.formula.toLowerCase().replace(/[_{}]/g, "").includes(q);
    const items = catalog.filter(match).map((f) => ({ f, cat: categorize(f) }));
    items.sort((a, b) => ORDER.indexOf(a.cat) - ORDER.indexOf(b.cat) || a.f.name.localeCompare(b.f.name));
    return items;
  }, [catalog, query]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    input.current?.focus();
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = (name: string) => {
    setFluid(name);
    setOpen(false);
    setQuery("");
  };
  const current = catalog.find((f) => f.name === fluid);
  const T = unitOf(units, "temperature");
  const P = unitOf(units, "pressure");

  return (
    <div ref={root} className="relative min-w-0 flex-1 sm:flex-none">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-9 w-full items-center sm:w-auto sm:min-w-56 gap-2 rounded-lg border border-line bg-surface px-3 text-left hover:bg-surface-2"
      >
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-[13px] font-semibold text-ink">{fluid}</span>
          {current && (
            <span className="truncate text-[11px] text-ink-3">
              T<sub>c</sub> {formatNumber(toDisplay(T, current.Tcrit), 4)} {T.label} · p<sub>c</sub> {formatNumber(toDisplay(P, current.pcrit), 4)} {P.label}
            </span>
          )}
        </div>
        <ChevronDown size={15} className="text-ink-3" />
      </button>
      {open && (
        <div className="absolute left-0 top-11 z-30 w-[min(92vw,380px)] overflow-hidden rounded-xl border border-line bg-surface shadow-2xl">
          <div className="flex items-center gap-2 border-b border-line px-3">
            <Search size={15} className="text-ink-3" />
            <input
              ref={input}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, alias, CAS or formula"
              className="h-10 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3"
              role="combobox"
              aria-expanded
              aria-controls="fluid-list"
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, filtered.length - 1));
                else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
                else if (e.key === "Enter" && filtered[active]) choose(filtered[active].f.name);
                else if (e.key === "Escape") setOpen(false);
                else return;
                e.preventDefault();
              }}
            />
          </div>
          <ul ref={list} id="fluid-list" role="listbox" className="max-h-[60vh] overflow-y-auto py-1">
            {filtered.map(({ f, cat }, i) => (
              <li key={f.name}>
                {(i === 0 || filtered[i - 1].cat !== cat) && (
                  <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-ink-3">{cat}</div>
                )}
                <button
                  data-index={i}
                  role="option"
                  aria-selected={f.name === fluid}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(f.name)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left ${i === active ? "bg-surface-2" : ""}`}
                >
                  <span className="w-4">{f.name === fluid && <Check size={14} className="text-accent" />}</span>
                  <span className="flex-1 truncate">
                    <span className="text-[13px] text-ink">{f.name}</span>
                    {f.aliases && (
                      <span className="ml-2 text-[11px] text-ink-3">{f.aliases.split(",").filter((a) => a.toUpperCase() !== f.name.toUpperCase())[0]}</span>
                    )}
                  </span>
                  {f.ashrae34 && <span className="rounded bg-surface-3 px-1.5 text-[10px] text-ink-2">{f.ashrae34}</span>}
                  <span className="tabular w-16 text-right font-mono text-[11px] text-ink-3">{formatNumber(toDisplay(T, f.Tcrit), 4)}</span>
                </button>
              </li>
            ))}
            {!filtered.length && <li className="px-3 py-6 text-center text-ink-3">No fluids match “{query}”</li>}
          </ul>
          <div className="border-t border-line px-3 py-1.5 text-[11px] text-ink-3">
            {catalog.length} pure fluids · right column: critical temperature [{T.label}]
          </div>
        </div>
      )}
    </div>
  );
}
