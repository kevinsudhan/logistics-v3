import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import {
  acceptByToken,
  quoteByToken,
  type PublicQuote,
  type QuoteLinkState,
} from "../services/publicQuote";
import { SectionSkeleton } from "../components/Loading";

/**
 * The page a customer lands on from the quotation mail.
 *
 * ---------------------------------------------------------------------------
 * WHO IS READING THIS
 *
 * Somebody outside the company, on a phone, who has never seen this system and
 * never will again. So: no navigation, no branding they have to decode, no
 * jargon, and one thing to do. Everything that would be useful to an operator
 * is absent, because none of it is useful to them.
 *
 * WHY THE PAGE LOADS WITHOUT ACCEPTING
 *
 * Their mail gateway fetched this URL before they saw it. If arriving here
 * accepted the quotation, a scanner would have accepted it. Arriving reads;
 * the button accepts.
 *
 * WHY THE NAME FIELD IS OPTIONAL
 *
 * Because insisting on it would stop somebody from agreeing, and an acceptance
 * with no name is still an acceptance — the link was sent to one address for
 * one quotation. The name is worth asking for and not worth blocking on.
 *
 * WHY EVERY ENDED STATE READS PLAINLY
 *
 * Expired, withdrawn, already accepted: all of them are ordinary and none is
 * the customer's fault. They get a sentence and the desk's address, not an
 * error.
 * ---------------------------------------------------------------------------
 */
export default function QuoteAccept() {
  const { token = "" } = useParams();
  const [quote, setQuote] = useState<PublicQuote | null>(null);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      setQuote(await quoteByToken(token));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function accept() {
    setBusy(true);
    try {
      await acceptByToken(token, name.trim(), note.trim());
      await load();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f4f5f7] px-4 py-8 text-[#1f2937]">
      <div className="mx-auto w-full max-w-[640px]">
        <header className="rounded-t-xl bg-[#2f4f6f] px-6 py-5 text-white">
          <p className="text-[22px] font-bold tracking-wide">QUOTATION</p>
          <p className="mt-0.5 text-[12.5px] opacity-90">Aashish Logistics Global</p>
        </header>

        <main className="rounded-b-xl border border-t-0 border-[#e5e7eb] bg-white px-6 py-6">
          {loading ? (
            <SectionSkeleton lines={4} label="Loading the quotation" className="py-6" />
          ) : failed || !quote ? (
            <Ended
              title="We could not open this quotation"
              body="The link may be incomplete. Please reply to the email it came from and we will send it again."
            />
          ) : quote.state !== "open" ? (
            <Closed quote={quote} />
          ) : (
            <>
              <Summary quote={quote} />

              <div className="mt-6 rounded-lg border border-[#e5e7eb] bg-[#f9fafb] p-5">
                <p className="text-[14px] font-semibold">Accept this quotation</p>
                <p className="mt-1 text-[13px] leading-relaxed text-[#6b7280]">
                  Confirming here tells our team to go ahead and book. Nothing is charged at this
                  point, and we will come back to you with the booking details.
                </p>

                <label className="mt-4 block">
                  <span className="mb-1 block text-[12px] text-[#6b7280]">Your name</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Optional"
                    className="h-10 w-full rounded-lg border border-[#d1d5db] px-3 text-[14px]"
                  />
                </label>

                <label className="mt-3 block">
                  <span className="mb-1 block text-[12px] text-[#6b7280]">
                    Anything we should know
                  </span>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={2}
                    placeholder="Optional"
                    className="w-full rounded-lg border border-[#d1d5db] px-3 py-2 text-[14px]"
                  />
                </label>

                <button
                  type="button"
                  onClick={() => void accept()}
                  disabled={busy}
                  className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#2f4f6f] text-[15px] font-semibold text-white disabled:opacity-60"
                >
                  {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                  Accept and proceed
                </button>

                <p className="mt-3 text-[12px] text-[#6b7280]">
                  Not ready to confirm? Simply reply to the email — we are happy to adjust
                  anything.
                </p>
              </div>
            </>
          )}
        </main>

        <p className="mt-4 text-center text-[11.5px] text-[#9ca3af]">
          Aashish Logistics Global · Chennai · Business is transacted subject to our standard
          trading conditions.
        </p>
      </div>
    </div>
  );
}

function Summary({ quote }: { quote: PublicQuote }) {
  const lane = [quote.origin, quote.destination].filter(Boolean).join(" → ");
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-[#6b7280]">Prepared for</p>
          <p className="text-[15px] font-semibold">{quote.customer ?? "—"}</p>
        </div>
        <div className="text-right text-[12.5px] leading-relaxed text-[#6b7280]">
          <p>
            <strong className="text-[#1f2937]">Ref</strong> {quote.reference}
            {quote.version > 1 ? `/${quote.version}` : ""}
          </p>
          <p>
            <strong className="text-[#1f2937]">Date</strong> {longDate(quote.issued_on)}
          </p>
          {quote.valid_until && (
            <p>
              <strong className="text-[#1f2937]">Valid to</strong> {longDate(quote.valid_until)}
            </p>
          )}
        </div>
      </div>

      {(lane || quote.cargo) && (
        <div className="mt-4 rounded-lg bg-[#f9fafb] px-4 py-3 text-[13px]">
          {lane && <p className="font-medium">{lane}</p>}
          {quote.cargo && <p className="text-[#6b7280]">{quote.cargo}</p>}
        </div>
      )}

      <table className="mt-5 w-full text-[13px]">
        <thead>
          <tr className="border-b border-[#e5e7eb] text-left text-[10.5px] uppercase tracking-wide text-[#6b7280]">
            <th className="py-2 font-medium">Charge</th>
            <th className="py-2 text-right font-medium">Qty</th>
            <th className="py-2 text-right font-medium">Rate</th>
            <th className="py-2 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {quote.lines.map((l, n) => (
            <tr key={n} className="border-b border-[#f1f2f4]">
              <td className="py-2.5 pr-2">
                {l.description}
                <span className="block text-[11.5px] text-[#9ca3af]">{l.unit}</span>
              </td>
              <td className="py-2.5 text-right tabular-nums">{fmt(l.quantity)}</td>
              <td className="whitespace-nowrap py-2.5 text-right tabular-nums">
                {l.currency} {fmt(l.rate)}
              </td>
              <td className="whitespace-nowrap py-2.5 text-right font-medium tabular-nums">
                {money(l.amount_inr)}
              </td>
            </tr>
          ))}
          {!quote.lines.length && (
            <tr>
              <td colSpan={4} className="py-3 text-[#6b7280]">
                Charges as discussed.
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3} className="py-3 text-right text-[14px] font-semibold">
              Total
            </td>
            <td className="whitespace-nowrap py-3 text-right text-[16px] font-bold tabular-nums">
              {money(quote.amount_inr)}
            </td>
          </tr>
        </tfoot>
      </table>

      {quote.terms?.length > 0 && (
        <div className="mt-5">
          <p className="text-[11px] uppercase tracking-wide text-[#6b7280]">Terms</p>
          <ol className="mt-1.5 list-decimal pl-5 text-[12px] leading-relaxed text-[#6b7280]">
            {quote.terms
              .filter((t) => t.text?.trim())
              .map((t, n) => (
                <li key={n} className="mb-1">
                  {t.text}
                </li>
              ))}
          </ol>
        </div>
      )}
    </>
  );
}

/** Every state that is not "waiting for you", said plainly. */
function Closed({ quote }: { quote: PublicQuote }) {
  const copy: Record<Exclude<QuoteLinkState, "open">, { title: string; body: string }> = {
    accepted: {
      title: "Thank you — this quotation is accepted",
      body: `We have it${
        quote.accepted_name ? ` from ${quote.accepted_name}` : ""
      }${quote.accepted_at ? ` on ${longDate(quote.accepted_at)}` : ""}. Our team will be in touch with the booking details. There is nothing further for you to do here.`,
    },
    expired: {
      title: "This quotation has expired",
      body: "Rates move, so our quotations carry a validity date and this one has passed. Reply to the email it came from and we will re-quote — usually the same day.",
    },
    revoked: {
      title: "This quotation has been withdrawn",
      body: "It has been replaced by a newer version. Please use the most recent quotation we sent, or reply to the email and we will resend it.",
    },
    declined: {
      title: "This quotation was closed",
      body: "It is recorded as not proceeding. If that is wrong, reply to the email and we will reopen it.",
    },
    unknown: {
      title: "We could not find this quotation",
      body: "The link may be incomplete or may have been superseded. Please reply to the email it came from and we will send it again.",
    },
  };
  const c = copy[quote.state as Exclude<QuoteLinkState, "open">] ?? copy.unknown;

  return (
    <>
      <Ended title={c.title} body={c.body} good={quote.state === "accepted"} />
      {quote.state === "accepted" && <div className="mt-6 opacity-70"><Summary quote={quote} /></div>}
    </>
  );
}

function Ended({ title, body, good }: { title: string; body: string; good?: boolean }) {
  return (
    <div className="py-6 text-center">
      <span
        className={`mx-auto grid h-11 w-11 place-items-center rounded-full ${
          good ? "bg-[#e7f6ee] text-[#0f6e56]" : "bg-[#f3f4f6] text-[#6b7280]"
        }`}
      >
        {good ? <Check size={20} /> : <AlertCircle size={20} />}
      </span>
      <p className="mt-3 text-[16px] font-semibold">{title}</p>
      <p className="mx-auto mt-1.5 max-w-sm text-[13px] leading-relaxed text-[#6b7280]">{body}</p>
    </div>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function longDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

const fmt = (n: number | null | undefined) =>
  n == null ? "—" : Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });

const money = (n: number | null | undefined) =>
  n == null ? "—" : `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
