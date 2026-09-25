import { useEffect, useState } from "react";
import { AlertCircle, Check, Loader2, X } from "lucide-react";
import RichTextEditor from "./RichTextEditor";

/**
 * The sender's email signature.
 *
 * Microsoft Graph does not expose the signature configured in Outlook -- it
 * lives in OWA's own settings rather than the mail API -- so the CRM keeps its
 * own copy, pasted in once per person. Saved to the user's profile row, so it
 * follows them to any machine they sign in on rather than living in this
 * browser.
 */
export default function SignatureEditor({
  initial,
  onSave,
  onClose,
}: {
  initial: string;
  onSave: (signature: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save() {
    setBusy(true);
    setError(null);
    const message = await onSave(text);
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }
    // Confirm rather than closing instantly, so it is clear the save happened.
    setSaved(true);
    setTimeout(onClose, 700);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg card shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Email signature"
      >
        <header className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="text-[14px] font-medium text-text-primary">Email signature</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary" aria-label="Close">
            <X size={16} />
          </button>
        </header>

        <div className="px-5 py-4">
          <p className="text-[12px] text-text-secondary mb-3">
            Build the signature you want on outgoing mail. Select text and use the link
            button to make it clickable — an email address becomes a mailto link, so
            recipients can click it to start a message to you.
          </p>

          <RichTextEditor
            value={text}
            onChange={setText}
            imageMax={220}
            autoFocus
            minHeight={200}
            placeholder="Regards, your name, company, phone…"
          />

          {error && (
            <div
              role="alert"
              className="mt-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger"
            >
              <AlertCircle size={13} className="mt-px shrink-0" />
              {error}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 px-5 py-3 border-t border-border">
          <p className="text-[11px] text-text-muted">
            Images are uploaded and linked, so they display in the recipient's mail client.
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="h-8 px-3 rounded-lg border border-border text-[12px] text-text-secondary hover:text-text-primary"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={busy || saved}
              className="flex items-center gap-1.5 h-8 px-3.5 rounded-lg bg-brand hover:bg-brand-dark disabled:opacity-60 text-white text-[12px] font-medium"
            >
              {busy ? (
                <Loader2 size={13} className="animate-spin" />
              ) : saved ? (
                <Check size={13} />
              ) : null}
              {busy ? "Saving…" : saved ? "Saved" : "Save"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
