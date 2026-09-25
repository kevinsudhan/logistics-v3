import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import EnquiryLink from "../components/EnquiryLink";
import { AlertCircle, ChevronDown, Inbox, Mail, Paperclip, RefreshCw, Search, ShieldCheck, Users } from "lucide-react";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import Select from "../components/Select";
import OversightLock, { isUnlocked } from "../components/OversightLock";
import { useAuth } from "../lib/auth";
import { formatDate } from "../lib/dates";
import { MAIL_KIND_LABEL, recipientsText, type MailKind } from "../lib/mailLog";
import {
  buildActivity,
  eventLabel,
  PERIOD_LABEL,
  periodRange,
  personOfMail,
  statsFor,
  within,
  type ActivityItem,
  type Period,
} from "../lib/oversight";
import { useTablesChanges } from "../lib/useTableChanges";
import { stepsDoneSince, type Checkpoint } from "../services/checkpoints";
import {
  allEvents,
  arrivedAt,
  eventsSince,
  listEnquiries,
  listPeople,
  listShipments,
  nameOf,
  STATUS_LABEL,
  type Customer,
  type Enquiry,
  type EnquiryEvent,
  type Person,
  type ShipmentRow,
} from "../services/enquiries";
import { listMailLog, mailboxesSeen, syncAllMailboxes, syncSentMail, type MailboxSeen, type MailLogRow } from "../services/mailLog";
import { ListSkeleton } from "../components/Loading";

/**
 * What the desk did, who did it, and who they wrote to — as it happens.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT SHOWS
 *
 *   Activity   one feed of the mail sent, the enquiries opened, taken on,
 *              quoted and booked, and the steps ticked on each job, newest
 *              first and grouped by day
 *   Mail sent  every mail each mailbox sent — to whom, about which job, what
 *              kind — from the CRM or from Outlook alike (086)
 *   People     what each person did in the period and what they are carrying
 *              now: enquiries held, jobs in process, who they wrote to most
 *   Enquiries  when each enquiry arrived, who took it on and how long that took,
 *              with its whole timeline
 *
 * Live: a mail synced in, a step ticked or an enquiry taken on shows here as
 * it happens (084). The period, the person and the search narrow every tab.
 *
 * WHERE THE MAIL COMES FROM
 *
 * Each person's own Sent Items, copied in while they have the CRM open with
 * Outlook connected (services/mailLog.ts). Mail somebody sends while they are
 * not in the CRM arrives the next time they are, so each mailbox says when it
 * was last copied — a quiet mailbox is not taken for an idle person.
 *
 * WHY IT ASKS FOR A PASSWORD, AND WHAT IT DOES NOT DO
 *
 * Being the administrator is enough to reach the page and not enough to open
 * it: the risk is an unlocked laptop in an office where everybody knows
 * everybody. And it does not score anybody — no targets, no ranking, no red
 * badge for being slow. It says what happened and who did it; the numbers are
 * counts, in name order.
 * ---------------------------------------------------------------------------
 */

type Row = Enquiry & { customer: Customer | null };
type Tab = "activity" | "mail" | "people" | "enquiries";

const PERIODS: Period[] = ["today", "yesterday", "7d", "30d", "month"];

const SOURCE_TONE: Record<ActivityItem["source"], string> = {
  mail: "bg-bg-accent text-text-accent border-text-accent/25",
  event: "bg-surface-2 text-text-secondary border-border-strong",
  step: "bg-bg-success text-text-success border-text-success/25",
};

const KIND_TONE: Partial<Record<string, string>> = {
  Quoted: "bg-bg-warning text-text-warning border-text-warning/25",
  Accepted: "bg-bg-success text-text-success border-text-success/25",
  Booked: "bg-bg-success text-text-success border-text-success/25",
  Declined: "bg-bg-danger text-text-danger border-text-danger/25",
  "Taken on": "bg-bg-success text-text-success border-text-success/25",
};

const clock = (iso: string) => formatDate(iso, { hour: "2-digit", minute: "2-digit", hour12: true });
const dayHead = (iso: string) => formatDate(iso, { weekday: "long", day: "numeric", month: "long" });
const stamp = (iso: string | null) => (iso ? formatDate(iso, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: true }) : "—");

function ago(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
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
  const [mails, setMails] = useState<MailLogRow[]>([]);
  const [steps, setSteps] = useState<Checkpoint[]>([]);
  const [ships, setShips] = useState<ShipmentRow[]>([]);
  const [seen, setSeen] = useState<MailboxSeen[]>([]);

  const [period, setPeriod] = useState<Period>("today");
  const [who, setWho] = useState<string>("all");
  const [tab, setTab] = useState<Tab>("activity");
  const [query, setQuery] = useState("");
  const [box, setBox] = useState<string>("all");
  const [kind, setKind] = useState<string>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState(150);

  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Whether this tab has been past the password prompt. */
  const [unlocked, setUnlocked] = useState(isUnlocked);

  const range = useMemo(() => periodRange(period), [period]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = periodRange(period);
      const [list, team, recent, ev, ml, st, sh, sn] = await Promise.all([
        listEnquiries(),
        listPeople(),
        // The latest thousand for the enquiry timelines, and every one in the
        // period for the feed, however many that is.
        allEvents(1000),
        eventsSince(r.from.toISOString()),
        listMailLog(r.from.toISOString(), r.to?.toISOString() ?? null).catch(() => [] as MailLogRow[]),
        stepsDoneSince(r.from.toISOString()).catch(() => [] as Checkpoint[]),
        listShipments().catch(() => [] as ShipmentRow[]),
        mailboxesSeen().catch(() => [] as MailboxSeen[]),
      ]);
      setRows(list);
      setPeople(team);
      const byEventId = new Map([...recent, ...ev].map((e) => [e.id, e]));
      setEvents([...byEventId.values()].sort((a, b) => b.at.localeCompare(a.at)));
      setMails(ml);
      setSteps(st);
      setShips(sh);
      setSeen(sn);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the desk.");
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    if (unlocked) void load();
  }, [load, unlocked]);

  // Live: mail copied in, a step ticked, an enquiry moved — by anybody (084, 086).
  useTablesChanges(
    [
      ["mail_log", null],
      ["mail_log_mailboxes", null],
      ["enquiry_events", null],
      ["shipment_checkpoints", null],
      ["enquiries", null],
      ["shipments", null],
    ],
    (tables) => {
      // A mailbox checked with nothing new moves only its "last checked": every
      // open session does that every few minutes, so it does not reload the lot.
      if (tables.size === 1 && tables.has("mail_log_mailboxes")) void mailboxesSeen().then(setSeen, () => {});
      else void load();
    },
    unlocked && session?.role === "admin"
  );

  useEffect(() => setShown(150), [period, who, query, tab]);

  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const refOfShipment = useMemo(() => new Map(ships.map((s) => [s.id, s.enquiry_ref])), [ships]);

  const feed = useMemo(
    () =>
      buildActivity({
        events,
        mails,
        steps,
        people,
        shipmentRef: (id) => refOfShipment.get(id) ?? null,
        range,
      }),
    [events, mails, steps, people, refOfShipment, range]
  );

  const needle = query.trim().toLowerCase();
  const matches = (...parts: Array<string | null | undefined>) => !needle || parts.some((p) => (p ?? "").toLowerCase().includes(needle));

  const visibleFeed = feed.filter(
    (i) =>
      (who === "all" || i.who === who) &&
      matches(i.text, i.ref, i.label, i.mail?.mailbox, ...(i.mail ? [...i.mail.to_addrs, ...i.mail.cc_addrs].map((r) => `${r.name} ${r.address}`) : []))
  );

  const mailRows = mails
    .filter((m) => within(m.sent_at, range))
    .filter((m) => who === "all" || personOfMail(m, people) === who)
    .filter((m) => box === "all" || m.mailbox === box)
    .filter((m) => kind === "all" || m.kind === kind)
    .filter((m) => matches(m.subject, m.enquiry_ref, m.mailbox, m.preview, ...[...m.to_addrs, ...m.cc_addrs].map((r) => `${r.name} ${r.address}`)))
    .sort((a, b) => b.sent_at.localeCompare(a.sent_at));

  const booked = useMemo(() => new Set(ships.map((s) => s.enquiry_ref)), [ships]);
  const unclaimed = rows.filter((r) => !r.assigned_to && !booked.has(r.ref) && r.status !== "declined" && r.status !== "lost").length;

  const scope = who === "all" ? feed : feed.filter((i) => i.who === who);
  const tiles = {
    mails: scope.filter((i) => i.source === "mail").length,
    takenOn: scope.filter((i) => i.source === "event" && i.label === "Taken on").length,
    quoted: scope.filter((i) => i.source === "event" && i.label === "Quoted").length,
    booked: scope.filter((i) => i.source === "event" && i.label === "Booked").length,
    steps: scope.filter((i) => i.source === "step").length,
  };

  const boxes = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of mails) if (within(r.sent_at, range)) m.set(r.mailbox, (m.get(r.mailbox) ?? 0) + 1);
    for (const s of seen) if (!m.has(s.mailbox)) m.set(s.mailbox, 0);
    return [...m].sort((a, b) => a[0].localeCompare(b[0]));
  }, [mails, seen, range]);

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

  const personName = (id: string | null) => nameOf(byId, id) ?? (id ? "someone" : "the system");

  return (
    <div>
      <PageHeader
        title="Team oversight"
        subtitle="What the desk did, as it happens: the mail each mailbox sent and to whom, the enquiries taken on and quoted, and the steps done on each job."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-[11.5px] text-text-success">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-text-success opacity-40" />
                <span className="relative inline-flex size-2 rounded-full bg-text-success" />
              </span>
              Live
            </span>
            <button
              type="button"
              onClick={() => {
                setSyncing(true);
                // The server for every mailbox, and this session for its own.
                void Promise.all([syncAllMailboxes(), syncSentMail()])
                  .then(() => load())
                  .finally(() => setSyncing(false));
              }}
              disabled={syncing}
              title="Copy every mailbox's sent mail now, rather than wait for the next five-minute run"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary disabled:opacity-60"
            >
              <Mail size={13} className={syncing ? "animate-pulse" : ""} />
              {syncing ? "Copying…" : "Copy sent mail now"}
            </button>
            <button
              onClick={() => void load()}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>
        }
      />

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      {/* ---- the period, the person, the search ---- */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Period">
          {PERIODS.map((p) => (
            <Chip key={p} active={period === p} onClick={() => setPeriod(p)}>
              {PERIOD_LABEL[p]}
            </Chip>
          ))}
        </div>
        <Select
          label="Person"
          value={who}
          onChange={setWho}
          className="w-52"
          options={[{ value: "all", label: "Everyone" }, ...people.map((p) => ({ value: p.id, label: p.full_name?.trim() || p.email, hint: p.email }))]}
        />
        <label className="relative min-w-[200px] flex-1 sm:max-w-sm">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Job, subject, recipient, company…" className="h-8 w-full pl-8" aria-label="Search" />
        </label>
      </div>

      {/* ---- the period in figures ---- */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Mails sent" value={tiles.mails} />
        <Tile label="Enquiries taken on" value={tiles.takenOn} />
        <Tile label="Quotes sent" value={tiles.quoted} />
        <Tile label="Booked" value={tiles.booked} />
        <Tile label="Steps done" value={tiles.steps} />
        <Tile label="Unclaimed now" value={unclaimed} tone={unclaimed ? "warning" : undefined} />
      </div>

      {/* ---- tabs ---- */}
      <nav className="mb-4 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-border" aria-label="Oversight">
        {(
          [
            ["activity", "Activity", visibleFeed.length],
            ["mail", "Mail sent", mailRows.length],
            ["people", "People", people.length],
            ["enquiries", "Enquiries", null],
          ] as Array<[Tab, string, number | null]>
        ).map(([key, label, n]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-[13px] transition-colors ${
              tab === key ? "border-brand font-medium text-text-primary" : "border-transparent text-text-secondary hover:text-text-primary"
            }`}
          >
            {label}
            {n !== null && <span className="ml-1.5 tabular-nums text-text-muted">{n}</span>}
          </button>
        ))}
      </nav>

      {loading && !people.length ? (
        <ListSkeleton />
      ) : tab === "activity" ? (
        <ActivityFeed items={visibleFeed.slice(0, shown)} total={visibleFeed.length} onMore={() => setShown((n) => n + 150)} personName={personName} open={open} setOpen={setOpen} />
      ) : tab === "mail" ? (
        <MailSent
          rows={mailRows}
          boxes={boxes}
          box={box}
          setBox={setBox}
          kind={kind}
          setKind={setKind}
          seen={seen}
          personName={(m) => personName(personOfMail(m, people))}
          seenBy={(id) => personName(id)}
          open={open}
          setOpen={setOpen}
        />
      ) : tab === "people" ? (
        <PeopleView
          people={people}
          feed={feed}
          rows={rows}
          ships={ships}
          booked={booked}
          period={PERIOD_LABEL[period].toLowerCase()}
          onPick={(id) => {
            setWho(id);
            setTab("activity");
          }}
        />
      ) : (
        <EnquiriesView rows={rows} events={events} byId={byId} who={who} needle={needle} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

function ActivityFeed({
  items,
  total,
  onMore,
  personName,
  open,
  setOpen,
}: {
  items: ActivityItem[];
  total: number;
  onMore: () => void;
  personName: (id: string | null) => string;
  open: string | null;
  setOpen: (id: string | null) => void;
}) {
  if (!items.length) {
    return <EmptyState icon={Inbox} title="Nothing in this period" hint="Nothing was sent, taken on, quoted or ticked for this person and period — or it has not been copied in yet." />;
  }
  const days: Array<[string, ActivityItem[]]> = [];
  for (const i of items) {
    const d = dayHead(i.at);
    const last = days[days.length - 1];
    if (last && last[0] === d) last[1].push(i);
    else days.push([d, [i]]);
  }
  return (
    <div className="space-y-4">
      {days.map(([d, list]) => (
        <section key={d}>
          <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-text-secondary">{d}</h3>
          <ol className="card divide-y divide-border overflow-hidden p-0">
            {list.map((i) => {
              const isOpen = open === i.id;
              return (
                <li key={i.id}>
                  <button
                    type="button"
                    onClick={() => i.mail && setOpen(isOpen ? null : i.id)}
                    className={`grid w-full grid-cols-[60px_minmax(0,1fr)] items-start gap-x-3 gap-y-1 px-3 py-2.5 text-left sm:grid-cols-[64px_250px_minmax(0,1fr)] ${i.mail ? "hover:bg-surface-2" : "cursor-default"}`}
                  >
                    <span className="pt-px text-[11.5px] tabular-nums text-text-muted">{clock(i.at)}</span>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-[12px] font-medium text-text-primary sm:w-[110px] sm:shrink-0">{personName(i.who)}</span>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${KIND_TONE[i.label] ?? SOURCE_TONE[i.source]}`}>{i.label}</span>
                    </span>
                    <span className="col-start-2 min-w-0 text-[12.5px] text-text-primary sm:col-start-auto">
                      <span className="break-words">{i.mail ? i.mail.subject || "(no subject)" : i.text}</span>
                      {i.ref && (
                        <EnquiryLink to={`/enquiries/${i.ref}`} className="ml-2 font-mono text-[11px] text-text-accent hover:underline" onClick={(e) => e.stopPropagation()}>
                          {i.ref}
                        </EnquiryLink>
                      )}
                      {i.mail?.has_attachments && <Paperclip size={11} className="ml-1.5 inline text-text-muted" aria-label="With attachments" />}
                      {i.mail && (
                        <span className="mt-0.5 block truncate text-[11.5px] text-text-secondary">
                          <span className="text-text-muted">to </span>
                          {recipientsText(i.mail.to_addrs, 3) || "—"}
                          {i.mail.cc_addrs.length > 0 && <span className="text-text-muted"> · cc {recipientsText(i.mail.cc_addrs, 2)}</span>}
                          <span className="text-text-muted"> · from {i.mail.mailbox}</span>
                        </span>
                      )}
                    </span>
                  </button>
                  {isOpen && i.mail && <MailDetail m={i.mail} />}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
      {total > items.length && (
        <button type="button" onClick={onMore} className="w-full rounded-lg border border-border bg-surface-1 py-2 text-[12px] text-text-secondary hover:text-text-primary">
          Show more ({total - items.length} further)
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mail sent
// ---------------------------------------------------------------------------

function MailSent({
  rows,
  boxes,
  box,
  setBox,
  kind,
  setKind,
  seen,
  personName,
  seenBy,
  open,
  setOpen,
}: {
  rows: MailLogRow[];
  boxes: Array<[string, number]>;
  box: string;
  setBox: (b: string) => void;
  kind: string;
  setKind: (k: string) => void;
  seen: MailboxSeen[];
  personName: (m: MailLogRow) => string;
  seenBy: (id: string | null) => string;
  open: string | null;
  setOpen: (id: string | null) => void;
}) {
  const lastSeen = new Map(seen.map((s) => [s.mailbox, s]));
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <Chip active={box === "all"} onClick={() => setBox("all")}>
          All mailboxes
        </Chip>
        {boxes.map(([b, n]) => (
          <Chip key={b} active={box === b} onClick={() => setBox(b)}>
            {b} <span className="opacity-60">{n}</span>
          </Chip>
        ))}
        <Select
          label="Kind"
          value={kind}
          onChange={setKind}
          className="ml-auto w-52"
          align="right"
          options={[{ value: "all", label: "Every kind" }, ...(Object.keys(MAIL_KIND_LABEL) as MailKind[]).map((k) => ({ value: k, label: MAIL_KIND_LABEL[k] }))]}
        />
      </div>

      {!rows.length ? (
        <EmptyState
          icon={Mail}
          title="No sent mail in this view"
          hint="Mail is copied in from each person's Sent Items while they have the CRM open with Outlook connected. If a mailbox is missing below, its owner has not opened the CRM since."
        />
      ) : (
        <ol className="card divide-y divide-border overflow-hidden p-0">
          {rows.map((m) => {
            const isOpen = open === m.id;
            return (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : m.id)}
                  aria-expanded={isOpen}
                  className="grid w-full gap-x-4 gap-y-1 px-3 py-2.5 text-left hover:bg-surface-2 md:grid-cols-[112px_170px_minmax(0,1fr)_minmax(0,1.2fr)]"
                >
                  <span className="text-[11.5px] tabular-nums text-text-muted">{stamp(m.sent_at)}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-medium text-text-primary">{personName(m)}</span>
                    <span className="block truncate text-[11px] text-text-muted">{m.mailbox}</span>
                  </span>
                  <span className="min-w-0 truncate text-[12px] text-text-secondary" title={[...m.to_addrs, ...m.cc_addrs].map((r) => r.address).join(", ")}>
                    <span className="text-text-muted">To </span>
                    {recipientsText(m.to_addrs, 2) || "—"}
                    {m.cc_addrs.length > 0 && <span className="text-text-muted"> · cc {m.cc_addrs.length}</span>}
                  </span>
                  <span className="min-w-0 text-[12.5px] text-text-primary">
                    <span className="mr-1.5 inline-block rounded-full border border-text-accent/25 bg-bg-accent px-1.5 py-px text-[10.5px] font-medium text-text-accent">{MAIL_KIND_LABEL[m.kind] ?? "Mail"}</span>
                    <span className="break-words">{m.subject || "(no subject)"}</span>
                    {m.enquiry_ref && (
                      <EnquiryLink to={`/enquiries/${m.enquiry_ref}`} className="ml-2 font-mono text-[11px] text-text-accent hover:underline" onClick={(e) => e.stopPropagation()}>
                        {m.enquiry_ref}
                      </EnquiryLink>
                    )}
                    {m.has_attachments && <Paperclip size={11} className="ml-1.5 inline text-text-muted" aria-label="With attachments" />}
                  </span>
                </button>
                {isOpen && <MailDetail m={m} />}
              </li>
            );
          })}
        </ol>
      )}

      <div className="mt-4 rounded-card border border-border bg-surface-1 p-4">
        <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-secondary">Mailboxes being copied in</h3>
        {!seen.length ? (
          <p className="text-[12px] text-text-muted">None yet. The server checks every CRM login&rsquo;s mailbox every five minutes.</p>
        ) : (
          <ul className="space-y-2 text-[12px]">
            {[...lastSeen.values()]
              .sort((a, b) => a.mailbox.localeCompare(b.mailbox))
              .map((s) => {
                // Not checked for a day: its mail is missing here, whatever the reason.
                const stale = !s.synced_at || Date.now() - Date.parse(s.synced_at) > 86_400_000;
                return (
                  <li key={s.mailbox}>
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium text-text-primary">{s.mailbox}</span>
                      <span className={stale ? "text-text-warning" : "text-text-muted"}>
                        {!s.synced_at ? "never checked" : `last checked ${ago(s.synced_at)} ${s.synced_by ? `from ${seenBy(s.synced_by)}’s session` : "by the server"}`}
                      </span>
                    </div>
                    {s.server_error && (
                      <p className="mt-0.5 flex items-start gap-1.5 text-[11.5px] text-text-warning">
                        <AlertCircle size={12} className="mt-px shrink-0" />
                        <span>Server copy: {s.server_error}</span>
                      </p>
                    )}
                  </li>
                );
              })}
          </ul>
        )}
        <p className="mt-2 text-[11px] leading-relaxed text-text-muted">
          Copied from each mailbox&rsquo;s Outlook Sent Items — mail sent from Outlook as well as from the CRM. The server checks every CRM login every five
          minutes; a person&rsquo;s own CRM session also copies theirs just after each send, with Outlook&rsquo;s first lines. Subject and recipients are kept, the
          body is not, and only administrators see other people&rsquo;s mail here.
        </p>
      </div>
    </div>
  );
}

function MailDetail({ m }: { m: Pick<MailLogRow, "to_addrs" | "cc_addrs" | "preview" | "mailbox" | "sent_at"> }) {
  const list = (xs: Array<{ name: string; address: string }>) => xs.map((r) => (r.name && r.name !== r.address ? `${r.name} <${r.address}>` : r.address)).join(", ");
  return (
    <div className="border-t border-border bg-surface-2 px-3 py-2.5 text-[12px] leading-relaxed">
      <p>
        <span className="text-text-muted">From </span>
        {m.mailbox}
        <span className="text-text-muted"> · {formatDate(m.sent_at, { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true })}</span>
      </p>
      <p className="break-words">
        <span className="text-text-muted">To </span>
        {list(m.to_addrs) || "—"}
      </p>
      {m.cc_addrs.length > 0 && (
        <p className="break-words">
          <span className="text-text-muted">Cc </span>
          {list(m.cc_addrs)}
        </p>
      )}
      {m.preview && <p className="mt-1.5 whitespace-pre-line text-text-secondary">{m.preview}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

function PeopleView({
  people,
  feed,
  rows,
  ships,
  booked,
  period,
  onPick,
}: {
  people: Person[];
  feed: ActivityItem[];
  rows: Row[];
  ships: ShipmentRow[];
  booked: Set<string>;
  period: string;
  onPick: (id: string) => void;
}) {
  if (!people.length) return <EmptyState icon={Users} title="Nobody on the desk yet" hint="People appear here once they have an account." />;
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {people.map((p) => {
        const s = statsFor(p.id, feed);
        const held = rows.filter((r) => r.assigned_to === p.id && !booked.has(r.ref) && r.status !== "declined" && r.status !== "lost").length;
        const jobs = ships.filter((j) => j.assigned_to === p.id && j.stage !== "delivered" && j.stage !== "cancelled").length;
        return (
          <button key={p.id} type="button" onClick={() => onPick(p.id)} className="card card-interactive p-4 text-left">
            <div className="flex items-baseline justify-between gap-2">
              <p className="truncate text-[14px] font-medium text-text-primary">{p.full_name?.trim() || p.email}</p>
              <span className="shrink-0 text-[11px] capitalize text-text-muted">{p.role}</span>
            </div>
            <p className="truncate text-[11.5px] text-text-muted">{p.email}</p>

            <p className="mt-3 text-[11px] font-medium uppercase tracking-wide text-text-secondary">{period}</p>
            <dl className="mt-1 grid grid-cols-5 gap-1 text-center">
              <Fig label="Mails" value={s.mails} />
              <Fig label="Taken on" value={s.takenOn} />
              <Fig label="Quoted" value={s.quoted} />
              <Fig label="Booked" value={s.booked} />
              <Fig label="Steps" value={s.steps} />
            </dl>

            <p className="mt-3 text-[12px] text-text-secondary">
              Holding <span className="font-medium text-text-primary">{held}</span> enquir{held === 1 ? "y" : "ies"} and{" "}
              <span className="font-medium text-text-primary">{jobs}</span> job{jobs === 1 ? "" : "s"} in process
            </p>
            {s.domains.length > 0 && (
              <p className="mt-1 truncate text-[12px] text-text-secondary">
                Wrote most to{" "}
                {s.domains
                  .slice(0, 3)
                  .map(([d, n]) => `${d} (${n})`)
                  .join(", ")}
              </p>
            )}
            <p className="mt-1 text-[11.5px] text-text-muted">{s.lastAt ? `Last activity ${ago(s.lastAt)}` : `Nothing recorded ${period === "today" ? "today" : "in this period"}`}</p>
          </button>
        );
      })}
    </div>
  );
}

function Fig({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-surface-2 px-1 py-1.5">
      <dd className="text-[16px] font-medium leading-none tabular-nums text-text-primary">{value}</dd>
      <dt className="mt-1 text-[10px] text-text-muted">{label}</dt>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Enquiries: when each arrived, who took it on, and everything done to it
// ---------------------------------------------------------------------------

function EnquiriesView({ rows, events, byId, who, needle }: { rows: Row[]; events: EnquiryEvent[]; byId: Map<string, Person>; who: string; needle: string }) {
  const [open, setOpen] = useState<string | null>(null);

  const timeline = useMemo(() => {
    const m = new Map<string, EnquiryEvent[]>();
    for (const e of events) m.set(e.enquiry_ref, [...(m.get(e.enquiry_ref) ?? []), e]);
    // Oldest first inside a case: this is a story, and stories run forwards.
    for (const list of m.values()) list.sort((a, b) => a.at.localeCompare(b.at));
    return m;
  }, [events]);

  const visible = [...rows]
    .sort((a, b) => arrivedAt(b).localeCompare(arrivedAt(a)))
    .filter((r) => who === "all" || r.assigned_to === who)
    .filter((r) => !needle || [r.ref, r.origin, r.destination, r.cargo, r.customer?.company, r.customer?.name].filter(Boolean).some((v) => String(v).toLowerCase().includes(needle)));

  if (!visible.length) {
    return <EmptyState title="Nothing to show" hint={rows.length ? "No enquiry matches that filter." : "No enquiries have been opened yet."} />;
  }

  return (
    <div className="space-y-2">
      {visible.map((r) => {
        const list = timeline.get(r.ref) ?? [];
        const isOpen = open === r.ref;
        const wait = gap(arrivedAt(r), r.assigned_at);
        return (
          <article key={r.ref} className="card overflow-hidden">
            <div className="grid gap-x-5 gap-y-3 p-4 md:grid-cols-[minmax(0,1fr)_128px_150px_112px] md:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <EnquiryLink to={`/enquiries/${r.ref}`} className="font-mono text-[12px] text-text-accent hover:underline">
                    {r.ref}
                  </EnquiryLink>
                  <span className="text-[11px] capitalize text-text-muted">via {r.source}</span>
                </div>
                <p className="mt-0.5 truncate text-[14px] font-medium text-text-primary">{r.customer?.company || r.customer?.name || "—"}</p>
                <p className="truncate text-[12px] text-text-secondary">
                  {[r.origin, r.destination].filter(Boolean).join(" → ") || "Route not captured"}
                  {r.cargo ? ` · ${r.cargo}` : ""}
                </p>
              </div>
              <Cell label="Came in">
                <span className="tabular-nums text-text-primary">{stamp(arrivedAt(r))}</span>
              </Cell>
              <Cell label="Taken on">
                {r.assigned_at ? (
                  <>
                    <span className="block tabular-nums text-text-primary">{stamp(r.assigned_at)}</span>
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
                <span className="rounded-full border border-border-strong bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-text-secondary">{STATUS_LABEL[r.status]}</span>
              </div>
            </div>

            <button
              onClick={() => setOpen(isOpen ? null : r.ref)}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between gap-2 border-t border-border px-4 py-2 text-[12px] text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
            >
              {isOpen ? "Hide what was done" : `Everything done on this one${list.length ? ` · ${list.length}` : ""}`}
              <ChevronDown size={13} className={`transition-transform ${isOpen ? "rotate-180" : ""}`} />
            </button>

            {isOpen && (
              <ol className="divide-y divide-border border-t border-border bg-surface-2">
                {!list.length ? (
                  <li className="px-4 py-3 text-[12px] text-text-muted">Nothing has been recorded against this enquiry yet.</li>
                ) : (
                  list.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-start gap-3 px-4 py-2.5">
                      <span className="mt-0.5 shrink-0 rounded-full border border-border-strong bg-surface-1 px-2 py-0.5 text-[11px] font-medium capitalize text-text-secondary">
                        {eventLabel(e.kind)}
                      </span>
                      <span className="min-w-0 flex-1 text-[12px] text-text-primary">{e.summary}</span>
                      <span className="shrink-0 text-[11px] tabular-nums text-text-muted">{stamp(e.at)}</span>
                      <span className="shrink-0 text-[11px] text-text-secondary">{nameOf(byId, e.actor) ?? "the system"}</span>
                    </li>
                  ))
                )}
              </ol>
            )}
          </article>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Tile({ label, value, tone }: { label: string; value: number; tone?: "warning" }) {
  return (
    <div className="card px-3 py-2.5">
      <p className="text-[11px] text-text-secondary">{label}</p>
      <p className={`mt-0.5 text-[20px] font-medium leading-tight tabular-nums ${tone === "warning" ? "text-text-warning" : "text-text-primary"}`}>{value}</p>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] transition-colors ${
        active ? "border-brand bg-brand text-white" : "border-border bg-surface-1 text-text-secondary hover:border-border-strong hover:text-text-primary"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * One labelled figure in a row. The label is repeated on every row rather than
 * sat once in a header, because below `md` the grid collapses to a stack.
 */
function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 text-[11px]">
      <p className="text-text-secondary">{label}</p>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}
