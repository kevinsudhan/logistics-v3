import { useCallback, useEffect, useState } from "react";
import { AlertCircle, ChevronDown, Loader2, Plus, Receipt, Trash2 } from "lucide-react";
import EmptyState from "./EmptyState";
import StatusPill from "./StatusPill";
import Select from "./Select";
import { money } from "../services/billing";
import { listPartners, type Partner } from "../services/partners";
import {
  COST_HEADS,
  KIND_HINT,
  KIND_LABEL,
  STATUS_LABEL,
  addBillLine,
  listBills,
  recordBill,
  removeBillLine,
  updateBill,
  updateBillLine,
  type Bill,
  type BillKind,
} from "../services/bills";
import { SectionSkeleton } from "./Loading";

/**
 * What this job cost — the bills other people sent us.
 *
 * ---------------------------------------------------------------------------
 * THE HALF THE SYSTEM DID NOT HAVE
 *
 * A consolidator's business is the gap between what the shipper pays and what
 * the line and the agent charge. Everything up to now recorded only the first
 * of those, so the system could report revenue and could not say whether any of
 * it was worth doing.
 *
 * REVERSE CHARGE IS A FLAG, NOT A RATE
 *
 * An overseas agent's debit note carries no Indian tax, because they are not
 * registered here. We pay that tax ourselves and reclaim it. So the tax is
 * tracked against the bill and deliberately NOT added to what we hand over —
 * which is why a bill under reverse charge shows a tax figure and a total that
 * does not include it.
 * ---------------------------------------------------------------------------
 */

const TONE: Record<string, "neutral" | "warning" | "success" | "danger" | "accent"> = {
  draft: "neutral",
  received: "warning",
  part_paid: "accent",
  paid: "success",
  disputed: "danger",
  cancelled: "neutral",
};

const KINDS: BillKind[] = [
  "carrier_invoice",
  "agent_debit_note",
  "vendor_invoice",
  "agent_credit_note",
];

function Cell({
  value,
  onCommit,
  locked,
  width,
  align,
  mono,
}: {
  value: string;
  onCommit: (v: string) => void;
  locked?: boolean;
  width?: string;
  align?: "right";
  mono?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  if (locked) return <span className="text-text-primary">{value || "—"}</span>;

  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      className={`h-7 rounded border border-transparent bg-transparent px-1.5 text-[13px] text-text-primary transition-colors hover:border-border focus:border-border-strong focus:bg-surface-1 focus:outline-none ${
        width ?? "w-full"
      } ${align === "right" ? "text-right tabular-nums" : ""} ${mono ? "font-mono" : ""}`}
    />
  );
}

export default function BillsPanel({
  shipmentId,
  consoleId,
  onChanged,
}: {
  shipmentId?: string;
  consoleId?: string;
  onChanged?: () => void;
}) {
  const [rows, setRows] = useState<Bill[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ bill_no: "", partner_id: "", kind: "carrier_invoice" });
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [b, p] = await Promise.all([
        listBills({ shipmentId, consoleId }),
        listPartners(),
      ]);
      setRows(b);
      setPartners(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the costs.");
    } finally {
      setLoading(false);
    }
  }, [shipmentId, consoleId]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not save.");
    }
  };

  async function create() {
    if (!draft.bill_no.trim() || !draft.partner_id) {
      return setError("A bill needs their number and who sent it.");
    }
    setBusy(true);
    setError(null);
    try {
      const b = await recordBill({
        bill_no: draft.bill_no.trim(),
        partner_id: draft.partner_id,
        kind: draft.kind as BillKind,
        shipment_id: shipmentId ?? null,
        console_id: consoleId ?? null,
      });
      await load();
      setOpenId(b.id);
      setAdding(false);
      setDraft({ bill_no: "", partner_id: "", kind: "carrier_invoice" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record it.");
    } finally {
      setBusy(false);
    }
  }

  const total = rows
    .filter((b) => b.status !== "cancelled")
    .reduce((t, b) => t + (b.kind === "agent_credit_note" ? -1 : 1) * Number(b.total_inr || 0), 0);

  if (loading) return <SectionSkeleton />;

  return (
    <div>
      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-text-secondary">
          {rows.length === 0
            ? "Nothing billed to us on this job yet."
            : `${rows.length} bill${rows.length === 1 ? "" : "s"} · ${money(total)} of cost.`}
        </p>
        <button
          onClick={() => setAdding((a) => !a)}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-4 text-[13px] font-medium text-white transition-colors hover:bg-brand-dark"
        >
          <Plus size={14} />
          Record a bill
        </button>
      </div>

      {adding && (
        <div className="card mb-3 grid gap-3 p-4 sm:grid-cols-3">
          <label className="block">
            <span className="block text-[11px] text-text-secondary">Their bill number</span>
            <input
              value={draft.bill_no}
              autoFocus
              placeholder="As printed on their document"
              onChange={(e) => setDraft((d) => ({ ...d, bill_no: e.target.value }))}
              className="mt-0.5 h-8 w-full rounded-lg border border-border bg-surface-1 px-2.5 font-mono text-[13px] text-text-primary placeholder:font-sans placeholder:text-text-muted focus:border-border-strong focus:outline-none"
            />
          </label>
          <div>
            <span className="mb-0.5 block text-[11px] text-text-secondary">Who sent it</span>
            <Select
              label="Vendor"
              value={draft.partner_id}
              options={[
                { value: "", label: "Choose a partner" },
                ...partners.map((p) => ({
                  value: p.id,
                  label: p.organisation || p.name,
                  hint: p.organisation ? p.name : undefined,
                })),
              ]}
              onChange={(v) => setDraft((d) => ({ ...d, partner_id: v }))}
            />
          </div>
          <div>
            <span className="mb-0.5 block text-[11px] text-text-secondary">What kind</span>
            <Select
              label="Kind"
              value={draft.kind}
              options={KINDS.map((k) => ({ value: k, label: KIND_LABEL[k], hint: KIND_HINT[k] }))}
              onChange={(v) => setDraft((d) => ({ ...d, kind: v }))}
            />
          </div>
          <div className="sm:col-span-3">
            <button
              onClick={() => void create()}
              disabled={busy}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand px-4 text-[12px] font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
            >
              {busy && <Loader2 size={12} className="animate-spin" />}
              Record it
            </button>
            <span className="ml-3 text-[11px] text-text-muted">
              The same number cannot be recorded twice for one vendor — which is how a bill gets
              paid twice.
            </span>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No costs recorded"
          hint="What the carrier and the overseas agent charge is the other half of this job's money. Without it, margin cannot be known."
        />
      ) : (
        <div className="space-y-3">
          {rows.map((b) => {
            const open = openId === b.id;
            return (
              <div key={b.id}>
                <button
                  onClick={() => setOpenId(open ? null : b.id)}
                  aria-expanded={open}
                  className={`card card-interactive flex w-full flex-wrap items-center gap-x-3 gap-y-2 p-3 text-left ${
                    open ? "rounded-b-none border-b-0" : ""
                  }`}
                >
                  <span className="font-mono text-[12px] font-medium text-text-primary">
                    {b.bill_no}
                  </span>
                  <StatusPill tone={TONE[b.status]}>{STATUS_LABEL[b.status]}</StatusPill>
                  <StatusPill tone="neutral">{KIND_LABEL[b.kind]}</StatusPill>
                  {b.reverse_charge && <StatusPill tone="accent">Reverse charge</StatusPill>}

                  <span className="min-w-0 flex-1 truncate text-[13px] text-text-primary">
                    {b.partner_label ?? "—"}
                  </span>
                  <span className="text-[12px] text-text-muted">{b.bill_date}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-[14px] font-medium tabular-nums text-text-primary">
                      {money(b.total_amount, b.currency)}
                    </span>
                    <ChevronDown
                      size={14}
                      className={`text-text-muted transition-transform ${open ? "rotate-180" : ""}`}
                    />
                  </span>
                </button>

                {open && (
                  <div className="card space-y-4 rounded-t-none p-4">
                    {/* ---- the charges they billed ---- */}
                    <div className="flex items-center justify-between">
                      <h3 className="text-[11px] font-medium uppercase tracking-wide text-text-secondary">
                        Charges
                      </h3>
                      <Select
                        label="Add a charge"
                        className="w-56"
                        value=""
                        options={[
                          { value: "", label: "Add a charge…" },
                          ...COST_HEADS.map((h) => ({
                            value: h.label,
                            label: h.label,
                            hint: h.sac,
                          })),
                        ]}
                        onChange={(v) => {
                          const head = COST_HEADS.find((h) => h.label === v);
                          if (!head) return;
                          void run(() =>
                            addBillLine(b.id, {
                              position: (b.lines?.length ?? 0) + 1,
                              description: head.label,
                              sac_code: head.sac,
                              unit: head.unit,
                              quantity: 1,
                              rate: 0,
                              tax_rate: b.reverse_charge ? 18 : 18,
                            })
                          );
                        }}
                      />
                    </div>

                    {(b.lines ?? []).length === 0 ? (
                      <p className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-[12px] text-text-muted">
                        No charges on it yet.
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[34rem] text-[13px]">
                          <thead>
                            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-secondary">
                              <th className="py-1.5 pr-2 font-medium">Charge</th>
                              <th className="py-1.5 pr-2 font-medium">SAC</th>
                              <th className="py-1.5 pr-2 text-right font-medium">Qty</th>
                              <th className="py-1.5 pr-2 text-right font-medium">Rate</th>
                              <th className="py-1.5 pr-2 text-right font-medium">Tax</th>
                              <th className="py-1.5 pr-2 text-right font-medium">Amount</th>
                              <th className="w-8" />
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {(b.lines ?? []).map((l) => (
                              <tr key={l.id}>
                                <td className="py-1.5 pr-2">
                                  <Cell
                                    value={l.description}
                                    onCommit={(v) =>
                                      void run(() => updateBillLine(l.id, { description: v }))
                                    }
                                  />
                                </td>
                                <td className="py-1.5 pr-2">
                                  <Cell
                                    value={l.sac_code ?? ""}
                                    mono
                                    width="w-20"
                                    onCommit={(v) =>
                                      void run(() =>
                                        updateBillLine(l.id, { sac_code: v || null })
                                      )
                                    }
                                  />
                                </td>
                                <td className="py-1.5 pr-2 text-right">
                                  <Cell
                                    value={String(l.quantity)}
                                    align="right"
                                    width="w-16"
                                    onCommit={(v) =>
                                      void run(() =>
                                        updateBillLine(l.id, { quantity: Number(v) || 0 })
                                      )
                                    }
                                  />
                                </td>
                                <td className="py-1.5 pr-2 text-right">
                                  <Cell
                                    value={String(l.rate)}
                                    align="right"
                                    width="w-24"
                                    onCommit={(v) =>
                                      void run(() => updateBillLine(l.id, { rate: Number(v) || 0 }))
                                    }
                                  />
                                </td>
                                <td className="py-1.5 pr-2 text-right">
                                  <Cell
                                    value={String(l.tax_rate)}
                                    align="right"
                                    width="w-14"
                                    onCommit={(v) =>
                                      void run(() =>
                                        updateBillLine(l.id, { tax_rate: Number(v) || 0 })
                                      )
                                    }
                                  />
                                </td>
                                <td className="py-1.5 pr-2 text-right tabular-nums text-text-primary">
                                  {money(l.amount, b.currency)}
                                </td>
                                <td className="py-1.5">
                                  <button
                                    onClick={() => void run(() => removeBillLine(l.id))}
                                    aria-label="Remove this charge"
                                    className="grid size-7 place-items-center rounded-lg text-text-muted transition-colors hover:bg-bg-danger hover:text-text-danger"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* ---- totals and terms ---- */}
                    <div className="grid gap-4 lg:grid-cols-2">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block">
                          <span className="block text-[11px] text-text-secondary">Their date</span>
                          <input
                            type="date"
                            defaultValue={b.bill_date}
                            onBlur={(e) =>
                              e.target.value !== b.bill_date &&
                              void run(() => updateBill(b.id, { bill_date: e.target.value }))
                            }
                            className="mt-0.5 h-8 w-full rounded-lg border border-border bg-surface-1 px-2.5 text-[13px] text-text-primary focus:border-border-strong focus:outline-none"
                          />
                        </label>
                        <label className="block">
                          <span className="block text-[11px] text-text-secondary">Due</span>
                          <input
                            type="date"
                            defaultValue={b.due_date ?? ""}
                            onBlur={(e) =>
                              void run(() =>
                                updateBill(b.id, { due_date: e.target.value || null })
                              )
                            }
                            className="mt-0.5 h-8 w-full rounded-lg border border-border bg-surface-1 px-2.5 text-[13px] text-text-primary focus:border-border-strong focus:outline-none"
                          />
                        </label>
                        <label className="block">
                          <span className="block text-[11px] text-text-secondary">Currency</span>
                          <input
                            defaultValue={b.currency}
                            onBlur={(e) =>
                              void run(() =>
                                updateBill(b.id, {
                                  currency: e.target.value.toUpperCase() || "INR",
                                })
                              )
                            }
                            className="mt-0.5 h-8 w-full rounded-lg border border-border bg-surface-1 px-2.5 font-mono text-[13px] text-text-primary focus:border-border-strong focus:outline-none"
                          />
                        </label>
                        {b.currency !== "INR" && (
                          <label className="block">
                            <span className="block text-[11px] text-text-secondary">
                              INR per 1 {b.currency}
                            </span>
                            <input
                              defaultValue={String(b.exchange_rate)}
                              onBlur={(e) => {
                                const n = Number(e.target.value);
                                if (n > 0)
                                  void run(() => updateBill(b.id, { exchange_rate: n }));
                              }}
                              className="mt-0.5 h-8 w-full rounded-lg border border-border bg-surface-1 px-2.5 text-right text-[13px] tabular-nums text-text-primary focus:border-border-strong focus:outline-none"
                            />
                          </label>
                        )}
                        <label className="flex items-start gap-2 sm:col-span-2">
                          <input
                            type="checkbox"
                            checked={b.reverse_charge}
                            onChange={(e) =>
                              void run(() =>
                                updateBill(b.id, { reverse_charge: e.target.checked })
                              )
                            }
                            className="mt-0.5 size-3.5 accent-[var(--brand)]"
                          />
                          <span className="text-[12px] text-text-secondary">
                            Reverse charge
                            <span className="block text-[11px] text-text-muted">
                              An overseas agent charges no Indian tax. We pay it ourselves and
                              reclaim it, so it is tracked but not added to what we hand over.
                            </span>
                          </span>
                        </label>
                      </div>

                      <dl className="space-y-1 self-start text-[13px]">
                        <div className="flex justify-between">
                          <dt className="text-text-secondary">Charges</dt>
                          <dd className="tabular-nums text-text-primary">
                            {money(b.taxable_value, b.currency)}
                          </dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-text-secondary">
                            Tax{b.reverse_charge ? " (we pay it)" : ""}
                          </dt>
                          <dd
                            className={`tabular-nums ${
                              b.reverse_charge ? "text-text-muted" : "text-text-primary"
                            }`}
                          >
                            {money(b.tax_amount, b.currency)}
                          </dd>
                        </div>
                        <div className="flex justify-between border-t border-border pt-1.5">
                          <dt className="font-medium text-text-primary">We owe them</dt>
                          <dd className="text-[15px] font-medium tabular-nums text-text-primary">
                            {money(b.total_amount, b.currency)}
                          </dd>
                        </div>
                        {b.currency !== "INR" && (
                          <div className="flex justify-between">
                            <dt className="text-[11px] text-text-muted">
                              at {b.exchange_rate} per {b.currency}
                            </dt>
                            <dd className="text-[11px] tabular-nums text-text-muted">
                              {money(b.total_inr)}
                            </dd>
                          </div>
                        )}

                        <div className="pt-2">
                          <button
                            onClick={() =>
                              void run(() =>
                                updateBill(b.id, {
                                  status: b.status === "disputed" ? "received" : "disputed",
                                })
                              )
                            }
                            className={`inline-flex h-8 items-center rounded-lg border px-3 text-[12px] transition-colors ${
                              b.status === "disputed"
                                ? "border-text-danger/25 bg-bg-danger text-text-danger"
                                : "border-border bg-surface-1 text-text-secondary hover:border-border-strong hover:text-text-primary"
                            }`}
                          >
                            {b.status === "disputed" ? "Stop disputing it" : "Dispute this bill"}
                          </button>
                          <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
                            A disputed bill stops counting as overdue. It is still a cost until it
                            is withdrawn.
                          </p>
                        </div>
                      </dl>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
