import { Plus, Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button, IconButton, Message, QuantityInput, Select } from "../components/ui";
import { ProcessKind, Prop, type ProcessSpec, type ThermoState } from "../engine/types";
import { engine } from "../engine/client";
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

/** Keep the selected destination value for the endpoint property, then fit the rest to the process. */
function specForConnection(kind: ProcessKind, to: ThermoState | null): ProcessSpec {
  const eff = kind === ProcessKind.Compression ? 0.8 : kind === ProcessKind.Expansion ? 0.85 : undefined;
  const targets = kindInfo(kind).targets;
  const target = targets.includes(Prop.T) ? Prop.T : targets[0];
  const value = to ? stateValue(to, target) : target === Prop.P ? 1e6 : 300;
  return { kind, target, value, efficiency: eff };
}

export function ProcessPanel() {
  const chains = useStore((s) => s.chains);
  const addChain = useStore((s) => s.addChain);
  const { chains: results, points } = useData();
  const availablePoints = points.filter((point): point is PointResult & { state: ThermoState } => !!point.state);
  const canConnect = availablePoints.length >= 2;

  const newChain = () => {
    if (!canConnect) return;
    const [from, to] = availablePoints;
    addChain(
      from.point.input,
      specForConnection(ProcessKind.Isobaric, to.state),
      { fromPointId: from.point.id, toPointId: to.point.id },
    );
  };

  const chain = chains[0];

  return (
    <>
      <section className="border-b-0 px-4 py-2">
        <div className="grid grid-cols-[1fr_auto] items-center gap-2">
          <h2 className="text-sm font-medium text-ink-2">Connections</h2>
          {!chain && (
            <Button onClick={newChain} disabled={!canConnect} variant="ghost" className="h-8 w-auto px-2">
              <Plus size={14} /> Add connection
            </Button>
          )}
        </div>
        {!canConnect && <p className="mt-2 text-xs text-ink-3">Add two state points on the plot to connect them.</p>}
      </section>
      {chain && <ChainEditor result={results.find((r) => r.chain.id === chain.id)} chainId={chain.id} points={availablePoints} />}
    </>
  );
}

function ChainEditor({ chainId, result, points }: { chainId: string; result?: ChainResult; points: (PointResult & { state: ThermoState })[] }) {
  const chain = useStore((s) => s.chains.find((c) => c.id === chainId))!;
  const fluid = useStore((s) => s.fluid);
  const updatePoint = useStore((s) => s.updatePoint);
  const addStep = useStore((s) => s.addStep);
  const updateStep = useStore((s) => s.updateStep);
  const removeStep = useStore((s) => s.removeStep);
  const fitRequests = useRef(new Map<string, string>());

  const fitConnection = async (stepId: string, fromId: string, toId: string, spec: ProcessSpec) => {
    const from = points.find((point) => point.point.id === fromId);
    const to = points.find((point) => point.point.id === toId);
    if (!from?.state || !to?.state || fromId === toId) return;
    const fittedSpec = { ...spec, value: stateValue(to.state, spec.target) };
    const requestKey = JSON.stringify([from.point.input, to.point.input, fittedSpec]);
    if (fitRequests.current.get(stepId) === requestKey) return;
    fitRequests.current.set(stepId, requestKey);
    const currentChain = useStore.getState().chains.find((candidate) => candidate.id === chainId);
    const currentStep = currentChain?.steps.find((step) => step.id === stepId);
    if (!currentStep || currentStep.fromPointId !== fromId || currentStep.toPointId !== toId) return;
    updateStep(chainId, stepId, { spec: fittedSpec });
    try {
      const calculated = await engine.process(fluid, from.point.input, fittedSpec);
      const latestChain = useStore.getState().chains.find((candidate) => candidate.id === chainId);
      const latestStep = latestChain?.steps.find((step) => step.id === stepId);
      if (!calculated.ok || fitRequests.current.get(stepId) !== requestKey
        || latestStep?.fromPointId !== fromId || latestStep.toPointId !== toId
        || JSON.stringify(latestStep.spec) !== JSON.stringify(fittedSpec)) return;
      updatePoint(toId, { input: { a: Prop.P, va: calculated.end.p, b: Prop.H, vb: calculated.end.h } });
    } catch {
      // The connection result below will surface the calculation error.
    }
  };

  // Imported and migrated examples, plus connections affected by moving a point, are fitted too.
  useEffect(() => {
    const resultById = new Map((result?.steps ?? []).map((step) => [step.id, step] as const));
    for (const step of chain.steps) {
      if (resultById.get(step.id)?.error !== "The selected end point does not match this process.") continue;
      if (step.fromPointId && step.toPointId) void fitConnection(step.id, step.fromPointId, step.toPointId, step.spec);
    }
    const activeIds = new Set(chain.steps.map((step) => step.id));
    for (const id of fitRequests.current.keys()) if (!activeIds.has(id)) fitRequests.current.delete(id);
  }, [chain.steps, points, result]);

  const addConnection = () => {
    if (points.length < 2) return;
    const [from, to] = points;
    addStep(chain.id, specForConnection(ProcessKind.Isobaric, to.state), { fromPointId: from.point.id, toPointId: to.point.id });
  };

  return (
    <section className="border-b border-line px-4 py-3">
      {result?.error && <Message tone="error">{friendlyError(result.error)}</Message>}
      {chain.steps.map((st, i) => {
        const r = result?.steps.find((x) => x.id === st.id);
        const fromId = st.fromPointId ?? "";
        const toId = st.toPointId ?? "";
        const to = points.find((point) => point.point.id === toId);
        const targetOptions = kindInfo(st.spec.kind).targets.map((prop) => ({ value: prop, label: `${COORDINATES[prop].label} (${COORDINATES[prop].symbol})` }));
        const updateKind = (kind: ProcessKind) => {
          const nextSpec = specForConnection(kind, to?.state ?? null);
          updateStep(chain.id, st.id, { spec: nextSpec });
        };
        return (
          <div key={st.id} className="mb-3 rounded-lg border border-line p-2.5 last:mb-0">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-ink">Connection {i + 1}</span>
              <IconButton label="Remove connection" onClick={() => removeStep(chain.id, st.id)}>
                <Trash2 size={13} />
              </IconButton>
            </div>
            <div className="grid grid-cols-2 items-end gap-2">
              <Select
                label="From point"
                value={fromId}
                options={[
                  { value: "", label: "Select point…" },
                  ...points.filter(({ point }) => point.id !== toId).map(({ point }) => ({ value: point.id, label: `Point ${point.label}` })),
                ]}
                onChange={(nextFromId) => updateStep(chain.id, st.id, { fromPointId: nextFromId || undefined })}
              />
              <Select
                label="To point"
                value={toId}
                options={[
                  { value: "", label: "Select point…" },
                  ...points.filter(({ point }) => point.id !== fromId).map(({ point }) => ({ value: point.id, label: `Point ${point.label}` })),
                ]}
                onChange={(nextToId) => updateStep(chain.id, st.id, { toPointId: nextToId || undefined })}
              />
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
                  const value = to?.state ? stateValue(to.state, target) : st.spec.value;
                  updateStep(chain.id, st.id, { spec: { ...st.spec, target, value } });
                }}
              />
              <p className="text-[11px] text-ink-3">Point {to?.point.label ?? "2"} will move to match the process.</p>
              {st.spec.efficiency !== undefined && (
                <QuantityInput
                  label="Efficiency"
                  quantity="fraction"
                  value={st.spec.efficiency}
                  min={0.05}
                  max={1}
                  onChange={(efficiency) => updateStep(chain.id, st.id, {
                    spec: { ...st.spec, efficiency },
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
        disabled={points.length < 2}
      >
        <Plus size={14} /> Add connection
      </Button>
    </section>
  );
}
