import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Check, Loader2 } from "lucide-react";
import { trackingByToken, type PublicTracking } from "../services/tracking";

/**
 * The customer's tracking page: /t/:token, no account needed.
 *
 * ---------------------------------------------------------------------------
 * Read-only, and everything on it comes from `shipment_tracking` (069), which
 * builds the answer field by field — the route, where the cargo is, the steps
 * and the dates. Money, notes and the office's own people are not in the
 * answer, so they cannot be on the page.
 *
 * The same plain shell as the quotation page: somebody opening it on a phone
 * from a mail should see their shipment, not an application.
 * ---------------------------------------------------------------------------
 */
export default function TrackShipment() {
  const { token = "" } = useParams();
  const [t, setT] = useState<PublicTracking | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void trackingByToken(token)
      .then(setT)
      .catch(() => setFailed(true));
  }, [token]);

  const air = t?.mode === "air";
  const day = (d: string | null | undefined, time?: string | null) =>
    d
      ? `${new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}${time ? `, ${time.slice(0, 5)}` : ""}`
      : null;

  return (
    <div className="min-h-screen bg-[#f4f5f7] px-4 py-8 text-[#1f2937]">
      <div className="mx-auto w-full max-w-[640px]">
        <header className="rounded-t-xl bg-[#2f4f6f] px-6 py-5 text-white">
          <p className="text-[22px] font-bold tracking-wide">SHIPMENT TRACKING</p>
          <p className="mt-0.5 text-[12.5px] opacity-90">Aashish Logistics Global</p>
        </header>

        <main className="rounded-b-xl border border-t-0 border-[#e5e7eb] bg-white px-6 py-6">
          {!t && !failed ? (
            <p className="flex items-center gap-2 py-8 text-[13px] text-[#6b7280]">
              <Loader2 size={14} className="animate-spin" /> Loading…
            </p>
          ) : failed || !t || t.state === "unknown" ? (
            <Ended
              title="We could not find this shipment"
              body="The link may be incomplete. Please reply to the email it came from and we will send it again."
            />
          ) : t.state === "revoked" ? (
            <Ended
              title="This tracking link is no longer active"
              body="Please contact us for the latest on your shipment and we will send a new link."
            />
          ) : (
            <>
              <p className="text-[12px] text-[#6b7280]">
                {t.reference} · {t.shipment}
                {t.customer ? ` · ${t.customer}` : ""}
              </p>
              <p className="mt-1 text-[18px] font-semibold">
                {[t.origin, t.destination].filter(Boolean).join(" → ")}
              </p>
              <p className="mt-2 inline-block rounded-full bg-[#e8f0f7] px-3 py-1 text-[12.5px] font-semibold capitalize text-[#2f4f6f]">
                {t.stage_label}
                {t.stage === "delivered" && t.delivered_to ? ` — received by ${t.delivered_to}` : ""}
              </p>

              <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 text-[13px]">
                <Item label={air ? "Airline" : "Carrier"} value={t.carrier} />
                <Item
                  label={air ? "Flight" : "Vessel"}
                  value={air ? t.flight_number : [t.vessel, t.voyage].filter(Boolean).join(" / ") || null}
                />
                <Item label={air ? "Airport of loading" : "Port of loading"} value={t.port_of_loading} />
                <Item label={air ? "Airport of discharge" : "Port of discharge"} value={t.port_of_discharge} />
                <Item label="Departure (ETD)" value={day(t.etd, t.etd_time)} />
                <Item label="Arrival (ETA)" value={day(t.eta, t.eta_time)} />
                <Item label={air ? "HAWB" : "House B/L"} value={t.house_bill} />
                <Item
                  label="Cargo"
                  value={
                    [
                      t.pieces ? `${t.pieces} pcs` : null,
                      t.gross_weight_kg ? `${Number(t.gross_weight_kg).toLocaleString("en-IN")} kg` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || null
                  }
                />
              </dl>

              <h2 className="mt-6 text-[12px] font-semibold uppercase tracking-wide text-[#6b7280]">Progress</h2>
              <ol className="mt-3">
                {(t.steps ?? []).map((s, i) => (
                  <li key={i} className="flex items-start gap-3 pb-3 last:pb-0">
                    <span
                      className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border ${
                        s.done_at ? "border-[#2f7a4f] bg-[#2f7a4f] text-white" : "border-[#d1d5db] bg-white"
                      }`}
                    >
                      {s.done_at && <Check size={11} />}
                    </span>
                    <div className="min-w-0">
                      <p className={`text-[13px] ${s.milestone ? "font-semibold" : ""} ${s.done_at ? "text-[#1f2937]" : "text-[#6b7280]"}`}>
                        {s.label}
                      </p>
                      <p className="text-[11.5px] text-[#9ca3af]">
                        {s.done_at
                          ? new Date(s.done_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
                          : s.due_on
                            ? `Expected ${day(s.due_on)}`
                            : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>

              <p className="mt-6 border-t border-[#e5e7eb] pt-4 text-[12px] text-[#6b7280]">
                Questions about this shipment? Reply to our last email and keep{" "}
                <strong>{t.reference}</strong> in the subject.
              </p>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function Item({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px] text-[#6b7280]">{label}</dt>
      <dd className="truncate">{value}</dd>
    </div>
  );
}

function Ended({ title, body }: { title: string; body: string }) {
  return (
    <div className="py-6">
      <p className="text-[15px] font-semibold">{title}</p>
      <p className="mt-1 text-[13px] text-[#6b7280]">{body}</p>
    </div>
  );
}
