import { useId } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Section } from "./HblBoxes";
import {
  blankRow,
  parseNumber,
  shownFields,
  type ManualField,
  type ManualRow,
  type ManualSection,
  type ManualTable,
  type ManualValues,
} from "../lib/documents/manualForm";

/**
 * A manual document's form, drawn from its declaration (lib/documents/manualForm).
 *
 * Every field writes on each keystroke: there is nothing to save, because the
 * page keeps what is typed for the life of the tab and draws the PDF from it
 * when asked. A number that will not read as one is outlined, so it is seen
 * before the document prints nothing in its place.
 */
export default function ManualForm({
  sections,
  values,
  onChange,
}: {
  sections: ManualSection[];
  values: ManualValues;
  onChange: (key: string, value: string | ManualRow[]) => void;
}) {
  return (
    <>
      {sections.map((s) =>
        // A section of fields none of which is called for yet is not drawn at all.
        !s.table && shownFields(s, values).length === 0 ? null : s.table ? (
          <TableSection key={s.title} section={s} table={s.table} rows={asRows(values[s.table.key])} values={values} onChange={(rows) => onChange(s.table!.key, rows)} />
        ) : (
          <Section key={s.title} title={s.title}>
            {s.note && <p className="-mt-1 mb-3 text-[11.5px] text-text-muted">{s.note}</p>}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {shownFields(s, values).map((f) => (
                <FieldBox key={f.key} field={f} value={typeof values[f.key] === "string" ? (values[f.key] as string) : ""} onChange={(v) => onChange(f.key, v)} />
              ))}
            </div>
          </Section>
        )
      )}
    </>
  );
}

const asRows = (x: string | ManualRow[] | undefined): ManualRow[] => (Array.isArray(x) ? x : []);

function TableSection({
  section,
  table,
  rows,
  values,
  onChange,
}: {
  section: ManualSection;
  table: ManualTable;
  rows: ManualRow[];
  /** The whole form's values, for a column shown only some of the time (`when`). */
  values: ManualValues;
  onChange: (rows: ManualRow[]) => void;
}) {
  const columns = table.columns.filter((c) => !c.when || c.when(values));
  const setCell = (n: number, key: string, v: string) => onChange(rows.map((r, i) => (i === n ? { ...r, [key]: v } : r)));
  const add = (
    <button type="button" onClick={() => onChange([...rows, blankRow(table)])} className="inline-flex items-center gap-1 text-[12px] text-text-accent hover:underline">
      <Plus size={12} /> {table.addLabel}
    </button>
  );
  // A set adds the lines not already there, by what the first column says: two of "B/L fee" would be billed twice.
  const first = table.columns[0].key;
  const addSet = (set: ManualRow[]) => {
    const have = new Set(rows.map((r) => (r[first] ?? "").trim().toLowerCase()));
    onChange([...rows, ...set.filter((r) => !have.has((r[first] ?? "").trim().toLowerCase())).map((r) => ({ ...blankRow(table), ...r }))]);
  };
  return (
    <Section title={section.title} action={rows.length > 0 ? add : undefined}>
      {(section.note || table.hint) && <p className="-mt-1 mb-3 text-[11.5px] text-text-muted">{section.note ?? table.hint}</p>}
      {table.presets && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5 text-[11.5px] text-text-muted">Add the usual:</span>
          {table.presets.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => addSet(p.rows)}
              className="inline-flex h-7 items-center gap-1 rounded-full border border-border bg-surface-1 px-2.5 text-[11.5px] text-text-secondary hover:border-border-strong hover:text-text-primary"
            >
              <Plus size={11} /> {p.label}
            </button>
          ))}
        </div>
      )}
      {rows.length === 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-border-strong px-3 py-3">
          <span className="text-[12px] text-text-muted">None yet.</span>
          {add}
        </div>
      ) : (
        /*
          A card per line rather than a table row. The manifest's line has
          fourteen columns; as a table that is a sideways scroll on a laptop
          and unusable on a phone, and as a card it wraps to whatever is there.
        */
        <ol className="space-y-2">
          {rows.map((r, n) => (
            <li key={n} className="rounded-lg border border-border bg-surface-1 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
                  {table.lineLabel} {n + 1}
                </span>
                <button
                  type="button"
                  onClick={() => onChange(rows.filter((_, i) => i !== n))}
                  aria-label={`Remove line ${n + 1}`}
                  className="grid size-7 place-items-center rounded-lg text-text-muted hover:bg-bg-danger hover:text-text-danger"
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {columns.map((c) => (
                  <FieldBox key={c.key} field={c} value={r[c.key] ?? ""} onChange={(v) => setCell(n, c.key, v)} compact />
                ))}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

function FieldBox({ field: f, value, onChange, compact = false }: { field: ManualField; value: string; onChange: (v: string) => void; compact?: boolean }) {
  const input = f.input ?? "text";
  const unreadable = input === "number" && value.trim() !== "" && parseNumber(value) === undefined;
  const cls = `w-full ${compact ? "h-8 text-[12.5px]" : "h-9"} ${unreadable ? "!border-[var(--text-danger)]" : ""}`;
  const id = useId();

  if (input === "check") {
    return (
      <label className={`flex items-start gap-2 text-[12.5px] text-text-secondary ${f.wide ? "sm:col-span-full" : ""} ${compact ? "" : "pt-5"}`}>
        <input type="checkbox" checked={value === "yes"} onChange={(e) => onChange(e.target.checked ? "yes" : "")} className="mt-0.5 size-3.5 accent-[var(--brand)]" />
        <span>
          {f.label}
          {f.hint && <span className="mt-0.5 block text-[11px] text-text-muted">{f.hint}</span>}
        </span>
      </label>
    );
  }

  // A row of buttons, one pressed; nothing chosen yet is the first.
  if (input === "segmented") {
    const opts = f.options ?? [];
    const current = opts.some((o) => o.value === value) ? value : opts[0]?.value;
    return (
      <div className={`min-w-0 ${f.wide ? "sm:col-span-full" : ""}`}>
        <span className={`mb-1 block ${compact ? "text-[11px]" : "text-[11.5px]"} font-medium text-text-secondary`}>{f.label}</span>
        <div role="radiogroup" aria-label={f.label} className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5">
          {opts.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={current === o.value}
              onClick={() => onChange(o.value)}
              className={`h-8 rounded-md px-3 text-[12.5px] transition-colors ${
                current === o.value ? "bg-surface-1 font-medium text-text-primary shadow-sm" : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
        {f.hint && <p className="mt-1 text-[11px] text-text-muted">{f.hint}</p>}
      </div>
    );
  }

  const control =
    input === "textarea" ? (
      <textarea id={id} value={value} rows={3} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} className="w-full resize-y leading-snug" />
    ) : input === "select" || input === "yesno" ? (
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={cls}>
        {(input === "yesno"
          ? [
              { value: "", label: "Not stated" },
              { value: "yes", label: "Yes" },
              { value: "no", label: "No" },
            ]
          : (f.options ?? [])
        ).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    ) : (
      <input
        id={id}
        type={input === "date" ? "date" : "text"}
        inputMode={input === "number" ? "decimal" : undefined}
        value={value}
        placeholder={f.placeholder}
        onChange={(e) => onChange(e.target.value)}
        list={f.suggestions ? `${id}-list` : undefined}
        aria-invalid={unreadable || undefined}
        className={`${cls} ${input === "number" ? "tabular-nums" : ""}`}
      />
    );

  return (
    <div className={`min-w-0 ${f.wide ? "sm:col-span-full" : ""}`}>
      <label htmlFor={id} className={`mb-1 block ${compact ? "text-[11px]" : "text-[11.5px]"} font-medium text-text-secondary`}>
        {f.label}
        {f.required && (
          <span className="ml-0.5 text-text-danger" title="The document needs this">
            *
          </span>
        )}
      </label>
      {control}
      {f.suggestions && (
        <datalist id={`${id}-list`}>
          {f.suggestions.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      )}
      {unreadable ? (
        <p className="mt-1 text-[11px] text-text-danger">Not a number: it would print as nothing.</p>
      ) : (
        f.hint && <p className="mt-1 text-[11px] text-text-muted">{f.hint}</p>
      )}
    </div>
  );
}
