import { FileDown } from "lucide-react";
import { useState, type ReactNode } from "react";
import { ExergyBars } from "../components/ExergyBars";
import { TQChart } from "../components/TQChart";
import { Button } from "../components/ui";
import type { Metric, ThermoState } from "../engine/types";
import { useData } from "../state/data";
import { useStore } from "../state/store";
import type { Quantity, UnitChoice } from "../units/units";
import { formatNumber, toDisplay, unitOf } from "../units/units";

const COLUMNS: { key: keyof ThermoState; label: string; quantity: Quantity }[] = [
  { key: "T", label: "T", quantity: "temperature" },
  { key: "p", label: "p", quantity: "pressure" },
  { key: "h", label: "h", quantity: "specific_energy" },
  { key: "s", label: "s", quantity: "specific_entropy" },
  { key: "rho", label: "ρ", quantity: "density" },
  { key: "Q", label: "x", quantity: "fraction" },
  { key: "cp", label: "cₚ", quantity: "specific_entropy" },
  { key: "mu", label: "μ", quantity: "viscosity" },
  { key: "k", label: "λ", quantity: "conductivity" },
];

interface Row {
  id: string;
  label: string;
  flow?: number;
  state: ThermoState;
}

function downloadCsv(name: string, rows: Row[], units: UnitChoice) {
  const head = ["Point", "Description", "Relative flow", "Phase", ...COLUMNS.map((c) => `${c.label} [${unitOf(units, c.quantity).label}]`)];
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [head.map(esc).join(",")];
  for (const r of rows) {
    lines.push(
      [r.id, r.label, r.flow ?? "", r.state.phase, ...COLUMNS.map((c) => {
        const v = r.state[c.key] as number;
        return Number.isFinite(v) ? toDisplay(unitOf(units, c.quantity), v).toPrecision(8) : "";
      })]
        .map((v) => esc(String(v)))
        .join(","),
    );
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function StatesTable({ rows, showFlow }: { rows: Row[]; showFlow?: boolean }) {
  const units = useStore((s) => s.units);
  return (
    <div className="overflow-x-auto">
      <table className="tabular w-full min-w-[720px] text-xs">
        <thead>
          <tr className="border-b border-line text-left text-ink-3">
            <th className="py-1.5 pr-2 font-medium">#</th>
            <th className="py-1.5 pr-2 font-medium">Description</th>
            {showFlow && <th className="py-1.5 pr-2 text-right font-medium">ṁ/ṁ₀</th>}
            {COLUMNS.map((c) => (
              <th key={c.key} className="py-1.5 pr-3 text-right font-medium">
                {c.label} <span className="font-normal">[{unitOf(units, c.quantity).label}]</span>
              </th>
            ))}
            <th className="py-1.5 font-medium">Phase</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id + r.label} className="border-b border-line/60 hover:bg-surface-2">
              <td className="py-1 pr-2 font-semibold text-ink">{r.id}</td>
              <td className="max-w-56 truncate py-1 pr-2 text-ink-2">{r.label}</td>
              {showFlow && <td className="py-1 pr-2 text-right font-mono">{formatNumber(r.flow ?? 1, 4)}</td>}
              {COLUMNS.map((c) => (
                <td key={c.key} className="py-1 pr-3 text-right font-mono text-ink">
                  {formatNumber(toDisplay(unitOf(units, c.quantity), r.state[c.key] as number), 5)}
                </td>
              ))}
              <td className="py-1 capitalize text-ink-2">{r.state.phase}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MetricValue({ m }: { m: Metric }) {
  const units = useStore((s) => s.units);
  const q = m.quantity as Quantity;
  const unit = unitOf(units, q in units ? q : "ratio");
  const pct = m.quantity === "fraction" && units.fraction === "-" && m.key !== "Q_valve" && m.key !== "Q_turb_out";
  return (
    <span className="tabular font-mono">
      {pct ? `${formatNumber(m.value * 100, 4)}` : formatNumber(toDisplay(unit, m.value), 4)}
      <span className="ml-1 font-sans text-ink-3">{pct ? "%" : unit.label === "–" ? "" : unit.label}</span>
    </span>
  );
}

function Tabs({ tabs, active, onChange, right }: { tabs: string[]; active: string; onChange: (t: string) => void; right?: ReactNode }) {
  return (
    <div className="flex items-center gap-1 border-b border-line px-3">
      {tabs.map((t) => (
        <button
          key={t}
          onClick={() => onChange(t)}
          className={`-mb-px border-b-2 px-2.5 py-2 text-xs font-medium ${t === active ? "border-accent text-ink" : "border-transparent text-ink-3 hover:text-ink"}`}
        >
          {t}
        </button>
      ))}
      <div className="ml-auto">{right}</div>
    </div>
  );
}

export function ResultsPanel() {
  const mode = useStore((s) => s.mode);
  const units = useStore((s) => s.units);
  const fluid = useStore((s) => s.fluid);
  const cycleId = useStore((s) => s.cycleId);
  const { points, chains, cycle, cycleError } = useData();
  const [tab, setTab] = useState("States");

  if (mode === "cycle") {
    if (!cycle) {
      return <div className="p-4 text-xs text-ink-3">{cycleError ? "The cycle could not be solved; see the message in the side panel." : "Solving…"}</div>;
    }
    const kpis = cycle.metrics.filter((m) => m.group === "performance").slice(0, 4);
    const rows: Row[] = cycle.states.map((s) => ({ id: s.id, label: s.label, flow: s.flow, state: s.state }));
    const tabs = ["States", "Performance", "Exergy", ...(cycle.exchangers.length ? ["Heat exchangers"] : [])];
    const current = tabs.includes(tab) ? tab : "States";
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-4">
          {kpis.map((m) => (
            <div key={m.key} className="bg-surface px-4 py-2.5">
              <div className="truncate text-[11px] text-ink-3">{m.label}</div>
              <div className="text-lg font-semibold text-ink">
                <MetricValue m={m} />
              </div>
            </div>
          ))}
        </div>
        <Tabs
          tabs={tabs}
          active={current}
          onChange={setTab}
          right={
            current === "States" && (
              <Button variant="ghost" className="h-7 px-2 text-xs" onClick={() => downloadCsv(`${cycleId}-${fluid}.csv`, rows, units)}>
                <FileDown size={13} /> CSV
              </Button>
            )
          }
        />
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          {current === "States" && <StatesTable rows={rows} showFlow />}
          {current === "Performance" && (
            <table className="w-full max-w-xl text-xs">
              <tbody>
                {cycle.metrics
                  .filter((m) => m.group !== "exergy")
                  .map((m) => (
                    <tr key={m.key} className="border-b border-line/60">
                      <td className="py-1.5 text-ink-2">{m.label}</td>
                      <td className="py-1.5 text-right text-ink">
                        <MetricValue m={m} />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
          {current === "Exergy" && (
            <div className="max-w-2xl">
              <ExergyBars metrics={cycle.metrics} />
            </div>
          )}
          {current === "Heat exchangers" && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {cycle.exchangers.map((x) => (
                <TQChart key={x.name} x={x} />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (mode === "process") {
    const rows: Row[] = [];
    for (const c of chains) {
      const letter = c.chain.name.replace(/^Process\s+/, "");
      if (c.start) rows.push({ id: `${letter}0`, label: `${c.chain.name}: start`, state: c.start });
      c.steps.forEach((s, i) => s.result && rows.push({ id: `${letter}${i + 1}`, label: `${c.chain.name}: after step ${i + 1}`, state: s.result.end }));
    }
    return (
      <Shell title="Process states" onCsv={rows.length ? () => downloadCsv(`processes-${fluid}.csv`, rows, units) : undefined}>
        {rows.length ? <StatesTable rows={rows} /> : <Empty>Add a process in the side panel or click the chart.</Empty>}
      </Shell>
    );
  }

  const rows: Row[] = points.filter((p) => p.state).map((p) => ({ id: p.point.label, label: "Pinned state", state: p.state! }));
  return (
    <Shell title="Pinned states" onCsv={rows.length ? () => downloadCsv(`states-${fluid}.csv`, rows, units) : undefined}>
      {rows.length ? <StatesTable rows={rows} /> : <Empty>Click the chart to pin states and compare their properties here.</Empty>}
    </Shell>
  );
}

function Shell({ title, onCsv, children }: { title: string; onCsv?: () => void; children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center border-b border-line px-4 py-1.5">
        <h2 className="text-sm font-medium text-ink-2">{title}</h2>
        {onCsv && (
          <Button variant="ghost" className="ml-auto h-7 px-2 text-xs" onClick={onCsv}>
            <FileDown size={13} /> CSV
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4 py-2">{children}</div>
    </div>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <p className="py-4 text-xs text-ink-3">{children}</p>;
