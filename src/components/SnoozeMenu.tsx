import { useRef, useState } from "react";
import { AlarmClock, ChevronDown } from "lucide-react";
import { snoozeChoices, snoozeLabel } from "../lib/snoozeTimes";
import { useMenu } from "../lib/useMenu";

/**
 * Outlook's Snooze: later today, tomorrow, the weekend, next week, or a
 * chosen date and time. The message leaves the list and comes back to the
 * Inbox, unread, when the time comes (services/snooze.ts).
 */
export default function SnoozeMenu({ onPick, compact }: { onPick: (until: Date) => void; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  // Arrows, Escape and Tab work in it (lib/useMenu).
  const menu = useRef<HTMLDivElement>(null);
  useMenu(menu, open, () => setOpen(false));
  const [custom, setCustom] = useState("");
  const now = new Date();
  const choices = open ? snoozeChoices(now) : [];
  const pick = (d: Date) => {
    setOpen(false);
    setCustom("");
    onPick(d);
  };
  const customDate = custom ? new Date(custom) : null;
  const customOk = !!customDate && !Number.isNaN(customDate.getTime()) && customDate.getTime() > Date.now() + 60_000;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title="Snooze — bring it back later"
        aria-label="Snooze"
        className={`flex h-8 items-center gap-1 rounded-lg border border-border text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary ${compact ? "px-2" : "px-2.5"}`}
      >
        <AlarmClock size={13} />
        {!compact && <span>Snooze</span>}
        <ChevronDown size={11} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div ref={menu} className="absolute right-0 top-9 z-30 w-64 rounded-xl border border-border bg-surface-1 p-1 shadow-lg sm:left-0 sm:right-auto">
            <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-text-muted">Snooze until</p>
            {choices.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => pick(c.at)}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-text-primary hover:bg-surface-2"
              >
                <span>{c.label}</span>
                <span className="text-[11.5px] text-text-muted">{snoozeLabel(c.at, now)}</span>
              </button>
            ))}
            <div className="mt-1 border-t border-border px-2.5 pb-2 pt-2">
              <label className="block text-[11px] text-text-secondary">
                Choose a date and time
                <input
                  type="datetime-local"
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  className="mt-1 h-8 w-full text-[12.5px]"
                />
              </label>
              <button
                type="button"
                disabled={!customOk}
                onClick={() => customDate && pick(customDate)}
                className="mt-2 h-7 w-full rounded-lg bg-brand text-[12px] font-medium text-white hover:bg-brand-dark disabled:opacity-50"
              >
                Snooze{customOk ? ` until ${snoozeLabel(customDate!, now)}` : ""}
              </button>
              <p className="mt-2 text-[10.5px] leading-snug text-text-muted">
                It comes back to the Inbox, unread. If the CRM is closed at that time, it comes back the next time you open Mail.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
