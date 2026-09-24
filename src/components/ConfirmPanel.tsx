import { useState } from "react";
import { AlertCircle, Loader2, MailCheck } from "lucide-react";
import ComposeMail from "./ComposeMail";
import { MAIL_LOGO_PATH } from "../lib/company";
import { confirmationHtml, confirmationSubject } from "../lib/confirmationMail";
import { mailIsLive } from "../services/backend";
import {
  linkCustomerEmail,
  logEvent,
  type Customer,
  type Enquiry,
  type Quote,
} from "../services/enquiries";

/**
 * The booking confirmation: what was agreed, in writing, before we book.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS NO LONGER SENDS THE QUOTATION
 *
 * It used to draft the quotation too, and marking that letter sent moved the
 * quote to `sent` with no reference to approval — a second way to put a rate
 * in front of a customer that skipped the check the first way enforces. The
 * quotation now goes out from one place, the quote's own Send, and the
 * database refuses to mark an uncleared one sent whichever button asks (062).
 *
 * WHAT IT LOOKS LIKE
 *
 * The quotation's letterhead (lib/confirmationMail.ts on lib/brandedMail.ts):
 * the logo on navy, the agreed details in the shipment box, the rate set
 * apart, and what happens next.
 *
 * WHY IT IS A DRAFT AND NOT A SEND
 *
 * It goes out under a real person's name, confirming a price to a customer,
 * and whoever is named on it should read it first. Everything in it comes from
 * the enquiry — a field we do not hold is simply not a line in the letter.
 *
 * WHY THERE IS AN ADDRESS FIELD
 *
 * Often there is no address on file, because the job came in by phone. Rather
 * than refusing, the panel asks for one and writes it to the customer once the
 * message has gone — so their replies file themselves against this case.
 * ---------------------------------------------------------------------------
 */
export default function ConfirmPanel({
  enquiry,
  customer,
  quotes,
  mailbox,
  fromName,
  signature,
  onChanged,
}: {
  enquiry: Enquiry;
  customer: Customer | null;
  quotes: Quote[];
  mailbox: string;
  fromName: string;
  signature: string;
  onChanged: () => void;
}) {
  const known = customer?.emails ?? [];
  const [address, setAddress] = useState(known[0] ?? "");
  const [composing, setComposing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const quote = quotes.find((q) => q.status === "accepted") ?? null;

  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.trim());
  const isNew = valid && !known.some((e) => e.toLowerCase() === address.trim().toLowerCase());

  /** Recorded only once the message has actually gone. */
  async function sent() {
    setComposing(false);
    setSaving(true);
    setError(null);
    try {
      if (mailIsLive() && isNew && customer) await linkCustomerEmail(customer.id, address.trim());
      await logEvent(enquiry.ref, "confirmation_sent", `Confirmation emailed to ${address.trim()}`, {
        to: address.trim(),
        quote_id: quote?.id ?? null,
      });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sent, but the record could not be updated.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-4 card p-5">
      <h2 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-text-secondary mb-3">
        <MailCheck size={12} /> Confirm to the customer
      </h2>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex-1 min-w-[240px]">
          <span className="block text-[11px] text-text-secondary mb-1">
            Send to
            {known.length > 1 && <span className="text-text-muted"> · {known.length} on file</span>}
          </span>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="name@company.com"
            className="w-full h-8"
            autoComplete="off"
            list={known.length > 1 ? `emails-${enquiry.ref}` : undefined}
          />
          {known.length > 1 && (
            <datalist id={`emails-${enquiry.ref}`}>
              {known.map((e) => (
                <option key={e} value={e} />
              ))}
            </datalist>
          )}
        </label>

        <button
          onClick={() => setComposing(true)}
          disabled={!valid || saving}
          className="flex items-center gap-1.5 h-8 px-3.5 rounded-lg text-[12px] font-medium disabled:opacity-60 bg-brand hover:bg-brand-dark text-white"
          title={valid ? undefined : "Enter an email address first"}
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : <MailCheck size={13} />}
          Send confirmation
        </button>
      </div>

      {!mailIsLive() && (
        <p className="mt-2 text-[11px] text-text-warning">
          Outlook is not connected on this session, so this will be drafted and filed rather than
          delivered. Connect it on the Mail page to send for real.
        </p>
      )}

      {isNew && (
        <p className="mt-2 text-[11px] text-text-muted">
          New address — it will be added to {customer?.company || customer?.name || "this customer"}{" "}
          once the message is sent, so future mail from it lands on this case.
        </p>
      )}

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      {composing && (
        <ComposeMail
          mailbox={mailbox}
          fromName={fromName}
          signature={signature}
          initial={{
            to: address.trim(),
            subject: confirmationSubject(enquiry),
            body: confirmationHtml({
              enquiry,
              customer,
              quote,
              fromName,
              // This app's own copy, which the send carries inside the message.
              logoSrc: `${window.location.origin}${MAIL_LOGO_PATH}`,
            }),
          }}
          onClose={() => setComposing(false)}
          onSent={() => void sent()}
        />
      )}
    </section>
  );
}
