import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, Loader2, MailCheck, PhoneCall, ShieldCheck } from "lucide-react";
import { confirmAcceptance, type Enquiry, type FiledMessage, type Quote } from "../services/enquiries";
import { mailIsLive } from "../services/backend";
import { acceptanceEvidence, type AcceptanceEvidence } from "../services/publicQuote";

/**
 * The customer's yes, in writing.
 *
 * ---------------------------------------------------------------------------
 * WHY A CALL IS NOT ENOUGH
 *
 * A caller saying "ok proceed pannunga" used to accept the quote and unlock the
 * booking. That is a container committed on a sentence in a transcript the ASR
 * guessed at -- on one real call it rendered the caller's Tamil as Kannada. If
 * the customer later says they never agreed, there is nothing to show them.
 *
 * So a phone yes is recorded as what it is: a verbal indication, shown here,
 * worth chasing. Acceptance is a written confirmation, and only that lets the
 * enquiry become a shipment.
 *
 * WHY THE DESK PRESSES THE BUTTON AND NOT A PARSER
 *
 * "Yes but can we do the 15th instead", "ok will confirm with my buyer",
 * "approved subject to the rate holding" -- deciding which of those is a yes is
 * exactly the judgement a person should make. The panel finds the candidate
 * replies and puts them in front of somebody; it does not read them.
 * ---------------------------------------------------------------------------
 */
export default function AcceptancePanel({
  enquiry,
  quotes,
  mail,
  onChanged,
  onRecheck,
}: {
  enquiry: Enquiry;
  quotes: Quote[];
  /** Correspondence already filed against this enquiry. */
  mail: FiledMessage[];
  onChanged: () => void;
  /**
   * Re-read the mailbox and the quotes, on demand.
   *
   * The candidates below come from correspondence loaded when the page opened,
   * so a reply that arrived since is invisible until somebody reloads — and
   * the same is true of an acceptance the customer made from the emailed link.
   * Waiting on a customer is exactly when a desk refreshes, so there is a
   * button for it rather than an instruction to press F5.
   */
  onRecheck?: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  /** What the last check found, so pressing it says something either way. */
  const [checked, setChecked] = useState<null | "found" | "nothing">(null);
  const [note, setNote] = useState("");

  const last = <T,>(xs: T[]): T | null => (xs.length ? xs[xs.length - 1] : null);

  const accepted = quotes.find((q) => q.status === "accepted" && q.accepted_via);

  /**
   * What the customer did, where they did it themselves.
   *
   * Only asked for once a quotation is accepted — there is nothing to read
   * before that, and a query per enquiry opened to find nothing is a query for
   * nothing. Null is the ordinary answer for an acceptance the desk recorded
   * off a reply, and is not an error.
   */
  const [evidence, setEvidence] = useState<AcceptanceEvidence | null>(null);
  useEffect(() => {
    if (!accepted) return;
    let live = true;
    void acceptanceEvidence(accepted.id)
      .then((e) => live && setEvidence(e))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [accepted?.id]);
  /** The one awaiting an answer. */
  const open = last(quotes.filter((q) => q.status === "sent" || q.status === "draft"));
  const verbal = quotes.find((q) => q.verbal_accept_at && q.status !== "accepted");

  /**
   * Replies that could be the confirmation.
   *
   * Anything filed against this enquiry that we did not send, arriving after
   * the quote went out -- a message that predates the price cannot be agreement
   * to it.
   *
   * Deliberately NOT narrowed to role "client". A customer who replies from an
   * address we have not seen before is exactly the person whose yes matters,
   * and they would come through as "other". The sender is shown on each row so
   * the desk can see who it is rather than trusting a label.
   */
  const candidates = useMemo(() => {
    const since = open?.sent_at ? new Date(open.sent_at).getTime() : 0;
    return mail
      .filter((m) => m.message.folder !== "sent")
      .filter((m) => new Date(m.message.receivedDateTime).getTime() >= since)
      .slice(0, 6);
  }, [mail, open]);

  async function confirm(via: "email" | "manual", messageId: string | null, why: string) {
    const quote = open ?? verbal;
    if (!quote) return;
    setBusy(messageId ?? "manual");
    setError(null);
    try {
      await confirmAcceptance(enquiry.ref, quote.id, via, messageId, why);
      setManual(false);
      setNote("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record the acceptance.");
    } finally {
      setBusy(null);
    }
  }

  // Nothing has been quoted, so there is nothing to accept.
  if (!accepted && !open && !verbal) return null;

  // ---- already confirmed ----
  if (accepted) {
    return (
      <section className="mt-4 card p-5">
        <h2 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-text-secondary mb-2">
          <ShieldCheck size={12} /> Acceptance
        </h2>
        {/*
          Said as plainly as the record allows.

          "The customer accepted this themselves" and "somebody here recorded an
          acceptance" are different claims, and only one of them is evidence you
          could show a customer who says they never agreed. The panel used to
          read the same for both.
        */}
        <p className="text-[13px] text-text-success">
          {evidence
            ? "The customer accepted this quotation themselves"
            : accepted.accepted_via === "email"
              ? "Confirmed in writing by the customer"
              : "Recorded as accepted by the desk"}{" "}
          — ₹{Number(accepted.amount_inr).toLocaleString("en-IN")}
        </p>

        {evidence ? (
          <p className="mt-1 text-[12px] text-text-secondary">
            Accepted from the emailed quotation
            {evidence.accepted_name ? ` by ${evidence.accepted_name}` : ""} on{" "}
            {new Date(evidence.accepted_at).toLocaleString("en-GB", {
              day: "2-digit",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
            .
          </p>
        ) : (
          accepted.acceptance_note && (
            <p className="mt-1 text-[12px] text-text-secondary">{accepted.acceptance_note}</p>
          )
        )}

        {/* Their own words, where they left any. */}
        {evidence?.accepted_note && (
          <p className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-[12px] italic text-text-secondary">
            &ldquo;{evidence.accepted_note}&rdquo;
          </p>
        )}
        {accepted.verbal_accept_at && (
          <p className="mt-1 text-[11px] text-text-muted">
            They had also agreed on the phone on{" "}
            {new Date(accepted.verbal_accept_at).toLocaleDateString()}.
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="mt-4 card p-5">
      <h2 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-text-secondary mb-3">
        <ShieldCheck size={12} /> Acceptance
      </h2>

      {verbal ? (
        <div className="flex items-start gap-2 rounded-lg bg-bg-warning px-3 py-2.5 text-[12px] text-text-warning mb-3">
          <PhoneCall size={13} className="mt-px shrink-0" />
          <span>
            <strong className="font-medium">Agreed on the call, not yet in writing.</strong> They
            said yes to ₹{Number(verbal.amount_inr).toLocaleString("en-IN")} on{" "}
            {new Date(verbal.verbal_accept_at!).toLocaleDateString()}. Send them the quotation and
            confirm from their reply — a booking needs something we can show them later.
          </span>
        </div>
      ) : (
        <p className="text-[12px] text-text-secondary mb-3">
          Quoted, waiting for the customer. Confirm from their reply once it arrives.
        </p>
      )}

      {/*
        Checking by hand.

        Nothing here polls: a reply arriving in Outlook, or a customer pressing
        accept on their phone, does not reach a page already open. The desk
        knows when it is waiting on somebody, so the check is a button — and it
        reports what it found, because a button that refreshes silently is one
        people press twice wondering whether it did anything.
      */}
      {onRecheck && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy !== null}
            onClick={async () => {
              setBusy("recheck");
              setError(null);
              const before = candidates.length;
              try {
                await onRecheck();
                // Read off the props after the parent reloads; if the parent
                // has not re-rendered yet this still reports honestly, because
                // "nothing" only means nothing was visible at that moment.
                setChecked(candidates.length > before ? "found" : "nothing");
              } catch (e) {
                setError(e instanceof Error ? e.message : "Could not check just now.");
              } finally {
                setBusy(null);
              }
            }}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] font-medium text-text-primary hover:bg-surface-2 disabled:opacity-60"
          >
            {busy === "recheck" ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <MailCheck size={13} />
            )}
            Check for their acceptance
          </button>
          {checked && busy === null && (
            <span className="text-[11.5px] text-text-muted">
              {checked === "found"
                ? "Something new came in — it is below."
                : "Nothing new since the quotation went out."}
            </span>
          )}
        </div>
      )}

      {/* ---- their replies ---- */}
      {!mailIsLive() ? (
        <p className="text-[12px] text-text-muted">
          Outlook is not connected on this session, so replies cannot be shown. Connect it on the
          Mail page, or record the confirmation below.
        </p>
      ) : !candidates.length ? (
        <p className="text-[12px] text-text-muted">
          Nothing back from them since the quotation went out.
        </p>
      ) : (
        <ul className="space-y-2">
          {candidates.map((m) => (
            <li
              key={m.message.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-[12px] text-text-primary truncate">{m.message.subject}</p>
                <p className="text-[12px] text-text-secondary line-clamp-2">
                  {m.message.bodyPreview}
                </p>
                <p className="mt-0.5 text-[11px] text-text-muted">
                  {m.message.from.emailAddress.address} ·{" "}
                  {new Date(m.message.receivedDateTime).toLocaleString()}
                </p>
              </div>
              <button
                onClick={() =>
                  void confirm(
                    "email",
                    m.message.id,
                    `Confirmed by email from ${m.message.from.emailAddress.address}`
                  )
                }
                disabled={busy !== null}
                className="shrink-0 flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-brand hover:bg-brand-dark disabled:opacity-60 text-white text-[12px] font-medium"
                title="Record this message as their acceptance"
              >
                {busy === m.message.id ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <MailCheck size={12} />
                )}
                This is their yes
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* ---- the escape hatch ---- */}
      <div className="mt-3 pt-3 border-t border-border">
        {manual ? (
          <div className="space-y-2">
            <label className="block">
              <span className="block text-[11px] text-text-secondary mb-1">
                Where did the confirmation come from?
              </span>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Signed quotation returned by WhatsApp, 3 Sept"
                className="w-full h-8"
                autoFocus
              />
            </label>
            <p className="text-[11px] text-text-muted">
              Recorded against your name. The database will not take a manual acceptance without
              this — one with no explanation cannot be told apart from a guess.
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void confirm("manual", null, note.trim())}
                disabled={!note.trim() || busy !== null}
                className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-brand hover:bg-brand-dark disabled:opacity-60 text-white text-[12px] font-medium"
              >
                {busy === "manual" ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Check size={13} />
                )}
                Record acceptance
              </button>
              <button
                onClick={() => setManual(false)}
                className="h-8 px-3 rounded-lg border border-border text-[12px] text-text-secondary hover:text-text-primary"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setManual(true)}
            className="text-[12px] text-text-secondary hover:text-text-primary underline underline-offset-2"
          >
            Confirmation came another way — record it
          </button>
        )}
      </div>

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}
    </section>
  );
}
