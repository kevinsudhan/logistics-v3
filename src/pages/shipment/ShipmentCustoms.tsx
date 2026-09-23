import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, FileText, Landmark, Loader2, PauseCircle, Plus, Trash2, Upload } from "lucide-react";
import Select from "../../components/Select";
import { Field, Segmented, TextSave } from "../../components/formControls";
import { useShipment } from "../ShipmentDetail";
import { failureText } from "../../lib/errorText";
import {
  customsStatus,
  customsSteps,
  readIcegateNumber,
  readPortCode,
  sidesFor,
  STATUS_LABEL,
  type CustomsRecord,
  type CustomsSide,
  type CustomsStatus,
} from "../../lib/customs";
import { fileUrl, listFiles, uploadFile, type EnquiryFile } from "../../services/attachments";
import { customsFor, removeCustoms, startCustoms, updateCustoms } from "../../services/customs";
import { listPartners, type Partner } from "../../services/partners";

/**
 * Customs: the export clearance at origin, the import clearance at
 * destination, or both, on the way Indian customs does them (077).
 *
 * ---------------------------------------------------------------------------
 * Each field saves as it is left, like the rest of the job. The status and
 * the progress strip are worked out from what is filled, never chosen, so
 * they cannot disagree with the dates. The LEO date (export) and the
 * out-of-charge date (import) tick the matching step on the workflow bar.
 *
 * The documents are the job's own files of the customs kinds — the shipping
 * bill, the checklist, the bill of entry — so a copy attached here is the
 * same file the Documents tab and the mail's attach button see.
 * ---------------------------------------------------------------------------
 */

const DOC_TYPES = ["Shipping bill", "Customs checklist", "Customs declaration", "Bill of entry", "Out of charge"];

const TONE: Record<CustomsStatus, string> = {
  not_started: "bg-surface-2 text-text-secondary",
  checklist: "bg-bg-accent text-text-accent",
  filed: "bg-bg-accent text-text-accent",
  examination: "bg-bg-warning text-text-warning",
  manifested: "bg-bg-accent text-text-accent",
  duty_paid: "bg-bg-accent text-text-accent",
  cleared: "bg-bg-success text-text-success",
  on_hold: "bg-bg-danger text-text-danger",
};

export default function ShipmentCustoms() {
  const { shipment: s, reload } = useShipment();
  const [rows, setRows] = useState<CustomsRecord[] | null>(null);
  const [brokers, setBrokers] = useState<Partner[]>([]);
  const [files, setFiles] = useState<EnquiryFile[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, f] = await Promise.all([customsFor(s.id), listFiles(s.enquiry_ref).catch(() => [])]);
      setRows(c);
      setFiles(f.filter((x) => x.document_type && DOC_TYPES.includes(x.document_type)));
    } catch (e) {
      setError(failureText(e, "Could not load the customs record.").message);
    }
  }, [s.id, s.enquiry_ref]);

  useEffect(() => {
    void load();
    void listPartners()
      .then((ps) => setBrokers(ps.filter((p) => p.role === "cha_customs")))
      .catch(() => setBrokers([]));
  }, [load]);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await load();
      // The workflow bar and the stage read the step the dates may have ticked.
      await reload();
    } catch (e) {
      setError(failureText(e, "That did not work.").message);
    } finally {
      setBusy(null);
    }
  }

  const expected = sidesFor(s.trade_direction);
  const missing = (["export", "import"] as CustomsSide[]).filter((side) => !rows?.some((r) => r.side === side));

  if (!rows) {
    return (
      <p className="flex items-center gap-2 py-8 text-[13px] text-text-muted">
        <Loader2 size={14} className="animate-spin" /> Loading customs…
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" /> {error}
        </p>
      )}

      {!rows.length && (
        <section className="card p-5">
          <h2 className="mb-1 flex items-center gap-1.5 text-[13px] font-medium text-text-primary">
            <Landmark size={14} /> Customs clearance
          </h2>
          <p className="max-w-prose text-[12px] text-text-secondary">
            {s.trade_direction === "export"
              ? "An export from India: the shipping bill, examination and Let Export Order before the cargo is loaded."
              : s.trade_direction === "import"
                ? "An import into India: the IGM, bill of entry, duty and out of charge before the cargo is released."
                : s.trade_direction === "cross_trade"
                  ? "A cross trade does not pass Indian customs; start a record only if we clear it somewhere for the customer."
                  : "Set the trade direction on Shipment details, or start the clearance this job needs."}
          </p>
        </section>
      )}

      {rows.map((r) => (
        <CustomsCard key={r.id} r={r} brokers={brokers} busy={busy} run={run} />
      ))}

      {missing.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {missing.map((side) => (
            <button
              key={side}
              type="button"
              disabled={busy !== null}
              onClick={() => void run(`start-${side}`, () => startCustoms(s.id, side))}
              className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium disabled:opacity-60 ${
                expected.includes(side) ? "bg-brand text-white hover:bg-brand-dark" : "border border-border bg-surface-1 text-text-secondary hover:text-text-primary"
              }`}
            >
              {busy === `start-${side}` ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              Start the {side} clearance
            </button>
          ))}
        </div>
      )}

      <CustomsDocuments files={files} enquiryRef={s.enquiry_ref} onFiled={load} />
    </div>
  );
}

function CustomsCard({
  r,
  brokers,
  busy,
  run,
}: {
  r: CustomsRecord;
  brokers: Partner[];
  busy: string | null;
  run: (key: string, fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [numberError, setNumberError] = useState<string | null>(null);
  const status = customsStatus(r);
  const steps = customsSteps(r);
  const save = (patch: Partial<CustomsRecord>) => void run(`save-${r.id}`, () => updateCustoms(r.id, patch));
  const exp = r.side === "export";
  const empty = !(r.sb_number || r.leo_date || r.be_number || r.ooc_date || r.igm_number || r.checklist_approved_on);

  const number = (key: "sb_number" | "be_number", what: string) => (v: string) => {
    const { value, error } = readIcegateNumber(v, what);
    setNumberError(error);
    if (!error) save({ [key]: value } as Partial<CustomsRecord>);
  };

  return (
    <section className="card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[14px] font-semibold text-text-primary">
          <Landmark size={15} className="text-text-muted" />
          {exp ? "Export clearance" : "Import clearance"}
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE[status]}`}>{STATUS_LABEL[status]}</span>
          {busy === `save-${r.id}` && <Loader2 size={13} className="animate-spin text-text-muted" />}
        </h2>
        {empty && (
          <button
            type="button"
            onClick={() => window.confirm(`Remove the ${r.side} clearance from this job?`) && void run(`remove-${r.id}`, () => removeCustoms(r.id))}
            className="inline-flex items-center gap-1 text-[11.5px] text-text-muted hover:text-text-danger"
          >
            <Trash2 size={12} /> Remove
          </button>
        )}
      </div>

      {/* where it stands */}
      <ol className="mb-4 grid grid-cols-4" aria-label="Progress">
        {steps.map((st, i) => (
          <li key={st.label} className="relative flex min-w-0 flex-col items-center text-center">
            {/* The line from the previous step, behind this step's dot. */}
            {i > 0 && <span aria-hidden className={`absolute right-1/2 top-[11px] h-0.5 w-full ${st.done ? "bg-brand" : "bg-border"}`} />}
            <span
              className={`relative grid h-6 w-6 place-items-center rounded-full border-2 text-[11px] ${st.done ? "border-brand bg-brand text-white" : "border-border bg-surface-1 text-text-muted"}`}
            >
              {st.done ? <Check size={12} strokeWidth={3} /> : i + 1}
            </span>
            <span className={`mt-1 px-0.5 text-[11px] leading-tight ${st.done ? "font-medium text-text-primary" : "text-text-muted"}`}>{st.label}</span>
          </li>
        ))}
      </ol>

      {r.hold_reason?.trim() && (
        <p className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2 text-[12px] text-text-danger">
          <PauseCircle size={13} className="mt-px shrink-0" /> On hold: {r.hold_reason}
          <button type="button" onClick={() => save({ hold_reason: null })} className="ml-auto shrink-0 underline">
            Clear the hold
          </button>
        </p>
      )}

      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Cleared by" hint="CHA: our customs broker. Customer: their own broker. Agent: the overseas agent." className="sm:col-span-2">
          <Segmented
            options={[
              { value: "us", label: "Us" },
              { value: "broker", label: "CHA" },
              { value: "customer", label: "Customer" },
              { value: "agent", label: "Agent" },
            ]}
            value={r.handled_by}
            onChange={(v) => save({ handled_by: v })}
          />
        </Field>
        {r.handled_by === "broker" && (
          <Field label="Customs broker (CHA)">
            {brokers.length ? (
              <Select
                label="Customs broker"
                value={r.broker_partner_id ?? ""}
                options={[{ value: "", label: "Choose…" }, ...brokers.map((b) => ({ value: b.id, label: b.organisation || b.name, hint: b.name }))]}
                onChange={(v) => save({ broker_partner_id: v || null })}
              />
            ) : (
              <TextSave value={r.broker_name ?? ""} onSave={(v) => save({ broker_name: v || null })} placeholder="Broker's name" />
            )}
          </Field>
        )}
        <Field label="Customs station" hint={exp ? "INMAA4 air, INMAA1 sea" : undefined}>
          <TextSave
            value={r.port_code ?? ""}
            onSave={(v) => {
              const { value, error } = readPortCode(v);
              setNumberError(error);
              if (!error) save({ port_code: value });
            }}
            placeholder="INMAA4"
          />
        </Field>

        {exp ? (
          <>
            <Field label="Checklist approved on">
              <TextSave type="date" value={r.checklist_approved_on ?? ""} onSave={(v) => save({ checklist_approved_on: v || null })} />
            </Field>
            <Field label="Shipping bill no.">
              <TextSave value={r.sb_number ?? ""} onSave={number("sb_number", "shipping bill")} placeholder="7 digits" />
            </Field>
            <Field label="Shipping bill date">
              <TextSave type="date" value={r.sb_date ?? ""} onSave={(v) => save({ sb_date: v || null })} />
            </Field>
            <Field label="Examination">
              <Segmented
                options={[
                  { value: "not_required", label: "Not needed" },
                  { value: "required", label: "Ordered" },
                  { value: "done", label: "Done" },
                ]}
                value={r.examination}
                onChange={(v) => save({ examination: v })}
              />
            </Field>
            {r.examination && r.examination !== "not_required" && (
              <Field label="Examined on">
                <TextSave type="date" value={r.examination_on ?? ""} onSave={(v) => save({ examination_on: v || null })} />
              </Field>
            )}
            <Field label="LEO date" hint="Ticks the workflow step">
              <TextSave type="date" value={r.leo_date ?? ""} onSave={(v) => save({ leo_date: v || null })} />
            </Field>
            <Field label="EGM no.">
              <TextSave value={r.egm_number ?? ""} onSave={(v) => save({ egm_number: v || null })} />
            </Field>
            <Field label="EGM date">
              <TextSave type="date" value={r.egm_date ?? ""} onSave={(v) => save({ egm_date: v || null })} />
            </Field>
          </>
        ) : (
          <>
            <Field label="IGM no.">
              <TextSave value={r.igm_number ?? ""} onSave={(v) => save({ igm_number: v || null })} />
            </Field>
            <Field label="IGM date">
              <TextSave type="date" value={r.igm_date ?? ""} onSave={(v) => save({ igm_date: v || null })} />
            </Field>
            <Field label="IGM line / item">
              <TextSave value={r.igm_item ?? ""} onSave={(v) => save({ igm_item: v || null })} />
            </Field>
            <Field label="Bill of entry no.">
              <TextSave value={r.be_number ?? ""} onSave={number("be_number", "bill of entry")} placeholder="7 digits" />
            </Field>
            <Field label="Bill of entry date">
              <TextSave type="date" value={r.be_date ?? ""} onSave={(v) => save({ be_date: v || null })} />
            </Field>
            <Field label="Type of entry">
              <Segmented
                options={[
                  { value: "home", label: "Home use" },
                  { value: "warehouse", label: "Warehouse" },
                  { value: "ex_bond", label: "Ex-bond" },
                ]}
                value={r.be_type}
                onChange={(v) => save({ be_type: v })}
              />
            </Field>
            <Field label="Duty (₹)">
              <TextSave
                value={r.duty_inr === null ? "" : String(r.duty_inr)}
                onSave={(v) => {
                  const n = v.trim() ? Number(v.replace(/,/g, "")) : null;
                  if (n !== null && (!Number.isFinite(n) || n < 0)) return setNumberError("Duty is an amount in rupees.");
                  setNumberError(null);
                  save({ duty_inr: n });
                }}
                placeholder="0.00"
              />
            </Field>
            <Field label="Duty paid on">
              <TextSave type="date" value={r.duty_paid_on ?? ""} onSave={(v) => save({ duty_paid_on: v || null })} />
            </Field>
            <Field label="Out of charge" hint="Ticks the workflow step">
              <TextSave type="date" value={r.ooc_date ?? ""} onSave={(v) => save({ ooc_date: v || null })} />
            </Field>
          </>
        )}
      </div>

      {numberError && <p className="mt-2 text-[12px] text-text-danger">{numberError}</p>}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Hold" hint="A query, a hold or a document customs are waiting for. Clear it when it is resolved.">
          <TextSave value={r.hold_reason ?? ""} onSave={(v) => save({ hold_reason: v || null })} placeholder="Nothing held" />
        </Field>
        <Field label="Remarks">
          <TextSave value={r.remarks} onSave={(v) => save({ remarks: v })} placeholder="For the desk" />
        </Field>
      </div>
    </section>
  );
}

function CustomsDocuments({ files, enquiryRef, onFiled }: { files: EnquiryFile[]; enquiryRef: string; onFiled: () => Promise<void> }) {
  const [type, setType] = useState(DOC_TYPES[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sorted = useMemo(() => [...files].sort((a, b) => (a.filed_at < b.filed_at ? 1 : -1)), [files]);

  async function attach(file: File) {
    setBusy(true);
    setError(null);
    try {
      await uploadFile({ enquiryRef, file, documentType: type });
      await onFiled();
    } catch (e) {
      setError(failureText(e, "Could not attach it.").message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-5">
      <h2 className="mb-3 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
        <FileText size={12} /> Customs documents
      </h2>
      {sorted.length ? (
        <ul className="mb-3 divide-y divide-border rounded-lg border border-border">
          {sorted.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-3 px-3 py-2 text-[12.5px]">
              <button
                type="button"
                onClick={() => void fileUrl(f.path).then((u) => window.open(u, "_blank", "noopener,noreferrer"))}
                className="min-w-0 truncate text-left text-text-accent hover:underline"
              >
                {f.name}
              </button>
              <span className="shrink-0 text-[11.5px] text-text-muted">
                {f.document_type} · {new Date(f.filed_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-3 text-[12px] text-text-muted">No customs documents on this job yet.</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Select label="Document type" value={type} options={DOC_TYPES.map((t) => ({ value: t, label: t }))} onChange={setType} className="w-52" />
        <label className={`inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12.5px] text-text-secondary hover:text-text-primary ${busy ? "pointer-events-none opacity-60" : ""}`}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
          Attach a file
          <input
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void attach(f);
            }}
          />
        </label>
      </div>
      {error && <p className="mt-2 text-[12px] text-text-danger">{error}</p>}
    </section>
  );
}
