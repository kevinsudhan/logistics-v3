import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, Loader2, Undo2 } from "lucide-react";
import { revertShipment } from "../services/checkpoints";
import { failureText } from "../lib/errorText";

/**
 * Sending a booking back to the enquiry it came from.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * Promotion is one press and is easy to do early: the customer said yes, the
 * booking is made, and then the ready date moves a fortnight or the shipper
 * changes the volume and there is no longer a shipment to operate. Without a
 * way back, the desk either carries a booking that is not real — on the
 * containers, on the console, in every count of what is in process — or
 * cancels it, which reads as a job that failed rather than one that has not
 * started yet.
 *
 * WHY IT ASKS FOR A REASON
 *
 * Because the enquiry it lands back on shows it, and "why is this in inbound
 * again" is the first thing anyone will ask. The server insists too, so the
 * rule holds whatever calls it.
 *
 * WHY IT IS BEHIND A CONFIRMATION AND NOT A SINGLE BUTTON
 *
 * It deletes the booking. Not a state change — the row and its follow-ups go,
 * and the reference is not reused. That is the right shape for a booking made
 * in error, and it is not something to do by misclicking a toolbar.
 *
 * It refuses outright once an invoice exists: a statutory document cannot be
 * un-raised by deleting the job under it, and the instrument for that is a
 * credit note. The message says so rather than letting a foreign key speak.
 * ---------------------------------------------------------------------------
 */
export default function RevertShipment({
  shipmentId,
  enquiryRef,
}: {
  shipmentId: string;
  enquiryRef: string;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    if (!reason.trim()) {
      setError("Say why it is going back — the enquiry will show this.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const ref = await revertShipment(shipmentId, reason.trim());
      navigate(`/enquiries/${ref}`);
    } catch (e) {
      setError(failureText(e, "Could not send it back.").message);
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
      >
        <Undo2 size={13} /> Send back to the enquiry
      </button>
    );
  }

  return (
    <div className="w-full rounded-lg border border-border-strong bg-surface-1 p-4">
      <p className="text-[13px] font-medium text-text-primary">
        Send {shipmentId} back to {enquiryRef}?
      </p>
      <p className="mt-1 max-w-prose text-[12px] text-text-secondary">
        The booking and its follow-ups are removed, and the enquiry returns to the inbound board as
        accepted and waiting to start. The customer&rsquo;s acceptance is untouched — that happened.
        The reference is not reused.
      </p>

      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Why — the enquiry will show this"
        className="mt-3 h-8 w-full"
      />

      {error && (
        <p className="mt-2 flex items-start gap-1.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void go()}
          disabled={busy}
          className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-medium text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} />}
          Send it back
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="h-8 rounded-lg border border-border px-3 text-[12px] text-text-secondary hover:text-text-primary"
        >
          Keep the booking
        </button>
      </div>
    </div>
  );
}
