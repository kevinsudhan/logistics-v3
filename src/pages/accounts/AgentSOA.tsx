import { useCallback, useEffect, useState } from "react";
import { AlertCircle, ChevronDown, Download, Handshake, Loader2, Plus } from "lucide-react";
import PageHeader from "../../components/PageHeader";
import EmptyState from "../../components/EmptyState";
import StatusPill from "../../components/StatusPill";
import Select from "../../components/Select";
import { downloadWorkbook, stamped } from "../../lib/xlsx";
import { money } from "../../services/billing";
import { listPartners, type Partner } from "../../services/partners";
import {
  buildStatement,
  listStatements,
  statementLines,
  updateStatement,
  type AgentStatement,
  type StatementLine,
} from "../../services/reports";
import { PageSkeleton, SectionSkeleton } from "../../components/Loading";

/**
 * Settling a period with an overseas agent.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NETTED AND NOT PAID DOCUMENT BY DOCUMENT
 *
 * Two forwarders handling opposite ends of the same cargo bill each other
 * constantly and in both directions. Paying each note individually across a
 * currency border would be dozens of small wires a month, each with its own
 * fee. A period is agreed, everything outstanding both ways is listed, and one
 * party remits the difference.
 *
 * WHY A DOCUMENT CAN ONLY APPEAR ON ONE STATEMENT
 *
 * Because the point of settling is that settled things stay settled. A debit
 * note on March's statement and again on April's gets paid twice or disputed,
 * and both cost more than the unique index that prevents it. Building the same
 * period twice therefore finds nothing left and says so.
 * ---------------------------------------------------------------------------
 */

const TONE: Record<string, "neutral" | "accent" | "warning" | "success" | "danger"> = {
  draft: "neutral",
  sent: "accent",
  agreed: "warning",
  settled: "success",
  cancelled: "danger",
};

const STATUS_ORDER = ["draft", "sent", "agreed", "settled"] as const;

export default function AgentSOA() {
  const [rows, setRows] = useState<AgentStatement[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [lines, setLines] = useState<Record<string, StatementLine[]>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [form, setForm] = useState({ partner: "", from: "", to: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [s, p] = await Promise.all([listStatements(), listPartners()]);
      setRows(s);
      setPartners(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the statements.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function expand(s: AgentStatement) {
    const next = openId === s.id ? null : s.id;
    setOpenId(next);
    if (next && !lines[next]) {
      try {
        setLines((p) => ({ ...p, [next]: [] }));
        const l = await statementLines(next);
        setLines((p) => ({ ...p, [next]: l }));
      } catch {
        /* the statement's own totals still read */
      }
    }
  }

  async function build() {
    if (!form.partner || !form.from || !form.to) {
      return setError("Choose an agent and the period to settle.");
    }
    setBuilding(true);
    setError(null);
    try {
      const s = await buildStatement(form.partner, form.from, form.to);
      await load();
      setOpenId(s.id);
      setForm({ partner: "", from: "", to: "" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build the statement.");
    } finally {
      setBuilding(false);
    }
  }

  if (loading) return <PageSkeleton />;

  return (
    <div>
      <PageHeader
        title="Overseas agent SOA"
        subtitle="A period netted with an agent: what we billed them, what they billed us, and who remits the difference."
        action={
          <button
            onClick={() =>
              downloadWorkbook(stamped("agent-statements"), [
                {
                  name: "Statements",
                  columns: [
                    { header: "Statement", width: 18 },
                    { header: "Agent", width: 30 },
                    { header: "From", width: 12 },
                    { header: "To", width: 12 },
                    { header: "Status", width: 12 },
                    { header: "Due to us", width: 14 },
                    { header: "Due to them", width: 14 },
                    { header: "Net (INR)", width: 14 },
                    { header: "Remitted", width: 12 },
                  ],
                  rows: rows.map((r) => [
                    r.statement_no,
                    r.partner_label,
                    new Date(r.period_from + "T00:00:00"),
                    new Date(r.period_to + "T00:00:00"),
                    r.status,
                    Number(r.due_to_us),
                    Number(r.due_to_them),
                    Number(r.net_inr),
                    r.remittance_date ? new Date(r.remittance_date + "T00:00:00") : null,
                  ]),
                },
              ])
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

      {/* ---- build one ---- */}
      <div className="card mb-4 grid gap-3 p-4 sm:grid-cols-4">
        <div>
          <span className="mb-0.5 block text-[11px] text-text-secondary">Agent</span>
          <Select
            label="Agent"
            value={form.partner}
            options={[
              { value: "", label: "Choose an agent" },
              ...partners.map((p) => ({
                value: p.id,
                label: p.organisation || p.name,
                hint: p.organisation ? p.name : undefined,
              })),
            ]}
            onChange={(v) => setForm((f) => ({ ...f, partner: v }))}
          />
        </div>
        <label className="block">
          <span className="block text-[11px] text-text-secondary">Period from</span>
          <input
            type="date"
            value={form.from}
            onChange={(e) => setForm((f) => ({ ...f, from: e.target.value }))}
            className="mt-0.5 h-8 w-full rounded-lg border border-border bg-surface-1 px-2.5 text-[13px] text-text-primary focus:border-border-strong focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="block text-[11px] text-text-secondary">Period to</span>
          <input
            type="date"
            value={form.to}
            onChange={(e) => setForm((f) => ({ ...f, to: e.target.value }))}
            className="mt-0.5 h-8 w-full rounded-lg border border-border bg-surface-1 px-2.5 text-[13px] text-text-primary focus:border-border-strong focus:outline-none"
          />
        </label>
        <div className="flex items-end">
          <button
            onClick={() => void build()}
            disabled={building}
            className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-brand text-[12px] font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
          >
            {building ? <Loader2 size={12} className="animate-spin" /> : <Plus size={13} />}
            Build the statement
          </button>
        </div>
        <p className="text-[11px] leading-relaxed text-text-muted sm:col-span-4">
          It gathers every note in both directions dated inside the period that is not already on a
          statement. Running it twice over the same period finds nothing left, which is the point.
        </p>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Handshake}
          title="No statements yet"
          hint="Build one for an agent and a period. Everything outstanding both ways is netted into a single figure for one party to remit."
        />
      ) : (
        <div className="space-y-3">
          {rows.map((s) => {
            const open = openId === s.id;
            const theyOwe = Number(s.net_inr) >= 0;

            return (
              <div key={s.id}>
                <button
                  onClick={() => void expand(s)}
                  aria-expanded={open}
                  className={`card card-interactive flex w-full flex-wrap items-center gap-x-3 gap-y-2 p-3 text-left ${
                    open ? "rounded-b-none border-b-0" : ""
                  }`}
                >
                  <span className="font-mono text-[12px] font-medium text-text-primary">
                    {s.statement_no}
                  </span>
                  <StatusPill tone={TONE[s.status]}>{s.status}</StatusPill>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-text-primary">
                    {s.partner_label ?? "—"}
                  </span>
                  <span className="text-[12px] text-text-muted">
                    {s.period_from} → {s.period_to}
                  </span>
                  <span className="flex items-center gap-2 text-right">
                    <span>
                      <span className="block text-[11px] text-text-secondary">
                        {theyOwe ? "They remit" : "We remit"}
                      </span>
                      <span className="block text-[14px] font-medium tabular-nums text-text-primary">
                        {money(Math.abs(Number(s.net_inr)))}
                      </span>
                    </span>
                    <ChevronDown
                      size={14}
                      className={`text-text-muted transition-transform ${open ? "rotate-180" : ""}`}
                    />
                  </span>
                </button>

                {open && (
                  <div className="card space-y-4 rounded-t-none p-4">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {STATUS_ORDER.map((st) => (
                        <button
                          key={st}
                          onClick={() =>
                            void updateStatement(s.id, {
                              status: st,
                              ...(st === "settled" && !s.remittance_date
                                ? { remittance_date: new Date().toISOString().slice(0, 10) }
                                : {}),
                            }).then(load)
                          }
                          className={`h-7 rounded-full px-2.5 text-[11px] font-medium capitalize transition-colors ${
                            s.status === st
                              ? "bg-brand text-white"
                              : "bg-surface-2 text-text-muted hover:text-text-primary"
                          }`}
                        >
                          {st}
                        </button>
                      ))}
                      {s.remittance_date && (
                        <span className="ml-2 text-[11px] text-text-muted">
                          remitted {s.remittance_date}
                        </span>
                      )}
                    </div>

                    <dl className="flex flex-wrap gap-x-8 gap-y-2 text-[13px]">
                      <div>
                        <dt className="text-[11px] text-text-secondary">We billed them</dt>
                        <dd className="tabular-nums text-text-primary">{money(Number(s.due_to_us))}</dd>
                      </div>
                      <div>
                        <dt className="text-[11px] text-text-secondary">They billed us</dt>
                        <dd className="tabular-nums text-text-primary">
                          {money(Number(s.due_to_them))}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[11px] text-text-secondary">Net</dt>
                        <dd className="font-medium tabular-nums text-text-primary">
                          {money(Math.abs(Number(s.net_inr)))}{" "}
                          <span className="text-[11px] font-normal text-text-muted">
                            {theyOwe ? "to us" : "to them"}
                          </span>
                        </dd>
                      </div>
                    </dl>

                    {(lines[s.id] ?? []).length === 0 ? (
                      <SectionSkeleton lines={2} label="Loading the lines" className="py-1" />
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[32rem] text-[13px]">
                          <thead>
                            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-secondary">
                              <th className="py-1.5 pr-2 font-medium">Document</th>
                              <th className="py-1.5 pr-2 font-medium">Date</th>
                              <th className="py-1.5 pr-2 font-medium">Direction</th>
                              <th className="py-1.5 pr-2 text-right font-medium">Amount</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {(lines[s.id] ?? []).map((l) => (
                              <tr key={l.id}>
                                <td className="py-1.5 pr-2 font-mono text-[12px] text-text-primary">
                                  {l.document ?? "—"}
                                </td>
                                <td className="py-1.5 pr-2 text-text-secondary">
                                  {l.document_date ?? "—"}
                                </td>
                                <td className="py-1.5 pr-2 text-text-secondary">
                                  {l.invoice_id ? "We billed them" : "They billed us"}
                                </td>
                                <td className="py-1.5 pr-2 text-right tabular-nums text-text-primary">
                                  {money(l.amount_inr)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {s.status !== "draft" && (
                      <p className="text-[11px] leading-relaxed text-text-muted">
                        This statement has been put to the agent, so its lines are fixed — changing
                        them underneath is how two desks end up holding different versions of the
                        same document. Anything new goes on the next period.
                      </p>
                    )}
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
