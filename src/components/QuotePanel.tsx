import { useState } from "react";
import { AlertCircle, Check, IndianRupee, Loader2, Send, ThumbsDown } from "lucide-react";
import {
  acceptQuote,
  addQuote,
  declineQuote,
  markQuoteSent,
  missingForQuote,
  type Customer,
  type Enquiry,
  type Quote,
} from "../services/enquiries";
import QuoteCharges from "./QuoteCharges";
import { LINE_CURRENCIES } from "../services/charges";
import QuoteSend from "./QuoteSend";
import SchedulePicker from "./SchedulePicker";
import type { PartnerQuote } from "../services/rfq";

/**
 * Quoting, and the customer's answer.
 *
 * Acceptance is the end of the inbound half, and it is recorded as a deliberate
 * act rather than inferred from a mail that looks agreeable. Everything
 * downstream -- booking, container space, documents -- starts from this flag, so
 * it should be something a person at the desk affirms, not something a parser
 * decides.
 *
 * Superseded versions are kept. When a customer says "you quoted me less last
 * week", the earlier row is the answer.
 */
export default function QuotePanel({
  enquiry,
  quotes,
  onChanged,
  partnerQuotes,
  customer,
}: {
  enquiry: Enquiry;
  /** Who it is addressed to, for the quotation mail and the PDF. */
  customer?: Customer | null;
  quotes: Quote[];
  onChanged: () => void;
  /** Replies from partners, offered as the cost against a charge line. */
  partnerQuotes?: PartnerQuote[];
}) {
  const [basis, setBasis] = useState("");
  const [sailing, setSailing] = useState("");
  // The schedule entry the sailing date was picked from, if it was.
  const [scheduleId, setScheduleId] = useState<string | null>(null);
  const [validUntil, setValidUntil] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [fxRate, setFxRate] = useState("1");
  const [quoteType, setQuoteType] = useState<"standard" | "spot" | "contract">("standard");
  const [multiCarrier, setMultiCarrier] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);

  const missing = missingForQuote(enquiry);
  const live = quotes.find((q) => q.status === "sent" || q.status === "draft") ?? null;
  const accepted = quotes.find((q) => q.status === "accepted") ?? null;

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mt-4 card p-5">
      <h2 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-text-secondary mb-3">
        <IndianRupee size={12} /> Quotation
      </h2>

      {accepted ? (
        <div className="rounded-lg bg-bg-success px-3 py-3 text-[13px] text-text-success">
          <p className="flex items-center gap-1.5 font-medium">
            <Check size={14} /> Accepted at ₹{Number(accepted.amount_inr).toLocaleString("en-IN")}
          </p>
          <p className="mt-0.5 text-[12px]">
            {accepted.basis}
            {accepted.sailing_date ? ` · sailing ${accepted.sailing_date}` : ""}
          </p>
          <p className="mt-2 text-[12px]">
            This enquiry is ready to become a booking. Container allocation and documentation
            follow from here.
          </p>
        </div>
      ) : missing.length > 0 && !live ? (
        <p className="text-[12px] text-text-muted">
          Quoting without {missing.join(", ").toLowerCase()} — the rate will be an indication, and
          the quotation prints those as TBD. Fill them in above if the customer has given them.
        </p>
      ) : null}

      {/* ---- outstanding quote ---- */}
      {live && !accepted && (
        <div className="rounded-lg border border-border bg-surface-2 px-3 py-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="text-[15px] font-semibold text-text-primary">
                ₹{Number(live.amount_inr).toLocaleString("en-IN")}
              </p>
              <p className="text-[12px] text-text-secondary">
                Version {live.version} · {live.status}
                {live.basis ? ` · ${live.basis}` : ""}
                {live.sailing_date ? ` · sailing ${live.sailing_date}` : ""}
                {live.valid_until ? ` · valid to ${live.valid_until}` : ""}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {live.status === "sent" && (
                <>
                  <button
                    onClick={() =>
                      run("accept", () =>
                        acceptQuote(live.id, enquiry.ref, Number(live.amount_inr))
                      )
                    }
                    disabled={busy !== null}
                    className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-brand hover:bg-brand-dark disabled:opacity-60 text-white text-[12px] font-medium"
                  >
                    {busy === "accept" ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Check size={13} />
                    )}
                    Customer accepted
                  </button>
                  <button
                    onClick={() =>
                      run("decline", () => declineQuote(live.id, enquiry.ref, "Customer declined"))
                    }
                    disabled={busy !== null}
                    className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border text-[12px] text-text-secondary hover:text-text-primary"
                  >
                    <ThumbsDown size={13} />
                    Declined
                  </button>
                </>
              )}
            </div>
          </div>

          {/*
            The charges the figure above is the sum of. A draft is still being
            built so they are editable; once it is sent the arithmetic is what
            the customer was shown, and once accepted the database refuses to
            change it at all.
          */}
          <div className="mt-3 border-t border-border pt-3">
            <QuoteCharges
              quoteId={live.id}
              locked={live.status !== "draft"}
              partnerQuotes={partnerQuotes}
              /*
                What the rate master is asked about. `transport_mode` is the
                asked field from 047 rather than a guess: the ratios and the
                rates both differ by mode, and a sea rate offered on an air job
                is worse than no rate at all.
              */
              quoteCurrency={live.currency}
              quoteFxRate={live.fx_rate}
              lane={{
                origin: enquiry.origin,
                destination: enquiry.destination,
                mode: enquiry.transport_mode,
                direction: enquiry.trade_direction ?? null,
              }}
              onChanged={onChanged}
            />
          </div>

          {/*
            Everything between "the figures are right" and "the customer has
            it": the terms, the approval, and the three ways it can leave.
          */}
          <QuoteSend
            enquiry={enquiry}
            customer={customer ?? null}
            quote={live}
            onChanged={onChanged}
          />
        </div>
      )}

      {/* ---- new quote ---- */}
      {!accepted && (
        <div className="mt-3">
          {!drafting ? (
            <button
              onClick={() => setDrafting(true)}
              /*
                Never disabled.

                A desk quotes on partial information constantly: a customer
                rings for an indication before the packing list exists, an agent
                wants a number today and the dimensions on Thursday, a regular
                lane is quoted from last month's figures. Refusing to open the
                form until every field is answered does not produce better data
                — it produces a quotation typed into a mail instead, which is
                the same price with none of the record.

                What is missing is said above, and printed on the document as
                TBD. That is the honest treatment: tell somebody what they are
                quoting without, and let them decide.
              */
              className="h-8 px-3 rounded-lg border border-border bg-surface-1 text-[12px] font-medium text-text-primary hover:bg-surface-2"
            >
              {live ? "Revise quote" : "Add quote"}
            </button>
          ) : (
            <div className="rounded-lg border border-border p-3">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field
                  label="Basis"
                  value={basis}
                  onChange={setBasis}
                  placeholder="All-in LCL, door to port"
                />
                <div>
                  <Field
                    label="Sailing"
                    value={sailing}
                    onChange={(v) => {
                      setSailing(v);
                      setScheduleId(null);
                    }}
                    type="date"
                  />
                  <div className="mt-1.5">
                    <SchedulePicker
                      label={scheduleId ? `From ${scheduleId}` : "From schedule"}
                      mode={
                        enquiry.transport_mode === "air"
                          ? "air"
                          : enquiry.transport_mode === "sea_lcl" || enquiry.transport_mode === "sea_fcl"
                            ? "sea"
                            : null
                      }
                      from={enquiry.origin}
                      to={enquiry.destination}
                      onPick={(x) => {
                        setSailing(x.etd);
                        setScheduleId(x.id);
                      }}
                    />
                  </div>
                </div>
                <Field label="Valid until" value={validUntil} onChange={setValidUntil} type="date" />
              </div>

              {/*
                The quotation's own header. Separate from the charges because it
                describes the document rather than any line on it: a quotation
                presented in USD can still carry a charge bought in AED.
              */}
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="block">
                  <span className="mb-1 block text-[11.5px] text-text-secondary">Quote currency</span>
                  <select
                    value={currency}
                    onChange={(e) => {
                      setCurrency(e.target.value);
                      // Back to parity when it returns to rupees, so a rate left
                      // over from a foreign draft cannot multiply a rupee quote.
                      if (e.target.value === "INR") setFxRate("1");
                    }}
                    className="h-8 w-full"
                  >
                    {LINE_CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1 block text-[11.5px] text-text-secondary">
                    Rate of exchange
                  </span>
                  <input
                    type="number"
                    step="0.0001"
                    min={0}
                    value={fxRate}
                    disabled={currency === "INR"}
                    onChange={(e) => setFxRate(e.target.value)}
                    className="h-8 w-full disabled:opacity-60"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-[11.5px] text-text-secondary">Quote type</span>
                  <select
                    value={quoteType}
                    onChange={(e) =>
                      setQuoteType(e.target.value as "standard" | "spot" | "contract")
                    }
                    className="h-8 w-full"
                  >
                    <option value="standard">Standard</option>
                    <option value="spot">Spot</option>
                    <option value="contract">Contract</option>
                  </select>
                </label>

                <label className="flex items-center gap-2 pt-5 text-[12px] text-text-secondary">
                  <input
                    type="checkbox"
                    checked={multiCarrier}
                    onChange={(e) => setMultiCarrier(e.target.checked)}
                  />
                  Multi-carrier
                </label>
              </div>

              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={() =>
                    run("add", async () => {
                      // Opened at zero: the amount is the sum of the charges,
                      // which are added next. A quotation that is one typed
                      // figure is the thing this replaced.
                      await addQuote({
                        ref: enquiry.ref,
                        amountInr: 0,
                        basis: basis.trim(),
                        sailingDate: sailing || undefined,
                        scheduleId,
                        validUntil: validUntil || undefined,
                        currency,
                        fxRate: Number(fxRate) || 1,
                        quoteType,
                        multiCarrier,
                      });
                      setBasis("");
                      setSailing("");
                      setScheduleId(null);
                      setValidUntil("");
                      setDrafting(false);
                    })
                  }
                  disabled={busy !== null}
                  className="flex items-center gap-1.5 h-8 px-3.5 rounded-lg bg-brand hover:bg-brand-dark disabled:opacity-60 text-white text-[12px] font-medium"
                >
                  {busy === "add" ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                  Start the quotation
                </button>
                <button
                  onClick={() => setDrafting(false)}
                  className="h-8 px-3 rounded-lg border border-border text-[12px] text-text-secondary hover:text-text-primary"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger"
        >
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      {/* ---- history ---- */}
      {quotes.length > 1 && (
        <div className="mt-4 pt-3 border-t border-border">
          <p className="text-[10px] uppercase tracking-wide text-text-muted mb-1.5">
            Earlier versions
          </p>
          <ul className="space-y-1">
            {quotes
              .filter((q) => q.id !== live?.id && q.id !== accepted?.id)
              .map((q) => (
                <li key={q.id} className="text-[12px] text-text-secondary">
                  v{q.version} · ₹{Number(q.amount_inr).toLocaleString("en-IN")} · {q.status}
                  {q.basis ? ` · ${q.basis}` : ""}
                </li>
              ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-text-secondary mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full"
        autoComplete="off"
      />
    </div>
  );
}
