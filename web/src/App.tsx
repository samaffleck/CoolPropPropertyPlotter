import { Activity, Crosshair, Repeat } from "lucide-react";
import { useRef, useState } from "react";
import { ThermoChart } from "./charts/ThermoChart";
import { Header } from "./components/Header";
import { CyclePanel } from "./panels/CyclePanel";
import { ExplorePanel } from "./panels/ExplorePanel";
import { ProcessPanel } from "./panels/ProcessPanel";
import { ResultsPanel } from "./panels/ResultsPanel";
import { DataProvider, useData } from "./state/data";
import { useStore, type Mode } from "./state/store";

const MODES: { id: Mode; label: string; icon: typeof Crosshair }[] = [
  { id: "explore", label: "Explore", icon: Crosshair },
  { id: "process", label: "Processes", icon: Activity },
  { id: "cycle", label: "Cycles", icon: Repeat },
];

function Sidebar() {
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const { infoError } = useData();
  return (
    <aside className="order-2 flex shrink-0 flex-col border-line bg-surface lg:order-1 lg:min-h-0 lg:w-[350px] lg:border-r">
      <nav className="grid grid-cols-3 gap-1 border-b border-line p-2" aria-label="Mode">
        {MODES.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setMode(id)}
            aria-current={mode === id}
            className={`flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[13px] font-medium transition-colors ${
              mode === id ? "bg-accent/10 text-accent" : "text-ink-2 hover:bg-surface-2 hover:text-ink"
            }`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </nav>
      <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        {infoError && <div className="m-4 text-xs text-danger">Could not load fluid: {infoError}</div>}
        {mode === "explore" && <ExplorePanel />}
        {mode === "process" && <ProcessPanel />}
        {mode === "cycle" && <CyclePanel />}
        <footer className="px-4 py-5 text-[11px] leading-relaxed text-ink-3">
          Properties from{" "}
          <a className="underline hover:text-ink" href="http://www.coolprop.org" target="_blank" rel="noreferrer">
            CoolProp 8
          </a>{" "}
          (reference-quality Helmholtz equations of state), computed in your browser with WebAssembly. Bell et al.,{" "}
          <em>Ind. Eng. Chem. Res.</em> 53 (2014) 2498–2508. Check critical design values against the original equations of state.
        </footer>
      </div>
    </aside>
  );
}

function Main() {
  const [resultsHeight, setResultsHeight] = useState(250);
  const drag = useRef<{ y: number; h: number } | null>(null);
  return (
    <main className="order-1 flex min-w-0 shrink-0 flex-col lg:order-2 lg:min-h-0 lg:flex-1 lg:shrink">
      <div className="h-[68vh] min-h-[360px] lg:h-auto lg:min-h-[420px] lg:flex-1">
        <ThermoChart />
      </div>
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize results panel"
        className="hidden h-1.5 cursor-row-resize border-t border-line bg-surface-2 hover:bg-accent/30 lg:block"
        onPointerDown={(e) => {
          drag.current = { y: e.clientY, h: resultsHeight };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          setResultsHeight(Math.min(window.innerHeight * 0.7, Math.max(90, drag.current.h - (e.clientY - drag.current.y))));
        }}
        onPointerUp={() => (drag.current = null)}
      />
      <div className="max-h-[70vh] border-t border-line lg:max-h-none lg:border-t-0" style={{ height: resultsHeight }}>
        <ResultsPanel />
      </div>
    </main>
  );
}

export default function App() {
  return (
    <DataProvider>
      <div className="flex h-full flex-col">
        <Header />
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
          <Sidebar />
          <Main />
        </div>
      </div>
    </DataProvider>
  );
}
