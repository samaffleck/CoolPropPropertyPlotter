import { ChevronDown, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button, Field, IconButton, Message, QuantityInput, Section, Select } from "../components/ui";
import { cycleById, CYCLES } from "../cycles/catalog";
import { engine } from "../engine/client";
import { Prop } from "../engine/types";
import { useData } from "../state/data";
import { useStore } from "../state/store";
import { friendlyError } from "./ExplorePanel";

const CATEGORIES = [...new Set(CYCLES.map((c) => c.category))];

export function CyclePanel() {
  const cycleId = useStore((s) => s.cycleId);
  const setCycle = useStore((s) => s.setCycle);
  const params = useStore((s) => s.cycleParams);
  const setParam = useStore((s) => s.setCycleParam);
  const reset = useStore((s) => s.resetCycleParams);
  const loadSnapshot = useStore((s) => s.loadExampleSnapshot);
  const removeConnection = useStore((s) => s.removeExampleConnection);
  const exampleSnapshot = useStore((s) => s.exampleSnapshot);
  const { points } = useData();
  const def = cycleById(cycleId) ?? CYCLES[0];
  const [parametersOpen, setParametersOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadExample = async () => {
    setLoading(true);
    setError(null);
    try {
      setCycle(cycleId);
      const current = useStore.getState();
      const result = await engine.cycle(current.fluid, current.cycleId, current.cycleParams);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      loadSnapshot(
        cycleId,
        def.name,
        result.states.map((state) => ({
          id: state.id,
          label: state.id,
          input: { a: Prop.P, va: state.state.p, b: Prop.H, vb: state.state.h },
        })),
        result.segments.map((segment) => ({
          from: segment.from,
          to: segment.to,
          component: segment.component,
          kind: segment.kind,
          path: Array.from(segment.path, (value) => Number.isFinite(value) ? value : null),
        })),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The example could not be loaded.");
    } finally {
      setLoading(false);
    }
  };

  const snapshotPointIds = new Set(Object.values(exampleSnapshot?.pointIds ?? {}));
  const snapshotPoints = points.filter(({ point }) => snapshotPointIds.has(point.id));
  const labelsByPointId = new Map(snapshotPoints.map(({ point }) => [point.id, point.label]));

  return (
    <>
      <Section title="Examples">
        <Select
          label="Load example"
          value={cycleId}
          onChange={setCycle}
          options={CATEGORIES.flatMap((cat) => CYCLES.filter((c) => c.category === cat).map((c) => ({ value: c.id, label: `${cat} · ${c.name}` })))}
        />
        <p className="mt-2 text-xs text-ink-3">{def.summary}</p>
        <Button variant="primary" className="mt-3 w-full" onClick={() => void loadExample()} disabled={loading}>
          {loading ? "Loading example…" : exampleSnapshot?.cycleId === cycleId ? "Reload editable example" : "Load editable example"}
        </Button>
        {error && <div className="mt-2"><Message tone="error">{friendlyError(error)}</Message></div>}
        {exampleSnapshot && <p className="mt-2 text-xs text-ink-3">Loaded as editable state points and connections. Reloading replaces this example snapshot.</p>}
      </Section>

      <Section
        title="Parameters"
        actions={<div className="flex items-center gap-1">
          {parametersOpen && <Button variant="ghost" onClick={reset} className="h-7 px-2 text-xs" title="Restore defaults for this fluid"><RotateCcw size={13} /> Defaults</Button>}
          <button onClick={() => setParametersOpen((open) => !open)} aria-label={parametersOpen ? "Hide parameters" : "Show parameters"} aria-expanded={parametersOpen} className="rounded p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink">
            <ChevronDown size={15} className={`transition-transform ${parametersOpen ? "rotate-180" : ""}`} />
          </button>
        </div>}
      >
        {parametersOpen && <div className="flex flex-col gap-3">
          <p className="text-xs text-ink-3">These settings are used when you load or reload the example snapshot.</p>
          {def.params.map((p) =>
            p.toggle ? (
              <label key={p.key} className="flex items-center justify-between gap-3 text-xs text-ink-2">
                {p.label}
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--accent)]"
                  checked={(params[p.key] ?? p.default) > 0.5}
                  onChange={(e) => setParam(p.key, e.target.checked ? 1 : 0)}
                />
              </label>
            ) : (
              <Field key={p.key} label={p.label} help={p.help}>
                {(id) => (
                  <QuantityInput
                    id={id}
                    quantity={p.quantity}
                    value={params[p.key] ?? p.default}
                    min={p.min}
                    max={p.max}
                    onChange={(v) => setParam(p.key, v)}
                  />
                )}
              </Field>
            ),
          )}
        </div>}
      </Section>

      {exampleSnapshot && (
        <Section title={`Example connections · ${exampleSnapshot.connections.length}`}>
            <ul className="flex flex-col gap-1">
              {exampleSnapshot.connections.map((connection) => (
                <li key={connection.id} className="flex items-center gap-2 text-xs text-ink-2">
                  <span className="shrink-0 font-mono text-ink-3">{labelsByPointId.get(connection.fromPointId) ?? "?"} → {labelsByPointId.get(connection.toPointId) ?? "?"}</span>
                  <span className="min-w-0 flex-1 truncate">{connection.component}</span>
                  <IconButton label="Remove connection" onClick={() => removeConnection(connection.id)}>
                    <Trash2 size={13} />
                  </IconButton>
                </li>
              ))}
            </ul>
        </Section>
      )}
    </>
  );
}
