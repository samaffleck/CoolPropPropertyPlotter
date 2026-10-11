// Node smoke test for the WASM bindings: node scripts/smoke-wasm.mjs
import { readFileSync } from "node:fs";
import createThermo from "../src/engine/generated/thermo.mjs";

const m = await createThermo();
const load = (n) => {
  const r = m.loadFluid(readFileSync(new URL(`../public/fluids/${n}.json`, import.meta.url), "utf8"));
  if (!r.ok) throw new Error(r.error);
};
let t = performance.now();
load("Nitrogen");
console.log("loadFluid N2", (performance.now() - t).toFixed(1), "ms");
t = performance.now();
const info = m.fluidInfo("Nitrogen");
console.log("info", info.name, info.Tcrit, (performance.now() - t).toFixed(1), "ms");
console.log("state", m.state("Nitrogen", 1, 101325, 7, 0).state.T);
t = performance.now();
const sat = m.saturation("Nitrogen");
console.log("dome pts", sat.dome.length / 6, (performance.now() - t).toFixed(1), "ms");
const vp = { x: 5, y: 0, xLog: false, yLog: false, xMin: 2000, xMax: 7500, yMin: 63, yMax: 400 };
t = performance.now();
const ch = m.chart("Nitrogen", vp, [
  { prop: 1, values: [1e4, 2e4, 5e4, 1e5, 2e5, 5e5, 1e6, 2e6, 5e6, 1e7, 2e7] },
  { prop: 2, values: [1, 2, 5, 10, 20, 50, 100, 200, 500] },
  { prop: 4, values: [100e3, 150e3, 200e3, 250e3, 300e3, 350e3, 400e3] },
  { prop: 7, values: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9] },
]);
const pts = ch.isolines.reduce((a, l) => a + l.data.length / 6, 0);
console.log("chart", ch.isolines.length, "isolines", pts, "pts", (performance.now() - t).toFixed(1), "ms");
const pr = m.process("Nitrogen", { a: 1, va: 1e5, b: 0, vb: 300 }, { kind: 5, target: 1, value: 5e5, efficiency: 0.8 });
console.log("process", pr.ok, pr.end?.T, pr.w);
t = performance.now();
const cy = m.cycle("claude", "Nitrogen", { p_high: 4e6, T_exp_in: 200, exp_fraction: 0.6 });
console.log("claude", cy.ok, cy.metrics?.find((x) => x.key === "yield").value, (performance.now() - t).toFixed(1), "ms");
load("Hydrogen");
console.log("H2 LH", m.cycle("linde_hampson", "Hydrogen", {}).error);
console.log("bad fluid", m.state("Nope", 1, 1, 0, 1));
