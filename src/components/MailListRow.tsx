import { useRef } from "react";
import { AlarmClock, AlertCircle, Check, Flag, Paperclip } from "lucide-react";
import { snoozeLabel } from "../lib/snoozeTimes";
import PushMailToQueue from "./PushMailToQueue";
import Highlighted from "./Highlighted";
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
  count = 1,
  anyUnread,
  anyFlagged,
  highlight,
  showFolder,
  checked,
  selecting,
  onCheck,
  snoozedUntil,
  backFromSnooze,
  copyNote,
  onOpen,
  onWarm,
  onChanged,
}: {
  /** The conversation's newest message in this folder, which the row stands for. */
  message: MailMessage;
  folder: FolderId;
  selected: boolean;
  queued?: Pick<Intake, "id" | "status" | "enquiry_ref">;
  /** How many messages the conversation holds, as far as is known. */
  count?: number;
  /** Whether anything in the conversation is unread, not only the newest. */
  anyUnread?: boolean;
  /** Whether anything in the conversation is flagged for follow-up. */
  anyFlagged?: boolean;
  /**
   * A search result: the words searched for, marked in the name, the subject
   * and the line under them — which is the line of the message around the
   * first match rather than its opening, so it says why the mail is here.
   */
  highlight?: string[];
  /** A search across every folder: say which folder each result is in. */
  showFolder?: boolean;
  /** Ticked for a bulk action. */
  checked?: boolean;
  /** Anything in the list is ticked, so every row shows its box. */
  selecting?: boolean;
  /** Tick or untick; `shift` for everything since the last one. */
  onCheck?: (shift: boolean) => void;
  /** In the Snoozed folder: when it comes back. */
  snoozedUntil?: string;
  /** Returned from a snooze and not opened since: pinned to the top. */
  backFromSnooze?: boolean;
  /** Why mail the mailbox was copied on is here: "CC", or whose mail it is a copy of (lib/ccFilter). */
  copyNote?: { label: string; title: string } | null;
  onOpen: () => void;
  /**
   * Read the message ahead of the click (7 Oct): called when the pointer rests
   * on the row a moment, or the keyboard reaches it, so the body is usually
   * there by the time it is opened.
   */
  onWarm?: () => void;
  onChanged: () => void;
}) {
  const warmTimer = useRef(0);
  // A finger: read 50 ms into the touch unless it turned into a scroll
  // (pointercancel), or as it lifts. A mouse: after resting 80 ms.
  const warm = {
    onPointerEnter: (e: React.PointerEvent) => {
      if (e.pointerType === "touch") return;
      window.clearTimeout(warmTimer.current);
      if (onWarm) warmTimer.current = window.setTimeout(onWarm, 80);
    },
    onPointerLeave: (e: React.PointerEvent) => {
      if (e.pointerType !== "touch") window.clearTimeout(warmTimer.current);
    },
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType !== "touch" || !onWarm) return;
      window.clearTimeout(warmTimer.current);
      warmTimer.current = window.setTimeout(onWarm, 50);
    },
    onPointerUp: (e: React.PointerEvent) => {
      if (e.pointerType === "touch") onWarm?.();
    },
    onPointerCancel: () => window.clearTimeout(warmTimer.current),
    onFocus: () => onWarm?.(),
  };
  // In Sent and Drafts, the useful name is who it is to. Everywhere else it is who sent.
  const other =
    folder === "sent" || folder === "drafts"
      ? message.toRecipients[0]?.emailAddress
      : message.from.emailAddress;

  const who = other?.name?.trim() || other?.address || (folder === "drafts" ? "(no recipient yet)" : "—");
  const unread = (anyUnread ?? !message.isRead) && folder === "inbox";

  return (
    /*
      The row is a button and the queue control is a second one, so they are
      siblings inside the li rather than nested. A button inside a button is
      invalid, and browsers resolve it by dropping one of them.
    */
    <li
      className={`group relative transition-colors ${
        checked ? "bg-bg-accent/50" : selected ? "bg-surface-2" : "hover:bg-surface-2/70"
      }`}
    >
      {/*
        The tick box sits over the avatar, as Outlook's does: shown on hover,
        and on every row once anything is ticked. A click on the avatar ticks
        rather than opens, and Shift ticks a run.
      */}
      {onCheck && (
        <button
          type="button"
          role="checkbox"
          aria-checked={!!checked}
          aria-label={checked ? "Untick" : "Tick for a bulk action"}
          onClick={(e) => onCheck(e.shiftKey)}
          className={`absolute left-4 top-2.5 z-10 grid size-8 place-items-center rounded-lg border transition-opacity ${
            checked
              ? "border-brand bg-brand text-white opacity-100"
              : `border-border-strong bg-surface-1 text-transparent ${selecting ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"}`
          }`}
        >
          <Check size={15} strokeWidth={3} />
        </button>
      )}
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

      {/* A draft has not gone anywhere, so there is nothing to turn into work yet. */}
      {folder !== "drafts" && (
        <span className="absolute right-2 top-2.5 z-10">
          <PushMailToQueue message={message} queued={queued} size="icon" onChanged={onChanged} />
        </span>
      )}

      <button onClick={onOpen} {...warm} className="flex w-full gap-2.5 py-2.5 pl-4 pr-9 text-left">
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
              <Highlighted text={who} terms={highlight} />
            </span>

            {/* A conversation, not one message: how many, as Outlook counts them. */}
            {count > 1 && (
              <span
                title={`${count} messages in this conversation`}
                className="shrink-0 rounded-full border border-border bg-surface-1 px-1.5 text-[10.5px] font-medium tabular-nums leading-4 text-text-secondary"
              >
                {count}
              </span>
            )}
            {copyNote && (
              <span
                title={copyNote.title}
                className="max-w-[9rem] shrink-0 truncate rounded-full border border-border bg-surface-2 px-1.5 text-[10px] leading-4 text-text-secondary"
              >
                {copyNote.label}
              </span>
            )}
            {backFromSnooze && (
              <span className="flex shrink-0 items-center gap-0.5 rounded-full border border-text-accent/30 bg-bg-accent px-1.5 text-[10px] font-medium leading-4 text-text-accent">
                <AlarmClock size={10} /> Back from snooze
              </span>
            )}
            {snoozedUntil && (
              <span className="flex shrink-0 items-center gap-0.5 rounded-full border border-border bg-surface-2 px-1.5 text-[10px] leading-4 text-text-secondary" title="Comes back to the Inbox then">
                <AlarmClock size={10} /> {snoozeLabel(new Date(snoozedUntil))}
              </span>
            )}
            {(anyFlagged ?? message.flagged) && (
              <Flag size={11} className="shrink-0 fill-current text-text-danger" aria-label="Flagged" />
            )}
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
            {showFolder && message.folderLabel && (
              <span className="shrink-0 rounded-full border border-border bg-surface-2 px-1.5 text-[10px] font-medium leading-4 text-text-secondary">
                {message.folderLabel}
              </span>
            )}
            <span className="shrink-0 text-[11px] tabular-nums text-text-muted">
              {shortTime(message.receivedDateTime)}
            </span>
          </span>

          {/* Two lines for a search result, so a reference at the end of a long
              subject — where "[ALG09012-26]" always is — is not cut off. */}
          <span
            className={`mt-0.5 block text-[12.5px] ${highlight ? "line-clamp-2 break-words" : "truncate"} ${
              unread ? "font-medium text-text-primary" : "text-text-secondary"
            }`}
          >
            <Highlighted text={message.subject} terms={highlight} />
          </span>

          {/* The preview earns its line only when it says something the subject
              did not. Graph sends an empty string for a body-less message, and
              a blank third row on every one of those made the list ragged. */}
          {highlight && message.searchSnippet ? (
            // Two lines for a search result: the match is the point of the row.
            <span className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-text-secondary">
              <Highlighted text={message.searchSnippet} terms={highlight} />
            </span>
          ) : (
            message.bodyPreview?.trim() && (
              <span className="mt-0.5 block truncate text-[11.5px] text-text-muted">
                {message.bodyPreview}
              </span>
            )
          )}
        </span>
      </button>
    </li>
  );
}

/** Today shows a clock; anything older shows a date. */
export function shortTime(iso: string): string {
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
