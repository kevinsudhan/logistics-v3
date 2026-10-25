import { useState } from "react";
import { Check } from "lucide-react";
import { formatDate } from "../lib/dates";
import { failureText } from "../lib/errorText";
import { csnDue } from "../lib/receivedHbl";
import { csnEventFor } from "../services/icegateCsn";
import type { Console } from "../services/consoles";
import { csnFiler } from "../lib/coload";
import { setCsnBy } from "../services/coload";
import ConsoleCsnByColoader from "./ConsoleCsnByColoader";
import CsnFiling from "./CsnFiling";

/**
 * The CSN for ICEGATE, on an import console (097).
 *
 * The desk files the Cargo Summary Notification as consol agent: the carrier's
 * master B/L and every house B/L under it, 72 hours before the vessel arrives.
 * The form, the file, ICEGATE's reply and an amendment are CsnFiling's, which a
 * job filed on its own shares on its IGM page (143); here, when it is due, and
 * on a co-load (121, 122) who files it: we file our houses under the
 * co-loader's B/L, or the co-loader files them in theirs and gets our house
 * list (ConsoleCsnByColoader).
 *
 * The format and every rule are CBIC's: lib/icegateCsn.ts, docs/icegate-csn.
 */

export default function ConsoleCsn({ console: c, onChanged }: { console: Console; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const coload = c.space_from === "coloader";
  const byColoader = csnFiler(c) === "coloader";
  const exp = csnEventFor(c) === "SCX";
  const due = csnDue(c.eta, null, c.csn_date);

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-text-secondary">CSN for ICEGATE</h3>
        {c.csn_no ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-bg-success px-2 py-0.5 text-[11px] text-text-success">
            <Check size={11} /> CSN {c.csn_no}
            {c.csn_date ? ` · ${formatDate(c.csn_date, { day: "numeric", month: "short" })}` : ""}
          </span>
        ) : exp ? (
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-text-secondary">
            CSN on exit: before the vessel sails{c.etd ? ` (ETD ${formatDate(c.etd, { day: "numeric", month: "short" })})` : ""}
          </span>
        ) : due.due ? (
          <span className={`rounded-full px-2 py-0.5 text-[11px] ${due.state === "overdue" ? "bg-bg-danger text-text-danger" : due.state === "soon" ? "bg-bg-warning text-text-warning" : "bg-surface-2 text-text-secondary"}`}>
            {due.state === "overdue" ? "Overdue — was due " : "Due by "}
            {formatDate(due.due.toISOString(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" })}
          </span>
        ) : (
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-text-muted">Due 72 hours before the ETA</span>
        )}
      </div>

      {/* ---- on a co-load, who files it: decided console by console (122) ---- */}
      {coload && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11.5px] text-text-secondary">Who files it</span>
          {(
            [
              { v: "us", label: "We file our houses" },
              { v: "coloader", label: "The co-loader files them" },
            ] as const
          ).map((o) => (
            <button
              key={o.v}
              type="button"
              aria-pressed={csnFiler(c) === o.v}
              disabled={busy}
              onClick={async () => {
                if (csnFiler(c) === o.v) return;
                setBusy(true);
                setError(null);
                try {
                  await setCsnBy(c, o.v);
                  onChanged();
                } catch (e) {
                  setError(failureText(e, "That did not work.").message);
                } finally {
                  setBusy(false);
                }
              }}
              className={`h-7 rounded-lg border px-2.5 text-[11.5px] transition-colors ${
                csnFiler(c) === o.v ? "border-brand bg-brand font-medium text-white" : "border-border bg-surface-1 text-text-secondary hover:border-border-strong hover:text-text-primary"
              }`}
            >
              {o.label}
            </button>
          ))}
          {error && <span className="text-[11.5px] text-text-danger">{error}</span>}
        </div>
      )}

      {byColoader ? (
        <ConsoleCsnByColoader console={c} exporting={exp} onChanged={onChanged} />
      ) : (
        <CsnFiling subject={{ kind: "console", console: c }} csn={{ no: c.csn_no ?? null, date: c.csn_date ?? null }} onChanged={onChanged} />
      )}
    </section>
  );
}
