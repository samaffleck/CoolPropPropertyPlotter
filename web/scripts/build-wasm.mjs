// Rebuilds the C++ core with Emscripten and copies the module into src/engine/generated.
// Requires emsdk (emcmake/emcc) on PATH. The generated files are committed so the site can be
// deployed without a C++ toolchain.
import { execSync } from "node:child_process";
import { copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const core = resolve(root, "core");
const build = resolve(core, "build/wasm");
const run = (cmd) => execSync(cmd, { stdio: "inherit", cwd: core });

run(`emcmake cmake -S . -B ${build} -G Ninja -DCMAKE_BUILD_TYPE=Release -Wno-dev`);
run(`cmake --build ${build} --target thermo_wasm`);
for (const f of ["thermo.mjs", "thermo.wasm"]) {
  copyFileSync(resolve(build, f), resolve(root, "web/src/engine/generated", f));
}
console.log("WASM module copied to web/src/engine/generated");
