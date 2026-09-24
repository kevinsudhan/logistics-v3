import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, FileSpreadsheet, Loader2 } from "lucide-react";
import { useAuth } from "../lib/auth";
import { failureText } from "../lib/errorText";
import { todayIST } from "../lib/progress";
import { presetRange, type Preset } from "../lib/enquiryRegister";
import { downloadEnquiryRegister } from "../services/enquiryRegister";

/**
 * The enquiry register as an Excel report, for a period.
 *
 * Everything by default — the register the desk kept by hand was one sheet
 * of every enquiry — or this month, last month, this financial year (April
 * to March), or any two dates.
 */

const PRESETS: Array<{ value: Preset; label: string }> = [
  { value: "all", label: "All enquiries" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "fy", label: "This financial year" },
  { value: "custom", label: "Choose dates" },
];

export default function EnquiryRegisterDownload() {
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<Preset>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  /** Where the panel's left edge goes: under the button's right end, but never off the screen. */
  const [left, setLeft] = useState(0);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const b = trigger.current?.getBoundingClientRect();
      if (!b) return;
      const width = Math.min(320, window.innerWidth - 32);
      const wanted = b.right - width;
      // Relative to the button's box, clamped to a 16px gutter either side.
      setLeft(Math.min(Math.max(wanted, 16), window.innerWidth - width - 16) - b.left);
    };
    place();
    window.addEventListener("resize", place);
    const onDown = (e: MouseEvent) => root.current && !root.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  const range = preset === "custom" ? { from: from || null, to: to || null } : presetRange(preset, todayIST());
  const backwards = Boolean(range.from && range.to && range.from > range.to);

  async function download() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const n = await downloadEnquiryRegister(range.from, range.to, session?.name ?? null);
      setDone(n ? `Saved — ${n} ${n === 1 ? "enquiry" : "enquiries"}.` : "Saved — no enquiries in that period.");
    } catch (e) {
      setError(failureText(e, "Could not build the register.").message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary hover:border-border-strong hover:text-text-primary"
      >
        <FileSpreadsheet size={13} />
        Enquiry register
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Download the enquiry register"
          style={{ left }}
          className="absolute z-30 mt-1.5 w-[min(20rem,calc(100vw-2rem))] rounded-card border border-border bg-surface-1 p-3 shadow-pop"
        >
          <p className="text-[13px] font-medium text-text-primary">Enquiry register</p>
          <p className="mb-3 text-[11.5px] text-text-muted">Every enquiry in the register's columns, as an Excel report.</p>

          <div className="mb-3 flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setPreset(p.value)}
                aria-pressed={preset === p.value}
                className={`rounded-full border px-2.5 py-1 text-[11.5px] ${
                  preset === p.value ? "border-brand bg-brand text-white" : "border-border bg-surface-1 text-text-secondary hover:text-text-primary"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {preset === "custom" && (
            <div className="mb-3 grid grid-cols-2 gap-2">
              <label className="min-w-0">
                <span className="mb-1 block text-[11px] text-text-muted">From</span>
                <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="h-8 w-full" />
              </label>
              <label className="min-w-0">
                <span className="mb-1 block text-[11px] text-text-muted">To</span>
                <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="h-8 w-full" />
              </label>
            </div>
          )}

          {error && (
            <p className="mb-2 flex items-start gap-1.5 text-[11.5px] text-text-danger">
              <AlertCircle size={12} className="mt-px shrink-0" /> {error}
            </p>
          )}
          {done && (
            <p className="mb-2 flex items-start gap-1.5 text-[11.5px] text-text-success">
              <Check size={12} className="mt-px shrink-0" /> {done}
            </p>
          )}

          <button
            type="button"
            disabled={busy || backwards}
            onClick={() => void download()}
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-medium text-white hover:bg-brand-dark disabled:opacity-60"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <FileSpreadsheet size={13} />}
            {backwards ? "The start is after the end" : "Download Excel"}
          </button>
        </div>
      )}
    </div>
  );
}
