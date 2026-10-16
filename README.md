<p align="center">
  <img src="web/public/favicon.svg" alt="ThermoPlot logo" width="72" height="72">
</p>

<h1 align="center">ThermoPlot</h1>

<p align="center">Thermodynamic charts and cycle analysis for refrigeration, cryogenics, liquefaction, and power.</p>

<p align="center"><a href="https://thermoplot.com">thermoplot.com</a></p>

## Features

- Interactive T–s, p–h, h–s, p–v, p–T, and T–h charts with saturation curves and property isolines.
- State calculations from any two independent properties, with transport properties and Joule–Thomson coefficient.
- Process chains and example models for vapour-compression refrigeration, transcritical CO₂, Brayton, Rankine/ORC, and Linde–Hampson and Claude liquefiers.
- Cryogenic, engineering, SI, and US unit systems, with per-property unit choices, light and dark themes, and PNG export.

Thermodynamic properties are calculated with [CoolProp](https://www.coolprop.org/), using its equation-of-state data for supported fluids. Calculations run locally in the browser through WebAssembly.

## Run locally

Requirements: Node.js 24 and pnpm 10.

```bash
cd web
pnpm install
pnpm dev
```

Vite prints the local address, usually `http://localhost:5173`.

From `web/`, run `pnpm test` for the frontend and WASM regression tests, or
`pnpm bench:probes` to compare full-state and lightweight viewport calculations.

## Build the C++ core

The web app uses a committed WebAssembly build, so a C++ toolchain is not needed to run it. To build the native core, install CMake 3.20+, Ninja, and a C++20 compiler, then initialize the CoolProp submodule:

```bash
git submodule update --init --recursive
cd core
cmake -S . -B build/native -G Ninja
cmake --build build/native
```

Run the native test suite with `./build/native/thermo_tests`. To rebuild the WebAssembly module, install Emscripten and run `pnpm wasm` from `web/`.

## Credits

ThermoPlot uses [CoolProp](https://github.com/CoolProp/CoolProp). See the [CoolProp project](https://www.coolprop.org/) for its publications and licensing information.
