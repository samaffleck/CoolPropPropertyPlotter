import { Trash2 } from "lucide-react";
import { IconButton, Section } from "../components/ui";
import { useData } from "../state/data";
import { useStore } from "../state/store";

export function ExplorePanel() {
  const removePoint = useStore((s) => s.removePoint);
  const clearPoints = useStore((s) => s.clearPoints);
  const selectedPointId = useStore((s) => s.selectedPointId);
  const setSelectedPoint = useStore((s) => s.setSelectedPoint);
  const { points } = useData();

  return (
      <Section
        title={`State points${points.length ? ` · ${points.length}` : ""}`}
        actions={
          points.length > 0 && (
            <button onClick={clearPoints} className="text-xs text-ink-3 hover:text-danger">
              Clear all
            </button>
          )
        }
      >
        {points.length === 0 ? (
          <p className="text-xs text-ink-3">Click the chart to add a state point.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {points.map(({ point }) => (
              <li key={point.id} className="flex items-center gap-2 rounded-md pr-1 hover:bg-surface-2">
                <button
                  type="button"
                  aria-label={`Show state ${point.label} details`}
                  aria-pressed={selectedPointId === point.id}
                  onClick={() => setSelectedPoint(point.id)}
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left ${selectedPointId === point.id ? "bg-surface-2" : ""}`}
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-accent text-[10px] font-semibold">{point.label}</span>
                </button>
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

export function friendlyError(e: string): string {
  if (/unsupported input pair/.test(e)) return "That pair of properties cannot define a state. Choose two independent properties.";
  if (/out of range|outside|bounds|not valid/i.test(e)) return `No valid state: ${e}`;
  return e.length > 180 ? `${e.slice(0, 180)}…` : e;
}
