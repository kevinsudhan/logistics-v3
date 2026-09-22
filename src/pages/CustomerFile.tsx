import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  Archive,
  Building2,
  ChevronLeft,
  Mail as MailIcon,
  Pencil,
  Phone,
  RotateCcw,
  Search,
  TriangleAlert,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { ACCOUNTS_DESK } from "../lib/features";
import ThreadReader from "../components/ThreadReader";
import StatusPill from "../components/StatusPill";
import { failureText, type FailureText } from "../lib/errorText";
import { mailIsLive, type MailMessage } from "../services/backend";
import { participantsQuery, searchMailbox } from "../services/graphMail";
import { refsFor, type ThreadRef } from "../services/threadRefs";
import {
  archiveCustomer,
  customerLabel,
  daysSinceActivity,
  enquiriesFor,
  getCustomer,
  getSummary,
  restoreCustomer,
  shipmentsFor,
  DORMANT_AFTER_DAYS,
  type Customer,
  type CustomerSummary,
} from "../services/customers";
import {
  SHIPMENT_STAGE_LABEL,
  STATUS_LABEL,
  type Enquiry,
  type Shipment,
  type ShipmentStage,
} from "../services/enquiries";

/**
 * Everything this desk has done for one customer.
 *
 * ---------------------------------------------------------------------------
 * WHY SHIPMENTS AND ENQUIRIES ARE SEPARATE SECTIONS
 *
 * They answer different questions and mixing them answers neither. Shipments
 * are what we carried — the history somebody consults before quoting a lane
 * again, or when the customer rings about something from March. Enquiries are
 * what they ASKED for, and the useful part of that list is the entries with no
 * shipment against them: a customer with fourteen enquiries and two bookings is
 * telling you the rates are wrong, or that they are benchmarking somebody else.
 *
 * Neither fact is visible from the other list.
 *
 * WHY THE SHIPMENT FILTERS ARE DATE, LANE AND STAGE
 *
 * Because those are how people remember a shipment they cannot name. Nobody
 * looking for an old job remembers ARX-SHP-0042; they remember roughly when it
 * went, roughly where to, and that it was the one that got stuck. Filtering on
 * those three finds it, and searching on the cargo description finds the rest.
 * ---------------------------------------------------------------------------
 */

/**
 * How a stage reads as a pill.
 *
 * Delivered is done, cancelled is a failure worth seeing at a glance, and
 * everything between is work in progress. Matching what the shipments boards
 * already do, so the same stage is not two colours on two screens.
 */
const STAGE_TONE: Record<ShipmentStage, "success" | "danger" | "accent"> = {
  booked: "accent",
  cargo_received: "accent",
  stuffed: "accent",
  gated_in: "accent",
  sailed: "accent",
  arrived: "accent",
  delivered: "success",
  cancelled: "danger",
};

/** The same, for where an enquiry got to. */
const ENQUIRY_TONE: Record<string, "success" | "danger" | "warning" | "accent" | "neutral"> = {
  new: "neutral",
  qualifying: "accent",
  quoted: "warning",
  accepted: "success",
  declined: "danger",
  lost: "danger",
};

const SECTIONS = [
  { key: "shipments", label: "Shipments" },
  { key: "enquiries", label: "Enquiries" },
  { key: "mail", label: "Correspondence" },
  { key: "details", label: "Details" },
] as const;

type Section = (typeof SECTIONS)[number]["key"];

export default function CustomerFile() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const { session } = useAuth();
  const mailbox = session?.email ?? "";

  const section = (SECTIONS.find((s) => s.key === params.get("section"))?.key ??
    "shipments") as Section;
  const goTo = (s: Section) =>
    setParams(
      (p) => {
        p.set("section", s);
        return p;
      },
      { replace: true }
    );

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [summary, setSummary] = useState<CustomerSummary | null>(null);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [c, s, sh, en] = await Promise.all([
        getCustomer(id),
        getSummary(id),
        shipmentsFor(id),
        enquiriesFor(id),
      ]);
      setCustomer(c);
      setSummary(s);
      setShipments(sh);
      setEnquiries(en);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this customer.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleArchive() {
    if (!customer) return;
    setError(null);
    try {
      customer.active ? await archiveCustomer(customer.id) : await restoreCustomer(customer.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change that.");
    }
  }

  if (loading && !customer) return <p className="py-8 text-[13px] text-text-muted">Loading…</p>;

  if (!customer)
    return (
      <div className="py-8">
        <Link to="/customers" className="text-[13px] text-text-secondary hover:text-text-primary">
          <ChevronLeft size={13} className="inline" /> Customers
        </Link>
        <p className="mt-3 text-[14px] text-text-primary">No customer with the id {id}.</p>
      </div>
    );

  const days = summary ? daysSinceActivity(summary) : null;

  return (
    <div>
      <Link
        to="/customers"
        className="mb-3 inline-flex items-center gap-1 text-[12px] text-text-secondary hover:text-text-primary"
      >
        <ChevronLeft size={13} /> Customers
      </Link>

      <header className="card mb-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2 text-[18px] font-semibold text-text-primary">
              <Building2 size={16} className="text-text-muted" />
              {customerLabel(customer)}
              <span className="text-[13px] font-normal tabular-nums text-text-muted">
                {customer.id}
              </span>
              {!customer.active && (
                <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] font-normal text-text-muted">
                  Archived
                </span>
              )}
            </h1>

            <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-text-secondary">
              {customer.company && customer.name !== customer.company && (
                <span>{customer.name}</span>
              )}
              {customer.emails.map((e) => (
                <span key={e} className="inline-flex items-center gap-1">
                  <MailIcon size={11} className="opacity-70" />
                  {e}
                </span>
              ))}
              {customer.phones.map((p) => (
                <span key={p} className="inline-flex items-center gap-1">
                  <Phone size={11} className="opacity-70" />
                  {p}
                </span>
              ))}
            </p>

            {customer.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {customer.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-text-secondary"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Link
              to={`/customers/${customer.id}/edit`}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary hover:border-border-strong hover:text-text-primary"
            >
              <Pencil size={13} /> Edit
            </Link>
            <button
              type="button"
              onClick={() => void toggleArchive()}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary hover:border-border-strong hover:text-text-primary"
            >
              {customer.active ? (
                <>
                  <Archive size={13} /> Archive
                </>
              ) : (
                <>
                  <RotateCcw size={13} /> Restore
                </>
              )}
            </button>
          </div>
        </div>

        {summary && (
          <div className="mt-4 flex flex-wrap gap-x-8 gap-y-3 border-t border-border pt-4">
            <Figure label="Shipments" value={summary.shipments} sub={`${summary.shipments_live} live`} />
            <Figure
              label="Enquiries"
              value={summary.enquiries}
              // The conversion, spelled out. A ratio nobody has to compute is a
              // ratio people actually use.
              sub={
                summary.enquiries
                  ? `${summary.enquiries_won} won · ${summary.enquiries_lost} lost`
                  : undefined
              }
            />
            {ACCOUNTS_DESK && (
              <>
                <Figure label="Lifetime value" value={inr(summary.lifetime_inr)} />
                <Figure
                  label="Outstanding"
                  value={inr(summary.outstanding)}
                  warn={summary.outstanding > 0}
                  sub={summary.open_invoices ? `${summary.open_invoices} open` : undefined}
                />
              </>
            )}
            <Figure
              label="Last activity"
              value={days === null ? "—" : days === 0 ? "Today" : `${days}d ago`}
              warn={days !== null && days > DORMANT_AFTER_DAYS}
            />
            {(summary.top_origin || summary.top_destination) && (
              <Figure
                label="Usual lane"
                value={[summary.top_origin, summary.top_destination].filter(Boolean).join(" → ")}
              />
            )}
          </div>
        )}

        {summary && (summary.gstin_missing || summary.iec_missing) && summary.shipments > 0 && (
          <p className="mt-3 flex items-start gap-2 rounded-lg bg-bg-warning px-3 py-2 text-[12px] text-text-warning">
            <TriangleAlert size={13} className="mt-px shrink-0" />
            <span>
              {[summary.gstin_missing && "GSTIN", summary.iec_missing && "IEC"]
                .filter(Boolean)
                .join(" and ")}{" "}
              is missing, and this customer has shipped {summary.shipments} time
              {summary.shipments > 1 ? "s" : ""}. A tax invoice cannot be raised without it.
            </span>
          </p>
        )}
      </header>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      <nav className="mb-4 flex flex-wrap gap-1.5">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => goTo(s.key)}
            className={`h-8 rounded-lg px-3 text-[12px] transition-colors ${
              section === s.key
                ? "bg-surface-3 font-medium text-text-primary"
                : "text-text-secondary hover:bg-surface-2 hover:text-text-primary"
            }`}
          >
            {s.label}
            {s.key === "shipments" && shipments.length > 0 && (
              <span className="ml-1.5 opacity-60">{shipments.length}</span>
            )}
            {s.key === "enquiries" && enquiries.length > 0 && (
              <span className="ml-1.5 opacity-60">{enquiries.length}</span>
            )}
          </button>
        ))}
      </nav>

      {section === "shipments" && <ShipmentHistory shipments={shipments} />}
      {section === "enquiries" && <EnquiryHistory enquiries={enquiries} shipments={shipments} />}
      {section === "mail" && <CustomerMail customer={customer} mailbox={mailbox} />}
      {section === "details" && <Details customer={customer} />}
    </div>
  );
}

/**
 * The shipment history, filtered the way people remember shipments.
 *
 * Client-side, because everything is already loaded: a customer with two
 * hundred shipments is an unusually good customer, and two hundred rows is not
 * a quantity worth a round trip per keystroke.
 */
function ShipmentHistory({ shipments }: { shipments: Shipment[] }) {
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState<ShipmentStage | "all">("all");
  const [year, setYear] = useState<string>("all");

  const years = useMemo(() => {
    const seen = new Set<string>();
    for (const s of shipments) {
      const d = s.sailing_date ?? s.created_at;
      if (d) seen.add(d.slice(0, 4));
    }
    return [...seen].sort().reverse();
  }, [shipments]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return shipments
      .filter((s) => stage === "all" || s.stage === stage)
      .filter((s) => {
        if (year === "all") return true;
        const d = s.sailing_date ?? s.created_at;
        return !!d && d.slice(0, 4) === year;
      })
      .filter((s) =>
        !needle
          ? true
          : [
              s.id,
              s.enquiry_ref,
              s.origin,
              s.destination,
              s.cargo,
              s.bl_number,
              s.container_number,
              s.booking_number,
              s.carrier,
              s.vessel,
            ]
              .filter(Boolean)
              .some((v) => String(v).toLowerCase().includes(needle))
      );
  }, [shipments, query, stage, year]);

  if (!shipments.length)
    return (
      <Empty
        title="No shipments yet"
        body="Shipments appear here once an enquiry has been accepted and promoted to a booking."
      />
    );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] max-w-sm flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Lane, cargo, B/L, container, vessel…"
            className="h-8 w-full pl-8"
          />
        </div>

        <select value={stage} onChange={(e) => setStage(e.target.value as ShipmentStage | "all")} className="h-8">
          <option value="all">Any stage</option>
          {(Object.keys(SHIPMENT_STAGE_LABEL) as ShipmentStage[]).map((s) => (
            <option key={s} value={s}>
              {SHIPMENT_STAGE_LABEL[s]}
            </option>
          ))}
        </select>

        <select value={year} onChange={(e) => setYear(e.target.value)} className="h-8">
          <option value="all">Any year</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>

        <span className="text-[12px] text-text-muted">
          {visible.length} of {shipments.length}
        </span>
      </div>

      <div className="space-y-2">
        {visible.map((s) => (
          <Link
            key={s.id}
            to={`/shipments/${s.id}`}
            className="card block p-4 transition-colors hover:border-border-strong"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-[13.5px] font-medium text-text-primary">
                  {s.id}
                  <StatusPill tone={STAGE_TONE[s.stage]}>{SHIPMENT_STAGE_LABEL[s.stage]}</StatusPill>
                  <span className="font-normal text-text-muted">{s.enquiry_ref}</span>
                </p>
                <p className="mt-0.5 text-[12px] text-text-secondary">
                  {[s.origin, s.destination].filter(Boolean).join(" → ") || "Lane not recorded"}
                  {s.cargo ? ` · ${s.cargo}` : ""}
                </p>
                {(s.bl_number || s.container_number || s.vessel) && (
                  <p className="mt-0.5 text-[11.5px] text-text-muted">
                    {[
                      s.bl_number && `B/L ${s.bl_number}`,
                      s.container_number,
                                      s.vessel,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[12px] tabular-nums text-text-primary">
                  {s.sailing_date ?? s.created_at?.slice(0, 10) ?? "—"}
                </p>
                {ACCOUNTS_DESK && s.agreed_inr != null && (
                  <p className="text-[11.5px] tabular-nums text-text-muted">{inr(s.agreed_inr)}</p>
                )}
              </div>
            </div>
          </Link>
        ))}
        {!visible.length && <p className="py-6 text-[13px] text-text-muted">Nothing matches that.</p>}
      </div>
    </div>
  );
}

/**
 * The enquiries, with the ones that never became anything marked as such.
 *
 * The marking is the whole point of the section. An enquiry that produced a
 * shipment is history; one that did not is a lost job, and seeing four of them
 * in a row on the same lane is a rate problem nobody would otherwise notice.
 */
function EnquiryHistory({
  enquiries,
  shipments,
}: {
  enquiries: Enquiry[];
  shipments: Shipment[];
}) {
  const shipped = useMemo(() => new Set(shipments.map((s) => s.enquiry_ref)), [shipments]);
  const [lostOnly, setLostOnly] = useState(false);

  const visible = lostOnly ? enquiries.filter((e) => !shipped.has(e.ref)) : enquiries;

  if (!enquiries.length)
    return <Empty title="No enquiries yet" body="Nothing has come in from this customer." />;

  return (
    <div>
      <label className="mb-3 flex items-center gap-1.5 text-[12px] text-text-secondary">
        <input type="checkbox" checked={lostOnly} onChange={(e) => setLostOnly(e.target.checked)} />
        Only the ones that never shipped
      </label>

      <div className="space-y-2">
        {visible.map((e) => (
          <Link
            key={e.ref}
            to={`/enquiries/${e.ref}`}
            className="card block p-4 transition-colors hover:border-border-strong"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-[13.5px] font-medium text-text-primary">
                  {e.ref}
                  <StatusPill tone={ENQUIRY_TONE[e.status] ?? "neutral"}>{STATUS_LABEL[e.status]}</StatusPill>
                  {!shipped.has(e.ref) && (
                    <span className="text-[11px] font-normal text-text-muted">never shipped</span>
                  )}
                </p>
                <p className="mt-0.5 text-[12px] text-text-secondary">
                  {[e.origin, e.destination].filter(Boolean).join(" → ") || "Lane not recorded"}
                  {e.cargo ? ` · ${e.cargo}` : ""}
                </p>
              </div>
              <p className="shrink-0 text-[12px] tabular-nums text-text-muted">
                {(e.received_at ?? "").slice(0, 10) || "—"}
              </p>
            </div>
          </Link>
        ))}
        {!visible.length && (
          <p className="py-6 text-[13px] text-text-muted">Everything they asked for shipped.</p>
        )}
      </div>
    </div>
  );
}

/**
 * Their correspondence, gathered by address.
 *
 * The same mechanism as the partner screen: Graph is asked for every thread
 * their addresses appear on, rather than the CRM keeping its own link table.
 * An address is a join that survives somebody replying from Outlook, which a
 * table populated by this application is not.
 */
function CustomerMail({ customer, mailbox }: { customer: Customer; mailbox: string }) {
  const { session } = useAuth();
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [refs, setRefs] = useState<Map<string, ThreadRef>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<FailureText | null>(null);

  const live = mailIsLive();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!live || !mailbox || !customer.emails.length) return;
      const pages = await Promise.all(
        customer.emails.map((e) =>
          searchMailbox(mailbox, participantsQuery(e)).catch(() => [] as MailMessage[])
        )
      );
      // One message addressed to two of their addresses is still one message.
      const seen = new Map<string, MailMessage>();
      for (const page of pages) for (const m of page) seen.set(m.id, m);
      const found = [...seen.values()];
      setMessages(found);
      setRefs(await refsFor([...new Set(found.map((m) => m.conversationId))]).catch(() => new Map()));
    } catch (e) {
      setError(failureText(e, "Could not read the correspondence."));
    } finally {
      setLoading(false);
    }
  }, [customer.emails, mailbox, live]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!live)
    return (
      <Empty
        title="Outlook is not connected"
        body="Sign in with Microsoft to read this customer's correspondence here."
      />
    );

  if (!customer.emails.length)
    return (
      <Empty
        title="No email address on file"
        body="Correspondence is gathered by address. Add one on the edit page and their threads appear here."
      />
    );

  if (loading) return <p className="py-8 text-[13px] text-text-muted">Reading the mailbox…</p>;

  return (
    <>
      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          <span>
            {error.message}
            {error.hint && <span className="mt-1 block opacity-80">{error.hint}</span>}
          </span>
        </div>
      )}
      <ThreadReader
        mailbox={mailbox}
        fromName={session?.name ?? ""}
        signature={session?.signature ?? ""}
        messages={messages}
        refFor={(cid) => refs.get(cid) ?? null}
        title="Correspondence"
        hint={`Every thread ${customerLabel(customer)} appears on, from this mailbox.`}
        emptyHint="Nothing found for their addresses in this mailbox."
        onChanged={() => void load()}
      />
    </>
  );
}

/** The record as stored. Editing is its own page — see /customers/:id/edit. */
function Details({ customer }: { customer: Customer }) {
  const rows: Array<[string, string | number | null]> = [
    ["Contact", customer.name],
    ["Company", customer.company || null],
    ["Email", customer.emails.join(", ") || null],
    ["Phone", customer.phones.join(", ") || null],
    ["GSTIN", customer.gstin],
    ["PAN", customer.pan],
    ["IEC", customer.iec],
    ["Bill to", customer.billing_name],
    ["Attention", customer.billing_attention],
    ["Address", customer.billing_address],
    [
      "City / state",
      [customer.billing_city, customer.billing_state, customer.billing_pincode]
        .filter(Boolean)
        .join(", ") || null,
    ],
    ["Country", customer.billing_country],
    ["Billing email", customer.billing_email],
    [
      "Payment terms",
      customer.payment_terms_days != null ? `${customer.payment_terms_days} days` : null,
    ],
    ["Added", customer.created_at?.slice(0, 10) ?? null],
  ];

  return (
    <div className="card p-5">
      <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-[10px] uppercase tracking-wide text-text-muted">{label}</dt>
            <dd className={`text-[13px] ${value ? "text-text-primary" : "text-text-muted"}`}>
              {value ?? "Not recorded"}
            </dd>
          </div>
        ))}
      </dl>

      {customer.notes && (
        <div className="mt-5 border-t border-border pt-4">
          <p className="text-[10px] uppercase tracking-wide text-text-muted">Notes</p>
          <p className="mt-1 whitespace-pre-wrap text-[13px] text-text-secondary">
            {customer.notes}
          </p>
        </div>
      )}
    </div>
  );
}

function Figure({
  label,
  value,
  sub,
  warn,
}: {
  label: string;
  value: string | number;
  sub?: string;
  warn?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-text-muted">{label}</p>
      <p className={`text-[16px] font-semibold tabular-nums ${warn ? "text-text-warning" : "text-text-primary"}`}>
        {value}
      </p>
      {sub && <p className="text-[11px] text-text-muted">{sub}</p>}
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-card border border-dashed border-border-strong bg-surface-1 p-10 text-center">
      <p className="text-[14px] font-medium text-text-primary">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-[13px] text-text-secondary">{body}</p>
    </div>
  );
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
