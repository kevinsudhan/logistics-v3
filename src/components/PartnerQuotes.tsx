import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  Check,
  Loader2,
  Mail,
  RefreshCw,
  Send,
  Trophy,
  X,
} from "lucide-react";
import AskPartners from "./AskPartners";
import { useAuth } from "../lib/auth";
import { mailIsLive } from "../services/backend";
import {
  QUOTE_STATUS_LABEL,
  bestOf,
  findReplies,
  listQuotes,
  markNoReply,
  readQuote,
  recordReply,
  setQuote,
  type PartnerQuote,
  type QuoteStatus,
} from "../services/rfq";
import type { Enquiry } from "../services/enquiries";
import { SectionSkeleton } from "./Loading";
import { formatDate } from "../lib/dates";
import { useLiveVersion } from "../lib/liveVersions";

/**
 * What the partners came back with.
 *
 * ---------------------------------------------------------------------------
 * THE CHECK RUNS WHEN SOMEBODY LOOKS
 *
 * There is no server watching the mailbox: mail is read with the signed-in
 * person's own delegated token, which exists only while they are here. So
 * replies are looked for when the enquiry is opened, which is exactly the
 * moment the answer matters.
 *
 * It runs once per visit rather than on a timer. A partner who replies while
 * this page is open is found on the next refresh, and a poll every thirty
 * seconds would spend somebody's Graph quota to shave a minute off news that
 * waits hours anyway.
 *
 * A READING, NOT A RECORD
 *
 * The rate shown against each partner is pulled out of their mail by a model,
 * and it can be wrong — so it is always editable, and the mail it came from is
 * always one click away. The figure on screen is a convenience; the message is
 * the evidence.
 * ---------------------------------------------------------------------------
 */

const TONE: Record<QuoteStatus, string> = {
  asked: "border-border bg-surface-2 text-text-secondary",
  replied: "border-text-accent/25 bg-bg-accent text-text-accent",
  quoted: "border-text-success/25 bg-bg-success text-text-success",
  declined: "border-text-warning/25 bg-bg-warning text-text-warning",
  no_reply: "border-border bg-surface-2 text-text-muted",
};

export default function PartnerQuotes({ enquiry }: { enquiry: Enquiry }) {
  const { session } = useAuth();
  const [rows, setRows] = useState<PartnerQuote[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<PartnerQuote | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await listQuotes(enquiry.ref));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the partner quotes.");
    } finally {
      setLoading(false);
    }
  }, [enquiry.ref]);

  // Changed by anybody, read again (the page's subscription, 084).
  const live = useLiveVersion("partner_quotes");
  useEffect(() => {
    void load();
  }, [load, live]);

  /**
   * Looks for replies, and reads a rate out of each one it finds.
   *
   * The reply is recorded even when the reading fails. "They answered and the
   * figure needs reading by a person" is a real state and a useful one; losing
   * the whole reply because a model call failed would not be.
   */
  const check = useCallback(
    async (quiet = false) => {
      const mailbox = session?.email;
      if (!mailbox || !mailIsLive()) return;
      const waiting = rows.filter((r) => r.status === "asked" && r.conversation_id);
      if (!waiting.length) return;

      setChecking(true);
      if (!quiet) setError(null);
      try {
        const found = await findReplies(mailbox, waiting);
        for (const { quote, message } of found) {
          const reading = await readQuote(message).catch(() => null);
          await recordReply(quote.id, {
            messageId: message.id,
            repliedAt: message.receivedDateTime,
            amount: reading?.amount ?? null,
            currency: reading?.currency ?? null,
            transitDays: reading?.transit_days ?? null,
            validUntil: reading?.valid_until ?? null,
            notes: reading?.notes ?? null,
            declined: reading?.declined ?? false,
          });
        }
        if (found.length) {
          setNotice(`${found.length} repl${found.length === 1 ? "y" : "ies"} found.`);
          await load();
        } else if (!quiet) {
          setNotice("No replies yet.");
        }
      } catch (e) {
        if (!quiet) setError(e instanceof Error ? e.message : "Could not check for replies.");
      } finally {
        setChecking(false);
      }
    },
    [rows, session?.email, load]
  );

  // One quiet sweep when the rows first land, so opening the enquiry is the
  // check. Guarded on the row list so it does not run before there is anything
  // to look for.
  const [swept, setSwept] = useState(false);
  useEffect(() => {
    if (loading || swept || !rows.some((r) => r.status === "asked")) return;
    setSwept(true);
    void check(true);
  }, [loading, swept, rows, check]);

  const best = bestOf(rows);

  return (
    <section className="card mt-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[13px] font-medium text-text-primary">
            <Send size={13} /> Partner quotes
          </h2>
          <p className="mt-0.5 text-[11.5px] text-text-muted">
            Ask several partners for a rate at once. Each is written to separately, so replies stay
            attributable and nobody sees who else was asked.
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {rows.some((r) => r.status === "asked") && (
            <button
              onClick={() => void check(false)}
              disabled={checking}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary disabled:opacity-60"
            >
              <RefreshCw size={12} className={checking ? "animate-spin" : ""} />
              {checking ? "Checking…" : "Check for replies"}
            </button>
          )}
          <button
            onClick={() => setAsking(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-medium text-white transition-colors hover:bg-brand-dark"
          >
            <Send size={12} />
            {rows.length ? "Ask more partners" : "Ask partners"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}
      {notice && (
        <p className="mt-3 text-[11.5px] text-text-muted">{notice}</p>
      )}

      {loading ? (
        <SectionSkeleton lines={2} className="mt-3" />
      ) : rows.length === 0 ? (
        <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2.5 text-[12px] text-text-secondary">
          No partner has been asked about this enquiry yet.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {rows.map((q) => (
            <li key={q.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium text-text-primary">
                    {q.partner_label || q.partner_email}
                  </span>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${TONE[q.status]}`}
                  >
                    {QUOTE_STATUS_LABEL[q.status]}
                  </span>
                  {best?.id === q.id && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-text-success/25 bg-bg-success px-2 py-0.5 text-[10.5px] font-medium text-text-success">
                      <Trophy size={10} /> Lowest
                    </span>
                  )}
                </div>

                <p className="mt-0.5 text-[11.5px] text-text-muted">
                  {q.partner_label ? `${q.partner_email} · ` : ""}
                  asked {formatDate(q.sent_at, {
                    day: "numeric",
                    month: "short",
                  })}
                  {q.replied_at &&
                    ` · replied ${formatDate(q.replied_at, {
                      day: "numeric",
                      month: "short",
                    })}`}
                </p>

                {(q.amount != null || q.transit_days != null || q.valid_until) && (
                  <p className="mt-1 flex flex-wrap items-baseline gap-x-3 text-[12.5px]">
                    {q.amount != null && (
                      <span className="font-medium text-text-primary">
                        {q.currency ? `${q.currency} ` : ""}
                        <span className="tabular-nums">{q.amount.toLocaleString("en-IN")}</span>
                      </span>
                    )}
                    {q.transit_days != null && (
                      <span className="text-text-secondary">{q.transit_days}d transit</span>
                    )}
                    {q.valid_until && (
                      <span className="text-text-muted">
                        valid to{" "}
                        {formatDate(q.valid_until, {
                          day: "numeric",
                          month: "short",
                        })}
                      </span>
                    )}
                  </p>
                )}

                {q.quote_notes && (
                  <p className="mt-0.5 text-[11.5px] leading-relaxed text-text-secondary">
                    {q.quote_notes}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* The mail itself. The figure above is a reading; this is the
                    evidence, and it is always one click away. */}
                {q.reply_message_id && (
                  <Link
                    to={`/mail?open=${encodeURIComponent(q.reply_message_id)}`}
                    className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-2.5 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
                  >
                    <Mail size={12} /> Open the reply
                  </Link>
                )}
                {q.status !== "asked" && (
                  <button
                    onClick={() => setEditing(q)}
                    className="h-7 rounded-lg border border-border bg-surface-1 px-2.5 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
                  >
                    {q.amount != null ? "Correct" : "Enter the rate"}
                  </button>
                )}
                {q.status === "asked" && (
                  <button
                    onClick={() =>
                      void markNoReply(q.id)
                        .then(load)
                        .catch((e) => setError(e instanceof Error ? e.message : "That did not work."))
                    }
                    title="Stop waiting on this one"
                    className="h-7 rounded-lg border border-border bg-surface-1 px-2.5 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
                  >
                    No reply
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {asking && (
        <AskPartners
          enquiry={enquiry}
          fromName={session?.name ?? ""}
          onClose={() => setAsking(false)}
          onSent={(result) => {
            setAsking(false);
            setSwept(false);
            setNotice(
              result.failed.length
                ? `Asked ${result.sent.length}. Could not reach ${result.failed
                    .map((f) => f.label || f.email)
                    .join(", ")} — ${result.failed[0].reason}`
                : `Asked ${result.sent.length} partner${result.sent.length === 1 ? "" : "s"}.`
            );
            void load();
          }}
        />
      )}

      {editing && (
        <EditQuote
          quote={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </section>
  );
}

/**
 * Putting the rate right by hand.
 *
 * The reading is a model's, and a rate somebody quotes a customer from has to be
 * correctable by the person who read the mail. Blank clears the figure rather
 * than leaving a wrong one standing.
 */
function EditQuote({
  quote,
  onClose,
  onSaved,
}: {
  quote: PartnerQuote;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState(quote.amount != null ? String(quote.amount) : "");
  const [currency, setCurrency] = useState(quote.currency ?? "");
  const [transit, setTransit] = useState(quote.transit_days != null ? String(quote.transit_days) : "");
  const [valid, setValid] = useState(quote.valid_until ?? "");
  const [notes, setNotes] = useState(quote.quote_notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const n = amount.trim() === "" ? null : Number(amount.replace(/,/g, ""));
      if (n != null && !Number.isFinite(n)) throw new Error("That amount is not a number.");
      await setQuote(quote.id, {
        amount: n,
        currency: currency.trim().toUpperCase() || null,
        transitDays: transit.trim() === "" ? null : Number(transit),
        validUntil: valid || null,
        notes: notes.trim() || null,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that.");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card w-full max-w-sm shadow-pop"
        role="dialog"
        aria-label="Correct the rate"
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="min-w-0 truncate text-[13px] font-medium text-text-primary">
            {quote.partner_label || quote.partner_email}
          </h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <X size={15} />
          </button>
        </header>

        <div className="space-y-3 px-4 py-3">
          <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2">
            <label className="text-[12px] leading-8 text-text-secondary">Currency</label>
            <input
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              placeholder="USD"
              className="w-full"
            />
            <label className="text-[12px] leading-8 text-text-secondary">Amount</label>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="Blank to clear"
              className="w-full"
            />
            <label className="text-[12px] leading-8 text-text-secondary">Transit</label>
            <input
              value={transit}
              onChange={(e) => setTransit(e.target.value)}
              inputMode="numeric"
              placeholder="Days"
              className="w-full"
            />
            <label className="text-[12px] leading-8 text-text-secondary">Valid to</label>
            <input
              type="date"
              value={valid}
              onChange={(e) => setValid(e.target.value)}
              className="w-full"
            />
          </div>

          <label className="block">
            <span className="mb-1 block text-[12px] text-text-secondary">Notes</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full"
            />
          </label>

          {error && <p className="text-[11.5px] text-text-danger">{error}</p>}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button
            onClick={onClose}
            className="h-8 rounded-lg border border-border px-3 text-[12px] text-text-secondary hover:border-border-strong hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            onClick={() => void save()}
            disabled={busy}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-medium text-white hover:bg-brand-dark disabled:opacity-60"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            Save
          </button>
        </footer>
      </div>
    </div>
  );
}
