import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Truck } from "lucide-react";
import Collapsible from "./Collapsible";
import { Field, Segmented, TextSave, YesNo } from "./formControls";
import { failureText } from "../lib/errorText";
import { updateEnquiry, type Enquiry } from "../services/enquiries";
import { listRates } from "../services/rateMaster";

/**
 * The service being asked for.
 *
 * ---------------------------------------------------------------------------
 * WHY THESE FIELDS LIVE HERE AND NOWHERE ELSE
 *
 * The lane, the terms and the mode used to be editable in the cargo card, and
 * the mode again in the consol section. Two editors for one fact is how the two
 * come to disagree — and worse, a form opened before the other was saved
 * writes its stale copy straight back over the change. So they moved here
 * whole: this panel owns what the job IS, the cargo card owns what is being
 * carried.
 *
 * WHY EVERY CHANGE SAVES AS IT IS MADE
 *
 * There is no Save button. A segmented control that has to be confirmed
 * separately is one people click and walk away from, and the next person reads
 * a value that was never stored. Toggles save on the click, typed fields when
 * you leave them.
 *
 * WHY THE PRODUCT CODE IS NOT A FIELD
 *
 * "AIR EXPORT" is the service and the trade, said together. Storing it would be
 * a third fact that must agree with two others, and the first time somebody
 * changes the mode it says the wrong thing. It is worked out, never typed.
 * ---------------------------------------------------------------------------
 */

const SERVICES: Array<{ value: NonNullable<Enquiry["transport_mode"]>; label: string }> = [
  { value: "air", label: "AIR" },
  { value: "sea_lcl", label: "LCL" },
  { value: "sea_fcl", label: "FCL" },
  { value: "road", label: "ROAD" },
  { value: "other", label: "OTHERS" },
];

const TRADES: Array<{ value: NonNullable<Enquiry["trade_direction"]>; label: string }> = [
  { value: "export", label: "Export" },
  { value: "import", label: "Import" },
  { value: "cross_trade", label: "Cross trade" },
];

/** Incoterms 2020, in the order the ICC lists them. */
const INCOTERMS = ["EXW", "FCA", "CPT", "CIP", "DAP", "DPU", "DDP", "FAS", "FOB", "CFR", "CIF"];

export default function ServiceDetailsPanel({
  enquiry,
  onSaved,
}: {
  enquiry: Enquiry;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [places, setPlaces] = useState<{ origins: string[]; destinations: string[] }>({
    origins: [],
    destinations: [],
  });

  /*
    Suggested places come from the rate master.

    Not a port list: the rate master matches a lane on the spelling, so
    "Chennai" and "Chennai (MAA)" are different lanes to it. Offering the
    spellings the rates were entered under is what makes "fill using rate
    master" find them.
  */
  useEffect(() => {
    void listRates()
      .then((rates) => {
        const uniq = (xs: Array<string | null>) =>
          [...new Set(xs.filter((x): x is string => Boolean(x && x.trim())))].sort();
        setPlaces({
          origins: uniq(rates.map((r) => r.origin)),
          destinations: uniq(rates.map((r) => r.destination)),
        });
      })
      .catch(() => {});
  }, []);

  async function save(key: string, patch: Partial<Enquiry>) {
    setBusy(key);
    setError(null);
    try {
      await updateEnquiry(enquiry.ref, patch);
      onSaved();
    } catch (e) {
      setError(failureText(e, "That did not save.").message);
    } finally {
      setBusy(null);
    }
  }

  const productCode = useMemo(() => {
    const svc = SERVICES.find((s) => s.value === enquiry.transport_mode)?.label;
    const trade = TRADES.find((t) => t.value === enquiry.trade_direction)?.label;
    if (!svc && !trade) return null;
    const svcWord = svc === "LCL" || svc === "FCL" ? `SEA ${svc}` : svc;
    return [svcWord, trade?.toUpperCase()].filter(Boolean).join(" ");
  }, [enquiry.transport_mode, enquiry.trade_direction]);

  return (
    <Collapsible
      id="case:service"
      title="Service details"
      icon={<Truck size={12} className="shrink-0 text-text-muted" />}
      badge={productCode ?? undefined}
    >
      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      {/*
        The first column is wider than the others. Service has five options
        against Trade's three, and at equal widths "OTHERS" was cut to "OTHE…" —
        a label you have to guess is a label that gets misclicked. Origin and
        Destination sit in the same column and are the longest values anyway.
      */}
      <div className="grid gap-x-6 gap-y-5 md:grid-cols-[1.35fr_1fr_1fr]">
        {/* ---- row 1: what kind of job ---- */}
        <Field label="Service">
          <Segmented
            options={SERVICES}
            value={enquiry.transport_mode}
            busy={busy === "mode"}
            onChange={(v) => void save("mode", { transport_mode: v })}
          />
        </Field>

        <Field label="Trade">
          <Segmented
            options={TRADES}
            value={enquiry.trade_direction}
            busy={busy === "trade"}
            onChange={(v) => void save("trade", { trade_direction: v })}
          />
        </Field>

        <Field label="Product code" hint="Worked out from the service and the trade.">
          <span
            className={`flex h-9 items-center rounded-lg bg-surface-2 px-3 text-[13px] font-medium ${
              productCode ? "text-text-primary" : "text-text-muted"
            }`}
          >
            {productCode ?? "Choose a service and a trade"}
          </span>
        </Field>

        {/* ---- row 2: where from, and do we collect ---- */}
        <Field label="Origin">
          <TextSave
            value={enquiry.origin ?? ""}
            list="origin-places"
            placeholder="Chennai"
            busy={busy === "origin"}
            onSave={(v) => void save("origin", { origin: v || null })}
          />
          <datalist id="origin-places">
            {places.origins.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        </Field>

        <Field label="Pickup">
          <YesNo
            value={enquiry.pickup_required}
            busy={busy === "pickup"}
            onChange={(v) => void save("pickup", { pickup_required: v })}
          />
          {enquiry.pickup_required && (
            <div className="mt-2">
              <TextSave
                value={enquiry.pickup_location ?? ""}
                placeholder="Where we collect from"
                busy={busy === "pickup_location"}
                onSave={(v) => void save("pickup_location", { pickup_location: v || null })}
              />
            </div>
          )}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Transit days">
            <TextSave
              value={enquiry.transit_days == null ? "" : String(enquiry.transit_days)}
              type="number"
              placeholder="—"
              busy={busy === "transit"}
              onSave={(v) =>
                void save("transit", { transit_days: v === "" ? null : Math.round(Number(v)) })
              }
            />
          </Field>
          <Field label="Customer ref">
            <TextSave
              value={enquiry.customer_reference ?? ""}
              placeholder="Their PO"
              busy={busy === "custref"}
              onSave={(v) => void save("custref", { customer_reference: v || null })}
            />
          </Field>
        </div>

        {/* ---- row 3: where to, do we deliver, on what terms ---- */}
        <Field label="Destination">
          <TextSave
            value={enquiry.destination ?? ""}
            list="destination-places"
            placeholder="Jebel Ali"
            busy={busy === "destination"}
            onSave={(v) => void save("destination", { destination: v || null })}
          />
          <datalist id="destination-places">
            {places.destinations.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </Field>

        <Field label="Delivery">
          <YesNo
            value={enquiry.delivery_required}
            busy={busy === "delivery"}
            onChange={(v) => void save("delivery", { delivery_required: v })}
          />
          {enquiry.delivery_required && (
            <div className="mt-2">
              <TextSave
                value={enquiry.delivery_location ?? ""}
                placeholder="Where we deliver to"
                busy={busy === "delivery_location"}
                onSave={(v) => void save("delivery_location", { delivery_location: v || null })}
              />
            </div>
          )}
        </Field>

        <Field label="Terms of shipment">
          <select
            value={enquiry.incoterm ?? ""}
            disabled={busy !== null}
            onChange={(e) => void save("incoterm", { incoterm: e.target.value || null })}
            className="h-9 w-full"
          >
            <option value="">Not given</option>
            {INCOTERMS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
            {/* Whatever the mail said, kept visible even when it is not one of
                the eleven: "FOB Chennai" is still a term somebody wrote down. */}
            {enquiry.incoterm && !INCOTERMS.includes(enquiry.incoterm) && (
              <option value={enquiry.incoterm}>{enquiry.incoterm}</option>
            )}
          </select>
        </Field>
      </div>
    </Collapsible>
  );
}
