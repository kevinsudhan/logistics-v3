import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, Check, FileText, Layers, Loader2, Mail, Save } from "lucide-react";
import Collapsible from "../../components/Collapsible";
import CsnFiling from "../../components/CsnFiling";
import { Field } from "../../components/formControls";
import { useShipment } from "../ShipmentDetail";
import { useAuth } from "../../lib/auth";
import { failureText } from "../../lib/errorText";
import { formatDate } from "../../lib/dates";
import type { CustomsRecord } from "../../lib/customs";
import { useLiveVersion } from "../../lib/liveVersions";
import { getConsole, type Console } from "../../services/consoles";
import { customsFor } from "../../services/customs";
import { igmFromJobMail, type IgmFromMail } from "../../services/igmMail";
import { saveManifest } from "../../services/receivedHbl";

/**
 * The IGM page: the job's line in the import manifest, and the CSN that
 * files it with ICEGATE (143).
 *
 * ---------------------------------------------------------------------------
 * WHAT IS ON IT
 *
 * Every particular of a consol agent's Annexure III (Part II, the cargo
 * declaration): the IGM and its line, the vessel (its IMO number, call sign,
 * voyage call number), the line and its agent, the master B/L, and the
 * house line — its B/L, ports, importer and notify party, cargo movement
 * and destination code, packages, weights, marks, goods, UNO and IMO codes,
 * the transhipper's code and bond, the mode of transport inland, the MLO
 * code. ICEGATE's JSON is made from it and downloaded here, for the desk to
 * sign and upload (lib/icegateCsn, CBIC's SACHM22 guide and schema).
 *
 * WHERE IT COMES FROM
 *
 * Filled from what the job holds — the house B/L as read in from the agent's
 * PDF, the job's parties, cargo and boxes, its console — and from the
 * person's mail: the line's IGM advice and the like name the job's B/L
 * numbers, and the IGM number, line and sub-line, the VCN, the vessel's IMO
 * number and call sign are read out of them into what is still empty. Each
 * such value says which mail it came from; nothing typed is overwritten.
 *
 * ON A CONSOLE
 *
 * A job on an import console is one house of the console's CSN: the form is
 * the console's, shared with every house on it, and the file covers them all.
 * A job on no console files its own: its master B/L, and itself under it.
 * ---------------------------------------------------------------------------
 */
export default function ShipmentIgm() {
  const { shipment: s, reload } = useShipment();
  const { session } = useAuth();
  const exp = s.trade_direction === "export";
  const [record, setRecord] = useState<CustomsRecord | null>(null);
  const [consoleRow, setConsoleRow] = useState<Console | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mail, setMail] = useState<IgmFromMail | null>(null);
  const [mailState, setMailState] = useState<"idle" | "reading" | "done" | "failed">("idle");

  const live = useLiveVersion("shipment_customs");
  const load = useCallback(async () => {
    try {
      const [rows, c] = await Promise.all([customsFor(s.id), s.console_id ? getConsole(s.console_id) : Promise.resolve(null)]);
      setRecord(rows.find((r) => r.side === (exp ? "export" : "import")) ?? null);
      setConsoleRow(c);
      setLoaded(true);
    } catch (e) {
      setError(failureText(e, "Could not read the job's customs record.").message);
    }
  }, [s.id, s.console_id, exp]);
  useEffect(() => {
    void load();
  }, [load, live]);

  // The job's mail, read once a visit: the line's IGM advice names its B/L numbers.
  const house = s.bl_type === "forwarder" && s.forwarders_bl_no ? s.forwarders_bl_no : s.bl_number;
  useEffect(() => {
    if (!session?.email || exp) return;
    let current = true;
    setMailState("reading");
    igmFromJobMail(session.email, [house, s.mainline_no, s.enquiry_ref])
      .then((found) => {
        if (!current) return;
        setMail(found);
        setMailState("done");
      })
      .catch(() => current && setMailState("failed"));
    return () => {
      current = false;
    };
  }, [session?.email, house, s.mainline_no, s.enquiry_ref, exp]);

  const fill = useMemo(
    () => ({ vcn: mail?.vcn?.value, vesselImo: mail?.imo?.value, callSign: mail?.callSign?.value }),
    [mail?.vcn?.value, mail?.imo?.value, mail?.callSign?.value],
  );
  const subject = consoleRow ? ({ kind: "console", console: consoleRow } as const) : ({ kind: "shipment", shipment: s } as const);
  const csn = consoleRow ? { no: consoleRow.csn_no ?? null, date: consoleRow.csn_date ?? null } : { no: record?.csn_no ?? null, date: record?.csn_filed_on ?? null };

  return (
    <div>
      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      {!exp && <Particulars shipmentId={s.id} record={record} mail={mail} mailState={mailState} loaded={loaded} onSaved={load} />}

      <Collapsible
        id="shipment:igm-csn"
        title={exp ? "CSN on exit (EGM) for ICEGATE" : "Cargo declaration for ICEGATE (CSN)"}
        icon={<FileText size={12} className="shrink-0 text-text-muted" />}
        hint="Every particular of the IGM's Annexure III, and the JSON ICEGATE takes."
      >
        {consoleRow && (
          <p className="mb-3 flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-[12px] text-text-secondary">
            <Layers size={13} className="mt-px shrink-0" />
            <span>
              This job is a house on console <strong className="font-medium text-text-primary">{consoleRow.console_no ?? "—"}</strong>: the CSN is filed for the
              console's master B/L with every house on it, so this form is the console's, and the file covers them all.{" "}
              <Link to="/consoles" className="text-text-accent hover:underline">
                Open the console
              </Link>
            </span>
          </p>
        )}
        {loaded ? (
          <CsnFiling
            key={consoleRow ? `c:${consoleRow.id}` : `s:${s.id}`}
            subject={subject}
            csn={csn}
            startOpen
            focusHouse={s.id}
            lineNoFrom={consoleRow || exp ? undefined : record?.igm_item?.trim() ?? ""}
            fill={fill}
            onChanged={() => {
              void load();
              void reload();
            }}
          />
        ) : (
          <p className="flex items-center gap-2 text-[12px] text-text-muted">
            <Loader2 size={12} className="animate-spin" /> Reading the job…
          </p>
        )}
      </Collapsible>
    </div>
  );
}

type Key = "igm_number" | "igm_date" | "igm_item" | "igm_subline" | "csn_no" | "csn_filed_on" | "cin_no" | "cfs_code";

/** Each particular of the job's IGM line, and the mail found to say it. */
const FIELDS: Array<{ key: Key; label: string; date?: boolean; mail?: keyof IgmFromMail; placeholder?: string }> = [
  { key: "igm_number", label: "IGM no.", mail: "igmNo", placeholder: "1214225" },
  { key: "igm_date", label: "IGM date", date: true, mail: "igmDate" },
  { key: "igm_item", label: "Line no.", mail: "lineNo", placeholder: "the master B/L's line" },
  { key: "igm_subline", label: "Sub-line no.", mail: "subLineNo", placeholder: "this house's line under it" },
  { key: "cfs_code", label: "CFS / destination code", mail: "cfsCode", placeholder: "INMAA1ECC1" },
  { key: "csn_no", label: "CSN no.", mail: "csnNo" },
  { key: "csn_filed_on", label: "CSN date", date: true },
  { key: "cin_no", label: "PCIN", mail: "pcin" },
];

/**
 * The job's IGM line, kept on its import customs record — the arrival notice
 * and the DO print it from there. What is still empty is filled from the
 * job's mail, marked so, and kept when Save is pressed.
 */
function Particulars({
  shipmentId,
  record,
  mail,
  mailState,
  loaded,
  onSaved,
}: {
  shipmentId: string;
  record: CustomsRecord | null;
  mail: IgmFromMail | null;
  mailState: "idle" | "reading" | "done" | "failed";
  loaded: boolean;
  onSaved: () => Promise<void>;
}) {
  const kept = (k: Key) => String(record?.[k] ?? "").slice(0, FIELDS.find((f) => f.key === k)?.date ? 10 : undefined);
  const [values, setValues] = useState<Record<Key, string>>({} as Record<Key, string>);
  const [fromMail, setFromMail] = useState<Partial<Record<Key, string>>>({});
  /** What the desk has typed in this visit: never replaced by what the record or the mail says. */
  const [touched, setTouched] = useState<Set<Key>>(new Set());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "danger" | "success"; text: string } | null>(null);

  // What the record says, and in what it leaves empty, what the mail says.
  useEffect(() => {
    if (!loaded) return;
    const next = {} as Record<Key, string>;
    const filled: Partial<Record<Key, string>> = {};
    for (const f of FIELDS) {
      if (touched.has(f.key)) {
        next[f.key] = values[f.key] ?? "";
        continue;
      }
      next[f.key] = kept(f.key);
      const found = f.mail ? mail?.[f.mail] : undefined;
      if (!next[f.key] && found) {
        next[f.key] = found.value;
        filled[f.key] = `${found.subject || "(no subject)"}${found.at ? `, ${formatDate(found.at, { day: "numeric", month: "short" })}` : ""}`;
      }
    }
    setValues(next);
    setFromMail(filled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, record, mail]);

  const changed = FIELDS.filter((f) => (values[f.key] ?? "").trim() !== kept(f.key));
  const missing = FIELDS.filter((f) => ["igm_number", "igm_date", "igm_item", "igm_subline"].includes(f.key) && !(values[f.key] ?? "").trim());

  async function save() {
    setBusy(true);
    setNote(null);
    try {
      await saveManifest(shipmentId, Object.fromEntries(changed.map((f) => [f.key, (values[f.key] ?? "").trim().toUpperCase() || null])));
      setFromMail({});
      setTouched(new Set());
      await onSaved();
      setNote({ tone: "success", text: "Saved on the job: the arrival notice and the DO print them." });
    } catch (e) {
      setNote({ tone: "danger", text: failureText(e, "That did not save.").message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Collapsible
      id="shipment:igm-particulars"
      title="IGM particulars"
      icon={<FileText size={12} className="shrink-0 text-text-muted" />}
      hint="The job's line in the import manifest: what the CAN, the DO and the bill of entry quote."
    >
      <div className="mb-3 flex items-start gap-2 text-[12px] text-text-secondary">
        <Mail size={13} className="mt-px shrink-0 text-text-muted" />
        {mailState === "reading" ? (
          <span className="flex items-center gap-1.5">
            <Loader2 size={12} className="animate-spin" /> Reading your mail for the job's B/L numbers…
          </span>
        ) : mailState === "failed" ? (
          <span>Your mail could not be read just now (is Outlook connected?): type the particulars in.</span>
        ) : Object.keys(fromMail).length ? (
          <span>Filled from your mail where the job had nothing yet, marked below. Check them, then Save.</span>
        ) : mailState === "done" ? (
          <span>Nothing more about this job's IGM in your mail. Mails that quote its B/L numbers are read for it.</span>
        ) : (
          <span>Connect Outlook and the line's IGM advice is read for these.</span>
        )}
      </div>
      <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 md:grid-cols-4">
        {FIELDS.map((f) => (
          <Field key={f.key} label={f.label} hint={fromMail[f.key] ? `From your mail: ${fromMail[f.key]}` : undefined}>
            <input
              type={f.date ? "date" : "text"}
              value={values[f.key] ?? ""}
              placeholder={f.placeholder}
              onChange={(e) => {
                const v = e.target.value;
                setValues((x) => ({ ...x, [f.key]: v }));
                setTouched((t) => new Set(t).add(f.key));
                setFromMail(({ [f.key]: _, ...rest }) => rest);
              }}
              className={`h-9 w-full ${fromMail[f.key] ? "border-border-strong bg-bg-warning" : ""}`}
            />
          </Field>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || !changed.length}
          onClick={() => void save()}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-medium text-white hover:bg-brand-dark disabled:opacity-50"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save
        </button>
        {missing.length > 0 && <span className="text-[11.5px] text-text-muted">Still to come: {missing.map((f) => f.label).join(", ").replace(/\.$/, "")}.</span>}
        {note && (
          <span className={`flex items-center gap-1 text-[11.5px] ${note.tone === "success" ? "text-text-success" : "text-text-danger"}`}>
            {note.tone === "success" && <Check size={12} />} {note.text}
          </span>
        )}
      </div>
    </Collapsible>
  );
}
