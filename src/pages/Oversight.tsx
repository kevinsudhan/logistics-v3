import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import EnquiryLink from "../components/EnquiryLink";
import { AlertCircle, ChevronDown, RefreshCw, Search, ShieldCheck } from "lucide-react";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import Select from "../components/Select";
import OversightLock, { isUnlocked } from "../components/OversightLock";
import { useAuth } from "../lib/auth";
import {
  allEvents,
  arrivedAt,
  listEnquiries,
  listPeople,
  nameOf,
  STATUS_LABEL,
  type Customer,
  type Enquiry,
  type EnquiryEvent,
  type Person,
} from "../services/enquiries";
import { ListSkeleton } from "../components/Loading";

/**
 * What the desk did, and who did it.
 *
 * ---------------------------------------------------------------------------
 * TWO TIMES, NOT ONE
 *
 * The figure this page exists for is the gap between when an enquiry arrived
 * and when somebody took it on. Either number alone says nothing. Arrived at
 * nine is a fact about the customer; claimed at ten past is a fact about the
 * desk; the distance between them is the only thing that tells you whether the
 * desk is keeping up.
 *
 * So every row carries both, and the wait between them is computed rather than
 * left for the reader to subtract.
 *
 * WHY IT ASKS FOR A PASSWORD
 *
 * Being the administrator is enough to reach the page and not enough to open
 * it. The risk this answers is an unlocked laptop in an office where everybody
 * knows everybody, so the second factor is something you know rather than
 * something your session already proves. It is deliberately not a boundary
 * around the data: these rows are readable by any signed-in employee, because a
 * desk where one operator cannot see another's work does not function.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not score anybody. There is no target time, no red badge for being
 * slow, and no league table, because none of those exist in this business and
 * inventing them here would put a number in front of a manager that nothing
 * downstream can justify. It shows what happened and who did it, in order.
 *
 * The timeline under each row is the enquiry's own event log — the same rows
 * the case file shows, written by the same code paths that change the record.
 * Nothing on this page is a separate audit trail that could drift from it.
 * ---------------------------------------------------------------------------
 */

type Row = Enquiry & { customer: Customer | null };

/** How the timeline reads, and in whose colour. */
const EVENT_STYLE: Record<string, { label: string; className: string }> = {
  created: { label: "Opened", className: "bg-bg-accent text-text-accent border-text-accent/25" },
  promoted_from_intake: { label: "From queue", className: "bg-bg-accent text-text-accent border-text-accent/25" },
  assigned: { label: "Taken on", className: "bg-bg-success text-text-success border-text-success/25" },
  unassigned: { label: "Put back", className: "bg-surface-2 text-text-secondary border-border-strong" },
  field_updated: { label: "Updated", className: "bg-surface-2 text-text-secondary border-border-strong" },
  mail_linked: { label: "Mail linked", className: "bg-surface-2 text-text-secondary border-border-strong" },
  quote_sent: { label: "Quoted", className: "bg-bg-warning text-text-warning border-text-warning/25" },
  verbal_accept: { label: "Verbal yes", className: "bg-bg-warning text-text-warning border-text-warning/25" },
  accepted: { label: "Accepted", className: "bg-bg-success text-text-success border-text-success/25" },
  declined: { label: "Declined", className: "bg-bg-danger text-text-danger border-text-danger/25" },
  promoted: { label: "In process", className: "bg-bg-success text-text-success border-text-success/25" },
  partner_assigned: { label: "Partner", className: "bg-surface-2 text-text-secondary border-border-strong" },
};

function stamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** The wait between two moments, said the way a person would say it. */
function gap(from: string | null, to: string | null): string | null {
  if (!from || !to) return null;
  const mins = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60000);
  if (!Number.isFinite(mins) || mins < 0) return null;
  if (mins < 60) return `${mins} min`;
  const hrs = mins / 60;
  if (hrs < 24) return `${hrs.toFixed(hrs < 10 ? 1 : 0)} hr`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

export default function Oversight() {
  const { session } = useAuth();

  const [rows, setRows] = useState<Row[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [events, setEvents] = useState<EnquiryEvent[]>([]);
  const [who, setWho] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Whether this tab has been past the password prompt. */
  const [unlocked, setUnlocked] = useState(isUnlocked);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, team, ev] = await Promise.all([listEnquiries(), listPeople(), allEvents(500)]);
      setRows(list);
      setPeople(team);
      setEvents(ev);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the desk.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (unlocked) void load();
  }, [load, unlocked]);

  /** Events keyed by reference, so opening a row is a map read. */
  const timeline = useMemo(() => {
    const m = new Map<string, EnquiryEvent[]>();
    for (const e of events) {
      const list = m.get(e.enquiry_ref) ?? [];
      list.push(e);
      m.set(e.enquiry_ref, list);
    }
    // Oldest first inside a case: this is a story, and stories run forwards.
    for (const list of m.values()) list.sort((a, b) => a.at.localeCompare(b.at));
    return m;
  }, [events]);

  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...rows]
      .sort((a, b) => arrivedAt(b).localeCompare(arrivedAt(a)))
      .filter((r) =>
        who === "all" ? true : who === "none" ? !r.assigned_to : r.assigned_to === who
      )
      .filter((r) =>
        !needle
          ? true
          : [r.ref, r.origin, r.destination, r.cargo, r.customer?.company, r.customer?.name]
              .filter(Boolean)
              .some((v) => String(v).toLowerCase().includes(needle))
      );
  }, [rows, who, query]);

  /** One line per person: how much they hold, and how quickly they pick up. */
  const perPerson = useMemo(() => {
    return people
      .map((p) => {
        const held = rows.filter((r) => r.assigned_to === p.id);
        const waits = held
          .map((r) =>
            r.assigned_at
              ? (new Date(r.assigned_at).getTime() - new Date(arrivedAt(r)).getTime()) / 60000
              : null
          )
          .filter((n): n is number => n !== null && n >= 0);
        const median =
          waits.length === 0
            ? null
            : [...waits].sort((a, b) => a - b)[Math.floor(waits.length / 2)];
        return { person: p, held: held.length, median };
      })
      .filter((r) => r.held > 0)
      .sort((a, b) => b.held - a.held);
  }, [people, rows]);

  const unclaimed = rows.filter((r) => !r.assigned_to).length;

  if (session?.role !== "admin") {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="Administrators only"
        hint="This page shows what everyone on the desk has been doing. Your account is signed in as an employee."
      />
    );
  }

  // Two locks, in order. The role decides who may ask; the password decides
  // whether this particular sitting at this particular laptop gets in.
  if (!unlocked) {
    return <OversightLock onUnlocked={() => setUnlocked(true)} />;
  }

  return (
    <div>
      <PageHeader
        title="Team oversight"
        subtitle="Every enquiry, when it arrived, who took it on and how long that took. Open one to read everything that has been done to it."
        action={
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-surface-1 text-[12px] text-text-secondary hover:text-text-primary hover:border-border-strong transition-colors"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        }
      />

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      {/* ---- who is carrying what ---- */}
      {perPerson.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-5">
          {perPerson.map(({ person, held, median }) => (
            <div key={person.id} className="card p-4">
              <p className="text-[13px] font-medium text-text-primary truncate">
                {person.full_name?.trim() || person.email}
              </p>
              <p className="text-[11px] text-text-muted capitalize">{person.role}</p>
              <p className="mt-2 text-2xl leading-none font-medium text-text-primary tabular-nums">
                {held}
              </p>
              <p className="mt-1 text-[11px] text-text-muted">
                {held === 1 ? "enquiry held" : "enquiries held"}
                {median !== null &&
                  ` · typically picked up in ${
                    median < 60 ? `${Math.round(median)} min` : `${(median / 60).toFixed(1)} hr`
                  }`}
              </p>
            </div>
          ))}
          {unclaimed > 0 && (
            <div className="card border-dashed p-4">
              <p className="text-[13px] font-medium text-text-primary">Nobody</p>
              <p className="text-[11px] text-text-muted">Still on the shared board</p>
              <p className="mt-2 text-2xl leading-none font-medium text-text-warning tabular-nums">
                {unclaimed}
              </p>
              <p className="mt-1 text-[11px] text-text-muted">unclaimed</p>
            </div>
          )}
        </div>
      )}

      {/* ---- filters ---- */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Reference, customer, route…"
            className="w-full pl-8 h-8"
          />
        </div>
        <Select
          label="Filter by who took it on"
          value={who}
          onChange={setWho}
          className="w-56"
          options={[
            { value: "all", label: "Everyone", hint: `${rows.length} enquiries` },
            { value: "none", label: "Unclaimed", hint: `${unclaimed} waiting for somebody` },
            ...people.map((p) => ({
              value: p.id,
              label: p.full_name?.trim() || p.email,
              // How many they hold, so choosing a name is an informed press
              // rather than a guess followed by an empty list.
              hint: `${rows.filter((r) => r.assigned_to === p.id).length} held`,
            })),
          ]}
        />
      </div>

      {loading && !rows.length ? (
        <ListSkeleton />
      ) : !visible.length ? (
        <EmptyState
          title="Nothing to show"
          hint={
            rows.length
              ? "No enquiry matches that filter."
              : "No enquiries have been opened yet. They appear here the moment one is pushed through from the queue."
          }
        />
      ) : (
        <div className="space-y-2">
          {visible.map((r) => {
            const events = timeline.get(r.ref) ?? [];
            const isOpen = open === r.ref;
            const wait = gap(arrivedAt(r), r.assigned_at);

            return (
              <article key={r.ref} className="card overflow-hidden">
                {/*
                  A grid, not a wrapped flex row. The columns are the same width
                  on every row, so the eye can run down "taken on" without
                  re-finding it each time — which is the whole reason to read a
                  list like this rather than open each enquiry.
                */}
                <div className="grid gap-x-5 gap-y-3 p-4 md:grid-cols-[minmax(0,1fr)_128px_150px_112px] md:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <EnquiryLink
                        to={`/enquiries/${r.ref}`}
                        className="font-mono text-[12px] text-text-accent hover:underline"
                      >
                        {r.ref}
                      </EnquiryLink>
                      <span className="text-[11px] text-text-muted capitalize">via {r.source}</span>
                    </div>
                    <p className="mt-0.5 text-[14px] font-medium text-text-primary truncate">
                      {r.customer?.company || r.customer?.name || "—"}
                    </p>
                    <p className="text-[12px] text-text-secondary truncate">
                      {[r.origin, r.destination].filter(Boolean).join(" → ") || "Route not captured"}
                      {r.cargo ? ` · ${r.cargo}` : ""}
                    </p>
                  </div>

                  <Cell label="Came in">
                    <span className="text-text-primary tabular-nums">{stamp(arrivedAt(r))}</span>
                  </Cell>

                  <Cell label="Taken on">
                    {r.assigned_at ? (
                      <>
                        <span className="block text-text-primary tabular-nums">
                          {stamp(r.assigned_at)}
                        </span>
                        <span className="block truncate text-text-secondary">
                          {nameOf(byId, r.assigned_to) ?? "someone"}
                          {wait && <span className="text-text-muted"> · after {wait}</span>}
                        </span>
                      </>
                    ) : (
                      <span className="text-text-warning">Nobody yet</span>
                    )}
                  </Cell>

                  <div className="md:text-right">
                    <span className="rounded-full border border-border-strong bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-text-secondary">
                      {STATUS_LABEL[r.status]}
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => setOpen(isOpen ? null : r.ref)}
                  aria-expanded={isOpen}
                  className="w-full flex items-center justify-between gap-2 border-t border-border px-4 py-2 text-[12px] text-text-secondary hover:bg-surface-2 hover:text-text-primary transition-colors"
                >
                  {isOpen
                    ? "Hide what was done"
                    : `Everything done on this one${events.length ? ` · ${events.length}` : ""}`}
                  <ChevronDown
                    size={13}
                    className={`transition-transform ${isOpen ? "rotate-180" : ""}`}
                  />
                </button>

                {isOpen && (
                  <ol className="divide-y divide-border border-t border-border bg-surface-2">
                    {!events.length ? (
                      <li className="px-4 py-3 text-[12px] text-text-muted">
                        Nothing has been recorded against this enquiry yet.
                      </li>
                    ) : (
                      events.map((e) => {
                        const style = EVENT_STYLE[e.kind] ?? {
                          label: e.kind.replace(/_/g, " "),
                          className: "bg-surface-1 text-text-secondary border-border-strong",
                        };
                        return (
                          <li key={e.id} className="flex flex-wrap items-start gap-3 px-4 py-2.5">
                            <span
                              className={`mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize ${style.className}`}
                            >
                              {style.label}
                            </span>
                            <span className="min-w-0 flex-1 text-[12px] text-text-primary">
                              {e.summary}
                            </span>
                            <span className="shrink-0 text-[11px] text-text-muted tabular-nums">
                              {stamp(e.at)}
                            </span>
                            <span className="shrink-0 text-[11px] text-text-secondary">
                              {nameOf(byId, e.actor) ?? "the system"}
                            </span>
                          </li>
                        );
                      })
                    )}
                  </ol>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * One labelled figure in a row.
 *
 * The label is repeated on every row rather than sat once in a header, because
 * below `md` the grid collapses to a stack and a column header two hundred
 * pixels up stops explaining anything.
 */
function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 text-[11px]">
      <p className="text-text-secondary">{label}</p>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}
