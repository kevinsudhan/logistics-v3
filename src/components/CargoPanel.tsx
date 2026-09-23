import { useEffect, useState } from "react";
import Collapsible from "./Collapsible";
import { AlertCircle, Check, Loader2, Package, Pencil } from "lucide-react";
import {
  computeGrossKg,
  computeVolumeCbm,
  missingForQuote,
  updateEnquiry,
  type Enquiry,
} from "../services/enquiries";

/**
 * What the customer wants, and what is still missing before it can be priced.
 *
 * Volume and gross weight are never typed. They are derived from the piece
 * dimensions and count, so the figure on the quote and the figure the fit
 * engine works from cannot disagree -- and a customer who says "eight cubes"
 * cannot silently overwrite what the measurements actually come to.
 */
export default function CargoPanel({
  enquiry,
  onSaved,
}: {
  enquiry: Enquiry;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Enquiry>>(enquiry);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setForm(enquiry), [enquiry]);

  const missing = missingForQuote(enquiry);
  const derivedCbm = computeVolumeCbm(form);
  const derivedKg = computeGrossKg(form);

  const set = (k: keyof Enquiry, v: string) =>
    setForm((f) => ({
      ...f,
      [k]: v === "" ? null : /_cm$|_kg$|_cbm$|_count$/.test(k) ? Number(v) : v,
    }));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await updateEnquiry(
        enquiry.ref,
        {
          cargo: form.cargo ?? null,
          ready_date: form.ready_date ?? null,
          consignee_name: form.consignee_name ?? null,
          consignee_country: form.consignee_country ?? null,
          piece_count: form.piece_count ?? null,
          piece_length_cm: form.piece_length_cm ?? null,
          piece_width_cm: form.piece_width_cm ?? null,
          piece_height_cm: form.piece_height_cm ?? null,
          weight_per_piece_kg: form.weight_per_piece_kg ?? null,
          special_handling: form.special_handling ?? null,
          // Derived, not entered.
          volume_cbm: computeVolumeCbm(form),
          /*
            Derived where the pieces give it, kept where they do not.

            This used to be `computeGrossKg(form)` outright, which returns null
            when there is no per-piece weight — so opening Edit on an enquiry
            whose mail said "gross 2000 kgs total" and pressing Save silently
            erased the 2000. The total is a fact in its own right; the
            calculation is a convenience for when the shipper gave weights per
            piece instead.
          */
          gross_weight_kg: computeGrossKg(form) ?? numberOrNull(form.gross_weight_kg),
          // First real detail moves it out of "new" on its own.
          status: enquiry.status === "new" ? "qualifying" : enquiry.status,
        },
        "Shipment details updated"
      );
      setEditing(false);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Collapsible
      id="case:cargo"
      title="Cargo details"
      icon={<Package size={12} className="shrink-0 text-text-muted" />}
      /*
        Open by default and, unlike the rest, open even when empty: this is
        the block a quotation cannot be built without, and the banner naming
        what is still missing is the most useful thing on the page. Folding
        it away by default would hide the one prompt that moves the job on.
      */
      action={
        editing ? undefined : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-border text-[12px] text-text-secondary hover:text-text-primary"
          >
            <Pencil size={12} /> Edit
          </button>
        )
      }
    >

      {/*
        Missing fields are named, not counted. "Four fields missing" sends
        somebody hunting; naming them is the difference between a prompt and a
        complaint -- and these are the fields a quote genuinely depends on,
        since space cannot be checked in three dimensions without dimensions.
      */}
      {missing.length > 0 && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-warning px-3 py-2.5 text-[12px] text-text-warning">
          <AlertCircle size={13} className="mt-px shrink-0" />
          <span>
            <strong className="font-medium">Not everything a rate needs.</strong> Still needed:{" "}
            {missing.join(", ")}.
          </span>
        </div>
      )}

      {!editing ? (
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4 text-[12px]">
          <Fact label="Cargo" value={enquiry.cargo} />
          <Fact label="Packages" value={enquiry.piece_count} />
          <Fact
            label="Piece size"
            value={
              enquiry.piece_length_cm && enquiry.piece_width_cm && enquiry.piece_height_cm
                ? `${enquiry.piece_length_cm} × ${enquiry.piece_width_cm} × ${enquiry.piece_height_cm} cm`
                : null
            }
          />
          <Fact
            label="Weight each"
            value={enquiry.weight_per_piece_kg ? `${enquiry.weight_per_piece_kg} kg` : null}
          />
          <Fact
            label="Gross weight"
            value={enquiry.gross_weight_kg ? `${enquiry.gross_weight_kg} kg` : null}
            derived
          />
          <Fact
            label="Volume"
            value={enquiry.volume_cbm ? `${enquiry.volume_cbm} CBM` : null}
            derived
          />
          <Fact label="Ready date" value={enquiry.ready_date} />
          <Fact label="Consignee" value={enquiry.consignee_name} />
          <Fact label="Handling" value={enquiry.special_handling} />
        </dl>
      ) : (
        <div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <In label="Cargo" v={form.cargo} on={(x) => set("cargo", x)} />

            <In label="Packages" v={form.piece_count} on={(x) => set("piece_count", x)} type="number" />
            <In label="Length (cm)" v={form.piece_length_cm} on={(x) => set("piece_length_cm", x)} type="number" />
            <In label="Width (cm)" v={form.piece_width_cm} on={(x) => set("piece_width_cm", x)} type="number" />
            <In label="Height (cm)" v={form.piece_height_cm} on={(x) => set("piece_height_cm", x)} type="number" />

            <In
              label="Weight each (kg)"
              v={form.weight_per_piece_kg}
              on={(x) => set("weight_per_piece_kg", x)}
              type="number"
            />
            {/*
              The total, typed directly. Shippers quote a total far more often
              than a per-piece weight, and without this field the only way to
              record one was to divide it by the piece count by hand — which is
              arithmetic the desk should not be doing on a figure it was given.
            */}
            <In
              label="Gross total (kg)"
              v={form.gross_weight_kg}
              on={(x) => set("gross_weight_kg", x)}
              type="number"
              placeholder={derivedKg ? `${derivedKg} from the pieces` : undefined}
            />
            <In label="Ready date" v={form.ready_date} on={(x) => set("ready_date", x)} type="date" />
            <In label="Consignee" v={form.consignee_name} on={(x) => set("consignee_name", x)} />
            <In
              label="Special handling"
              v={form.special_handling}
              on={(x) => set("special_handling", x)}
              placeholder="Fragile, this way up…"
            />
          </div>

          <p className="mt-3 text-[12px] text-text-secondary">
            Volume{" "}
            <strong className="text-text-primary">
              {derivedCbm !== null ? `${derivedCbm} CBM` : "—"}
            </strong>{" "}
            and gross weight{" "}
            <strong className="text-text-primary">
              {derivedKg !== null ? `${derivedKg} kg` : "—"}
            </strong>{" "}
            are calculated from the figures above, not entered.
          </p>

          {error && (
            <div
              role="alert"
              className="mt-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger"
            >
              <AlertCircle size={13} className="mt-px shrink-0" />
              {error}
            </div>
          )}

          <div className="mt-4 flex items-center gap-2">
            <button
              onClick={save}
              disabled={busy}
              className="flex items-center gap-1.5 h-8 px-3.5 rounded-lg bg-brand hover:bg-brand-dark disabled:opacity-60 text-white text-[12px] font-medium"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => {
                setForm(enquiry);
                setEditing(false);
              }}
              className="h-8 px-3 rounded-lg border border-border text-[12px] text-text-secondary hover:text-text-primary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </Collapsible>
  );
}

function Fact({
  label,
  value,
  derived = false,
}: {
  label: string;
  value: string | number | null | undefined;
  derived?: boolean;
}) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-text-muted">
        {label}
        {derived && <span className="ml-1 normal-case text-text-muted">· calculated</span>}
      </dt>
      <dd className={`text-[13px] ${value ? "text-text-primary" : "text-text-muted"}`}>
        {value ?? "—"}
      </dd>
    </div>
  );
}

function In({
  label,
  v,
  on,
  type = "text",
  placeholder,
}: {
  label: string;
  v: unknown;
  on: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-text-secondary mb-1">{label}</label>
      <input
        type={type}
        value={(v as string | number | null) ?? ""}
        onChange={(e) => on(e.target.value)}
        placeholder={placeholder}
        className="w-full"
        autoComplete="off"
      />
    </div>
  );
}

/** A form value that may be a string from an input, as a number or null. */
function numberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
