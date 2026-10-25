import { useEffect, useRef, type RefObject } from "react";
import { focusables } from "./useDialog";

/**
 * A drop-down menu that the keyboard can use (25 Oct).
 *
 * The menus (Move to, Snooze, Attach, More…) opened and shut by mouse only:
 * Escape left them open, the arrow keys did nothing, and Tab walked out of one
 * and left it hanging open over the page. Now, while `open`:
 *   - it opens on its first item;
 *   - the arrow keys, Home and End move through its items;
 *   - Escape shuts it and goes back to the button that opened it, and the
 *     dialog behind it (if any) stays open — the Escape is spent;
 *   - Tab moves on past it and shuts it, as a native menu does.
 */
export function useMenu(ref: RefObject<HTMLElement>, open: boolean, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const box = ref.current;
    if (!open || !box) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // So a page's own shortcut keys (Mail's R, E, j, k) leave a menu's keys alone.
    box.setAttribute("data-menu", "");

    const frame = requestAnimationFrame(() => {
      if (box.contains(document.activeElement)) return;
      (box.querySelector<HTMLElement>("[autofocus], [data-autofocus]") ?? focusables(box)[0])?.focus({ preventScroll: true });
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (e.defaultPrevented) return;
        e.preventDefault();
        close.current();
        opener?.focus({ preventScroll: true });
        return;
      }
      if (!box.contains(document.activeElement)) return;
      const t = e.target as HTMLElement;
      // In a field inside the menu (a date, a search), the arrows are the field's.
      if (t.matches("input:not([type='checkbox']):not([type='radio']), textarea, select")) return;
      const all = focusables(box);
      const at = all.indexOf(document.activeElement as HTMLElement);
      const go = (i: number) => {
        e.preventDefault();
        all[(i + all.length) % all.length]?.focus();
      };
      if (e.key === "ArrowDown") go(at + 1);
      else if (e.key === "ArrowUp") go(at - 1);
      else if (e.key === "Home") go(0);
      else if (e.key === "End") go(all.length - 1);
    };
    // Focus gone somewhere else entirely (Tab past the last item, a click elsewhere): shut —
    // once it has arrived there. Shut at once, the item it is leaving goes from under it
    // first, and focus falls back to the button instead of moving on.
    let leaving = 0;
    const onFocusOut = (e: FocusEvent) => {
      const to = e.relatedTarget as Node | null;
      if (to && !box.contains(to) && to !== opener) leaving = window.setTimeout(() => close.current(), 0);
    };

    // Captured, so a menu's Escape is spent before the dialog it sits in hears it.
    document.addEventListener("keydown", onKey, true);
    box.addEventListener("focusout", onFocusOut);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(leaving);
      document.removeEventListener("keydown", onKey, true);
      box.removeEventListener("focusout", onFocusOut);
      // Shut by choosing an item: back to the button, not to the top of the page.
      const now = document.activeElement;
      if ((!now || now === document.body) && opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open, ref]);
}
