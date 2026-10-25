import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertCircle, AlertTriangle, ArrowLeft, Check, Eraser, Eye, FileDown, FolderOpen, Info, Loader2, Search, Trash2 } from "lucide-react";
import PageHeader from "../components/PageHeader";
import ManualForm from "../components/ManualForm";
import HblBoxes, { inputBase, Labelled, Section } from "../components/HblBoxes";
import HawbBoxes from "../components/HawbBoxes";
import { normaliseHbl, paperless, RELEASE_HINT, RELEASE_LABEL, RELEASE_MODES, type HblData, type ReleaseMode } from "../lib/hbl";
import { normaliseHawb } from "../lib/hawb";
import type { HblPrint } from "../lib/documents/hblPdf";
import {
  blFieldOf,
  blOf,
  documentForKey,
  emptyState,
  emptyStore,
  manualDocument,
  MANUAL_DOCUMENTS,
  matches,
  missingOf,
  pdfOf,
  PREPARED_BY,
  savedKeyOf,
  savedLabelOf,
  savedValuesOf,
  withSaved,
  type ManualDoc,
  type ManualState,
} from "../lib/documents/manual";
import { issuedTaxInvoiceNumber, takeTaxInvoiceNumber } from "../services/invoiceNumbers";
import { findManualDocuments, normaliseBl, removeManualDocument, saveManualDocument, type SavedDocument } from "../services/manualDocuments";
import { listPeople, type Person } from "../services/enquiries";
import { useAuth } from "../lib/auth";
import { formatDate } from "../lib/dates";
import { MANUAL_GROUP_LABEL, unreadableNumbers, type ManualGroup, type ManualRow } from "../lib/documents/manualForm";

/**
 * Manual documents — any document the desk issues, typed in by hand.
 *
 * ---------------------------------------------------------------------------
 * TEMPORARY, AND SAYS SO
 *
 * The Documentation page lists what the desk issues and the cases it is
 * issued against; every one of those documents is drawn from a record. This
 * page is for the paper no record holds yet, while jobs are still being moved
 * into the CRM. It saves nothing: what is typed is kept in sessionStorage, so
 * it survives moving between pages and a reload, and goes with the tab — desk
 * machines are shared, and a consignee's address should not wait in a browser
 * for whoever sits down next.
 *
 * TYPED ONCE
 *
 * The twelve shipment documents read one set of details, as they read one
 * booking on a job: type the consignee for the CAN and the delivery order has
 * it. The console's five share theirs the same way. The house bills each have
 * their own form, the one their tab on a job uses.
 *
 * KEPT BY B/L NUMBER (15 Oct)
 *
 * Every document viewed or downloaded here with a B/L number is saved under
 * that number in the database (139, services/manualDocuments) — one row per
 * B/L and document, replaced when it is printed again. Typing a B/L number
 * in "Saved documents" lists what was made for it, to open back into its form
 * or download as it was. What is typed between prints still lives in the tab.
 *
 * WHERE THE JOB EXISTS, USE THE JOB
 *
 * A document issued from a job is filed on it, numbered from its sequence,
 * sent from the thread and on its timeline. Nothing here is any of those, and
 * the page says so where it matters: above every form, and against an
 * original bill of lading.
 * ---------------------------------------------------------------------------
 */

const STORAGE_KEY = "manualDocuments:v1";

/**
 * What was typed in this tab, read back — or a fresh start.
 *
 * Merged over a fresh state rather than taken as is, so a field added since
 * it was written exists blank instead of undefined, and a house bill saved by
 * an earlier build still opens.
 */
function restore(): ManualState {
  const fresh = emptyState();
  try {
    const kept = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null") as Partial<ManualState> | null;
    if (!kept) return fresh;
    return {
      shipment: { ...fresh.shipment, ...(kept.shipment ?? {}) },
      console: { ...fresh.console, ...(kept.console ?? {}) },
      hbl: { ...fresh.hbl, ...(kept.hbl ?? {}), data: normaliseHbl(kept.hbl?.data) },
      hawb: { ...fresh.hawb, ...(kept.hawb ?? {}), data: normaliseHawb(kept.hawb?.data) },
    };
  } catch {
    // Private windows and blocked site data throw: start empty rather than not at all.
    return fresh;
  }
}

const GROUPS: ManualGroup[] = ["shipment", "bills", "console"];

export default function ManualDocuments() {
  const { session } = useAuth();
  const [state, setState] = useState<ManualState>(restore);
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [note, setNote] = useState<{ tone: "danger" | "success" | "info"; text: string } | null>(null);
  /** Moved on each save, so the list of saved documents reads again. */
  const [savedTick, setSavedTick] = useState(0);

  // The chosen document is in the address, so a reload and Back land on it.
  const doc = manualDocument(params.get("doc")) ?? MANUAL_DOCUMENTS[0];
  const choose = (id: string) => {
    setNote(null);
    setParams({ doc: id }, { replace: false });
  };

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Full or blocked: what is typed still works for as long as the page is open.
    }
  }, [state]);

  const missing = useMemo(() => missingOf(doc, state), [doc, state]);
  const shown = MANUAL_DOCUMENTS.filter((d) => matches(d, query));

  async function print(how: "view" | "download") {
    setNote(null);
    // A tax invoice is numbered first (141): its tab opened now, while the click
    // still counts, so the pop-up blocker lets it through, and filled once drawn.
    const asking = doc.editor === "form" ? doc.numbering?.(state[doc.store as "shipment" | "console"]) : undefined;
    // Not "noopener" as a feature: with it, window.open returns null whether
    // or not the tab opened, and a blocked tab could not be told from an open
    // one. The opener is cut by hand instead; the page is our own PDF anyway.
    const early = how === "view" && asking ? window.open("", "_blank") : null;
    if (how === "view" && asking && !early) {
      setNote({ tone: "danger", text: "Your browser blocked the new tab. Allow pop-ups for this site, or use Download." });
      return;
    }
    if (early) early.opener = null;
    try {
      let s = state;
      if (asking && doc.editor === "form") {
        const number = asking.take ? await takeTaxInvoiceNumber(asking.bl, asking.date) : (await issuedTaxInvoiceNumber(asking.bl)) ?? undefined;
        s = { ...state, [doc.store]: asking.apply(number) };
      }
      // Who printed it, for the reference line at the foot of a DO, an arrival notice (and kept with it when saved).
      if (doc.store === "shipment" && session?.name) s = { ...s, shipment: { ...s.shipment, [PREPARED_BY]: session.name } };
      if (s !== state) setState(s);
      const { pdf, name } = pdfOf(doc, s);
      if (how === "download") {
        pdf.save(name);
        void keep(s);
        return;
      }
      // Read, not kept: a tab, its address revoked once it has had time to load (lib/documents viewDocument).
      const url = pdf.output("bloburl") as unknown as string;
      const tab = early ?? window.open(url, "_blank");
      if (early) early.location.href = url;
      else if (tab) tab.opener = null;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      if (!tab) setNote({ tone: "danger", text: "Your browser blocked the new tab. Allow pop-ups for this site, or use Download." });
      else void keep(s);
    } catch (e) {
      early?.close();
      setNote({
        tone: "danger",
        text: asking
          ? `The invoice could not be numbered: ${e instanceof Error ? e.message : "unknown error"}.`
          : `The PDF could not be drawn: ${e instanceof Error ? e.message : "unknown error"}.`,
      });
    }
  }

  /** Printed with a B/L number: saved under it, replacing what was saved for this document before. */
  async function keep(state: ManualState) {
    const bl = blOf(doc, state);
    if (!bl) {
      setNote({ tone: "info", text: `Not saved: type the ${blFieldOf(doc)} to keep it under, then view or download it again.` });
      return;
    }
    try {
      const label = savedLabelOf(doc, state);
      const row = await saveManualDocument({
        bl_number: bl,
        doc_key: savedKeyOf(doc, state),
        title: label.title,
        document_no: label.documentNo,
        store: doc.store,
        values: savedValuesOf(doc, state),
      });
      setNote({ tone: "success", text: `Saved under ${row.bl_number}: find it again by that number under Saved documents.` });
      setSavedTick((t) => t + 1);
    } catch (e) {
      setNote({ tone: "danger", text: `Printed, but not saved: ${e instanceof Error ? e.message : "unknown error"}` });
    }
  }

  /** A saved document back in its form, to change and print again. */
  function openSaved(row: SavedDocument) {
    const target = documentForKey(row.doc_key);
    if (!target) {
      setNote({ tone: "danger", text: `"${row.title}" is not a document this page knows any more.` });
      return;
    }
    const typed = JSON.stringify(state[row.store]) !== JSON.stringify(emptyStore(row.store));
    const sharing = MANUAL_DOCUMENTS.filter((d) => d.store === row.store).length;
    if (typed && !window.confirm(`Open ${row.title} for ${row.bl_number}? It replaces what is typed${sharing > 1 ? ` for the ${sharing} documents that share these details` : ""}.`)) return;
    setState((s) => withSaved(s, row.store, row.values));
    choose(target.id);
    setNote({ tone: "success", text: `Opened ${row.title} for ${row.bl_number}, as it was saved ${formatDate(row.updated_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: true })}.` });
  }

  /** A saved document downloaded as it was, without touching what is typed. */
  function downloadSaved(row: SavedDocument) {
    const target = documentForKey(row.doc_key);
    if (!target) {
      setNote({ tone: "danger", text: `"${row.title}" is not a document this page knows any more.` });
      return;
    }
    try {
      const { pdf, name } = pdfOf(target, withSaved(emptyState(), row.store, row.values));
      pdf.save(name);
    } catch (e) {
      setNote({ tone: "danger", text: `The PDF could not be drawn: ${e instanceof Error ? e.message : "unknown error"}.` });
    }
  }

  function clear() {
    const sharing = MANUAL_DOCUMENTS.filter((d) => d.store === doc.store);
    const what = sharing.length > 1 ? `the details shared by all ${sharing.length} ${MANUAL_GROUP_LABEL[doc.group].toLowerCase()}` : `the ${doc.shortName.toLowerCase()}`;
    if (!window.confirm(`Clear ${what}? This cannot be undone.`)) return;
    setState((s) => ({ ...s, [doc.store]: emptyStore(doc.store) }));
    setNote({ tone: "success", text: "Cleared." });
  }

  const setField = (key: string, value: string | ManualRow[]) =>
    setState((s) => (doc.store === "shipment" || doc.store === "console" ? { ...s, [doc.store]: { ...s[doc.store], [key]: value } } : s));

  return (
    <div>
      <PageHeader
        title="Manual documents"
        subtitle="Type any document in by hand and print it on the letterhead — for paper a job in the CRM does not hold yet."
        action={
          <Link
            to="/documentation"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
          >
            <ArrowLeft size={13} />
            Documentation
          </Link>
        }
      />

      <div className="mb-4 flex items-start gap-2 rounded-lg bg-bg-warning px-3 py-2.5 text-[12px] leading-relaxed text-text-warning">
        <Info size={13} className="mt-0.5 shrink-0" />
        <p>
          <strong className="font-semibold">Not a job.</strong> Nothing here is filed on a job, numbered from a sequence or sent. Each document you view or
          download with a B/L number is saved under that number — find it again under Saved documents. Where the job is in the CRM, issue the
          document from the job instead, so it is filed there.
        </p>
      </div>

      <SavedDocuments refreshKey={savedTick} onOpen={openSaved} onDownload={downloadSaved} onError={(text) => setNote({ tone: "danger", text })} />

      <div className="grid gap-4 lg:grid-cols-[264px_minmax(0,1fr)]">
        {/* ------------------------------------------------ choosing one */}
        <aside className="min-w-0">
          {/* A phone: one control, not a list longer than the screen. */}
          <label className="block lg:hidden">
            <span className="mb-1 block text-[11.5px] font-medium text-text-secondary">Document</span>
            <select value={doc.id} onChange={(e) => choose(e.target.value)} className="h-10 w-full">
              {GROUPS.map((g) => (
                <optgroup key={g} label={MANUAL_GROUP_LABEL[g]}>
                  {MANUAL_DOCUMENTS.filter((d) => d.group === g).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.shortName}
                      {d.alias ? ` (${d.alias})` : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          <div className="card hidden p-2 lg:sticky lg:top-4 lg:block">
            <div className="relative mb-2">
              <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find — CAN, DO, B/L…"
                aria-label="Find a document"
                className="h-8 w-full pl-8 text-[12.5px]"
              />
            </div>
            <nav className="max-h-[calc(100vh-11rem)] overflow-y-auto overscroll-contain">
              {GROUPS.map((g) => {
                const items = shown.filter((d) => d.group === g);
                if (!items.length) return null;
                return (
                  <div key={g} className="mb-2">
                    <p className="px-2 pb-1 pt-1.5 text-[10.5px] font-medium uppercase tracking-wide text-text-muted">{MANUAL_GROUP_LABEL[g]}</p>
                    {items.map((d) => (
                      <DocButton key={d.id} doc={d} state={state} active={d.id === doc.id} onClick={() => choose(d.id)} />
                    ))}
                  </div>
                );
              })}
              {!shown.length && <p className="px-2 py-3 text-[12px] text-text-muted">No document by that name.</p>}
            </nav>
          </div>
        </aside>

        {/* ------------------------------------------------ the document */}
        <div className="min-w-0">
          <DocHeader doc={doc} state={state} missing={missing} onView={() => print("view")} onDownload={() => print("download")} onClear={clear} />

          {note && (
            <p
              className={`mb-3 flex items-start gap-2 rounded-lg px-3 py-2.5 text-[12px] ${
                note.tone === "danger" ? "bg-bg-danger text-text-danger" : note.tone === "info" ? "bg-surface-2 text-text-secondary" : "bg-bg-success text-text-success"
              }`}
            >
              {note.tone === "danger" ? (
                <AlertCircle size={13} className="mt-px shrink-0" />
              ) : note.tone === "info" ? (
                <Info size={13} className="mt-px shrink-0" />
              ) : (
                <Check size={13} className="mt-px shrink-0" />
              )}
              {note.text}
            </p>
          )}

          {doc.editor === "form" && <ManualForm sections={doc.sections} values={state[doc.store as "shipment" | "console"]} onChange={setField} />}
          {doc.editor === "hbl" && <HblEditor value={state.hbl} onChange={(hbl) => setState((s) => ({ ...s, hbl: hbl(s.hbl) }))} />}
          {doc.editor === "hawb" && <HawbEditor value={state.hawb} onChange={(hawb) => setState((s) => ({ ...s, hawb: hawb(s.hawb) }))} />}

          {/* The same two buttons at the foot of a long form, so the end of it is not a scroll back up. */}
          <div className="mt-1 flex flex-wrap items-center justify-end gap-2">
            <ActionButtons onView={() => print("view")} onDownload={() => print("download")} draft={doc.stampsDraft && missing.length > 0} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Saved documents, by B/L number
// ---------------------------------------------------------------------------

/**
 * Type a B/L number, see what was made for it.
 *
 * Read as it is typed (after a pause), and every B/L that begins with it is
 * listed, so "HBL/26-27/004" finds 0040 to 0049. Each document opens back into
 * its form or downloads as it was saved; whoever saved one, or an
 * administrator, can remove it.
 */
function SavedDocuments({
  refreshKey,
  onOpen,
  onDownload,
  onError,
}: {
  refreshKey: number;
  onOpen: (row: SavedDocument) => void;
  onDownload: (row: SavedDocument) => void;
  onError: (text: string) => void;
}) {
  const { session } = useAuth();
  const [bl, setBl] = useState("");
  const [rows, setRows] = useState<SavedDocument[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [removedTick, setRemovedTick] = useState(0);

  useEffect(() => {
    void listPeople().then(setPeople).catch(() => setPeople([]));
  }, []);
  const nameOf = (id: string | null) => people.find((p) => p.id === id)?.full_name ?? null;

  const q = normaliseBl(bl);
  useEffect(() => {
    if (q.length < 2) {
      setRows(null);
      setError(null);
      return;
    }
    let live = true;
    const t = window.setTimeout(() => {
      setLoading(true);
      findManualDocuments(q)
        .then((r) => {
          if (!live) return;
          setRows(r);
          setError(null);
        })
        .catch((e) => live && setError(e instanceof Error ? e.message : "Could not read the saved documents."))
        .finally(() => live && setLoading(false));
    }, 300);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [q, refreshKey, removedTick]);

  async function remove(row: SavedDocument) {
    if (!window.confirm(`Remove the saved ${row.title} for ${row.bl_number}? It cannot be undone.`)) return;
    try {
      await removeManualDocument(row.id);
      setRemovedTick((t) => t + 1);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not remove it.");
    }
  }

  // Grouped by B/L, in the order the newest of each was saved.
  const groups = useMemo(() => {
    const by = new Map<string, SavedDocument[]>();
    for (const r of rows ?? []) by.set(r.bl_number, [...(by.get(r.bl_number) ?? []), r]);
    return [...by.entries()];
  }, [rows]);

  return (
    <div className="card mb-4 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <h2 className="shrink-0 text-[13px] font-semibold text-text-primary">Saved documents</h2>
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={bl}
            onChange={(e) => setBl(e.target.value)}
            placeholder="B/L number — HBL/26-27/0042"
            aria-label="Find saved documents by B/L number"
            className="h-8 w-full pl-8 font-mono text-[12.5px]"
          />
        </div>
        {loading && <Loader2 size={13} className="animate-spin text-text-muted" aria-label="Looking" />}
      </div>

      {error && (
        <p className="mt-2 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" /> {error}
        </p>
      )}
      {!error && rows && rows.length === 0 && !loading && (
        <p className="mt-2 text-[12px] text-text-muted">Nothing saved under a B/L number beginning {q}.</p>
      )}
      {!error && groups.length > 0 && (
        <div className="mt-3 space-y-3">
          {groups.map(([number, docs]) => (
            <div key={number}>
              <p className="mb-1 font-mono text-[11.5px] font-medium text-text-secondary">{number}</p>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {docs.map((r) => {
                  const who = nameOf(r.updated_by ?? r.created_by);
                  const mine = Boolean(session) && (r.created_by === session?.userId || session?.role === "admin");
                  return (
                    <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12.5px] font-medium text-text-primary">{r.title}</p>
                        <p className="truncate text-[11px] text-text-muted">
                          {r.document_no && <span className="font-mono">{r.document_no} · </span>}
                          Saved {formatDate(r.updated_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: true })}
                          {who ? ` by ${who}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onOpen(r)}
                          className="inline-flex h-7 items-center gap-1 rounded-lg border border-border px-2.5 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
                        >
                          <FolderOpen size={12} /> Open
                        </button>
                        <button
                          type="button"
                          onClick={() => onDownload(r)}
                          className="inline-flex h-7 items-center gap-1 rounded-lg border border-border px-2.5 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
                        >
                          <FileDown size={12} /> Download
                        </button>
                        {mine && (
                          <button
                            type="button"
                            onClick={() => void remove(r)}
                            aria-label={`Remove the saved ${r.title}`}
                            title="Remove"
                            className="grid size-7 place-items-center rounded-lg text-text-muted transition-colors hover:bg-bg-danger hover:text-text-danger"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {rows && rows.length >= 50 && <p className="text-[11px] text-text-muted">The fifty most recent: type more of the number to narrow it.</p>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

function DocButton({ doc, state, active, onClick }: { doc: ManualDoc; state: ManualState; active: boolean; onClick: () => void }) {
  const missing = missingOf(doc, state);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`group relative mb-0.5 flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] transition-colors ${
        active ? "bg-surface-2 font-medium text-text-primary" : "text-text-secondary hover:bg-surface-2 hover:text-text-primary"
      }`}
    >
      <span className={`absolute bottom-1.5 left-0 top-1.5 w-[3px] rounded-full bg-brand ${active ? "opacity-100" : "opacity-0"}`} />
      <span className="min-w-0 flex-1 truncate">{doc.shortName}</span>
      {doc.alias && <span className="shrink-0 rounded bg-surface-2 px-1 text-[10px] font-medium text-text-muted group-hover:bg-surface-1">{doc.alias}</span>}
      {doc.stampsDraft &&
        (missing.length ? (
          <span className="shrink-0 text-[10.5px] tabular-nums text-text-warning" title={`Still needs: ${missing.join(", ")}`}>
            {missing.length}
          </span>
        ) : (
          <Check size={12} className="shrink-0 text-text-success" aria-label="Ready" />
        ))}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Above the form: what it is, what it prints as, what it still needs
// ---------------------------------------------------------------------------

function DocHeader({
  doc,
  state,
  missing,
  onView,
  onDownload,
  onClear,
}: {
  doc: ManualDoc;
  state: ManualState;
  missing: string[];
  onView: () => void;
  onDownload: () => void;
  onClear: () => void;
}) {
  const sharing = MANUAL_DOCUMENTS.filter((d) => d.store === doc.store).length;
  const values = doc.editor === "form" ? state[doc.store as "shipment" | "console"] : null;
  const unreadable = doc.editor === "form" && values ? unreadableNumbers(doc.sections, values) : [];
  const number = doc.editor === "form" && doc.documentNo && values ? doc.documentNo(values) : null;
  const original = (doc.editor === "hbl" && state.hbl.print === "original") || (doc.editor === "hawb" && state.hawb.kind === "original");

  return (
    <div className="card mb-3 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 text-[16px] font-semibold text-text-primary">
            {doc.shortName}
            {doc.alias && <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-text-secondary">{doc.alias}</span>}
          </h2>
          <p className="mt-0.5 text-[12.5px] text-text-secondary">{doc.purpose}</p>
          {number && (
            <p className="mt-1.5 text-[11.5px] text-text-muted">
              Prints as <span className="font-mono text-text-primary">{number}</span>
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <ActionButtons onView={onView} onDownload={onDownload} draft={doc.stampsDraft && missing.length > 0} />
          <button
            type="button"
            onClick={onClear}
            title={sharing > 1 ? `Clears what is typed for all ${sharing} documents that share these details` : "Clears what is typed"}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-danger"
          >
            <Eraser size={13} />
            Clear
          </button>
        </div>
      </div>

      {doc.stampsDraft &&
        (missing.length ? (
          <p className="mt-3 flex items-start gap-2 rounded-lg bg-bg-warning px-3 py-2 text-[12px] text-text-warning">
            <AlertTriangle size={13} className="mt-px shrink-0" />
            <span>
              Prints as a <strong className="font-semibold">DRAFT</strong> until it has: {missing.join(", ")}. The draft lists them on the document,
              to send for what is missing.
            </span>
          </p>
        ) : (
          <p className="mt-3 flex items-center gap-2 rounded-lg bg-bg-success px-3 py-2 text-[12px] text-text-success">
            <Check size={13} className="shrink-0" /> Complete: prints as final. Anything left empty prints as TBD.
          </p>
        ))}
      {!doc.stampsDraft && missing.length > 0 && (
        <p
          className={`mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-[12px] ${
            original ? "bg-bg-warning text-text-warning" : "bg-surface-2 text-text-secondary"
          }`}
        >
          <AlertTriangle size={13} className="mt-px shrink-0" />
          <span>
            {original ? "An original needs" : "Still empty"}: {missing.join(", ")}.
          </span>
        </p>
      )}
      {original && (
        <p className="mt-2 flex items-start gap-2 text-[11.5px] leading-relaxed text-text-muted">
          <Info size={12} className="mt-0.5 shrink-0" />
          An original printed here is not numbered from the house bill sequence, approved by the shipper, or recorded on any job. Where the job is in the
          CRM, issue it from the job&rsquo;s own tab.
        </p>
      )}
      {unreadable.length > 0 && (
        <p className="mt-2 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          <span>Not read as numbers, so printed as nothing: {unreadable.join(", ")}.</span>
        </p>
      )}
      {sharing > 1 && (
        <p className="mt-2 text-[11.5px] text-text-muted">
          These details are shared by the {sharing} {MANUAL_GROUP_LABEL[doc.group].toLowerCase()}: what you type here fills the others too.
        </p>
      )}
    </div>
  );
}

function ActionButtons({ onView, onDownload, draft }: { onView: () => void; onDownload: () => void; draft: boolean }) {
  return (
    <>
      <button
        type="button"
        onClick={onView}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
      >
        <Eye size={13} />
        View
      </button>
      <button
        type="button"
        onClick={onDownload}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-medium text-white transition-colors hover:bg-brand-dark"
      >
        <FileDown size={13} />
        {draft ? "Download draft" : "Download PDF"}
      </button>
    </>
  );
}

// ---------------------------------------------------------------------------
// The house bills: the forms their tabs on a job use, without the job
// ---------------------------------------------------------------------------

type ManualHblState = ManualState["hbl"];
type ManualHawbState = ManualState["hawb"];

const PRINT_LABEL: Record<HblPrint, string> = {
  draft: "Draft, for approval",
  copy: "Copy, non-negotiable",
  original: "Original",
};

function HblEditor({ value, onChange }: { value: ManualHblState; onChange: (fn: (v: ManualHblState) => ManualHblState) => void }) {
  const set = <K extends keyof HblData>(k: K, v: HblData[K]) => onChange((s) => ({ ...s, data: { ...s.data, [k]: v } }));
  const base = `${inputBase} h-8 w-full`;
  return (
    <>
      <Section title="The bill">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Labelled label="House B/L number">
            <input value={value.hblNo} onChange={(e) => onChange((s) => ({ ...s, hblNo: e.target.value.toUpperCase() }))} placeholder="HBL/26-27/0001" className={`${base} font-mono`} />
          </Labelled>
          <Labelled label="Released as">
            <select value={value.release} onChange={(e) => onChange((s) => ({ ...s, release: e.target.value as ReleaseMode }))} className={base}>
              {RELEASE_MODES.map((r) => (
                <option key={r} value={r}>
                  {RELEASE_LABEL[r]}
                </option>
              ))}
            </select>
          </Labelled>
          <Labelled label="Originals">
            <select
              value={value.originals}
              disabled={paperless(value.release)}
              onChange={(e) => onChange((s) => ({ ...s, originals: Number(e.target.value) }))}
              className={base}
            >
              {[1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Labelled>
          <Labelled label="Print as">
            <select value={value.print} onChange={(e) => onChange((s) => ({ ...s, print: e.target.value as HblPrint }))} className={base}>
              {(Object.keys(PRINT_LABEL) as HblPrint[]).map((p) => (
                <option key={p} value={p}>
                  {PRINT_LABEL[p]}
                </option>
              ))}
            </select>
          </Labelled>
        </div>
        <p className="mt-2 text-[11.5px] text-text-muted">{RELEASE_HINT[value.release]}</p>
      </Section>
      <HblBoxes d={value.data} set={set} ro={false} variant="ours" express={value.release === "express"} manual />
    </>
  );
}

function HawbEditor({ value, onChange }: { value: ManualHawbState; onChange: (fn: (v: ManualHawbState) => ManualHawbState) => void }) {
  const base = `${inputBase} h-8 w-full`;
  return (
    <>
      <Section title="The air waybill">
        <div className="grid gap-3 sm:grid-cols-3">
          <Labelled label="HAWB number">
            <input value={value.hawbNo} onChange={(e) => onChange((s) => ({ ...s, hawbNo: e.target.value.toUpperCase() }))} placeholder="MAA/DXB/HAWB/0001" className={`${base} font-mono`} />
          </Labelled>
          <Labelled label="HAWB date">
            <input type="date" value={value.hawbDate} onChange={(e) => onChange((s) => ({ ...s, hawbDate: e.target.value }))} className={`${base} tabular-nums`} />
          </Labelled>
          <Labelled label="Airway bill">
            <select value={value.kind} onChange={(e) => onChange((s) => ({ ...s, kind: e.target.value as "draft" | "original" }))} className={base}>
              <option value="draft">Draft</option>
              <option value="original">Original</option>
            </select>
          </Labelled>
        </div>
      </Section>
      <HawbBoxes d={value.data} update={(fn) => onChange((s) => ({ ...s, data: fn(s.data) }))} ro={false} />
    </>
  );
}
