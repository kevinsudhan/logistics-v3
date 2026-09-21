import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, ArrowDownToLine, Check, Layers, Ship } from "lucide-react";
import Select from "../../components/Select";
import { useShipment } from "../ShipmentDetail";
import { updateShipment } from "../../services/enquiries";
import { STATES } from "../../services/charges";
import {
  attachToConsole,
  detachFromConsole,
  issueHouseBl,
  openConsoles,
  type Console,
} from "../../services/consoles";
import {
  BL_LINE_LIMIT,
  COUNTRIES,
  ROLE_HINT,
  ROLE_LABEL,
  countryCodeFor,
  fromGstin,
  overlongLines,
  partyPatch,
  readParty,
  type Party,
  type PartyRole,
} from "../../lib/blParties";

/**
 * Shipper, consignee and notify party, as the bill of lading names them.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE SCREEN THIS REPLACES GETS WRONG
 *
 * Its consignee is in a city called New York, in the state of Tamil Nadu, code
 * 33, in India. Every one of those fields is a free text box that knows nothing
 * about the others, so nothing anywhere objects. The fields here are related to
 * each other: the state code comes from the GSTIN, the state list only appears
 * for an Indian party, and the country code follows the country.
 *
 * THE CHARACTER COUNTS
 *
 * Their form shows a bare green number beside each box — 26, 21, 32, 51 — which
 * is the length of what you typed. It is useless on its own, because nothing
 * says what number is too big. A B/L party box takes about 35 characters to a
 * line before the carrier truncates it, so the count here is shown against that
 * limit and the lines that run over are named.
 *
 * NOTHING HERE IS REQUIRED
 *
 * Their shipper and consignee are starred. A booking is entered before the
 * consignee is confirmed, and the draft B/L printed with the box empty is what
 * the desk sends to chase it — which is the same reasoning 028 gives for making
 * all of these nullable.
 * ---------------------------------------------------------------------------
 */

function Count({ value, limit = BL_LINE_LIMIT }: { value: string; limit?: number }) {
  const n = value.length;
  const over = n > limit;
  return (
    <span className={`text-[11px] tabular-nums ${over ? "text-text-warning" : "text-text-muted"}`}>
      {n}/{limit}
    </span>
  );
}

function Field({
  label,
  value,
  onCommit,
  placeholder,
  mono,
  count,
  hint,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  count?: boolean;
  hint?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  return (
    <label className="block min-w-0">
      <span className="mb-0.5 flex items-baseline justify-between gap-2">
        <span className="text-[11px] text-text-secondary">{label}</span>
        {count && <Count value={draft} />}
      </span>
      <input
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== value && onCommit(draft)}
        className={`h-8 w-full rounded-lg border border-border bg-surface-1 px-2.5 text-[13px] text-text-primary transition-colors placeholder:text-text-muted hover:border-border-strong focus:border-border-strong focus:outline-none ${
          mono ? "font-mono" : ""
        }`}
      />
      {hint && <span className="mt-0.5 block text-[11px] text-text-muted">{hint}</span>}
    </label>
  );
}

function PartyCard({
  role,
  party,
  onSet,
  extra,
}: {
  role: PartyRole;
  party: Party;
  onSet: (field: keyof Party, value: string, also?: Partial<Party>) => void;
  extra?: React.ReactNode;
}) {
  const [addr, setAddr] = useState(party.address);
  useEffect(() => setAddr(party.address), [party.address]);

  const indian = party.country === "" || party.country === "India";
  const over = overlongLines(addr);

  return (
    <section className="card p-4">
      <h2 className="text-[13px] font-medium text-text-primary">{ROLE_LABEL[role]}</h2>
      <p className="mt-0.5 text-[11px] leading-relaxed text-text-muted">{ROLE_HINT[role]}</p>

      <div className="mt-3 space-y-3">
        <Field
          label="Name"
          value={party.name}
          count
          onCommit={(v) => onSet("name", v)}
          placeholder="Registered name"
        />

        <label className="block">
          <span className="mb-0.5 flex items-baseline justify-between gap-2">
            <span className="text-[11px] text-text-secondary">Address</span>
            <span
              className={`text-[11px] tabular-nums ${
                over.length ? "text-text-warning" : "text-text-muted"
              }`}
            >
              {addr.length} chars
            </span>
          </span>
          <textarea
            value={addr}
            rows={3}
            onChange={(e) => setAddr(e.target.value)}
            onBlur={() => addr !== party.address && onSet("address", addr)}
            className="w-full resize-y rounded-lg border border-border bg-surface-1 px-2.5 py-1.5 text-[13px] leading-relaxed text-text-primary transition-colors hover:border-border-strong focus:border-border-strong focus:outline-none"
          />
          {over.length > 0 && (
            <span className="mt-0.5 block text-[11px] text-text-warning">
              Line{over.length > 1 ? "s" : ""} {over.join(", ")} run past {BL_LINE_LIMIT}{" "}
              characters and the carrier may cut {over.length > 1 ? "them" : "it"} short.
            </span>
          )}
        </label>

        <div className="grid grid-cols-2 gap-3">
          <Field label="City" value={party.city} onCommit={(v) => onSet("city", v)} />
          <Field label="Postcode" value={party.pincode} onCommit={(v) => onSet("pincode", v)} />
        </div>

        <div>
          <span className="mb-0.5 block text-[11px] text-text-secondary">Country</span>
          <Select
            label="Country"
            value={party.country}
            options={[
              { value: "", label: "Not stated" },
              ...COUNTRIES.map((c) => ({ value: c.name, label: c.name, hint: c.code })),
            ]}
            onChange={(v) =>
              // The code follows the country, and a party that has moved out of
              // India cannot keep an Indian state on it.
              onSet("country", v, {
                country_code: countryCodeFor(v),
                ...(v && v !== "India" ? { state: "", state_code: "" } : {}),
              })
            }
          />
        </div>

        {indian ? (
          <div>
            <span className="mb-0.5 block text-[11px] text-text-secondary">State</span>
            <Select
              label="State"
              value={party.state_code}
              options={[
                { value: "", label: "Not stated" },
                ...STATES.map((s) => ({ value: s.code, label: s.name, hint: s.code })),
              ]}
              onChange={(v) =>
                onSet("state_code", v, {
                  state: STATES.find((s) => s.code === v)?.name ?? "",
                })
              }
            />
          </div>
        ) : (
          <Field
            label="State or province"
            value={party.state}
            onCommit={(v) => onSet("state", v)}
          />
        )}

        {indian && (
          <>
            <Field
              label="GSTIN"
              value={party.gstin}
              mono
              placeholder="33ABCDE1234F1Z5"
              hint="Fills the state and the PAN from its own digits"
              onCommit={(v) => {
                const read = fromGstin(v);
                onSet(
                  "gstin",
                  v.toUpperCase(),
                  read
                    ? {
                        state_code: read.state_code,
                        state: STATES.find((s) => s.code === read.state_code)?.name ?? "",
                        pan: read.pan,
                      }
                    : undefined
                );
              }}
            />
            <div className="grid grid-cols-2 gap-3">
              <Field label="PAN" value={party.pan} mono onCommit={(v) => onSet("pan", v.toUpperCase())} />
              <Field label="IEC" value={party.iec} mono onCommit={(v) => onSet("iec", v.toUpperCase())} />
            </div>
          </>
        )}

        {extra}
      </div>
    </section>
  );
}

export default function ShipmentParties() {
  const { shipment, reload } = useShipment();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [consoles, setConsoles] = useState<Console[]>([]);

  // Only the ones still taking cargo. A console that has sailed refuses an
  // attach in the database anyway, and offering it here would be a button that
  // exists to produce an error.
  useEffect(() => {
    void openConsoles()
      .then(setConsoles)
      .catch(() => setConsoles([]));
  }, []);

  const row = shipment as unknown as Record<string, unknown>;
  const shipper = readParty(row, "shipper");
  const consignee = readParty(row, "consignee");
  const notify = readParty(row, "notify");

  async function write(patch: Record<string, unknown>) {
    setError(null);
    try {
      await updateShipment(shipment.id, patch);
      await reload();
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1600);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not save.");
    }
  }

  const setter =
    (role: PartyRole) => (field: keyof Party, value: string, also?: Partial<Party>) => {
      let patch = partyPatch(role, field, value);
      for (const [k, v] of Object.entries(also ?? {})) {
        patch = { ...patch, ...partyPatch(role, k as keyof Party, String(v ?? "")) };
      }
      void write(patch);
    };

  /**
   * The customer's own billing record, onto the shipper box.
   *
   * On an export the customer is the shipper unless the desk says otherwise, so
   * this is a copy rather than a link — a correction to the customer master next
   * year must not rewrite a B/L that has already been issued.
   */
  const copyFromCustomer = () =>
    void write({
      shipper_name: shipment.customer?.company || shipment.customer?.name || null,
    });

  const blType = shipment.bl_type ?? "house";

  return (
    <div>
      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-prose text-[12px] leading-relaxed text-text-secondary">
          These are the boxes printed on the bill of lading. Nothing here is required — a draft
          naming what it is missing is what the desk sends to chase it.
        </p>
        {saved && (
          <span className="inline-flex items-center gap-1 text-[11px] text-text-success">
            <Check size={11} /> Saved
          </span>
        )}
      </div>

      {/* ---- whose bill ---- */}
      <section className="card mb-4 p-4">
        <h2 className="text-[13px] font-medium text-text-primary">Bills of lading</h2>
        <p className="mt-0.5 max-w-prose text-[11px] leading-relaxed text-text-muted">
          On a consolidation the carrier issues one master bill covering the whole box, and we
          issue this shipper their own house bill under it. The house bill is the document the
          customer holds and the one every document here prints.
        </p>

        {/* the console, and the master that comes with it */}
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="min-w-0">
            <span className="mb-0.5 block text-[11px] text-text-secondary">Console</span>
            <Select
              label="Console"
              value={shipment.console_id ?? ""}
              options={[
                { value: "", label: "Not on a console" },
                ...consoles.map((c) => ({
                  value: c.id,
                  label: c.console_no ?? "(unnumbered)",
                  hint: [c.pol, c.pod].filter(Boolean).join(" → ") || c.mode,
                })),
              ]}
              onChange={(v) =>
                void (v
                  ? attachToConsole(shipment.id, v)
                  : detachFromConsole(shipment.id)
                )
                  .then(() => reload())
                  .catch((e: unknown) =>
                    setError(e instanceof Error ? e.message : "Could not change the console.")
                  )
              }
            />
            {shipment.console_id && (
              <Link
                to="/consoles"
                className="mt-1 inline-flex items-center gap-1 text-[11px] text-text-accent hover:underline"
              >
                <Layers size={11} /> Open the console
              </Link>
            )}
          </div>

          <div className="min-w-0">
            <span className="block text-[11px] text-text-secondary">Master B/L</span>
            <span className="block py-1 font-mono text-[13px] text-text-muted">
              {consoles.find((c) => c.id === shipment.console_id)?.mbl_number || "—"}
            </span>
            <span className="block text-[11px] text-text-muted">
              The carrier&rsquo;s, recorded once on the console
            </span>
          </div>

          <div className="min-w-0">
            <span className="block text-[11px] text-text-secondary">House B/L</span>
            {shipment.bl_number ? (
              <span className="block py-1 font-mono text-[13px] text-text-primary">
                {shipment.bl_number}
              </span>
            ) : (
              <button
                onClick={() =>
                  void issueHouseBl(shipment.id)
                    .then(() => reload())
                    .catch((e: unknown) =>
                      setError(e instanceof Error ? e.message : "Could not issue it.")
                    )
                }
                className="mt-0.5 inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-strong bg-surface-1 px-3 text-[12px] font-medium text-text-primary transition-colors hover:bg-surface-2"
              >
                <Ship size={13} />
                Issue a house B/L
              </button>
            )}
            <span className="mt-0.5 block text-[11px] text-text-muted">
              {shipment.bl_number
                ? "Issued — changing it is a correction, not an edit"
                : "Ours, on our own series. Needs a consignee first."}
            </span>
          </div>
        </div>

        {/* who issued the bill this cargo travels under */}
        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-border pt-3">
          <div className="flex gap-1.5">
            {(
              [
                { v: "house", label: "Our house B/L" },
                { v: "forwarder", label: "Another forwarder's B/L" },
              ] as const
            ).map((o) => (
              <button
                key={o.v}
                onClick={() =>
                  void write({
                    bl_type: o.v,
                    // Clearing the number with the choice, so a bill switched
                    // back to ours does not keep somebody else's reference on it.
                    ...(o.v === "house" ? { forwarders_bl_no: null } : {}),
                  })
                }
                aria-pressed={blType === o.v}
                className={`h-8 rounded-lg border px-3 text-[12px] transition-colors ${
                  blType === o.v
                    ? "border-brand bg-brand font-medium text-white"
                    : "border-border bg-surface-1 text-text-secondary hover:border-border-strong hover:text-text-primary"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>

          {blType === "forwarder" && (
            <div className="min-w-[14rem]">
              <Field
                label="Their B/L number"
                value={shipment.forwarders_bl_no ?? ""}
                mono
                onCommit={(v) => void write({ forwarders_bl_no: v || null })}
              />
            </div>
          )}
        </div>
      </section>

      {/* ---- the three parties ---- */}
      <div className="grid gap-4 lg:grid-cols-3">
        <PartyCard
          role="shipper"
          party={shipper}
          onSet={setter("shipper")}
          extra={
            !shipper.name && shipment.customer && (
              <button
                onClick={copyFromCustomer}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
              >
                <ArrowDownToLine size={13} />
                Use {shipment.customer.company || shipment.customer.name}
              </button>
            )
          }
        />

        <PartyCard
          role="consignee"
          party={consignee}
          onSet={setter("consignee")}
          extra={
            consignee.country === "India" && (
              <Field
                label="DPD code"
                value={consignee.dpd_code ?? ""}
                mono
                hint="Direct Port Delivery — a consignee cleared to take the box off the terminal rather than through a CFS"
                onCommit={(v) => void write({ consignee_dpd_code: v.toUpperCase() || null })}
              />
            )
          }
        />

        <PartyCard role="notify" party={notify} onSet={setter("notify")} />
      </div>

      <p className="mt-4 max-w-prose text-[11px] leading-relaxed text-text-muted">
        The shipper box is filled from the customer's billing record when there is one, and the
        state, PAN and country codes are read off the GSTIN and the country rather than asked for
        twice. Everything remains editable: what goes on a bill of lading is what the desk says
        goes on it.
      </p>
    </div>
  );
}
