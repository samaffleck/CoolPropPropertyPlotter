import { Plus, Trash2 } from "lucide-react";
import { Button, IconButton, Message, QuantityInput, Select } from "../components/ui";
import { ProcessKind, Prop, type ProcessSpec, type ThermoState } from "../engine/types";
import type { ChainResult, PointResult } from "../state/compute";
import { useData } from "../state/data";
import { useStore } from "../state/store";
import { COORDINATES, stateValue } from "../units/properties";
import { friendlyError } from "./errors";

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

/** Pick a nearby target value so a new connection immediately has a valid endpoint. */
function specForNewEndpoint(kind: ProcessKind, from: ThermoState | null): ProcessSpec {
  const eff = kind === ProcessKind.Compression ? 0.8 : kind === ProcessKind.Expansion ? 0.85 : undefined;
  const targets = kindInfo(kind).targets;
  const target = targets.includes(Prop.T) ? Prop.T : targets[0];
  const current = from ? stateValue(from, target) : target === Prop.P ? 1e6 : 300;
  const direction = kind === ProcessKind.Expansion ? -1 : 1;
  const value = target === Prop.Q
    ? Math.min(1, current + 0.1)
    : current + direction * Math.max(Math.abs(current) * 0.05, target === Prop.T ? 5 : 1);
  return { kind, target, value, efficiency: eff };
}

export function ProcessPanel() {
  const chains = useStore((s) => s.chains);
  const addChain = useStore((s) => s.addChain);
  const { chains: results, points } = useData();
  const availablePoints = points.filter((point): point is PointResult & { state: ThermoState } => !!point.state);
  const firstPoint = availablePoints[0];

  const newChain = () => {
    if (!firstPoint) return;
    addChain(
      firstPoint.point.input,
      specForNewEndpoint(ProcessKind.Isobaric, firstPoint.state),
      { fromPointId: firstPoint.point.id, generatedEndpoint: true },
    );
  };

  const chain = chains[0];

  return (
    <>
      <section className="border-b-0 px-4 py-2">
        <div className="grid grid-cols-[1fr_auto] items-center gap-2">
          <h2 className="text-sm font-medium text-ink-2">Connections</h2>
          {!chain && (
            <Button onClick={newChain} disabled={!firstPoint} variant="ghost" className="h-8 w-auto px-2">
              <Plus size={14} /> Add connection
            </Button>
          )}
        </div>
        {!firstPoint && <p className="mt-2 text-xs text-ink-3">Add a state point on the plot to start a connection.</p>}
      </section>
      {chain && <ChainEditor result={results.find((r) => r.chain.id === chain.id)} chainId={chain.id} points={availablePoints} />}
    </>
  );
}

function ChainEditor({ chainId, result, points }: { chainId: string; result?: ChainResult; points: (PointResult & { state: ThermoState })[] }) {
  const chain = useStore((s) => s.chains.find((c) => c.id === chainId))!;
  const addStep = useStore((s) => s.addStep);
  const updateStep = useStore((s) => s.updateStep);
  const removeStep = useStore((s) => s.removeStep);
  const addConnection = () => {
    if (points.length < 1) return;
    const from = points[0];
    addStep(chain.id, specForNewEndpoint(ProcessKind.Isobaric, from.state), { fromPointId: from.point.id, generatedEndpoint: true });
  };

  return (
    <section className="border-b border-line px-4 py-3">
      {result?.error && <Message tone="error">{friendlyError(result.error)}</Message>}
      {chain.steps.map((st, i) => {
        const r = result?.steps.find((x) => x.id === st.id);
        const fromId = st.fromPointId ?? "";
        const from = points.find((point) => point.point.id === fromId);
        const to = points.find((point) => point.point.id === st.toPointId);
        const targetOptions = kindInfo(st.spec.kind).targets.map((prop) => ({ value: prop, label: `${COORDINATES[prop].label} (${COORDINATES[prop].symbol})` }));
        const updateKind = (kind: ProcessKind) => {
          const nextSpec = specForNewEndpoint(kind, from?.state ?? null);
          updateStep(chain.id, st.id, { spec: nextSpec, generatedEndpoint: true });
        };
        return (
          <div key={st.id} className="mb-3 rounded-lg border border-line p-2.5 last:mb-0">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-ink">Connection {i + 1}</span>
              <IconButton label="Remove connection" onClick={() => removeStep(chain.id, st.id)}>
                <Trash2 size={13} />
              </IconButton>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
              <Select
                label="From point"
                value={fromId}
                options={[
                  { value: "", label: "Select point…" },
                  ...points.map(({ point }) => ({ value: point.id, label: `Point ${point.label}` })),
                ]}
                onChange={(nextFromId) => updateStep(chain.id, st.id, { fromPointId: nextFromId || undefined, generatedEndpoint: true })}
              />
              <span className="pb-2 text-xs text-ink-3">→ Point {to?.point.label ?? "…"}</span>
            </div>
            <div className="mt-2 grid grid-cols-1 items-end gap-2">
              <Select
                label="Process"
                value={st.spec.kind}
                options={PROCESS_KINDS.map((kind) => ({ value: kind.kind, label: kind.label, group: kind.group }))}
                onChange={updateKind}
              />
              <Select
                label="Endpoint property"
                value={st.spec.target}
                options={targetOptions}
                onChange={(target) => {
                  const current = from?.state ? stateValue(from.state, target) : 300;
                  const direction = st.spec.kind === ProcessKind.Expansion ? -1 : 1;
                  const value = target === Prop.Q
                    ? Math.min(1, current + 0.1)
                    : current + direction * Math.max(Math.abs(current) * 0.05, target === Prop.T ? 5 : 1);
                  updateStep(chain.id, st.id, { spec: { ...st.spec, target, value } });
                }}
              />
              <QuantityInput
                label={`${COORDINATES[st.spec.target].label} value`}
                quantity={COORDINATES[st.spec.target].quantity}
                value={st.spec.value}
                min={st.spec.target === Prop.Q ? 0 : undefined}
                max={st.spec.target === Prop.Q ? 1 : undefined}
                onChange={(value) => updateStep(chain.id, st.id, { spec: { ...st.spec, value } })}
              />
              {st.spec.efficiency !== undefined && (
                <QuantityInput
                  label="Efficiency"
                  quantity="fraction"
                  value={st.spec.efficiency}
                  min={0.05}
                  max={1}
                  onChange={(efficiency) => updateStep(chain.id, st.id, {
                    spec: { ...st.spec, efficiency },
                    generatedEndpoint: true,
                  })}
                />
              )}
            </div>
            {r?.error && <div className="mt-2"><Message tone="error">{friendlyError(r.error)}</Message></div>}
          </div>
        );
      })}

      <Button
        variant="ghost"
        className="mt-2 w-full"
        onClick={addConnection}
        disabled={points.length < 1}
      >
        <Plus size={14} /> Add connection
      </Button>
    </section>
  );
}
