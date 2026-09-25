import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, Info, Layers, Ship } from "lucide-react";
import Select from "../../components/Select";
import { useShipment } from "../ShipmentDetail";
import HawbForm from "../../components/HawbForm";
import HblForm from "../../components/HblForm";
import { updateShipment } from "../../services/enquiries";
import {
  attachToConsole,
  detachFromConsole,
  issueHouseBl,
  openConsoles,
  type Console,
} from "../../services/consoles";

/**
 * The house bill: a HAWB on a flight, an HBL at sea.
 *
 * ---------------------------------------------------------------------------
 * On a consolidation the carrier issues one master bill covering the whole
 * box or the whole air consol, and we issue this shipper their own house bill
 * under it. The house bill is the document the customer holds and the one the
 * documents here print.
 *
 * Moved out of the party tab unchanged in what it does: it was the one part of
 * that page that was not about a party, and the reference system gives it a
 * tab of its own for the same reason.
 *
 * On an air job the tab is the HAWB itself (075): the form laid out like the
 * air waybill, numbered on its first save, printed from here. The console and
 * who issues the bill stay above it.
 * ---------------------------------------------------------------------------
 */
export default function ShipmentBill() {
  const { shipment, enquiry, reload } = useShipment();
  const [consoles, setConsoles] = useState<Console[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Only the ones still taking cargo. A console that has sailed refuses an
  // attach in the database anyway, and offering it here would be a button that
  // exists to produce an error.
  useEffect(() => {
    void openConsoles()
      .then(setConsoles)
      .catch(() => setConsoles([]));
  }, []);

  const mode = shipment.transport_mode ?? enquiry?.transport_mode ?? null;
  const air = mode === "air";
  const house = air ? "HAWB" : "house B/L";
  const master = air ? "MAWB" : "master B/L";
  const blType = shipment.bl_type ?? "house";
  const hawbShown = air && blType === "house" && !shipment.direct;
  // The sea equivalent (085): our own house B/L, when we issue one.
  const hblShown = !air && blType === "house" && !shipment.direct;

  async function write(patch: Record<string, unknown>) {
    setError(null);
    try {
      await updateShipment(shipment.id, patch);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not save.");
    }
  }

  return (
    <div>
      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      {shipment.direct && (
        <p className="mb-3 flex items-start gap-2 rounded-lg bg-bg-warning px-3 py-2.5 text-[12px] text-text-warning">
          <Info size={13} className="mt-px shrink-0" />
          This shipment is marked Direct under Booking details: the carrier&rsquo;s bill goes to the
          shipper and no {house} is normally issued.
        </p>
      )}

      <section className="card p-4">
        <h2 className="text-[13px] font-medium text-text-primary">{air ? "Air waybills" : "Bills of lading"}</h2>
        <p className="mt-0.5 max-w-prose text-[11px] leading-relaxed text-text-muted">
          On a consolidation the carrier issues one {master} for the whole{" "}
          {air ? "consol" : "box"}, and we issue this shipper their own {house} under it.
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="min-w-0">
            <span className="mb-0.5 block text-[11px] text-text-secondary">Console</span>
            <Select
              label="Console"
              value={shipment.console_id ?? ""}
              options={[
                { value: "", label: "Not on a console" },
                ...consoles.map((c) => ({
                  value: c.id,
                  label: c.console_no ?? "(unnumbered)",
                  hint: [c.pol, c.pod].filter(Boolean).join(" → ") || c.mode,
                })),
              ]}
              onChange={(v) =>
                void (v ? attachToConsole(shipment.id, v) : detachFromConsole(shipment.id))
                  .then(() => reload())
                  .catch((e: unknown) =>
                    setError(e instanceof Error ? e.message : "Could not change the console.")
                  )
              }
            />
            {shipment.console_id && (
              <Link
                to="/consoles"
                className="mt-1 inline-flex items-center gap-1 text-[11px] text-text-accent hover:underline"
              >
                <Layers size={11} /> Open the console
              </Link>
            )}
          </div>

          {/*
            The job's master, which the pre-alert, tracking and the arrival
            documents read. On a console it is the console's, copied across by
            the database (082) and corrected there; off one it is typed here.
          */}
          <div className="min-w-0">
            {air || shipment.console_id ? (
              <>
                <span className="block text-[11px] capitalize text-text-secondary">{master}</span>
                <span className={`block py-1 font-mono text-[13px] ${shipment.mainline_no ? "text-text-primary" : "text-text-muted"}`}>
                  {shipment.mainline_no || "—"}
                </span>
                <span className="block text-[11px] text-text-muted">
                  {air
                    ? hawbShown
                      ? "On the HAWB below"
                      : "The airline’s"
                    : shipment.mainline_no
                      ? "The carrier’s, from the console. Corrected there."
                      : "Not recorded on the console yet"}
                </span>
              </>
            ) : (
              <>
                <NumberField
                  value={shipment.mainline_no ?? ""}
                  label="Master B/L"
                  placeholder="The carrier’s B/L number"
                  onCommit={(v) => void write({ mainline_no: v || null })}
                />
                <span className="mt-0.5 block text-[11px] text-text-muted">
                  The carrier&rsquo;s. On a console it comes from the console.
                </span>
              </>
            )}
          </div>

          <div className="min-w-0">
            <span className="block text-[11px] capitalize text-text-secondary">{house}</span>
            {shipment.bl_number ? (
              <span className="block py-1 font-mono text-[13px] text-text-primary">
                {shipment.bl_number}
              </span>
            ) : air ? (
              <span className="block py-1 text-[12px] text-text-muted">Numbered when the HAWB below is first saved</span>
            ) : hblShown ? (
              <span className="block py-1 text-[12px] text-text-muted">Numbered when the house B/L below is first saved</span>
            ) : (
              <button
                onClick={() =>
                  void issueHouseBl(shipment.id)
                    .then(() => reload())
                    .catch((e: unknown) =>
                      setError(e instanceof Error ? e.message : "Could not issue it.")
                    )
                }
                className="mt-0.5 inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-strong bg-surface-1 px-3 text-[12px] font-medium text-text-primary transition-colors hover:bg-surface-2"
              >
                <Ship size={13} />
                Issue a {house}
              </button>
            )}
            {!air && (
              <span className="mt-0.5 block text-[11px] text-text-muted">
                {shipment.bl_number
                  ? "On our own series — the house B/L below carries it"
                  : "Ours, on our own series. Needs a consignee first."}
              </span>
            )}
          </div>
        </div>

        {/* who issued the bill this cargo travels under */}
        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-border pt-3">
          <div className="flex gap-1.5">
            {(
              [
                { v: "house", label: `Our ${house}` },
                { v: "forwarder", label: `Another forwarder's ${house}` },
              ] as const
            ).map((o) => (
              <button
                key={o.v}
                onClick={() =>
                  void write({
                    bl_type: o.v,
                    // Clearing the number with the choice, so a bill switched
                    // back to ours does not keep somebody else's reference on it.
                    ...(o.v === "house" ? { forwarders_bl_no: null } : {}),
                  })
                }
                aria-pressed={blType === o.v}
                className={`h-8 rounded-lg border px-3 text-[12px] transition-colors ${
                  blType === o.v
                    ? "border-brand bg-brand font-medium text-white"
                    : "border-border bg-surface-1 text-text-secondary hover:border-border-strong hover:text-text-primary"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>

          {blType === "forwarder" && (
            <NumberField
              value={shipment.forwarders_bl_no ?? ""}
              label={`Their ${house} number`}
              onCommit={(v) => void write({ forwarders_bl_no: v || null })}
            />
          )}
        </div>
      </section>

      {hawbShown ? (
        <div className="mt-3">
          <HawbForm shipment={shipment} enquiry={enquiry} onChanged={() => void reload()} prevTab="cargo" nextTab="pickup-delivery" />
        </div>
      ) : hblShown ? (
        <div className="mt-3">
          <HblForm shipment={shipment} onChanged={() => void reload()} />
        </div>
      ) : (
        <p className="mt-3 max-w-prose text-[11px] leading-relaxed text-text-muted">
          The parties printed on the {house} are on the Party tab; the marks, HS code and packing on
          Cargo details. The draft itself is generated from the Documents tab.
        </p>
      )}
    </div>
  );
}

function NumberField({
  value,
  label,
  placeholder,
  onCommit,
}: {
  value: string;
  label: string;
  placeholder?: string;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <label className="block min-w-[14rem]">
      <span className="mb-0.5 block text-[11px] text-text-secondary">{label}</span>
      <input
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        // B/L numbers are printed and matched in capitals; typed in lower case
        // they would miss in a search and read wrong on the pre-alert.
        onBlur={() => draft.trim().toUpperCase() !== value && onCommit(draft.trim().toUpperCase())}
        className="h-8 w-full font-mono"
      />
    </label>
  );
}
