import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useOutletContext, useParams } from "react-router-dom";
import ShipmentCheckpoints from "../components/ShipmentCheckpoints";
import EnquiryLink from "../components/EnquiryLink";
import { AlertCircle, ChevronLeft, FileText, PackageSearch } from "lucide-react";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import StatusPill from "../components/StatusPill";
import { enquiryWatches, LiveVersions, shipmentWatches, useLiveVersions } from "../lib/liveVersions";

/** What the header shows: the stage, the money, the free time and the cargo lines. */
const HEADER_TABLES = ["shipments", "enquiries", "invoices", "bills", "shipment_containers", "enquiry_dimensions"];
import { todayIST } from "../lib/progress";
import { appliesTo, clocksFor, NO_FREE_TIME, sideOf, summarise } from "../lib/freeTime";
import { FreeTimePill } from "../components/FreeTime";
import { listShipmentContainers, type ShipmentContainer } from "../services/shipmentContainers";
import { dateClashes } from "../lib/shipmentDates";
import { money } from "../services/billing";
import { ACCOUNTS_DESK } from "../lib/features";
import SendPreAlert from "../components/SendPreAlert";
import { useCachedState } from "../lib/useCachedState";
import TradeDirectionPicker from "../components/TradeDirectionPicker";
import { CancelledBanner } from "../components/CancelShipment";
import { marginPct, shipmentBilling, shipmentMargin, type BillingSummary, type Margin } from "../services/bills";
import {
  getEnquiry,
  getShipment,
  stageLabel,
  stagesFor,
  updateEnquiry,
  type Customer,
  type Enquiry,
  type Shipment,
} from "../services/enquiries";
import { listDimensions } from "../services/enquiryDimensions";
import type { DimensionLine } from "../lib/dimensions";
import { PageSkeleton, SectionSkeleton } from "../components/Loading";

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
  /**
   * The enquiry this booking came from (065).
   *
   * The job's facts — customer, service, route, terms, cargo, sizes — are kept
   * there and edited from either page through the same panels; a trigger keeps
   * the shipment's copies in step. Null only if the enquiry cannot be read.
   */
  enquiry: (Enquiry & { customer: Customer | null }) | null;
  /** The enquiry's dimension lines, for the cargo tab. */
  lines: DimensionLine[];
  /** Re-reads the shipment, its enquiry and the billing summary. */
  reload: () => Promise<void>;
}

/** Typed access to what the shell loaded, for the section components. */
export const useShipment = () => useOutletContext<ShipmentContext>();

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

function tabsFor(mode: Enquiry["transport_mode"] | null | undefined) {
  return [
    { to: ".", label: "Shipment details", end: true },
    { to: "parties", label: "Party", end: false },
    { to: "cargo", label: "Cargo details", end: false },
    // The house bill is a HAWB on a flight and an HBL at sea — same job, the
    // name the desk and the customer both use.
    { to: "bill", label: mode === "air" ? "HAWB" : "House B/L", end: false },
    { to: "pickup-delivery", label: "Pickup & delivery", end: false },
    { to: "warehouse", label: "Warehouse", end: false },
    // The job's line in the import manifest and its CSN for ICEGATE (143): a sea thing.
    ...(mode === "air" ? [] : [{ to: "igm", label: "IGM", end: false }]),
    { to: "tracking", label: "Tracking", end: false },
    { to: "sign-off", label: "Sign-off", end: false },
    { to: "documents", label: "Documents", end: false },
    // The correspondence — a booking is the second half of one job, and having
    // to go back to the enquiry to read the thread it came from is how a desk
    // ends up working the mailbox instead of the system.
    { to: "mail", label: "Mail", end: false },
    // Boxes are a sea thing: an air job has no container to record (30 Sep).
    ...(mode === "air" ? [] : [{ to: "containers", label: "Containers", end: false }]),
    // Registered as routes only when the accounts desk is on, so the tabs follow.
    ...(ACCOUNTS_DESK
      ? [
          { to: "invoices", label: "Invoices", end: false },
          { to: "costs", label: "Costs", end: false },
        ]
      : []),
  ];
}

export default function ShipmentDetail() {
  const { id } = useParams();
  // Kept per job (lib/queryCache): opened again, the job shows at once and reads again behind it.
  const cacheAt = `ship:${id ?? ""}`;
  const [shipment, setShipment] = useCachedState<(Shipment & { customer: Customer | null }) | null>(`${cacheAt}:shipment`, null);
  const [enquiry, setEnquiry] = useCachedState<(Enquiry & { customer: Customer | null }) | null>(`${cacheAt}:enquiry`, null);
  const [lines, setLines] = useCachedState<DimensionLine[]>(`${cacheAt}:lines`, []);
  const [boxes, setBoxes] = useCachedState<ShipmentContainer[]>(`${cacheAt}:boxes`, []);
  const [billing, setBilling] = useCachedState<BillingSummary | null>(`${cacheAt}:billing`, null);
  const [margin, setMargin] = useCachedState<Margin | null>(`${cacheAt}:margin`, null);
  /** The job's enquiry, when it is already known: then everything is read in one go. */
  const knownRef = useRef<string | null>(null);
  knownRef.current = shipment?.id === id ? (shipment?.enquiry_ref ?? null) : null;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      // Without the accounts desk the billing summary and the margin are two
      // round trips whose answers nothing on the page reads. The shipment on
      // its own is what the header needs.
      // The enquiry's reference is known from the last time this job was open:
      // its reads go with the job's, not a round trip after (6 Oct).
      const ref = knownRef.current;
      const early = ref
        ? Promise.all([getEnquiry(ref).catch(() => null), listDimensions(ref).catch(() => [] as DimensionLine[])])
        : null;
      const [s, billingRow, m, b] = await Promise.all([
        getShipment(id),
        // Best-effort, as the margin: the header still opens without it.
        ACCOUNTS_DESK ? shipmentBilling(id).catch(() => null) : Promise.resolve(null),
        ACCOUNTS_DESK ? shipmentMargin(id).catch(() => null) : Promise.resolve(null),
        // The boxes, for the free-time alert in the header (an FCL job's): read with the job.
        listShipmentContainers(id).catch(() => [] as ShipmentContainer[]),
      ]);
      setShipment(s);
      // The enquiry after the shipment when its reference was not known yet.
      // Best-effort: a booking whose enquiry cannot be read still opens.
      if (s) {
        const [e, d] =
          early && ref === s.enquiry_ref
            ? await early
            : await Promise.all([getEnquiry(s.enquiry_ref).catch(() => null), listDimensions(s.enquiry_ref).catch(() => [] as DimensionLine[])]);
        setEnquiry(e);
        setLines(d);
        setBoxes(appliesTo(s.transport_mode) ? b : []);
      }
      setBilling(billingRow);
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

  /*
    Everything on this job, as it changes, for whoever has it open (084).

    One subscription for the shell and every tab: the job, the enquiry behind
    it, and each table a tab reads, filtered to this job. The header re-reads
    for what it shows — the stage, the money, the free time, the cargo lines —
    and each tab re-reads for its own tables through useLiveVersion. The tabs
    keep their own drafts, so a change landing mid-edit does not wipe what
    somebody is typing.
  */
  const live = useLiveVersions(
    [
      ["shipments", `id=eq.${id}`],
      ...shipmentWatches(id ?? ""),
      ...(shipment ? ([["enquiries", `ref=eq.${shipment.enquiry_ref}`], ...enquiryWatches(shipment.enquiry_ref)] as const) : []),
    ],
    (tables) => {
      if (HEADER_TABLES.some((t) => tables.has(t))) void load();
    },
    Boolean(id)
  );

  if (loading && !shipment) return <PageSkeleton />;

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
  const mode = s.transport_mode ?? enquiry?.transport_mode ?? null;
  const TABS = tabsFor(mode);

  /*
    The next stage, beside the current one.

    It used to be a card of its own on the overview. It is one link, and the
    question "where is the cargo" is answered in the header on every tab. The
    stage is a customer milestone (102), so the link opens it on the Tracking
    tab to be recorded with its date and place, rather than moving it blind.
  */
  const direction = s.trade_direction ?? enquiry?.trade_direction ?? null;
  const order = stagesFor(mode, direction);
  const at = order.indexOf(s.stage);
  const next = at >= 0 ? order[at + 1] : undefined;
  const billed = billing?.billed_inr ?? 0;
  const agreed = s.agreed_inr;

  // Free time (083), worst box first. Shown on every tab, like the stage: a
  // lapsing free period is the one thing on a job that costs money by the day.
  const today = todayIST();
  const freeTime = appliesTo(mode)
    ? summarise(boxes.map((b) => clocksFor(sideOf(s.trade_direction ?? enquiry?.trade_direction), s, b, today)), today)
    : NO_FREE_TIME;

  // Revenue and cost before GST, net of credit notes, as Job closing counts
  // them (shipment_margin, 103); `billed` from the billing summary counts tax
  // invoices only and is kept for the draft badge.
  // Dates that cannot all be true — cargo ready after the ETD, and the like.
  const clashes = dateClashes({
    ready: enquiry?.ready_date ?? null,
    cutoff: s.cargo_cutoff ?? null,
    siCutoff: s.si_cutoff ?? null,
    etd: s.etd,
    eta: s.eta,
    stage: s.stage,
  });

  const revenue = Number(margin?.revenue_inr ?? billed);
  const cost = Number(margin?.cost_inr ?? 0);
  const pct = marginPct(revenue, cost);

  return (
    <LiveVersions value={live}>
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
          <EnquiryLink
            to={`/enquiries/${s.enquiry_ref}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
          >
            <FileText size={13} />
            Open case file
          </EnquiryLink>
        }
      />

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      {clashes.length > 0 && (
        <div role="alert" className="mb-3 flex items-start gap-2 rounded-lg border border-text-warning/30 bg-bg-warning px-3 py-2.5 text-[12px] text-text-warning">
          <AlertCircle size={13} className="mt-px shrink-0" />
          <span>
            {clashes.map((c) => (
              <span key={c} className="block">
                {c}
              </span>
            ))}
          </span>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[12px] text-text-accent">{s.id}</span>
        <span className="font-mono text-[11px] text-text-muted">{s.enquiry_ref}</span>
        <StatusPill tone={delivered ? "success" : "accent"}>
          {stageLabel(s.stage, mode)}
        </StatusPill>
        {s.signed_off_at && <StatusPill tone="success">Signed off</StatusPill>}
        {/*
          Import or export, said outright (134): the workflow, the customer's
          milestones, the customs side, the pre-alert and the B/L all follow it.
          The job's fact, on the enquiry, which the shipment follows.
        */}
        <TradeDirectionPicker
          value={direction}
          locked={Boolean(s.signed_off_at) || s.stage === "cancelled" || s.stage === "delivered"}
          onChange={async (v) => {
            await updateEnquiry(s.enquiry_ref, { trade_direction: v }, `Trade direction set to ${v.replace("_", " ")}`);
            await load();
          }}
        />
        <FreeTimePill summary={freeTime} to={`/shipments/${s.id}/containers`} quiet />
        {(freeTime.accrued ?? 0) > 0 && (
          <span className="text-[11px] tabular-nums text-text-danger" title="At the rates recorded on the Containers tab; an estimate">
            about {freeTime.currency} {freeTime.accrued!.toLocaleString("en-IN")} in D&amp;D
          </span>
        )}
        {/* A signed-off job's progress is locked (070); the link would only
            meet the refusal. */}
        {next && s.stage !== "cancelled" && !s.signed_off_at && (
          <Link
            to={`tracking?record=${next}`}
            className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-2.5 text-[11.5px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
          >
            Mark {stageLabel(next, mode).toLowerCase()}…
          </Link>
        )}
        {/* The pre-alert goes out on exports; on an import the agent sends it to us. */}
        {s.trade_direction !== "import" && s.stage !== "cancelled" && (
          <SendPreAlert shipment={s} enquiry={enquiry} onSent={() => void load()} />
        )}
        {(billing?.draft_count ?? 0) > 0 && (
          <StatusPill tone="warning">
            {billing?.draft_count} draft{billing?.draft_count === 1 ? "" : "s"}
          </StatusPill>
        )}
      </div>

      {s.stage === "cancelled" && <CancelledBanner shipment={s} onChanged={load} />}

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
      <nav
        className="mb-4 flex gap-1 overflow-x-auto border-b border-border"
        aria-label="Shipment sections"
      >
        {TABS.map((t) => (
          <NavLink
            key={t.label}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              `-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-[13px] transition-colors ${
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

      {/*
        The follow-ups, above the sections rather than inside one.

        "Where are we on this job" is the question somebody brings to the page,
        and answering it should not require choosing a tab first — the same
        reason the enquiry's workflow bar sits above its tab strip.
      */}
      <div className="mb-4">
        {/* Keyed on the stage, so a milestone recorded on the Tracking tab —
            which ticks a step — redraws the line with it ticked. */}
        <ShipmentCheckpoints key={s.stage} shipmentId={s.id} mode={mode} />
      </div>

      {/* A tab still downloading waits in the tab, under the shipment's header. */}
      <Suspense fallback={<SectionSkeleton lines={4} className="py-6" />}>
        <Outlet context={{ shipment: s, enquiry, lines, reload: load } satisfies ShipmentContext} />
      </Suspense>
    </div>
    </LiveVersions>
  );
}
