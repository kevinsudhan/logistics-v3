import { useCallback, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useOutletContext, useParams } from "react-router-dom";
import { AlertCircle, ChevronLeft, FileText, PackageSearch } from "lucide-react";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import StatusPill from "../components/StatusPill";
import { supabase } from "../lib/supabase";
import { money } from "../services/billing";
import { ACCOUNTS_DESK } from "../lib/features";
import { marginPct, shipmentMargin, type Margin } from "../services/bills";
import {
  getShipment,
  SHIPMENT_STAGE_LABEL,
  type Customer,
  type Shipment,
} from "../services/enquiries";

/**
 * One booked shipment, and everything the desk does to it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A SHELL WITH SECTIONS RATHER THAN ONE PAGE
 *
 * Because the alternatives are both worse. One page means progress, booking,
 * cargo, charges, invoices, costs and payments stacked into a scroll nobody
 * reaches the bottom of. Separate pages means what the reference system does:
 * an Invoice screen whose first required field is the B/L number, so you retype
 * the identifier of the job you were looking at ten seconds ago. The job stays
 * the container; the sections change what part of it you are working on.
 *
 * THE SECTION IS IN THE URL
 *
 * `/shipments/ARX-SHP-0001/invoices`, not a piece of component state. Refreshing
 * keeps you where you were, a colleague can be sent straight to the invoices of
 * one job, and Back goes back a section rather than out of the shipment
 * entirely. That is the whole reason this is a nested route.
 *
 * THE MONEY DOES NOT MOVE
 *
 * Billed, cost and the margin between them sit in the header on every section.
 * The screen this was modelled on has eighteen fields above the fold and its
 * total below it, which means the one number everybody opens an invoice to
 * read is the one number you have to go looking for.
 *
 * On a build without the accounts desk all three lose their source, so the
 * header shows what a booking owns by itself -- the agreed amount, the route
 * and the sailing -- and the two queries behind them are not made at all.
 * ---------------------------------------------------------------------------
 */

export interface ShipmentContext {
  shipment: Shipment & { customer: Customer | null };
  /** Re-reads the shipment and the billing summary. */
  reload: () => Promise<void>;
}

/** Typed access to what the shell loaded, for the section components. */
export const useShipment = () => useOutletContext<ShipmentContext>();

interface BillingSummary {
  invoice_count: number;
  draft_count: number;
  billed_inr: number;
}

function Money({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "muted" | "warning";
}) {
  return (
    <div className="min-w-0 flex-1">
      <p className="text-[11px] text-text-secondary">{label}</p>
      <p
        className={`text-[15px] font-medium tabular-nums ${
          tone === "muted"
            ? "text-text-muted"
            : tone === "warning"
              ? "text-text-warning"
              : "text-text-primary"
        }`}
      >
        {value}
      </p>
      {hint && <p className="text-[11px] text-text-muted">{hint}</p>}
    </div>
  );
}

const TABS = [
  { to: ".", label: "Overview", end: true },
  { to: "parties", label: "Parties & B/L", end: false },
  { to: "containers", label: "Containers", end: false },
  // Registered as routes only when the accounts desk is on, so the tabs follow.
  ...(ACCOUNTS_DESK
    ? [
        { to: "invoices", label: "Invoices", end: false },
        { to: "costs", label: "Costs", end: false },
      ]
    : []),
];

export default function ShipmentDetail() {
  const { id } = useParams();
  const [shipment, setShipment] = useState<(Shipment & { customer: Customer | null }) | null>(null);
  const [billing, setBilling] = useState<BillingSummary | null>(null);
  const [margin, setMargin] = useState<Margin | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      // Without the accounts desk the billing summary and the margin are two
      // round trips whose answers nothing on the page reads. The shipment on
      // its own is what the header needs.
      const [s, billingRow, m] = await Promise.all([
        getShipment(id),
        ACCOUNTS_DESK
          ? supabase
              .from("shipment_billing")
              .select("invoice_count, draft_count, billed_inr")
              .eq("shipment_id", id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        ACCOUNTS_DESK ? shipmentMargin(id).catch(() => null) : Promise.resolve(null),
      ]);
      setShipment(s);
      setBilling((billingRow.data as BillingSummary) ?? null);
      setMargin(m);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the shipment.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <p className="py-10 text-[13px] text-text-muted">Loading…</p>;

  if (!shipment) {
    return (
      <EmptyState
        icon={PackageSearch}
        title="No shipment with that reference"
        hint={`Nothing in the shipments table is filed under ${id ?? "that id"}. It may have been removed, or the link may be from an older record.`}
        action={
          <Link
            to="/shipments/in-process"
            className="inline-flex h-8 items-center rounded-lg border border-border-strong bg-surface-1 px-3 text-[12px] font-medium text-text-primary transition-colors hover:bg-surface-2"
          >
            Back to shipments
          </Link>
        }
      />
    );
  }

  const s = shipment;
  const delivered = s.stage === "delivered";
  const billed = billing?.billed_inr ?? 0;
  const agreed = s.agreed_inr;

  // Revenue counts issued invoices net of credit notes, which the view already
  // does; `billed` from the billing summary counts tax invoices only and is
  // kept for the draft badge.
  const revenue = Number(margin?.revenue_inr ?? billed);
  const cost = Number(margin?.cost_inr ?? 0);
  const pct = marginPct(revenue, cost);

  return (
    <div>
      <Link
        to={delivered ? "/shipments/completed" : "/shipments/in-process"}
        className="mb-4 inline-flex items-center gap-1 text-[12px] text-text-secondary hover:text-text-primary"
      >
        <ChevronLeft size={14} /> Back to shipments
      </Link>

      <PageHeader
        title={s.customer?.company || s.customer?.name || s.id}
        subtitle={
          [s.origin, s.destination].filter(Boolean).join(" → ") ||
          "Route not recorded on the booking"
        }
        action={
          <Link
            to={`/enquiries/${s.enquiry_ref}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
          >
            <FileText size={13} />
            Open case file
          </Link>
        }
      />

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[12px] text-text-accent">{s.id}</span>
        <span className="font-mono text-[11px] text-text-muted">{s.enquiry_ref}</span>
        <StatusPill tone={delivered ? "success" : "accent"}>
          {SHIPMENT_STAGE_LABEL[s.stage]}
        </StatusPill>
        {(billing?.draft_count ?? 0) > 0 && (
          <StatusPill tone="warning">
            {billing?.draft_count} draft{billing?.draft_count === 1 ? "" : "s"}
          </StatusPill>
        )}
      </div>

      {/* ---- the money, on every section ---- */}
      {/*
        Revenue, cost, margin — not agreed-versus-billed any more. Once the buy
        side exists, "did we make anything on this" is the question, and the
        quote is just where the revenue came from.

        Without the accounts desk none of those three have a source, so the
        header falls back to what a booking knows on its own: what was agreed,
        where it is going, and when it sails.
      */}
      {!ACCOUNTS_DESK ? (
        <section className="card mb-4 flex flex-wrap gap-x-6 gap-y-3 p-4">
          <Money
            label="Agreed on the quote"
            value={money(agreed)}
            hint="What the customer accepted"
            tone={agreed === null ? "muted" : undefined}
          />
          <Money
            label="Route"
            value={s.origin && s.destination ? `${s.origin} → ${s.destination}` : "—"}
            hint={s.carrier || "No carrier recorded"}
            tone={s.origin && s.destination ? undefined : "muted"}
          />
          <Money
            label="Sailing"
            value={s.sailing_date ?? "—"}
            hint={s.vessel || "No vessel recorded"}
            tone={s.sailing_date ? undefined : "muted"}
          />
        </section>
      ) : (
      <section className="card mb-4 flex flex-wrap gap-x-6 gap-y-3 p-4">
        <Money
          label="Billed"
          value={money(revenue)}
          hint={(() => {
            // `invoice_count` includes drafts, so using it here reads as
            // "₹0 — 1 invoice", which is the one thing it is not.
            const issued = (billing?.invoice_count ?? 0) - (billing?.draft_count ?? 0);
            if (issued > 0) return `${issued} invoice${issued === 1 ? "" : "s"} issued`;
            if ((billing?.draft_count ?? 0) > 0) return "Only a draft so far";
            return "Nothing issued yet";
          })()}
          tone={revenue === 0 ? "muted" : undefined}
        />
        <Money
          label="Cost"
          value={money(cost)}
          hint={cost === 0 ? "No bills recorded" : "carrier, agent and vendors"}
          tone={cost === 0 ? "muted" : undefined}
        />
        <Money
          label="Margin"
          value={revenue === 0 && cost === 0 ? "—" : money(revenue - cost)}
          hint={
            pct === null
              ? "Nothing billed yet"
              : `${pct}% of what was billed`
          }
          tone={
            revenue === 0 && cost === 0
              ? "muted"
              : revenue - cost < 0
                ? "warning"
                : undefined
          }
        />
        <Money
          label="Agreed on the quote"
          value={money(agreed)}
          hint={
            agreed === null || revenue === 0
              ? "What the customer accepted"
              : revenue === agreed
                ? "Billed exactly that"
                : `Billed ${revenue > agreed ? "above" : "below"} it`
          }
          tone={agreed === null ? "muted" : undefined}
        />
      </section>
      )}

      {/* ---- sections ---- */}
      <nav className="mb-4 flex gap-1 border-b border-border" aria-label="Shipment sections">
        {TABS.map((t) => (
          <NavLink
            key={t.label}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              `-mb-px border-b-2 px-3 py-2 text-[13px] transition-colors ${
                isActive
                  ? "border-brand font-medium text-text-primary"
                  : "border-transparent text-text-secondary hover:text-text-primary"
              }`
            }
          >
            {t.label}
            {ACCOUNTS_DESK && t.label === "Invoices" && (billing?.invoice_count ?? 0) > 0 && (
              <span className="ml-1.5 tabular-nums text-text-muted">{billing?.invoice_count}</span>
            )}
          </NavLink>
        ))}
      </nav>

      <Outlet context={{ shipment: s, reload: load } satisfies ShipmentContext} />
    </div>
  );
}
