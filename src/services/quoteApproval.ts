import { supabase } from "../lib/supabase";
import type { Customer, Enquiry, Quote } from "./enquiries";
import type { QuoteLine } from "./quoteLines";

/**
 * Nothing goes to a customer until somebody senior has seen it.
 *
 * ---------------------------------------------------------------------------
 * WHY TWO STATUSES AND NOT ONE
 *
 * `status` is where the quotation is with the CUSTOMER — draft, sent, accepted.
 * `approval_status` is where it is with US. Both have to be right before a
 * quotation can leave, and folding them into one column produces states like
 * "sent but not approved" that mean nothing to either side.
 *
 * WHY THE DECISIONS ARE RPCs
 *
 * Each carries a rule the browser cannot be trusted with: only an approver may
 * approve, and nobody may approve their own. The second is the one that
 * matters — an approval step you can perform on your own work is not an
 * approval step, and a check written in the client is a check that a modified
 * request skips.
 * ---------------------------------------------------------------------------
 */

export type ApprovalStatus = "draft" | "pending" | "approved" | "rejected";

/** One line of the terms printed under the charges. */
export interface QuoteTerm {
  /** 'general', or a mode: 'air', 'sea_lcl', 'sea_fcl', 'road'. */
  scope: string;
  text: string;
}

/** A quote waiting for a decision, with enough of its enquiry to judge it by. */
export interface PendingQuote extends Quote {
  enquiry: (Enquiry & { customer: Customer | null }) | null;
  submitted_by_name: string | null;
  /** The charges, in order — for the sale / buy / profit breakdown. */
  lines: QuoteLine[];
}

/** Ask for a quotation to be cleared. */
export async function submitForApproval(quoteId: string): Promise<Quote> {
  const { data, error } = await supabase.rpc("submit_quote_for_approval", {
    p_quote_id: quoteId,
  });
  if (error) throw new Error(error.message);
  return data as Quote;
}

/**
 * Clear it, or send it back.
 *
 * A rejection needs a reason and the server insists on one: a quotation
 * returned with no note is a quotation that gets resubmitted unchanged.
 */
export async function decide(quoteId: string, approve: boolean, note = ""): Promise<Quote> {
  const { data, error } = await supabase.rpc("decide_quote", {
    p_quote_id: quoteId,
    p_approve: approve,
    p_note: note,
  });
  if (error) throw new Error(error.message);
  return data as Quote;
}

/**
 * Clear it yourself, saying why (091).
 *
 * For when the approvers are out and the customer is waiting. The reason goes
 * to the administrators, who can accept it or withdraw the approval while the
 * quotation has not gone. The server refuses a reason under ten characters,
 * and a quotation an approver has sent back.
 */
export async function selfApprove(quoteId: string, reason: string): Promise<Quote> {
  const { data, error } = await supabase.rpc("self_approve_quote", { p_quote_id: quoteId, p_reason: reason });
  if (error) throw new Error(error.hint ? `${error.message}. ${error.hint}` : error.message);
  return data as Quote;
}

/** An administrator's answer to a self-approval: fine, or withdrawn with a note. */
export async function reviewSelfApproval(quoteId: string, withdraw: boolean, note = ""): Promise<Quote> {
  const { data, error } = await supabase.rpc("review_self_approval", { p_quote_id: quoteId, p_withdraw: withdraw, p_note: note });
  if (error) throw new Error(error.message);
  return data as Quote;
}

/** The self-approvals no administrator has looked at yet, newest first. */
export async function selfApprovalsToReview(): Promise<PendingQuote[]> {
  const { data, error } = await supabase
    .from("quotes")
    .select("*, enquiry:enquiries(*, customer:customers(*)), lines:quote_lines(*)")
    .eq("self_approved", true)
    .is("self_approval_reviewed_at", null)
    .order("approved_at", { ascending: false });
  if (error) throw new Error(error.message);
  return withNames(((data ?? []) as unknown as PendingQuote[]).map((r) => ({ ...r, lines: [...(r.lines ?? [])].sort((a, b) => a.position - b.position) })));
}

/**
 * What is waiting for this person on the approvals page: the queue for an
 * approver, and the self-approvals to review as well for an administrator.
 */
export async function approvalCounts(isAdmin: boolean): Promise<number> {
  const pending = await supabase.from("quotes").select("id", { count: "exact", head: true }).eq("approval_status", "pending");
  const review = isAdmin
    ? await supabase.from("quotes").select("id", { count: "exact", head: true }).eq("self_approved", true).is("self_approval_reviewed_at", null)
    : { count: 0 };
  return (pending.count ?? 0) + (review.count ?? 0);
}

/**
 * The queue, oldest first.
 *
 * Oldest first because the queue is a promise to somebody: the quotation that
 * has been waiting three days is the one holding up a customer, and a list
 * sorted newest-first buries it under this morning's.
 */
export async function pendingQuotes(): Promise<PendingQuote[]> {
  const { data, error } = await supabase
    .from("quotes")
    // The charges come with the queue rather than one request per row: the
    // approver hovers across ten quotations, and each one must answer at once.
    .select("*, enquiry:enquiries(*, customer:customers(*)), lines:quote_lines(*)")
    .eq("approval_status", "pending")
    .order("submitted_at", { ascending: true });
  if (error) throw new Error(error.message);

  const rows = ((data ?? []) as unknown as PendingQuote[]).map((r) => ({
    ...r,
    lines: [...(r.lines ?? [])].sort((a, b) => a.position - b.position),
  }));
  return withNames(rows);
}

/** Who asked, resolved in one query rather than one per row. */
async function withNames(rows: PendingQuote[]): Promise<PendingQuote[]> {
  const ids = [...new Set(rows.map((r) => r.submitted_by).filter(Boolean))] as string[];
  if (!ids.length) return rows.map((r) => ({ ...r, submitted_by_name: null }));

  const { data: people } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .in("id", ids);
  const byId = new Map((people ?? []).map((p) => [p.id, p.full_name || p.email]));
  return rows.map((r) => ({
    ...r,
    submitted_by_name: r.submitted_by ? (byId.get(r.submitted_by) ?? null) : null,
  }));
}

/** Everything this desk's quotations say by default, for "fetch defaults". */
export async function defaultTerms(scopes: string[]): Promise<QuoteTerm[]> {
  const { data, error } = await supabase
    .from("quote_term_defaults")
    .select("scope, position, text")
    .eq("active", true)
    .in("scope", scopes)
    .order("scope")
    .order("position");
  if (error) throw new Error(error.message);
  return (data ?? []).map((t) => ({ scope: t.scope as string, text: t.text as string }));
}

/** The terms actually printed on one quotation. */
export async function saveTerms(quoteId: string, terms: QuoteTerm[]): Promise<void> {
  const { error } = await supabase
    .from("quotes")
    // Blank lines dropped here rather than on render: an empty numbered term on
    // a document a customer reads looks like something went missing.
    .update({ terms: terms.filter((t) => t.text.trim()) })
    .eq("id", quoteId);
  if (error) throw new Error(error.message);
}

/** Once sent, mark the quotation as gone. Approval is the gate; this is the act. */
export async function markSent(quoteId: string): Promise<void> {
  const { error } = await supabase
    .from("quotes")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", quoteId);
  if (error) throw new Error(error.message);
}

export const APPROVAL_LABEL: Record<ApprovalStatus, string> = {
  draft: "Not submitted",
  pending: "Waiting for approval",
  approved: "Approved to send",
  rejected: "Sent back",
};

/**
 * Can this quotation go to the customer?
 *
 * The single place that answers it, so the send button, the approval badge and
 * anything added later cannot disagree about what "ready" means.
 */
export const sendable = (q: Pick<Quote, "status"> & { approval_status?: ApprovalStatus }): boolean =>
  q.status === "draft" && q.approval_status === "approved";

/** How long something has been waiting, in the words people use. */
export function waitingFor(since: string | null): string {
  if (!since) return "";
  const hours = (Date.now() - new Date(since).getTime()) / 3_600_000;
  if (hours < 1) return "just now";
  if (hours < 24) return `${Math.floor(hours)}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
