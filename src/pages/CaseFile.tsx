import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  Check,
  ChevronLeft,
  Clock,
  FileText,
  IndianRupee,
  Loader2,
  Mail as MailIcon,
  Paperclip,
  PhoneCall,
  Users,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import JobBilling from "../components/JobBilling";
import { ACCOUNTS_DESK, MAIL_ONLY_CASE_FILE } from "../lib/features";
import { listQuotes, type PartnerQuote } from "../services/rfq";
import QuotePanel from "../components/QuotePanel";
import CargoPanel from "../components/CargoPanel";
import PromotePanel from "../components/PromotePanel";
import ConfirmPanel from "../components/ConfirmPanel";
import PartnersPanel from "../components/PartnersPanel";
import PartnerQuotes from "../components/PartnerQuotes";
import DocumentsPanel from "../components/DocumentsPanel";
import { documentDataFromEnquiry } from "../lib/documents";
import AcceptancePanel from "../components/AcceptancePanel";
import {
  correspondenceFor,
  shipmentFor,
  eventsFor,
  getEnquiry,
  partiesFor,
  quotesFor,
  STATUS_LABEL,
  type Customer,
  type Enquiry,
  type EnquiryEvent,
  type FiledMessage,
  type Party,
  type Quote,
  type Shipment,
} from "../services/enquiries";
import { mailIsLive } from "../services/backend";
import { ROLE_LABEL, ROLE_ORDER, type PartyRole } from "../services/caseFile";

/**
 * The sections this file is read in.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS NOT ONE PAGE ANY MORE
 *
 * It was nine panels stacked vertically, and it grew that way honestly — each
 * one was the right thing to add at the time. But the result is a page where
 * the documents are four screens below the cargo, and where somebody who opened
 * it to check a partner's rate scrolls past the quote, the acceptance and the
 * confirmation to get there.
 *
 * WHY A SEARCH PARAMETER AND NOT A NESTED ROUTE
 *
 * The shipment page uses nested routes, because its sections need almost
 * nothing from each other. These nine panels all read the same enquiry, quotes,
 * mail, events and parties, loaded once at the top of this component. Splitting
 * them into routed children would mean threading all of that through an outlet
 * context for no gain — the URL is what matters, and `?section=` puts it in the
 * URL just as well.
 * ---------------------------------------------------------------------------
 */
const SECTIONS = [
  { key: "details", label: "Details" },
  // Partners and the quotation are one section, in that order. You ask the
  // agents for a rate, their replies come back, and the quotation is built from
  // them — putting those on two tabs made the operator hold a figure in their
  // head while they navigated.
  { key: "quote", label: "Partners & quote" },
  { key: "documents", label: "Documents" },
  { key: "billing", label: "Billing" },
  { key: "mail", label: "Correspondence" },
] as const;

type Section = (typeof SECTIONS)[number]["key"];

/**
 * The sections this build actually has.
 *
 * Derived rather than baked in, so `?section=billing` on a build without the
 * accounts desk falls through to the first one still standing instead of
 * rendering a tab strip with nothing under it. The full list above stays as the
 * source of the type.
 */
const VISIBLE_SECTIONS = MAIL_ONLY_CASE_FILE
  ? SECTIONS.filter((s) => s.key === "mail")
  : SECTIONS.filter((s) => s.key !== "billing" || ACCOUNTS_DESK);

/** Where the file opens, and where an unknown `?section=` lands. */
const DEFAULT_SECTION = VISIBLE_SECTIONS[0].key;

/**
 * One enquiry, everything about it.
 *
 * The inbound half of the job lives here: what the customer wants, what is
 * still missing before it can be priced, what was quoted, and whether they said
 * yes. Correspondence and events are the record of how it got there.
 */
export default function CaseFile() {
  const { ref = "" } = useParams();
  const [params, setParams] = useSearchParams();
  // Which board this was opened from, put there by EnquiryLink. Absent when
  // somebody pasted the reference or refreshed the page.
  const cameFrom = (useLocation().state as { from?: string } | null)?.from;
  // A `?section=` naming one this build does not show falls through to the
  // first that it does — rather than to "details", which may not be there.
  const section = (VISIBLE_SECTIONS.find((s) => s.key === params.get("section"))?.key ??
    DEFAULT_SECTION) as Section;
  const goTo = (s: Section) =>
    setParams(
      (p) => {
        p.set("section", s);
        return p;
      },
      { replace: true }
    );
  const { session } = useAuth();
  const mailbox = session?.email ?? "";

  const [enquiry, setEnquiry] = useState<(Enquiry & { customer: Customer | null }) | null>(null);
  const [parties, setParties] = useState<Party[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [events, setEvents] = useState<EnquiryEvent[]>([]);
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [partnerQuotes, setPartnerQuotes] = useState<PartnerQuote[]>([]);
  const [mail, setMail] = useState<FiledMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [view, setView] = useState<"timeline" | "grouped">("timeline");
  const [shown, setShown] = useState<PartyRole[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const e = await getEnquiry(ref);
      setEnquiry(e);
      if (!e) return;

      /*
        The parties, quotes, booking and partner replies feed the sections a
        mail-only build does not render. Fetching them anyway would be four
        round trips per enquiry opened, for four panels nobody can reach — and
        the correspondence, which is the whole screen here, would wait behind
        them. The events are kept: the timeline interleaves them with the mail.
      */
      const [p, q, ev, sh, pq] = await Promise.all([
        MAIL_ONLY_CASE_FILE ? Promise.resolve<Party[]>([]) : partiesFor(ref),
        MAIL_ONLY_CASE_FILE ? Promise.resolve<Quote[]>([]) : quotesFor(ref),
        eventsFor(ref),
        MAIL_ONLY_CASE_FILE ? Promise.resolve<Shipment | null>(null) : shipmentFor(ref),
        // Best-effort: a quotation can still be built if the replies will not
        // load, it just cannot show what each charge costs us.
        MAIL_ONLY_CASE_FILE
          ? Promise.resolve<PartnerQuote[]>([])
          : listQuotes(ref).catch(() => [] as PartnerQuote[]),
      ]);
      setParties(p);
      setQuotes(q);
      setEvents(ev);
      setShipment(sh);
      setPartnerQuotes(pq);
      // Mail is best-effort: a mailbox that will not load must not blank the file.
      setMail(await correspondenceFor(ref, mailbox).catch(() => []));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this enquiry.");
    } finally {
      setLoading(false);
    }
  }, [ref, mailbox]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(
    () =>
      ROLE_ORDER.map((role) => ({ role, items: mail.filter((m) => m.role === role) })).filter(
        (g) => g.items.length
      ),
    [mail]
  );

  const filtering = shown.length > 0;
  const visibleGroups = filtering ? groups.filter((g) => shown.includes(g.role)) : groups;

  const timeline = useMemo(() => {
    const entries = [
      ...mail.map((m) => ({ kind: "mail" as const, at: m.message.receivedDateTime, mail: m })),
      ...events.map((e) => ({ kind: "event" as const, at: e.at, event: e })),
    ];
    return entries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }, [mail, events]);

  if (loading && !enquiry) {
    return <p className="text-[13px] text-text-muted py-8">Loading…</p>;
  }

  if (!enquiry) {
    return (
      <div>
        <Back from={cameFrom} />
        <p className="text-[13px] text-text-muted">
          {error ?? `No enquiry with reference ${ref}.`}
        </p>
      </div>
    );
  }

  const customer = enquiry.customer;

  /**
   * The rate this desk has put to the customer.
   *
   * An accepted quote wins over a sent one — that is the figure the customer
   * agreed to, and a quotation reprinted afterwards must show what was agreed
   * rather than whatever was offered last. Drafts do not count: a rate nobody
   * has been told cannot appear on a document addressed to them.
   */
  const liveQuote =
    quotes.find((q) => q.status === "accepted") ??
    quotes.filter((q) => q.status === "sent").sort((a, b) => b.version - a.version)[0] ??
    null;

  return (
    <div>
      <Back from={cameFrom} />

      {/* ---- header ---- */}
      <div className="card p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="font-mono text-[13px] text-text-accent">{enquiry.ref}</p>
            <h1 className="mt-0.5 text-[19px] font-semibold tracking-tight text-text-primary">
              {customer?.company || customer?.name || "Unknown customer"}
            </h1>
            <p className="mt-0.5 text-[13px] text-text-secondary">
              {customer?.name}
              {enquiry.origin || enquiry.destination
                ? ` · ${[enquiry.origin, enquiry.destination].filter(Boolean).join(" → ")}`
                : ""}
              {enquiry.cargo ? ` · ${enquiry.cargo}` : ""}
            </p>
          </div>
          <div className="text-right">
            <span className="rounded-full bg-bg-accent px-2.5 py-1 text-[11px] font-medium text-text-accent">
              {STATUS_LABEL[enquiry.status]}
            </span>
            <p className="mt-1 text-[11px] text-text-muted capitalize">via {enquiry.source}</p>
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      {/* ---- sections ----
          A strip of one tab is a label pretending to be a control: there is
          nowhere else to go, and it takes a row of height to say so. */}
      <nav
        className={`mt-4 mb-4 flex-wrap gap-1 border-b border-border ${
          VISIBLE_SECTIONS.length > 1 ? "flex" : "hidden"
        }`}
        aria-label="Case file sections"
      >
        {VISIBLE_SECTIONS.map((s) => (
          <button
            key={s.key}
            onClick={() => goTo(s.key)}
            aria-current={section === s.key ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-[13px] transition-colors ${
              section === s.key
                ? "border-brand font-medium text-text-primary"
                : "border-transparent text-text-secondary hover:text-text-primary"
            }`}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {section === "details" && (
        <>
          {/* ---- what we know, and what is still missing ---- */}
          <CargoPanel enquiry={enquiry} onSaved={load} />

          {/*
            The 3D stowage view used to sit here, straight after the
            measurements. It is off the case file while this desk is working
            the mailbox: reading an enquiry and answering it does not need a
            picture of how the cargo fits, and it was the largest thing on the
            page by a distance.

            `components/CargoStowPanel.tsx` is still in the tree and still
            drawing correctly — this is one line to put back. The stowage
            planner on Space & containers is untouched.
          */}

          {/* ---- parties ---- */}
          <section className="mt-4 card p-5">
            <h2 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-text-secondary mb-3">
              <Users size={12} /> Parties
            </h2>
            {!parties.length ? (
              <p className="text-[12px] text-text-muted">
                Nobody recorded yet. Correspondents are added as they appear, and the role is what
                groups their mail below.
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {parties.map((p) => (
                  <div key={p.id} className="rounded-lg bg-surface-2 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-text-muted">
                      {ROLE_LABEL[p.role]}
                    </p>
                    <p className="mt-0.5 text-[13px] text-text-primary">{p.name}</p>
                    {p.organisation && (
                      <p className="text-[11px] text-text-secondary">{p.organisation}</p>
                    )}
                    <p className="mt-0.5 text-[11px] text-text-muted truncate">
                      {p.emails.join(", ")}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {section === "quote" && (
        <>
      {/*
        Who is carrying it, and what they came back with — above the quotation,
        because the quotation is built out of their answers.
      */}
      <PartnersPanel enquiry={enquiry} onChanged={load} />
      <PartnerQuotes enquiry={enquiry} />

      {/* ---- quoting and acceptance ---- */}
      <QuotePanel
        enquiry={enquiry}
        quotes={quotes}
        onChanged={load}
        partnerQuotes={partnerQuotes}
      />

      {/*
        Directly under the quote, because it is the answer to it. A verbal yes
        shows here as unfinished business rather than as an acceptance.
      */}
      <AcceptancePanel enquiry={enquiry} quotes={quotes} mail={mail} onChanged={load} />

      {/* ---- the handover to operations ---- */}
      {/*
        Between quoting and booking, because that is the order it happens in:
        a price is agreed, it is put in writing, and then the shipment starts.

        Shown whether or not a mailbox is connected. Hiding it when Outlook is
        disconnected makes the button look missing rather than unavailable, and
        somebody looking for it has no way to tell which.
      */}
      <ConfirmPanel
        enquiry={enquiry}
        customer={enquiry.customer}
        quotes={quotes}
        mailbox={mailbox}
        fromName={session?.name ?? mailbox}
        signature={session?.signature ?? ""}
        onChanged={load}
      />

      {/*
        The handover to operations, at the end of the section that produces it:
        a price is agreed, it is put in writing, and then the shipment starts.
      */}
      <PromotePanel enquiry={enquiry} shipment={shipment} onChanged={load} />
        </>
      )}


      {/*
        The papers, on the enquiry that produces them.
        ------------------------------------------------------------------
        Only the quotation can be issued at this stage, and only once a rate
        has been quoted — everything after it needs particulars that arrive
        with the booking. The rest sit as drafts naming what they wait for,
        which is the desk's checklist of what still has to be agreed.

        The rate is the one this desk has QUOTED, never a partner's. Those are
        buying prices, and putting one on a customer's quotation sends the
        agent's cost to the shipper.
      */}
      {section === "documents" && (
        <section className="card mt-4 p-5">
          <h2 className="flex items-center gap-2 text-[13px] font-medium text-text-primary">
            <FileText size={13} /> Documents
          </h2>
          <p className="mt-0.5 text-[11.5px] text-text-muted">
            {liveQuote
              ? "The quotation can be issued from the rate on this enquiry. The rest follow the booking."
              : "Quote the customer first — the quotation is issued from that rate."}
          </p>
          <DocumentsPanel
            data={documentDataFromEnquiry(enquiry, customer, liveQuote?.amount_inr ?? null)}
            defaultOpen
          />
        </section>
      )}

      {/*
        Billing, on the enquiry as well as on the shipment.
        ------------------------------------------------------------------
        The same component both places, because it is the same job seen from
        two sides. It needs a shipment to bill against — there is nothing to
        invoice until the customer has accepted and the booking exists — so
        before that it says so rather than showing an empty list.
      */}
      {section === "billing" &&
        (shipment ? (
          <JobBilling shipmentId={shipment.id} onChanged={load} />
        ) : (
          <div className="card p-5">
            <h2 className="text-[13px] font-medium text-text-primary">Nothing to bill yet</h2>
            <p className="mt-1 max-w-prose text-[12px] leading-relaxed text-text-secondary">
              An invoice is raised against a booking, and this enquiry has not become one. Record
              the customer's acceptance on the Quote section and promote it to a shipment; the
              invoice then fills itself in from what was agreed.
            </p>
            <button
              onClick={() => goTo("quote")}
              className="mt-3 inline-flex h-8 items-center rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
            >
              Go to the quote
            </button>
          </div>
        ))}

      {section === "mail" && (
        <>
      {/* ---- correspondence and history ---- */}
      <div className="mt-5 flex items-center gap-2">
        <Toggle active={view === "timeline"} onClick={() => setView("timeline")}>
          <Clock size={13} /> Timeline
        </Toggle>
        <Toggle active={view === "grouped"} onClick={() => setView("grouped")}>
          <MailIcon size={13} /> By party
        </Toggle>
        <span className="ml-auto text-[11px] text-text-muted">
          {mail.length} messages · {events.length} events
        </span>
      </div>

      {view === "grouped" && groups.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Chip active={!filtering} onClick={() => setShown([])}>
            All <span className="opacity-60">{mail.length}</span>
          </Chip>
          {groups.map((g) => (
            <Chip
              key={g.role}
              active={shown.includes(g.role)}
              onClick={() =>
                setShown((prev) =>
                  prev.includes(g.role) ? prev.filter((r) => r !== g.role) : [...prev, g.role]
                )
              }
            >
              {ROLE_LABEL[g.role]} <span className="opacity-60">{g.items.length}</span>
            </Chip>
          ))}
        </div>
      )}

      {!mailIsLive() && (
        <p className="mt-3 text-[12px] text-text-muted">
          Outlook is not connected on this session, so no correspondence is shown. Connect it on
          the Mail page.
        </p>
      )}

      {view === "timeline" ? (
        <ol className="mt-3 space-y-2">
          {timeline.map((entry) =>
            entry.kind === "event" ? (
              <li key={entry.event.id}>
                <div className="card px-4 py-2.5">
                  <div className="flex items-center gap-2 text-[11px] text-text-muted">
                    <EventIcon kind={entry.event.kind} />
                    <span className="uppercase tracking-wide">
                      {entry.event.kind.replace(/_/g, " ")}
                    </span>
                    <span className="ml-auto">{when(entry.at)}</span>
                  </div>
                  <p className="mt-0.5 text-[13px] text-text-primary">{entry.event.summary}</p>
                </div>
              </li>
            ) : (
              <li key={entry.mail.message.id}>
                <MailRow filed={entry.mail} showRole />
              </li>
            )
          )}
          {!timeline.length && (
            <p className="text-[13px] text-text-muted py-6">Nothing recorded yet.</p>
          )}
        </ol>
      ) : (
        <div className="mt-3 space-y-5">
          {visibleGroups.map((g) => (
            <section key={g.role}>
              <h3 className="text-[11px] font-medium uppercase tracking-wide text-text-secondary mb-2">
                {ROLE_LABEL[g.role]} <span className="ml-1 text-text-muted">{g.items.length}</span>
              </h3>
              <div className="space-y-2">
                {g.items.map((f) => (
                  <MailRow key={f.message.id} filed={f} />
                ))}
              </div>
            </section>
          ))}
          {!visibleGroups.length && (
            <p className="text-[13px] text-text-muted py-6">No correspondence in that group.</p>
          )}
        </div>
      )}
        </>
      )}
    </div>
  );
}

/**
 * What the boards are called, for the Back link.
 *
 * Matched on the path without its query, so a filtered board still reads as
 * itself. Anything not listed falls back to a neutral word rather than guessing
 * — "Back" is always true, and a wrong name is worse than a plain one.
 */
const BOARD_NAMES: Record<string, string> = {
  "/my-enquiries": "My enquiries",
  "/enquiries": "Inbound enquiries",
  "/intake": "Enquiries queue",
  "/oversight": "Team oversight",
  "/mail": "Mail",
  "/": "Overview",
  "/documentation": "Documentation",
  "/containers": "Containers",
  "/shipments/in-process": "In-process shipments",
  "/shipments/completed": "Completed shipments",
};

function Back({ from }: { from?: string }) {
  // Nothing in state means the case file was opened cold — a pasted reference,
  // a fresh tab, a refresh. The shared board is the right place to land then,
  // which is what this always did.
  const to = from ?? "/enquiries";
  const label = BOARD_NAMES[to.split("?")[0]] ?? "Back";

  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1 text-[12px] text-text-accent mb-3 hover:underline"
    >
      <ChevronLeft size={14} /> {label}
    </Link>
  );
}

function EventIcon({ kind }: { kind: string }) {
  if (kind === "accepted") return <Check size={12} className="text-text-success" />;
  if (kind === "quote_sent") return <IndianRupee size={12} className="text-text-warning" />;
  if (kind === "mail_linked") return <MailIcon size={12} className="text-text-accent" />;
  if (kind === "created") return <PhoneCall size={12} className="text-text-accent" />;
  return <Clock size={12} />;
}

function MailRow({ filed, showRole = false }: { filed: FiledMessage; showRole?: boolean }) {
  const m = filed.message;
  const outbound = m.folder === "sent";
  const other = outbound
    ? m.toRecipients[0]?.emailAddress.address ?? "—"
    : m.from.emailAddress.name || m.from.emailAddress.address;

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-[11px] text-text-muted flex-wrap">
        <MailIcon size={12} className="text-text-accent" />
        <span className={outbound ? "text-text-secondary" : "text-text-primary font-medium"}>
          {outbound ? `To ${other}` : other}
        </span>
        {showRole && (
          <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px]">
            {ROLE_LABEL[filed.role]}
          </span>
        )}
        {m.hasAttachments && <Paperclip size={11} />}
        {filed.confidence === "likely" && (
          <span className="inline-flex items-center gap-1 rounded bg-bg-warning px-1.5 py-0.5 text-[10px] text-text-warning">
            <AlertCircle size={9} /> matched on {filed.via.replace(/-/g, " ")}
          </span>
        )}
        <span className="ml-auto">{when(m.receivedDateTime)}</span>
      </div>
      <p className="mt-1 text-[13px] font-medium text-text-primary">{m.subject}</p>
      <p className="mt-0.5 text-[12px] text-text-secondary line-clamp-2">{m.bodyPreview}</p>
    </div>
  );
}

function Toggle({
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
      className={`flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-medium border transition-colors ${
        active
          ? "border-border-strong bg-surface-2 text-text-primary"
          : "border-border bg-surface-1 text-text-secondary hover:text-text-primary"
      }`}
    >
      {children}
    </button>
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

export { Loader2 };

function when(iso: string) {
  const d = new Date(iso);
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
