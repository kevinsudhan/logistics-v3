import { useMemo, useState } from "react";
import { AlertCircle, Loader2, Sparkles, Wand2 } from "lucide-react";
import { failureText, type FailureText } from "../lib/errorText";
import { readText, type Reading } from "../services/classify";
import { threadText } from "../lib/mailText";
import { useAuth } from "../lib/auth";
import { updateEnquiry, type Enquiry, type FiledMessage } from "../services/enquiries";
import { byKey } from "../data/requestFields";
import type { AutoFilled } from "../services/autoFill";

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
 * The rules are unchanged: blanks only, nothing already answered is touched,
 * and a manual reading proposes before it writes.
 * ---------------------------------------------------------------------------
 */
export default function MailFillBar({
  enquiry,
  mail,
  autoFilled,
  keys,
  onSaved,
}: {
  enquiry: Enquiry;
  mail: FiledMessage[];
  autoFilled?: AutoFilled | null;
  /** What the reading may write. The same list the automatic fill uses. */
  keys: string[];
  onSaved: () => void;
}) {
  const { session } = useAuth();
  const mailbox = session?.email ?? "";
  const [reading, setReading] = useState(false);
  const [found, setFound] = useState<Reading | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<FailureText | null>(null);

  const record = enquiry as unknown as Record<string, unknown>;

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

  const proposals = useMemo(() => {
    if (!found) return [];
    const r = found as unknown as Record<string, unknown>;
    return keys
      .map((key) => ({ key, def: byKey(key), value: r[key] }))
      .filter(
        (p) =>
          p.def &&
          p.value !== null &&
          p.value !== undefined &&
          p.value !== "" &&
          isBlank(record[p.key])
      );
  }, [found, record, keys]);

  async function applyAll() {
    setSaving(true);
    setError(null);
    try {
      const patch: Record<string, unknown> = {};
      for (const p of proposals) patch[p.key] = p.value;
      await updateEnquiry(enquiry.ref, patch);
      setFound(null);
      onSaved();
    } catch (e) {
      setError(failureText(e, "Could not save those details."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card mt-4 px-5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex min-w-0 items-start gap-2 text-[12px] text-text-secondary">
          <Wand2 size={13} className="mt-px shrink-0 text-text-muted" />
          {autoFilled?.fields.length ? (
            <span>
              Filled from new mail:{" "}
              <strong className="font-medium text-text-primary">
                {autoFilled.fields.map((f) => f.def.label).join(", ")}
              </strong>
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

      {found && !proposals.length && (
        <p className="mt-2 text-[12px] text-text-muted">
          Nothing new found — the mail does not say, or those are already answered.
        </p>
      )}

      {proposals.length > 0 && (
        <div className="mt-3 border-t border-border pt-2">
          <ul className="divide-y divide-border">
            {proposals.map((p) => (
              <li key={p.key} className="flex items-baseline justify-between gap-4 py-1.5">
                <span className="text-[12px] text-text-secondary">{p.def!.label}</span>
                <span className="text-right text-[13px] text-text-primary">{String(p.value)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => void applyAll()}
              disabled={saving}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
            >
              {saving && <Loader2 size={13} className="animate-spin" />}
              Fill in {proposals.length} {proposals.length === 1 ? "blank" : "blanks"}
            </button>
            <button
              type="button"
              onClick={() => setFound(null)}
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
