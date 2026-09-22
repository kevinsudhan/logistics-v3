import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, Check, Loader2, RefreshCw, ShieldCheck, Undo2 } from "lucide-react";
import PageHeader from "../components/PageHeader";
import QuoteCharges from "../components/QuoteCharges";
import { useAuth } from "../lib/auth";
import { money } from "../services/charges";
import {
  decide,
  pendingQuotes,
  waitingFor,
  type PendingQuote,
} from "../services/quoteApproval";

/**
 * Quotations waiting to be cleared.
 *
 * ---------------------------------------------------------------------------
 * WHY THE CHARGES ARE ON THE PAGE AND NOT BEHIND A LINK
 *
 * Because the decision is about the figures. An approval screen showing a
 * total and an "approve" button is a screen that trains somebody to press
 * approve — there is nothing else on it to do, and going and looking properly
 * costs a navigation each time. The breakdown is what is being approved, so
 * the breakdown is what is shown.
 *
 * WHY SENDING BACK NEEDS A REASON AND APPROVING DOES NOT
 *
 * Approval says "this is right", which needs no elaboration. A rejection is an
 * instruction to somebody else, and one without a reason produces the same
 * quotation resubmitted unchanged an hour later. The server insists on it too,
 * so the rule holds whatever calls it.
 *
 * WHY AN APPROVER CANNOT CLEAR THEIR OWN
 *
 * Enforced in `decide_quote`, not here. A check that lives only in the browser
 * is a check that a modified request skips, and this is the one rule that makes
 * the step worth having.
 * ---------------------------------------------------------------------------
 */
export default function QuoteApprovals() {
  const { session } = useAuth();
  const [rows, setRows] = useState<PendingQuote[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await pendingQuotes());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the queue.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(q: PendingQuote, approve: boolean) {
    setBusy(q.id);
    setError(null);
    try {
      await decide(q.id, approve, note[q.id] ?? "");
      setNote((n) => ({ ...n, [q.id]: "" }));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not go through.");
    } finally {
      setBusy(null);
    }
  }

  if (!session?.canApproveQuotes)
    return (
      <div>
        <PageHeader title="Quote approvals" />
        <div className="rounded-card border border-dashed border-border-strong bg-surface-1 p-10 text-center">
          <ShieldCheck size={20} className="mx-auto text-text-muted" />
          <p className="mt-2 text-[14px] font-medium text-text-primary">Not your queue</p>
          <p className="mx-auto mt-1 max-w-md text-[13px] text-text-secondary">
            Clearing a quotation commits the company to a price, so it is limited to the people
            named as approvers. Ask an administrator if that should include you.
          </p>
        </div>
      </div>
    );

  return (
    <div>
      <PageHeader
        title="Quote approvals"
        subtitle="Quotations waiting to be cleared before they go to a customer. Oldest first — the one at the top is the one holding somebody up."
        action={
          <button
            type="button"
            onClick={() => void load()}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary hover:text-text-primary"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        }
      />

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      {loading && !rows.length ? (
        <p className="py-8 text-[13px] text-text-muted">Loading…</p>
      ) : !rows.length ? (
        <div className="rounded-card border border-dashed border-border-strong bg-surface-1 p-10 text-center">
          <Check size={20} className="mx-auto text-text-success" />
          <p className="mt-2 text-[14px] font-medium text-text-primary">Nothing waiting</p>
          <p className="mx-auto mt-1 max-w-md text-[13px] text-text-secondary">
            Every quotation submitted has been dealt with.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((q) => {
            const mine = q.submitted_by === session.userId;
            const e = q.enquiry;
            const lane = [e?.origin, e?.destination].filter(Boolean).join(" → ");
            return (
              <article key={q.id} className="card p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-[14px] font-medium text-text-primary">
                      {e?.customer?.company || e?.customer?.name || "Unknown customer"}
                      <Link
                        to={`/enquiries/${q.enquiry_ref}`}
                        className="font-mono text-[12px] font-normal text-text-accent hover:underline"
                      >
                        {q.enquiry_ref}
                      </Link>
                      <span className="text-[12px] font-normal text-text-muted">v{q.version}</span>
                    </p>
                    <p className="mt-0.5 text-[12px] text-text-secondary">
                      {lane || "Lane not recorded"}
                      {e?.cargo ? ` · ${e.cargo}` : ""}
                      {q.basis ? ` · ${q.basis}` : ""}
                    </p>
                    <p className="mt-0.5 text-[11.5px] text-text-muted">
                      Submitted by {q.submitted_by_name ?? "somebody"} ·{" "}
                      {waitingFor(q.submitted_at)} ago
                      {q.valid_until ? ` · valid to ${q.valid_until}` : ""}
                    </p>
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="text-[10px] uppercase tracking-wide text-text-muted">Quoted</p>
                    <p className="text-[18px] font-semibold tabular-nums text-text-primary">
                      {money(q.amount_inr)}
                    </p>
                  </div>
                </div>

                {/* The breakdown, which is the thing actually being approved. */}
                <div className="mt-4 border-t border-border pt-4">
                  <button
                    type="button"
                    onClick={() => setOpen(open === q.id ? null : q.id)}
                    className="text-[12px] text-text-secondary hover:text-text-primary"
                  >
                    {open === q.id ? "Hide the charges" : "Show the charges"}
                  </button>
                  {open === q.id && (
                    <div className="mt-3">
                      <QuoteCharges quoteId={q.id} locked />
                    </div>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
                  <input
                    value={note[q.id] ?? ""}
                    onChange={(ev) => setNote((n) => ({ ...n, [q.id]: ev.target.value }))}
                    placeholder="Reason, if you are sending it back"
                    className="h-8 min-w-[220px] flex-1"
                  />
                  <button
                    type="button"
                    disabled={busy === q.id || mine}
                    onClick={() => void act(q, false)}
                    className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] text-text-secondary hover:border-border-strong hover:text-text-danger disabled:opacity-50"
                  >
                    <Undo2 size={13} /> Send back
                  </button>
                  <button
                    type="button"
                    disabled={busy === q.id || mine}
                    onClick={() => void act(q, true)}
                    className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-medium text-white hover:bg-brand-dark disabled:opacity-50"
                  >
                    {busy === q.id ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Check size={13} />
                    )}
                    Approve
                  </button>
                </div>

                {mine && (
                  <p className="mt-2 text-[11.5px] text-text-muted">
                    You submitted this one, so somebody else has to clear it. That is the whole
                    point of the step.
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
