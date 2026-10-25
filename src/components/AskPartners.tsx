import { useRef, useState } from "react";
import { X } from "lucide-react";
import RateRequestForm from "./RateRequestForm";
import { useDialog } from "../lib/useDialog";
import type { BurstResult } from "../services/rfq";
import type { Enquiry } from "../services/enquiries";

/**
 * Asking partners for a rate, from the case file: the rate request form
 * (components/RateRequestForm.tsx) in a dialog. Live rates uses the same form
 * on its page, after choosing the job.
 */
export default function AskPartners({
  enquiry,
  onClose,
  onSent,
}: {
  enquiry: Enquiry;
  onClose: () => void;
  /** After every send; the dialog closes itself only when everyone was reached. */
  onSent: (result: BurstResult) => void;
}) {
  const [busy, setBusy] = useState(false);

  // Tab stays inside; Escape closes, but not while the request is going out.
  const box = useRef<HTMLDivElement>(null);
  useDialog(box, () => !busy && onClose());

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-6" onClick={() => !busy && onClose()}>
      <div
        ref={box}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[94vh] w-full flex-col rounded-t-card bg-surface-1 shadow-pop sm:card sm:max-w-3xl"
        role="dialog"
        aria-modal="true"
        aria-label="Ask partners for a rate"
      >
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="min-w-0">
            <h2 className="text-[14px] font-medium text-text-primary">Ask partners for a rate</h2>
            <p className="text-[11.5px] text-text-muted">{enquiry.ref} · each partner is written to separately, for the services you choose for them</p>
          </div>
          <button onClick={onClose} disabled={busy} className="text-text-muted hover:text-text-primary disabled:opacity-50" aria-label="Close">
            <X size={16} />
          </button>
        </header>
        <RateRequestForm
          enquiry={enquiry}
          source="case_file"
          layout="dialog"
          onBusy={setBusy}
          onCancel={onClose}
          onSent={(r) => {
            onSent(r);
            if (!r.failed.length) onClose();
          }}
        />
      </div>
    </div>
  );
}
