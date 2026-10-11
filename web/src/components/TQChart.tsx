import { useState } from "react";
import { niceLinearValues } from "../charts/nice";
import type { ExchangerProfile } from "../engine/types";
import { useStore } from "../state/store";
import { formatCompact, formatNumber, toDisplay, unitOf } from "../units/units";

const W = 340;
const H = 200;
const M = { l: 46, r: 12, t: 12, b: 34 };

/** Temperature vs. duty for a counter-flow exchanger: shows the pinch. */
export function TQChart({ x }: { x: ExchangerProfile }) {
  const units = useStore((s) => s.units);
  const Tu = unitOf(units, "temperature");
  const Eu = unitOf(units, "specific_energy");
  const dTu = unitOf(units, "temperature_difference");
  const [hover, setHover] = useState<number | null>(null);
  const n = x.q.length;
  if (n < 2) return null;

  const q = Array.from(x.q, (v) => toDisplay(Eu, v));
  const th = Array.from(x.Thot, (v) => toDisplay(Tu, v));
  const tc = Array.from(x.Tcold, (v) => toDisplay(Tu, v));
  const qMax = q[n - 1] || 1;
  const tAll = [...th, ...tc];
  const tMin = Math.min(...tAll);
  const tMax = Math.max(...tAll);
  const pad = (tMax - tMin) * 0.06 || 1;
  const y0 = tMin - pad;
  const y1 = tMax + pad;
  const sx = (v: number) => M.l + (v / qMax) * (W - M.l - M.r);
  const sy = (v: number) => H - M.b - ((v - y0) / (y1 - y0)) * (H - M.t - M.b);
  const path = (t: number[]) => t.map((v, i) => `${i ? "L" : "M"}${sx(q[i]).toFixed(1)},${sy(v).toFixed(1)}`).join("");
  // Pinch location
  let pi = 0;
  for (let i = 1; i < n; i++) if (th[i] - tc[i] < th[pi] - tc[pi]) pi = i;

  return (
    <figure className="rounded-lg border border-line p-3">
      <figcaption className="mb-1 flex items-baseline justify-between text-xs">
        <span className="font-medium text-ink">{x.name}</span>
        <span className={x.minApproach < -0.01 ? "text-danger" : "text-ink-2"}>
          {x.minApproach < -0.01 ? "⚠ temperature cross" : "min. approach"}{" "}
          <span className="tabular font-mono">{formatNumber(toDisplay(dTu, x.minApproach), 3)}</span> {dTu.label}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Temperature versus duty for ${x.name}`}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const vx = ((e.clientX - r.left) / r.width) * W;
          const qv = ((vx - M.l) / (W - M.l - M.r)) * qMax;
          let best = 0;
          for (let i = 1; i < n; i++) if (Math.abs(q[i] - qv) < Math.abs(q[best] - qv)) best = i;
          setHover(vx >= M.l && vx <= W - M.r ? best : null);
        }}
        onMouseLeave={() => setHover(null)}
      >
        {niceLinearValues(y0, y1, 4).map((t) => (
          <g key={t}>
            <line x1={M.l} x2={W - M.r} y1={sy(t)} y2={sy(t)} stroke="var(--grid)" />
            <text x={M.l - 5} y={sy(t)} textAnchor="end" dominantBaseline="middle" fontSize="10" fill="var(--text-3)">
              {formatCompact(t, 4)}
            </text>
          </g>
        ))}
        {niceLinearValues(0, qMax, 4).map((v) => (
          <text key={v} x={sx(v)} y={H - M.b + 13} textAnchor="middle" fontSize="10" fill="var(--text-3)">
            {formatCompact(v, 4)}
          </text>
        ))}
        <text x={(M.l + W - M.r) / 2} y={H - 4} textAnchor="middle" fontSize="10" fill="var(--text-2)">
          Duty [{Eu.label}]
        </text>
        <text x={10} y={(M.t + H - M.b) / 2} textAnchor="middle" fontSize="10" fill="var(--text-2)" transform={`rotate(-90 10 ${(M.t + H - M.b) / 2})`}>
          T [{Tu.label}]
        </text>
        <line x1={sx(q[pi])} x2={sx(q[pi])} y1={sy(th[pi])} y2={sy(tc[pi])} stroke="var(--text-3)" strokeDasharray="2 2" />
        <path d={path(th)} fill="none" stroke="var(--path-1)" strokeWidth="2" />
        <path d={path(tc)} fill="none" stroke="var(--iso-P)" strokeWidth="2" />
        <text x={sx(q[0]) + 4} y={sy(th[0]) - 6} fontSize="10" fill="var(--text-2)">
          hot
        </text>
        <text x={sx(q[0]) + 4} y={sy(tc[0]) + 12} fontSize="10" fill="var(--text-2)">
          cold
        </text>
        {hover !== null && (
          <g>
            <line x1={sx(q[hover])} x2={sx(q[hover])} y1={M.t} y2={H - M.b} stroke="var(--text-3)" />
            <circle cx={sx(q[hover])} cy={sy(th[hover])} r="3.5" fill="var(--surface)" stroke="var(--path-1)" strokeWidth="2" />
            <circle cx={sx(q[hover])} cy={sy(tc[hover])} r="3.5" fill="var(--surface)" stroke="var(--iso-P)" strokeWidth="2" />
          </g>
        )}
      </svg>
      <div className="tabular h-4 text-[11px] text-ink-2">
        {hover !== null && (
          <>
            q {formatNumber(q[hover], 4)} · T<sub>hot</sub> {formatNumber(th[hover], 4)} · T<sub>cold</sub> {formatNumber(tc[hover], 4)} · ΔT{" "}
            {formatNumber(th[hover] - tc[hover], 3)} {dTu.label}
          </>
        )}
      </div>
    </figure>
  );
}
