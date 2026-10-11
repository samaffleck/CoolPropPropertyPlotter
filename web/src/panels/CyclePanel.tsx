import { RotateCcw } from "lucide-react";
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
  const fluid = useStore((s) => s.fluid);
  const setFluid = useStore((s) => s.setFluid);
  const { cycleError, cycle } = useData();
  const def = cycleById(cycleId) ?? CYCLES[0];

  return (
    <>
      <Section title="Cycle">
        <Select
          label="Cycle"
          value={cycleId}
          onChange={setCycle}
          options={CATEGORIES.flatMap((cat) => CYCLES.filter((c) => c.category === cat).map((c) => ({ value: c.id, label: `${cat} · ${c.name}` })))}
        />
        <p className="mt-3 text-xs leading-relaxed text-ink-2">{def.description}</p>
        <div className="mt-3">
          <div className="mb-1.5 text-xs text-ink-3">Typical working fluids</div>
          <div className="flex flex-wrap gap-1">
            {def.fluids.map((f) => (
              <button
                key={f}
                onClick={() => setFluid(f)}
                className={`rounded-full border px-2 py-0.5 text-xs ${f === fluid ? "border-accent bg-accent/10 text-ink" : "border-line text-ink-2 hover:bg-surface-2"}`}
              >
                {f}
              </button>
            ))}
          </div>
          {!def.fluids.includes(fluid) && (
            <p className="mt-2 text-xs text-ink-3">{fluid} is not a typical fluid for this cycle; defaults may not converge.</p>
          )}
        </div>
      </Section>

      <Section
        title="Parameters"
        actions={
          <Button variant="ghost" onClick={reset} className="h-7 px-2 text-xs" title="Restore defaults for this fluid">
            <RotateCcw size={13} /> Defaults
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
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
        </div>
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
