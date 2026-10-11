// Solves every cycle for every suggested fluid with its default parameters, using the real WASM
// module, so broken presets are caught before they reach users: node scripts/check-presets.mjs
import { readFileSync } from "node:fs";
import createThermo from "../src/engine/generated/thermo.mjs";
import { CYCLES, defaultParams } from "../src/cycles/catalog.ts";

const m = await createThermo();
let failures = 0;
for (const def of CYCLES) {
  for (const fluid of def.fluids) {
    m.loadFluid(readFileSync(new URL(`../public/fluids/${fluid}.json`, import.meta.url), "utf8"));
    const r = m.cycle(def.id, fluid, defaultParams(def, fluid));
    if (!r.ok) {
      failures++;
      console.log(`FAIL ${def.id} / ${fluid}: ${r.error}`);
      continue;
    }
    const head = r.metrics.filter((x) => x.group === "performance").slice(0, 2);
    const warn = r.warnings.length ? `  ⚠ ${r.warnings.join(" | ")}` : "";
    console.log(`ok   ${def.id} / ${fluid}: ${head.map((x) => `${x.key}=${x.value.toPrecision(4)}`).join(" ")}${warn}`);
  }
}
process.exit(failures ? 1 : 0);
