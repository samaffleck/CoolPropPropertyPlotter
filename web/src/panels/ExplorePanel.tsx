import { Trash2 } from "lucide-react";
import { IconButton, Section } from "../components/ui";
import { type ThermoState } from "../engine/types";
import { useData } from "../state/data";
import { useStore } from "../state/store";
import { formatNumber, toDisplay, unitOf } from "../units/units";

export function ExplorePanel() {
  const removePoint = useStore((s) => s.removePoint);
  const clearPoints = useStore((s) => s.clearPoints);
  const { points } = useData();

  return (
      <Section
        title={`States${points.length ? ` · ${points.length}` : ""}`}
        actions={
          points.length > 0 && (
            <button onClick={clearPoints} className="text-xs text-ink-3 hover:text-danger">
              Clear all
            </button>
          )
        }
      >
        {points.length === 0 ? (
          <p className="text-xs text-ink-3">Click the chart to add a state.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {points.map(({ point, state: s, error: e }) => (
              <li key={point.id} className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-surface-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-accent text-[10px] font-semibold">{point.label}</span>
                <span className="flex-1 truncate text-xs text-ink-2">
                  {s ? <PointSummary state={s} /> : <span className="text-danger">{e}</span>}
                </span>
                <IconButton label="Remove" onClick={() => removePoint(point.id)}>
                  <Trash2 size={13} />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </Section>
  );
}

function PointSummary({ state }: { state: ThermoState }) {
  const units = useStore((s) => s.units);
  const T = unitOf(units, "temperature");
  const P = unitOf(units, "pressure");
  return (
    <span className="tabular">
      {formatNumber(toDisplay(T, state.T), 4)} {T.label} · {formatNumber(toDisplay(P, state.p), 4)} {P.label}
      {Number.isFinite(state.Q) ? ` · x=${formatNumber(state.Q, 3)}` : ` · ${state.phase}`}
    </span>
  );
}

export function friendlyError(e: string): string {
  if (/unsupported input pair/.test(e)) return "That pair of properties cannot define a state. Choose two independent properties.";
  if (/out of range|outside|bounds|not valid/i.test(e)) return `No valid state: ${e}`;
  return e.length > 180 ? `${e.slice(0, 180)}…` : e;
}
