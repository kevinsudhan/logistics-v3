import { useCallback, useEffect, useState } from "react";
import { AlertCircle, AlertTriangle, Check, ClipboardCheck, Loader2, Plus, Trash2, Warehouse } from "lucide-react";
import Collapsible from "../../components/Collapsible";
import { useShipment } from "../ShipmentDetail";
import { failureText } from "../../lib/errorText";
import { fmt } from "../../lib/dimensions";
import { chargeableChange, compare, receivedTotals, type Difference } from "../../lib/warehouse";
import { logEvent } from "../../services/enquiries";
import {
  addReceipt,
  CONDITION_LABEL,
  receiptsFor,
  removeReceipt,
  type Condition,
  type Receipt,
} from "../../services/warehouse";

/**
 * What arrived at the warehouse or CFS, against what was booked.
 *
 * ---------------------------------------------------------------------------
 * The quotation was priced on what the shipper said. This is what was
 * counted, weighed and measured when it turned up — one receipt per delivery
 * in — and the difference, if there is one, said where the desk and accounts
 * will both see it: short pieces are a claim, a heavier or bigger consignment
 * is a chargeable weight the invoice has to follow.
 *
 * The first receipt ticks the cargo-received step on the workflow (068).
 * ---------------------------------------------------------------------------
 */
export default function ShipmentWarehouse() {
  const { shipment: s, enquiry, reload } = useShipment();
  const [rows, setRows] = useState<Receipt[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noted, setNoted] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await receiptsFor(s.id));
    } catch (e) {
      setError(failureText(e, "Could not load the receipts.").message);
    }
  }, [s.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(key: string, fn: () => Promise<unknown>, andShell = false) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await load();
      // The first or last receipt moves the workflow step and the stage.
      if (andShell) await reload();
    } catch (e) {
      setError(failureText(e, "That did not save.").message);
    } finally {
      setBusy(null);
    }
  }

  const mode = s.transport_mode ?? enquiry?.transport_mode ?? null;
  const booked = {
    pieces: s.piece_count,
    grossKg: s.gross_weight_kg === null ? null : Number(s.gross_weight_kg),
    volumeCbm: s.volume_cbm === null ? null : Number(s.volume_cbm),
  };
  const received = receivedTotals(rows);
  const diff = {
    pieces: compare(booked.pieces, received.pieces, "pieces"),
    weight: compare(booked.grossKg, received.grossKg, "weight"),
    volume: compare(booked.volumeCbm, received.volumeCbm, "volume"),
  };
  const charge = chargeableChange(booked, received, mode);
  const flagged =
    rows.length > 0 &&
    ([diff.pieces, diff.weight, diff.volume].some((d) => d.verdict === "short" || d.verdict === "over") ||
      charge.changed ||
      rows.some((r) => r.condition !== "good"));

  async function noteIt() {
    const parts = [
      diff.pieces.verdict !== "match" && diff.pieces.delta !== null
        ? `${diff.pieces.delta > 0 ? "+" : ""}${diff.pieces.delta} pcs`
        : null,
      diff.weight.verdict !== "match" && diff.weight.delta !== null
        ? `${diff.weight.delta > 0 ? "+" : ""}${fmt(diff.weight.delta)} kg`
        : null,
      diff.volume.verdict !== "match" && diff.volume.delta !== null
        ? `${diff.volume.delta > 0 ? "+" : ""}${fmt(diff.volume.delta, 3)} CBM`
        : null,
      charge.changed && charge.booked && charge.received
        ? `chargeable ${fmt(charge.booked.value)} → ${fmt(charge.received.value)} ${charge.received.unit}`
        : null,
      rows.some((r) => r.condition !== "good")
        ? `condition: ${[...new Set(rows.filter((r) => r.condition !== "good").map((r) => CONDITION_LABEL[r.condition].toLowerCase()))].join(", ")}`
        : null,
    ].filter(Boolean);
    await run("note", () =>
      logEvent(s.enquiry_ref, "warehouse_discrepancy", `Received differs from booked: ${parts.join("; ")}`, {
        shipment_id: s.id,
        booked,
        received,
      })
    );
    setNoted(true);
  }

  return (
    <div>
      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      {/* ---- booked against received ---- */}
      <section className="card p-5">
        <h2 className="mb-3 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
          <ClipboardCheck size={12} /> Booked against received
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[380px] text-[12.5px]">
            <thead>
              <tr className="text-left text-[11px] text-text-secondary">
                <th className="pb-2 font-medium" />
                <th className="pb-2 text-right font-medium">Booked</th>
                <th className="pb-2 text-right font-medium">Received</th>
                <th className="pb-2 text-right font-medium">Difference</th>
              </tr>
            </thead>
            <tbody>
              <Compare label="Pieces" booked={booked.pieces} received={received.pieces} d={diff.pieces} dp={0} />
              <Compare label="Gross weight" unit="kg" booked={booked.grossKg} received={received.grossKg} d={diff.weight} />
              <Compare label="Volume" unit="CBM" booked={booked.volumeCbm} received={received.volumeCbm} d={diff.volume} dp={3} />
              {(charge.booked || charge.received) && (
                <tr className="border-t border-border font-medium">
                  <td className="py-2 text-text-primary">Chargeable weight</td>
                  <td className="py-2 text-right tabular-nums">
                    {charge.booked ? `${fmt(charge.booked.value)} ${charge.booked.unit}` : "—"}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {charge.received ? `${fmt(charge.received.value)} ${charge.received.unit}` : "—"}
                  </td>
                  <td className={`py-2 text-right tabular-nums ${charge.changed ? "text-text-warning" : "text-text-muted"}`}>
                    {charge.changed && charge.booked && charge.received
                      ? `${charge.received.value > charge.booked.value ? "+" : ""}${fmt(charge.received.value - charge.booked.value)} ${charge.received.unit}`
                      : charge.received
                        ? "Same"
                        : ""}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {!rows.length ? (
          <p className="mt-3 text-[12px] text-text-muted">
            Nothing received yet. Record each delivery into the warehouse below as it arrives.
          </p>
        ) : flagged ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-bg-warning px-3 py-2.5 text-[12px] text-text-warning">
            <span className="flex items-start gap-2">
              <AlertTriangle size={13} className="mt-px shrink-0" />
              What arrived differs from what was booked
              {charge.changed ? " — the invoice should follow the received chargeable weight" : ""}.
            </span>
            <button
              type="button"
              disabled={busy !== null || noted}
              onClick={() => void noteIt()}
              className="flex h-7 items-center gap-1.5 rounded-lg border border-current px-2.5 text-[11.5px] disabled:opacity-60"
            >
              {noted ? <Check size={12} /> : busy === "note" ? <Loader2 size={12} className="animate-spin" /> : null}
              {noted ? "On the timeline" : "Note it on the timeline"}
            </button>
          </div>
        ) : (
          <p className="mt-3 flex items-center gap-1.5 text-[12px] text-text-success">
            <Check size={13} /> Received as booked.
          </p>
        )}
      </section>

      {/* ---- the receipts ---- */}
      <Collapsible
        id="shipment:receipts"
        title="Warehouse receipts"
        icon={<Warehouse size={12} className="shrink-0 text-text-muted" />}
        badge={rows.length ? `${rows.length}` : undefined}
      >
        {rows.length > 0 && (
          <div className="mb-4 overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-[12.5px]">
              <thead>
                <tr className="bg-surface-2 text-left text-[11px] font-medium text-text-secondary">
                  {["Receipt", "Received", "Location", "Pieces", "Gross kg", "CBM", "Condition", "Bay", "Remarks", ""].map((h) => (
                    <th key={h} className="px-2 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-2 py-2 font-mono text-[12px]">{r.receipt_no}</td>
                    <td className="px-2 py-2 tabular-nums">
                      {new Date(r.received_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="px-2 py-2">{r.location ?? "—"}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{r.pieces ?? "—"}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{r.gross_weight_kg === null ? "—" : fmt(r.gross_weight_kg)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{r.volume_cbm === null ? "—" : fmt(r.volume_cbm, 3)}</td>
                    <td className={`px-2 py-2 ${r.condition === "good" ? "text-text-success" : "text-text-danger"}`}>
                      {CONDITION_LABEL[r.condition]}
                    </td>
                    <td className="px-2 py-2">{r.bay ?? ""}</td>
                    <td className="max-w-[200px] truncate px-2 py-2 text-text-secondary" title={r.remarks ?? ""}>
                      {r.remarks ?? ""}
                    </td>
                    <td className="px-1 py-1 text-right">
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => {
                          if (window.confirm(`Remove ${r.receipt_no}?`)) void run(`rm:${r.id}`, () => removeReceipt(r.id), true);
                        }}
                        className="rounded p-1 text-text-muted hover:text-text-danger disabled:opacity-60"
                        aria-label={`Remove ${r.receipt_no}`}
                      >
                        {busy === `rm:${r.id}` ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <NewReceipt
          defaultLocation={s.cfs_location ?? ""}
          busy={busy === "add"}
          onAdd={(r) => run("add", () => addReceipt(s.id, r), true)}
        />
      </Collapsible>
    </div>
  );
}

function Compare({
  label,
  unit,
  booked,
  received,
  d,
  dp = 2,
}: {
  label: string;
  unit?: string;
  booked: number | null;
  received: number | null;
  d: Difference;
  dp?: number;
}) {
  const show = (v: number | null) => (v === null ? "—" : `${fmt(v, dp)}${unit ? ` ${unit}` : ""}`);
  const tone =
    d.verdict === "short" ? "text-text-danger" : d.verdict === "over" ? "text-text-warning" : d.verdict === "match" ? "text-text-success" : "text-text-muted";
  return (
    <tr className="border-t border-border">
      <td className="py-2 text-text-secondary">{label}</td>
      <td className="py-2 text-right tabular-nums">{show(booked)}</td>
      <td className="py-2 text-right tabular-nums">{show(received)}</td>
      <td className={`py-2 text-right tabular-nums ${tone}`}>
        {d.verdict === "unknown"
          ? ""
          : d.verdict === "match"
            ? "As booked"
            : `${d.delta! > 0 ? "+" : ""}${fmt(d.delta, dp)}${unit ? ` ${unit}` : ""} ${d.verdict}`}
      </td>
    </tr>
  );
}

/** One delivery into the warehouse, as it is counted in. */
function NewReceipt({
  defaultLocation,
  busy,
  onAdd,
}: {
  defaultLocation: string;
  busy: boolean;
  onAdd: (r: {
    received_at: string;
    location: string | null;
    pieces: number | null;
    gross_weight_kg: number | null;
    volume_cbm: number | null;
    condition: Condition;
    bay: string | null;
    remarks: string | null;
  }) => Promise<void>;
}) {
  const blank = () => ({
    at: nowLocal(),
    location: defaultLocation,
    pieces: "",
    gross: "",
    volume: "",
    condition: "good" as Condition,
    bay: "",
    remarks: "",
  });
  const [f, setF] = useState(blank);
  useEffect(() => setF((x) => ({ ...x, location: x.location || defaultLocation })), [defaultLocation]);
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  const bad = [f.pieces, f.gross, f.volume].some((v) => v.trim() !== "" && (!Number.isFinite(Number(v)) || Number(v) < 0));
  const empty = [f.pieces, f.gross, f.volume].every((v) => v.trim() === "");

  return (
    <div className="rounded-lg border border-dashed border-border-strong p-3">
      <p className="mb-2 text-[11.5px] font-medium text-text-secondary">Record a delivery into the warehouse</p>
      <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-4">
        <label className="block">
          <span className="mb-0.5 block text-[11px] text-text-secondary">Received</span>
          <input type="datetime-local" value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} className="h-8 w-full" />
        </label>
        <label className="block md:col-span-2">
          <span className="mb-0.5 block text-[11px] text-text-secondary">Warehouse / CFS</span>
          <input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} className="h-8 w-full" placeholder="Where it was received" />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[11px] text-text-secondary">Condition</span>
          <select value={f.condition} onChange={(e) => setF({ ...f, condition: e.target.value as Condition })} className="h-8 w-full">
            {(Object.keys(CONDITION_LABEL) as Condition[]).map((c) => (
              <option key={c} value={c}>
                {CONDITION_LABEL[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[11px] text-text-secondary">Pieces</span>
          <input type="number" min={0} value={f.pieces} onChange={(e) => setF({ ...f, pieces: e.target.value })} className="h-8 w-full text-right" />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[11px] text-text-secondary">Gross weight (kg)</span>
          <input type="number" min={0} step="any" value={f.gross} onChange={(e) => setF({ ...f, gross: e.target.value })} className="h-8 w-full text-right" />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[11px] text-text-secondary">Volume (CBM)</span>
          <input type="number" min={0} step="any" value={f.volume} onChange={(e) => setF({ ...f, volume: e.target.value })} className="h-8 w-full text-right" />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[11px] text-text-secondary">Bay</span>
          <input value={f.bay} onChange={(e) => setF({ ...f, bay: e.target.value })} className="h-8 w-full" placeholder="Where it is stored" />
        </label>
        <label className="block sm:col-span-2 md:col-span-3">
          <span className="mb-0.5 block text-[11px] text-text-secondary">Remarks</span>
          <input value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} className="h-8 w-full" placeholder="Damage, markings, who delivered it" />
        </label>
        <div className="flex items-end">
          <button
            type="button"
            disabled={busy || bad || empty || !f.at}
            title={empty ? "Record at least the pieces, weight or volume" : bad ? "Figures must be positive numbers" : undefined}
            onClick={() =>
              void onAdd({
                received_at: new Date(f.at).toISOString(),
                location: f.location.trim() || null,
                pieces: num(f.pieces) === null ? null : Math.round(num(f.pieces)!),
                gross_weight_kg: num(f.gross),
                volume_cbm: num(f.volume),
                condition: f.condition,
                bay: f.bay.trim() || null,
                remarks: f.remarks.trim() || null,
              }).then(() => setF(blank()))
            }
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-medium text-white hover:bg-brand-dark disabled:opacity-50"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            Add receipt
          </button>
        </div>
      </div>
    </div>
  );
}

function nowLocal(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}
