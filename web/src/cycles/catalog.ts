// Standard thermodynamic cycles. Parameter values are SI; `quantity` selects display units.
// Solvers live in core/src/cycles.cpp, keyed by `id`.
import type { Quantity } from "../units/units";

export interface CycleParam {
  key: string;
  label: string;
  quantity: Quantity;
  default: number;
  min?: number;
  max?: number;
  toggle?: boolean;
  help?: string;
}

export interface CycleDef {
  id: string;
  name: string;
  category: "Refrigeration & heat pumps" | "Cryogenic refrigeration" | "Liquefaction" | "Power";
  summary: string;
  description: string;
  fluids: string[]; // first is the default
  params: CycleParam[];
  presets?: Record<string, Record<string, number>>;
}

const C = (c: number) => c + 273.15;
const bar = (b: number) => b * 1e5;

const efficiency = (key: string, label: string, def: number, help?: string): CycleParam => ({
  key,
  label,
  quantity: "fraction",
  default: def,
  min: 0.05,
  max: 1,
  help,
});

export const CYCLES: CycleDef[] = [
  {
    id: "vapor_compression",
    name: "Vapour-compression refrigeration",
    category: "Refrigeration & heat pumps",
    summary: "Evaporator, compressor, condenser and expansion valve.",
    description:
      "The standard single-stage refrigeration or heat-pump cycle. Saturated (or superheated) vapour is compressed, condensed and subcooled, then throttled back to the evaporating pressure. The Carnot reference uses the cold-space and ambient temperatures.",
    fluids: ["R134a", "R1234yf", "n-Propane", "Ammonia", "R32", "R410A", "IsoButane", "R1234ze(E)", "R22"],
    presets: { Ammonia: { T_cond: C(35), eta_comp: 0.8 } },
    params: [
      { key: "T_evap", label: "Evaporating temperature", quantity: "temperature", default: C(-10) },
      { key: "T_cond", label: "Condensing temperature", quantity: "temperature", default: C(40) },
      { key: "superheat", label: "Superheat", quantity: "temperature_difference", default: 5, min: 0 },
      { key: "subcool", label: "Subcooling", quantity: "temperature_difference", default: 3, min: 0 },
      efficiency("eta_comp", "Compressor isentropic efficiency", 0.75),
      { key: "T_cold_space", label: "Cold-space temperature", quantity: "temperature", default: C(-2), help: "Used for the Carnot COP and exergy analysis." },
      { key: "T_ambient", label: "Ambient temperature", quantity: "temperature", default: C(30) },
    ],
  },
  {
    id: "transcritical",
    name: "Transcritical CO₂ heat pump",
    category: "Refrigeration & heat pumps",
    summary: "Heat rejection above the critical point in a gas cooler.",
    description:
      "CO₂ (R744) systems reject heat above the critical pressure, so the gas cooler outlet temperature and high-side pressure are set independently. There is an optimum high-side pressure for maximum COP: try sweeping it.",
    fluids: ["CarbonDioxide", "Ethane"],
    params: [
      { key: "T_evap", label: "Evaporating temperature", quantity: "temperature", default: C(-5) },
      { key: "p_high", label: "High-side pressure", quantity: "pressure", default: bar(100) },
      { key: "T_gc_out", label: "Gas-cooler outlet temperature", quantity: "temperature", default: C(35) },
      { key: "superheat", label: "Superheat", quantity: "temperature_difference", default: 5, min: 0 },
      efficiency("eta_comp", "Compressor isentropic efficiency", 0.7),
      { key: "T_cold_space", label: "Cold-space temperature", quantity: "temperature", default: C(3) },
      { key: "T_ambient", label: "Ambient temperature", quantity: "temperature", default: C(30) },
    ],
    presets: { Ethane: { p_high: bar(60) } },
  },
  {
    id: "reverse_brayton",
    name: "Reverse Brayton (turbo-Brayton)",
    category: "Cryogenic refrigeration",
    summary: "Gas refrigerator with recuperator and expander.",
    description:
      "Compressed gas is cooled to ambient, precooled in a recuperator by the returning stream and expanded in a turbine to produce refrigeration at the load. Used for space cryocoolers, HTS cable cooling and as a precooling stage in liquefiers.",
    fluids: ["Helium", "Neon", "Nitrogen", "Air", "Hydrogen"],
    params: [
      { key: "p_low", label: "Low pressure", quantity: "pressure", default: bar(10) },
      { key: "pressure_ratio", label: "Pressure ratio", quantity: "ratio", default: 2, min: 1.01 },
      { key: "T_ambient", label: "Ambient (aftercooler) temperature", quantity: "temperature", default: 300 },
      { key: "T_load", label: "Load outlet temperature", quantity: "temperature", default: 77, help: "Temperature of the gas leaving the load heat exchanger." },
      efficiency("eta_comp", "Compressor isentropic efficiency", 0.8),
      efficiency("eta_exp", "Expander isentropic efficiency", 0.85),
      { key: "effectiveness", label: "Recuperator effectiveness", quantity: "fraction", default: 0.98, min: 0, max: 1 },
      { key: "recover_work", label: "Recover expander work", quantity: "ratio", default: 1, toggle: true },
    ],
    presets: {
      Helium: { T_load: 40 },
      Neon: { T_load: 40, p_low: bar(5) },
      Nitrogen: { T_load: 100, p_low: bar(5), pressure_ratio: 3 },
      Air: { T_load: 110, p_low: bar(5), pressure_ratio: 3 },
      Hydrogen: { T_load: 50, p_low: bar(5) },
    },
  },
  {
    id: "linde_hampson",
    name: "Linde–Hampson liquefier",
    category: "Liquefaction",
    summary: "Isothermal compressor model, recuperator and Joule–Thomson valve.",
    description:
      "The simplest liquefier. High-pressure gas is cooled by the returning cold vapour and throttled; the liquid fraction is drawn off and replaced by make-up gas. Only works for gases whose Joule–Thomson inversion temperature lies above ambient, so hydrogen, helium and neon need precooling (lower the warm-end temperature to model it).",
    fluids: ["Nitrogen", "Argon", "Air", "Methane", "Oxygen", "Hydrogen"],
    params: [
      { key: "p_high", label: "High pressure", quantity: "pressure", default: bar(200) },
      { key: "p_low", label: "Low pressure", quantity: "pressure", default: 101325 },
      { key: "T_ambient", label: "Warm-end temperature", quantity: "temperature", default: 300 },
      efficiency("eta_iso", "Compressor efficiency (isothermal model)", 0.6),
      { key: "dT_warm", label: "Warm-end temperature difference", quantity: "temperature_difference", default: 0, min: 0 },
    ],
    presets: {
      Methane: { p_high: bar(100) },
      Hydrogen: { T_ambient: 70, p_high: bar(100) },
    },
  },
  {
    id: "claude",
    name: "Claude liquefier",
    category: "Liquefaction",
    summary: "Linde–Hampson plus a work-producing expander.",
    description:
      "Part of the high-pressure stream is diverted through an expander after the first heat exchanger, producing work and much colder gas that joins the return stream. The remaining flow is cooled further and throttled. Higher yield and lower specific work than Linde–Hampson; the basis of most large air and nitrogen plants (and of Collins helium liquefiers with more expanders).",
    fluids: ["Nitrogen", "Air", "Argon", "Methane", "Helium", "Hydrogen", "Neon"],
    params: [
      { key: "p_high", label: "High pressure", quantity: "pressure", default: bar(40) },
      { key: "p_low", label: "Low pressure", quantity: "pressure", default: 101325 },
      { key: "T_ambient", label: "Warm-end temperature", quantity: "temperature", default: 300 },
      { key: "T_exp_in", label: "Expander inlet temperature", quantity: "temperature", default: 200 },
      { key: "exp_fraction", label: "Expander flow fraction", quantity: "fraction", default: 0.6, min: 0.01, max: 0.99 },
      efficiency("eta_exp", "Expander isentropic efficiency", 0.8),
      efficiency("eta_iso", "Compressor efficiency (isothermal model)", 0.6),
      { key: "dT_warm", label: "Warm-end temperature difference", quantity: "temperature_difference", default: 0, min: 0 },
      { key: "recover_work", label: "Recover expander work", quantity: "ratio", default: 1, toggle: true },
    ],
    presets: {
      Helium: { p_high: bar(15), T_exp_in: 30, exp_fraction: 0.7 },
      Hydrogen: { p_high: bar(40), T_ambient: 80, T_exp_in: 70, exp_fraction: 0.6 },
      Neon: { p_high: bar(15), T_ambient: 80, T_exp_in: 65, exp_fraction: 0.4 },
      Argon: { p_high: bar(30), T_exp_in: 250, exp_fraction: 0.3 },
      Methane: { p_high: bar(40), T_exp_in: 250, exp_fraction: 0.5 },
    },
  },
  {
    id: "brayton",
    name: "Brayton power cycle",
    category: "Power",
    summary: "Gas turbine cycle with optional recuperator.",
    description:
      "Closed (or ideal open) gas-turbine cycle: compression, heat addition, expansion and heat rejection. Set the recuperator effectiveness above zero for a recuperated cycle. With CO₂ near its critical point this becomes the supercritical CO₂ Brayton cycle.",
    fluids: ["Air", "Helium", "CarbonDioxide", "Nitrogen", "Argon"],
    params: [
      { key: "p_low", label: "Compressor inlet pressure", quantity: "pressure", default: bar(1) },
      { key: "pressure_ratio", label: "Pressure ratio", quantity: "ratio", default: 10, min: 1.01 },
      { key: "T_comp_in", label: "Compressor inlet temperature", quantity: "temperature", default: 300 },
      { key: "T_turbine_in", label: "Turbine inlet temperature", quantity: "temperature", default: 1200 },
      efficiency("eta_comp", "Compressor isentropic efficiency", 0.85),
      efficiency("eta_turb", "Turbine isentropic efficiency", 0.9),
      { key: "effectiveness", label: "Recuperator effectiveness", quantity: "fraction", default: 0, min: 0, max: 1 },
    ],
    presets: {
      CarbonDioxide: { p_low: bar(76), pressure_ratio: 3, T_comp_in: C(32), T_turbine_in: C(550), effectiveness: 0.95 },
      Helium: { p_low: bar(30), pressure_ratio: 2.5, T_turbine_in: C(850), effectiveness: 0.9 },
    },
  },
  {
    id: "rankine",
    name: "Rankine / organic Rankine",
    category: "Power",
    summary: "Pump, boiler with superheat, turbine and condenser.",
    description:
      "The steam power cycle. With an organic working fluid (ORC) it suits low-temperature heat such as geothermal and waste heat, and LNG cold-energy recovery.",
    fluids: ["Water", "R245fa", "Isopentane", "Toluene", "R1233zd(E)", "n-Pentane"],
    params: [
      { key: "T_cond", label: "Condensing temperature", quantity: "temperature", default: C(40) },
      { key: "p_boiler", label: "Boiler pressure", quantity: "pressure", default: bar(100) },
      { key: "T_turbine_in", label: "Turbine inlet temperature", quantity: "temperature", default: C(550) },
      efficiency("eta_pump", "Pump isentropic efficiency", 0.75),
      efficiency("eta_turb", "Turbine isentropic efficiency", 0.85),
    ],
    presets: {
      R245fa: { p_boiler: bar(15), T_turbine_in: C(110), T_cond: C(35) },
      Isopentane: { p_boiler: bar(10), T_turbine_in: C(130), T_cond: C(35) },
      Toluene: { p_boiler: bar(20), T_turbine_in: C(300), T_cond: C(60) },
      "R1233zd(E)": { p_boiler: bar(15), T_turbine_in: C(120), T_cond: C(35) },
      "n-Pentane": { p_boiler: bar(15), T_turbine_in: C(160), T_cond: C(40) },
    },
  },
];

export const cycleById = (id: string) => CYCLES.find((c) => c.id === id);

/** Parameters for a cycle and fluid: defaults overlaid with any fluid preset. */
export function defaultParams(def: CycleDef, fluid: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of def.params) out[p.key] = p.default;
  const preset = def.presets?.[fluid];
  if (preset) for (const [k, v] of Object.entries(preset)) if (k in out) out[k] = v;
  return out;
}
