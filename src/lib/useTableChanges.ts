import { useEffect, useRef } from "react";
import { supabase } from "./supabase";

/**
 * Refresh when rows in a table change — as they change, not when somebody
 * reloads.
 *
 * ---------------------------------------------------------------------------
 * Listens on Supabase Realtime (the table must be in the `supabase_realtime`
 * publication, see 080) and calls `onChange` once for a burst of changes: an
 * approval touches a quote, its event and its line totals within a moment, and
 * one refresh answers all of it. Realtime applies the table's read policy, so
 * nobody hears about a row they could not read.
 *
 * Realtime is the fast path, not the only one. A phone that slept, a laptop
 * lid closed, a dropped socket — any of them can miss a change, so the page
 * also refreshes when it comes back into view.
 *
 * `onChange` is read from a ref, so passing a fresh function each render does
 * not tear the subscription down and set it up again.
 * ---------------------------------------------------------------------------
 */
export function useTableChanges(table: string, filter: string | null, onChange: () => void, enabled = true): void {
  const latest = useRef(onChange);
  latest.current = onChange;

  useEffect(() => {
    if (!enabled) return;
    let timer: number | undefined;
    const fire = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => latest.current(), 250);
    };

    const channel = supabase
      .channel(`changes:${table}:${filter ?? "all"}:${Math.random().toString(36).slice(2, 8)}`)
      .on("postgres_changes", { event: "*", schema: "public", table, ...(filter ? { filter } : {}) }, fire)
      .subscribe();

    const onVisible = () => {
      if (document.visibilityState === "visible") fire();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [table, filter, enabled]);
}
