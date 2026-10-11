# ThermoPlot

Interactive thermodynamic charts and cycle analysis for 130+ pure fluids, running entirely in the
browser. Built for engineers working on refrigeration, cryogenics, liquefaction and power cycles.

**Live:** https://cool-prop-property-plotter-six.vercel.app/

- **Charts:** T–s, p–h, h–s, p–v, p–T and T–h with saturation dome, melting line and labelled
  isolines (isobars, isotherms, isentropes, isenthalps, isochores, quality). Isolines are re-chosen
  with round values in your units as you zoom.
- **State calculator:** any two independent properties → full state including transport
  properties and the Joule–Thomson coefficient. Hover anywhere on a chart for a live readout.
- **Processes:** chain compressors, expanders, JT valves, isobaric heat exchange, isentropic,
  isothermal and isochoric steps, with heat and work per step.
- **Cycles:** vapour compression, transcritical CO₂, reverse Brayton (cryocooler), Brayton
  (incl. sCO₂), Rankine/ORC, Linde–Hampson and Claude liquefiers. Each reports performance
  metrics, an exergy-destruction breakdown and T–Q diagrams with pinch checks.
- Unit systems (cryogenic K/bar, engineering °C/bar, SI, US) with per-quantity overrides, light and
  dark themes, CSV and PNG export.

Properties come from [CoolProp](http://www.coolprop.org) 8 (Bell et al., *Ind. Eng. Chem. Res.*
53 (2014) 2498–2508).

## Architecture

```
core/   C++20 thermodynamics library on CoolProp's low-level AbstractState API
  src/        fluids, saturation & adaptive isolines, processes, cycle solvers
  bindings/   embind interface compiled to WebAssembly
  tests/      doctest unit tests (reference values + energy/exergy balance checks)
  bench/      timing of chart/cycle operations
  tools/      fluid catalog generator, per-fluid JSON splitter
web/    Vite + React + TypeScript front end
  src/engine/   Web Worker hosting the WASM module, typed RPC client
  src/charts/   canvas chart renderer, isoline value selection, scene building
  src/cycles/   cycle catalog (parameters, defaults, per-fluid presets)
```

The WASM module is built with an empty embedded fluid library; each fluid's equation of state
(with superancillaries) is fetched on first use from `web/public/fluids/`. This keeps the initial
download to ~1.2 MB (gzip). All computation runs in a Web Worker so the UI never blocks.

## Development

Front end (uses the committed WASM build, no C++ toolchain needed):

```bash
cd web
pnpm install
pnpm dev          # http://localhost:5173
pnpm test         # unit tests
node scripts/check-presets.mjs   # solve every cycle preset with the real WASM core
```

C++ core (requires CMake ≥ 3.20, a C++20 compiler; Emscripten for the WASM build):

```bash
git submodule update --init --recursive
cd core
cmake -S . -B build/native -G Ninja && cmake --build build/native
./build/native/thermo_tests && ./build/native/thermo_bench

cd ../web && pnpm wasm   # rebuild WASM and copy into web/src/engine/generated
```

If you change the CoolProp version, regenerate the fluid data:

```bash
./core/build/native/thermo_catalog > web/public/fluids.json
python3 core/tools/split_fluids.py core/external/CoolProp/dev/all_fluids.json web/public/fluids
```
