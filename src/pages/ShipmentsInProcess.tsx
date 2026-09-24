import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import EnquiryLink from "../components/EnquiryLink";
import { AlertCircle, ChevronRight, Download, LayoutList, Radar, RefreshCw, Search, Table2, Truck, X } from "lucide-react";
import PageHeader from "../components/PageHeader";
import Select from "../components/Select";
import { openStepsFor, type Checkpoint } from "../services/checkpoints";
import { DUE_TONE, dueState, dueText, todayIST } from "../lib/progress";
import { useAuth } from "../lib/auth";
import { customsStatus } from "../lib/customs";
import { downloadWorkbook, stamped } from "../lib/xlsx";
import {
  applyFilters,
  carriersOf,
  CUSTOMS_LABEL,
  customsState,
  exportTable,
  MODE_LABEL,
  NO_EXTRAS,
  NO_FILTERS,
  sortRows,
  type Extras,
  type Filters,
  type SortKey,
} from "../lib/worklist";
import HandledBy, { OWNERSHIP, ownedBy, type Ownership } from "../components/HandledBy";
import { customsForShipments } from "../services/customs";
import { EVENT_STAGE, waitingUpdatesFor } from "../services/liveTracking";
import {
  listPeople,
  listShipments,
  type Person,
  type ShipmentRow,
  SHIPMENT_STAGES,
  SHIPMENT_STAGE_LABEL,
  stageLabel,
  type ShipmentStage,
} from "../services/enquiries";
import { ListSkeleton } from "../components/Loading";

/**
 * The in-process worklist: every job between acceptance and delivery.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS ON EACH JOB
 *
 * The next open step and how late it is, the customs position (077) and the
 * tracking updates waiting for somebody to confirm (072), beside the route,
 * the dates and who has it. Those come from three small queries alongside the
 * list, not from the list itself, and a job still shows if one of them fails.
 *
 * FINDING AND NARROWING
 *
 * The search box takes whatever is in hand — job, enquiry, HAWB, master bill,
 * container, booking, customer, consignee, flight, vessel, port — and the
 * filters narrow by stage, owner, mode, carrier and customs, or to the jobs
 * with something overdue, due today or waiting to be confirmed. The rules are
 * in src/lib/worklist.ts, tested there.
 *
 * TWO WAYS TO READ IT
 *
 * Cards for working through the day; a table, like the reference system, for
 * scanning many at once. The choice and the order are remembered on this
 * machine. Export writes exactly what is on screen, in that order, to Excel.
 * ---------------------------------------------------------------------------
 */

/** "2 Oct" — the list is read at a glance, the year is noise. */
const day = (d: string | null) =>
  d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : null;

/** Everything before delivery. Delivered shipments live on the completed page. */
const IN_PROCESS: ShipmentStage[] = SHIPMENT_STAGES.filter((s) => s !== "delivered");

const SORTS: Array<{ value: SortKey; label: string }> = [
  { value: "urgency", label: "Most urgent first" },
  { value: "etd", label: "Departure (ETD)" },
  { value: "eta", label: "Arrival (ETA)" },
  { value: "newest", label: "Newest booking" },
  { value: "customer", label: "Customer A–Z" },
];

const CUSTOMS_TONE: Record<Extras["customs"], string> = {
  none: "",
  pending: "bg-bg-accent text-text-accent",
  on_hold: "bg-bg-danger text-text-danger",
  cleared: "bg-bg-success text-text-success",
};

/** A preference kept on this machine; never required for the page to work. */
function useRemembered<T extends string>(key: string, fallback: T, allowed: readonly T[]): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const got = localStorage.getItem(key) as T | null;
      return got && allowed.includes(got) ? got : fallback;
    } catch {
      return fallback;
    }
  });
  const set = (x: T) => {
    setV(x);
    try {
      localStorage.setItem(key, x);
    } catch {
      /* private window: the choice lasts this visit only */
    }
  };
  return [v, set];
}

export default function ShipmentsInProcess() {
  const [rows, setRows] = useState<ShipmentRow[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  // Everyone sees every shipment; this narrows to the ones that are
  // yours, or the ones nobody has picked up yet.
  const [owner, setOwner] = useState<Ownership>("all");
  const { session } = useAuth();
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [steps, setSteps] = useState<Checkpoint[]>([]);
  const [customs, setCustoms] = useState<Map<string, Extras["customs"]>>(new Map());
  const [updates, setUpdates] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useRemembered<"cards" | "table">("worklist:view", "cards", ["cards", "table"]);
  const [sort, setSort] = useRemembered<SortKey>("worklist:sort", "urgency", SORTS.map((s) => s.value));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ships, who] = await Promise.all([listShipments(IN_PROCESS), listPeople()]);
      setRows(ships);
      setPeople(who);
      const ids = ships.map((x) => x.id);
      // Best-effort, each of them: the list still shows its jobs without them.
      const [open, cs, ups] = await Promise.all([
        openStepsFor(ids).catch(() => [] as Checkpoint[]),
        customsForShipments(ids).catch(() => []),
        waitingUpdatesFor(ids).catch(() => []),
      ]);
      setSteps(open);
      const byJob = new Map<string, Array<{ status: string }>>();
      for (const c of cs) byJob.set(c.shipment_id, [...(byJob.get(c.shipment_id) ?? []), { status: customsStatus(c) }]);
      setCustoms(new Map([...byJob].map(([id, list]) => [id, customsState(list)])));
      // An offer for a milestone whose step is already ticked asks nothing any more.
      const openStages = new Set(open.filter((c) => c.stage).map((c) => `${c.shipment_id}:${c.stage}`));
      const n = new Map<string, number>();
      for (const u of ups) {
        const stage = EVENT_STAGE[u.kind];
        if (stage && !openStages.has(`${u.shipment_id}:${stage}`)) continue;
        n.set(u.shipment_id, (n.get(u.shipment_id) ?? 0) + 1);
      }
      setUpdates(n);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load shipments.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /*
    Per job: the next open step, and how many are overdue or due today.

    The next step is the first open one in order, not the most overdue — it is
    what somebody opening the job will be asked to do. The overdue count is
    beside it so a job with three late steps does not hide behind a next step
    that happens to be on time.
  */
  const today = todayIST();
  const extras = useMemo(() => {
    const m = new Map<string, Extras>();
    for (const c of steps) {
      const w = m.get(c.shipment_id) ?? { ...NO_EXTRAS };
      if (!w.nextLabel) {
        w.nextLabel = c.label;
        w.nextDue = c.due_on;
      }
      const st = dueState(c.due_on, false, today);
      if (st === "overdue") w.overdue++;
      if (st === "today") w.dueToday++;
      if (c.due_on && (!w.soonest || c.due_on < w.soonest)) w.soonest = c.due_on;
      m.set(c.shipment_id, w);
    }
    for (const r of rows) {
      const w = m.get(r.id) ?? { ...NO_EXTRAS };
      w.customs = customs.get(r.id) ?? "none";
      w.updates = updates.get(r.id) ?? 0;
      m.set(r.id, w);
    }
    return m;
  }, [steps, rows, customs, updates, today]);
  const x = useCallback((id: string) => extras.get(id) ?? NO_EXTRAS, [extras]);

  const mine = rows.filter((r) => ownedBy(r.assigned_to, owner, session?.userId));
  const visible = sortRows(applyFilters(mine, filters, x), sort, x) as ShipmentRow[];

  const count = (f: Partial<Filters>) => applyFilters(mine, { ...filters, ...f }, x).length;
  const stageCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of IN_PROCESS) c[s] = rows.filter((r) => r.stage === s).length;
    return c;
  }, [rows]);
  const carriers = useMemo(() => carriersOf(rows), [rows]);
  const modes = useMemo(() => [...new Set(rows.map((r) => r.transport_mode ?? "none"))], [rows]);
  const narrowed = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS) || owner !== "all";

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));

  function exportExcel() {
    const t = exportTable(visible, x, (r) => stageLabel(r.stage as ShipmentStage, (r as ShipmentRow).transport_mode));
    downloadWorkbook(stamped("in-process-shipments"), [{ name: "In process", columns: t.columns, rows: t.rows }]);
  }

  return (
    <div>
      <PageHeader
        title="In-process shipments"
        subtitle="Bookings from acceptance through to delivery. Each one began as an enquiry the customer said yes to."
      />

      {/* ---- find ---- */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="relative min-w-[220px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={filters.query}
            onChange={(e) => set({ query: e.target.value })}
            placeholder="Job, HAWB, container, customer, flight, vessel, port…"
            aria-label="Search shipments"
            className="h-9 w-full pl-8 pr-8"
          />
          {filters.query && (
            <button type="button" onClick={() => set({ query: "" })} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary" aria-label="Clear the search">
              <X size={14} />
            </button>
          )}
        </label>
        <Select
          label="Mode"
          value={filters.mode}
          options={[{ value: "all", label: "Any mode" }, ...modes.map((m) => ({ value: m, label: MODE_LABEL[m] ?? m }))]}
          onChange={(v) => set({ mode: v })}
          className="w-36"
        />
        <Select
          label="Carrier"
          value={filters.carrier}
          options={[{ value: "all", label: "Any carrier" }, ...carriers.map((c) => ({ value: c, label: c }))]}
          onChange={(v) => set({ carrier: v })}
          className="w-44"
        />
        <Select
          label="Customs"
          value={filters.customs}
          options={[
            { value: "any", label: "Any customs" },
            { value: "pending", label: "Customs in progress" },
            { value: "on_hold", label: "Customs on hold" },
            { value: "cleared", label: "Customs cleared" },
            { value: "none", label: "No customs record" },
          ]}
          onChange={(v) => set({ customs: v as Filters["customs"] })}
          className="w-48"
        />
      </div>

      {/* ---- what needs doing ---- */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <Chip active={filters.focus === "all"} onClick={() => set({ focus: "all" })}>
          Every job <span className="opacity-60">{count({ focus: "all" })}</span>
        </Chip>
        <Chip active={filters.focus === "overdue"} onClick={() => set({ focus: "overdue" })}>
          <span className={count({ focus: "overdue" }) ? "text-text-danger" : ""}>Overdue</span> <span className="opacity-60">{count({ focus: "overdue" })}</span>
        </Chip>
        <Chip active={filters.focus === "today"} onClick={() => set({ focus: "today" })}>
          Due today <span className="opacity-60">{count({ focus: "today" })}</span>
        </Chip>
        <Chip active={filters.focus === "updates"} onClick={() => set({ focus: "updates" })}>
          <Radar size={11} /> Updates to confirm <span className="opacity-60">{count({ focus: "updates" })}</span>
        </Chip>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <Chip active={filters.stage === "all"} onClick={() => set({ stage: "all" })}>
          Any stage <span className="opacity-60">{rows.length}</span>
        </Chip>
        {IN_PROCESS.filter((s) => stageCounts[s] > 0).map((s) => (
          <Chip key={s} active={filters.stage === s} onClick={() => set({ stage: s })}>
            {SHIPMENT_STAGE_LABEL[s]} <span className="opacity-60">{stageCounts[s]}</span>
          </Chip>
        ))}
        <span className="mx-2 h-4 w-px bg-border" aria-hidden="true" />
        {OWNERSHIP.map((o) => (
          <Chip key={o.key} active={owner === o.key} onClick={() => setOwner(o.key)}>
            {o.label}
            {o.key === "free" && <span className="opacity-60"> {rows.filter((r) => !r.assigned_to).length}</span>}
          </Chip>
        ))}
      </div>

      {/* ---- how to read it ---- */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="text-[12px] text-text-secondary">
          {visible.length} of {rows.length} job{rows.length === 1 ? "" : "s"}
          {narrowed && (
            <button
              type="button"
              onClick={() => {
                setFilters(NO_FILTERS);
                setOwner("all");
              }}
              className="ml-2 text-text-accent hover:underline"
            >
              Clear filters
            </button>
          )}
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select label="Order" value={sort} options={SORTS} onChange={(v) => setSort(v as SortKey)} className="w-48" align="right" />
          <div className="flex h-8 overflow-hidden rounded-lg border border-border bg-surface-1" role="group" aria-label="View">
            <button type="button" onClick={() => setView("cards")} aria-pressed={view === "cards"} title="Cards" className={`grid w-9 place-items-center ${view === "cards" ? "bg-brand text-white" : "text-text-muted hover:text-text-primary"}`}>
              <LayoutList size={15} />
            </button>
            <button type="button" onClick={() => setView("table")} aria-pressed={view === "table"} title="Table" className={`grid w-9 place-items-center border-l border-border ${view === "table" ? "bg-brand text-white" : "text-text-muted hover:text-text-primary"}`}>
              <Table2 size={15} />
            </button>
          </div>
          <button
            type="button"
            onClick={exportExcel}
            disabled={!visible.length}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-2.5 text-[12px] text-text-secondary hover:text-text-primary disabled:opacity-50"
          >
            <Download size={13} /> Excel
          </button>
          <button
            onClick={() => void load()}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-2.5 text-[12px] text-text-secondary hover:text-text-primary"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      {loading && !rows.length ? (
        <ListSkeleton />
      ) : !rows.length ? (
        <div className="rounded-card border border-dashed border-border-strong bg-surface-1 p-10 text-center">
          <Truck size={20} className="mx-auto text-text-muted" />
          <p className="mt-2 text-[14px] font-medium text-text-primary">No shipments in process</p>
          <p className="mx-auto mt-1 max-w-md text-[13px] text-text-secondary">
            A shipment appears here when an accepted enquiry is pushed through from its case file.
          </p>
          <Link to="/enquiries" className="mt-4 inline-flex h-8 items-center rounded-lg bg-brand px-3 text-[12px] font-medium text-white hover:bg-brand-dark">
            Go to enquiries
          </Link>
        </div>
      ) : !visible.length ? (
        <p className="rounded-card border border-dashed border-border bg-surface-1 px-4 py-8 text-center text-[13px] text-text-secondary">
          No job matches{filters.query ? ` "${filters.query}"` : ""} with these filters.
        </p>
      ) : view === "table" ? (
        <WorkTable rows={visible} x={x} people={people} meId={session?.userId} today={today} />
      ) : (
        <div className="space-y-2">
          {visible.map((s) => (
            <WorkCard key={s.id} s={s} w={x(s.id)} people={people} meId={session?.userId} today={today} />
          ))}
        </div>
      )}
    </div>
  );
}

function Badges({ w }: { w: Extras }) {
  return (
    <>
      {w.overdue > 0 && <span className="rounded-full bg-bg-danger px-1.5 py-0.5 text-[10.5px] font-medium text-text-danger">{w.overdue} overdue</span>}
      {w.customs !== "none" && (
        <span className={`rounded-full px-1.5 py-0.5 text-[10.5px] font-medium ${CUSTOMS_TONE[w.customs]}`}>Customs {CUSTOMS_LABEL[w.customs].toLowerCase()}</span>
      )}
      {w.updates > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full bg-bg-warning px-1.5 py-0.5 text-[10.5px] font-medium text-text-warning">
          <Radar size={10} /> {w.updates} to confirm
        </span>
      )}
    </>
  );
}

/*
  The card is not a Link.
  ------------------------------------------------------------------
  The reference is the link instead, which is also the more honest target:
  the row is a shipment, not a button, and controls inside an anchor both
  act and navigate.
*/
function WorkCard({ s, w, people, meId, today }: { s: ShipmentRow; w: Extras; people: Person[]; meId?: string; today: string }) {
  const st = dueState(w.nextDue, false, today);
  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/shipments/${s.id}`} className="font-mono text-[12px] text-text-accent hover:underline">
              {s.id}
            </Link>
            <EnquiryLink to={`/enquiries/${s.enquiry_ref}`} className="font-mono text-[11px] text-text-muted hover:underline">
              {s.enquiry_ref}
            </EnquiryLink>
            {s.bl_number && <span className="font-mono text-[11px] text-text-muted">{s.bl_number}</span>}
            <HandledBy assignedTo={s.assigned_to} people={people} meId={meId} />
          </div>
          <Link to={`/shipments/${s.id}`} className="group mt-0.5 block">
            <p className="text-[14px] font-medium text-text-primary group-hover:underline">{s.customer?.company || s.customer?.name || "—"}</p>
            <p className="text-[12px] text-text-secondary">
              {[s.origin, s.destination].filter(Boolean).join(" → ") || "Route not recorded"}
              {s.cargo ? ` · ${s.cargo}` : ""}
              {s.volume_cbm ? ` · ${s.volume_cbm} CBM` : ""}
            </p>
          </Link>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
            {w.nextLabel && (
              <span>
                <span className="text-text-muted">Next: </span>
                <span className="text-text-primary">{w.nextLabel}</span>
                {w.nextDue && <span className={DUE_TONE[st]}> · {dueText(w.nextDue, false, today)}</span>}
              </span>
            )}
            <Badges w={w} />
          </div>
        </div>
        <div className="flex shrink-0 items-start gap-3 text-right">
          <div>
            <span className="rounded-full bg-bg-accent px-2 py-0.5 text-[11px] font-medium text-text-accent">{stageLabel(s.stage, s.transport_mode)}</span>
            <p className="mt-1 text-[11px] tabular-nums text-text-muted">
              {s.etd || s.eta ? [s.etd && `ETD ${day(s.etd)}`, s.eta && `ETA ${day(s.eta)}`].filter(Boolean).join(" · ") : "No ETD yet"}
            </p>
            {(s.carrier || s.flight_number || s.vessel) && (
              <p className="text-[11px] text-text-muted">{[s.carrier, s.transport_mode === "air" ? s.flight_number : s.vessel].filter(Boolean).join(" · ")}</p>
            )}
          </div>
          <Link to={`/shipments/${s.id}`} className="mt-0.5 text-text-muted hover:text-text-primary" aria-label={`Open ${s.id}`}>
            <ChevronRight size={16} />
          </Link>
        </div>
      </div>
    </div>
  );
}

function WorkTable({ rows, x, people, meId, today }: { rows: ShipmentRow[]; x: (id: string) => Extras; people: Person[]; meId?: string; today: string }) {
  const Th = ({ children, right }: { children: ReactNode; right?: boolean }) => (
    <th className={`whitespace-nowrap px-2.5 py-2 text-[11px] font-medium text-text-secondary ${right ? "text-right" : "text-left"}`}>{children}</th>
  );
  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full min-w-[1080px] text-[12.5px]">
        <thead className="border-b border-border bg-surface-2">
          <tr>
            <Th>Shipment</Th>
            <Th>Customer</Th>
            <Th>Mode</Th>
            <Th>Route</Th>
            <Th>Carrier</Th>
            <Th>ETD</Th>
            <Th>ETA</Th>
            <Th>Stage</Th>
            <Th>Next step</Th>
            <Th>Customs</Th>
            <Th>Updates</Th>
            <Th>With</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const w = x(s.id);
            const st = dueState(w.nextDue, false, today);
            return (
              <tr key={s.id} className="border-b border-border last:border-b-0 hover:bg-surface-2">
                <td className="px-2.5 py-2 align-top">
                  <Link to={`/shipments/${s.id}`} className="block font-mono text-[12px] text-text-accent hover:underline">
                    {s.id}
                  </Link>
                  <span className="block font-mono text-[10.5px] text-text-muted">{s.bl_number ?? s.enquiry_ref}</span>
                </td>
                <td className="max-w-[180px] truncate px-2.5 py-2 align-top text-text-primary" title={s.customer?.company || s.customer?.name || ""}>
                  {s.customer?.company || s.customer?.name || "—"}
                </td>
                <td className="whitespace-nowrap px-2.5 py-2 align-top text-text-secondary">{MODE_LABEL[s.transport_mode ?? "none"] ?? s.transport_mode}</td>
                <td className="max-w-[200px] px-2.5 py-2 align-top text-text-secondary">
                  {[s.port_of_loading ?? s.origin, s.port_of_discharge ?? s.destination].filter(Boolean).join(" → ") || "—"}
                </td>
                <td className="whitespace-nowrap px-2.5 py-2 align-top text-text-secondary">
                  {s.carrier || "—"}
                  <span className="block text-[11px] text-text-muted">{s.transport_mode === "air" ? s.flight_number : s.vessel}</span>
                </td>
                <td className="whitespace-nowrap px-2.5 py-2 align-top tabular-nums">{day(s.etd) ?? "—"}</td>
                <td className="whitespace-nowrap px-2.5 py-2 align-top tabular-nums">{day(s.eta) ?? "—"}</td>
                <td className="whitespace-nowrap px-2.5 py-2 align-top">
                  <span className="rounded-full bg-bg-accent px-2 py-0.5 text-[11px] font-medium text-text-accent">{stageLabel(s.stage, s.transport_mode)}</span>
                </td>
                <td className="max-w-[220px] px-2.5 py-2 align-top">
                  {w.nextLabel ? (
                    <>
                      <span className="text-text-primary">{w.nextLabel}</span>
                      {w.nextDue && <span className={`block text-[11px] ${DUE_TONE[st]}`}>{dueText(w.nextDue, false, today)}</span>}
                      {w.overdue > 1 && <span className="block text-[11px] text-text-danger">{w.overdue} overdue</span>}
                    </>
                  ) : (
                    <span className="text-text-muted">Nothing open</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-2.5 py-2 align-top">
                  {w.customs === "none" ? (
                    <span className="text-text-muted">—</span>
                  ) : (
                    <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium ${CUSTOMS_TONE[w.customs]}`}>{CUSTOMS_LABEL[w.customs]}</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-2.5 py-2 align-top">
                  {w.updates > 0 ? (
                    <Link to={`/shipments/${s.id}/tracking`} className="inline-flex items-center gap-1 rounded-full bg-bg-warning px-1.5 py-0.5 text-[11px] font-medium text-text-warning hover:underline">
                      <Radar size={10} /> {w.updates}
                    </Link>
                  ) : (
                    <span className="text-text-muted">—</span>
                  )}
                </td>
                <td className="px-2.5 py-2 align-top">
                  <HandledBy assignedTo={s.assigned_to} people={people} meId={meId} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] transition-colors ${
        active ? "border-brand bg-brand text-white" : "border-border bg-surface-1 text-text-secondary hover:border-border-strong hover:text-text-primary"
      }`}
    >
      {children}
    </button>
  );
}
