// Compare the full-state and lightweight WASM APIs on the same 121-point grids.
// Run from web/: npm run bench:probes
import { readFileSync } from "node:fs";
import createThermo from "../src/engine/generated/thermo.mjs";

const m = await createThermo();
const rows = [];
let checksum = 0;
for (const fluid of ["Nitrogen", "Water", "R134a"]) {
  const loaded = m.loadFluid(readFileSync(new URL(`../public/fluids/${fluid}.json`, import.meta.url), "utf8"));
  if (!loaded.ok) throw new Error(loaded.error);
  const info = m.fluidInfo(fluid);
  const inputs = [];
  for (let i = 0; i <= 10; i++) {
    for (let j = 0; j <= 10; j++) {
      inputs.push([fluid, 0, info.Tcrit * (1.05 + 0.55 * i / 10), 1, info.pcrit * (0.01 + 0.89 * j / 10)]);
    }
  }
  const grid = (method) => {
    for (const input of inputs) {
      const result = m[method](...input);
      if (!result.ok) throw new Error(result.error);
      checksum += (result.point ?? result.state).h;
    }
  };
  for (let i = 0; i < 20; i++) {
    grid("state");
    grid("point");
  }
  const times = { state: [], point: [] };
  for (let round = 0; round < 9; round++) {
    for (const method of round % 2 ? ["point", "state"] : ["state", "point"]) {
      const t = performance.now();
      for (let i = 0; i < 20; i++) grid(method);
      times[method].push((performance.now() - t) / 20);
    }
  }
  const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const full = median(times.state), light = median(times.point);
  rows.push({ fluid, "full state (ms/grid)": full.toFixed(3), "coordinates (ms/grid)": light.toFixed(3), "time saved": `${(100 * (1 - light / full)).toFixed(1)}%` });
}
console.table(rows);
console.log(`Checksum: ${checksum.toExponential(6)}. Local timings; excludes rendering and curve sampling.`);
