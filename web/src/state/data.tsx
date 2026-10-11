// Computes shared thermodynamic data once and exposes it to the chart and the panels.
import { createContext, useContext, type ReactNode } from "react";
import type { CycleResult, FluidInfo, Saturation } from "../engine/types";
import { useChains, useCycle, useFluidInfo, usePointStates, useSaturation, type ChainResult, type PointResult } from "./compute";
import { useStore, type ExampleSnapshot } from "./store";

interface Data {
  info: FluidInfo | null;
  infoError: string | null;
  saturation: Saturation | null;
  points: PointResult[];
  chains: ChainResult[];
  cycle: CycleResult | null;
  cycleError: string | null;
  cycleLoading: boolean;
  exampleSnapshot: ExampleSnapshot | null;
}

const Ctx = createContext<Data | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const fluid = useStore((s) => s.fluid);
  const mode = useStore((s) => s.mode);
  const points = useStore((s) => s.points);
  const chains = useStore((s) => s.chains);
  const cycleId = useStore((s) => s.cycleId);
  const cycleParams = useStore((s) => s.cycleParams);
  const exampleSnapshot = useStore((s) => s.exampleSnapshot);

  const info = useFluidInfo(fluid);
  const saturation = useSaturation(fluid);
  const pointStates = usePointStates(fluid, points);
  const chainResults = useChains(fluid, chains);
  const cycle = useCycle(mode === "cycle", fluid, cycleId, cycleParams);

  const value: Data = {
    info: info.data ?? null,
    infoError: info.error,
    saturation: saturation.data,
    points: pointStates.data ?? [],
    chains: chainResults.data ?? [],
    cycle: cycle.data?.ok ? cycle.data.result : null,
    cycleError: cycle.data && !cycle.data.ok ? cycle.data.error : cycle.error,
    cycleLoading: cycle.loading,
    exampleSnapshot,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData(): Data {
  const d = useContext(Ctx);
  if (!d) throw new Error("useData outside DataProvider");
  return d;
}
