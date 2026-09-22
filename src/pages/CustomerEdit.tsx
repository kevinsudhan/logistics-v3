import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AlertCircle, ChevronLeft, Loader2 } from "lucide-react";
import PageHeader from "../components/PageHeader";
import { failureText, type FailureText } from "../lib/errorText";
import {
  createCustomer,
  customerLabel,
  getCustomer,
  listCustomers,
  tagsOf,
  updateCustomer,
  CustomerExistsError,
  type Customer,
} from "../services/customers";

/**
 * Adding a customer, or correcting one, on a page of its own.
 *
 * ---------------------------------------------------------------------------
 * WHY A PAGE AND NOT A DIALOG
 *
 * The same reason the partner form moved: it has a URL. Somebody typing a
 * customer's GSTIN and billing address off a document gets interrupted, and a
 * dialog cannot be linked to, refreshed, or handed to a colleague.
 *
 * WHY THE STATUTORY FIELDS ARE HERE AND NOT ONLY ON THE INVOICE
 *
 * Because they are found out long before they are needed. The GSTIN arrives on
 * the customer's letterhead with the first enquiry; it is wanted a month later
 * when the invoice is raised, by which point whoever read it has forgotten. A
 * field that can only be filled at the moment it is required is a field that is
 * filled in a hurry, from memory, by the wrong person.
 *
 * WHY GSTIN IS NOT VALIDATED BEYOND ITS SHAPE
 *
 * A checksum would reject valid numbers this desk has not seen and accept
 * invented ones with the right arithmetic. The length and the state prefix are
 * worth flagging because they catch a transposed digit; anything stricter is a
 * guess about somebody else's tax registration, and refusing to save a real
 * customer's real number is worse than storing one that turns out wrong.
 * ---------------------------------------------------------------------------
 */
export default function CustomerEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const editing = Boolean(id);

  const [form, setForm] = useState<Partial<Customer>>({
    name: "",
    company: "",
    emails: [],
    phones: [],
    tags: [],
    notes: "",
  });
  const [knownTags, setKnownTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<FailureText | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  /**
   * The customer that already uses the address just typed.
   *
   * Held separately from `error` because the answer is not "try again" but
   * "you probably meant this one" — and the useful thing to offer is a link to
   * them, not a red box.
   */
  const [clash, setClash] = useState<Customer | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [existing, all] = await Promise.all([
        id ? getCustomer(id) : Promise.resolve(null),
        listCustomers().catch(() => []),
      ]);
      setKnownTags(tagsOf(all));
      if (id) {
        if (!existing) setMissing(id);
        else setForm(existing);
      }
    } catch (e) {
      setError(failureText(e, "Could not open this customer."));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const set = <K extends keyof Customer>(key: K, value: Customer[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const name = (form.name ?? "").trim();
    const company = (form.company ?? "").trim();
    // One of the two, not both: a sole trader has a name and no company, an
    // agent's booking desk has a company and no named contact.
    if (!name && !company) {
      setError({ message: "Give at least a contact name or a company.", hint: null });
      return;
    }

    setSaving(true);
    setClash(null);
    try {
      const patch: Partial<Customer> = {
        name: name || company,
        company,
        emails: clean(form.emails),
        phones: clean(form.phones),
        tags: clean(form.tags),
        notes: (form.notes ?? "").trim(),
        gstin: blankToNull(form.gstin),
        pan: blankToNull(form.pan),
        iec: blankToNull(form.iec),
        billing_name: blankToNull(form.billing_name),
        billing_attention: blankToNull(form.billing_attention),
        billing_address: blankToNull(form.billing_address),
        billing_city: blankToNull(form.billing_city),
        billing_state: blankToNull(form.billing_state),
        billing_state_code: blankToNull(form.billing_state_code),
        billing_pincode: blankToNull(form.billing_pincode),
        billing_country: blankToNull(form.billing_country),
        billing_email: blankToNull(form.billing_email),
        payment_terms_days: form.payment_terms_days ?? null,
      };

      if (editing && id) {
        await updateCustomer(id, patch);
        navigate(`/customers/${id}`);
      } else {
        /*
          The first email goes through the RPC rather than the patch, because
          that is what it dedupes on: enquiring from an address we already know
          returns the EXISTING customer instead of making a second record with
          half the history.
        */
        const made = await createCustomer({
          name: patch.name!,
          company,
          email: patch.emails?.[0],
          phone: patch.phones?.[0],
          rest: patch,
        });
        navigate(`/customers/${made.id}`);
      }
    } catch (e) {
      // Not a failure to report as one: the address belongs to somebody, and
      // what the operator wants is to go and look at them.
      if (e instanceof CustomerExistsError) setClash(e.existing);
      else setError(failureText(e, "Could not save this customer."));
      setSaving(false);
    }
  }

  if (loading) return <p className="py-8 text-[13px] text-text-muted">Loading…</p>;

  if (missing)
    return (
      <div className="py-8">
        <Link to="/customers" className="text-[13px] text-text-secondary hover:text-text-primary">
          <ChevronLeft size={13} className="inline" /> Customers
        </Link>
        <p className="mt-3 text-[14px] text-text-primary">No customer with the id {missing}.</p>
      </div>
    );

  return (
    <div className="max-w-3xl">
      <Link
        to={editing ? `/customers/${id}` : "/customers"}
        className="mb-3 inline-flex items-center gap-1 text-[12px] text-text-secondary hover:text-text-primary"
      >
        <ChevronLeft size={13} /> {editing ? customerLabel(form as Customer) : "Customers"}
      </Link>

      <PageHeader
        title={editing ? "Edit customer" : "Add customer"}
        subtitle={
          editing
            ? "Corrections here apply to the record, not to documents already issued."
            : "Only a name is required. The statutory fields can be filled in when the paperwork arrives."
        }
      />

      {clash && (
        <div className="mb-3 rounded-lg bg-bg-warning px-3 py-2.5 text-[12px] text-text-warning">
          <p>
            <strong>{customerLabel(clash)}</strong> ({clash.id}) already uses that email address.
            Nothing has been saved.
          </p>
          <p className="mt-1 opacity-90">
            Open their file to add what you have, or use a different address here if this really is
            a separate company.
          </p>
          <Link
            to={`/customers/${clash.id}`}
            className="mt-2 inline-flex h-7 items-center rounded-lg border border-current px-2.5 font-medium"
          >
            Open {clash.id}
          </Link>
        </div>
      )}

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          <span>
            {error.message}
            {error.hint && <span className="mt-1 block opacity-80">{error.hint}</span>}
          </span>
        </div>
      )}

      <form onSubmit={save} className="space-y-4" noValidate>
        <section className="card p-5">
          <h2 className="mb-3 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
            Who they are
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Company">
              <input
                value={form.company ?? ""}
                onChange={(e) => set("company", e.target.value)}
                placeholder="Aarathy Exports Pvt Ltd"
              />
            </Field>
            <Field label="Contact name">
              <input
                value={form.name ?? ""}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Who you actually speak to"
              />
            </Field>
            <Field label="Email" hint="Correspondence is gathered by address — one per line.">
              <textarea
                rows={2}
                value={(form.emails ?? []).join("\n")}
                onChange={(e) => set("emails", e.target.value.split("\n"))}
                placeholder="exports@aarathy.in"
              />
            </Field>
            <Field label="Phone" hint="One per line.">
              <textarea
                rows={2}
                value={(form.phones ?? []).join("\n")}
                onChange={(e) => set("phones", e.target.value.split("\n"))}
                placeholder="+91 44 4000 0000"
              />
            </Field>
          </div>
        </section>

        <section className="card p-5">
          <h2 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
            Statutory
          </h2>
          <p className="mb-3 text-[11.5px] text-text-muted">
            What a tax invoice needs. Filling it now beats discovering it is missing on the day the
            invoice is raised, with the cargo already gone.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field
              label="GSTIN"
              hint={gstinHint(form.gstin)}
            >
              <input
                value={form.gstin ?? ""}
                onChange={(e) => set("gstin", e.target.value.toUpperCase())}
                placeholder="33AABCA1234A1Z5"
              />
            </Field>
            <Field label="PAN">
              <input
                value={form.pan ?? ""}
                onChange={(e) => set("pan", e.target.value.toUpperCase())}
                placeholder="AABCA1234A"
              />
            </Field>
            <Field label="IEC" hint="Needed on an export.">
              <input
                value={form.iec ?? ""}
                onChange={(e) => set("iec", e.target.value.toUpperCase())}
                placeholder="0123456789"
              />
            </Field>
          </div>
        </section>

        <section className="card p-5">
          <h2 className="mb-3 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
            Billing address
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Bill to" hint="If it differs from the company name.">
              <input
                value={form.billing_name ?? ""}
                onChange={(e) => set("billing_name", e.target.value)}
              />
            </Field>
            <Field label="Attention">
              <input
                value={form.billing_attention ?? ""}
                onChange={(e) => set("billing_attention", e.target.value)}
                placeholder="Accounts payable"
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Address">
                <textarea
                  rows={2}
                  value={form.billing_address ?? ""}
                  onChange={(e) => set("billing_address", e.target.value)}
                />
              </Field>
            </div>
            <Field label="City">
              <input
                value={form.billing_city ?? ""}
                onChange={(e) => set("billing_city", e.target.value)}
              />
            </Field>
            <Field label="State">
              <input
                value={form.billing_state ?? ""}
                onChange={(e) => set("billing_state", e.target.value)}
              />
            </Field>
            <Field label="PIN code">
              <input
                value={form.billing_pincode ?? ""}
                onChange={(e) => set("billing_pincode", e.target.value)}
              />
            </Field>
            <Field label="Country">
              <input
                value={form.billing_country ?? ""}
                onChange={(e) => set("billing_country", e.target.value)}
                placeholder="India"
              />
            </Field>
            <Field label="Billing email" hint="Where the invoice is sent, if not the contact.">
              <input
                value={form.billing_email ?? ""}
                onChange={(e) => set("billing_email", e.target.value)}
              />
            </Field>
            <Field label="Payment terms" hint="Days from the invoice date.">
              <input
                type="number"
                min={0}
                value={form.payment_terms_days ?? ""}
                onChange={(e) =>
                  set("payment_terms_days", e.target.value === "" ? null : Number(e.target.value))
                }
                placeholder="30"
              />
            </Field>
          </div>
        </section>

        <section className="card p-5">
          <h2 className="mb-3 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
            For the desk
          </h2>
          <Field label="Tags" hint="Comma separated. Used to group and filter the directory.">
            <input
              value={(form.tags ?? []).join(", ")}
              onChange={(e) => set("tags", e.target.value.split(","))}
              placeholder="garments, monthly volume, DG"
              list="known-customer-tags"
            />
            <datalist id="known-customer-tags">
              {knownTags.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </Field>
          <div className="mt-3">
            <Field
              label="Notes"
              hint="What somebody needs to know before dealing with them. Pays late, wants rates in USD, always ships DG."
            >
              <textarea
                rows={3}
                value={form.notes ?? ""}
                onChange={(e) => set("notes", e.target.value)}
              />
            </Field>
          </div>
        </section>

        <div className="flex items-center gap-2 pb-8">
          <button
            type="submit"
            disabled={saving}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-brand px-4 text-[13px] font-medium text-white hover:bg-brand-dark disabled:opacity-60"
          >
            {saving && <Loader2 size={13} className="animate-spin" />}
            {editing ? "Save changes" : "Add customer"}
          </button>
          <Link
            to={editing ? `/customers/${id}` : "/customers"}
            className="flex h-9 items-center rounded-lg border border-border px-4 text-[13px] text-text-secondary hover:text-text-primary"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string | null;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11.5px] text-text-secondary">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-text-muted">{hint}</span>}
    </label>
  );
}

/**
 * Shape only, and only once something has been typed.
 *
 * Fifteen characters, the first two being the state code. Enough to catch a
 * transposed digit and not enough to reject a real registration this desk has
 * not seen before.
 */
function gstinHint(gstin: string | null | undefined): string | null {
  const v = (gstin ?? "").trim();
  if (!v) return "15 characters. The first two are the state code.";
  if (v.length !== 15) return `${v.length} characters — a GSTIN has 15.`;
  if (!/^\d{2}/.test(v)) return "The first two characters should be the numeric state code.";
  return null;
}

const clean = (list: string[] | undefined): string[] => {
  const seen = new Map<string, string>();
  for (const raw of list ?? []) {
    const v = raw.trim();
    if (v && !seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v);
  }
  return [...seen.values()];
};

const blankToNull = (v: string | null | undefined): string | null => {
  const s = (v ?? "").trim();
  return s === "" ? null : s;
};
