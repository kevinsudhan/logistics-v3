import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertCircle, AlertTriangle, ArrowLeft, Check, Eraser, Eye, FileDown, Info, Search } from "lucide-react";
import PageHeader from "../components/PageHeader";
import ManualForm from "../components/ManualForm";
import HblBoxes, { inputBase, Labelled, Section } from "../components/HblBoxes";
import HawbBoxes from "../components/HawbBoxes";
import { normaliseHbl, paperless, RELEASE_HINT, RELEASE_LABEL, RELEASE_MODES, type HblData, type ReleaseMode } from "../lib/hbl";
import { normaliseHawb } from "../lib/hawb";
import type { HblPrint } from "../lib/documents/hblPdf";
import {
  emptyState,
  emptyStore,
  manualDocument,
  MANUAL_DOCUMENTS,
  matches,
  missingOf,
  pdfOf,
  type ManualDoc,
  type ManualState,
} from "../lib/documents/manual";
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
  const [state, setState] = useState<ManualState>(restore);
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [note, setNote] = useState<{ tone: "danger" | "success"; text: string } | null>(null);

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

  function print(how: "view" | "download") {
    setNote(null);
    try {
      const { pdf, name } = pdfOf(doc, state);
      if (how === "download") {
        pdf.save(name);
        return;
      }
      // Read, not kept: a tab, its address revoked once it has had time to load (lib/documents viewDocument).
      const url = pdf.output("bloburl") as unknown as string;
      // Not "noopener" as a feature: with it, window.open returns null whether
      // or not the tab opened, and a blocked tab could not be told from an open
      // one. The opener is cut by hand instead; the page is our own PDF anyway.
      const tab = window.open(url, "_blank");
      if (tab) tab.opener = null;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      if (!tab) setNote({ tone: "danger", text: "Your browser blocked the new tab. Allow pop-ups for this site, or use Download." });
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
          <strong className="font-semibold">Temporary.</strong> Nothing here is saved to a job, numbered from a sequence or sent. What you type stays in
          this browser tab until you clear it or close the tab. Where the job is in the CRM, issue the document from the job instead, so it is filed
          there.
        </p>
      </div>

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
                note.tone === "danger" ? "bg-bg-danger text-text-danger" : "bg-bg-success text-text-success"
              }`}
            >
              {note.tone === "danger" ? <AlertCircle size={13} className="mt-px shrink-0" /> : <Check size={13} className="mt-px shrink-0" />}
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
