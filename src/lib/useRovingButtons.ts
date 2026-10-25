import { useLayoutEffect, useRef, type FocusEvent, type KeyboardEvent } from "react";

/**
 * One Tab stop for a row of options of which one is chosen (25 Oct).
 *
 * Every option used to be a stop of its own, so tabbing down a form went
 * through Sea, Air, Road and Courier before it reached the next field. Now,
 * as with a set of radio buttons, Tab lands on the option that is chosen (or
 * the first), the arrow keys, Home and End move along the row, and Enter or
 * Space chooses — moving along chooses nothing, so nothing saves by accident.
 *
 * The row's options are its `aria-pressed` buttons (or `role="radio"` ones),
 * the chosen one the one pressed (or checked): spread what this returns on the
 * row, and nothing else changes.
 */
const optionsIn = (row: HTMLElement) =>
  Array.from(row.querySelectorAll<HTMLButtonElement>('button[aria-pressed], button[role="radio"]')).filter((b) => !b.disabled);

const isChosen = (b: HTMLElement) => b.getAttribute("aria-pressed") === "true" || b.getAttribute("aria-checked") === "true";

function settle(row: HTMLElement, stop?: Element | null) {
  const all = optionsIn(row);
  const at = stop ? all.indexOf(stop as HTMLButtonElement) : -1;
  const chosen = at >= 0 ? at : Math.max(0, all.findIndex(isChosen));
  all.forEach((b, i) => (b.tabIndex = i === chosen ? 0 : -1));
}

export function useRovingButtons<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);

  // After every drawing: the choice may have moved, or the options changed.
  useLayoutEffect(() => {
    const row = ref.current;
    if (row) settle(row, row.contains(document.activeElement) ? document.activeElement : null);
  });

  return {
    ref,
    role: "group" as const,
    onKeyDown: (e: KeyboardEvent<T>) => {
      const all = optionsIn(e.currentTarget);
      const at = all.indexOf(document.activeElement as HTMLButtonElement);
      if (at < 0) return;
      const last = all.length - 1;
      const to =
        e.key === "ArrowRight" || e.key === "ArrowDown" ? (at === last ? 0 : at + 1)
        : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (at === 0 ? last : at - 1)
        : e.key === "Home" ? 0
        : e.key === "End" ? last
        : null;
      if (to === null) return;
      e.preventDefault();
      all[to].focus();
    },
    // The stop follows focus while it is in the row, so Tab then leaves it; back to the choice after.
    onFocus: (e: FocusEvent<T>) => settle(e.currentTarget, e.target),
    onBlur: (e: FocusEvent<T>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) settle(e.currentTarget);
    },
  };
}
