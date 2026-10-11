import { Pin, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, IconButton, Message, Section, Select, Value } from "../components/ui";
import { engine } from "../engine/client";
import { Prop, type StateInput, type ThermoState } from "../engine/types";
import { useData } from "../state/data";
import { useStore } from "../state/store";
import { STATE_PROPERTIES } from "../units/properties";
import { formatNumber, toDisplay, unitOf } from "../units/units";
import { StateInputEditor } from "./StateInputEditor";

export function ExplorePanel() {
  const fluid = useStore((s) => s.fluid);
  const addPoint = useStore((s) => s.addPoint);
  const removePoint = useStore((s) => s.removePoint);
  const clearPoints = useStore((s) => s.clearPoints);
  const density = useStore((s) => s.density);
  const setDensity = useStore((s) => s.setDensity);
  const { info, points } = useData();

  const [input, setInput] = useState<StateInput>({ a: Prop.P, va: 101325, b: Prop.Q, vb: 0 });
  const [state, setState] = useState<ThermoState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    engine.state(fluid, input).then((r) => {
      if (!live) return;
      setState(r.ok ? r.state : null);
      setError(r.ok ? null : r.error);
    });
    return () => {
      live = false;
    };
  }, [fluid, input]);

  const reference = state ?? (info ? { T: info.Tcrit * 0.8, p: info.pcrit * 0.2, h: info.hcrit, s: info.scrit, rho: info.rhocrit } : undefined);

  return (
    <>
      <Section title="State calculator">
        <div className="flex flex-col gap-3">
          <StateInputEditor value={input} onChange={setInput} reference={reference} />
          {error && <Message tone="error">{friendlyError(error)}</Message>}
          {state && <StateTable state={state} />}
          <Button variant="primary" onClick={() => addPoint(input)} disabled={!state}>
            <Pin size={14} /> Pin to chart
          </Button>
        </div>
      </Section>

      <Section
        title={`Pinned states (${points.length})`}
        actions={
          points.length > 0 && (
            <button onClick={clearPoints} className="text-xs text-ink-3 hover:text-danger">
              Clear all
            </button>
          )
        }
      >
        {points.length === 0 ? (
          <p className="text-xs leading-relaxed text-ink-3">Click anywhere on the chart, or use the calculator above, to pin a state.</p>
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

      <Section title="Chart">
        <div className="flex items-center justify-between gap-3">
          <label className="text-xs text-ink-2" htmlFor="density">
            Isoline density
          </label>
          <Select
            id="density"
            className="w-32"
            value={density}
            onChange={setDensity}
            options={[
              { value: 6, label: "Sparse" },
              { value: 10, label: "Normal" },
              { value: 16, label: "Dense" },
            ]}
          />
        </div>
        <p className="mt-3 text-xs leading-relaxed text-ink-3">
          Scroll to zoom (over an axis to zoom just that axis), drag to pan, double-click to reset. Isolines are recomputed with round values as you zoom.
        </p>
      </Section>
    </>
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

export function StateTable({ state }: { state: ThermoState }) {
  return (
    <div className="rounded-lg border border-line">
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
        <span className="text-xs font-medium capitalize text-ink">{state.phase}</span>
      </div>
      <table className="w-full text-xs">
        <tbody>
          {STATE_PROPERTIES.filter((p) => Number.isFinite(state[p.key] as number)).map((p) => (
            <tr key={p.key} className="border-b border-line/60 last:border-0">
              <td className="py-1 pl-3 text-ink-2">{p.label}</td>
              <td className="w-8 py-1 text-ink-3">{p.symbol}</td>
              <td className="py-1 pr-3 text-right text-ink">
                <Value value={state[p.key] as number} quantity={p.quantity} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function friendlyError(e: string): string {
  if (/unsupported input pair/.test(e)) return "That pair of properties cannot define a state. Choose two independent properties.";
  if (/out of range|outside|bounds|not valid/i.test(e)) return `No valid state: ${e}`;
  return e.length > 180 ? `${e.slice(0, 180)}…` : e;
}
