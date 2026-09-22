import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";

/**
 * A section that can be folded away.
 *
 * ---------------------------------------------------------------------------
 * WHY THE STATE IS REMEMBERED PER PERSON
 *
 * Because which sections matter is a property of the job someone does, not of
 * the enquiry. Somebody who never touches dangerous goods should close that
 * section once, not once per enquiry — and a page that reopens everything on
 * every visit is a page where collapsing is pointless.
 *
 * It is kept in `localStorage` rather than on the record for the same reason:
 * it is one person's preference, and writing it to the enquiry would mean one
 * operator's folded section being folded for everybody.
 *
 * WHY EVERY ACCESS IS WRAPPED
 *
 * `localStorage` throws in a private window and in a browser with site data
 * blocked — not returns null, throws. An unguarded read here would blank the
 * whole page for those people, over a remembered chevron.
 *
 * WHY IT IS NOT <details>
 *
 * The native element is tempting and would be less code, but it cannot animate,
 * it fights the card styling, and its open state cannot be controlled without
 * re-implementing most of this anyway.
 * ---------------------------------------------------------------------------
 */
export default function Collapsible({
  id,
  title,
  icon,
  hint,
  action,
  badge,
  defaultOpen = true,
  children,
}: {
  /**
   * Stable key for remembering this section's state.
   *
   * Per SECTION, not per enquiry: "I never use dangerous goods" is a fact about
   * the person, and keying it by enquiry would ask them to say it again on
   * every job.
   */
  id: string;
  title: string;
  icon?: React.ReactNode;
  hint?: string;
  /** Rendered on the right, outside the toggle — an Edit button still works. */
  action?: React.ReactNode;
  /** A short count or status shown beside the title while collapsed. */
  badge?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  // Read after mount rather than in the initialiser: it keeps the first render
  // identical for everyone, and a throwing storage cannot take the page with it.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`section:${id}`);
      if (saved === "open") setOpen(true);
      else if (saved === "closed") setOpen(false);
    } catch {
      // No storage. The default stands and nothing is remembered, which is the
      // correct behaviour rather than a failure.
    }
  }, [id]);

  function toggle() {
    setOpen((was) => {
      const next = !was;
      try {
        localStorage.setItem(`section:${id}`, next ? "open" : "closed");
      } catch {
        // Remembering is a convenience; folding still works without it.
      }
      return next;
    });
  }

  return (
    <section className="card mt-4">
      <div className="flex items-center justify-between gap-3 px-5 py-3.5">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <ChevronDown
            size={13}
            className={`shrink-0 text-text-muted transition-transform ${open ? "" : "-rotate-90"}`}
          />
          {icon}
          <h2 className="text-[11px] font-medium uppercase tracking-wide text-text-secondary">
            {title}
          </h2>
          {badge && <span className="text-[11px] text-text-muted">{badge}</span>}
          {/* The hint only while open: collapsed, it is a second line of text
              under a heading nobody is reading. */}
          {open && hint && (
            <span className="ml-1 hidden truncate text-[11px] text-text-muted sm:inline">
              {hint}
            </span>
          )}
        </button>
        {action && <div className="shrink-0">{action}</div>}
      </div>

      {open && <div className="border-t border-border px-5 py-4">{children}</div>}
    </section>
  );
}
