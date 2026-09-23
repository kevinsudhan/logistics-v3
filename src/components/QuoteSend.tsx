import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  Download,
  Loader2,
  Mail,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2,
  Undo2,
} from "lucide-react";
import ComposeMail from "./ComposeMail";
import { useAuth } from "../lib/auth";
import { failureText } from "../lib/errorText";
import { quotationFile, renderQuotationPdf } from "../lib/documents";
import { quotationHtml, quotationMessage, quotationSubject } from "../lib/quotationMail";
import { acceptUrl, isReachable, issueLink } from "../services/publicQuote";
import type { Customer, Enquiry, Quote } from "../services/enquiries";
import { linesFor, type QuoteLine } from "../services/quoteLines";
import {
  APPROVAL_LABEL,
  defaultTerms,
  markSent,
  saveTerms,
  sendable,
  submitForApproval,
  type QuoteTerm,
} from "../services/quoteApproval";

/**
 * Getting an approved quotation to the customer.
 *
 * ---------------------------------------------------------------------------
 * THE ORDER IS: TERMS, APPROVAL, THEN SEND
 *
 * And the send is not offered until the middle one has happened. Not because
 * the button would fail — the rule lives in the database — but because a
 * button that is present and refuses is a button people press repeatedly and
 * then work around.
 *
 * WHY SENDING OPENS A COMPOSE WINDOW RATHER THAN JUST SENDING
 *
 * Because it is a letter to a customer, going out under somebody's name. A
 * one-click send is a mail nobody read: the covering note is wrong for this
 * customer, the greeting is generic, the one thing that needed saying is
 * missing. The window is prefilled to the point where sending it unchanged
 * would be fine, and every part of it can be rewritten first — by hand, or with
 * the drafting the compose window already has.
 *
 * WHY THE PDF IS ATTACHED AND THE FIGURES ARE ALSO IN THE BODY
 *
 * Half of these are read on a phone, where opening an attachment is a decision.
 * The body means the customer sees the number without doing anything. The PDF
 * is what gets forwarded to their accounts department and printed.
 *
 * WHY DOWNLOAD IS EQUALLY PROMINENT
 *
 * Plenty of quotations go out through a channel this CRM has no business
 * touching — the customer's portal, WhatsApp, a colleague's mailbox. Making
 * that path feel like the unsupported one is how people end up keeping a second
 * copy of the quotation somewhere else.
 * ---------------------------------------------------------------------------
 */
export default function QuoteSend({
  enquiry,
  customer,
  quote,
  onChanged,
}: {
  enquiry: Enquiry;
  customer: Customer | null;
  quote: Quote;
  onChanged: () => void;
}) {
  const { session } = useAuth();
  const [lines, setLines] = useState<QuoteLine[]>([]);
  const [terms, setTerms] = useState<QuoteTerm[]>(quote.terms ?? []);
  const [composing, setComposing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  /**
   * The customer's acceptance link, minted when the mail is opened.
   *
   * Not on mount: an approved quotation somebody is only downloading should not
   * quietly acquire a live acceptance URL. Minting is idempotent, so opening
   * the mail twice does not leave two.
   */
  const [link, setLink] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLines(await linesFor(quote.id));
    } catch {
      setLines([]);
    }
  }, [quote.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setTerms(quote.terms ?? []);
  }, [quote.id, quote.terms]);

  /**
   * What goes in the PDF.
   *
   * Rebuilt whenever the terms change, because the terms are edited on this
   * panel and an attachment built once on mount would go out without the ones
   * typed a moment ago.
   */
  const pdfInput = useMemo(
    () => ({ enquiry, customer, quote, lines, terms }),
    [enquiry, customer, quote, lines, terms]
  );

  /*
    Admins and named approvers never wait for approval (062). For them there is
    no approval step on screen at all: any draft can be sent, and sending it is
    the clearance — the database records it as cleared by them.
  */
  const exempt = session?.canApproveQuotes === true;
  const ready = sendable(quote) || (exempt && quote.status === "draft");
  const to = customer?.emails?.[0] ?? "";

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(failureText(e, "That did not work.").message);
    } finally {
      setBusy(null);
    }
  };

  /** The modes whose standing terms apply to this job, plus the general ones. */
  const scopes = useMemo(
    () => ["general", ...(enquiry.transport_mode ? [enquiry.transport_mode] : [])],
    [enquiry.transport_mode]
  );

  async function fetchDefaults() {
    setBusy("terms");
    setError(null);
    try {
      const found = await defaultTerms(scopes);
      // Added to what is there rather than replacing it: somebody who has
      // already written a term for this customer should not lose it by
      // pressing a button labelled "fetch".
      const have = new Set(terms.map((t) => t.text.trim().toLowerCase()));
      setTerms([...terms, ...found.filter((t) => !have.has(t.text.trim().toLowerCase()))]);
      setSaved(false);
    } catch (e) {
      setError(failureText(e, "Could not read the standing terms.").message);
    } finally {
      setBusy(null);
    }
  }

  /**
   * Open the mail, with a live accept link if one can be minted.
   *
   * Shared by the first send and every send after it, so a resend carries the
   * same body, the same PDF and the same link — a second mail that differs
   * from the first is how a customer ends up holding two quotations.
   */
  function openMail() {
    // The accept link is only issued for a cleared quotation, so an admin's
    // send clears it first. For everybody else `ready` already means cleared.
    const cleared =
      exempt && quote.approval_status !== "approved"
        ? submitForApproval(quote.id).then(() => onChanged())
        : Promise.resolve();
    void cleared
      .then(() => issueLink(quote.id))
      .then((l) => setLink(acceptUrl(l.token)))
      // Best-effort: a quotation that cannot carry an accept button is still a
      // quotation worth sending.
      .catch(() => setLink(null))
      .finally(() => setComposing(true));
  }

  async function persistTerms() {
    await run("save-terms", async () => {
      await saveTerms(quote.id, terms);
      setSaved(true);
    });
  }

  return (
    <section className="mt-3 border-t border-border pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
          <ShieldCheck size={12} /> {exempt ? "Send to customer" : "Approval & sending"}
        </h3>
        {!exempt && (
          <span
            className={`rounded-full border px-2 py-0.5 text-[11px] ${
              quote.approval_status === "approved"
                ? "border-text-success text-text-success"
                : quote.approval_status === "rejected"
                  ? "border-text-danger text-text-danger"
                  : quote.approval_status === "pending"
                    ? "border-text-warning text-text-warning"
                    : "border-border text-text-muted"
            }`}
          >
            {APPROVAL_LABEL[quote.approval_status]}
          </span>
        )}
      </div>

      {quote.approval_status === "rejected" && quote.approval_note && (
        <p className="mt-2 rounded-lg bg-bg-danger px-3 py-2 text-[12px] text-text-danger">
          Sent back: {quote.approval_note}
        </p>
      )}

      {/* ---- terms ---- */}
      <div className="mt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[12px] text-text-secondary">
            Terms printed under the charges, on the mail and on the PDF.
          </p>
          <button
            type="button"
            onClick={() => void fetchDefaults()}
            disabled={busy !== null}
            className="flex h-7 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[11.5px] text-text-secondary hover:border-border-strong hover:text-text-primary disabled:opacity-60"
          >
            {busy === "terms" ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <RefreshCw size={12} />
            )}
            Fetch defaults
          </button>
        </div>

        <ol className="mt-2 space-y-1.5">
          {terms.map((t, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="mt-2 w-4 shrink-0 text-right text-[11px] tabular-nums text-text-muted">
                {i + 1}.
              </span>
              <input
                value={t.text}
                onChange={(e) => {
                  const next = [...terms];
                  next[i] = { ...t, text: e.target.value };
                  setTerms(next);
                  setSaved(false);
                }}
                className="h-8 flex-1"
              />
              <select
                value={t.scope}
                onChange={(e) => {
                  const next = [...terms];
                  next[i] = { ...t, scope: e.target.value };
                  setTerms(next);
                  setSaved(false);
                }}
                className="h-8 w-28 shrink-0 text-[12px]"
                title="Which section this term is printed under"
              >
                <option value="general">General</option>
                <option value="air">Air</option>
                <option value="sea_lcl">Sea LCL</option>
                <option value="sea_fcl">Sea FCL</option>
                <option value="road">Road</option>
              </select>
              <button
                type="button"
                onClick={() => {
                  setTerms(terms.filter((_, n) => n !== i));
                  setSaved(false);
                }}
                className="mt-1 shrink-0 rounded p-1 text-text-muted hover:text-text-danger"
                aria-label={`Remove term ${i + 1}`}
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ol>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setTerms([...terms, { scope: "general", text: "" }]);
              setSaved(false);
            }}
            className="flex h-7 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[11.5px] text-text-secondary hover:border-border-strong hover:text-text-primary"
          >
            <Plus size={12} /> Add a term
          </button>
          <button
            type="button"
            onClick={() => void persistTerms()}
            disabled={busy !== null}
            className="flex h-7 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[11.5px] text-text-secondary hover:border-border-strong hover:text-text-primary disabled:opacity-60"
          >
            {busy === "save-terms" ? (
              <Loader2 size={12} className="animate-spin" />
            ) : saved ? (
              <Check size={12} className="text-text-success" />
            ) : null}
            {saved ? "Saved" : "Save terms"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      {/* ---- the three acts ---- */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        {!exempt &&
          (quote.approval_status === "draft" || quote.approval_status === "rejected") && (
          <button
            type="button"
            onClick={() => void run("submit", () => submitForApproval(quote.id))}
            disabled={busy !== null}
            className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-medium text-white hover:bg-brand-dark disabled:opacity-60"
          >
            {busy === "submit" ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <ShieldCheck size={13} />
            )}
            {quote.approval_status === "rejected" ? "Resubmit for approval" : "Send for approval"}
          </button>
        )}

        {!exempt && quote.approval_status === "pending" && (
          <p className="flex items-center gap-1.5 text-[12px] text-text-warning">
            <Loader2 size={13} className="animate-spin" />
            With the approvers. It cannot go to the customer until one of them clears it.
          </p>
        )}

        {ready && (
          <>
            <button
              type="button"
              onClick={openMail}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-medium text-white hover:bg-brand-dark"
            >
              <Mail size={13} /> Email the quotation
            </button>
            <button
              type="button"
              onClick={() => {
                const f = quotationFile(pdfInput);
                renderQuotationPdf(pdfInput).save(f.name);
              }}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] text-text-secondary hover:border-border-strong hover:text-text-primary disabled:opacity-60"
            >
              <Download size={13} /> Download the PDF
            </button>
            <button
              type="button"
              onClick={() => void run("sent", () => markSent(quote.id))}
              disabled={busy !== null}
              title="For a quotation sent outside this system"
              className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] text-text-secondary hover:border-border-strong hover:text-text-primary disabled:opacity-60"
            >
              <Send size={13} /> Mark as sent
            </button>
          </>
        )}

        {/*
          Already gone, and still sendable.

          A quotation goes out twice more often than anybody plans for: it went
          to the wrong address, the customer says they never got it, it has been
          three weeks and nobody has replied. Without this the only way to send
          it again was to revise it, which mints a new version and supersedes
          the one the customer may already be holding — a different document at
          a different number, to solve "can you resend that".

          It is the same mail: same body, same PDF, same accept link, because
          `issue_quote_link` returns the live token rather than a second one.
        */}
        {quote.status === "sent" && (
          <>
            <button
              type="button"
              onClick={openMail}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-border-strong bg-surface-1 px-3 text-[12px] font-medium text-text-primary hover:bg-surface-2"
            >
              <Mail size={13} /> Send again
            </button>
            <button
              type="button"
              onClick={() => {
                const f = quotationFile(pdfInput);
                renderQuotationPdf(pdfInput).save(f.name);
              }}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] text-text-secondary hover:border-border-strong hover:text-text-primary"
            >
              <Download size={13} /> Download the PDF
            </button>
          </>
        )}

        {quote.status === "sent" && (
          <p className="flex w-full items-center gap-1.5 text-[12px] text-text-secondary">
            <Check size={13} className="text-text-success" />
            Sent to the customer. Record their answer above when it comes.
          </p>
        )}
      </div>

      {/*
        A link the customer cannot open is worse than no link: they press it,
        get a connection error, and nobody here hears about it. Said before the
        mail goes rather than discovered afterwards.
      */}
      {ready && link && !isReachable(link) && (
        <p className="mt-2 flex items-start gap-2 rounded-lg bg-bg-warning px-3 py-2 text-[12px] text-text-warning">
          <AlertCircle size={13} className="mt-px shrink-0" />
          <span>
            The accept link points at <code>{link}</code>, which only resolves on this machine.
            The customer will get an error. Set <code>VITE_PUBLIC_APP_URL</code> to the address
            they can reach, or send without the button and take their reply as the acceptance.
          </span>
        </p>
      )}

      {composing && (
        <ComposeMail
          mailbox={session?.email ?? ""}
          fromName={session?.name ?? ""}
          signature={session?.signature ?? ""}
          enquiryRef={enquiry.ref}
          reference={enquiry.ref}
          initial={{
            to,
            subject: quotationSubject({ enquiry, quote }),
            body: quotationHtml({
              enquiry,
              customer,
              quote,
              lines,
              terms,
              message: quotationMessage({ enquiry, customer, quote, lines, terms }),
              fromName: session?.name,
              acceptUrl: link && isReachable(link) ? link : null,
            }),
          }}
          /*
            The PDF goes with the mail, not merely on offer in the attachment
            menu. It is what gets forwarded to the customer's accounts
            department and printed, and an attachment somebody has to remember
            to add is the one forgotten on the mail that mattered. It can still
            be removed before sending.
          */
          attachments={[quotationFile(pdfInput)]}
          attachables={[
            { id: "quotation", label: "Quotation (PDF)", make: () => quotationFile(pdfInput) },
          ]}
          onClose={() => {
            setComposing(false);
            setLink(null);
          }}
          onSent={() => {
            setComposing(false);
            /*
              The quotation has left. Recorded here rather than left to "mark
              as sent", because the one thing worse than an unsent quotation is
              one the system thinks is unsent.

              Skipped on a resend: `sent_at` is when the customer was first
              quoted, and a validity period counted from the chase rather than
              from the quotation is a rate that outlives itself.
            */
            if (quote.status !== "sent") void run("sent", () => markSent(quote.id));
          }}
        />
      )}
    </section>
  );
}
