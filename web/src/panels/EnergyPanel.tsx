import { Message, Value } from "../components/ui";
import { type ConnectionEnergy, type EnergyLoop } from "../state/energy";
import { useStore } from "../state/store";

function EnergyValue({ value }: { value: number }) {
  return <Value value={value} quantity="specific_energy" />;
}

export function ConnectionEnergyReadout({ energy, pending }: { energy?: ConnectionEnergy; pending: boolean }) {
  if (pending) return <p className="mt-2 text-[11px] text-ink-3" role="status">Updating energy…</p>;
  if (!energy || energy.q === null || energy.w === null) {
    return <p className="mt-2 text-[11px] leading-relaxed text-ink-3">Energy unavailable. {energy?.reason}</p>;
  }
  return (
    <dl className="mt-2 grid grid-cols-2 gap-x-2 border-t border-line pt-2 text-[11px]">
      <div className="min-w-0">
        <dt className="mb-1 text-ink-3">{energy.q < 0 ? "Heat out" : energy.q > 0 ? "Heat in" : "Heat"}{energy.heatTransfer === "internal" ? " · internal" : ""}</dt>
        <dd className="flex justify-start text-ink-2"><EnergyValue value={Math.abs(energy.q)} /></dd>
      </div>
      <div className="min-w-0">
        <dt className="mb-1 text-ink-3">{energy.w < 0 ? "Work in" : energy.w > 0 ? "Work out" : "Work"}</dt>
        <dd className="flex justify-start text-ink-2"><EnergyValue value={Math.abs(energy.w)} /></dd>
      </div>
    </dl>
  );
}

const STATUS_TEXT = {
  open: "Open path. Connect the end back to the starting state for cycle totals.",
  branched: "Branched network. Cycle totals and power need stream mass flows and balances at each split or mixer. Connection energies are per kg of that stream.",
  invalid: "Closed loop with an invalid connection. Resolve the connection errors to calculate cycle totals.",
  closed: "Closed cycle",
};

function LoopSummary({ loop, index, multiple, labels }: { loop: EnergyLoop; index: number; multiple: boolean; labels: Map<string, string> }) {
  const totals = loop.totals;
  const pointLabels = [...new Set(loop.connections.flatMap((connection) => connection.from ? [labels.get(connection.from) ?? "?"] : []))];
  const name = `${loop.status === "closed" || loop.status === "invalid" ? "Cycle" : "Network"}${multiple ? ` ${index + 1}` : ""}`;
  return (
    <div className="rounded-lg border border-line p-2.5">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-medium text-ink-2">{name}</h3>
        <span className="truncate text-[11px] text-ink-3" title={`Points ${pointLabels.join(", ")}`}>Points {pointLabels.join(", ")}</span>
      </div>
      {!totals ? <p className="text-xs leading-relaxed text-ink-3">{STATUS_TEXT[loop.status]}</p> : (
        <>
          <dl className="flex flex-col gap-2 text-xs">
            <div className="flex items-start justify-between gap-2 font-medium text-ink">
              <dt className="pt-0.5">Net work {totals.netWork < 0 ? "input" : "output"}</dt>
              <dd><EnergyValue value={Math.abs(totals.netWork)} /></dd>
            </div>
            {totals.efficiency !== null && <SummaryMetric label="Thermal efficiency"><Value value={totals.efficiency * 100} quantity="ratio" /> %</SummaryMetric>}
            {totals.coolingCOP !== null && <SummaryMetric label="COP · cooling"><Value value={totals.coolingCOP} quantity="ratio" /></SummaryMetric>}
            {totals.heatingCOP !== null && <SummaryMetric label="COP · heating"><Value value={totals.heatingCOP} quantity="ratio" /></SummaryMetric>}
          </dl>
          <details className="mt-3 border-t border-line pt-2">
            <summary className="cursor-pointer text-[11px] text-ink-3">Heat, work & balance</summary>
            <dl className="mt-2 flex flex-col gap-2 text-xs">
              {([
                ["Heat absorbed", totals.heatIn], ["Heat rejected", totals.heatOut],
                ["Work consumed", totals.workIn], ["Work produced", totals.workOut],
                ["Net heat into fluid", totals.netHeat], ["Balance residual", totals.residual],
              ] as const).map(([label, value]) => <SummaryMetric key={label} label={label}><EnergyValue value={value} /></SummaryMetric>)}
            </dl>
          </details>
          {!totals.balanced && <div className="mt-2"><Message tone="warning">Energy balance does not close. Check the connections and pair both sides of internal heat exchange. Efficiency and COP are unavailable.</Message></div>}
        </>
      )}
    </div>
  );
}

function SummaryMetric({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-start justify-between gap-2 text-ink-2"><dt>{label}</dt><dd className="shrink-0 text-right">{children}</dd></div>;
}

export function EnergyPanel({ loops, pending, error }: { loops: EnergyLoop[]; pending: boolean; error: string | null }) {
  const points = useStore((s) => s.points);
  const labels = new Map(points.map((point) => [point.id, point.label]));
  if (!loops.length) return null;
  return (
    <section className="border-b border-line px-4 pb-4 pt-2" aria-label="Energy analysis">
      <h2 className="mb-3 text-sm font-medium text-ink-2">Energy analysis</h2>
      {error ? <Message tone="error">Energy calculation failed: {error}</Message> : pending ? <p className="text-xs text-ink-3" role="status">Updating energy…</p> : (
        <div className="flex flex-col gap-2">{loops.map((loop, index) => <LoopSummary key={loop.id} loop={loop} index={index} multiple={loops.length > 1} labels={labels} />)}</div>
      )}
    </section>
  );
}
