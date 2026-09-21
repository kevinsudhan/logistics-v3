import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, FolderInput, Loader2, Search, X } from "lucide-react";
import { failureText, type FailureText } from "../lib/errorText";
import {
  bindThread,
  listEnquiries,
  STATUS_LABEL,
  type Customer,
  type Enquiry,
} from "../services/enquiries";
import type { MailMessage } from "../services/mockMail";

type Row = Enquiry & { customer: Customer | null };

/**
 * Filing a thread against an enquiry that already exists.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT THE SAME AS THE QUEUE BUTTONS
 *
 * "Send to enquiries" and "My enquiries" both MINT a reference. That is right
 * for the first mail of a job and wrong for the fourth: an enquiry collects
 * threads — the customer's original, the agent's rate, the carrier's booking
 * note, a chaser from somebody in accounts — and every one of them arriving as
 * its own enquiry is how one job comes to hold four references, each with a
 * quarter of the correspondence under it.
 *
 * The machinery for this was already here. `bindThread` writes the conversation
 * into `enquiry_threads`, which is what every filed message is read through,
 * and the promote functions have called it since 017. Nothing in the interface
 * ever offered it, so the only way to file a second thread was to make a second
 * enquiry.
 *
 * WHY THE WHOLE THREAD AND NOT THE MESSAGE
 *
 * Because the rest of the conversation has not happened yet. Binding the
 * conversation means the reply that arrives on Thursday files itself; binding
 * one message means doing this again on Thursday.
 * ---------------------------------------------------------------------------
 */
export default function FileToEnquiry({
  message,
  onFiled,
  size = "full",
}: {
  message: MailMessage;
  /** Filed successfully — the page around this should reload. */
  onFiled: () => void;
  size?: "icon" | "full";
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<FailureText | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listEnquiries());
    } catch (e) {
      setError(failureText(e, "Could not load the enquiries."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // Escape closes, as everywhere else. No backdrop dismissal: there is nothing
  // typed here worth losing, but the list is long and a mis-click while
  // scrolling it should not throw the whole thing away.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows
      .filter((r) =>
        !needle
          ? true
          : [r.ref, r.origin, r.destination, r.cargo, r.customer?.name, r.customer?.company]
              .filter(Boolean)
              .some((v) => String(v).toLowerCase().includes(needle))
      )
      .slice(0, 40);
  }, [rows, query]);

  async function file(ref: string) {
    setBusy(ref);
    setError(null);
    try {
      // The message id goes too: it pins this particular mail even if it
      // arrived before the conversation was bound, which is the usual case —
      // you file it because it is in front of you.
      await bindThread(ref, message.conversationId || message.id, message.id);
      setDone(ref);
      onFiled();
      // Left open for a moment so the confirmation is seen rather than inferred
      // from the dialog vanishing.
      setTimeout(() => {
        setOpen(false);
        setDone(null);
      }, 900);
    } catch (e) {
      setError(failureText(e, "Could not file this thread."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {size === "icon" ? (
        <button
          onClick={() => setOpen(true)}
          title="File this thread against an existing enquiry"
          aria-label="File against an enquiry"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-border text-text-muted transition-colors hover:border-border-strong hover:text-text-primary"
        >
          <FolderInput size={13} />
        </button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
        >
          <FolderInput size={13} />
          File to enquiry
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-6">
          <div
            role="dialog"
            aria-label="File this thread against an enquiry"
            className="flex max-h-[80vh] w-full flex-col rounded-t-card shadow-xl sm:card sm:max-w-lg"
          >
            <header className="flex items-center justify-between border-b border-border px-5 py-3">
              <div className="min-w-0">
                <h2 className="text-[14px] font-medium text-text-primary">File to an enquiry</h2>
                <p className="truncate text-[12px] text-text-secondary">{message.subject}</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="shrink-0 text-text-muted hover:text-text-primary"
              >
                <X size={16} />
              </button>
            </header>

            <div className="px-5 pt-3">
              <div className="relative">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
                />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Reference, customer, route, cargo…"
                  className="h-8 w-full pl-8"
                  autoFocus
                />
              </div>

              {error && (
                <div className="mt-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
                  <AlertCircle size={13} className="mt-px shrink-0" />
                  <span>
                    {error.message}
                    {error.hint && <span className="mt-1 block opacity-80">{error.hint}</span>}
                  </span>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-3">
              {loading && !rows.length ? (
                <p className="py-6 text-[13px] text-text-muted">Loading…</p>
              ) : !visible.length ? (
                <p className="py-6 text-[13px] text-text-muted">
                  {rows.length ? "Nothing matches that." : "There are no enquiries yet."}
                </p>
              ) : (
                <ul className="space-y-2">
                  {visible.map((r) => (
                    <li key={r.ref}>
                      <button
                        onClick={() => void file(r.ref)}
                        disabled={busy !== null}
                        className="flex w-full items-start justify-between gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:border-border-strong hover:bg-surface-2 disabled:opacity-60"
                      >
                        <span className="min-w-0">
                          <span className="block font-mono text-[12px] text-text-accent">
                            {r.ref}
                          </span>
                          <span className="block truncate text-[13px] text-text-primary">
                            {r.customer?.company || r.customer?.name || "No customer on file"}
                          </span>
                          <span className="block truncate text-[12px] text-text-secondary">
                            {[r.origin, r.destination].filter(Boolean).join(" → ") ||
                              "Route not captured"}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-text-secondary">
                            {STATUS_LABEL[r.status] ?? r.status}
                          </span>
                          {done === r.ref ? (
                            <Check size={14} className="text-text-success" />
                          ) : busy === r.ref ? (
                            <Loader2 size={14} className="animate-spin text-text-muted" />
                          ) : null}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <footer className="border-t border-border px-5 py-3">
              <p className="text-[12px] text-text-muted">
                The whole conversation is filed, so replies that arrive later land on the same
                enquiry without anybody doing this again.
              </p>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
