import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { sectionsFor, type Section } from "../lib/caseFileSections";
import { listQuotes, type PartnerQuote } from "../services/rfq";
import QuotePanel from "../components/QuotePanel";
import PromotePanel from "../components/PromotePanel";
import ConfirmPanel from "../components/ConfirmPanel";
import PartnersPanel from "../components/PartnersPanel";
import PartnerQuotes from "../components/PartnerQuotes";
import DocumentsPanel from "../components/DocumentsPanel";
import { documentDataFromEnquiry } from "../lib/documents";
import {
  attachablesFrom,
  liveQuoteOf,
} from "../lib/attachableDocuments";
import type { Attachable } from "../components/MailAttachments";
import AcceptancePanel from "../components/AcceptancePanel";
import BookingParticularsPanel, { PARTICULAR_KEYS } from "../components/BookingParticularsPanel";
import CargoDetailsPanel, { DG_KEYS } from "../components/CargoDetailsPanel";
import DimensionsPanel from "../components/DimensionsPanel";
import MailFillBar from "../components/MailFillBar";
import { listDimensions } from "../services/enquiryDimensions";
import { ownedByLines, type DimensionLine } from "../lib/dimensions";
import Collapsible from "../components/Collapsible";
import CustomerDetailsPanel from "../components/CustomerDetailsPanel";
import ServiceDetailsPanel from "../components/ServiceDetailsPanel";
import EnquiryWorkflow from "../components/EnquiryWorkflow";
import { CARGO_KEYS, fillFromNewMail, type AutoFilled } from "../services/autoFill";
import ThreadReader from "../components/ThreadReader";
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
 * Everything a reading of the mail may write on this page, less whatever the
 * dimension lines already own. One list, used by the automatic fill and the
 * "read the mail again" button alike, so they cannot disagree.
 */
function fillKeysFor(lines: DimensionLine[]): string[] {
  const owned = new Set(ownedByLines(lines));
  return [...new Set([...CARGO_KEYS, ...DG_KEYS, ...PARTICULAR_KEYS])].filter((k) => !owned.has(k));
}

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
  const [dims, setDims] = useState<DimensionLine[]>([]);
  // What the correspondence filled in on its own this time round. Null when
  // nothing arrived since the last reading, or when what arrived answered
  // nothing that was still blank.
  const [autoFilled, setAutoFilled] = useState<AutoFilled | null>(null);
  /**
   * Enquiries already read on this mount.
   *
   * StrictMode runs effects twice in development, and a second `load()` racing
   * the first would see the same unmoved high-water mark: two model calls, two
   * identical writes and two timeline entries saying the same thing. The mark
   * alone cannot prevent it because neither call has written it yet.
   */
  const readOnce = useRef(new Set<string>());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const visibleSections = useMemo(
    () =>
      sectionsFor(enquiry, shipment, {
        accountsDesk: ACCOUNTS_DESK,
        mailOnlyCaseFile: MAIL_ONLY_CASE_FILE,
      }),
    [enquiry, shipment]
  );

  /*
    A `?section=` naming one this enquiry does not show falls through to the
    first that it does. That covers the ordinary case as well as the awkward
    one: somebody reading the billing of a won job, which is then cancelled,
    lands on the mail rather than on a tab that is no longer in the strip.
  */
  const section = (visibleSections.find((s) => s.key === params.get("section"))?.key ??
    visibleSections[0].key) as Section;

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
      const [p, q, ev, sh, pq, d] = await Promise.all([
        MAIL_ONLY_CASE_FILE ? Promise.resolve<Party[]>([]) : partiesFor(ref),
        MAIL_ONLY_CASE_FILE ? Promise.resolve<Quote[]>([]) : quotesFor(ref),
        eventsFor(ref),
        MAIL_ONLY_CASE_FILE ? Promise.resolve<Shipment | null>(null) : shipmentFor(ref),
        // Best-effort: a quotation can still be built if the replies will not
        // load, it just cannot show what each charge costs us.
        MAIL_ONLY_CASE_FILE
          ? Promise.resolve<PartnerQuote[]>([])
          : listQuotes(ref).catch(() => [] as PartnerQuote[]),
        MAIL_ONLY_CASE_FILE
          ? Promise.resolve<DimensionLine[]>([])
          : listDimensions(ref).catch(() => [] as DimensionLine[]),
      ]);
      setParties(p);
      setQuotes(q);
      setEvents(ev);
      setShipment(sh);
      setPartnerQuotes(pq);
      setDims(d);
      // Mail is best-effort: a mailbox that will not load must not blank the file.
      const m = await correspondenceFor(ref, mailbox).catch(() => []);
      setMail(m);

      /*
        Fill the shipment details the new mail answers.

        After the file is on screen rather than before it: this makes a model
        call, and holding the whole page on it would turn every enquiry opened
        into a two-second wait for a panel most visits never look at. It writes
        blanks only and does nothing at all when no mail has arrived since the
        last reading, so the common case costs one comparison.

        Best-effort like the mail itself — an enquiry must still open when the
        reader is down.
      */
      if (!MAIL_ONLY_CASE_FILE && m.length && !readOnce.current.has(ref)) {
        readOnce.current.add(ref);
        void fillFromNewMail(e, m, fillKeysFor(d), mailbox)
          .then((filled) => {
            if (!filled) return;
            setAutoFilled(filled);
            // The fields were written server-side; re-read so the form shows
            // them rather than the blanks it was rendered with.
            void getEnquiry(ref).then(setEnquiry);
            void eventsFor(ref).then(setEvents);
            // A size read out of the mail becomes the first dimension line.
            void listDimensions(ref).then(setDims).catch(() => {});
          })
          .catch(() => {});
      }
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

  /** The documents that can be attached to a reply from this file. */
  const attachables: Attachable[] = useMemo(
    () =>
      !enquiry || MAIL_ONLY_CASE_FILE
        ? []
        : attachablesFrom(enquiry, enquiry.customer, liveQuoteOf(quotes)?.amount_inr ?? null),
    [enquiry, quotes]
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
  const liveQuote = liveQuoteOf(quotes);

  return (
    <div>
      <Back from={cameFrom} />

      {/* ---- header ---- */}
      <div className="card p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="font-mono text-[13px] text-text-accent">{enquiry.ref}</p>
            {/*
              The customer's name is a link to their file.

              This is how somebody gets from "the job in front of me" to "what
              else have we done for these people" — which is the question asked
              halfway through reading a thread, and which had no answer at all
              until there was a customer directory to land on.
            */}
            <h1 className="mt-0.5 text-[19px] font-semibold tracking-tight text-text-primary">
              {customer ? (
                <Link
                  to={`/customers/${customer.id}`}
                  className="hover:text-text-accent"
                  title="Everything this desk has done for them"
                >
                  {customer.company || customer.name}
                </Link>
              ) : (
                "Unknown customer"
              )}
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
      {!MAIL_ONLY_CASE_FILE && (
        <div className="mt-4">
          <EnquiryWorkflow
            enquiry={enquiry}
            quotes={quotes}
            partnerQuotes={partnerQuotes}
            shipment={shipment}
          />
        </div>
      )}

      <nav
        className={`mt-4 mb-4 flex-wrap gap-1 border-b border-border ${
          visibleSections.length > 1 ? "flex" : "hidden"
        }`}
        aria-label="Case file sections"
      >
        {visibleSections.map((s) => (
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

      {section === "quote" && (
        <>
      {/*
        Who is carrying it, and what they came back with — above the quotation,
        because the quotation is built out of their answers.
      */}
      <PartnersPanel enquiry={enquiry} onChanged={load} />
      <PartnerQuotes enquiry={enquiry} />

      {/* ---- quoting and acceptance ---- */}
        </>
      )}

      {section === "shipment" && (
        <>
          {/*
            The inbound job, in the order it is done: who it is for, what the
            service is, what the cargo is and how big, then the price — and
            after a yes, the particulars, the confirmation and the handover.
            Each fact is asked in exactly one place.
          */}
          <MailFillBar
            enquiry={enquiry}
            mail={mail}
            autoFilled={autoFilled}
            keys={fillKeysFor(dims)}
            onSaved={load}
          />
          <CustomerDetailsPanel enquiry={enquiry} customer={customer} onSaved={load} />
          <ServiceDetailsPanel enquiry={enquiry} onSaved={load} />
          <CargoDetailsPanel enquiry={enquiry} onSaved={load} />
          <DimensionsPanel enquiry={enquiry} lines={dims} onSaved={load} />

          <QuotePanel
            enquiry={enquiry}
            quotes={quotes}
            onChanged={load}
            partnerQuotes={partnerQuotes}
            customer={customer}
          />

          {/* Directly under the quote, because it is the answer to it. */}
          <AcceptancePanel
            enquiry={enquiry}
            quotes={quotes}
            mail={mail}
            onChanged={load}
            onRecheck={load}
          />

          {/* What the paperwork needs — after the price, because it does not
              change it. Folded until somebody needs it. */}
          <BookingParticularsPanel enquiry={enquiry} onSaved={load} />

          {/* The confirmation letter is for an agreed job only; the quotation
              itself goes out from the quote above. */}
          {enquiry.status === "accepted" && (
            <ConfirmPanel
              enquiry={enquiry}
              customer={enquiry.customer}
              quotes={quotes}
              mailbox={mailbox}
              fromName={session?.name ?? mailbox}
              signature={session?.signature ?? ""}
              onChanged={load}
            />
          )}

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

      {/*
        The mail itself — opened, read in full, and answered without leaving
        the enquiry. The same reader the partner screen uses, so a reply from
        here carries the signature, the draft-a-reply assistant and the
        reference in the subject exactly as one sent from there does.

        Every thread on a case file already has a reference: the enquiry's. So
        `refFor` answers with it for all of them and no assign button is
        offered — there is nothing to assign.
      */}
      {section === "mail" && (
        <ThreadReader
          mailbox={mailbox}
          fromName={session?.name ?? ""}
          signature={session?.signature ?? ""}
          messages={mail.map((f) => f.message)}
          refFor={() => ({ conversationId: "", ref: enquiry.ref, kind: "shipment" })}
          title="Correspondence"
          hint={`Everything filed against ${enquiry.ref}. Open a thread to read it and reply.`}
          emptyHint={
            mailIsLive()
              ? "Nothing filed against this reference yet."
              : "Outlook is not connected on this session, so the correspondence cannot be read."
          }
          onChanged={load}
          enquiryRef={enquiry.ref}
          attachables={attachables}
        />
      )}

      {/*
        Who is writing, on the tab where their mail is read. It used to sit in
        the shipment page between the cargo and the B/L parties, which made
        two sections called "Parties" about different people.
      */}
      {section === "mail" && !MAIL_ONLY_CASE_FILE && (
        <Collapsible
          id="case:parties"
          title="Parties"
          icon={<Users size={12} className="shrink-0 text-text-muted" />}
          badge={parties.length ? `${parties.length}` : undefined}
          /* Folded when there are none: an empty section explaining that
             it is empty is the longest way to say nothing. */
          defaultOpen={parties.length > 0}
        >
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
        </Collapsible>
      )}

      {section === "timeline" && (
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
                {/*
                  p-4 and the same rhythm as a message below it. An event used
                  to be the tighter of the two, so a timeline alternating
                  between them stepped up and down the page for a reason that
                  was never about the content — both are one thing that
                  happened, at one time, and they should sit the same.
                */}
                <div className="card p-4">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
                    <EventIcon kind={entry.event.kind} />
                    <span className="uppercase tracking-wide">
                      {entry.event.kind.replace(/_/g, " ")}
                    </span>
                    <span className="ml-auto">{when(entry.at)}</span>
                  </div>
                  <p className="mt-1 text-[13px] font-medium text-text-primary">
                    {entry.event.summary}
                  </p>
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
  const { pathname } = useLocation();

  /*
    Nothing in state means the case file was opened cold — a pasted reference,
    a fresh tab, a refresh. The path is still a good answer in that case: one
    read at /my-enquiries/ALG09002-26 belongs to that list whether or not
    anybody clicked through to it, and sending a refresh to the shared board
    would undo the whole point of the separate route.
  */
  const to = from ?? (pathname.startsWith("/my-enquiries") ? "/my-enquiries" : "/enquiries");
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
