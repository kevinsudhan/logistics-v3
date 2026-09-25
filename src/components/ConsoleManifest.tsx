import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Download, Eye, FileSpreadsheet, Loader2, Mail } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useTablesChanges } from "../lib/useTableChanges";
import { formatDate } from "../lib/dates";
import { failureText } from "../lib/errorText";
import { manifestHtml, manifestIssues, manifestSheet, manifestSubject, manifestTotals, type ManifestLine } from "../lib/consoleManifest";
import { manifestFileName, manifestPdfBytes, renderManifestPdf } from "../lib/documents/manifestPdf";
import { buildWorkbook, downloadWorkbook } from "../lib/xlsx";
import type { Console } from "../services/consoles";
import { manifestConsole, manifestFor, markManifestSent } from "../services/consoleManifest";
import ComposeMail from "./ComposeMail";

/**
 * The console's cargo manifest, for the destination agent (090).
 *
 * Drawn fresh from the house B/Ls every time it is opened, viewed or sent, so
 * it cannot be out of date; what is kept is that it went, and how many house
 * bills it listed, so a shipment added to the box afterwards is flagged
 * rather than silently missing from the agent's list.
 */
export default function ConsoleManifest({ console: c, jobs, onChanged }: { console: Console; jobs: number; onChanged: () => void }) {
  const { session } = useAuth();
  const [data, setData] = useState<{ lines: ManifestLine[]; provisional: boolean; agent: { name: string; email: string } | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compose, setCompose] = useState<{ to: string; subject: string; body: string; attachments: Array<{ name: string; contentType: string; bytes: Uint8Array }> } | null>(null);

  const mc = manifestConsole(c);
  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await manifestFor(c));
    } catch (e) {
      setError(failureText(e, "Could not gather the house bills.").message);
    }
    // Every field the manifest prints, and the jobs on the console.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id, c.updated_at, jobs]);

  useEffect(() => {
    void load();
  }, [load]);
  // A house B/L on the console saved, issued or received by anybody (084).
  useTablesChanges(
    [
      ["house_bills", null],
      ["received_house_bills", null],
    ],
    () => void load()
  );

  const issues = data ? manifestIssues(mc, data.lines) : [];
  const provisional = data?.provisional ?? true;
  const totals = data ? manifestTotals(data.lines) : null;
  const addedSince = c.manifest_sent_at && c.manifest_bills !== null && totals ? totals.bills - c.manifest_bills : 0;

  async function act(key: string, fn: () => Promise<void> | void) {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(failureText(e, "That did not work.").message);
    } finally {
      setBusy(null);
    }
  }

  const view = () =>
    act("view", () => {
      const url = renderManifestPdf(mc, data!.lines, provisional).output("bloburl") as unknown as string;
      const tab = window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      if (!tab) throw new Error("The browser blocked the new tab. Allow pop-ups for this site, or use Download.");
    });

  const mail = () =>
    act("mail", () => {
      const sheet = manifestSheet(mc, data!.lines, provisional);
      const files = [
        { name: manifestFileName(mc, "pdf"), contentType: "application/pdf", bytes: manifestPdfBytes(mc, data!.lines, provisional) },
        { name: manifestFileName(mc, "xlsx"), contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes: buildWorkbook([sheet]) },
      ];
      setCompose({
        to: data!.agent?.email ?? "",
        subject: manifestSubject(mc, provisional),
        body: manifestHtml(mc, data!.lines, data!.agent?.name ?? null, provisional, files.map((f) => f.name)),
        attachments: files,
      });
    });

  const button =
    "inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary disabled:opacity-50";

  return (
    <section>
      <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-secondary">Cargo manifest for the destination agent</h3>

      {error && <p className="mb-2 rounded-lg bg-bg-danger px-3 py-2 text-[12px] text-text-danger">{error}</p>}

      {!data ? (
        <p className="flex items-center gap-2 text-[12px] text-text-muted">
          <Loader2 size={12} className="animate-spin" /> Gathering the house bills…
        </p>
      ) : (
        <>
          {c.manifest_sent_at && (
            <p className={`mb-2 flex flex-wrap items-center gap-1.5 text-[12px] ${addedSince ? "text-text-warning" : "text-text-success"}`}>
              <Check size={13} />
              Sent {formatDate(c.manifest_sent_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: true })}
              {c.manifest_sent_to ? ` to ${c.manifest_sent_to}` : ""} with {c.manifest_bills} house bill{c.manifest_bills === 1 ? "" : "s"}
              {c.manifest_provisional ? ", provisional" : ""}.
              {addedSince > 0 && <strong className="font-medium"> {addedSince} added since — send it again.</strong>}
              {addedSince < 0 && <strong className="font-medium"> {-addedSince} taken off since — send it again.</strong>}
            </p>
          )}

          {issues.length > 0 ? (
            <div className="mb-3 rounded-lg bg-bg-warning px-3 py-2 text-[12px] text-text-warning">
              <p className="flex items-center gap-1.5 font-medium">
                <AlertTriangle size={13} /> It goes as provisional:
              </p>
              <ul className="mt-1 list-disc pl-6">
                {issues.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mb-3 text-[12px] text-text-success">Every house B/L is final: it goes as the final manifest.</p>
          )}

          {totals && totals.bills > 0 && (
            <p className="mb-3 text-[12px] text-text-secondary">
              {totals.bills} house B/L{totals.bills === 1 ? "" : "s"} · {totals.packages.toLocaleString("en-IN")} packages · {totals.grossKg.toLocaleString("en-IN")} kg · {totals.cbm} CBM
              {totals.collect ? ` · ${totals.collect} freight collect` : ""}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!data.lines.length || busy !== null} onClick={() => void view()} className={button}>
              <Eye size={13} /> View PDF
            </button>
            <button type="button" disabled={!data.lines.length || busy !== null} onClick={() => void act("pdf", () => void renderManifestPdf(mc, data.lines, provisional).save(manifestFileName(mc, "pdf")))} className={button}>
              <Download size={13} /> PDF
            </button>
            <button type="button" disabled={!data.lines.length || busy !== null} onClick={() => void act("xlsx", () => downloadWorkbook(manifestFileName(mc, "xlsx"), [manifestSheet(mc, data.lines, provisional)]))} className={button}>
              <FileSpreadsheet size={13} /> Excel
            </button>
            <button
              type="button"
              disabled={!data.lines.length || busy !== null}
              onClick={() => void mail()}
              title={data.agent?.email ? `To ${data.agent.email}` : data.agent ? `No email on file for ${data.agent.name}: type it in the mail` : "Appoint the overseas agent above first, or type the address in the mail"}
              className={`${button} border-brand text-text-accent`}
            >
              {busy === "mail" ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />} Mail it to {data.agent?.name ?? "the agent"}
            </button>
          </div>
        </>
      )}

      {compose && (
        <ComposeMail
          mailbox={session?.email ?? ""}
          fromName={session?.name ?? ""}
          signature={session?.signature ?? ""}
          initial={{ to: compose.to, subject: compose.subject, body: compose.body }}
          attachments={compose.attachments}
          onClose={() => setCompose(null)}
          onSent={() => {
            const to = data?.agent?.name || compose.to;
            setCompose(null);
            void act("sent", async () => {
              await markManifestSent(c.id, to, data?.lines.length ?? 0, provisional);
              onChanged();
            });
          }}
        />
      )}
    </section>
  );
}
