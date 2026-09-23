import { useState } from "react";
import { BellRing, Loader2 } from "lucide-react";
import ComposeMail from "./ComposeMail";
import { useAuth } from "../lib/auth";
import { shipmentUpdateHtml, shipmentUpdateSubject } from "../lib/shipmentUpdateMail";
import { checkpointsFor } from "../services/checkpoints";
import { logEvent, stageLabel, type Shipment } from "../services/enquiries";
import { isReachable } from "../services/publicQuote";
import { currentTrackLink, trackUrl } from "../services/tracking";

/**
 * Tell one party where their shipment is.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS A DRAFT, NOT A SEND
 *
 * It goes to somebody outside the company under a person's name. The compose
 * window opens with the update written from what the booking holds — status,
 * the last step done, carrier, dates — and the desk adds whatever the moment
 * needs before it goes. The same compose window every other mail uses, so the
 * signature, the attachment picker and the reference all behave the same.
 *
 * WHY IT IS LOGGED ONLY ONCE SENT
 *
 * "We told the consignee on Tuesday" is the thing somebody needs when the
 * consignee says nobody told them. It goes on the job's timeline when the mail
 * has actually gone, not when the window was opened.
 * ---------------------------------------------------------------------------
 */
export default function NotifyParty({
  shipment,
  mode,
  to,
  partyName,
  roleLabel,
}: {
  shipment: Shipment;
  mode: Shipment["transport_mode"];
  to: string | null;
  partyName: string | null;
  roleLabel: string;
}) {
  const { session } = useAuth();
  const [draft, setDraft] = useState<{ subject: string; body: string } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [sent, setSent] = useState(false);

  async function open() {
    setPreparing(true);
    try {
      // The latest step and the next one, read now rather than when the page
      // loaded: somebody may have ticked one since.
      const [steps, link] = await Promise.all([
        checkpointsFor(shipment.id).catch(() => []),
        // The customer's page, if one was issued: the update points to it.
        currentTrackLink(shipment.id).catch(() => null),
      ]);
      const url = link ? trackUrl(link.token) : null;
      const done = steps.filter((c) => c.done_at).sort((a, b) => (a.done_at! < b.done_at! ? 1 : -1));
      const next = steps.find((c) => !c.done_at);
      const input = {
        ref: shipment.enquiry_ref,
        shipmentId: shipment.id,
        partyName,
        mode,
        stage: stageLabel(shipment.stage, mode),
        origin: shipment.origin,
        destination: shipment.destination,
        carrier: shipment.carrier,
        flightNumber: shipment.flight_number,
        vessel: shipment.vessel,
        voyage: shipment.voyage,
        etd: shipment.etd,
        etdTime: shipment.etd_time,
        eta: shipment.eta,
        etaTime: shipment.eta_time,
        portOfLoading: shipment.port_of_loading,
        portOfDischarge: shipment.port_of_discharge,
        houseBill: shipment.bl_number,
        pieces: shipment.piece_count,
        grossKg: shipment.gross_weight_kg === null ? null : Number(shipment.gross_weight_kg),
        volumeCbm: shipment.volume_cbm === null ? null : Number(shipment.volume_cbm),
        latest: done[0] ? { label: done[0].label, at: done[0].done_at! } : null,
        next: next?.label ?? null,
        trackUrl: url && isReachable(url) ? url : null,
      };
      setDraft({ subject: shipmentUpdateSubject(input), body: shipmentUpdateHtml(input) });
    } finally {
      setPreparing(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          void open();
        }}
        disabled={!to || preparing}
        title={to ? `Send ${to} an update on this shipment` : "Add an email for this party first"}
        className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-2.5 text-[11.5px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary disabled:opacity-50"
      >
        {preparing ? <Loader2 size={12} className="animate-spin" /> : <BellRing size={12} />}
        {sent ? "Notified" : "Notify"}
      </button>

      {draft && to && (
        <ComposeMail
          mailbox={session?.email ?? ""}
          fromName={session?.name ?? ""}
          signature={session?.signature ?? ""}
          enquiryRef={shipment.enquiry_ref}
          reference={shipment.enquiry_ref}
          initial={{ to, subject: draft.subject, body: draft.body }}
          onClose={() => setDraft(null)}
          onSent={() => {
            setDraft(null);
            setSent(true);
            void logEvent(
              shipment.enquiry_ref,
              "party_notified",
              `Shipment update sent to ${partyName || to} (${roleLabel})`,
              { to, role: roleLabel, shipment_id: shipment.id }
            ).catch(() => {});
          }}
        />
      )}
    </>
  );
}
