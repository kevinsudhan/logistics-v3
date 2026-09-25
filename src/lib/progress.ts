import { formatDate } from "./dates";
/**
 * How late a step is, in the words the desk uses.
 *
 * "Today" is India's today: the desk is in Chennai, and a step due on the 3rd
 * must not read as overdue at 1 a.m. on the 3rd because UTC is still on the
 * 2nd — or the other way round.
 */

export type DueState = "done" | "overdue" | "today" | "soon" | "later" | "none";

/** YYYY-MM-DD for today in Asia/Kolkata. */
export function todayIST(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
}

/** Whole days from `today` to `due` — negative when it has passed. */
export function daysUntil(due: string, today: string): number {
  const a = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  const b = Date.UTC(+due.slice(0, 4), +due.slice(5, 7) - 1, +due.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

export function dueState(dueOn: string | null, done: boolean, today: string): DueState {
  if (done) return "done";
  if (!dueOn) return "none";
  const d = daysUntil(dueOn, today);
  if (d < 0) return "overdue";
  if (d === 0) return "today";
  if (d <= 2) return "soon";
  return "later";
}

/** "3 days overdue", "due today", "due tomorrow", "due 5 Oct". */
export function dueText(dueOn: string | null, done: boolean, today: string): string {
  if (done || !dueOn) return "";
  const d = daysUntil(dueOn, today);
  if (d < -1) return `${-d} days overdue`;
  if (d === -1) return "1 day overdue";
  if (d === 0) return "due today";
  if (d === 1) return "due tomorrow";
  return `due ${formatDate(dueOn.slice(0, 10), { day: "numeric", month: "short" })}`;
}

/** The colour class a due state reads in. */
export const DUE_TONE: Record<DueState, string> = {
  done: "text-text-muted",
  overdue: "text-text-danger",
  today: "text-text-warning",
  soon: "text-text-secondary",
  later: "text-text-muted",
  none: "text-text-muted",
};
