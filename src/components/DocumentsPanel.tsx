import { useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  FileDown,
  FilePen,
  Loader2,
  Send,
} from "lucide-react";
import {
  documentBytes,
  documentStatuses,
  generateDocument,
  viewDocument,
  type DocSpec,
  type DocumentData,
} from "../lib/documents";
import { renderDocument } from "../lib/documents/render";
import { useAuth } from "../lib/auth";
import { AUDIENCE_WORD, audienceOf, documentMailBody, documentMailSubject, documentSentSummary, recipientsFor } from "../lib/documentMail";
import { failureText } from "../lib/errorText";
import type { MailMessage } from "../services/backend";
import { threadWith } from "../services/customerThread";
import { numberedInvoice } from "../services/invoiceNumbers";
import { logEvent, partiesFor, type Customer } from "../services/enquiries";
import ComposeMail from "./ComposeMail";

/**
 * What sending a document needs (6 Oct): the job it is filed under, and who
 * it can go to. Absent, the list has no Send.
 */
export interface DocumentMail {
  enquiryRef: string;
  customer: Customer | null;
  /** The far-end consignee, where the job knows one. */
  consignee: { name: string | null; email: string | null } | null;
  /**
   * The quotation is sent from the quotation itself: approved, with its
   * accept button, and recorded as sent. Where given, its Send goes there.
   */
  onQuotation?: () => void;
}

interface Composing {
  spec: DocSpec;
  /** The record as it went into the mail: with the tax invoice's number, where it was given one. */
  data: DocumentData;
  ready: boolean;
  missing: string[];
  to: Array<{ address: string; name: string | null }>;
  replyTo: MailMessage | null;
}

/**
 * Every document the desk can issue for this customer, with what each one is still
 * waiting for.
 *
 * Listed in shipment order rather than alphabetically, because that is the order they get
 * produced in and the list doubles as a progress view: how far down it you can go before
 * things stop being issuable is exactly how far the booking has actually got.
 *
 * Nothing is hidden and nothing is disabled. A document that cannot be issued yet still
 * generates as a stamped draft naming its gaps — that draft is what the desk sends the
 * customer to chase the missing details, so refusing to produce it would remove the tool
 * that closes the gap.
 */
/** Today in India, as the database dates an invoice. */
const todayIst = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

export default function DocumentsPanel({
  data,
  defaultOpen = false,
  onFillDetails,
  onNumbered,
  mail,
}: {
  data: DocumentData;
  /** A tax invoice was given its number as it was made: the record is read again, so the list shows it. */
  onNumbered?: () => void;
  /** Given, each document can be sent from here, from the person's own mailbox (6 Oct). */
  mail?: DocumentMail;
  /** Open on a shipment page, where documents are the point; collapsed in a list row. */
  defaultOpen?: boolean;
  /**
   * Opens the form for the fields the drafts are waiting on.
   *
   * Optional because not every caller has one — the enquiry-side panel reads a
   * record whose fields live somewhere else entirely. Where it is absent the
   * list still says what is missing; it just cannot offer to fix it here.
   */
  onFillDetails?: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  /** Which document a popup blocker swallowed, so the button can explain itself. */
  const [blocked, setBlocked] = useState<string | null>(null);
  const statuses = documentStatuses(data);
  const readyCount = statuses.filter((s) => s.ready).length;
  const { session } = useAuth();
  const [opening, setOpening] = useState<string | null>(null);
  const [compose, setCompose] = useState<Composing | null>(null);
  const [sent, setSent] = useState<Record<string, string>>({});
  const [mailError, setMailError] = useState<string | null>(null);
  /** Which document is being numbered before it is made, and what went wrong if it could not be. */
  const [numbering, setNumbering] = useState<string | null>(null);
  const [numberError, setNumberError] = useState<{ id: string; text: string } | null>(null);

  /**
   * The record a document is made from: as it is, or for a tax invoice not yet
   * numbered, with its B/L's number — the next in the series, when nothing
   * else is outstanding (141).
   */
  async function made(spec: DocSpec): Promise<DocumentData> {
    if (!spec.number || spec.number(data) || !data.blNumber) return data;
    setNumbering(spec.id);
    setNumberError(null);
    try {
      const d = await numberedInvoice(data, todayIst());
      if (d !== data) onNumbered?.();
      return d;
    } finally {
      setNumbering(null);
    }
  }

  /** Read in a tab; a tax invoice numbered first, in a tab opened now so the pop-up blocker lets it through. */
  async function view(spec: DocSpec) {
    if (!spec.number || spec.number(data) || !data.blNumber) {
      if (!viewDocument(spec, data)) setBlocked(spec.id);
      return;
    }
    const tab = window.open("", "_blank");
    if (!tab) return setBlocked(spec.id);
    tab.opener = null;
    try {
      const url = renderDocument(spec, await made(spec)).output("bloburl") as unknown as string;
      tab.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      tab.close();
      setNumberError({ id: spec.id, text: failureText(e, "The invoice could not be numbered.").message });
    }
  }

  async function generate(spec: DocSpec) {
    try {
      generateDocument(spec, await made(spec));
    } catch (e) {
      setNumberError({ id: spec.id, text: failureText(e, "The invoice could not be numbered.").message });
    }
  }

  /**
   * Opens the mail: addressed to whom the document is for, into the
   * conversation already running with them on this job, the PDF attached.
   */
  async function openSend(spec: DocSpec, ready: boolean, missing: string[]) {
    if (!mail) return;
    setOpening(spec.id);
    setMailError(null);
    try {
      const d = await made(spec);
      const parties = await partiesFor(mail.enquiryRef).catch(() => []);
      const to = recipientsFor(audienceOf(spec), {
        customer: mail.customer ? { name: mail.customer.name, company: mail.customer.company, emails: mail.customer.emails ?? [] } : null,
        consignee: mail.consignee,
        parties,
      });
      const replyTo = to.length ? await threadWith(mail.enquiryRef, session?.email ?? "", to.map((t) => t.address)).catch(() => null) : null;
      setCompose({ spec, data: d, ready, missing, to, replyTo });
    } catch (e) {
      setMailError(failureText(e, "The mail could not be opened.").message);
    } finally {
      setOpening(null);
    }
  }

  return (
    <div className="mt-4 border-t border-border pt-3">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 text-left"
      >
        {open ? <ChevronDown size={13} className="text-text-muted" /> : <ChevronRight size={13} className="text-text-muted" />}
        <span className="text-[11px] font-medium uppercase tracking-wide text-text-secondary">
          Documents
        </span>
        <span className="text-[11px] text-text-muted">
          {readyCount} of {statuses.length} ready to issue
        </span>
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {/* One route to the fields, above the list rather than repeated on
              every draft row — it is the same form whichever document sent you
              looking for it. */}
          {onFillDetails && readyCount < statuses.length && (
            <button
              onClick={onFillDetails}
              className="mb-2 inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-2.5 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
            >
              <FilePen size={12} />
              Fill in the missing details
            </button>
          )}
          {statuses.map(({ spec, ready, missingLabels, have, need }) => (
            /*
              A card each, the same as every other list on this desk.

              They were thin rows a line and a half tall, separated by a hairline
              and distinguished only by whether that hairline was dashed. Twelve
              of them read as one block of text, and the thing you are actually
              scanning for — which of these can be issued — was carried by the
              border style, which is the least visible property on the row.

              Not ready keeps the dashed border, because that reads as "not
              finished" everywhere else here, but it is now a dashed card rather
              than a dashed line.
            */
            <div
              key={spec.id}
              className={`flex items-start gap-3 p-4 ${
                ready
                  ? "card"
                  : "rounded-card border border-dashed border-border-strong bg-surface-1"
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[13px] font-medium text-text-primary">
                    {spec.shortName}
                  </span>
                  {ready ? (
                    <Check size={12} className="text-text-success shrink-0" />
                  ) : (
                    <AlertTriangle size={12} className="text-text-warning shrink-0" />
                  )}
                </div>
                <p className="mt-0.5 text-[12px] text-text-secondary">{spec.purpose}</p>
                {!ready && (
                  <p className="mt-1 text-[12px] text-text-warning">
                    {have} of {need} — needs: {missingLabels.join(", ")}
                  </p>
                )}
                {spec.number &&
                  (spec.number(data) ? (
                    <p className="mt-1 text-[12px] text-text-secondary">
                      Numbered <span className="font-mono text-text-primary">{spec.number(data)}</span>
                    </p>
                  ) : (
                    ready && (
                      <p className="mt-1 text-[12px] text-text-muted">Takes the next number in the ALG series when it is viewed, generated or sent.</p>
                    )
                  ))}
                {numberError?.id === spec.id && <p className="mt-1 text-[12px] text-text-danger">{numberError.text}</p>}
                {blocked === spec.id && (
                  <p className="mt-1 text-[12px] text-text-danger">
                    Your browser blocked the new tab. Allow pop-ups for this site, or use Generate.
                  </p>
                )}
                {sent[spec.id] && (
                  <p className="mt-1 flex items-center gap-1 text-[12px] text-text-success">
                    <Check size={12} /> {sent[spec.id]}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 flex-wrap justify-end gap-2">

              {/* Reading and keeping are different acts. View opens it; Generate
                  puts a copy on the machine. Most checks want the first. */}
              <button
                onClick={() => void view(spec)}
                disabled={numbering === spec.id}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary disabled:opacity-60"
              >
                <Eye size={13} />
                View
              </button>

              <button
                onClick={() => void generate(spec)}
                disabled={numbering === spec.id}
                className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[12px] font-medium transition-colors disabled:opacity-60 ${
                  ready
                    ? "bg-brand text-white hover:bg-brand-dark"
                    : "border border-border text-text-secondary hover:border-border-strong hover:text-text-primary"
                }`}
              >
                {numbering === spec.id ? <Loader2 size={13} className="animate-spin" /> : <FileDown size={13} />}
                {ready ? "Generate" : "Draft"}
              </button>

              {/* Sending is the fourth thing done with a document: from the person's own Outlook, into the job's thread, the PDF attached. */}
              {mail && (spec.id !== "quotation" || mail.onQuotation) && (
                <button
                  onClick={() => (spec.id === "quotation" ? mail.onQuotation?.() : void openSend(spec, ready, missingLabels))}
                  disabled={opening !== null}
                  title={spec.id === "quotation" ? "Sent from the quotation: approved, with the customer's Accept button" : `Mail it to ${AUDIENCE_WORD[audienceOf(spec)]}${ready ? "" : " as a draft, asking for what it still needs"}`}
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary disabled:opacity-60"
                >
                  {opening === spec.id ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                  Send
                </button>
              )}
              </div>
            </div>
          ))}

          {mailError && <p className="text-[12px] text-text-danger">{mailError}</p>}

          <p className="pt-1 text-[11px] leading-relaxed text-text-muted">
            Drafts print every unestablished field as TBD and name what is outstanding on
            the document itself. Nothing is inferred from a similar shipment.
          </p>
        </div>
      )}

      {compose && mail && (
        <ComposeMail
          mailbox={session?.email ?? ""}
          fromName={session?.name ?? ""}
          signature={session?.signature ?? ""}
          enquiryRef={mail.enquiryRef}
          reference={mail.enquiryRef}
          // Into the conversation already running with them on this job, without the history quoted under it.
          replyTo={compose.replyTo ?? undefined}
          mode="reply"
          quoteThread={false}
          newThreadNote={
            compose.to.length
              ? `No earlier mail with ${compose.to[0].address} on ${mail.enquiryRef} in your mailbox, so this starts a new conversation.`
              : `No address on file for ${AUDIENCE_WORD[audienceOf(compose.spec)]}: type it in To.`
          }
          initial={{
            to: compose.to.map((t) => t.address).join(", "),
            subject: compose.replyTo ? undefined : documentMailSubject(compose.spec, compose.data, compose.ready),
            body: documentMailBody(compose.spec, compose.data, { ready: compose.ready, missing: compose.missing, to: compose.to[0] ?? { name: null, address: null } }),
          }}
          // The PDF goes with it, as View shows it — a draft stamped as one.
          attachments={[documentBytes(compose.spec, compose.data)]}
          attachables={[{ id: compose.spec.id, label: `${compose.spec.shortName} (PDF)`, make: () => documentBytes(compose.spec, compose.data) }]}
          onClose={() => setCompose(null)}
          onSent={({ to }) => {
            const c = compose;
            setCompose(null);
            setSent((s) => ({ ...s, [c.spec.id]: `Sent to ${to.join(", ")}` }));
            // On the job's timeline: what went, to whom, and whether as a draft.
            void logEvent(mail.enquiryRef, "document_sent", documentSentSummary(c.spec, to, c.ready, c.missing), {
              document: c.spec.id,
              ready: c.ready,
              to,
            }).catch(() => {});
          }}
        />
      )}
    </div>
  );
}
