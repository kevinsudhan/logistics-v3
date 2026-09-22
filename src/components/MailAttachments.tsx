import { useEffect, useState } from "react";
import { FileText, Loader2, Paperclip, Plus, X } from "lucide-react";
import { asOutgoing, listFiles, type EnquiryFile } from "../services/attachments";
import type { OutgoingAttachment } from "../services/graphMail";
import { failureText } from "../lib/errorText";
import { bytesToBase64 } from "../lib/base64";

/**
 * What goes out attached to the message.
 *
 * ---------------------------------------------------------------------------
 * THREE SOURCES, BECAUSE THERE ARE THREE KINDS OF FILE ON THIS DESK
 *
 * 1. A document this CRM made. The quotation, the booking confirmation, the
 *    B/L draft. This is the one whose absence was doing the damage: generating
 *    a quotation and then attaching it in Outlook meant the thread, and the
 *    customer's answer to it, happened somewhere the CRM never saw.
 *
 * 2. A file already filed on the enquiry. The shipper's packing list, forwarded
 *    on to the consol agent — the single most common attachment this desk
 *    sends, and it does not exist on anybody's computer. Re-attaching it should
 *    not mean finding the original mail and downloading from it.
 *
 * 3. A file from the operator's computer. Everything else.
 *
 * WHY THE GENERATED ONES ARE LAZY
 *
 * The caller passes a way to MAKE each document, not the document. Rendering
 * every one the moment a reply box opens would run the whole PDF generator
 * several times over for attachments nobody asked for.
 *
 * WHY THE CAP IS CHECKED HERE AS WELL
 *
 * Graph refuses a message over about 3MB, and `attachmentPayload` throws before
 * creating the draft so nothing is left behind. But that happens on send, after
 * the mail is written. Checking as files are added means being told while there
 * is still something to do about it.
 * ---------------------------------------------------------------------------
 */

/** A document the caller can produce on demand. */
export interface Attachable {
  id: string;
  label: string;
  /** Rendered only if somebody actually attaches it. */
  make: () => { name: string; contentType: string; bytes: Uint8Array };
}

/** One attachment on the message being written, with what the list needs to show it. */
export interface Attached extends OutgoingAttachment {
  key: string;
  /** Bytes, for the size shown — not the base64 length, which is a third larger. */
  size: number;
  origin: "generated" | "filed" | "local";
}

const CAP = 3 * 1024 * 1024;

export default function MailAttachments({
  enquiryRef,
  generated = [],
  loadGenerated,
  value,
  onChange,
}: {
  /** Enables the enquiry's own filed files. Absent on a mail with no case. */
  enquiryRef?: string | null;
  generated?: Attachable[];
  /**
   * For a screen that holds a reference rather than the record.
   *
   * The case file has the enquiry in memory and passes `generated` directly.
   * The partner screen knows only that a thread is about ALG09012-26, so it
   * passes a way to go and find out — run when the menu opens, not when the
   * reply box does, because most replies carry no attachment at all.
   */
  loadGenerated?: () => Promise<Attachable[]>;
  value: Attached[];
  onChange: (next: Attached[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filed, setFiled] = useState<EnquiryFile[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fetched, setFetched] = useState<Attachable[] | null>(null);
  const [loadingDocs, setLoadingDocs] = useState(false);

  // Loaded when the menu opens rather than on mount: most replies carry no
  // attachment, and this is a query per reply box otherwise.
  useEffect(() => {
    if (!enquiryRef || !open) return;
    void listFiles(enquiryRef)
      .then(setFiled)
      .catch(() => setFiled([]));
  }, [enquiryRef, open]);

  // Fetched once per open reply box: the enquiry does not gain documents while
  // somebody is writing a mail about it.
  useEffect(() => {
    if (!open || !loadGenerated || fetched) return;
    setLoadingDocs(true);
    void loadGenerated()
      .then(setFetched)
      .catch(() => setFetched([]))
      .finally(() => setLoadingDocs(false));
  }, [open, loadGenerated, fetched]);

  const documents = generated.length ? generated : (fetched ?? []);

  const total = value.reduce((n, a) => n + a.size, 0);

  /**
   * Adds a batch, unless it would take the message over what Graph will send.
   *
   * A batch rather than one at a time, because `value` does not update between
   * the iterations of a loop — choosing four files at once would check each one
   * against the total as it was before any of them were added, and four 1MB
   * files would all pass a 3MB check and then fail on send.
   */
  function add(batch: Attached[]) {
    if (!batch.length) return;
    const adding = batch.reduce((n, a) => n + a.size, 0);
    if (total + adding > CAP) {
      const names = batch.map((a) => a.name).join(", ");
      setError(
        `${names} would take this message over 3MB, which is the most one mail can carry. ` +
          `Send separately, or share as a link.`
      );
      return;
    }
    setError(null);
    onChange([...value, ...batch]);
    setOpen(false);
  }

  function attachGenerated(d: Attachable) {
    const made = d.make();
    add([
      {
        key: `gen-${d.id}-${Date.now()}`,
        name: made.name,
        contentType: made.contentType,
        contentBytes: bytesToBase64(made.bytes),
        size: made.bytes.byteLength,
        origin: "generated",
      },
    ]);
  }

  async function attachFiled(f: EnquiryFile) {
    setBusy(f.id);
    setError(null);
    try {
      const out = await asOutgoing(f);
      add([{ key: `filed-${f.id}`, ...out, size: f.size_bytes ?? 0, origin: "filed" }]);
    } catch (e) {
      setError(failureText(e, "Could not fetch that file.").message);
    } finally {
      setBusy(null);
    }
  }

  async function attachLocal(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    // Read them all, then add them as one batch — see `add`.
    const batch = await Promise.all(
      Array.from(files).map(async (file, i) => {
        const bytes = new Uint8Array(await file.arrayBuffer());
        return {
          key: `local-${file.name}-${Date.now()}-${i}`,
          name: file.name,
          contentType: file.type || "application/octet-stream",
          contentBytes: bytesToBase64(bytes),
          size: bytes.byteLength,
          origin: "local" as const,
        };
      })
    );
    add(batch);
  }

  const alreadyAttached = (key: string) => value.some((a) => a.key === key);

  return (
    <div className="border-t border-border px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {value.map((a) => (
          <span
            key={a.key}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 py-1 pl-2 pr-1 text-[12px] text-text-secondary"
          >
            <Paperclip size={11} className="shrink-0 opacity-70" />
            <span className="max-w-[220px] truncate" title={a.name}>
              {a.name}
            </span>
            <span className="text-[11px] tabular-nums text-text-muted">{size(a.size)}</span>
            <button type="button"
              onClick={() => onChange(value.filter((x) => x.key !== a.key))}
              className="rounded p-0.5 text-text-muted transition-colors hover:bg-surface-3 hover:text-text-primary"
              aria-label={`Remove ${a.name}`}
            >
              <X size={12} />
            </button>
          </span>
        ))}

        <div className="relative">
          <button type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex h-7 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
          >
            <Plus size={12} /> Attach
          </button>

          {open && (
            <>
              {/* Click-away, the way every other menu on this screen closes. */}
              <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
              <div className="absolute bottom-9 left-0 z-20 max-h-[300px] w-[330px] overflow-y-auto rounded-xl border border-border bg-surface-1 p-1.5 shadow-lg">
                <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-text-primary transition-colors hover:bg-surface-2">
                  <Paperclip size={13} className="shrink-0 text-text-muted" />
                  From this computer
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      void attachLocal(e.target.files);
                      // Cleared so choosing the same file twice running still
                      // fires a change event.
                      e.target.value = "";
                    }}
                  />
                </label>

                {/*
                  Shown whenever there is a case, even with nothing in it.

                  A document is offered only once the fields it prints are
                  answered — on a fresh enquiry that is none of them, and the
                  section simply would not appear. Somebody looking for the
                  quotation would be left to conclude the feature is missing
                  rather than that the enquiry is not ready, so the empty case
                  says which.
                */}
                {(documents.length > 0 || loadingDocs || enquiryRef) && (
                  <>
                    <p className="px-2.5 pb-1 pt-2.5 text-[10px] font-medium uppercase tracking-wide text-text-muted">
                      Generate and attach
                    </p>
                    {loadingDocs && (
                      <p className="flex items-center gap-2 px-2.5 pb-1.5 text-[12px] text-text-muted">
                        <Loader2 size={12} className="animate-spin" /> Looking up the enquiry…
                      </p>
                    )}
                    {!loadingDocs && documents.length === 0 && (
                      <p className="px-2.5 pb-1.5 text-[12px] text-text-muted">
                        No document is ready to send yet. Each one appears here once the fields it
                        prints are filled in — the quotation needs a rate, the B/L needs the
                        consignee and the cargo.
                      </p>
                    )}
                    {documents.map((d) => (
                      <button type="button"
                        key={d.id}
                        onClick={() => attachGenerated(d)}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-text-primary transition-colors hover:bg-surface-2"
                      >
                        <FileText size={13} className="shrink-0 text-text-muted" />
                        <span className="truncate">{d.label}</span>
                      </button>
                    ))}
                  </>
                )}

                {enquiryRef && (
                  <>
                    <p className="px-2.5 pb-1 pt-2.5 text-[10px] font-medium uppercase tracking-wide text-text-muted">
                      Filed on {enquiryRef}
                    </p>
                    {filed.length === 0 ? (
                      <p className="px-2.5 pb-1.5 text-[12px] text-text-muted">
                        Nothing filed yet. Save an attachment off a message and it appears here.
                      </p>
                    ) : (
                      filed.map((f) => (
                        <button type="button"
                          key={f.id}
                          disabled={busy === f.id || alreadyAttached(`filed-${f.id}`)}
                          onClick={() => void attachFiled(f)}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-text-primary transition-colors hover:bg-surface-2 disabled:opacity-50"
                        >
                          {busy === f.id ? (
                            <Loader2 size={13} className="shrink-0 animate-spin" />
                          ) : (
                            <Paperclip size={13} className="shrink-0 text-text-muted" />
                          )}
                          <span className="min-w-0 flex-1 truncate">{f.name}</span>
                          <span className="shrink-0 text-[11px] tabular-nums text-text-muted">
                            {size(f.size_bytes ?? 0)}
                          </span>
                        </button>
                      ))
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>

        {total > 0 && (
          <span className="text-[11px] tabular-nums text-text-muted">{size(total)} in total</span>
        )}
      </div>

      {error && <p className="mt-1.5 text-[12px] text-text-danger">{error}</p>}
    </div>
  );
}

function size(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

