import { ProcessKind } from "../engine/types";
import type { ChainResult } from "./compute";
import type { ExampleSnapshot, ProcessChain, ProcessStep } from "./store";

export type HeatTransfer = "external" | "internal";

export interface ConnectionEnergy {
  id: string;
  from?: string;
  to?: string;
  heatTransfer: HeatTransfer;
  q: number | null;
  w: number | null;
  reason?: string;
}

export interface EnergyTotals {
  heatIn: number;
  heatOut: number;
  workIn: number;
  workOut: number;
  netHeat: number;
  netWork: number;
  residual: number;
  balanced: boolean;
  efficiency: number | null;
  coolingCOP: number | null;
  heatingCOP: number | null;
}

export interface EnergyLoop {
  id: string;
  connections: ConnectionEnergy[];
  status: "closed" | "open" | "branched" | "invalid";
  totals: EnergyTotals | null;
}

export function heatTransferFor(step: ProcessStep, snapshot: ExampleSnapshot | null): HeatTransfer {
  return step.heatTransfer ?? (snapshot?.connections.some((connection) => connection.id === step.id && connection.kind === "hx") ? "internal" : "external");
}

export function processEnergyAssumption(kind: ProcessKind): string {
  switch (kind) {
    case ProcessKind.Isobaric: return "Constant-pressure heat exchange; no shaft work.";
    case ProcessKind.Isothermal: return "Internally reversible isothermal flow: q = T Δs; w = q − Δh.";
    case ProcessKind.Isentropic: return "Reversible adiabatic flow: q = 0; w = −Δh.";
    case ProcessKind.Isenthalpic: return "Adiabatic throttling valve; no shaft work or heat transfer.";
    case ProcessKind.Isochoric: return "Internally reversible constant-density flow: w = −v Δp; q = Δh + w.";
    case ProcessKind.Compression:
    case ProcessKind.Expansion: return "Adiabatic machine: q = 0; shaft work from the enthalpy change.";
  }
}

function connectionEnergy(step: ProcessStep, results: Map<string, ChainResult["steps"][number]>, snapshot: ExampleSnapshot | null): ConnectionEnergy {
  const calculated = results.get(step.id);
  const result = calculated?.result;
  const component = snapshot?.connections.find((connection) => connection.id === step.id);
  // A plotted separator/mixer leg is not a single-stream heater. Its enthalpy
  // change alone cannot determine heat without the other streams' mass flows.
  const multistream = component?.kind === "separator" || component?.kind === "mixer";
  const valid = !multistream && result && Number.isFinite(result.q) && Number.isFinite(result.w)
    && Number.isFinite(result.start.h) && Number.isFinite(result.end.h);
  return {
    id: step.id, from: step.fromPointId, to: step.toPointId,
    heatTransfer: heatTransferFor(step, snapshot),
    q: valid ? result.q : null,
    w: valid ? result.w : null,
    ...(!valid ? { reason: multistream ? "Requires a balance using all stream mass flows." : calculated?.error ?? "Waiting for a valid connection between the selected states." } : {}),
  };
}

function totalsFor(connections: ConnectionEnergy[]): EnergyTotals {
  let heatIn = 0, heatOut = 0, workIn = 0, workOut = 0;
  for (const connection of connections) {
    if (connection.heatTransfer === "external") {
      heatIn += Math.max(0, connection.q!);
      heatOut += Math.max(0, -connection.q!);
    }
    workOut += Math.max(0, connection.w!);
    workIn += Math.max(0, -connection.w!);
  }
  const netHeat = heatIn - heatOut, netWork = workOut - workIn;
  // Internal exchanger duties are excluded from external heat, but their net
  // imbalance must still appear in the residual (e.g. an unpaired recuperator).
  const scale = Math.max(heatIn, heatOut, workIn, workOut);
  const rawResidual = netHeat - netWork;
  const residual = Math.abs(rawResidual) < Math.max(1e-6, scale * 1e-10) ? 0 : rawResidual;
  const tolerance = Math.max(1, 1e-4 * scale);
  const balanced = Math.abs(residual) <= tolerance;
  const powerCycle = balanced && netWork > tolerance && heatIn > 0;
  const drivenCycle = balanced && netWork < -tolerance;
  return {
    heatIn, heatOut, workIn, workOut, netHeat, netWork, residual, balanced,
    efficiency: powerCycle ? netWork / heatIn : null,
    coolingCOP: drivenCycle && heatIn > 0 ? heatIn / -netWork : null,
    heatingCOP: drivenCycle && heatOut > 0 ? heatOut / -netWork : null,
  };
}

/** Find independent connected networks, then require one inlet and outlet at
 * every state before treating a network as a single-stream closed cycle.
 * Connection order and chain boundaries do not affect the result.
 */
export function analyzeEnergy(chains: ProcessChain[], results: ChainResult[], snapshot: ExampleSnapshot | null = null): EnergyLoop[] {
  const steps = chains.flatMap((chain) => chain.steps);
  const calculated = new Map(results.flatMap((chain) => chain.steps.map((step) => [step.id, step] as const)));
  const connections = steps.map((step) => connectionEnergy(step, calculated, snapshot));
  const atPoint = new Map<string, number[]>();
  connections.forEach((connection, index) => {
    for (const point of [connection.from, connection.to]) {
      if (!point) continue;
      const adjacent = atPoint.get(point) ?? [];
      adjacent.push(index);
      atPoint.set(point, adjacent);
    }
  });
  const visited = new Set<number>();
  const loops: EnergyLoop[] = [];
  connections.forEach((_, index) => {
    if (visited.has(index)) return;
    const queue = [index];
    visited.add(index);
    const network: ConnectionEnergy[] = [];
    const degrees = new Map<string, { incoming: number; outgoing: number }>();
    for (let i = 0; i < queue.length; i++) {
      const connection = connections[queue[i]];
      network.push(connection);
      for (const [point, direction] of [[connection.from, "outgoing"], [connection.to, "incoming"]] as const) {
        if (!point) continue;
        const degree = degrees.get(point) ?? { incoming: 0, outgoing: 0 };
        degree[direction]++;
        degrees.set(point, degree);
        for (const adjacent of atPoint.get(point) ?? []) {
          if (!visited.has(adjacent)) { visited.add(adjacent); queue.push(adjacent); }
        }
      }
    }
    const branched = [...degrees.values()].some((degree) => degree.incoming > 1 || degree.outgoing > 1);
    const closed = network.length >= 2 && network.every((connection) => connection.from && connection.to && connection.from !== connection.to)
      && [...degrees.values()].every((degree) => degree.incoming === 1 && degree.outgoing === 1);
    const invalid = network.some((connection) => connection.q === null || connection.w === null);
    const status = branched ? "branched" : !closed ? "open" : invalid ? "invalid" : "closed";
    // Present a circuit in flow order even when its connections were created
    // out of order. Open and branched networks retain traversal order.
    const ordered = [network[0]];
    if (closed && !branched) {
      const outgoing = new Map(network.map((connection) => [connection.from, connection]));
      while (ordered.length < network.length) ordered.push(outgoing.get(ordered[ordered.length - 1].to)!);
    }
    loops.push({ id: network[0].id, connections: closed && !branched ? ordered : network, status, totals: status === "closed" ? totalsFor(network) : null });
  });
  return loops;
}

/** SI specific energy [J/kg] × mass flow [kg/s] = power [W]. */
export function energyRate(specificEnergy: number, massFlow: number | null): number | null {
  if (massFlow === null || !Number.isFinite(massFlow) || massFlow <= 0 || !Number.isFinite(specificEnergy)) return null;
  const rate = specificEnergy * massFlow;
  return Number.isFinite(rate) ? rate : null;
}
