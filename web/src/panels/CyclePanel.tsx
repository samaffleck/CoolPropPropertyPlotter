import { ChevronDown, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Button, Field, Message, QuantityInput, Section, Select } from "../components/ui";
import { cycleById, CYCLES } from "../cycles/catalog";
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
  const { cycleError, cycle } = useData();
  const def = cycleById(cycleId) ?? CYCLES[0];
  const [parametersOpen, setParametersOpen] = useState(false);

  return (
    <>
      <Section title="Cycle">
        <Select
          label="Cycle"
          value={cycleId}
          onChange={setCycle}
          options={CATEGORIES.flatMap((cat) => CYCLES.filter((c) => c.category === cat).map((c) => ({ value: c.id, label: `${cat} · ${c.name}` })))}
        />
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

      {(cycleError || (cycle && cycle.warnings.length > 0)) && (
        <div className="flex flex-col gap-2 px-4 py-4">
          {cycleError && <Message tone="error">{friendlyError(cycleError)}</Message>}
          {cycle?.warnings.map((w) => (
            <Message key={w} tone="warning">
              {w}
            </Message>
          ))}
        </div>
      )}
    </>
  );
}
