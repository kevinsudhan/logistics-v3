import { useCallback, useEffect, useState } from "react";
import { AlertCircle, ArrowDownToLine, Check, Users } from "lucide-react";
import Select from "../../components/Select";
import Collapsible from "../../components/Collapsible";
import NotifyParty from "../../components/NotifyParty";
import { useShipment } from "../ShipmentDetail";
import { updateShipment, type Shipment } from "../../services/enquiries";
import { STATES } from "../../services/charges";
import { listPartners, type Partner, type PartnerRole } from "../../services/partners";
import { getCustomer, listCustomers, type CustomerSummary } from "../../services/customers";
import {
  clearExtraParty,
  extraPartiesFor,
  saveExtraParty,
  type ExtraParty,
  type ExtraPartyRole,
} from "../../services/shipmentExtras";
import {
  BL_LINE_LIMIT,
  COUNTRIES,
  ROLE_HINT,
  countryCodeFor,
  fromGstin,
  overlongLines,
  partyPatch,
  readParty,
  type Party,
  type PartyRole,
} from "../../lib/blParties";
import { useLiveVersion } from "../../lib/liveVersions";

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
 * THE OTHER SIX
 *
 * Shipper, consignee and the first notify party are printed on the B/L and
 * stay columns on the shipment. The agents at each end, who is billed, a
 * second notify party, another forwarder and the customs house agent are the
 * rest of the people a job involves; they are picked from the partner book or
 * the customer directory and their details copied onto this job (065).
 *
 * NOTIFY
 *
 * Every party with an email can be sent an update on the shipment from here —
 * status, the last step done, carrier and dates, as a draft in the compose
 * window, logged on the timeline once it has gone.
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
  email,
  onSet,
  onEmail,
  extra,
}: {
  role: PartyRole;
  party: Party;
  /** Never printed on the B/L — it is where the party is sent updates. */
  email: string;
  onSet: (field: keyof Party, value: string, also?: Partial<Party>) => void;
  onEmail: (v: string) => void;
  extra?: React.ReactNode;
}) {
  const [addr, setAddr] = useState(party.address);
  useEffect(() => setAddr(party.address), [party.address]);

  const indian = party.country === "" || party.country === "India";
  const over = overlongLines(addr);

  return (
    <div>
      <p className="text-[11px] leading-relaxed text-text-muted">{ROLE_HINT[role]}</p>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="space-y-3">
        <Field
          label="Name"
          value={party.name}
          count
          onCommit={(v) => onSet("name", v)}
          placeholder="Registered name"
        />

        <Field
          label="Email"
          value={email}
          placeholder="Where updates go — not printed"
          onCommit={(v) => onEmail(v.trim())}
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
        </div>

        <div className="space-y-3">
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
      </div>
    </div>
  );
}


/** The six non-B/L parties, in the reference order, with where to pick each from. */
const EXTRA: Record<
  ExtraPartyRole,
  { label: string; hint: string; from: "partners" | "customers" | null; roles?: PartnerRole[] }
> = {
  destination_agent: {
    label: "Destination agent",
    hint: "Our agent at destination: receives the pre-alert, clears and delivers.",
    from: "partners",
    roles: ["overseas_agent", "consol_partner"],
  },
  origin_agent: {
    label: "Origin agent",
    hint: "An agent handling the cargo at origin, when it is not us.",
    from: "partners",
    roles: ["overseas_agent", "consol_partner", "cfs_transport"],
  },
  billing_customer: {
    label: "Billing customer",
    hint: "Who the invoice is raised on, when it is not the customer on the job.",
    from: "customers",
  },
  notify_2: {
    label: "Notify customer 2",
    hint: "A second party told on arrival — often the buyer's customs broker.",
    from: null,
  },
  forwarder: {
    label: "Forwarder",
    hint: "Another forwarder on this job — whose bill it moves under, or who handed it to us.",
    from: "partners",
    roles: ["consol_partner", "overseas_agent", "other"],
  },
  customs_house_agent: {
    label: "Customs house agent",
    hint: "The CHA filing the shipping bill or the bill of entry.",
    from: "partners",
    roles: ["cha_customs"],
  },
};

/**
 * One of the six, backed by `shipment_parties`.
 *
 * Picking from the partner book or the customer directory LINKS the record and
 * COPIES its details, which stay editable: the link says who it is, the copy
 * is what this job was told.
 */
function ExtraPartyCard({
  role,
  party,
  partners,
  customers,
  onSave,
  onClear,
}: {
  role: ExtraPartyRole;
  party: ExtraParty | undefined;
  partners: Partner[];
  customers: CustomerSummary[];
  onSave: (patch: Partial<ExtraParty>) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const spec = EXTRA[role];
  const v = (k: keyof ExtraParty) => (party?.[k] as string | null) ?? "";
  const set = (k: keyof ExtraParty) => (value: string) => void onSave({ [k]: value || null });
  const choices = spec.from === "partners" ? partners.filter((p) => spec.roles?.includes(p.role)) : [];

  async function pickPartner(id: string) {
    const p = partners.find((x) => x.id === id);
    if (!p) return onSave({ partner_id: null });
    await onSave({
      partner_id: p.id,
      name: p.organisation || p.name,
      contact_person: p.organisation ? p.name : null,
      email: p.emails[0] ?? null,
      phone: p.phones[0] ?? null,
    });
  }

  async function pickCustomer(id: string) {
    if (!id) return onSave({ customer_id: null });
    const c = await getCustomer(id);
    if (!c) return;
    const r = c as unknown as Record<string, string | null | string[]>;
    await onSave({
      customer_id: c.id,
      name: (r.billing_name as string) || c.company || c.name,
      contact_person: (r.billing_attention as string) || c.name,
      email: (r.billing_email as string) || c.emails?.[0] || null,
      phone: c.phones?.[0] ?? null,
      address: (r.billing_address as string) || null,
      city: (r.billing_city as string) || null,
      country: (r.billing_country as string) || null,
      gstin: (r.gstin as string) || null,
    });
  }

  return (
    <div>
      <p className="text-[11px] leading-relaxed text-text-muted">{spec.hint}</p>

      {spec.from && (
        <div className="mt-3 max-w-md">
          <span className="mb-0.5 block text-[11px] text-text-secondary">
            {spec.from === "partners" ? "From the partner book" : "From the customer directory"}
          </span>
          {spec.from === "partners" ? (
            <select
              value={party?.partner_id ?? ""}
              onChange={(e) => void pickPartner(e.target.value)}
              className="h-8 w-full"
            >
              <option value="">{choices.length ? "Choose, or type below" : "None in the partner book yet"}</option>
              {choices.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.organisation || p.name}
                  {p.organisation && p.name ? ` — ${p.name}` : ""}
                </option>
              ))}
            </select>
          ) : (
            <select
              value={party?.customer_id ?? ""}
              onChange={(e) => void pickCustomer(e.target.value)}
              className="h-8 w-full"
            >
              <option value="">Choose, or type below</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.company || c.name} ({c.id})
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="space-y-3">
          <Field label="Name" value={v("name")} count onCommit={set("name")} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Contact person" value={v("contact_person")} onCommit={set("contact_person")} />
            <Field label="Phone" value={v("phone")} onCommit={set("phone")} />
          </div>
          <Field label="Email" value={v("email")} onCommit={(x) => set("email")(x.trim())} />
        </div>
        <div className="space-y-3">
          <Field label="Address" value={v("address")} onCommit={set("address")} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="City" value={v("city")} onCommit={set("city")} />
            <Field label="Country" value={v("country")} onCommit={set("country")} />
          </div>
          {role === "billing_customer" && (
            <Field label="GSTIN" value={v("gstin")} mono onCommit={(x) => set("gstin")(x.toUpperCase())} />
          )}
          <Field label="Notes" value={v("notes")} onCommit={set("notes")} />
        </div>
      </div>

      {party && (
        <button
          type="button"
          onClick={() => void onClear()}
          className="mt-3 text-[11.5px] text-text-muted hover:text-text-danger"
        >
          Remove this party from the job
        </button>
      )}
    </div>
  );
}

export default function ShipmentParties() {
  const { shipment, enquiry, reload } = useShipment();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [extras, setExtras] = useState<ExtraParty[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);

  const loadExtras = useCallback(async () => {
    try {
      setExtras(await extraPartiesFor(shipment.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the parties.");
    }
  }, [shipment.id]);

  useEffect(() => {
    void loadExtras();
    void listPartners()
      .then(setPartners)
      .catch(() => setPartners([]));
    void listCustomers()
      .then(setCustomers)
      .catch(() => setCustomers([]));
  }, [loadExtras]);

  // Changed by anybody, read again (the page's subscription, 084).
  const live = useLiveVersion("shipment_parties");
  useEffect(() => {
    if (live) void loadExtras();
  }, [live, loadExtras]);

  const mode: Shipment["transport_mode"] = shipment.transport_mode ?? enquiry?.transport_mode ?? null;
  const row = shipment as unknown as Record<string, unknown>;
  const shipper = readParty(row, "shipper");
  const consignee = readParty(row, "consignee");
  const notify = readParty(row, "notify");

  function flash() {
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  }

  async function write(patch: Record<string, unknown>) {
    setError(null);
    try {
      await updateShipment(shipment.id, patch);
      await reload();
      flash();
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

  const saveExtra = (role: ExtraPartyRole) => async (patch: Partial<ExtraParty>) => {
    setError(null);
    try {
      await saveExtraParty(shipment.id, role, patch);
      await loadExtras();
      flash();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not save.");
    }
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
      shipper_email: shipment.customer?.emails?.[0] || null,
    });

  const byRole = (r: ExtraPartyRole) => extras.find((x) => x.role === r);

  /** A B/L party's section: the form, and a Notify button in its header. */
  const blSection = (role: PartyRole, title: string, party: Party, extra?: React.ReactNode) => {
    const email = (row[`${role}_email`] as string | null) ?? "";
    return (
      <Collapsible
        key={role}
        id={`shipment:party:${role}`}
        title={title}
        icon={<Users size={12} className="shrink-0 text-text-muted" />}
        badge={party.name || undefined}
        defaultOpen={role !== "notify" || Boolean(party.name)}
        action={
          <NotifyParty
            shipment={shipment}
            mode={mode}
            to={email || null}
            partyName={party.name || null}
            roleLabel={title}
          />
        }
      >
        <PartyCard
          role={role}
          party={party}
          email={email}
          onSet={setter(role)}
          onEmail={(v) => void write({ [`${role}_email`]: v || null })}
          extra={extra}
        />
      </Collapsible>
    );
  };

  const extraSection = (role: ExtraPartyRole) => {
    const party = byRole(role);
    return (
      <Collapsible
        key={role}
        id={`shipment:party:${role}`}
        title={EXTRA[role].label}
        icon={<Users size={12} className="shrink-0 text-text-muted" />}
        badge={party?.name || undefined}
        defaultOpen={Boolean(party?.name)}
        action={
          <NotifyParty
            shipment={shipment}
            mode={mode}
            to={party?.email || null}
            partyName={party?.contact_person || party?.name || null}
            roleLabel={EXTRA[role].label}
          />
        }
      >
        <ExtraPartyCard
          role={role}
          party={party}
          partners={partners}
          customers={customers}
          onSave={saveExtra(role)}
          onClear={async () => {
            await clearExtraParty(shipment.id, role);
            await loadExtras();
          }}
        />
      </Collapsible>
    );
  };

  return (
    <div>
      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-prose text-[12px] leading-relaxed text-text-secondary">
          Everyone on this job. Shipper, consignee and notify customer 1 are printed on the house
          bill; the rest are who the desk works with. Nothing here is required.
        </p>
        {saved && (
          <span className="inline-flex items-center gap-1 text-[11px] text-text-success">
            <Check size={11} /> Saved
          </span>
        )}
      </div>

      {blSection(
        "shipper",
        "Shipper",
        shipper,
        !shipper.name && shipment.customer && (
          <button
            onClick={copyFromCustomer}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
          >
            <ArrowDownToLine size={13} />
            Use {shipment.customer.company || shipment.customer.name}
          </button>
        )
      )}
      {blSection(
        "consignee",
        "Consignee",
        consignee,
        consignee.country === "India" && (
          <Field
            label="DPD code"
            value={consignee.dpd_code ?? ""}
            mono
            hint="Direct Port Delivery — a consignee cleared to take the box off the terminal rather than through a CFS"
            onCommit={(v) => void write({ consignee_dpd_code: v.toUpperCase() || null })}
          />
        )
      )}
      {extraSection("destination_agent")}
      {extraSection("origin_agent")}
      {extraSection("billing_customer")}
      {blSection("notify", "Notify customer 1", notify)}
      {extraSection("notify_2")}
      {extraSection("forwarder")}
      {extraSection("customs_house_agent")}

      <p className="mt-4 max-w-prose text-[11px] leading-relaxed text-text-muted">
        The shipper box can be filled from the customer's record, and the state, PAN and country
        codes are read off the GSTIN and the country rather than asked for twice. Everything remains
        editable: what goes on a bill is what the desk says goes on it.
      </p>
    </div>
  );
}
