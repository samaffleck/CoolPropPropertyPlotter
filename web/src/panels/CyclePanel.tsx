import { Trash2 } from "lucide-react";
import { IconButton, Section } from "../components/ui";
import { useData } from "../state/data";
import { useStore } from "../state/store";

export function CyclePanel() {
  const removeConnection = useStore((s) => s.removeExampleConnection);
  const exampleSnapshot = useStore((s) => s.exampleSnapshot);
  const { points } = useData();

  const snapshotPointIds = new Set(Object.values(exampleSnapshot?.pointIds ?? {}));
  const snapshotPoints = points.filter(({ point }) => snapshotPointIds.has(point.id));
  const labelsByPointId = new Map(snapshotPoints.map(({ point }) => [point.id, point.label]));

  return (
    <>
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
