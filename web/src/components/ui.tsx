import { ChevronDown } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { useStore } from "../state/store";
import { formatCompact, formatNumber, fromDisplay, toDisplay, unitOf, type Quantity } from "../units/units";

/** Numeric input in display units; reports SI values. Commits on blur or Enter. */
export function QuantityInput({
  value,
  quantity,
  onChange,
  label,
  min,
  max,
  className = "",
  id,
}: {
  value: number;
  quantity: Quantity;
  onChange: (si: number) => void;
  label?: string;
  min?: number;
  max?: number;
  className?: string;
  id?: string;
}) {
  const units = useStore((s) => s.units);
  const unit = unitOf(units, quantity);
  const shown = Number.isFinite(value) ? formatCompact(toDisplay(unit, value), 6) : "";
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => setInvalid(false), [value]);

  const commit = () => {
    if (draft === null) return;
    const v = Number(draft.replace(",", "."));
    setDraft(null);
    if (!Number.isFinite(v) || draft.trim() === "") {
      setInvalid(true);
      return;
    }
    let si = fromDisplay(unit, v);
    if (min !== undefined) si = Math.max(min, si);
    if (max !== undefined) si = Math.min(max, si);
    setInvalid(false);
    onChange(si);
  };

  return (
    <div
      className={`flex h-8 items-center rounded-md border bg-surface pr-2 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20 ${
        invalid ? "border-danger" : "border-line"
      } ${className}`}
    >
      <input
        id={id}
        aria-label={label}
        inputMode="decimal"
        className="tabular h-full w-full min-w-0 bg-transparent px-2 font-mono text-[13px] text-ink outline-none"
        value={draft ?? shown}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setDraft(null);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      {unit.label !== "–" && <span className="shrink-0 whitespace-nowrap text-xs text-ink-3">{unit.label}</span>}
    </div>
  );
}

export function Field({ label, help, children }: { label: string; help?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs text-ink-2" title={help}>
        {label}
        {help && <span className="ml-1 cursor-help text-ink-3">ⓘ</span>}
      </label>
      {children(id)}
    </div>
  );
}

export function Select<T extends string | number>({
  value,
  options,
  onChange,
  label,
  className = "",
  id,
}: {
  value: T;
  options: { value: T; label: string; group?: string }[];
  onChange: (v: T) => void;
  label?: string;
  className?: string;
  id?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <select
        id={id}
        aria-label={label}
        value={String(value)}
        onChange={(e) => {
          const opt = options.find((o) => String(o.value) === e.target.value);
          if (opt) onChange(opt.value);
        }}
        className="h-8 w-full appearance-none rounded-md border border-line bg-surface pl-2 pr-7 text-[13px] text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
      >
        {options.map((o, index) => {
          const previous = options[index - 1];
          const nextGroup = o.group && o.group !== previous?.group;
          if (nextGroup) {
            const group = o.group!;
            const optionsInGroup = options.filter((option) => option.group === group);
            return (
              <optgroup key={group} label={group}>
                {optionsInGroup.map((option) => (
                  <option key={String(option.value)} value={String(option.value)}>{option.label}</option>
                ))}
              </optgroup>
            );
          }
          if (o.group) return null;
          return <option key={String(o.value)} value={String(o.value)}>{o.label}</option>;
        })}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ink-3" />
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = "secondary",
  className = "",
  title,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost";
  className?: string;
  title?: string;
  disabled?: boolean;
}) {
  const styles = {
    primary: "bg-accent text-white hover:brightness-110",
    secondary: "border border-line bg-surface text-ink hover:bg-surface-2",
    ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink",
  }[variant];
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition disabled:opacity-40 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

export function IconButton({ label, onClick, children, className = "" }: { label: string; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button onClick={onClick} title={label} aria-label={label} className={`rounded p-1 text-ink-3 hover:bg-surface-3 hover:text-ink ${className}`}>
      {children}
    </button>
  );
}

export function Section({ title, actions, children, className = "" }: { title: string; actions?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <section className={`border-b border-line px-4 py-4 ${className}`}>
      <div className={`${children ? "mb-3" : ""} flex items-center justify-between`}>
        <h2 className="text-sm font-medium text-ink-2">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Value({ value, quantity, digits = 5 }: { value: number; quantity: Quantity; digits?: number }) {
  const units = useStore((s) => s.units);
  const unit = unitOf(units, quantity);
  return (
    <span className="tabular font-mono">
      {formatNumber(toDisplay(unit, value), digits)}
      {unit.label !== "–" && Number.isFinite(value) && <span className="ml-1 font-sans text-ink-3">{unit.label}</span>}
    </span>
  );
}

export function Message({ tone, children }: { tone: "error" | "warning" | "info"; children: ReactNode }) {
  const styles = {
    error: "border-danger/30 bg-danger/5 text-danger",
    warning: "border-warning/30 bg-warning/5 text-warning",
    info: "border-line bg-surface-2 text-ink-2",
  }[tone];
  const icon = { error: "✕", warning: "⚠", info: "ℹ" }[tone];
  return (
    <div className={`flex gap-2 rounded-md border px-3 py-2 text-xs leading-relaxed ${styles}`} role={tone === "error" ? "alert" : undefined}>
      <span aria-hidden>{icon}</span>
      <div>{children}</div>
    </div>
  );
}
