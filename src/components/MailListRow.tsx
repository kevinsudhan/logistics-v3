import { AlertCircle, Paperclip } from "lucide-react";
import PushMailToQueue from "./PushMailToQueue";
import { initialsFor } from "../lib/initials";
import { looksLikeWebEnquiry } from "../services/webEnquiry";
import type { FolderId, MailMessage } from "../services/backend";
import type { Intake } from "../services/intake";
import { formatDate } from "../lib/dates";

/**
 * One message in the list.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT LOOKED LIKE BEFORE
 *
 * Three truncated lines of text per row, distinguished only by weight, and the
 * selected row filled with a blue wash. Fifty of those is a wall: nothing for
 * the eye to catch, and no way to find the Dashray thread except by reading
 * every line.
 *
 * THE AVATAR IS THE POINT
 *
 * A desk works by sender — "what did Dashray say", "has Qingdao come back" —
 * and two letters in a box is the fastest thing to scan a column for. It is the
 * same two letters the reading pane shows for the same sender, so the eye can
 * move between the list and the message without re-reading a name.
 *
 * WHY THE SELECTED ROW IS NOT BLUE ANY MORE
 *
 * It was --bg-accent, which is the colour of links, of the Web badge, and of
 * every accent chip in the product. Selection is not an accent; it is state.
 * It now reads the way the sidebar's active row does — a brand bar down the
 * left edge and a quiet surface change — so the two mean the same thing in the
 * two places a person looks for "where am I".
 *
 * UNREAD IS THE SAME BAR, UNFILLED
 *
 * A 6px brand dot rather than the old 1.5px one, in the gutter the selection
 * bar uses. Both answer "does this row want me", so they belong in the same
 * column rather than competing for the same eye in two different places.
 * ---------------------------------------------------------------------------
 */
export default function MailListRow({
  message,
  folder,
  selected,
  queued,
  onOpen,
  onChanged,
}: {
  message: MailMessage;
  folder: FolderId;
  selected: boolean;
  queued?: Pick<Intake, "id" | "status" | "enquiry_ref">;
  onOpen: () => void;
  onChanged: () => void;
}) {
  // In Sent, the useful name is who it went to. Everywhere else it is who sent.
  const other =
    folder === "sent"
      ? message.toRecipients[0]?.emailAddress
      : message.from.emailAddress;

  const who = other?.name?.trim() || other?.address || "—";
  const unread = !message.isRead && folder === "inbox";

  return (
    /*
      The row is a button and the queue control is a second one, so they are
      siblings inside the li rather than nested. A button inside a button is
      invalid, and browsers resolve it by dropping one of them.
    */
    <li
      className={`relative transition-colors ${
        selected ? "bg-surface-2" : "hover:bg-surface-2/70"
      }`}
    >
      {/* The state gutter, four columns wide by the time it reaches the avatar:
          the selection bar, a gap, the unread dot, a gap. Both marks can be on
          at once — a selected message can still be unread — so they each need
          their own space rather than sharing one. */}
      <span
        aria-hidden
        className={`absolute inset-y-1 left-0 w-[3px] rounded-full transition-opacity ${
          selected ? "bg-brand opacity-100" : "opacity-0"
        }`}
      />

      <span className="absolute right-2 top-2.5 z-10">
        <PushMailToQueue message={message} queued={queued} size="icon" onChanged={onChanged} />
      </span>

      <button onClick={onOpen} className="flex w-full gap-2.5 py-2.5 pl-4 pr-9 text-left">
        <span className="relative shrink-0">
          <span
            className={`grid size-8 place-items-center rounded-lg border text-[11px] font-semibold tracking-wide transition-colors ${
              selected
                ? "border-brand/25 bg-bg-success text-text-success"
                : "border-border bg-surface-2 text-text-secondary"
            }`}
            aria-hidden
          >
            {initialsFor(other?.name, other?.address)}
          </span>
          {unread && (
            <span
              className="absolute -left-[10px] top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-brand"
              aria-label="Unread"
            />
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span
              className={`min-w-0 flex-1 truncate text-[13px] ${
                unread ? "font-semibold text-text-primary" : "text-text-primary"
              }`}
            >
              {who}
            </span>

            {message.importance === "high" && (
              <AlertCircle size={11} className="shrink-0 text-text-danger" />
            )}
            {message.hasAttachments && (
              <Paperclip size={11} className="shrink-0 text-text-muted" />
            )}
            {looksLikeWebEnquiry(message) && (
              <span className="shrink-0 rounded-full border border-text-accent/25 bg-bg-accent px-1.5 py-0.5 text-[10px] font-medium text-text-accent">
                Web
              </span>
            )}
            <span className="shrink-0 text-[11px] tabular-nums text-text-muted">
              {shortTime(message.receivedDateTime)}
            </span>
          </span>

          <span
            className={`mt-0.5 block truncate text-[12.5px] ${
              unread ? "font-medium text-text-primary" : "text-text-secondary"
            }`}
          >
            {message.subject}
          </span>

          {/* The preview earns its line only when it says something the subject
              did not. Graph sends an empty string for a body-less message, and
              a blank third row on every one of those made the list ragged. */}
          {message.bodyPreview?.trim() && (
            <span className="mt-0.5 block truncate text-[11.5px] text-text-muted">
              {message.bodyPreview}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

/** Today shows a clock; anything older shows a date. */
function shortTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();

  return sameDay
    ? d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })
    : d.getFullYear() === now.getFullYear()
      ? formatDate(d, { day: "numeric", month: "short" })
      : formatDate(d, { day: "numeric", month: "short", year: "2-digit" });
}
