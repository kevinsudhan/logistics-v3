import { supabase } from "../lib/supabase";

/**
 * Reading more rows than one request returns.
 *
 * A report reads everything in a period, and PostgREST stops at 1,000 rows a
 * request; a filter on a list of ids has to stay short enough to fit in a URL.
 * These do the paging and the batching so a report does not quietly stop at
 * the thousandth row.
 */

const PAGE = 1000;
const BATCH = 150;

export type Row = Record<string, unknown>;

/** Every row a query matches, a page at a time. */
export async function all(
  query: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>
): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as Row[]));
    if (!data || data.length < PAGE) return out;
  }
}

/** Rows whose `column` is one of `values`, asked for in batches short enough for a URL. */
export async function whereIn(table: string, select: string, column: string, values: string[]): Promise<Row[]> {
  const unique = [...new Set(values.filter(Boolean))];
  const out: Row[] = [];
  for (let i = 0; i < unique.length; i += BATCH) {
    const part = unique.slice(i, i + BATCH);
    out.push(...(await all((from, to) => supabase.from(table).select(select).in(column, part).range(from, to))));
  }
  return out;
}

export const group = (rows: Row[], key: string) => {
  const m = new Map<string, Row[]>();
  for (const r of rows) m.set(String(r[key]), [...(m.get(String(r[key])) ?? []), r]);
  return m;
};
export const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
export const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
