# ThermoPlot

ThermoPlot is a browser-based tool for exploring thermodynamic properties and analyzing process and cycle performance. It is designed for refrigeration, cryogenics, liquefaction, and power applications.

**Try it:** [cool-prop-property-plotter-six.vercel.app](https://cool-prop-property-plotter-six.vercel.app/)

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
