import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, Building2, Check, Loader2, Search, TriangleAlert, X } from "lucide-react";
import Collapsible from "./Collapsible";
import { useAuth } from "../lib/auth";
import { failureText } from "../lib/errorText";
import {
  assignEnquiry,
  listPeople,
  updateEnquiry,
  type Customer,
  type Enquiry,
  type Person,
} from "../services/enquiries";
import {
  customerLabel,
  listCustomers,
  looksAutoCreated,
  reassignEnquiryCustomer,
  updateCustomer,
  type CustomerSummary,
} from "../services/customers";

/**
 * Who the job is for, who owns it, and when it arrived.
 *
 * ---------------------------------------------------------------------------
 * WHY EDITING HERE EDITS THE DIRECTORY
 *
 * The customer on an enquiry is not a copy: it is the directory record. So
 * correcting "info" to "Prapti Logistics" here corrects it everywhere — on
 * every other enquiry for them, in the directory, on the next invoice. That is
 * what somebody means when they fix a name, and a copy that diverged from the
 * directory would be two answers to "who is this customer".
 *
 * WHY THERE ARE TWO WAYS TO FIX A WRONG CUSTOMER
 *
 * Editing is right when the record is new and just badly named. Choosing from
 * the directory is right when the customer already exists — a regular client
 * writing from an address nobody had seen, which the intake turned into a
 * stranger. Editing the stranger into "Prapti Logistics" in that case would
 * make a second Prapti, and their history would split in two. So the panel
 * watches for exactly that: type a name the directory already has and it
 * offers the existing record instead.
 * ---------------------------------------------------------------------------
 */
export default function CustomerDetailsPanel({
  enquiry,
  customer,
  onSaved,
}: {
  enquiry: Enquiry;
  customer: Customer | null;
  onSaved: () => void;
}) {
  const { session } = useAuth();
  const [people, setPeople] = useState<Person[]>([]);
  const [directory, setDirectory] = useState<CustomerSummary[]>([]);
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void listPeople().then(setPeople).catch(() => setPeople([]));
    void listCustomers().then(setDirectory).catch(() => setDirectory([]));
  }, []);

  /*
    Whether the signed-in person may hand this enquiry to somebody else.

    The server decides — `assign_enquiry` refuses otherwise — but a dropdown
    that looks editable and then refuses is a dropdown people fight with. It is
    shown read-only instead, with the owner's name.
  */
  const me = people.find((p) => p.id === session?.userId);
  const mayAssign = session?.role === "admin" || Boolean(me?.can_assign);
  const salesman = people.find((p) => p.id === enquiry.assigned_to);

  const run = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (done) setNotice(done);
      onSaved();
    } catch (e) {
      setError(failureText(e, "That did not save.").message);
    } finally {
      setBusy(null);
    }
  };

  async function choose(c: CustomerSummary) {
    setPicking(false);
    await run(
      "choose",
      async () => {
        const r = await reassignEnquiryCustomer(enquiry.ref, c.id);
        // Said plainly, because the two outcomes do different things to the
        // directory and somebody reading the directory later should not be
        // surprised by either.
        setNotice(
          !r.changed
            ? `${customerLabel(c)} was already the customer.`
            : r.merged
              ? `Now ${customerLabel(c)}. The record this came in as was a duplicate with no other work, so its email and phone moved to ${customerLabel(c)} and it was archived — their next mail files here on its own.`
              : `Now ${customerLabel(c)}. The previous customer has other enquiries of their own, so their record was left as it is.`
        );
      }
    );
  }

  const receivedDate = (enquiry.received_at ?? "").slice(0, 10);

  return (
    <Collapsible
      id="case:customer"
      title="Customer details"
      icon={<Building2 size={12} className="shrink-0 text-text-muted" />}
      badge={customer ? customerLabel(customer) : "no customer"}
    >
      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}
      {notice && (
        <p className="mb-3 flex items-start gap-2 rounded-lg bg-bg-success px-3 py-2.5 text-[12px] text-text-success">
          <Check size={13} className="mt-px shrink-0" />
          {notice}
        </p>
      )}

      {customer && looksAutoCreated(customer) && (
        // The case this panel mostly exists for.
        <p className="mb-3 flex items-start gap-2 rounded-lg bg-bg-warning px-3 py-2.5 text-[12px] text-text-warning">
          <TriangleAlert size={13} className="mt-px shrink-0" />
          <span>
            This customer was made from the sender&rsquo;s address, so its name is
            &ldquo;{customer.name}&rdquo;. If they are already in the directory, choose them —
            otherwise edit the name.
          </span>
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
        {/* ---- the customer ---- */}
        <div>
          <p className="mb-1 text-[11.5px] text-text-secondary">Customer name</p>
          <div className="relative">
            <button
              type="button"
              onClick={() => setPicking((p) => !p)}
              disabled={busy !== null}
              className="flex h-9 w-full items-center gap-2 rounded-lg border border-border bg-surface-1 px-3 text-left text-[13px] text-text-primary hover:border-border-strong disabled:opacity-60"
            >
              <span className="min-w-0 flex-1 truncate">
                {customer ? customerLabel(customer) : "Choose a customer"}
              </span>
              {busy === "choose" ? (
                <Loader2 size={13} className="animate-spin text-text-muted" />
              ) : (
                <Search size={13} className="text-text-muted" />
              )}
            </button>
            {picking && (
              <Picker
                directory={directory}
                currentId={customer?.id ?? null}
                onChoose={(c) => void choose(c)}
                onClose={() => setPicking(false)}
              />
            )}
          </div>
          {customer && (
            <p className="mt-1 text-[11px] text-text-muted">
              <Link to={`/customers/${customer.id}`} className="hover:underline">
                {customer.id} in the directory
              </Link>
            </p>
          )}
        </div>

        {/* ---- the salesman ---- */}
        <label className="block">
          <span className="mb-1 block text-[11.5px] text-text-secondary">Salesman</span>
          {mayAssign ? (
            <select
              value={enquiry.assigned_to ?? ""}
              disabled={busy !== null}
              onChange={(e) =>
                void run("assign", () => assignEnquiry(enquiry.ref, e.target.value || null))
              }
              className="h-9 w-full"
            >
              <option value="">Nobody yet</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name || p.email}
                </option>
              ))}
            </select>
          ) : (
            <span className="flex h-9 items-center text-[13px] text-text-primary">
              {salesman ? salesman.full_name || salesman.email : "Nobody yet"}
            </span>
          )}
        </label>

        {/* ---- when it arrived ---- */}
        <label className="block">
          <span className="mb-1 block text-[11.5px] text-text-secondary">Enquiry received</span>
          <input
            type="date"
            value={receivedDate}
            disabled={busy !== null}
            onChange={(e) => {
              if (!e.target.value) return;
              // The date changes, the time of day it arrived does not: the
              // time is what orders the inbound board.
              const time = (enquiry.received_at ?? "").slice(10) || "T09:00:00.000Z";
              void run("received", () =>
                updateEnquiry(enquiry.ref, { received_at: `${e.target.value}${time}` } as Partial<Enquiry>)
              );
            }}
            className="h-9 w-full"
          />
        </label>
      </div>

      {/* ---- the record itself ---- */}
      {customer && (
        <div className="mt-4 border-t border-border pt-4">
          {!editing ? (
            <div className="flex flex-wrap items-start justify-between gap-3">
              <dl className="grid flex-1 gap-x-8 gap-y-2 text-[12.5px] sm:grid-cols-3">
                <Fact label="Contact" value={customer.name} />
                <Fact label="Email" value={customer.emails.join(", ")} />
                <Fact label="Phone" value={customer.phones.join(", ")} />
              </dl>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="h-8 shrink-0 rounded-lg border border-border px-3 text-[12px] text-text-secondary hover:border-border-strong hover:text-text-primary"
              >
                Edit details
              </button>
            </div>
          ) : (
            <EditCustomer
              customer={customer}
              directory={directory}
              busy={busy}
              onCancel={() => setEditing(false)}
              onUseExisting={(c) => {
                setEditing(false);
                void choose(c);
              }}
              onSave={(patch) =>
                void run(
                  "edit",
                  async () => {
                    await updateCustomer(customer.id, patch);
                    setEditing(false);
                  },
                  "Saved to the customer directory — every enquiry for this customer now shows it."
                )
              }
            />
          )}
        </div>
      )}
    </Collapsible>
  );
}

/** Searchable list of the directory. */
function Picker({
  directory,
  currentId,
  onChoose,
  onClose,
}: {
  directory: CustomerSummary[];
  currentId: string | null;
  onChoose: (c: CustomerSummary) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return directory
      .filter((c) => c.active)
      .filter((c) =>
        !needle
          ? true
          : [c.id, c.name, c.company, ...c.emails, ...c.phones]
              .filter(Boolean)
              .some((v) => String(v).toLowerCase().includes(needle))
      )
      // Regular customers first: the ones with work behind them are the ones
      // somebody is most likely looking for.
      .sort((a, b) => b.shipments + b.enquiries - (a.shipments + a.enquiries))
      .slice(0, 30);
  }, [directory, q]);

  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div className="absolute left-0 right-0 z-20 mt-1 rounded-xl border border-border-strong bg-surface-1 p-2 shadow-lg">
        <div className="relative mb-1.5">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Company, contact, email or phone"
            className="h-8 w-full pl-8"
          />
        </div>
        <ul className="max-h-72 overflow-y-auto">
          {matches.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onChoose(c)}
                className={`flex w-full items-baseline justify-between gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-surface-2 ${
                  c.id === currentId ? "bg-surface-2" : ""
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] text-text-primary">
                    {customerLabel(c)}
                    {c.id === currentId && (
                      <span className="ml-1.5 text-[11px] text-text-muted">current</span>
                    )}
                  </span>
                  <span className="block truncate text-[11px] text-text-muted">
                    {[c.company && c.name !== c.company ? c.name : null, c.emails[0]]
                      .filter(Boolean)
                      .join(" · ") || "No contact recorded"}
                  </span>
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-text-muted">
                  {c.id}
                  {c.shipments > 0 ? ` · ${c.shipments} shipped` : ""}
                </span>
              </button>
            </li>
          ))}
          {!matches.length && (
            <li className="px-2.5 py-3 text-[12px] text-text-muted">
              Nobody in the directory matches. Edit this customer&rsquo;s details instead, or{" "}
              <Link to="/customers/new" className="text-text-accent hover:underline">
                add them to the directory
              </Link>
              .
            </li>
          )}
        </ul>
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 rounded p-0.5 text-text-muted hover:text-text-primary"
          aria-label="Close"
        >
          <X size={13} />
        </button>
      </div>
    </>
  );
}

/**
 * Editing the record, with a watch for the duplicate it is about to create.
 */
function EditCustomer({
  customer,
  directory,
  busy,
  onCancel,
  onSave,
  onUseExisting,
}: {
  customer: Customer;
  directory: CustomerSummary[];
  busy: string | null;
  onCancel: () => void;
  onSave: (patch: { company: string; name: string; emails: string[]; phones: string[] }) => void;
  onUseExisting: (c: CustomerSummary) => void;
}) {
  const [company, setCompany] = useState(customer.company ?? "");
  const [name, setName] = useState(customer.name ?? "");
  const [email, setEmail] = useState(customer.emails.join(", "));
  const [phone, setPhone] = useState(customer.phones.join(", "));

  /*
    The duplicate about to be made.

    Typing "Prapti Logistics" onto a stray record when Prapti is already in the
    directory creates a second Prapti, and the history splits. Matched on the
    company name or any of the typed addresses, and offered as the better
    choice rather than blocked — the desk may know it is a different Prapti.
  */
  const clash = useMemo(() => {
    const co = company.trim().toLowerCase();
    const addresses = split(email).map((e) => e.toLowerCase());
    return directory.find(
      (c) =>
        c.id !== customer.id &&
        c.active &&
        ((co && (c.company.trim().toLowerCase() === co || c.name.trim().toLowerCase() === co)) ||
          c.emails.some((e) => addresses.includes(e.toLowerCase())))
    );
  }, [company, email, directory, customer.id]);

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[11.5px] text-text-secondary">Company</span>
          <input value={company} onChange={(e) => setCompany(e.target.value)} className="h-9 w-full" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11.5px] text-text-secondary">Contact name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="h-9 w-full" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11.5px] text-text-secondary">Email</span>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Comma-separated for more than one"
            className="h-9 w-full"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11.5px] text-text-secondary">Phone</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className="h-9 w-full" />
        </label>
      </div>

      {clash && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-bg-warning px-3 py-2.5 text-[12px] text-text-warning">
          <span>
            <strong>{customerLabel(clash)}</strong> ({clash.id}) is already in the directory
            {clash.shipments ? ` with ${clash.shipments} shipment${clash.shipments > 1 ? "s" : ""}` : ""}.
            Saving would make a second one.
          </span>
          <button
            type="button"
            onClick={() => onUseExisting(clash)}
            className="h-7 shrink-0 rounded-lg border border-current px-2.5 font-medium"
          >
            Use {clash.id} instead
          </button>
        </div>
      )}

      <p className="mt-3 text-[11.5px] text-text-muted">
        Saves to the customer directory, so every enquiry for this customer shows the change.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={busy !== null || (!company.trim() && !name.trim())}
          onClick={() =>
            onSave({
              company: company.trim(),
              name: name.trim() || company.trim(),
              emails: split(email),
              phones: split(phone),
            })
          }
          className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-medium text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {busy === "edit" && <Loader2 size={13} className="animate-spin" />}
          Save to directory
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-8 rounded-lg border border-border px-3 text-[12px] text-text-secondary hover:text-text-primary"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10.5px] uppercase tracking-wide text-text-muted">{label}</dt>
      <dd className={`truncate ${value ? "text-text-primary" : "text-text-muted"}`}>
        {value || "—"}
      </dd>
    </div>
  );
}

/** Comma or newline separated, trimmed, de-duplicated. */
function split(v: string): string[] {
  const seen = new Map<string, string>();
  for (const raw of v.split(/[,\n]/)) {
    const t = raw.trim();
    if (t && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  }
  return [...seen.values()];
}
