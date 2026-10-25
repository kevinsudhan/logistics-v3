import { useEffect, useRef, type RefObject } from "react";

/**
 * A dialog that the keyboard can live in (25 Oct).
 *
 * ---------------------------------------------------------------------------
 * Tab walked out of every dialog: past its last field it went on to the page
 * behind, so somebody working down a form by keyboard ended up in the sidebar
 * with the dialog still open over it. Escape closed some and not others, and
 * in some it closed the dialog when it was only meant to shut a dropdown
 * inside it, taking what had been typed with it. And on closing, focus fell to
 * the top of the page, so the next Tab started from the beginning.
 *
 * So, for every dialog and side panel:
 *   - it opens on its first field (or what it marks `autoFocus`), except on a
 *     touch screen, where a keyboard springing up unasked is in the way;
 *   - Tab and Shift+Tab go round inside it;
 *   - Escape closes it, unless something inside used the Escape first (a
 *     dropdown, a menu in the editor: they mark the event as handled);
 *   - closing puts focus back on what opened it.
 *
 * Only the newest dialog open answers, so one opened from another (a file
 * viewed from a mail being written) closes alone.
 * ---------------------------------------------------------------------------
 */

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
  "summary",
].join(",");

const isShown = (el: HTMLElement) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";

/** What Tab can reach inside `box`, in order. */
export function focusables(box: HTMLElement): HTMLElement[] {
  return Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.closest("[inert]") && isShown(el));
}

const isField = (el: HTMLElement) => el.matches('input:not([type="checkbox"]):not([type="radio"]), select, textarea, [contenteditable="true"]');

/** The dialogs open now, oldest first. */
const stack: Array<RefObject<HTMLElement>> = [];

export interface DialogOptions {
  /** False where the dialog answers Escape itself (asking before it drops what was written). */
  escape?: boolean;
  /** False to leave focus where it is on opening. */
  focusFirst?: boolean;
}

export function useDialog(ref: RefObject<HTMLElement>, onClose?: () => void, { escape = true, focusFirst = true }: DialogOptions = {}) {
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    // Nothing given to hold (a form drawn on its page rather than over it): nothing to do.
    const box = ref.current;
    if (!box) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    stack.push(ref);
    // Focusable itself, so there is somewhere to put focus in a dialog with no field.
    if (!box.hasAttribute("tabindex")) box.setAttribute("tabindex", "-1");

    const frame = requestAnimationFrame(() => {
      const el = ref.current;
      if (!el || !focusFirst || el.contains(document.activeElement)) return;
      const touch = window.matchMedia("(pointer: coarse)").matches;
      const all = focusables(el);
      const first = touch ? null : el.querySelector<HTMLElement>("[autofocus], [data-autofocus]") ?? all.find(isField) ?? all[0];
      (first ?? el).focus({ preventScroll: true });
    });

    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== ref) return;
      const el = ref.current;
      if (!el) return;
      if (e.key === "Escape") {
        if (!escape || e.defaultPrevented || !close.current) return;
        e.preventDefault();
        close.current();
        return;
      }
      if (e.key !== "Tab" || e.altKey || e.ctrlKey || e.metaKey) return;
      const all = focusables(el);
      if (!all.length) {
        e.preventDefault();
        el.focus();
        return;
      }
      const at = document.activeElement;
      const first = all[0];
      const last = all[all.length - 1];
      if (e.shiftKey && (at === first || at === el || !el.contains(at))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (at === last || !el.contains(at))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey);
      const i = stack.indexOf(ref);
      if (i >= 0) stack.splice(i, 1);
      // Back to what opened it — unless closing has already sent focus somewhere on purpose.
      const now = document.activeElement;
      const lost = !now || now === document.body || box.contains(now);
      if (lost && opener?.isConnected) opener.focus({ preventScroll: true });
    };
    // Once per opening: the options are fixed for a dialog's life.
  }, []);
}
