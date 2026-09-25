import { useEffect, useRef } from "react";
import { supabase } from "./supabase";

/** A table to listen to, and a filter on it (`enquiry_ref=eq.ALG…`) or null for every row. */
export type Watch = readonly [table: string, filter: string | null];

/**
 * Refresh when rows in a table change — as they change, not when somebody
 * reloads.
 *
 * ---------------------------------------------------------------------------
 * Listens on Supabase Realtime (the table must be in the `supabase_realtime`
 * publication, see 080 and 081) and calls `onChange` once for a burst of
 * changes: an approval touches a quote, its event and its line totals within a
 * moment, and one refresh answers all of it. Realtime applies the table's read
 * policy, so nobody hears about a row they could not read.
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
  useTablesChanges([[table, filter]], onChange, enabled);
}

/**
 * The same, for several tables on one channel and with one refresh.
 *
 * Booking an enquiry writes the shipment, moves the enquiry's status and adds
 * the job's steps within a moment. A page listening to all of them reads itself
 * once for that, not once per table. `onChange` is told which tables moved, so
 * a page can re-read only what they feed.
 *
 * A removed row is heard from the whole table, not just the filtered rows:
 * Realtime cannot filter a delete, because by then the row's columns are gone
 * and only its key is sent. Deletes are rare, and an extra refresh is cheaper
 * than a container that stays on somebody's screen after it was removed.
 */
export function useTablesChanges(watches: readonly Watch[], onChange: (tables: Set<string>) => void, enabled = true): void {
  const latest = useRef(onChange);
  latest.current = onChange;
  // The list is usually written inline, so it is a new array every render; its
  // contents are what decide whether the subscription changes.
  const key = JSON.stringify(watches);

  useEffect(() => {
    const list = JSON.parse(key) as Watch[];
    if (!enabled || !list.length) return;
    let timer: number | undefined;
    let moved = new Set<string>();
    const fire = (table: string | null) => {
      if (table) moved.add(table);
      else for (const [t] of list) moved.add(t);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const tables = moved;
        moved = new Set();
        latest.current(tables);
      }, 250);
    };

    const name = list.map(([t, f]) => `${t}:${f ?? "all"}`).join("+");
    const channel = supabase.channel(`changes:${name}:${Math.random().toString(36).slice(2, 8)}`);
    for (const [table, filter] of list) {
      channel.on("postgres_changes", { event: "*", schema: "public", table, ...(filter ? { filter } : {}) }, () => fire(table));
      if (filter) channel.on("postgres_changes", { event: "DELETE", schema: "public", table }, () => fire(table));
    }
    channel.subscribe();

    // Back in view: anything could have moved while it was hidden.
    const onVisible = () => {
      if (document.visibilityState === "visible") fire(null);
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [key, enabled]);
}
