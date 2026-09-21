import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import EnquiryLink from "../components/EnquiryLink";
import {
  AlertCircle,
  Check,
  Inbox,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Send,
  Truck,
} from "lucide-react";
import AssignContainer from "../components/AssignContainer";
import { quoteProgress, type QuoteProgress } from "../services/rfq";
import PageHeader from "../components/PageHeader";
import NewEnquiry from "../components/NewEnquiry";
import PushMailToQueue from "../components/PushMailToQueue";
import AssignControl from "../components/AssignControl";
import { useAuth } from "../lib/auth";
import { failureText, type FailureText } from "../lib/errorText";
import {
  listEnquiries,
  listPeople,
  listShipments,
  nameOf,
  promoteToShipment,
  unfiledMail,
  STATUS_LABEL,
  INBOUND_STATUSES,
  type Customer,
  type Enquiry,
  type EnquiryStatus,
  type Person,
  type Shipment,
} from "../services/enquiries";
import { mailIsLive, type MailMessage } from "../services/backend";
import { intakeByMessage, type Intake } from "../services/intake";

type Row = Enquiry & { customer: Customer | null };

/** Matches StatusPill's treatment: a light fill inside a hairline of its hue. */
const STATUS_TONE: Record<EnquiryStatus, string> = {
  new: "bg-bg-accent text-text-accent border-text-accent/25",
  qualifying: "bg-bg-accent text-text-accent border-text-accent/25",
  quoted: "bg-bg-warning text-text-warning border-text-warning/25",
  accepted: "bg-bg-success text-text-success border-text-success/25",
  declined: "bg-surface-2 text-text-secondary border-border-strong",
  lost: "bg-surface-2 text-text-muted border-border-strong",
};

/** How long ago, in the shortest form that is still exact enough to act on. */
function when(iso: string | null): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/**
 * The inbound pipeline.
 *
 * Everything here is real: an enquiry exists because somebody opened one from
 * an email or entered it by hand. There are no sample rows, so an empty desk
 * looks empty -- which is the honest thing for it to look like.
 */
export default function Enquiries() {
  const { session } = useAuth();
  const mailbox = session?.email ?? "";

  const [rows, setRows] = useState<Row[]>([]);
  const [unfiled, setUnfiled] = useState<MailMessage[]>([]);
  /**
   * The search term is held in the URL, not only in this component.
   *
   * The topbar search submits to `/enquiries?q=…`, so the term has to survive
   * arriving here from another page. Keeping it in the query string also makes a
   * filtered list something you can send to a colleague, and puts back-button
   * behaviour where a reader expects it.
   */
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const setQuery = (next: string) => {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (next) p.set("q", next);
        else p.delete("q");
        return p;
      },
      { replace: true }
    );
  };
  const [filter, setFilter] = useState<EnquiryStatus | "all">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<FailureText | null>(null);
  const [creating, setCreating] = useState(false);
  /** What the queue already knows about the messages in the triage list. */
  /**
   * How the partner asks are going, per enquiry.
   *
   * One query for the whole board rather than one per row: the board shows
   * forty enquiries and this is a line of text on each of them.
   */
  const [progress, setProgress] = useState<Map<string, QuoteProgress>>(new Map());
  const [queued, setQueued] = useState<Map<string, Pick<Intake, "id" | "status" | "enquiry_ref">>>(
    new Map()
  );
  /** Which enquiries already have a shipment, so the row shows the right thing. */
  const [shipped, setShipped] = useState<Map<string, Shipment>>(new Map());
  const [people, setPeople] = useState<Person[]>([]);
  /** Whose work to show. The board itself never hides a row from anybody. */
  const [owner, setOwner] = useState<"all" | "mine" | "free">("all");
  const [pushing, setPushing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, ships, team] = await Promise.all([
        listEnquiries(),
        listShipments(),
        listPeople(),
      ]);
      setRows(list);
      setPeople(team);
      // One read for the whole board. Failing it should not blank the board —
      // the progress line is useful, and the enquiries are the page.
      void quoteProgress(list.map((r) => r.ref))
        .then(setProgress)
        .catch(() => setProgress(new Map()));
      setShipped(new Map(ships.map((s) => [s.enquiry_ref, s])));
      // Triage only makes sense once a mailbox is connected.
      const mail = mailIsLive() ? await unfiledMail(mailbox) : [];
      setUnfiled(mail);
      setQueued(await intakeByMessage(mail.map((m) => m.id)));
    } catch (e) {
      setError(failureText(e, "Could not load enquiries."));
    } finally {
      setLoading(false);
    }
  }, [mailbox]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows
      .filter((r) => filter === "all" || r.status === filter)
      .filter((r) =>
        owner === "all"
          ? true
          : owner === "mine"
            ? r.assigned_to === session?.userId
            : !r.assigned_to
      )
      .filter((r) =>
        !needle
          ? true
          : [r.ref, r.origin, r.destination, r.cargo, r.customer?.name, r.customer?.company]
              .filter(Boolean)
              .some((v) => String(v).toLowerCase().includes(needle))
      );
  }, [rows, query, filter, owner, session?.userId]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const s of INBOUND_STATUSES) c[s] = rows.filter((r) => r.status === s).length;
    return c;
  }, [rows]);

  /**
   * Pushing from the list rather than the case file.
   *
   * The guard is unchanged -- the database refuses without an accepted quote --
   * but somebody working through a morning's enquiries should not have to open
   * each one to move it on.
   */
  async function push(ref: string) {
    setPushing(ref);
    setError(null);
    try {
      await promoteToShipment(ref);
      await load();
    } catch (e) {
      setError(failureText(e, "Could not start the shipment."));
    } finally {
      setPushing(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Inbound enquiries"
        subtitle="Every enquiry from first contact to the customer's acceptance, under a reference of ours."
      />

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-brand hover:bg-brand-dark text-white text-[12px] font-medium"
        >
          <Plus size={13} />
          New enquiry
        </button>

        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Reference, customer, route, cargo…"
            className="w-full pl-8 h-8"
          />
        </div>

        <button
          onClick={() => void load()}
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-surface-1 text-[12px] text-text-secondary hover:text-text-primary"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Two rows of filters, because they answer different questions: whose is
          this, and how far along is it. Collapsing them into one list would
          make "mine" and "quoted" look mutually exclusive. */}
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        {(
          [
            ["all", "Everyone"],
            ["mine", "Mine"],
            ["free", "Unclaimed"],
          ] as const
        ).map(([key, label]) => (
          <Chip key={key} active={owner === key} onClick={() => setOwner(key)}>
            {label}{" "}
            <span className="opacity-60">
              {key === "all"
                ? rows.length
                : key === "mine"
                  ? rows.filter((r) => r.assigned_to === session?.userId).length
                  : rows.filter((r) => !r.assigned_to).length}
            </span>
          </Chip>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        <Chip active={filter === "all"} onClick={() => setFilter("all")}>
          All <span className="opacity-60">{counts.all}</span>
        </Chip>
        {INBOUND_STATUSES.map((s) => (
          <Chip key={s} active={filter === s} onClick={() => setFilter(s)}>
            {STATUS_LABEL[s]} <span className="opacity-60">{counts[s] ?? 0}</span>
          </Chip>
        ))}
      </div>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          <span>
            {error.message}
            {/* The half people act on — see src/lib/errorText.ts. */}
            {error.hint && <span className="block mt-1 opacity-80">{error.hint}</span>}
          </span>
        </div>
      )}

      {loading && !rows.length ? (
        <p className="text-[13px] text-text-muted py-8">Loading…</p>
      ) : !rows.length ? (
        /**
         * An empty desk looks empty. Seeding sample enquiries would make the
         * pipeline appear busy and teach nobody whether any of it works.
         */
        <div className="rounded-card border border-dashed border-border-strong bg-surface-1 p-10 text-center">
          <Inbox size={20} className="mx-auto text-text-muted" />
          <p className="mt-2 text-[14px] font-medium text-text-primary">No enquiries yet</p>
          <p className="mt-1 text-[13px] text-text-secondary max-w-md mx-auto">
            One arrives here when something in the enquiries queue is pushed through, or when you
            open one by hand. Nothing here is sample data.
          </p>
          <button
            onClick={() => setCreating(true)}
            className="mt-4 inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-brand hover:bg-brand-dark text-white text-[12px] font-medium"
          >
            <Plus size={13} />
            New enquiry
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((r) => (
            <EnquiryLink
              key={r.ref}
              to={`/enquiries/${r.ref}`}
              className="block card p-4 hover:border-border-strong transition-colors"
            >
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <p className="font-mono text-[12px] text-text-accent">{r.ref}</p>
                  <p className="mt-0.5 text-[14px] font-medium text-text-primary">
                    {r.customer?.company || r.customer?.name || "—"}
                  </p>
                  <p className="text-[12px] text-text-secondary">
                    {[r.origin, r.destination].filter(Boolean).join(" → ") || "Route not captured"}
                    {r.cargo ? ` · ${r.cargo}` : ""}
                    {r.volume_cbm ? ` · ${r.volume_cbm} CBM` : ""}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_TONE[r.status]}`}
                  >
                    {STATUS_LABEL[r.status]}
                  </span>
                  <p className="mt-1 text-[11px] text-text-muted capitalize">via {r.source}</p>
                  {r.assigned_to && r.assigned_at && (
                    <p className="text-[11px] text-text-muted">
                      Taken {when(r.assigned_at)}
                      {r.assigned_to !== session?.userId && ` by ${nameOf(people, r.assigned_to) ?? "a colleague"}`}
                    </p>
                  )}
                </div>
              </div>

              {/*
                Who is handling it, and what it is travelling on — the two
                assignments a row carries, on one line. They are different
                questions with the same shape of answer, so putting them in
                separate strips would have made the board taller to say less.
              */}
              <div
                className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-3"
                onClick={(e) => {
                  // The whole row is a link into the case file. Assigning is
                  // not navigation, and neither control should open it.
                  e.preventDefault();
                  e.stopPropagation();
                }}
              >
                <AssignControl
                  enquiryRef={r.ref}
                  assignedTo={r.assigned_to}
                  people={people}
                  meId={session?.userId ?? ""}
                  isAdmin={session?.role === "admin"}
                  onChanged={() => void load()}
                  compact
                />
                <AssignContainer
                  enquiryRef={r.ref}
                  current={r.sailing_id}
                  onChanged={() => void load()}
                />

                {/*
                  Where the partner asks have got to, without opening the case.
                  ------------------------------------------------------------
                  Shown only for enquiries that have actually been asked about.
                  A row reading "0 partners asked" on every untouched enquiry is
                  a column of noise saying nothing has happened yet, which is
                  already visible from the fact that nothing has happened.
                */}
                {(() => {
                  const p = progress.get(r.ref);
                  if (!p?.asked) return null;
                  return (
                    <span className="inline-flex flex-wrap items-center gap-1.5 text-[11.5px]">
                      <Send size={11} className="text-text-muted" />
                      {p.waiting > 0 && (
                        <span className="rounded-full border border-border bg-surface-2 px-2 py-0.5 text-text-secondary">
                          {p.waiting} waiting
                        </span>
                      )}
                      {p.quoted > 0 && (
                        <span className="rounded-full border border-text-success/25 bg-bg-success px-2 py-0.5 font-medium text-text-success">
                          {p.quoted} quoted
                          {p.best != null &&
                            ` · ${p.currency ? p.currency + " " : ""}${p.best.toLocaleString("en-IN")}`}
                        </span>
                      )}
                      {p.declined > 0 && (
                        <span className="rounded-full border border-border bg-surface-2 px-2 py-0.5 text-text-muted">
                          {p.declined} declined
                        </span>
                      )}
                    </span>
                  );
                })()}
              </div>

              {/*
                Only on an accepted enquiry -- and "accepted" now means confirmed
                in writing, so a call-only yes deliberately does not qualify.
              */}
              {r.status === "accepted" && (
                <div className="mt-3 pt-3 border-t border-border flex items-center gap-2">
                  {shipped.has(r.ref) ? (
                    <span className="inline-flex items-center gap-1.5 text-[12px] text-text-success">
                      <Truck size={13} />
                      In process as{" "}
                      <span className="font-mono">{shipped.get(r.ref)!.id}</span>
                    </span>
                  ) : (
                    <button
                      onClick={(e) => {
                        // The row is a link; pushing is not navigation.
                        e.preventDefault();
                        e.stopPropagation();
                        void push(r.ref);
                      }}
                      disabled={pushing !== null}
                      className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-brand hover:bg-brand-dark disabled:opacity-60 text-white text-[12px] font-medium"
                    >
                      {pushing === r.ref ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Check size={12} />
                      )}
                      Push to in-process shipments
                    </button>
                  )}
                </div>
              )}
            </EnquiryLink>
          ))}
          {!visible.length && (
            <p className="text-[13px] text-text-muted py-6">Nothing matches that.</p>
          )}
        </div>
      )}

      {/* ---- triage ---- */}
      <section className="mt-8">
        <h2 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-text-secondary mb-2">
          <AlertCircle size={12} className="text-text-warning" />
          Inbox, not yet on an enquiry
          {unfiled.length > 0 && <span className="text-text-muted">{unfiled.length}</span>}
        </h2>
        <p className="mb-2 text-[12px] text-text-secondary">
          Sending one of these on puts it in the{" "}
          <Link to="/intake" className="text-text-accent hover:underline">
            enquiries queue
          </Link>
          , where it is pushed through to a reference once somebody has read it.
        </p>

        {!mailIsLive() ? (
          <p className="text-[12px] text-text-muted">
            Connect Outlook on the Mail page to triage incoming enquiries here.
          </p>
        ) : !unfiled.length ? (
          <p className="text-[12px] text-text-muted">
            Nothing waiting — every message in {mailbox} is either filed or not shipment mail.
          </p>
        ) : (
          <div className="space-y-2">
            {unfiled.map((m) => (
              <div
                key={m.id}
                className="card p-3 flex items-start gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[11px] text-text-muted">
                    <span className="text-text-primary">
                      {m.from.emailAddress.name || m.from.emailAddress.address}
                    </span>
                    <span className="truncate">{m.from.emailAddress.address}</span>
                  </div>
                  <p className="mt-0.5 text-[13px] text-text-primary">{m.subject}</p>
                  <p className="text-[12px] text-text-secondary line-clamp-1">{m.bodyPreview}</p>
                </div>
                {/*
                  This used to allocate a reference on the press. Mail now goes
                  the same way as everything else — into the queue — so there is
                  one front door rather than two behaving differently.
                */}
                <div className="shrink-0">
                  <PushMailToQueue message={m} queued={queued.get(m.id)} onChanged={() => void load()} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {creating && (
        <NewEnquiry
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            void load();
          }}
        />
      )}
    </div>
  );
}

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
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[12px] border transition-colors ${
        active
          ? "border-brand bg-brand text-white"
          : "border-border bg-surface-1 text-text-secondary hover:text-text-primary hover:border-border-strong"
      }`}
    >
      {children}
    </button>
  );
}
