import { useMemo, useState } from "react";
import { AlertCircle, Loader2, Ruler, Sparkles, Wand2 } from "lucide-react";
import { failureText, type FailureText } from "../lib/errorText";
import { readText, type Reading } from "../services/classify";
import { threadText } from "../lib/mailText";
import { useAuth } from "../lib/auth";
import { updateEnquiry, type Enquiry, type FiledMessage } from "../services/enquiries";
import { byKey, saneValue } from "../data/requestFields";
import type { AutoFilled } from "../services/autoFill";
import { addDimensions } from "../services/enquiryDimensions";
import {
  describeSize,
  isEmptyLine,
  ownedByLines,
  readSizes,
  sizeToLine,
  sizesNotInTable,
  type DimensionLine,
  type ReadSize,
} from "../lib/dimensions";

/**
 * One strip at the top of the shipment page: what the mail filled in, and a
 * button to read it again.
 *
 * ---------------------------------------------------------------------------
 * WHY ONE STRIP AND NOT A CARD PER SECTION
 *
 * The reading fills fields across every panel below — the lane, the cargo,
 * the sizes, the consignee. A "read the mail" button inside any one of them
 * suggested it only filled that one, and two cards saying what was filled and
 * offering to fill more took more room than the fields they were about.
 *
 * SIZES
 *
 * Every piece size the mail gives. Into an empty dimension table they go as
 * they are; against a table that already has lines, the ones it lacks are
 * listed to add — never written on their own, because a mail correcting a size
 * reads exactly like a mail adding one.
 *
 * The rules are unchanged: blanks only, nothing already answered is touched,
 * and a manual reading proposes before it writes.
 * ---------------------------------------------------------------------------
 */
export default function MailFillBar({
  enquiry,
  mail,
  autoFilled,
  keys,
  lines,
  onSaved,
}: {
  enquiry: Enquiry;
  mail: FiledMessage[];
  autoFilled?: AutoFilled | null;
  /** What the reading may write. The same list the automatic fill uses. */
  keys: string[];
  /** The dimension table as it stands. */
  lines: DimensionLine[];
  onSaved: () => void;
}) {
  const { session } = useAuth();
  const mailbox = session?.email ?? "";
  const [reading, setReading] = useState(false);
  const [found, setFound] = useState<Reading | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<FailureText | null>(null);
  // The automatic pass's proposed sizes, once dismissed or added.
  const [autoSizesDone, setAutoSizesDone] = useState(false);

  const record = enquiry as unknown as Record<string, unknown>;
  const unit = enquiry.dimension_unit ?? "cm_kg";
  const tableEmpty = !lines.some((l) => !isEmptyLine(l));

  async function extract() {
    setReading(true);
    setError(null);
    try {
      // Full bodies, not previews: the same text the automatic fill reads, so
      // pressing this cannot find less than it would have.
      const text = await threadText(
        mailbox,
        mail.map((f) => f.message)
      );
      setFound(await readText({ body: text, subject: enquiry.ref }));
    } catch (e) {
      setError(failureText(e, "Could not read the correspondence."));
    } finally {
      setReading(false);
    }
  }

  /** Sizes to offer: from a manual reading if there is one, else the automatic pass's. */
  const sizes: ReadSize[] = useMemo(() => {
    if (found) {
      const read = readSizes(found.dimension_lines);
      return tableEmpty ? read : sizesNotInTable(read, lines, unit);
    }
    if (autoSizesDone || !autoFilled?.newSizes.length) return [];
    // Re-checked against the table: one may have been typed in meanwhile.
    return sizesNotInTable(autoFilled.newSizes, lines, unit);
  }, [found, autoFilled, autoSizesDone, lines, unit, tableEmpty]);

  const proposals = useMemo(() => {
    if (!found) return [];
    const r = found as unknown as Record<string, unknown>;
    // Sizes going into an empty table decide the single-size columns.
    const owned = new Set(tableEmpty ? ownedByLines(sizes.map((s) => sizeToLine(s, unit))) : []);
    return (
      keys
        .filter((key) => !owned.has(key))
        // The same shaping the automatic fill applies, so "apply" cannot fail
        // on a value the automatic pass would have dropped.
        .map((key) => ({ key, def: byKey(key), value: saneValue(key, r[key]) }))
        .filter(
          (p) =>
            p.def &&
            p.value !== null &&
            p.value !== undefined &&
            p.value !== "" &&
            isBlank(record[p.key])
        )
    );
  }, [found, record, keys, sizes, tableEmpty, unit]);

  async function apply() {
    setSaving(true);
    setError(null);
    try {
      // Lines before fields: the totals are summed from the lines, and a
      // stated total written after them survives only where no line gives it.
      if (sizes.length) {
        const after = lines.reduce((m, l) => Math.max(m, l.position), 0);
        await addDimensions(
          enquiry.ref,
          after,
          sizes.map((s) => sizeToLine(s, unit))
        );
      }
      if (proposals.length) {
        const patch: Record<string, unknown> = {};
        for (const p of proposals) patch[p.key] = p.value;
        await updateEnquiry(enquiry.ref, patch);
      }
      setFound(null);
      setAutoSizesDone(true);
      onSaved();
    } catch (e) {
      setError(failureText(e, "Could not save those details."));
    } finally {
      setSaving(false);
    }
  }

  const filledNames = [
    ...(autoFilled?.fields.map((f) => f.def.label) ?? []),
    ...(autoFilled?.sizesAdded
      ? [`${autoFilled.sizesAdded} package ${autoFilled.sizesAdded === 1 ? "size" : "sizes"}`]
      : []),
  ];

  const applyLabel = [
    proposals.length ? `fill in ${proposals.length} ${proposals.length === 1 ? "blank" : "blanks"}` : null,
    sizes.length ? `add ${sizes.length} ${sizes.length === 1 ? "size" : "sizes"}` : null,
  ]
    .filter(Boolean)
    .join(" and ");

  return (
    <div className="card mt-4 px-5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex min-w-0 items-start gap-2 text-[12px] text-text-secondary">
          <Wand2 size={13} className="mt-px shrink-0 text-text-muted" />
          {filledNames.length ? (
            <span>
              Filled from new mail:{" "}
              <strong className="font-medium text-text-primary">{filledNames.join(", ")}</strong>
              <span className="text-text-muted"> — blanks only. Correct anything wrong below.</span>
            </span>
          ) : (
            <span>Blank fields are filled from this enquiry&rsquo;s mail as it arrives.</span>
          )}
        </p>
        <button
          type="button"
          onClick={() => void extract()}
          disabled={reading || !mail.length}
          title={mail.length ? undefined : "There is no correspondence on this enquiry yet"}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary disabled:opacity-60"
        >
          {reading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
          Read the mail again
        </button>
      </div>

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          <span>
            {error.message}
            {error.hint && <span className="mt-1 block opacity-80">{error.hint}</span>}
          </span>
        </div>
      )}

      {found && !proposals.length && !sizes.length && (
        <p className="mt-2 text-[12px] text-text-muted">
          Nothing new found — the mail does not say, or those are already answered.
        </p>
      )}

      {(proposals.length > 0 || sizes.length > 0) && (
        <div className="mt-3 border-t border-border pt-2">
          {proposals.length > 0 && (
            <ul className="divide-y divide-border">
              {proposals.map((p) => (
                <li key={p.key} className="flex items-baseline justify-between gap-4 py-1.5">
                  <span className="text-[12px] text-text-secondary">{p.def!.label}</span>
                  <span className="text-right text-[13px] text-text-primary">
                    {typeof p.value === "boolean"
                      ? p.value
                        ? "Yes"
                        : "No"
                      : String(p.value).replace(/_/g, " ")}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {sizes.length > 0 && (
            <div className={proposals.length ? "mt-2 border-t border-border pt-2" : ""}>
              <p className="flex items-center gap-1.5 text-[12px] text-text-secondary">
                <Ruler size={12} className="text-text-muted" />
                {tableEmpty
                  ? "Package sizes in the mail"
                  : "Package sizes in the mail that are not in the dimension table"}
              </p>
              <ul className="mt-1 space-y-0.5">
                {sizes.map((s, i) => (
                  <li key={i} className="text-[13px] tabular-nums text-text-primary">
                    {describeSize(s)}
                  </li>
                ))}
              </ul>
              {!tableEmpty && (
                <p className="mt-1 text-[11px] text-text-muted">
                  If one of these corrects a size already in the table, change that row instead of
                  adding it.
                </p>
              )}
            </div>
          )}

          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => void apply()}
              disabled={saving}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
            >
              {saving && <Loader2 size={13} className="animate-spin" />}
              {applyLabel.charAt(0).toUpperCase() + applyLabel.slice(1)}
            </button>
            <button
              type="button"
              onClick={() => {
                setFound(null);
                setAutoSizesDone(true);
              }}
              className="h-8 rounded-lg border border-border px-3 text-[12px] text-text-secondary hover:text-text-primary"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Empty enough to be worth filling. `false` and `0` are answers. */
function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}
