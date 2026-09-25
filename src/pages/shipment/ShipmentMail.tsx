import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, ChevronRight } from "lucide-react";
import { useShipment } from "../ShipmentDetail";
import { useAuth } from "../../lib/auth";
import { ACCOUNTS_DESK } from "../../lib/features";
import ThreadReader from "../../components/ThreadReader";
import PartnersPanel from "../../components/PartnersPanel";
import PartnerQuotes from "../../components/PartnerQuotes";
import QuoteCharges from "../../components/QuoteCharges";
import { failureText, type FailureText } from "../../lib/errorText";
import { mailIsLive } from "../../services/backend";
import {
  correspondenceFor,
  getEnquiry,
  quotesFor,
  type Customer,
  type Enquiry,
  type FiledMessage,
  type Quote,
} from "../../services/enquiries";
import { liveQuoteOf } from "../../lib/attachableDocuments";
import { money } from "../../services/charges";
import { useLiveVersion } from "../../lib/liveVersions";

/**
 * The correspondence, the quotation and the agents — on the booking.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ON THE SHIPMENT AT ALL
 *
 * A booking is the second half of one job. The thread that produced it, the
 * rate that was agreed and the agent who quoted it are exactly what somebody
 * operating the shipment needs — "what did we tell them about the cut-off",
 * "what was the freight", "who is the co-loader". Making them navigate back to
 * the enquiry for all three is how a desk ends up working out of the mailbox
 * and treating this system as a filing cabinet.
 *
 * WHY IT READS THE ENQUIRY'S MAIL RATHER THAN ITS OWN
 *
 * Because there is no such thing as the shipment's mail. Correspondence is
 * gathered against the reference — ALG09012-26 — and that reference does not
 * change when a booking is made. A message sent today about a shipment that
 * sailed last week still carries it. Giving the booking a second mailbox would
 * split one conversation in two.
 *
 * WHY THE QUOTATION IS READ-ONLY HERE
 *
 * It is what the customer accepted. The charges are locked by the database on
 * an accepted quote anyway; showing them as editable would be an invitation
 * the save would then refuse.
 * ---------------------------------------------------------------------------
 */
export default function ShipmentMail() {
  const { shipment } = useShipment();
  const { session } = useAuth();
  const mailbox = session?.email ?? "";

  const [enquiry, setEnquiry] = useState<(Enquiry & { customer: Customer | null }) | null>(null);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [mail, setMail] = useState<FiledMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<FailureText | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [e, q] = await Promise.all([
        getEnquiry(shipment.enquiry_ref),
        quotesFor(shipment.enquiry_ref),
      ]);
      setEnquiry(e);
      setQuotes(q);
      // Best-effort, like everywhere else: a mailbox that will not load must
      // not blank the page around it.
      setMail(await correspondenceFor(shipment.enquiry_ref, mailbox).catch(() => []));
    } catch (e) {
      setError(failureText(e, "Could not load the correspondence."));
    } finally {
      setLoading(false);
    }
  }, [shipment.enquiry_ref, mailbox]);

  // Changed by anybody, read again (the page's subscription, 084).
  const live = useLiveVersion("enquiry_messages", "enquiry_threads", "quotes");
  useEffect(() => {
    void load();
  }, [load, live]);

  const agreed = liveQuoteOf(quotes);

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          <span>
            {error.message}
            {error.hint && <span className="mt-1 block opacity-80">{error.hint}</span>}
          </span>
        </div>
      )}

      {/* ---- what was agreed ---- */}
      <section className="card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[11px] font-medium uppercase tracking-wide text-text-secondary">
            The quotation this was booked on
          </h2>
          <Link
            to={`/enquiries/${shipment.enquiry_ref}`}
            className="flex items-center gap-0.5 text-[12px] text-text-accent hover:underline"
          >
            Open {shipment.enquiry_ref} <ChevronRight size={13} />
          </Link>
        </div>

        {!agreed ? (
          <p className="mt-2 text-[12px] text-text-muted">
            No quotation recorded against this enquiry.
          </p>
        ) : (
          <>
            <p className="mt-1.5 text-[18px] font-semibold tabular-nums text-text-primary">
              {money(agreed.amount_inr)}
            </p>
            <p className="text-[12px] text-text-secondary">
              Version {agreed.version} · {agreed.status}
              {agreed.basis ? ` · ${agreed.basis}` : ""}
            </p>
            {ACCOUNTS_DESK && (
              <div className="mt-3 border-t border-border pt-3">
                {/* Locked: this is what the customer accepted. */}
                <QuoteCharges quoteId={agreed.id} locked />
              </div>
            )}
          </>
        )}
      </section>

      {/* ---- the agents on this job ---- */}
      {enquiry && (
        <>
          <PartnersPanel enquiry={enquiry} onChanged={load} />
          <PartnerQuotes enquiry={enquiry} />
        </>
      )}

      {/* ---- the thread ---- */}
      {loading && !mail.length ? (
        <p className="py-6 text-[13px] text-text-muted">Reading the mailbox…</p>
      ) : (
        <ThreadReader
          mailbox={mailbox}
          fromName={session?.name ?? ""}
          signature={session?.signature ?? ""}
          messages={mail.map((f) => f.message)}
          refFor={() => ({
            conversationId: "",
            ref: shipment.enquiry_ref,
            kind: "shipment",
          })}
          title="Correspondence"
          hint={`Everything filed against ${shipment.enquiry_ref} — the enquiry this booking came from.`}
          emptyHint={
            mailIsLive()
              ? "Nothing filed against this reference yet."
              : "Outlook is not connected on this session, so the correspondence cannot be read."
          }
          enquiryRef={shipment.enquiry_ref}
          onChanged={load}
        />
      )}
    </div>
  );
}
