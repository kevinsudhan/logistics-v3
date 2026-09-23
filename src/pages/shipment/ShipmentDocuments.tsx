import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  ExternalLink,
  Loader2,
  Lock,
  Paperclip,
  Plus,
  Trash2,
  Unlock,
  UploadCloud,
  X,
} from "lucide-react";
import Collapsible from "../../components/Collapsible";
import DocumentsPanel from "../../components/DocumentsPanel";
import { Segmented } from "../../components/formControls";
import { useShipment } from "../ShipmentDetail";
import { useAuth } from "../../lib/auth";
import { failureText } from "../../lib/errorText";
import { documentDataFromBooking } from "../../lib/documents";
import {
  DOCUMENT_TYPES,
  fileUrl,
  listFiles,
  removeFile,
  updateFileMeta,
  uploadFile,
  type EnquiryFile,
} from "../../services/attachments";

/**
 * The job's paper: what has been filed, and what can be generated.
 *
 * ---------------------------------------------------------------------------
 * ONE STORE FOR THE WHOLE JOB
 *
 * The files live against the enquiry reference (049), so the shipper's invoice
 * saved off a mail on day one, a PDF uploaded here, and a generated draft are
 * one list — on the case file and on the shipment alike.
 *
 * PROTECTED
 *
 * An issued house bill or a signed POD should not be lost to a tidy-up. A
 * protected file can only be deleted, or unprotected, by an admin; the
 * database enforces it (065), this screen only says so.
 * ---------------------------------------------------------------------------
 */
export default function ShipmentDocuments() {
  const { shipment } = useShipment();
  const navigate = useNavigate();
  const { session } = useAuth();
  const [files, setFiles] = useState<EnquiryFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setFiles(await listFiles(shipment.enquiry_ref));
    } catch (e) {
      setError(failureText(e, "Could not read the files.").message);
    }
  }, [shipment.enquiry_ref]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(failureText(e, "That did not work.").message);
    } finally {
      setBusy(null);
    }
  }

  const isAdmin = session?.role === "admin";

  return (
    <div>
      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      <Collapsible
        id="shipment:attachments"
        title="Attachments"
        icon={<Paperclip size={12} className="shrink-0 text-text-muted" />}
        badge={files.length ? `${files.length}` : undefined}
      >
        <Uploader enquiryRef={shipment.enquiry_ref} onUploaded={load} />

        {files.length > 0 && (
          <div className="mt-5 overflow-x-auto border-t border-border pt-4">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-muted">
              Filed on this job
            </p>
            <table className="w-full min-w-[760px] border-collapse text-[12.5px]">
              <thead>
                <tr className="bg-surface-2 text-left text-[11px] font-medium text-text-secondary">
                  <th className="px-2 py-2 font-medium">File</th>
                  <th className="px-2 py-2 font-medium">Document type</th>
                  <th className="px-2 py-2 font-medium">Reference number</th>
                  <th className="px-2 py-2 font-medium">From</th>
                  <th className="px-2 py-2 font-medium">Protection</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {files.map((f) => (
                  <tr key={f.id} className="border-t border-border align-middle">
                    <td className="max-w-[220px] px-2 py-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          void fileUrl(f.path)
                            .then((u) => window.open(u, "_blank", "noopener"))
                            .catch((e) => setError(failureText(e, "Could not open it.").message))
                        }
                        className="flex min-w-0 items-center gap-1.5 text-left text-text-accent hover:underline"
                        title={f.name}
                      >
                        <ExternalLink size={12} className="shrink-0" />
                        <span className="truncate">{f.name}</span>
                      </button>
                    </td>
                    <td className="px-1 py-1">
                      <select
                        value={f.document_type ?? ""}
                        onChange={(e) =>
                          void run(f.id, () => updateFileMeta(f.id, { document_type: e.target.value || null }))
                        }
                        className="h-8 w-full min-w-[150px]"
                      >
                        <option value="">Not classified</option>
                        {DOCUMENT_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-1 py-1">
                      <RefCell
                        value={f.reference_number ?? ""}
                        onSave={(v) => void run(f.id, () => updateFileMeta(f.id, { reference_number: v || null }))}
                      />
                    </td>
                    <td className="px-2 py-1.5 text-[11.5px] text-text-muted">
                      {f.source === "mail" ? "Mail" : f.source === "generated" ? "Generated" : "Uploaded"}
                      {" · "}
                      {new Date(f.filed_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                    </td>
                    <td className="px-1 py-1">
                      <button
                        type="button"
                        disabled={busy !== null || (f.protected && !isAdmin)}
                        onClick={() => void run(f.id, () => updateFileMeta(f.id, { protected: !f.protected }))}
                        title={
                          f.protected && !isAdmin
                            ? "Only an admin can unprotect a file"
                            : f.protected
                              ? "Unprotect"
                              : "Protect — only an admin can then delete it"
                        }
                        className={`inline-flex h-7 items-center gap-1 rounded-lg border px-2 text-[11.5px] disabled:opacity-60 ${
                          f.protected
                            ? "border-brand bg-brand text-white"
                            : "border-border bg-surface-1 text-text-secondary hover:border-border-strong"
                        }`}
                      >
                        {f.protected ? <Lock size={11} /> : <Unlock size={11} />}
                        {f.protected ? "Protected" : "Unprotected"}
                      </button>
                    </td>
                    <td className="px-1 py-1 text-right">
                      <button
                        type="button"
                        disabled={busy !== null || (f.protected && !isAdmin)}
                        onClick={() => {
                          if (window.confirm(`Delete ${f.name} from this job?`))
                            void run(`rm:${f.id}`, () => removeFile(f));
                        }}
                        className="rounded p-1 text-text-muted hover:text-text-danger disabled:opacity-40"
                        aria-label={`Delete ${f.name}`}
                        title={f.protected && !isAdmin ? "Protected — only an admin can delete it" : "Delete"}
                      >
                        {busy === `rm:${f.id}` ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Collapsible>

      {/* Drafted from this booking; a draft names what it is missing, and the
          missing particulars are on the Cargo tab. */}
      <section className="card mt-4 px-5 py-2">
        <DocumentsPanel
          data={documentDataFromBooking(shipment, shipment.customer)}
          defaultOpen
          onFillDetails={() => navigate("../cargo")}
        />
      </section>
    </div>
  );
}

/** Rows waiting to be uploaded, as the reference form lays them out. */
interface Pending {
  key: number;
  type: string;
  reference: string;
  file: File | null;
  protected: boolean;
  error?: string;
}

function Uploader({ enquiryRef, onUploaded }: { enquiryRef: string; onUploaded: () => Promise<void> }) {
  const blank = (key: number): Pending => ({ key, type: "", reference: "", file: null, protected: false });
  const [rows, setRows] = useState<Pending[]>([blank(1)]);
  const [saving, setSaving] = useState(false);
  const next = useRef(2);

  const set = (key: number, patch: Partial<Pending>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch, error: undefined } : r)));

  const ready = rows.filter((r) => r.file || r.type || r.reference);
  const valid = ready.length > 0 && ready.every((r) => r.file && r.type);

  async function save() {
    setSaving(true);
    const failed: Pending[] = [];
    for (const r of ready) {
      try {
        await uploadFile({
          enquiryRef,
          file: r.file!,
          documentType: r.type,
          referenceNumber: r.reference,
          protected: r.protected,
        });
      } catch (e) {
        failed.push({ ...r, error: failureText(e, "Did not upload.").message });
      }
    }
    // What went up is cleared; what did not stays, with the reason on its row.
    setRows(failed.length ? failed : [blank(next.current++)]);
    setSaving(false);
    await onUploaded();
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-[12.5px]">
          <thead>
            <tr className="text-left text-[11px] font-medium text-text-secondary">
              <th className="w-8 pb-2 font-medium">No.</th>
              <th className="pb-2 pr-2 font-medium">
                Document type <span className="text-text-danger">*</span>
              </th>
              <th className="pb-2 pr-2 font-medium">Reference number</th>
              <th className="pb-2 pr-2 font-medium">
                File <span className="text-text-danger">*</span>
              </th>
              <th className="pb-2 pr-2 font-medium" />
              <th className="w-8 pb-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key} className="align-top">
                <td className="py-1 pr-2 pt-3 text-[11px] tabular-nums text-text-muted">{i + 1}</td>
                <td className="py-1 pr-2">
                  <select
                    value={r.type}
                    onChange={(e) => set(r.key, { type: e.target.value })}
                    className="h-9 w-full min-w-[170px]"
                  >
                    <option value="">Please select</option>
                    {DOCUMENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-1 pr-2">
                  <input
                    value={r.reference}
                    onChange={(e) => set(r.key, { reference: e.target.value })}
                    placeholder="Reference number"
                    className="h-9 w-full min-w-[140px]"
                  />
                </td>
                <td className="py-1 pr-2">
                  <DropFile file={r.file} onFile={(file) => set(r.key, { file })} />
                  {r.error && <p className="mt-1 text-[11px] text-text-danger">{r.error}</p>}
                </td>
                <td className="py-1 pr-2">
                  <div className="w-[190px]">
                    <Segmented
                      options={[
                        { value: "no", label: "Unprotected" },
                        { value: "yes", label: "Protected" },
                      ]}
                      value={r.protected ? "yes" : "no"}
                      onChange={(v) => set(r.key, { protected: v === "yes" })}
                    />
                  </div>
                </td>
                <td className="py-1 pt-2.5 text-right">
                  {rows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                      className="rounded p-1 text-text-muted hover:text-text-danger"
                      aria-label={`Remove row ${i + 1}`}
                    >
                      <X size={13} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setRows((rs) => [...rs, blank(next.current++)])}
          className="flex items-center gap-1.5 text-[12px] text-text-secondary hover:text-text-primary"
        >
          <Plus size={13} /> Add attachment
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setRows([blank(next.current++)])}
            disabled={saving || ready.length === 0}
            className="h-8 rounded-lg border border-border px-4 text-[12px] text-text-secondary hover:text-text-primary disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !valid}
            title={valid ? undefined : "Each row needs a document type and a file"}
            className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-4 text-[12px] font-medium text-white hover:bg-brand-dark disabled:opacity-50"
          >
            {saving && <Loader2 size={13} className="animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

/** A drop zone that is also a Browse button. */
function DropFile({ file, onFile }: { file: File | null; onFile: (f: File | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      className={`flex h-9 min-w-[220px] items-center overflow-hidden rounded-lg border ${
        over ? "border-brand bg-bg-accent" : "border-border bg-surface-1"
      }`}
    >
      <span className={`min-w-0 flex-1 truncate px-2.5 text-[12px] ${file ? "text-text-primary" : "text-text-muted"}`}>
        {file ? file.name : "Drag and drop"}
      </span>
      {file && (
        <button
          type="button"
          onClick={() => onFile(null)}
          className="px-1.5 text-text-muted hover:text-text-danger"
          aria-label="Clear the file"
        >
          <X size={12} />
        </button>
      )}
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="flex h-full items-center gap-1 bg-brand px-3 text-[12px] font-medium text-white hover:bg-brand-dark"
      >
        <UploadCloud size={12} /> Browse
      </button>
      <input
        ref={input}
        type="file"
        className="hidden"
        onChange={(e) => {
          onFile(e.target.files?.[0] ?? null);
          e.target.value = "";
        }}
      />
    </div>
  );
}

/** The reference number cell: saved when you leave it. */
function RefCell({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft.trim() !== value && onSave(draft.trim())}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      placeholder="—"
      className="h-8 w-full min-w-[120px]"
    />
  );
}
