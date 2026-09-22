import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  Building2,
  Mail,
  Phone,
  Plus,
  RefreshCw,
  Search,
  TriangleAlert,
} from "lucide-react";
import PageHeader from "../components/PageHeader";
import { ACCOUNTS_DESK } from "../lib/features";
import {
  customerLabel,
  daysSinceActivity,
  listCustomers,
  tagsOf,
  DORMANT_AFTER_DAYS,
  type CustomerSummary,
} from "../services/customers";

/**
 * Who this desk works for.
 *
 * ---------------------------------------------------------------------------
 * WHY THE FILTERS ARE THESE FILTERS
 *
 * A directory sorted alphabetically answers "what is their phone number",
 * which is the question people ask least. The ones they actually ask are about
 * state, and each of these is a decision somebody makes in a week:
 *
 *   Active / Dormant   Who has gone quiet. The call list — a customer who
 *                      shipped monthly until March and has not been heard from
 *                      since is the single most actionable row in this system,
 *                      and nothing anywhere surfaced it.
 *   Never shipped      Enquired, never converted. Either the rates are wrong
 *                      or they are benchmarking somebody else, and both are
 *                      worth knowing before quoting them again.
 *   Owes money         Before you quote them again.
 *   Missing GSTIN/IEC  Cannot be invoiced. Found at the point of invoicing,
 *                      this is a month-late discovery with the cargo gone.
 *
 * WHY EACH ROW LEADS WITH COUNTS RATHER THAN CONTACT DETAILS
 *
 * Because the row is a decision about whether to open the customer, and what
 * decides that is how much work they represent and when they were last heard
 * from. The phone number is on the file, one click away, where somebody who
 * has decided to ring them will look for it.
 * ---------------------------------------------------------------------------
 */

type Lens = "all" | "active" | "dormant" | "never" | "owing" | "kyc";

const LENS_LABEL: Record<Lens, string> = {
  all: "All",
  active: "Active",
  dormant: "Gone quiet",
  never: "Never shipped",
  owing: "Owes money",
  kyc: "Missing GSTIN / IEC",
};

export default function Customers() {
  const [rows, setRows] = useState<CustomerSummary[]>([]);
  const [query, setQuery] = useState("");
  const [lens, setLens] = useState<Lens>("all");
  const [tag, setTag] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listCustomers());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load customers.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const tags = useMemo(() => tagsOf(rows), [rows]);

  /** One lens, applied to one row. Shared by the list and the counts above it. */
  const matchesLens = useCallback((c: CustomerSummary, l: Lens): boolean => {
    const days = daysSinceActivity(c);
    switch (l) {
      case "active":
        return days !== null && days <= DORMANT_AFTER_DAYS;
      // Never heard from is not the same as gone quiet: one is a lead nobody
      // has worked, the other is a relationship that has lapsed. Lumping them
      // together puts brand new records on a chase list.
      case "dormant":
        return days !== null && days > DORMANT_AFTER_DAYS;
      case "never":
        return c.shipments === 0 && c.enquiries > 0;
      case "owing":
        return c.outstanding > 0;
      case "kyc":
        return c.gstin_missing || c.iec_missing;
      default:
        return true;
    }
  }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows
      .filter((c) => (showArchived ? true : c.active))
      .filter((c) => matchesLens(c, lens))
      .filter((c) => !tag || c.tags.some((t) => t.toLowerCase() === tag.toLowerCase()))
      .filter((c) =>
        !needle
          ? true
          : [c.id, c.name, c.company, ...c.emails, ...c.phones, ...c.tags, c.top_origin, c.top_destination]
              .filter(Boolean)
              .some((v) => String(v).toLowerCase().includes(needle))
      );
  }, [rows, query, lens, tag, showArchived, matchesLens]);

  const counts = useMemo(() => {
    const live = rows.filter((c) => c.active);
    const out = {} as Record<Lens, number>;
    for (const l of Object.keys(LENS_LABEL) as Lens[])
      out[l] = live.filter((c) => matchesLens(c, l)).length;
    return out;
  }, [rows, matchesLens]);

  const lenses: Lens[] = ACCOUNTS_DESK
    ? ["all", "active", "dormant", "never", "owing", "kyc"]
    : ["all", "active", "dormant", "never", "kyc"];

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle="Who this desk works for, and what each of them has given us. Open one for its shipments, enquiries and correspondence."
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link
          to="/customers/new"
          className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-medium text-white hover:bg-brand-dark"
        >
          <Plus size={13} />
          Add customer
        </Link>

        <div className="relative min-w-[220px] max-w-sm flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Company, contact, email, lane…"
            className="h-8 w-full pl-8"
          />
        </div>

        <button
          onClick={() => void load()}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary hover:text-text-primary"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>

        <label className="flex items-center gap-1.5 text-[12px] text-text-secondary">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Show archived
        </label>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {lenses.map((l) => (
          <Chip key={l} active={lens === l} onClick={() => setLens(l)}>
            {LENS_LABEL[l]} <span className="opacity-60">{counts[l] ?? 0}</span>
          </Chip>
        ))}
      </div>

      {tags.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] text-text-muted">By tag</span>
          {tags.map((t) => (
            <Chip
              key={t}
              active={tag?.toLowerCase() === t.toLowerCase()}
              onClick={() => setTag(tag?.toLowerCase() === t.toLowerCase() ? null : t)}
            >
              {t}
            </Chip>
          ))}
        </div>
      )}

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      {loading && !rows.length ? (
        <p className="py-8 text-[13px] text-text-muted">Loading…</p>
      ) : !rows.length ? (
        <div className="rounded-card border border-dashed border-border-strong bg-surface-1 p-10 text-center">
          <Building2 size={20} className="mx-auto text-text-muted" />
          <p className="mt-2 text-[14px] font-medium text-text-primary">No customers yet</p>
          <p className="mx-auto mt-1 max-w-md text-[13px] text-text-secondary">
            A customer is created automatically the first time an enquiry arrives from an address
            nobody recognises. Add one here when you want the record in place before the work is.
          </p>
          <Link
            to="/customers/new"
            className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-medium text-white hover:bg-brand-dark"
          >
            <Plus size={13} />
            Add customer
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((c) => (
            <Row key={c.id} c={c} />
          ))}
          {!visible.length && (
            <p className="py-6 text-[13px] text-text-muted">Nothing matches that.</p>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ c }: { c: CustomerSummary }) {
  const days = daysSinceActivity(c);
  const lane = [c.top_origin, c.top_destination].filter(Boolean).join(" → ");

  return (
    <Link to={`/customers/${c.id}`} className={`card block p-4 transition-colors hover:border-border-strong ${c.active ? "" : "opacity-60"}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[14px] font-medium text-text-primary">
            {customerLabel(c)}
            <span className="font-normal tabular-nums text-text-muted">{c.id}</span>
            {!c.active && (
              <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-text-muted">
                Archived
              </span>
            )}
          </p>

          {/* The contact, and the lane they use — enough to recognise them by. */}
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-text-secondary">
            {c.company && c.name !== c.company && <span>{c.name}</span>}
            {c.emails[0] && (
              <span className="inline-flex items-center gap-1">
                <Mail size={11} className="opacity-70" />
                {c.emails[0]}
              </span>
            )}
            {c.phones[0] && (
              <span className="inline-flex items-center gap-1">
                <Phone size={11} className="opacity-70" />
                {c.phones[0]}
              </span>
            )}
            {lane && <span className="text-text-muted">{lane}</span>}
          </p>

          {(c.gstin_missing || c.iec_missing) && c.shipments > 0 && (
            // Only where they have actually shipped. A brand new record with no
            // GSTIN is not a problem yet; one with four delivered shipments and
            // no GSTIN is an invoice that cannot be raised.
            <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-text-warning">
              <TriangleAlert size={11} />
              {[c.gstin_missing && "GSTIN", c.iec_missing && "IEC"].filter(Boolean).join(" and ")}{" "}
              missing — cannot be invoiced
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 text-right">
          <Stat label="Shipments" value={c.shipments} sub={c.shipments_live ? `${c.shipments_live} live` : undefined} />
          <Stat
            label="Enquiries"
            value={c.enquiries}
            // Won over total is the conversion, which is the number worth
            // seeing next to the count rather than instead of it.
            sub={c.enquiries ? `${c.enquiries_won} won` : undefined}
          />
          {ACCOUNTS_DESK && c.outstanding > 0 && (
            <Stat label="Outstanding" value={inr(c.outstanding)} warn />
          )}
          <div className="min-w-[92px]">
            <p className="text-[10px] uppercase tracking-wide text-text-muted">Last activity</p>
            <p
              className={`text-[13px] tabular-nums ${
                days !== null && days > DORMANT_AFTER_DAYS ? "text-text-warning" : "text-text-primary"
              }`}
            >
              {days === null ? "—" : days === 0 ? "Today" : `${days}d ago`}
            </p>
          </div>
        </div>
      </div>
    </Link>
  );
}

function Stat({
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
    <div className="min-w-[72px]">
      <p className="text-[10px] uppercase tracking-wide text-text-muted">{label}</p>
      <p
        className={`text-[13px] tabular-nums ${warn ? "text-text-warning" : "text-text-primary"}`}
      >
        {value}
      </p>
      {sub && <p className="text-[11px] text-text-muted">{sub}</p>}
    </div>
  );
}

const inr = (n: number) =>
  `₹${Math.round(n).toLocaleString("en-IN")}`;

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] transition-colors ${
        active
          ? "border-brand bg-brand text-white"
          : "border-border bg-surface-1 text-text-secondary hover:border-border-strong hover:text-text-primary"
      }`}
    >
      {children}
    </button>
  );
}
