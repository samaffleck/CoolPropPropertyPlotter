import type { Metric } from "../engine/types";
import { useStore } from "../state/store";
import { formatNumber, toDisplay, unitOf } from "../units/units";

/** Horizontal bars of exergy destroyed per component, largest first. */
export function ExergyBars({ metrics }: { metrics: Metric[] }) {
  const units = useStore((s) => s.units);
  const unit = unitOf(units, "specific_energy");
  const items = metrics.filter((m) => m.group === "exergy" && Number.isFinite(m.value)).sort((a, b) => b.value - a.value);
  const total = items.reduce((a, m) => a + Math.max(0, m.value), 0);
  if (!items.length) return <p className="text-xs text-ink-3">No exergy breakdown for this cycle.</p>;
  const max = Math.max(...items.map((m) => m.value));
  return (
    <div className="flex flex-col gap-1.5">
      {items.map((m) => {
        const pct = total > 0 ? (100 * m.value) / total : 0;
        return (
          <div key={m.key} className="group grid grid-cols-[minmax(7rem,10rem)_1fr_7.5rem] items-center gap-3 text-xs" title={`${m.label}: ${formatNumber(toDisplay(unit, m.value), 4)} ${unit.label} (${pct.toFixed(1)}%)`}>
            <span className="truncate text-ink-2">{m.label}</span>
            <div className="h-3.5 rounded-sm bg-surface-2">
              <div className="h-full rounded-r-[4px] bg-[var(--iso-P)] transition-[width] group-hover:brightness-110" style={{ width: `${Math.max(0.5, (100 * Math.max(0, m.value)) / max)}%` }} />
            </div>
            <span className="tabular text-right font-mono text-ink">
              {formatNumber(toDisplay(unit, m.value), 3)} <span className="font-sans text-ink-3">{pct.toFixed(0)}%</span>
            </span>
          </div>
        );
      })}
      <div className="mt-1 text-right text-[11px] text-ink-3">
        Total {formatNumber(toDisplay(unit, total), 4)} {unit.label} per kg of reference flow
      </div>
    </div>
  );
}
