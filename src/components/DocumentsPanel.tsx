import { useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  FileDown,
  FilePen,
} from "lucide-react";
import {
  documentStatuses,
  generateDocument,
  viewDocument,
  type DocumentData,
} from "../lib/documents";

/**
 * Every document the desk can issue for this customer, with what each one is still
 * waiting for.
 *
 * Listed in shipment order rather than alphabetically, because that is the order they get
 * produced in and the list doubles as a progress view: how far down it you can go before
 * things stop being issuable is exactly how far the booking has actually got.
 *
 * Nothing is hidden and nothing is disabled. A document that cannot be issued yet still
 * generates as a stamped draft naming its gaps — that draft is what the desk sends the
 * customer to chase the missing details, so refusing to produce it would remove the tool
 * that closes the gap.
 */
export default function DocumentsPanel({
  data,
  defaultOpen = false,
  onFillDetails,
}: {
  data: DocumentData;
  /** Open on a shipment page, where documents are the point; collapsed in a list row. */
  defaultOpen?: boolean;
  /**
   * Opens the form for the fields the drafts are waiting on.
   *
   * Optional because not every caller has one — the enquiry-side panel reads a
   * record whose fields live somewhere else entirely. Where it is absent the
   * list still says what is missing; it just cannot offer to fix it here.
   */
  onFillDetails?: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  /** Which document a popup blocker swallowed, so the button can explain itself. */
  const [blocked, setBlocked] = useState<string | null>(null);
  const statuses = documentStatuses(data);
  const readyCount = statuses.filter((s) => s.ready).length;

  return (
    <div className="mt-4 border-t border-border pt-3">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 text-left"
      >
        {open ? <ChevronDown size={13} className="text-text-muted" /> : <ChevronRight size={13} className="text-text-muted" />}
        <span className="text-[11px] font-medium uppercase tracking-wide text-text-secondary">
          Documents
        </span>
        <span className="text-[11px] text-text-muted">
          {readyCount} of {statuses.length} ready to issue
        </span>
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {/* One route to the fields, above the list rather than repeated on
              every draft row — it is the same form whichever document sent you
              looking for it. */}
          {onFillDetails && readyCount < statuses.length && (
            <button
              onClick={onFillDetails}
              className="mb-2 inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-2.5 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
            >
              <FilePen size={12} />
              Fill in the missing details
            </button>
          )}
          {statuses.map(({ spec, ready, missingLabels, have, need }) => (
            /*
              A card each, the same as every other list on this desk.

              They were thin rows a line and a half tall, separated by a hairline
              and distinguished only by whether that hairline was dashed. Twelve
              of them read as one block of text, and the thing you are actually
              scanning for — which of these can be issued — was carried by the
              border style, which is the least visible property on the row.

              Not ready keeps the dashed border, because that reads as "not
              finished" everywhere else here, but it is now a dashed card rather
              than a dashed line.
            */
            <div
              key={spec.id}
              className={`flex items-start gap-3 p-4 ${
                ready
                  ? "card"
                  : "rounded-card border border-dashed border-border-strong bg-surface-1"
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[13px] font-medium text-text-primary">
                    {spec.shortName}
                  </span>
                  {ready ? (
                    <Check size={12} className="text-text-success shrink-0" />
                  ) : (
                    <AlertTriangle size={12} className="text-text-warning shrink-0" />
                  )}
                </div>
                <p className="mt-0.5 text-[12px] text-text-secondary">{spec.purpose}</p>
                {!ready && (
                  <p className="mt-1 text-[12px] text-text-warning">
                    {have} of {need} — needs: {missingLabels.join(", ")}
                  </p>
                )}
                {blocked === spec.id && (
                  <p className="mt-1 text-[12px] text-text-danger">
                    Your browser blocked the new tab. Allow pop-ups for this site, or use Generate.
                  </p>
                )}
              </div>

              {/* Reading and keeping are different acts. View opens it; Generate
                  puts a copy on the machine. Most checks want the first. */}
              <button
                onClick={() => {
                  if (!viewDocument(spec, data)) setBlocked(spec.id);
                }}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
              >
                <Eye size={13} />
                View
              </button>

              <button
                onClick={() => generateDocument(spec, data)}
                className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[12px] font-medium transition-colors ${
                  ready
                    ? "bg-brand text-white hover:bg-brand-dark"
                    : "border border-border text-text-secondary hover:border-border-strong hover:text-text-primary"
                }`}
              >
                <FileDown size={13} />
                {ready ? "Generate" : "Draft"}
              </button>
            </div>
          ))}

          <p className="pt-1 text-[11px] leading-relaxed text-text-muted">
            Drafts print every unestablished field as TBD and name what is outstanding on
            the document itself. Nothing is inferred from a similar shipment.
          </p>
        </div>
      )}
    </div>
  );
}
