import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Check, DatabaseBackup, Download, Loader2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { formatDate } from "../lib/dates";

/**
 * The nightly backups, for an administrator (093).
 *
 * Whether last night's ran is the thing to see at a glance: a backup that
 * quietly stopped is found out the day it is needed. Below it the recent runs,
 * a download for every file still kept (30 days), and a backup taken now.
 */

interface Run {
  id: string;
  taken_at: string;
  file: string | null;
  bytes: number | null;
  tables: number | null;
  rows: number | null;
  ok: boolean;
  error: string | null;
  trigger: "schedule" | "manual";
  kept: boolean;
  url: string | null;
}

async function call(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("db-backup", { body });
  if (error) {
    const said = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new Error(said?.error ?? error.message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

const kb = (n: number | null) => (n === null ? "" : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);

export default function BackupsPanel() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRuns(((await call({ action: "list" })).runs ?? []) as Run[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the backups.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const latest = runs?.find((r) => r.ok) ?? null;
  const hoursSince = latest ? (Date.now() - Date.parse(latest.taken_at)) / 3_600_000 : null;
  const lastFailed = runs?.[0] && !runs[0].ok ? runs[0] : null;
  const healthy = hoursSince !== null && hoursSince < 26 && !lastFailed;

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[15px] font-medium text-text-primary">
            <DatabaseBackup size={15} className="text-brand" /> Backups
          </h2>
          <p className="mt-1 max-w-prose text-[12.5px] text-text-secondary">
            Every table, every night at 3:00 am, kept for 30 days. A file here restores the whole desk (supabase-v2/restore-backup.mjs).
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setNote(null);
            setError(null);
            void call({ action: "run" })
              .then((d) => {
                setNote(`Backed up just now: ${d.done.tables} tables, ${d.done.rows.toLocaleString("en-IN")} rows, ${kb(d.done.bytes)}.`);
                return load();
              })
              .catch((e: unknown) => setError(e instanceof Error ? e.message : "The backup did not run."))
              .finally(() => setBusy(false));
          }}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary hover:border-border-strong hover:text-text-primary disabled:opacity-60"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <DatabaseBackup size={13} />} Back up now
        </button>
      </div>

      {runs && (
        <p className={`mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-[12px] ${healthy ? "bg-bg-success text-text-success" : "bg-bg-danger text-text-danger"}`}>
          {healthy ? <Check size={13} className="mt-px shrink-0" /> : <AlertCircle size={13} className="mt-px shrink-0" />}
          {lastFailed
            ? `The last backup failed (${formatDate(lastFailed.taken_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: true })}): ${lastFailed.error ?? "no reason given"}`
            : latest
              ? `${healthy ? "Backed up" : "No backup for more than a day — last"} ${formatDate(latest.taken_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: true })}: ${latest.tables} tables, ${latest.rows?.toLocaleString("en-IN")} rows.`
              : "No backup has run yet."}
        </p>
      )}
      {error && <p className="mt-3 rounded-lg bg-bg-danger px-3 py-2 text-[12px] text-text-danger">{error}</p>}
      {note && <p className="mt-3 rounded-lg bg-bg-success px-3 py-2 text-[12px] text-text-success">{note}</p>}

      {!runs ? (
        !error && (
          <p className="mt-3 flex items-center gap-2 text-[12px] text-text-muted">
            <Loader2 size={12} className="animate-spin" /> Reading the backups…
          </p>
        )
      ) : (
        runs.length > 0 && (
          <ul className="mt-3 divide-y divide-border text-[12px]">
            {runs.slice(0, 10).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
                <span className={`inline-block size-2 rounded-full ${r.ok ? "bg-text-success" : "bg-text-danger"}`} />
                <span className="w-40 tabular-nums text-text-primary">
                  {formatDate(r.taken_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: true })}
                </span>
                <span className="text-text-muted">{r.trigger === "manual" ? "by hand" : "nightly"}</span>
                <span className="text-text-secondary">{r.ok ? `${r.tables} tables · ${r.rows?.toLocaleString("en-IN")} rows · ${kb(r.bytes)}` : r.error}</span>
                {r.url ? (
                  <a href={r.url} className="ml-auto inline-flex items-center gap-1 text-text-accent hover:underline" download>
                    <Download size={12} /> {r.file?.replace("db/", "")}
                  </a>
                ) : (
                  r.ok && <span className="ml-auto text-text-muted">{r.kept ? "" : "past 30 days"}</span>
                )}
              </li>
            ))}
          </ul>
        )
      )}
    </section>
  );
}
