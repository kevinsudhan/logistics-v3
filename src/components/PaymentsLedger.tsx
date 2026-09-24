import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { AlertCircle, ChevronDown, Download, HandCoins, Loader2, Plus } from "lucide-react";
import PageHeader from "./PageHeader";
import EmptyState from "./EmptyState";
import StatusPill from "./StatusPill";
import Select from "./Select";
import ReceiptEditor from "./ReceiptEditor";
import { receiptSheets } from "../lib/exports";
import { downloadWorkbook, stamped } from "../lib/xlsx";
import { money } from "../services/billing";
import { listCustomers, type Customer } from "../services/enquiries";
import { listPartners, type Partner } from "../services/partners";
import {
  MODE_LABEL,
  STATUS_LABEL,
  allocatedCash,
  customerBalances,
  listPayments,
  onAccount,
  settledTotal,
  startPayment,
  type CustomerBalance,
  type Direction,
  type Payment,
} from "../services/receipts";
import { ListSkeleton } from "./Loading";

/**
 * The ledger for one direction of money.
 *
 * ---------------------------------------------------------------------------
 * ONE COMPONENT, TWO PAGES
 *
 * Receipts and Payments are the same act pointed opposite ways: an amount, a
 * date, a party, an instrument, and a list of what it settles. We even deduct
 * TDS paying a transporter exactly as customers deduct it paying us. Two
 * implementations would drift, and the one that drifted would be whichever
 * nobody was looking at.
 *
 * The direction is the page rather than a toggle inside it, so a link can point
 * at money out and land there.
 * ---------------------------------------------------------------------------
 */

const TONE: Record<string, "neutral" | "success" | "danger"> = {
  draft: "neutral",
  confirmed: "success",
  cancelled: "danger",
};

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card min-w-0 flex-1 p-4">
      <p className="text-[11px] text-text-secondary">{label}</p>
      <p className="mt-0.5 text-[19px] font-medium tabular-nums text-text-primary">{value}</p>
      {hint && <p className="text-[11px] text-text-muted">{hint}</p>}
    </div>
  );
}

export default function PaymentsLedger({ direction }: { direction: Direction }) {
  const [rows, setRows] = useState<Payment[]>([]);
  const [balances, setBalances] = useState<CustomerBalance[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  // Set when an invoice sent us here with a draft it had just opened.
  const arrivedWith = (useLocation().state as { openId?: string } | null)?.openId ?? null;
  const [openId, setOpenId] = useState<string | null>(arrivedWith);
  const [picking, setPicking] = useState(false);
  const [newFor, setNewFor] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [p, b, c, pr] = await Promise.all([
        listPayments({ direction }),
        customerBalances(),
        listCustomers(),
        listPartners(),
      ]);
      setRows(p);
      setBalances(b);
      setCustomers(c);
      setPartners(pr);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the ledger.");
    } finally {
      setLoading(false);
    }
  }, [direction]);

  useEffect(() => {
    void load();
  }, [load]);

  const live = useMemo(() => rows.filter((r) => r.status === "confirmed"), [rows]);

  const totals = useMemo(
    () => ({
      cash: live.reduce((t, p) => t + allocatedCash(p), 0),
      tds: live.reduce((t, p) => t + (settledTotal(p) - allocatedCash(p)), 0),
      spare: live.reduce((t, p) => t + Math.max(onAccount(p), 0), 0),
      owed: balances.reduce((t, b) => t + Number(b.outstanding || 0), 0),
    }),
    [live, balances]
  );

  const owing = useMemo(
    () => balances.filter((b) => Number(b.outstanding) > 0.005 || Number(b.on_account) > 0.005),
    [balances]
  );

  async function open(partyId: string) {
    setBusy(true);
    setPicking(false);
    setError(null);
    try {
      const p = await startPayment({
        direction,
        // The same picker feeds both sides, so which column it lands in is
        // decided here rather than by two near-identical code paths.
        customerId: direction === "in" ? partyId : null,
        partnerId: direction === "out" ? partyId : null,
      });
      await load();
      setOpenId(p.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open it.");
    } finally {
      setBusy(false);
      setNewFor("");
    }
  }

  if (loading) return <ListSkeleton avatar={false} />;

  return (
    <div>
      <PageHeader
        title={direction === "in" ? "Receipts" : "Payments"}
        subtitle={
          direction === "in"
            ? "Money the desk has taken in, and which invoices each receipt settled. Where each customer stands is on Outstanding."
            : "Money the desk has paid out to carriers, agents and vendors, and which bills each payment settled."
        }
        action={
          <button
            onClick={() =>
              downloadWorkbook(
                stamped(direction === "in" ? "receipts" : "payments"),
                receiptSheets(rows, balances, direction)
              )
            }
            disabled={rows.length === 0}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border-strong bg-surface-1 px-3 text-[13px] font-medium text-text-primary transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            <Download size={14} />
            Excel
          </button>
        }
      />

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      <div className="mb-5 flex flex-wrap gap-3">
        <Tile
          label={direction === "in" ? "Received" : "Paid out"}
          value={money(totals.cash)}
          hint={`${live.length} confirmed`}
        />
        <Tile
          label="TDS withheld"
          value={money(totals.tds)}
          hint={totals.tds > 0 ? "settled without reaching the bank" : "none recorded"}
        />
        <Tile
          label="On account"
          value={money(totals.spare)}
          hint={totals.spare > 0 ? "advances not yet applied" : "everything applied"}
        />
        <Tile label="Still owed to us" value={money(totals.owed)} hint="across all customers" />
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
        <div className="relative">
          <button
            onClick={() => setPicking((p) => !p)}
            disabled={busy}
            aria-expanded={picking}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-4 text-[13px] font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={14} />}
            Record {direction === "in" ? "a receipt" : "a payment"}
          </button>

          {picking && (
            <div className="absolute right-0 z-30 mt-1 w-80 rounded-lg border border-border-strong bg-surface-1 p-3 shadow-lg">
              <p className="mb-2 text-[11px] text-text-secondary">
                {direction === "in"
                  ? "Who paid? Their open invoices come with it."
                  : "Who was paid. It cannot be applied to anything until the purchase side exists — for now it records that the money went out."}
              </p>
              {direction === "in" ? (
                <>
                  <Select
                    label="Customer"
                    value={newFor}
                    options={[
                      { value: "", label: "Choose a customer" },
                      ...customers.map((c) => ({
                        value: c.id,
                        label: c.company || c.name,
                        hint: c.id,
                      })),
                    ]}
                    onChange={setNewFor}
                  />
                  <button
                    onClick={() => newFor && void open(newFor)}
                    disabled={!newFor}
                    className="mt-2 inline-flex h-8 w-full items-center justify-center rounded-lg bg-brand text-[12px] font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-50"
                  >
                    Open it
                  </button>
                </>
              ) : (
                <>
                  <Select
                    label="Partner"
                    value={newFor}
                    options={[
                      { value: "", label: "Choose who was paid" },
                      ...partners.map((p) => ({
                        value: p.id,
                        label: p.organisation || p.name,
                        hint: p.organisation ? p.name : undefined,
                      })),
                    ]}
                    onChange={setNewFor}
                  />
                  <button
                    onClick={() => newFor && void open(newFor)}
                    disabled={!newFor}
                    className="mt-2 inline-flex h-8 w-full items-center justify-center rounded-lg bg-brand text-[12px] font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-50"
                  >
                    Open it
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={HandCoins}
          title={direction === "in" ? "Nothing received yet" : "Nothing paid out yet"}
          hint={
            direction === "in"
              ? "Record a receipt against a customer and their open invoices come with it — apply it oldest first, or line by line, and note any TDS they withheld."
              : "Money out is recorded here. Applying it to what a carrier or agent billed us needs the purchase side, which does not exist yet."
          }
        />
      ) : (
        <div className="space-y-3">
          {rows.map((p) => {
            const isOpen = openId === p.id;
            const spare = onAccount(p);
            const tds = settledTotal(p) - allocatedCash(p);

            return (
              <div key={p.id}>
                <button
                  onClick={() => setOpenId(isOpen ? null : p.id)}
                  aria-expanded={isOpen}
                  className={`card card-interactive flex w-full flex-wrap items-center gap-x-3 gap-y-2 p-3 text-left ${
                    isOpen ? "rounded-b-none border-b-0" : ""
                  }`}
                >
                  <span className="font-mono text-[12px] font-medium text-text-primary">
                    {p.number ?? "Draft"}
                  </span>
                  <StatusPill tone={TONE[p.status]}>{STATUS_LABEL[p.status]}</StatusPill>
                  {tds > 0.005 && <StatusPill tone="accent">TDS {money(tds)}</StatusPill>}
                  {spare > 0.005 && p.status === "confirmed" && (
                    <StatusPill tone="warning">{money(spare)} on account</StatusPill>
                  )}

                  <span className="min-w-0 flex-1 truncate text-[13px] text-text-primary">
                    {p.party_label ?? "Unattributed"}
                  </span>

                  <span className="text-[12px] text-text-muted">{MODE_LABEL[p.mode]}</span>
                  <span className="text-[12px] text-text-muted">
                    {new Date(p.payment_date + "T00:00:00").toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-[14px] font-medium tabular-nums text-text-primary">
                      {money(p.amount, p.currency)}
                    </span>
                    <ChevronDown
                      size={14}
                      className={`text-text-muted transition-transform ${isOpen ? "rotate-180" : ""}`}
                    />
                  </span>
                </button>

                {isOpen && <ReceiptEditor paymentId={p.id} onChanged={load} nested />}
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
