// Picks "nice" isoline values within a range, in display units.

const LOG_MANTISSAS = [[1], [1, 3], [1, 2, 5], [1, 1.5, 2, 3, 5, 7], [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8]];

export function niceLogValues(min: number, max: number, target = 10): number[] {
  if (!(min > 0) || !(max > min)) return [];
  let best: number[] = [];
  for (const set of LOG_MANTISSAS) {
    const vals: number[] = [];
    for (let e = Math.floor(Math.log10(min)); e <= Math.ceil(Math.log10(max)); e++) {
      for (const m of set) {
        const v = Number((m * 10 ** e).toPrecision(6));
        if (v >= min && v <= max) vals.push(v);
      }
    }
    if (Math.abs(vals.length - target) < Math.abs(best.length - target)) best = vals;
    if (vals.length >= target) break;
  }
  return best;
}

export function niceStep(span: number, target: number): number {
  const raw = span / Math.max(1, target);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const r = raw / mag;
  const m = r < 1.5 ? 1 : r < 2.25 ? 2 : r < 3.5 ? 2.5 : r < 7.5 ? 5 : 10;
  return m * mag;
}

export function niceLinearValues(min: number, max: number, target = 10): number[] {
  if (!(max > min)) return [];
  const step = niceStep(max - min, target);
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9 * step; v += step) {
    out.push(Number(v.toPrecision(10)));
  }
  return out;
}
