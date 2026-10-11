import { ArrowDown, ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button, IconButton, Message, QuantityInput, Section, Select, Value } from "../components/ui";
import { ProcessKind, Prop, type ProcessSpec, type ThermoState } from "../engine/types";
import type { ChainResult } from "../state/compute";
import { useData } from "../state/data";
import { useStore } from "../state/store";
import { COORDINATES, stateValue } from "../units/properties";
import { friendlyError } from "./ExplorePanel";
import { StateInputEditor } from "./StateInputEditor";

export const PROCESS_KINDS: { kind: ProcessKind; label: string; hint: string; targets: Prop[]; group: string }[] = [
  { kind: ProcessKind.Isobaric, label: "Isobaric", hint: "Constant pressure", targets: [Prop.T, Prop.Q, Prop.H, Prop.S, Prop.D, Prop.V], group: "Thermodynamic paths" },
  { kind: ProcessKind.Isothermal, label: "Isothermal", hint: "Constant temperature", targets: [Prop.P, Prop.S, Prop.Q, Prop.D, Prop.V], group: "Thermodynamic paths" },
  { kind: ProcessKind.Isentropic, label: "Isentropic", hint: "Constant entropy", targets: [Prop.P, Prop.T, Prop.H, Prop.D], group: "Thermodynamic paths" },
  { kind: ProcessKind.Isochoric, label: "Isochoric", hint: "Constant volume", targets: [Prop.T, Prop.P, Prop.H, Prop.S], group: "Thermodynamic paths" },
  { kind: ProcessKind.Isenthalpic, label: "Isenthalpic", hint: "Constant enthalpy", targets: [Prop.P, Prop.T], group: "Thermodynamic paths" },
  { kind: ProcessKind.Compression, label: "Compressor / pump", hint: "Adiabatic, with isentropic efficiency", targets: [Prop.P], group: "Equipment" },
  { kind: ProcessKind.Expansion, label: "Turbine / expander", hint: "Adiabatic, with isentropic efficiency", targets: [Prop.P], group: "Equipment" },
];

const kindInfo = (k: ProcessKind) => PROCESS_KINDS.find((p) => p.kind === k)!;

/** A sensible starting target for a connection, relative to its inlet state. */
function defaultSpec(kind: ProcessKind, target: Prop, from: ThermoState | null): ProcessSpec {
  const eff = kind === ProcessKind.Compression ? 0.8 : kind === ProcessKind.Expansion ? 0.85 : undefined;
  if (!from) return { kind, target, value: target === Prop.Q ? 1 : 1e6, efficiency: eff };
  const v = stateValue(from, target);
  let value: number;
  switch (target) {
    case Prop.P:
      value = kind === ProcessKind.Compression || kind === ProcessKind.Isothermal || kind === ProcessKind.Isentropic ? v * 3 : v / 3;
      break;
    case Prop.T:
      value = kind === ProcessKind.Isenthalpic ? v - 20 : v + 50;
      break;
    case Prop.Q:
      value = Number.isFinite(from.Q) && from.Q > 0.5 ? 0 : 1;
      break;
    case Prop.D:
      value = v * 2;
      break;
    case Prop.V:
      value = v / 2;
      break;
    default:
      value = v * 1.2;
  }
  return { kind, target, value, efficiency: eff };
}

export function ProcessPanel() {
  const chains = useStore((s) => s.chains);
  const addChain = useStore((s) => s.addChain);
  const { chains: results, info } = useData();

  const newChain = () => {
    const T = info ? Math.max(info.Ttriple, Math.min(300, info.Tcrit * 1.5)) : 300;
    addChain({ a: Prop.P, va: 101325, b: Prop.T, vb: T });
  };

  return (
    <>
      <Section
        title="Connections"
        actions={chains.length > 0 ? (
          <Button variant="ghost" onClick={newChain} className="h-7 px-2 text-xs">
            <Plus size={14} /> New
          </Button>
        ) : undefined}
      >
      </Section>
      {chains.map((c, i) => (
        <ChainEditor key={c.id} index={i} result={results.find((r) => r.chain.id === c.id)} chainId={c.id} />
      ))}
      {chains.length === 0 && (
        <div className="p-4">
          <Button onClick={newChain} className="w-full">
            <Plus size={14} /> Start a connection
          </Button>
        </div>
      )}
    </>
  );
}

function ChainEditor({ chainId, result, index }: { chainId: string; result?: ChainResult; index: number }) {
  const chain = useStore((s) => s.chains.find((c) => c.id === chainId))!;
  const updateChain = useStore((s) => s.updateChain);
  const removeChain = useStore((s) => s.removeChain);
  const addStep = useStore((s) => s.addStep);
  const updateStep = useStore((s) => s.updateStep);
  const removeStep = useStore((s) => s.removeStep);
  const [startOpen, setStartOpen] = useState(chain.steps.length === 0);
  const color = `var(--path-${(index % 4) + 1})`;

  const lastState = (() => {
    if (!result) return null;
    for (let i = result.steps.length - 1; i >= 0; i--) if (result.steps[i].result) return result.steps[i].result!.end;
    return result.start;
  })();

  return (
    <section className="border-b border-line px-4 py-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="h-3 w-3 rounded-full" style={{ background: color }} />
        <input
          value={chain.name}
          onChange={(e) => updateChain(chain.id, { name: e.target.value })}
          className="flex-1 bg-transparent text-[13px] font-semibold text-ink outline-none"
          aria-label="Connection name"
        />
        <IconButton label="Delete connection" onClick={() => removeChain(chain.id)}>
          <Trash2 size={14} />
        </IconButton>
      </div>

      <div className="rounded-lg border border-line">
        <button onClick={() => setStartOpen((o) => !o)} className="flex w-full items-center gap-2 px-3 py-2 text-left">
          {startOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="text-xs font-medium text-ink">Start state</span>
          {result?.start && <StateBrief state={result.start} />}
        </button>
        {startOpen && (
          <div className="border-t border-line p-3">
            <StateInputEditor value={chain.start} onChange={(start) => updateChain(chain.id, { start })} reference={result?.start ?? undefined} />
          </div>
        )}
        {result?.error && (
          <div className="px-3 pb-3">
            <Message tone="error">{friendlyError(result.error)}</Message>
          </div>
        )}
      </div>

      {chain.steps.map((st, i) => {
        const r = result?.steps.find((x) => x.id === st.id);
        const info = kindInfo(st.spec.kind);
        const prev = i === 0 ? result?.start ?? null : result?.steps[i - 1]?.result?.end ?? null;
        return (
          <div key={st.id}>
            <div className="flex justify-center py-1 text-ink-3">
              <ArrowDown size={14} />
            </div>
            <div className="rounded-lg border border-line p-3">
              <div className="mb-2 flex items-center gap-2">
            <span className="text-xs font-medium text-ink-3">Connection {i + 1}</span>
                <div className="flex-1" />
                <IconButton label="Remove step" onClick={() => removeStep(chain.id, st.id)}>
                  <Trash2 size={13} />
                </IconButton>
              </div>
              <div className="flex flex-col gap-2">
                <Select
                  label="Connection type"
                  value={st.spec.kind}
                  options={PROCESS_KINDS.map((k) => ({ value: k.kind, label: k.label, group: k.group }))}
                  onChange={(kind) => updateStep(chain.id, st.id, defaultSpec(kind, kindInfo(kind).targets[0], prev))}
                />
                <div className="grid grid-cols-2 gap-2">
                  <Select
                    label="Target property"
                    value={st.spec.target}
                    options={info.targets.map((t) => ({ value: t, label: `to ${COORDINATES[t].label.toLowerCase()}` }))}
                    onChange={(target) => updateStep(chain.id, st.id, defaultSpec(st.spec.kind, target, prev))}
                  />
                  <QuantityInput
                    label="Target value"
                    quantity={COORDINATES[st.spec.target].quantity}
                    value={st.spec.value}
                    onChange={(value) => updateStep(chain.id, st.id, { ...st.spec, value })}
                  />
                </div>
                {st.spec.efficiency !== undefined && (
                  <div className="grid grid-cols-2 items-center gap-2">
                    <span className="text-xs text-ink-2">Isentropic efficiency</span>
                    <QuantityInput
                      label="Isentropic efficiency"
                      quantity="fraction"
                      value={st.spec.efficiency}
                      min={0.05}
                      max={1}
                      onChange={(efficiency) => updateStep(chain.id, st.id, { ...st.spec, efficiency })}
                    />
                  </div>
                )}
              </div>
              {r?.error && (
                <div className="mt-2">
                  <Message tone="error">{friendlyError(r.error)}</Message>
                </div>
              )}
              {r?.result && (
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 rounded-md bg-surface-2 px-2.5 py-1.5 text-xs">
                  <span className="text-ink-3">Heat in, q</span>
                  <span className="text-right">
                    <Value value={r.result.q} quantity="specific_energy" digits={4} />
                  </span>
                  <span className="text-ink-3">Work out, w</span>
                  <span className="text-right">
                    <Value value={r.result.w} quantity="specific_energy" digits={4} />
                  </span>
                  <span className="col-span-2 mt-1 text-ink-2">
                    → <StateBrief state={r.result.end} />
                  </span>
                </div>
              )}
            </div>
          </div>
        );
      })}

      <Button
        variant="ghost"
        className="mt-2 w-full border border-dashed border-line"
        onClick={() => addStep(chain.id, defaultSpec(ProcessKind.Isobaric, Prop.T, lastState))}
      >
        <Plus size={14} /> Add connection
      </Button>
    </section>
  );
}

function StateBrief({ state }: { state: ThermoState }) {
  return (
    <span className="truncate text-xs text-ink-2">
      <Value value={state.T} quantity="temperature" digits={4} /> · <Value value={state.p} quantity="pressure" digits={4} />
      {Number.isFinite(state.Q) && <span className="text-ink-3"> · x={state.Q.toFixed(3)}</span>}
    </span>
  );
}
