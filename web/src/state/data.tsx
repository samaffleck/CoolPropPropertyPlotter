// Computes shared thermodynamic data once and exposes it to the chart and the panels.
import { createContext, useContext, type ReactNode } from "react";
import type { CycleResult, FluidInfo, Saturation } from "../engine/types";
import { cycleById, CYCLES, defaultParams } from "../cycles/catalog";
import { continueFrom, useChains, useCycle, useFluidInfo, usePointStates, useSaturation, type ChainResult, type PointResult } from "./compute";
import { useStore, type ExampleSnapshot, type PinnedPoint } from "./store";

interface Data {
  info: FluidInfo | null;
  infoError: string | null;
  saturation: Saturation | null;
  points: PointResult[];
  chains: ChainResult[];
  cycle: CycleResult | null;
  exampleSnapshot: ExampleSnapshot | null;
}

const Ctx = createContext<Data | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const fluid = useStore((s) => s.fluid);
  const mode = useStore((s) => s.mode);
  const points = useStore((s) => s.points);
  const chains = useStore((s) => s.chains);
  const cycleId = useStore((s) => s.cycleId);
  const exampleSnapshot = useStore((s) => s.exampleSnapshot);
  const cycle = cycleById(cycleId) ?? CYCLES[0];

  const info = useFluidInfo(fluid);
  const saturation = useSaturation(fluid);
  const pointStates = usePointStates(fluid, points);
  const chainResults = useChains(fluid, chains, pointStates.data ?? []);
  const computedPoints: PointResult[] = chainResults.data?.flatMap((chainResult) => chainResult.steps.flatMap((step) => {
    const sourceId = chainResult.chain.steps.find((candidate) => candidate.id === step.id)?.fromPointId;
    const source = (pointStates.data ?? []).find(({ point }) => point.id === sourceId)?.point
      ?? computedPointsForSource(chainResult, sourceId);
    const toPointId = chainResult.chain.steps.find((candidate) => candidate.id === step.id)?.toPointId;
    if (!step.generatedEndpoint || !step.result || !toPointId) return [];
    const endpointLabel = chainResult.chain.steps.find((candidate) => candidate.id === step.id)?.endpointLabel;
    const point: PinnedPoint = { id: toPointId, label: endpointLabel ?? `${source?.label ?? "?"}′`, input: continueFrom(step.result.end), generated: true };
    return [{ point, state: step.result.end }];
  })) ?? [];
  const cycleResult = useCycle(mode === "cycle", fluid, cycleId, defaultParams(cycle, fluid));

  const value: Data = {
    info: info.data ?? null,
    infoError: info.error,
    saturation: saturation.data,
    points: [...(pointStates.data ?? []), ...computedPoints],
    chains: chainResults.data ?? [],
    cycle: cycleResult.data?.ok ? cycleResult.data.result : null,
    exampleSnapshot,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function computedPointsForSource(chainResult: ChainResult, pointId?: string): PinnedPoint | undefined {
  if (!pointId) return undefined;
  const producingStep = [...chainResult.chain.steps].reverse().find((step) => step.generatedEndpoint && step.toPointId === pointId);
  if (!producingStep) return undefined;
  const result = chainResult.steps.find((step) => step.id === producingStep.id)?.result;
  return result ? { id: pointId, label: producingStep.endpointLabel ?? "′", input: continueFrom(result.end), generated: true } : undefined;
}

export function useData(): Data {
  const d = useContext(Ctx);
  if (!d) throw new Error("useData outside DataProvider");
  return d;
}
