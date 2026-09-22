import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Loader2, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import PageHeader from "../components/PageHeader";
import { CHARGE_HEADS, LINE_CURRENCIES, UNITS } from "../services/charges";
import {
  expired,
  laneLabel,
  listRates,
  removeRate,
  saveRate,
  RATE_DIRECTIONS,
  RATE_MODES,
  type RateCard,
} from "../services/rateMaster";

/**
 * What this desk charges, so a quotation is assembled rather than remembered.
 *
 * ---------------------------------------------------------------------------
 * WHY THE LIST IS GROUPED BY CHARGE AND NOT BY LANE
 *
 * Because the thing that goes wrong is one charge having two answers. Grouped
 * by charge, the standing documentation fee sits directly above the Chennai one
 * that overrides it and the Jebel Ali one that overrides that — so the
 * override chain is visible, and a contradiction is obvious on sight.
 *
 * Grouped by lane, the same three rows are on three different screens and the
 * only way to notice they disagree is to already suspect it.
 *
 * WHY "ANY LANE" IS SHOWN AS PLAINLY AS A REAL ONE
 *
 * A blank origin is the most powerful row in the table — it applies to
 * everything — and showing it as an empty cell makes it look like an
 * unfinished one. It reads "Any lane", because that is what it does.
 * ---------------------------------------------------------------------------
 */
export default function RateMaster() {
  const [rates, setRates] = useState<RateCard[]>([]);
  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Partial<RateCard> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRates(await listRates(true));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the rates.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rates
      .filter((r) => (showInactive ? true : r.active))
      .filter((r) =>
        !needle
          ? true
          : [r.charge_head, r.origin, r.destination, r.notes, r.currency, r.unit]
              .filter(Boolean)
              .some((v) => String(v).toLowerCase().includes(needle))
      );
  }, [rates, query, showInactive]);

  /**
   * Grouped by charge, and inside each group the most specific first — the same
   * order `rates_for` resolves them in, so what the list shows at the top of a
   * group is what a quotation will actually use.
   */
  const groups = useMemo(() => {
    const by = new Map<string, RateCard[]>();
    for (const r of visible) {
      const list = by.get(r.charge_head) ?? [];
      list.push(r);
      by.set(r.charge_head, list);
    }
    for (const list of by.values())
      list.sort((a, b) => score(b) - score(a) || a.currency.localeCompare(b.currency));
    return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [visible]);

  async function remove(r: RateCard) {
    setError(null);
    try {
      await removeRate(r.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete that rate.");
    }
  }

  return (
    <div>
      <PageHeader
        title="Rate master"
        subtitle="What this desk charges, by charge and by lane. A quotation is filled from here, so a rate corrected once is corrected everywhere."
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setEditing({ charge_head: "", unit: "Shipment", currency: "INR", active: true })}
          className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-medium text-white hover:bg-brand-dark"
        >
          <Plus size={13} /> Add rate
        </button>

        <div className="relative min-w-[220px] max-w-sm flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Charge, port, note…"
            className="h-8 w-full pl-8"
          />
        </div>

        <button
          type="button"
          onClick={() => void load()}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary hover:text-text-primary"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
        </button>

        <label className="flex items-center gap-1.5 text-[12px] text-text-secondary">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Show withdrawn
        </label>
      </div>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      {loading && !rates.length ? (
        <p className="py-8 text-[13px] text-text-muted">Loading…</p>
      ) : !rates.length ? (
        <div className="rounded-card border border-dashed border-border-strong bg-surface-1 p-10 text-center">
          <p className="text-[14px] font-medium text-text-primary">No rates yet</p>
          <p className="mx-auto mt-1 max-w-lg text-[13px] text-text-secondary">
            Start with the charges that are the same on every job — documentation, administration,
            customs clearance — and leave their lane blank so they apply everywhere. Add the
            freight afterwards, one lane at a time. A quotation can then be filled from here
            instead of typed.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map(([head, list]) => (
            <section key={head}>
              <h2 className="mb-1.5 text-[12px] font-medium text-text-primary">
                {head}
                <span className="ml-2 font-normal text-text-muted">
                  {list.length} rate{list.length > 1 ? "s" : ""}
                </span>
              </h2>
              <div className="overflow-hidden rounded-card border border-border">
                <table className="w-full text-[12.5px]">
                  <thead className="bg-surface-2 text-[10.5px] uppercase tracking-wide text-text-muted">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Applies to</th>
                      <th className="px-3 py-2 text-left font-medium">Unit</th>
                      <th className="px-3 py-2 text-right font-medium">Sell</th>
                      <th className="px-3 py-2 text-right font-medium">Cost</th>
                      <th className="px-3 py-2 text-right font-medium">Min</th>
                      <th className="px-3 py-2 text-left font-medium">Valid</th>
                      <th className="w-16" />
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r) => (
                      <tr
                        key={r.id}
                        className={`border-t border-border ${
                          !r.active || expired(r) ? "opacity-50" : ""
                        }`}
                      >
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => setEditing(r)}
                            className="text-left text-text-primary hover:text-text-accent"
                          >
                            {laneLabel(r)}
                          </button>
                          <span className="ml-2 text-[11px] text-text-muted">
                            {[
                              RATE_MODES.find((m) => m.value === (r.mode ?? ""))?.label,
                              RATE_DIRECTIONS.find((d) => d.value === (r.direction ?? ""))?.label,
                            ]
                              .filter((v) => v && !v.startsWith("Any"))
                              .join(" · ")}
                          </span>
                          {r.notes && (
                            <p className="text-[11px] text-text-muted">{r.notes}</p>
                          )}
                        </td>
                        <td className="px-3 py-2 text-text-secondary">{r.unit}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-text-primary">
                          {r.currency} {fmt(r.sell_rate)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-text-muted">
                          {r.cost_rate == null ? "—" : fmt(r.cost_rate)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-text-muted">
                          {r.min_amount == null ? "—" : fmt(r.min_amount)}
                        </td>
                        <td className="px-3 py-2 text-[11.5px] text-text-muted">
                          {validity(r)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => void remove(r)}
                            title="Delete this rate"
                            className="rounded p-1 text-text-muted transition-colors hover:bg-surface-2 hover:text-text-danger"
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
          {!visible.length && <p className="py-6 text-[13px] text-text-muted">Nothing matches that.</p>}
        </div>
      )}

      {editing && (
        <RateForm
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function RateForm({
  initial,
  onClose,
  onSaved,
}: {
  initial: Partial<RateCard>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Partial<RateCard>>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof RateCard>(k: K, v: RateCard[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const head = (form.charge_head ?? "").trim();
    if (!head) return setError("Pick or type what is being charged.");
    if (form.sell_rate == null || Number.isNaN(Number(form.sell_rate)))
      return setError("Give a sell rate. Zero is allowed; blank is not.");

    setSaving(true);
    try {
      await saveRate({
        ...form,
        charge_head: head,
        // The catalogue's SAC code where the head matches one, so an invoice
        // raised from this line carries the right tax classification without
        // anybody looking it up.
        sac_code:
          form.sac_code || CHARGE_HEADS.find((c) => c.label === head)?.sac || null,
        origin: blank(form.origin),
        destination: blank(form.destination),
        mode: (blank(form.mode) as RateCard["mode"]) ?? null,
        direction: (blank(form.direction) as RateCard["direction"]) ?? null,
        valid_from: blank(form.valid_from),
        valid_to: blank(form.valid_to),
        sell_rate: Number(form.sell_rate),
        cost_rate: form.cost_rate == null || form.cost_rate === ("" as never) ? null : Number(form.cost_rate),
        min_amount:
          form.min_amount == null || form.min_amount === ("" as never) ? null : Number(form.min_amount),
        notes: (form.notes ?? "").trim(),
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that rate.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-6" onClick={onClose}>
      <div
        className="flex max-h-[92vh] w-full flex-col rounded-t-card sm:card sm:max-w-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={form.id ? "Edit rate" : "Add rate"}
      >
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-[14px] font-medium text-text-primary">
            {form.id ? "Edit rate" : "Add rate"}
          </h2>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary">
            <X size={16} />
          </button>
        </header>

        <form onSubmit={submit} className="flex-1 overflow-y-auto px-5 py-4" noValidate>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-[11.5px] text-text-secondary">What is charged</span>
              <input
                value={form.charge_head ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  set("charge_head", v);
                  const known = CHARGE_HEADS.find((c) => c.label === v);
                  if (known) {
                    set("unit", known.unit);
                    set("sac_code", known.sac);
                  }
                }}
                list="charge-heads"
                placeholder="Documentation / B/L fee"
              />
              <datalist id="charge-heads">
                {CHARGE_HEADS.map((c) => (
                  <option key={c.label} value={c.label} />
                ))}
              </datalist>
              <span className="mt-1 block text-[11px] text-text-muted">
                Pick one of the standard heads and the unit and SAC code follow, or type your own.
              </span>
            </label>

            <label className="block">
              <span className="mb-1 block text-[11.5px] text-text-secondary">Origin</span>
              <input
                value={form.origin ?? ""}
                onChange={(e) => set("origin", e.target.value)}
                placeholder="Leave blank for any"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11.5px] text-text-secondary">Destination</span>
              <input
                value={form.destination ?? ""}
                onChange={(e) => set("destination", e.target.value)}
                placeholder="Leave blank for any"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-[11.5px] text-text-secondary">Mode</span>
              <select value={form.mode ?? ""} onChange={(e) => set("mode", e.target.value as RateCard["mode"])}>
                {RATE_MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11.5px] text-text-secondary">Direction</span>
              <select
                value={form.direction ?? ""}
                onChange={(e) => set("direction", e.target.value as RateCard["direction"])}
              >
                {RATE_DIRECTIONS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-[11.5px] text-text-secondary">Unit</span>
              <select value={form.unit ?? "Shipment"} onChange={(e) => set("unit", e.target.value)}>
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11.5px] text-text-secondary">Currency</span>
              <select
                value={form.currency ?? "INR"}
                onChange={(e) => set("currency", e.target.value)}
              >
                {LINE_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-[11.5px] text-text-secondary">Sell per unit</span>
              <input
                type="number"
                step="0.01"
                min={0}
                value={form.sell_rate ?? ""}
                onChange={(e) => set("sell_rate", e.target.value === "" ? (null as never) : Number(e.target.value))}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11.5px] text-text-secondary">Cost per unit</span>
              <input
                type="number"
                step="0.01"
                min={0}
                value={form.cost_rate ?? ""}
                onChange={(e) => set("cost_rate", e.target.value === "" ? null : Number(e.target.value))}
              />
              <span className="mt-1 block text-[11px] text-text-muted">
                What it costs us. Shown while quoting so the margin is visible; never printed.
              </span>
            </label>

            <label className="block">
              <span className="mb-1 block text-[11.5px] text-text-secondary">Minimum</span>
              <input
                type="number"
                step="0.01"
                min={0}
                value={form.min_amount ?? ""}
                onChange={(e) => set("min_amount", e.target.value === "" ? null : Number(e.target.value))}
                placeholder="e.g. 3 CBM minimum on LCL"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-[11.5px] text-text-secondary">Valid from</span>
                <input
                  type="date"
                  value={form.valid_from ?? ""}
                  onChange={(e) => set("valid_from", e.target.value || null)}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11.5px] text-text-secondary">Valid to</span>
                <input
                  type="date"
                  value={form.valid_to ?? ""}
                  onChange={(e) => set("valid_to", e.target.value || null)}
                />
              </label>
            </div>

            <label className="block sm:col-span-2">
              <span className="mb-1 block text-[11.5px] text-text-secondary">Note</span>
              <input
                value={form.notes ?? ""}
                onChange={(e) => set("notes", e.target.value)}
                placeholder="Where the figure came from, or what it assumes"
              />
            </label>

            <label className="flex items-center gap-2 text-[12px] text-text-secondary sm:col-span-2">
              <input
                type="checkbox"
                checked={form.active ?? true}
                onChange={(e) => set("active", e.target.checked)}
              />
              In use. Unticking withdraws it without deleting the history of what was charged.
            </label>
          </div>

          {error && (
            <div className="mt-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
              <AlertCircle size={13} className="mt-px shrink-0" />
              {error}
            </div>
          )}
        </form>

        <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 items-center rounded-lg border border-border px-3 text-[12px] text-text-secondary hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={(e) => void submit(e as unknown as React.FormEvent)}
            disabled={saving}
            className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-medium text-white hover:bg-brand-dark disabled:opacity-60"
          >
            {saving && <Loader2 size={13} className="animate-spin" />}
            Save rate
          </button>
        </footer>
      </div>
    </div>
  );
}

/** The same weighting `rates_for` uses, so the page shows what a quote will pick. */
const score = (r: RateCard): number =>
  (r.origin ? 2 : 0) + (r.destination ? 2 : 0) + (r.mode ? 1 : 0) + (r.direction ? 1 : 0);

const fmt = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

function validity(r: RateCard): string {
  if (!r.valid_from && !r.valid_to) return "Standing";
  if (r.valid_from && r.valid_to) return `${r.valid_from} → ${r.valid_to}`;
  if (r.valid_to) return `Until ${r.valid_to}`;
  return `From ${r.valid_from}`;
}

const blank = (v: string | null | undefined): string | null => {
  const s = (v ?? "").trim();
  return s === "" ? null : s;
};
