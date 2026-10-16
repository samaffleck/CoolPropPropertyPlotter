// Unit conversion. Every conversion is affine: display = SI * scale + offset.

export type Quantity =
  | "temperature"
  | "temperature_difference"
  | "pressure"
  | "density"
  | "specific_volume"
  | "specific_energy"
  | "specific_entropy"
  | "volumetric_energy"
  | "speed"
  | "viscosity"
  | "conductivity"
  | "surface_tension"
  | "jt_coefficient"
  | "molar_mass"
  | "fraction"
  | "ratio";

export interface Unit {
  id: string;
  label: string;
  scale: number;
  offset?: number;
}

const F = 9 / 5;

export const UNITS: Record<Quantity, Unit[]> = {
  temperature: [
    { id: "K", label: "K", scale: 1 },
    { id: "C", label: "°C", scale: 1, offset: -273.15 },
    { id: "F", label: "°F", scale: F, offset: -459.67 },
    { id: "R", label: "°R", scale: F },
  ],
  temperature_difference: [
    { id: "K", label: "K", scale: 1 },
    { id: "F", label: "°F", scale: F },
  ],
  pressure: [
    { id: "bar", label: "bar", scale: 1e-5 },
    { id: "kPa", label: "kPa", scale: 1e-3 },
    { id: "MPa", label: "MPa", scale: 1e-6 },
    { id: "Pa", label: "Pa", scale: 1 },
    { id: "atm", label: "atm", scale: 1 / 101325 },
    { id: "psi", label: "psia", scale: 1 / 6894.757293168 },
  ],
  density: [
    { id: "kg/m3", label: "kg m⁻³", scale: 1 },
    { id: "lb/ft3", label: "lb ft⁻³", scale: 0.0624279606 },
  ],
  specific_volume: [
    { id: "m3/kg", label: "m³ kg⁻¹", scale: 1 },
    { id: "L/kg", label: "L kg⁻¹", scale: 1e3 },
    { id: "ft3/lb", label: "ft³ lb⁻¹", scale: 16.01846337 },
  ],
  specific_energy: [
    { id: "kJ/kg", label: "kJ kg⁻¹", scale: 1e-3 },
    { id: "J/kg", label: "J kg⁻¹", scale: 1 },
    { id: "kWh/kg", label: "kWh kg⁻¹", scale: 1 / 3.6e6 },
    { id: "Btu/lb", label: "Btu lb⁻¹", scale: 1 / 2326 },
  ],
  specific_entropy: [
    { id: "kJ/kgK", label: "kJ kg⁻¹ K⁻¹", scale: 1e-3 },
    { id: "J/kgK", label: "J kg⁻¹ K⁻¹", scale: 1 },
    { id: "Btu/lbR", label: "Btu lb⁻¹ °R⁻¹", scale: 1 / 4186.8 },
  ],
  volumetric_energy: [
    { id: "kJ/m3", label: "kJ m⁻³", scale: 1e-3 },
    { id: "Btu/ft3", label: "Btu ft⁻³", scale: 1 / 37258.95 },
  ],
  speed: [
    { id: "m/s", label: "m s⁻¹", scale: 1 },
    { id: "ft/s", label: "ft s⁻¹", scale: 3.280839895 },
  ],
  viscosity: [
    { id: "uPa.s", label: "µPa·s", scale: 1e6 },
    { id: "Pa.s", label: "Pa·s", scale: 1 },
    { id: "cP", label: "cP", scale: 1e3 },
  ],
  conductivity: [
    { id: "mW/mK", label: "mW m⁻¹ K⁻¹", scale: 1e3 },
    { id: "W/mK", label: "W m⁻¹ K⁻¹", scale: 1 },
    { id: "Btu/hftF", label: "Btu h⁻¹ ft⁻¹ °F⁻¹", scale: 0.5778 },
  ],
  surface_tension: [
    { id: "mN/m", label: "mN m⁻¹", scale: 1e3 },
    { id: "N/m", label: "N m⁻¹", scale: 1 },
  ],
  jt_coefficient: [
    { id: "K/bar", label: "K bar⁻¹", scale: 1e5 },
    { id: "K/MPa", label: "K MPa⁻¹", scale: 1e6 },
    { id: "F/psi", label: "°F psi⁻¹", scale: F * 6894.757293168 },
  ],
  molar_mass: [
    { id: "g/mol", label: "g mol⁻¹", scale: 1e3 },
    { id: "kg/mol", label: "kg mol⁻¹", scale: 1 },
  ],
  fraction: [
    { id: "-", label: "–", scale: 1 },
    { id: "%", label: "%", scale: 100 },
  ],
  ratio: [{ id: "-", label: "–", scale: 1 }],
};

export type UnitChoice = Record<Quantity, string>;

const base: UnitChoice = {
  temperature: "K",
  temperature_difference: "K",
  pressure: "bar",
  density: "kg/m3",
  specific_volume: "m3/kg",
  specific_energy: "kJ/kg",
  specific_entropy: "kJ/kgK",
  volumetric_energy: "kJ/m3",
  speed: "m/s",
  viscosity: "uPa.s",
  conductivity: "mW/mK",
  surface_tension: "mN/m",
  jt_coefficient: "K/bar",
  molar_mass: "g/mol",
  fraction: "-",
  ratio: "-",
};

export const UNIT_SYSTEMS: { id: string; label: string; units: UnitChoice }[] = [
  { id: "cryo", label: "Cryogenic (K, bar, kJ kg⁻¹)", units: base },
  { id: "eng", label: "Engineering (°C, bar, kJ kg⁻¹)", units: { ...base, temperature: "C" } },
  {
    id: "si",
    label: "SI (K, Pa, J kg⁻¹)",
    units: { ...base, pressure: "Pa", specific_energy: "J/kg", specific_entropy: "J/kgK", viscosity: "Pa.s", conductivity: "W/mK" },
  },
  {
    id: "us",
    label: "US (°F, psia, Btu lb⁻¹)",
    units: {
      ...base,
      temperature: "F",
      temperature_difference: "F",
      pressure: "psi",
      density: "lb/ft3",
      specific_volume: "ft3/lb",
      specific_energy: "Btu/lb",
      specific_entropy: "Btu/lbR",
      volumetric_energy: "Btu/ft3",
      speed: "ft/s",
      conductivity: "Btu/hftF",
      jt_coefficient: "F/psi",
    },
  },
];

export function unitOf(choice: UnitChoice, q: Quantity): Unit {
  const list = UNITS[q];
  return list.find((u) => u.id === choice[q]) ?? list[0];
}

export const toDisplay = (u: Unit, si: number) => si * u.scale + (u.offset ?? 0);
export const fromDisplay = (u: Unit, v: number) => (v - (u.offset ?? 0)) / u.scale;

/** Format a number with sensible significant figures for engineering readouts. */
export function formatNumber(v: number, digits = 5): string {
  if (!Number.isFinite(v)) return "–";
  if (Math.abs(v) < 1e-9) return "0"; // round-off from ideal (zero-approach) cases
  const a = Math.abs(v);
  if (a >= 1e7 || a < 1e-4) return v.toExponential(digits - 1).replace("e+", "e");
  const decimals = Math.max(0, digits - 1 - Math.floor(Math.log10(a)));
  return v.toFixed(Math.min(decimals, 8));
}

/** Shortest representation with up to `digits` significant figures, no trailing zeros. */
export function formatCompact(v: number, digits = 4): string {
  if (!Number.isFinite(v)) return "–";
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e6 || a < 1e-3)) {
    const [m, e] = v.toExponential(digits - 1).split("e");
    return `${Number(m)}e${Number(e)}`;
  }
  return String(Number(v.toPrecision(digits)));
}

/** Tick label for a linear axis with the given step. */
export function formatTick(v: number, step: number): string {
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9) + (step / 10 ** Math.floor(Math.log10(step)) === 2.5 ? 1 : 0));
  if (Math.abs(v) >= 1e6) return formatCompact(v, 4);
  return v.toFixed(Math.min(decimals, 10));
}
