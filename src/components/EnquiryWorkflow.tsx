import { Check, Plane } from "lucide-react";
import type { Enquiry, Quote, Shipment } from "../services/enquiries";
import type { PartnerQuote } from "../services/rfq";

/**
 * Where this enquiry has got to.
 *
 * ---------------------------------------------------------------------------
 * WHY EVERY STEP IS DERIVED AND NONE IS SET BY HAND
 *
 * A progress bar driven by its own status field is a progress bar that lies.
 * Somebody forgets to advance it and the enquiry reads "rate requested" a week
 * after the customer accepted; somebody advances it early and it claims a quote
 * went out that nobody sent. Either way the person reading it learns to
 * distrust it, and then it is decoration.
 *
 * So each step asks the records a question with one answer:
 *
 *   Enquiry            the row exists
 *   Rates requested    a partner was asked (an rfq row)
 *   Rates in           at least one partner answered
 *   Quote prepared     a quote exists, in any state
 *   Internally approved  an approver cleared it (052)
 *   Quote sent         a quote reached status 'sent'
 *   Accepted           the customer said yes
 *   Booked             a shipment exists
 *
 * Nothing here can be advanced by pressing it, because there is nothing to
 * press: doing the work is what moves it.
 *
 * WHY "FOLLOW-UP" IS NOT A STEP
 *
 * Chasing is not a stage, it is something you do during one. Modelled as a
 * step it can only ever be half-true — you are always either about to chase or
 * have just chased — and the bar would spend most of its life sitting on it.
 * What matters is how long a step has been waiting, which is what the date
 * under each done step gives you.
 *
 * WHY DECLINED AND LOST STOP IT RATHER THAN COLOURING IT RED
 *
 * An enquiry that was lost did not fail at the last step it reached; it ended
 * there. The bar says where it ended and stops claiming the rest is pending.
 * ---------------------------------------------------------------------------
 */

interface Step {
  key: string;
  label: string;
  done: boolean;
  /** When it happened, where a record carries a date. */
  at?: string | null;
}

export default function EnquiryWorkflow({
  enquiry,
  quotes,
  partnerQuotes = [],
  shipment,
}: {
  enquiry: Enquiry;
  quotes: Quote[];
  partnerQuotes?: PartnerQuote[];
  shipment?: Shipment | null;
}) {
  /*
    The rfq rows carry their own timestamps, so they answer both of the partner
    steps on their own. An earlier draft consulted the event log as well; the
    event kinds it looked for do not exist — the log records quote_sent,
    accepted, declined, mail_linked, party_added and field_updated, and nothing
    for asking an agent. Two sources would have meant one of them being wrong.
  */
  const requests = [...partnerQuotes].sort((a, b) => a.sent_at.localeCompare(b.sent_at));
  const asked = requests[0] ?? null;
  const answered =
    requests.find((p) => p.amount != null) ??
    requests.find((p) => p.replied_at != null) ??
    null;

  // Any quote at all, oldest first, because the question is when one first
  // existed rather than which is current.
  const anyQuote = [...quotes].sort((a, b) => a.created_at.localeCompare(b.created_at))[0] ?? null;
  const sent = quotes.find((q) => q.status === "sent" || q.status === "accepted") ?? null;
  const accepted = quotes.find((q) => q.status === "accepted") ?? null;

  const steps: Step[] = [
    { key: "enquiry", label: "Enquiry", done: true, at: enquiry.received_at },
    {
      key: "asked",
      label: "Rates requested",
      done: Boolean(asked),
      at: asked?.sent_at ?? null,
    },
    {
      key: "rates",
      label: "Rates in",
      done: Boolean(answered),
      at: answered?.replied_at ?? null,
    },
    {
      key: "prepared",
      label: "Quote prepared",
      done: Boolean(anyQuote),
      at: anyQuote?.created_at ?? null,
    },
    {
      key: "approved",
      label: "Internally approved",
      // Approved, or past it: a quote that has been sent was cleared to be
      // sent, and one accepted by the customer plainly went out. Reading only
      // the current flag would show this step reopening as the quote moves on.
      done: quotes.some(
        (q) => q.approval_status === "approved" || q.status === "sent" || q.status === "accepted"
      ),
      at: quotes.find((q) => q.approved_at)?.approved_at ?? null,
    },
    { key: "sent", label: "Quote sent", done: Boolean(sent), at: sent?.sent_at ?? null },
    {
      key: "accepted",
      label: "Accepted",
      done: Boolean(accepted),
      at: accepted?.responded_at ?? null,
    },
    { key: "booked", label: "Booked", done: Boolean(shipment), at: shipment?.created_at ?? null },
  ];

  const ended = enquiry.status === "lost" || enquiry.status === "declined";
  /*
    The furthest step actually reached, not the count of done ones.

    They differ whenever a step is skipped, which happens constantly: a desk
    quoting from its own rate card never asks a partner, so "rates requested"
    and "rates in" stay open on an enquiry that is already booked. Counting
    would report that job as two steps along.
  */
  const reached = steps.reduce((last, s, i) => (s.done ? i : last), 0);

  return (
    <section className="card p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[11px] font-medium uppercase tracking-wide text-text-secondary">
          Workflow
        </h2>
        {ended && (
          <p className="text-[11.5px] text-text-muted">
            Ended at {steps[reached].label.toLowerCase()} — {enquiry.status === "lost" ? "lost" : "declined"}.
          </p>
        )}
      </div>

      {/*
        Horizontally scrollable rather than wrapped. Seven steps do not fit on a
        phone at a readable size, and a bar that wraps to three rows stops
        reading as a sequence — which is the only thing it is for.
      */}
      <ol className="flex min-w-0 items-start gap-0 overflow-x-auto pb-1">
        {steps.map((s, i) => {
          const isCurrent = !ended && i === reached && reached < steps.length - 1;
          const passed = i <= reached && s.done;
          return (
            <li key={s.key} className="flex min-w-0 flex-1 shrink-0 basis-[104px] flex-col items-center">
              <div className="flex w-full items-center">
                {/* The rail to the left, filled as far as the work has come. */}
                <span
                  className={`h-0.5 flex-1 ${i === 0 ? "opacity-0" : i <= reached ? "bg-text-success" : "bg-border"}`}
                />
                <span
                  className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[10px] ${
                    passed
                      ? "border-text-success bg-text-success text-white"
                      : isCurrent
                        ? "border-text-accent bg-surface-1 text-text-accent"
                        : "border-border bg-surface-2 text-text-muted"
                  }`}
                  aria-hidden
                >
                  {passed ? <Check size={12} /> : isCurrent ? <Plane size={11} /> : i + 1}
                </span>
                <span
                  className={`h-0.5 flex-1 ${
                    i === steps.length - 1 ? "opacity-0" : i < reached ? "bg-text-success" : "bg-border"
                  }`}
                />
              </div>

              <p
                className={`mt-1.5 px-1 text-center text-[11px] leading-tight ${
                  passed || isCurrent ? "text-text-primary" : "text-text-muted"
                }`}
              >
                {s.label}
              </p>
              <p className="text-center text-[10.5px] tabular-nums text-text-muted">
                {s.at ? shortDate(s.at) : isCurrent ? "waiting" : ""}
              </p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** "18 Sep" — a full timestamp is noise under a seven-step bar. */
function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}
