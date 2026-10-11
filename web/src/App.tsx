import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ThermoChart } from "./charts/ThermoChart";
import { Header } from "./components/Header";
import { CyclePanel } from "./panels/CyclePanel";
import { ExplorePanel } from "./panels/ExplorePanel";
import { ProcessPanel } from "./panels/ProcessPanel";
import { ResultsPanel } from "./panels/ResultsPanel";
import { DataProvider, useData } from "./state/data";
import { useStore } from "./state/store";

const GITHUB = "https://github.com/samaffleck/CoolPropPropertyPlotter";

function HomePage({ onOpen }: { onOpen: () => void }) {
  const [stars, setStars] = useState(1);
  useEffect(() => {
    fetch("https://api.github.com/repos/samaffleck/CoolPropPropertyPlotter")
      .then((r) => (r.ok ? r.json() : null))
      .then((repo) => repo && Number.isFinite(repo.stargazers_count) && setStars(repo.stargazers_count))
      .catch(() => {});
  }, []);

  return (
    <main className="relative flex min-h-full flex-col items-center justify-center overflow-hidden bg-surface px-6 text-center">
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[min(70vw,680px)] w-[min(70vw,680px)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/[0.035] blur-3xl" />
      <div className="relative flex flex-col items-center">
        <h1 className="type-display text-4xl font-medium tracking-[-0.045em] text-ink sm:text-5xl">ThermoPlot</h1>
        <p className="mt-3 text-sm text-ink-3">Thermodynamics, made visible.</p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <button onClick={onOpen} className="h-11 rounded-full bg-ink px-6 text-sm font-medium text-surface transition hover:opacity-85">
            Open editor
          </button>
          <a href={GITHUB} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center gap-2 rounded-full border border-line px-5 text-sm text-ink-2 transition hover:bg-surface-2 hover:text-ink">
            <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden>
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            <span>GitHub</span><span className="text-ink-3">·</span><span>{stars} {stars === 1 ? "star" : "stars"}</span>
          </a>
        </div>
      </div>
      <span className="absolute bottom-6 text-[11px] text-ink-3">
        By{" "}
        <a href="https://www.linkedin.com/in/sam-affleck" target="_blank" rel="noreferrer" className="text-ink-2 underline-offset-2 hover:text-ink hover:underline">
          Sam Affleck
        </a>
        , powered by{" "}
        <a href="https://www.coolprop.org/" target="_blank" rel="noreferrer" className="text-ink-2 underline-offset-2 hover:text-ink hover:underline">
          CoolProp
        </a>
      </span>
    </main>
  );
}

const maxSidebarWidth = () => Math.min(520, window.innerWidth * 0.55);

function Sidebar({ width }: { width: number }) {
  const { infoError } = useData();
  return (
    <aside style={{ "--sidebar-width": `${width}px` } as CSSProperties} className="order-2 flex w-full shrink-0 flex-col border-line bg-surface lg:order-1 lg:min-h-0 lg:w-[var(--sidebar-width)]">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {infoError && <div className="m-4 text-xs text-danger">Could not load fluid: {infoError}</div>}
        <CyclePanel />
        <ExplorePanel />
        <ProcessPanel />
      </div>
    </aside>
  );
}

function Editor({ onHome }: { onHome: () => void }) {
  const mode = useStore((s) => s.mode);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const resizeStart = useRef<{ x: number; width: number } | null>(null);
  useEffect(() => setResultsOpen(false), [mode]);
  return (
    <DataProvider>
      <div className="flex h-full flex-col">
        <Header onHome={onHome} />
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
          <Sidebar width={sidebarWidth} />
          <div
            role="separator"
            aria-label="Resize sidebar and graph"
            aria-orientation="vertical"
            aria-valuemin={240}
            aria-valuemax={Math.floor(maxSidebarWidth())}
            aria-valuenow={sidebarWidth}
            tabIndex={0}
            className="after:content-[''] relative hidden w-2 shrink-0 cursor-col-resize touch-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-line/70 after:transition-colors hover:after:bg-accent/60 focus:after:bg-accent/60 lg:order-2 lg:block"
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") setSidebarWidth((width) => Math.max(240, width - 16));
              if (e.key === "ArrowRight") setSidebarWidth((width) => Math.min(maxSidebarWidth(), width + 16));
            }}
            onPointerDown={(e) => {
              resizeStart.current = { x: e.clientX, width: sidebarWidth };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (!resizeStart.current) return;
              const max = maxSidebarWidth();
              setSidebarWidth(Math.max(240, Math.min(max, resizeStart.current.width + e.clientX - resizeStart.current.x)));
            }}
            onPointerUp={() => { resizeStart.current = null; }}
            onPointerCancel={() => { resizeStart.current = null; }}
          />
          <main className="order-1 flex min-h-[55vh] min-w-0 flex-1 flex-col lg:order-3 lg:min-h-0">
            <div className="min-h-[55vh] min-w-0 flex-1 lg:min-h-0">
              <ThermoChart resultsOpen={resultsOpen} onToggleResults={() => setResultsOpen((open) => !open)} />
            </div>
            {resultsOpen && (
              <div className="h-56 shrink-0 border-t border-line lg:h-52">
                <ResultsPanel />
              </div>
            )}
          </main>
        </div>
      </div>
    </DataProvider>
  );
}

export default function App() {
  const [editor, setEditor] = useState(() => window.location.hash === "#editor");
  useEffect(() => {
    const sync = () => setEditor(window.location.hash === "#editor");
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const openEditor = () => {
    window.location.hash = "editor";
    setEditor(true);
  };
  const goHome = () => {
    window.history.pushState(null, "", window.location.pathname + window.location.search);
    setEditor(false);
  };
  return editor ? <Editor onHome={goHome} /> : <HomePage onOpen={openEditor} />;
}
