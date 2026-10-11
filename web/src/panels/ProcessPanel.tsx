import { ArrowRight, Plus, Trash2 } from "lucide-react";
import { useEffect } from "react";
import { Button, IconButton, Message, Select } from "../components/ui";
import { ProcessKind, Prop, type ThermoState } from "../engine/types";
import type { ChainResult, PointResult } from "../state/compute";
import { inputValue, processSpecForEndpoints, replaceInputProperty, setInputValue, sharedPropertyForProcess } from "../state/connections";
import { useData } from "../state/data";
import { useStore, type ProcessChain } from "../state/store";
import { stateValue } from "../units/properties";
import { friendlyError } from "./errors";

export const PROCESS_KINDS: { kind: ProcessKind; label: string }[] = [
  { kind: ProcessKind.Isobaric, label: "Isobaric" },
  { kind: ProcessKind.Isothermal, label: "Isothermal" },
  { kind: ProcessKind.Isentropic, label: "Isentropic" },
  { kind: ProcessKind.Isochoric, label: "Isochoric" },
  { kind: ProcessKind.Isenthalpic, label: "Isenthalpic" },
  { kind: ProcessKind.Compression, label: "Compressor / pump" },
  { kind: ProcessKind.Expansion, label: "Turbine / expander" },
];

const REPLACEMENT_PRIORITY = [Prop.D, Prop.H, Prop.S, Prop.Q, Prop.P, Prop.T];

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
      processSpecForEndpoints(ProcessKind.Isobaric, to.point.input),
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
      {chain && <ChainEditor result={results.find((result) => result.chain.id === chain.id)} chainId={chain.id} points={availablePoints} />}
    </>
  );
}

function ChainEditor({ chainId, result, points }: { chainId: string; result?: ChainResult; points: (PointResult & { state: ThermoState })[] }) {
  const chain = useStore((s) => s.chains.find((candidate) => candidate.id === chainId))!;
  const updatePoint = useStore((s) => s.updatePoint);
  const addStep = useStore((s) => s.addStep);
  const updateStep = useStore((s) => s.updateStep);
  const removeStep = useStore((s) => s.removeStep);

  useEffect(() => {
    const pointsById = new Map(points.map((point) => [point.point.id, point] as const));
    const currentInputs = new Map(useStore.getState().points.map((point) => [point.id, point.input] as const));
    for (const step of chain.steps) {
      if (!step.fromPointId || !step.toPointId || step.fromPointId === step.toPointId) continue;
      const from = pointsById.get(step.fromPointId);
      const to = pointsById.get(step.toPointId);
      if (!from?.state || !to?.state) continue;
      // Point calculations are asynchronous. Don't apply a connection adjustment
      // using a result for inputs that have already changed in the store.
      if (JSON.stringify(currentInputs.get(from.point.id)) !== JSON.stringify(from.point.input)
        || JSON.stringify(currentInputs.get(to.point.id)) !== JSON.stringify(to.point.input)) continue;

      const held = sharedPropertyForProcess(step.spec.kind);
      let fromInput = from.point.input;
      let toInput = to.point.input;
      if (held !== null) {
        if (inputValue(fromInput, held) === undefined) {
          const replaceProp = replacementProperty(fromInput, held, chain.steps, step.id, from.point.id);
          if (replaceProp === undefined) continue;
          fromInput = replaceInputProperty(fromInput, replaceProp, held, stateValue(from.state, held));
        }
        if (inputValue(toInput, held) === undefined) {
          const replaceProp = replacementProperty(toInput, held, chain.steps, step.id, to.point.id);
          if (replaceProp === undefined) continue;
          toInput = replaceInputProperty(toInput, replaceProp, held, stateValue(from.state, held));
        }
        toInput = setInputValue(toInput, held, stateValue(from.state, held));
      }

      if (JSON.stringify(fromInput) !== JSON.stringify(from.point.input)) updatePoint(from.point.id, { input: fromInput });
      if (JSON.stringify(toInput) !== JSON.stringify(to.point.input)) updatePoint(to.point.id, { input: toInput });

      const spec = processSpecForEndpoints(step.spec.kind, toInput);
      if (JSON.stringify(spec) !== JSON.stringify(step.spec)) updateStep(chainId, step.id, { spec });
    }
  }, [chain.steps, chainId, points, updatePoint, updateStep]);

  const addConnection = () => {
    if (points.length < 2) return;
    const [from, to] = points;
    addStep(
      chain.id,
      processSpecForEndpoints(ProcessKind.Isobaric, to.point.input),
      { fromPointId: from.point.id, toPointId: to.point.id },
    );
  };

  return (
    <section className="border-b border-line px-4 py-3">
      {chain.steps.map((step) => {
        const resultStep = result?.steps.find((candidate) => candidate.id === step.id);
        const fromId = step.fromPointId ?? "";
        const toId = step.toPointId ?? "";
        const to = points.find((point) => point.point.id === toId);
        const updateKind = (kind: ProcessKind) => {
          updateStep(chain.id, step.id, {
            spec: processSpecForEndpoints(kind, to?.point.input ?? { a: Prop.P, va: 1e5, b: Prop.H, vb: 3e5 }),
          });
        };
        const updateEndpoint = (side: "from" | "to", id: string) => {
          updateStep(chain.id, step.id, side === "from"
            ? { fromPointId: id || undefined }
            : { toPointId: id || undefined });
        };

        return (
          <div key={step.id} className="mb-3 rounded-lg border border-line p-2.5 last:mb-0">
            <div className="grid grid-cols-[1fr_auto_1fr_auto] items-end gap-2">
              <Select
                label="From point"
                value={fromId}
                options={[
                  { value: "", label: "Select point…" },
                  ...points.filter(({ point }) => point.id !== toId).map(({ point }) => ({ value: point.id, label: `Point ${point.label}` })),
                ]}
                onChange={(id) => updateEndpoint("from", id)}
              />
              <ArrowRight size={16} aria-hidden="true" className="mb-2 text-ink-3" />
              <Select
                label="To point"
                value={toId}
                options={[
                  { value: "", label: "Select point…" },
                  ...points.filter(({ point }) => point.id !== fromId).map(({ point }) => ({ value: point.id, label: `Point ${point.label}` })),
                ]}
                onChange={(id) => updateEndpoint("to", id)}
              />
              <IconButton label="Remove connection" onClick={() => removeStep(chain.id, step.id)}>
                <Trash2 size={13} />
              </IconButton>
            </div>
            <div className="mt-2">
              <Select
                label="Path"
                value={step.spec.kind}
                options={PROCESS_KINDS.map((process) => ({ value: process.kind, label: process.label }))}
                onChange={updateKind}
              />
            </div>
            {resultStep?.error && <div className="mt-2"><Message tone="error">{friendlyError(resultStep.error)}</Message></div>}
          </div>
        );
      })}
      <Button variant="ghost" className="mt-2 w-full" onClick={addConnection} disabled={points.length < 2}>
        <Plus size={14} /> Add connection
      </Button>
    </section>
  );
}

function replacementProperty(
  input: PointResult["point"]["input"],
  held: Prop,
  steps: ProcessChain["steps"],
  currentStepId: string,
  pointId: string,
): Prop | undefined {
  const lockedElsewhere = new Set(steps.flatMap((step) => {
    if (step.id === currentStepId || step.fromPointId !== pointId && step.toPointId !== pointId) return [];
    const property = sharedPropertyForProcess(step.spec.kind);
    return property !== null ? [property] : [];
  }));
  return REPLACEMENT_PRIORITY.find((property) =>
    property !== held && !lockedElsewhere.has(property) && inputValue(input, property) !== undefined,
  );
}
