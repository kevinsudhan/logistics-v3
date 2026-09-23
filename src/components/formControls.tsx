import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

/**
 * The controls the enquiry panels are built from.
 *
 * One set, shared, so Customer, Service, Cargo and Dimensions look and behave
 * the same: a toggle saves on the click, a typed field when you leave it.
 * There is no Save button on any of them — a control that has to be confirmed
 * separately is one people change and walk away from, and the next person
 * reads a value that was never stored.
 */

export function Field({
  label,
  hint,
  className = "",
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <p className="mb-1.5 text-[11.5px] font-medium text-text-secondary">{label}</p>
      {children}
      {hint && <p className="mt-1 text-[11px] text-text-muted">{hint}</p>}
    </div>
  );
}

/** A row of joined buttons, one of which is on. */
export function Segmented<T extends string>({
  options,
  value,
  busy,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value: T | null | undefined;
  busy?: boolean;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex h-9 overflow-hidden rounded-lg border border-border bg-surface-1">
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            disabled={busy}
            onClick={() => !on && onChange(o.value)}
            aria-pressed={on}
            className={`min-w-0 flex-1 truncate px-1 text-[11.5px] font-medium transition-colors disabled:opacity-60 sm:px-2 sm:text-[12px] ${
              i > 0 ? "border-l border-border" : ""
            } ${on ? "bg-brand text-white" : "text-text-muted hover:bg-surface-2 hover:text-text-primary"}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * No / Yes, with nothing chosen allowed.
 *
 * Null is a real answer — "nobody has said" — and is shown as neither button
 * on. Defaulting it to No would record a decision nobody made.
 */
export function YesNo({
  value,
  busy,
  onChange,
}: {
  value: boolean | null | undefined;
  busy?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Segmented
      options={[
        { value: "no", label: "No" },
        { value: "yes", label: "Yes" },
      ]}
      value={value == null ? null : value ? "yes" : "no"}
      busy={busy}
      onChange={(v) => onChange(v === "yes")}
    />
  );
}

/**
 * A field that saves when you leave it, and only if it changed.
 *
 * Dates save on the change instead: a value picked from the calendar is
 * finished the moment it is picked, and waiting for a blur that may never come
 * loses it.
 */
export function TextSave({
  value,
  onSave,
  placeholder,
  type = "text",
  list,
  busy,
  className = "",
  ariaLabel,
}: {
  value: string;
  onSave: (v: string) => void;
  placeholder?: string;
  type?: string;
  list?: string;
  busy?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = (v: string) => v.trim() !== value && onSave(v.trim());

  return (
    <div className="relative">
      <input
        type={type}
        value={draft}
        list={list}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(e) => {
          setDraft(e.target.value);
          if (type === "date") commit(e.target.value);
        }}
        onBlur={() => type !== "date" && commit(draft)}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className={`h-9 w-full pr-8 ${className}`}
      />
      {busy && (
        <Loader2
          size={13}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-text-muted"
        />
      )}
    </div>
  );
}
