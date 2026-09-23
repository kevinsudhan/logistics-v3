import { useMemo, useState } from "react";
import { AlertCircle, Loader2, Package, Sparkles, Wand2 } from "lucide-react";
import { failureText, type FailureText } from "../lib/errorText";
import {
  chargeableWeight,
  describeChargeable,
  modeFor,
  volumeFromPieces,
} from "../lib/chargeableWeight";
import { readText, type Reading } from "../services/classify";
import { threadText } from "../lib/mailText";
import { useAuth } from "../lib/auth";
import { updateEnquiry, type Enquiry, type FiledMessage } from "../services/enquiries";
import { byKey, type FieldDef } from "../data/requestFields";
import Collapsible from "./Collapsible";
import { CARGO_KEYS, type AutoFilled } from "../services/autoFill";

/**
 * What a consol agent needs, in the order they ask for it.
 *
 * ---------------------------------------------------------------------------
 * WHY THESE FIELDS AND THIS ORDER
 *
 * A co-loader will not quote without knowing what the cargo is, how much space
 * it takes, where it is coming into, and by when. Everything else — the parties,
 * the marks, the dangerous-goods paperwork — is needed to ISSUE, not to quote,
 * and putting it first is how a screen gets abandoned halfway down.
 *
 * So: the chargeable weight and what it is made of, then the consolidation
 * (CFS and cut-offs), then the parties, then DG. An operator working top to
 * bottom answers the agent's first question first.
 *
 * WHY CHARGEABLE WEIGHT IS AT THE TOP AND IS NOT AN INPUT
 *
 * It is the number the rate is quoted against, and it is derived: whichever of
 * weight and volume is greater once both are in the mode's own unit. Offering
 * it as a field would invite somebody to type a figure that disagrees with the
 * weight and volume beside it, and the disagreement would be invisible.
 * ---------------------------------------------------------------------------
 */

/** The catalogue keys this panel shows, grouped as the agent asks for them. */
const SECTIONS: Array<{ title: string; hint: string; keys: string[] }> = [
  {
    title: "Consolidation",
    hint: "Where it joins the console, and by when.",
    keys: ["cfs_location", "cargo_cutoff", "si_cutoff", "freight_terms"],
  },
  {
    title: "Parties on the bill of lading",
    hint: "Printed as written, so it is worth them being right.",
    keys: ["consignee_name", "consignee_address", "consignee_country", "notify_name", "notify_address"],
  },
  {
    title: "Cargo particulars",
    hint: "What the B/L and the packing list describe.",
    keys: ["marks_and_numbers", "hs_code", "package_count", "package_type", "net_weight_kg"],
  },
  {
    title: "Dangerous goods",
    hint: "Only where the cargo is hazardous. A wrong class is a refused booking.",
    keys: ["un_number", "imo_class", "packing_group", "flash_point_c", "msds_provided"],
  },
];

/**
 * Every field this panel shows.
 *
 * Exported because the automatic fill is allowed to write exactly these and
 * nothing else — defining the list twice is how one of them quietly starts
 * writing a field the other does not display.
 */
/** How a mode reads in a sentence, rather than as its stored value. */
const MODE_LABEL: Record<string, string> = {
  sea_lcl: "sea LCL",
  sea_fcl: "sea FCL",
  air: "air",
  road: "road",
  other: "other",
};

export const CONSOL_KEYS = SECTIONS.flatMap((s) => s.keys);

export default function ShipmentDetailsPanel({
  enquiry,
  mail,
  autoFilled,
  onSaved,
}: {
  enquiry: Enquiry;
  /** The enquiry's correspondence, which is what the extraction reads. */
  mail: FiledMessage[];
  /**
   * What the automatic fill wrote when this enquiry was opened, if anything.
   *
   * Passed in rather than run here: it happens on opening the file at all, not
   * on opening this section, so that a value read out of a mail is in the
   * record whichever screen somebody looks at next.
   */
  autoFilled?: AutoFilled | null;
  onSaved: () => void;
}) {
  const { session } = useAuth();
  // Whose mailbox the full bodies are fetched from.
  const mailbox = session?.email ?? "";
  const [reading, setReading] = useState(false);
  const [found, setFound] = useState<Reading | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<FailureText | null>(null);

  /**
   * Fields edited by hand, held until Save.
   *
   * Separate from the record so the screen can show what is stored and what is
   * about to change at the same time, and so leaving the section without
   * saving leaves the enquiry alone. Most of these are answers somebody reads
   * off a mail and types — the extraction is a shortcut, not the only way in.
   */
  const record = enquiry as unknown as Record<string, unknown>;
  const [edits, setEdits] = useState<Record<string, unknown>>({});
  const dirty = Object.keys(edits).length > 0;

  const valueOf = (key: string) => (key in edits ? edits[key] : record[key]);
  const setField = (key: string, v: unknown) =>
    setEdits((prev) => ({ ...prev, [key]: v === "" ? null : v }));

  async function saveEdits() {
    setSaving(true);
    setError(null);
    try {
      await updateEnquiry(enquiry.ref, edits as Partial<Enquiry>);
      setEdits({});
      onSaved();
    } catch (e) {
      setError(failureText(e, "Could not save those details."));
    } finally {
      setSaving(false);
    }
  }

  /**
   * The billed figure.
   *
   * Volume is taken as measured where it exists and derived from the piece
   * dimensions only where it does not — a measured CBM beats one calculated
   * from a bounding box, because cargo is not a cuboid and the box is always
   * the larger of the two.
   */
  const mode = enquiry.transport_mode ?? null;

  /**
   * Whether this consignment is actually hazardous.
   *
   * Any of the four DG facts being present is enough — a UN number with no
   * class yet is still a hazardous shipment somebody is part-way through
   * recording, and folding the section on them would hide their own work.
   */
  const hasDangerousGoods = ["un_number", "imo_class", "packing_group", "flash_point_c"].some(
    (k) => !isBlank(record[k])
  );

  /**
   * "3 of 5" for a folded section.
   *
   * The point of a count on a closed section is to say whether opening it is
   * worth it. A section reading 0 of 5 is one somebody can leave shut.
   */
  const filledIn = (keys: string[]) => {
    const done = keys.filter((k) => !isBlank(valueOf(k))).length;
    return `${done} of ${keys.length}`;
  };

  const charge = useMemo(() => {
    // FCL is bought by the box. There is no chargeable weight to compute and
    // showing one would invite somebody to quote against it.
    if (mode === "sea_fcl" || mode === "other") return null;
    const measured = enquiry.volume_cbm;
    const derived = volumeFromPieces(
      enquiry.piece_length_cm,
      enquiry.piece_width_cm,
      enquiry.piece_height_cm,
      enquiry.piece_count
    );
    return chargeableWeight(
      enquiry.gross_weight_kg,
      measured ?? derived,
      // Nothing recorded falls to sea LCL, which is what this desk mostly does
      // — and the mode is named under the figure, so a wrong default is
      // visible rather than silent.
      modeFor(mode)
    );
  }, [enquiry, mode]);

  /**
   * Reads the correspondence and proposes values for the blanks.
   *
   * The whole thread at once rather than message by message: an agent's
   * question and the shipper's answer are two mails, and the answer alone is
   * "Chennai CFS, 14th" with nothing saying which field each belongs to.
   */
  async function extract() {
    setReading(true);
    setError(null);
    try {
      // The full bodies, not `bodyPreview` — see lib/mailText.ts. The button
      // and the automatic fill read the same text, so pressing it cannot
      // produce something the automatic pass could not have.
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

  /** What the reading would fill in, ignoring anything already answered. */
  const proposals = useMemo(() => {
    if (!found) return [];
    const r = found as unknown as Record<string, unknown>;
    /*
      Everything the reading may write, not only what this panel displays.

      These were the panel's own section keys, which meant the manual "read the
      mail" button could propose a packing group and not an origin — the same
      mistake the automatic fill had. It matters more here, because this button
      is the escape hatch: when an automatic pass misses a field, pressing it is
      how somebody recovers, and a recovery that cannot reach the missing field
      is not one.
    */
    return [...CARGO_KEYS, ...CONSOL_KEYS]
      .map((key) => ({ key, def: byKey(key), value: r[key] }))
      .filter(
        (p) =>
          p.def &&
          p.value !== null &&
          p.value !== undefined &&
          p.value !== "" &&
          // Never over the top of an answer somebody already has. The same rule
          // as applyPlan: a reading fills blanks and does not correct people.
          isBlank(record[p.key])
      );
  }, [found, record]);

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
    <section className="mt-4 space-y-4">
      {/* ---- what it is billed on ---- */}
      <div className="card p-5">
        <h2 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
          <Package size={12} /> Chargeable weight
        </h2>
        <p className="mt-1 text-[24px] font-semibold tabular-nums text-text-primary">
          {charge ? `${charge.value} ${charge.unit}` : "—"}
        </p>
        <p className="text-[12px] text-text-secondary">
          {mode === "sea_fcl"
            ? "FCL is charged per container, not on chargeable weight"
            : mode === "other"
              ? "No standard ratio for this mode — quote it on the actual weight and volume"
              : describeChargeable(charge)}
        </p>
        <p className="mt-2 max-w-prose text-[11px] text-text-muted">
          Whichever of weight and volume is greater, in the unit the mode bills in, rounded up
          the way the carrier rounds. Derived from the gross weight and volume on the Details
          section &mdash; correct it there.{" "}
          {mode ? (
            <>Priced as <strong className="text-text-secondary">{MODE_LABEL[mode]}</strong>.</>
          ) : (
            <>
              No mode recorded, so it is priced as sea LCL. Air converts at six times the rate
              &mdash; set the service under Service details if this is an air enquiry.
            </>
          )}
        </p>
      </div>

      {/* ---- what the new mail filled in on its own ---- */}
      {autoFilled && (
        <div className="card flex items-start gap-2.5 border-border-strong p-4">
          <Wand2 size={14} className="mt-px shrink-0 text-text-secondary" />
          <div className="text-[12px] text-text-secondary">
            <p>
              Filled from new correspondence:{" "}
              <strong className="text-text-primary">
                {autoFilled.fields.map((f) => f.def.label).join(", ")}
              </strong>
            </p>
            {autoFilled.from && (
              <p className="mt-0.5 text-[11px] text-text-muted">
                Read from &ldquo;{autoFilled.from}&rdquo;. Blanks only &mdash; nothing already
                answered was changed. Correct anything wrong below.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ---- read it out of the mail ---- */}
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[14px] font-medium text-text-primary">
              Fill these in from the correspondence
            </h2>
            <p className="mt-1 max-w-prose text-[12px] text-text-secondary">
              Reads this enquiry&rsquo;s mail and proposes what it finds. It fills blanks only
              and never corrects an answer already recorded — and nothing is written until you
              press apply.
            </p>
          </div>
          <button
            onClick={() => void extract()}
            disabled={reading || !mail.length}
            title={mail.length ? undefined : "There is no correspondence on this enquiry yet"}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary disabled:opacity-60"
          >
            {reading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            Read the mail
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
          <p className="mt-3 text-[12px] text-text-muted">
            Nothing new found. Either the correspondence does not say, or these are already
            answered.
          </p>
        )}

        {proposals.length > 0 && (
          <div className="mt-3">
            <ul className="divide-y divide-border">
              {proposals.map((p) => (
                <li key={p.key} className="flex items-baseline justify-between gap-4 py-2">
                  <span className="text-[12px] text-text-secondary">{p.def!.label}</span>
                  <span className="text-right text-[13px] text-text-primary">
                    {String(p.value)}
                  </span>
                </li>
              ))}
            </ul>
            <button
              onClick={() => void applyAll()}
              disabled={saving}
              className="mt-3 flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
            >
              {saving && <Loader2 size={13} className="animate-spin" />}
              Fill in {proposals.length} {proposals.length === 1 ? "blank" : "blanks"}
            </button>
          </div>
        )}
      </div>

      {/* ---- the fields themselves, editable ---- */}
      {SECTIONS.map((s) => (
        <Collapsible
          key={s.title}
          /* Keyed by section, not by enquiry: "I never ship dangerous
             goods" is a fact about the person, and keying it per job would
             ask them to fold it again on every one. */
          id={`consol:${s.title}`}
          title={s.title}
          hint={s.hint}
          /* Dangerous goods starts folded unless this cargo actually is.
             Most consignments are not hazardous, and four empty fields
             about UN numbers on every ordinary enquiry is the section
             people scroll past to reach the one they wanted. */
          defaultOpen={s.title !== "Dangerous goods" || hasDangerousGoods}
          badge={filledIn(s.keys)}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {s.keys.map((key) => {
              const def = byKey(key);
              if (!def) return null;
              return (
                <label key={key} className="block">
                  <span className="block text-[12px] text-text-secondary">{def.label}</span>
                  <Field def={def} value={valueOf(key)} onChange={(v) => setField(key, v)} />
                  {/* The hint is what the extractor is told, so an operator
                      filling this by hand reads the same definition the model
                      was given — and the two cannot drift. */}
                  <span className="mt-0.5 block text-[11px] text-text-muted">{def.hint}</span>
                </label>
              );
            })}
          </div>
        </Collapsible>
      ))}

      {/* ---- saved only on purpose ---- */}
      {dirty && (
        <div className="sticky bottom-4 flex flex-wrap items-center justify-between gap-3 card p-4">
          <p className="text-[12px] text-text-secondary">
            {Object.keys(edits).length} {Object.keys(edits).length === 1 ? "change" : "changes"}{" "}
            not saved yet.
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEdits({})}
              disabled={saving}
              className="h-8 rounded-lg border border-border px-3 text-[12px] text-text-secondary transition-colors hover:text-text-primary disabled:opacity-60"
            >
              Discard
            </button>
            <button
              onClick={() => void saveEdits()}
              disabled={saving}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
            >
              {saving && <Loader2 size={13} className="animate-spin" />}
              Save
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * One input, of the kind the catalogue says the field is.
 *
 * Driven off `kind` rather than hand-written per field so that adding a field
 * to the catalogue adds it here too — the alternative is a form that silently
 * omits whatever was added last.
 */
function Field({
  def,
  value,
  onChange,
}: {
  def: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const common = "mt-1 h-8 w-full";

  if (def.kind === "boolean") {
    return (
      <select
        className={common}
        value={value === true ? "yes" : value === false ? "no" : ""}
        onChange={(e) =>
          onChange(e.target.value === "" ? null : e.target.value === "yes")
        }
      >
        <option value="">Not captured</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    );
  }

  if (def.kind === "enum") {
    return (
      <select
        className={common}
        value={(value as string) ?? ""}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Not captured</option>
        {(def.options ?? []).map((o) => (
          <option key={o} value={o}>
            {/* Stored values like "sea_lcl" are what the extractor and the
                check constraint agree on; they are not what a person reads. */}
            {MODE_LABEL[o] ?? o}
          </option>
        ))}
      </select>
    );
  }

  if (def.kind === "number") {
    return (
      <input
        type="number"
        className={common}
        value={(value as number | null) ?? ""}
        // An empty box is "not captured", not zero — and zero is a real answer
        // for a flash point, so they cannot be the same value.
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        placeholder={def.unit ?? ""}
      />
    );
  }

  if (def.kind === "date") {
    return (
      <input
        type="date"
        className={common}
        value={((value as string) ?? "").slice(0, 10)}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  return (
    <input
      type="text"
      className={common}
      value={(value as string) ?? ""}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}


/** Empty enough to be worth filling. `false` and `0` are answers. */
function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

function format(v: unknown, def: FieldDef): string {
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return def.unit ? `${v} ${def.unit}` : String(v);
}
