import { useCallback, useEffect, useState } from "react";
import { useRovingButtons } from "../lib/useRovingButtons";
import { AlertTriangle, Loader2, Mail } from "lucide-react";
import { useAuth } from "../lib/auth";
import { failureText } from "../lib/errorText";
import { bookingHtml, bookingSubject, coloadFreight, coloaderBilled, coloadIssues, type Cargo, type ColoadConsole, type ColoadTerms } from "../lib/coload";
import { LINE_CURRENCIES } from "../services/charges";
import { listBills, type Bill } from "../services/bills";
import { manifestFor } from "../services/consoleManifest";
import { updateConsole, type Console } from "../services/consoles";
import type { Partner } from "../services/partners";
import { useLiveVersion } from "../lib/liveVersions";
import ComposeMail from "./ComposeMail";
import Select from "./Select";

const num = (v: string): number | null => {
  const x = parseFloat(v.replace(/[,\s]/g, ""));
  return Number.isFinite(x) && x >= 0 ? x : null;
};
const fig = (n: number, dp = 2) => n.toLocaleString("en-IN", { maximumFractionDigits: dp });

/**
 * Where the console's space comes from (121): our own box with the line, or
 * LCL space bought from another consolidator at a rate per W/M. On a co-load,
 * what the rate comes to on the houses, what the co-loader has billed against
 * the console, and the booking request to them. The rules are lib/coload.ts.
 */
export default function ConsoleCoload({ console: c, partners, onChanged }: { console: Console; partners: Partner[]; onChanged: () => void }) {
  // The choice rows below: one Tab stop each, the arrows along them (lib/useRovingButtons).
  const spaceRow = useRovingButtons();
  const { session } = useAuth();
  const coload = c.space_from === "coloader";
  const coloader = partners.find((p) => p.id === c.coloader_id) ?? null;
  const [bills, setBills] = useState<Bill[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compose, setCompose] = useState<{ to: string; subject: string; body: string } | null>(null);

  const [rate, setRate] = useState(c.coloader_rate == null ? "" : String(c.coloader_rate));
  const [minWm, setMinWm] = useState(String(c.coloader_min_wm ?? 1));
  useEffect(() => {
    setRate(c.coloader_rate == null ? "" : String(c.coloader_rate));
    setMinWm(String(c.coloader_min_wm ?? 1));
  }, [c.coloader_rate, c.coloader_min_wm]);

  const live = useLiveVersion("bills");
  const loadBills = useCallback(async () => {
    if (!coload) return;
    try {
      setBills(await listBills({ consoleId: c.id }));
    } catch {
      setBills([]);
    }
  }, [c.id, coload]);
  useEffect(() => {
    void loadBills();
  }, [loadBills, live]);

  async function save(key: string, patch: Partial<Console>) {
    setBusy(key);
    setError(null);
    try {
      await updateConsole(c.id, patch);
      onChanged();
    } catch (e) {
      setError(failureText(e, "That did not save.").message);
    } finally {
      setBusy(null);
    }
  }

  const s = c.summary;
  const cargo: Cargo = { bills: s?.house_bills ?? 0, packages: Number(s?.packages ?? 0), grossKg: Number(s?.gross_weight_kg ?? 0), cbm: Number(s?.volume_cbm ?? 0) };
  const terms: ColoadTerms = { coloader: coloader ? coloader.organisation || coloader.name : "", rate: c.coloader_rate ?? null, currency: c.coloader_currency ?? "USD", minWm: Number(c.coloader_min_wm ?? 1) };
  const freight = coloadFreight(terms, cargo);
  const billed = coloaderBilled(bills, c.coloader_id ?? null);
  const cc: ColoadConsole = {
    console_no: c.console_no,
    carrier_booking_no: c.carrier_booking_no ?? "",
    pol: c.pol,
    pod: c.pod,
    place_of_delivery: c.place_of_delivery,
    etd: c.etd,
    vessel: c.vessel,
    voyage: c.voyage,
  };
  const exporting = c.direction !== "import";
  const issues = coloadIssues({ ...terms, coloaderId: c.coloader_id ?? null, email: coloader?.emails[0] ?? "" }, cc, cargo);

  async function openBooking() {
    setBusy("booking");
    setError(null);
    try {
      const m = await manifestFor(c);
      const goods = [...new Set(m.lines.map((l) => l.description).filter(Boolean))];
      setCompose({ to: coloader?.emails[0] ?? "", subject: bookingSubject(cc, cargo), body: bookingHtml(cc, terms, cargo, goods, m.agent?.name ?? "") });
    } catch (e) {
      setError(failureText(e, "Could not gather the cargo for the request.").message);
    } finally {
      setBusy(null);
    }
  }

  const field = "h-8 w-full text-[12.5px]";
  const tab = (on: boolean) =>
    `h-8 rounded-lg border px-3 text-[12px] transition-colors ${on ? "border-brand bg-brand font-medium text-white" : "border-border bg-surface-1 text-text-secondary hover:border-border-strong hover:text-text-primary"}`;

  return (
    <section>
      <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-secondary">Space</h3>
      <div {...spaceRow} aria-label="Space" className="flex flex-wrap gap-1.5">
        <button type="button" aria-pressed={!coload} disabled={busy !== null} onClick={() => coload && void save("from", { space_from: "line" })} className={tab(!coload)}>
          Our own box, with the line
        </button>
        <button type="button" aria-pressed={coload} disabled={busy !== null} onClick={() => !coload && void save("from", { space_from: "coloader" })} className={tab(coload)}>
          Bought from a co-loader
        </button>
      </div>

      {error && <p className="mt-2 rounded-lg bg-bg-danger px-3 py-2 text-[12px] text-text-danger">{error}</p>}

      {coload && (
        <div className="mt-3 rounded-lg border border-border p-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="min-w-0">
              <span className="mb-0.5 block text-[11px] text-text-secondary">Co-loader</span>
              <Select
                label="Co-loader"
                className="w-full"
                value={c.coloader_id ?? ""}
                options={[
                  { value: "", label: "Not chosen" },
                  // Consol partners first: they are who sells LCL space.
                  ...[...partners]
                    .sort((a, b) => Number(b.role === "consol_partner") - Number(a.role === "consol_partner"))
                    .map((p) => ({ value: p.id, label: p.organisation || p.name, hint: p.role === "consol_partner" ? "Consol partner" : undefined })),
                ]}
                onChange={(v) => void save("coloader", { coloader_id: v || null })}
              />
            </div>
            <label className="block">
              <span className="mb-0.5 block text-[11px] text-text-secondary">Rate per W/M</span>
              <input
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                onBlur={() => num(rate) !== (c.coloader_rate ?? null) && void save("rate", { coloader_rate: num(rate) })}
                inputMode="decimal"
                className={`${field} text-right tabular-nums`}
              />
            </label>
            <div>
              <span className="mb-0.5 block text-[11px] text-text-secondary">Currency</span>
              <Select
                label="Currency"
                className="w-full"
                value={c.coloader_currency ?? "USD"}
                options={LINE_CURRENCIES.map((x) => ({ value: x, label: x }))}
                onChange={(v) => void save("currency", { coloader_currency: v })}
              />
            </div>
            <label className="block">
              <span className="mb-0.5 block text-[11px] text-text-secondary">Minimum W/M</span>
              <input
                value={minWm}
                onChange={(e) => setMinWm(e.target.value)}
                onBlur={() => num(minWm) !== null && num(minWm) !== Number(c.coloader_min_wm ?? 1) && void save("min", { coloader_min_wm: num(minWm) as number })}
                inputMode="decimal"
                className={`${field} text-right tabular-nums`}
              />
            </label>
          </div>

          <dl className="mt-3 grid gap-x-6 gap-y-1 text-[12.5px] sm:grid-cols-2">
            <div className="flex justify-between gap-3 sm:block">
              <dt className="text-[11px] text-text-secondary">Freight at their rate</dt>
              <dd className="tabular-nums text-text-primary">
                {freight ? (
                  <>
                    {terms.currency} {fig(freight.amount)}
                    <span className="ml-1.5 text-[11.5px] text-text-muted">
                      {fig(freight.charged, 3)} W/M{freight.charged > freight.wm ? " (the minimum)" : ""} × {fig(terms.rate ?? 0)} · {fig(cargo.cbm, 3)} CBM, {fig(cargo.grossKg / 1000, 3)} t
                    </span>
                  </>
                ) : (
                  <span className="text-text-muted">Enter their rate</span>
                )}
              </dd>
            </div>
            <div className="flex justify-between gap-3 sm:block">
              <dt className="text-[11px] text-text-secondary">Their bills on this console</dt>
              <dd className="tabular-nums text-text-primary">
                {billed.count ? (
                  <>
                    {Object.entries(billed.byCurrency)
                      .map(([cur, v]) => `${cur} ${fig(v)}`)
                      .join(" + ")}
                    <span className="ml-1.5 text-[11.5px] text-text-muted">₹{fig(billed.inr)} · freight plus their other charges</span>
                  </>
                ) : (
                  <span className="text-text-muted">None recorded yet: record their invoice under Costs below</span>
                )}
              </dd>
            </div>
          </dl>

          {exporting && (
            <>
              {issues.length > 0 && (
                <ul className="mt-3 space-y-1 rounded-lg bg-bg-warning px-3 py-2 text-[12px] text-text-warning">
                  {issues.map((x) => (
                    <li key={x} className="flex items-start gap-1.5">
                      <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {x}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void openBooking()}
                  disabled={busy !== null || !c.coloader_id}
                  className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-[12px] font-medium text-white hover:bg-brand-dark disabled:opacity-60"
                >
                  {busy === "booking" ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />} Email a booking request
                </button>
                <span className="text-[11.5px] text-text-muted">Their booking number goes in "Co-loader's booking no" below.</span>
              </div>
            </>
          )}
        </div>
      )}

      {compose && (
        <ComposeMail
          mailbox={session?.email ?? ""}
          fromName={session?.name ?? ""}
          signature={session?.signature ?? ""}
          initial={compose}
          onClose={() => setCompose(null)}
          onSent={() => setCompose(null)}
        />
      )}
    </section>
  );
}
