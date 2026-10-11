import { Prop, type StateInput } from "../engine/types";
import { Field, QuantityInput, Select } from "../components/ui";
import { COORDINATES, INPUT_PROPS } from "../units/properties";

const propOptions = (exclude?: Prop) =>
  INPUT_PROPS.filter((p) => p !== exclude).map((p) => ({ value: p, label: `${COORDINATES[p].label} (${COORDINATES[p].symbol})` }));

/** Picks a starting value when the user switches an input to a different property. */
export function typicalValue(prop: Prop, ref: { T: number; p: number; h: number; s: number; rho: number }): number {
  switch (prop) {
    case Prop.T:
      return ref.T;
    case Prop.P:
      return ref.p;
    case Prop.H:
    case Prop.U:
      return ref.h;
    case Prop.S:
      return ref.s;
    case Prop.D:
      return ref.rho;
    case Prop.V:
      return 1 / ref.rho;
    case Prop.Q:
      return 0.5;
  }
}

/** Two-property state definition (any independent pair). */
export function StateInputEditor({
  value,
  onChange,
  reference,
}: {
  value: StateInput;
  onChange: (v: StateInput) => void;
  reference?: { T: number; p: number; h: number; s: number; rho: number };
}) {
  const ref = reference ?? { T: 300, p: 1e5, h: 3e5, s: 2e3, rho: 1 };
  const row = (which: "a" | "b") => {
    const prop = value[which];
    const other = value[which === "a" ? "b" : "a"];
    const v = value[which === "a" ? "va" : "vb"];
    return (
      <div className="grid grid-cols-[1fr_1fr] gap-2">
        <Select
          label={`Input ${which === "a" ? 1 : 2} property`}
          value={prop}
          options={propOptions(other)}
          onChange={(p) => onChange({ ...value, [which]: p, [which === "a" ? "va" : "vb"]: typicalValue(p, ref) })}
        />
        <QuantityInput
          label={`${COORDINATES[prop].label} value`}
          quantity={COORDINATES[prop].quantity}
          value={v}
          min={prop === Prop.Q ? 0 : undefined}
          max={prop === Prop.Q ? 1 : undefined}
          onChange={(si) => onChange({ ...value, [which === "a" ? "va" : "vb"]: si })}
        />
      </div>
    );
  };
  return (
    <Field label="Defined by">
      {() => (
        <div className="flex flex-col gap-2">
          {row("a")}
          {row("b")}
        </div>
      )}
    </Field>
  );
}
