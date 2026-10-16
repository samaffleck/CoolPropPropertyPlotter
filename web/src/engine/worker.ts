/// <reference lib="webworker" />
// Runs the C++ thermodynamics core (WebAssembly) off the main thread.
import createThermo from "./generated/thermo.mjs";
import wasmUrl from "./generated/thermo.wasm?url";
import type { Request, Response } from "./protocol";
import { chartAuto, defaultView } from "./viewport";

type Module = Awaited<ReturnType<typeof createThermo>>;

const modulePromise: Promise<Module> = createThermo({
  locateFile: (path: string) => (path.endsWith(".wasm") ? wasmUrl : path),
});

// Fluids are registered with CoolProp on first use (see core/wasm/all_fluids_CBOR.h).
const loaded = new Map<string, Promise<void>>();

function ensureFluid(m: Module, name: string): Promise<void> {
  let p = loaded.get(name);
  if (!p) {
    p = (async () => {
      const res = await fetch(`${import.meta.env.BASE_URL}fluids/${encodeURIComponent(name)}.json`);
      if (!res.ok) throw new Error(`Could not download fluid data for ${name}`);
      const r = m.loadFluid(await res.text());
      if (!r.ok) throw new Error(r.error);
    })();
    p.catch(() => loaded.delete(name));
    loaded.set(name, p);
  }
  return p;
}

/** Collects the ArrayBuffers of every typed array in a result so they can be transferred. */
function transferables(value: unknown, out: Transferable[] = []): Transferable[] {
  if (ArrayBuffer.isView(value)) {
    out.push(value.buffer as ArrayBuffer);
  } else if (Array.isArray(value)) {
    for (const v of value) transferables(v, out);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) transferables(v, out);
  }
  return out;
}

async function handle(m: Module, req: Request): Promise<unknown> {
  await ensureFluid(m, req.fluid);
  switch (req.op) {
    case "info":
      return m.fluidInfo(req.fluid);
    case "state":
      return m.state(req.fluid, req.input.a, req.input.va, req.input.b, req.input.vb);
    case "saturation":
      return m.saturation(req.fluid);
    case "chart":
      return m.chart(req.fluid, req.viewport, req.isolines);
    case "chartAuto":
      return chartAuto(m, req.fluid, req.viewport, req.curveViewport ?? req.viewport, req.families, req.units, req.density);
    case "defaultView":
      return defaultView(m, req.fluid, req.axes);
    case "process":
      return m.process(req.fluid, req.start, req.spec);
    case "cycle":
      return m.cycle(req.cycle, req.fluid, req.params);
  }
}

self.onmessage = async (e: MessageEvent<Request>) => {
  const req = e.data;
  let res: Response;
  try {
    const m = await modulePromise;
    const t0 = performance.now();
    const result = await handle(m, req);
    res = { id: req.id, ok: true, result, ms: performance.now() - t0 };
  } catch (err) {
    res = { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  self.postMessage(res, transferables(res));
};
