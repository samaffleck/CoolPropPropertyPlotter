import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import type { Theme } from "./renderer";

export interface ChartTheme extends Theme {
  iso: Record<string, string>;
  dome: string;
  domeFill: string;
  paths: string[];
  accent: string;
}

function read(): ChartTheme {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  return {
    surface: v("--surface"),
    text: v("--text"),
    textMuted: v("--text-2"),
    grid: v("--grid"),
    gridMinor: v("--grid-minor"),
    axis: v("--axis"),
    font: "Inter, ui-sans-serif, system-ui, sans-serif",
    iso: { P: v("--iso-P"), T: v("--iso-T"), S: v("--iso-S"), H: v("--iso-H"), D: v("--iso-D"), Q: v("--iso-Q") },
    dome: v("--dome"),
    domeFill: v("--dome-fill"),
    paths: [v("--path-1"), v("--path-2"), v("--path-3"), v("--path-4")],
    accent: v("--accent"),
  };
}

/** Applies the theme preference to <html> and returns canvas colours that track it. */
export function useChartTheme(): ChartTheme {
  const pref = useStore((s) => s.theme);
  const [theme, setTheme] = useState<ChartTheme>(read);
  useEffect(() => {
    const root = document.documentElement;
    if (pref === "system") delete root.dataset.theme;
    else root.dataset.theme = pref;
    setTheme(read());
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setTheme(read());
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);
  return theme;
}
