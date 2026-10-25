import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, ListFilter, Loader2, Plus, Trash2, X } from "lucide-react";
import AddressInput from "./AddressInput";
import { parseAddresses } from "../lib/addresses";
import type { FolderId, MailFolder } from "../services/backend";
import { createRule, deleteRule, GraphForbiddenError, listRules, setRuleEnabled, type MailRule, type MailRuleInput } from "../services/mailRules";
import { useDialog } from "../lib/useDialog";

/**
 * Outlook's inbox rules, from the CRM: "when a message from … arrives, move it
 * to …". They are Outlook's own, kept in the mailbox and run by Microsoft as
 * mail arrives — whether or not anybody has the CRM open — and they show in
 * Outlook's Rules too.
 *
 * They need the Microsoft permission MailboxSettings.ReadWrite. Until the
 * organisation has granted it, this says so and what to do, and nothing else
 * in Mail is affected (graphMail's rules calls are soft on 403).
 */
const words = (s: string) =>
  s
    .split(/[,;\n]/)
    .map((w) => w.trim())
    .filter(Boolean);

const EMPTY = {
  name: "",
  from: "",
  subject: "",
  anywhere: "",
  hasAttachments: false,
  moveTo: "" as FolderId | "",
  markAsRead: false,
  markImportant: false,
  deleteIt: false,
  stop: true,
};

export default function RulesDialog({ mailbox, folders, onClose }: { mailbox: string; folders: MailFolder[]; onClose: () => void }) {
  const [rules, setRules] = useState<MailRule[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<typeof EMPTY | null>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef(form);
  formRef.current = form;

  const load = useCallback(() => {
    setError(null);
    listRules(mailbox)
      .then((r) => {
        setRules(r);
        setForbidden(false);
      })
      .catch((e) => {
        if (e instanceof GraphForbiddenError) setForbidden(true);
        else setError(e instanceof Error ? e.message : "Could not read the rules.");
        setRules([]);
      });
  }, [mailbox]);

  useEffect(() => load(), [load]);

  const requestClose = useCallback(() => {
    const f = formRef.current;
    const started = f && JSON.stringify(f) !== JSON.stringify(EMPTY);
    if (started && !window.confirm("Discard this rule?")) return;
    onClose();
  }, [onClose]);
  // Tab stays inside and focus goes back on closing; Escape stays this dialog's own, below.
  const panel = useRef<HTMLDivElement>(null);
  useDialog(panel, undefined, { escape: false });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose]);

  const label = (id: FolderId | null) => (id ? folders.find((f) => f.id === id)?.label ?? "a folder" : "");
  const summary = (r: MailRule) => {
    const when = [
      r.fromAddresses.length ? `from ${r.fromAddresses.join(", ")}` : "",
      r.subjectContains.length ? `subject has "${r.subjectContains.join('", "')}"` : "",
      r.bodyOrSubjectContains.length ? `mentions "${r.bodyOrSubjectContains.join('", "')}"` : "",
      r.hasAttachments ? "has an attachment" : "",
    ].filter(Boolean);
    const then = [
      r.moveToFolder ? `move to ${label(r.moveToFolder)}` : "",
      r.markAsRead ? "mark read" : "",
      r.markImportant ? "mark important" : "",
      r.deleteIt ? "delete" : "",
    ].filter(Boolean);
    return `${when.length ? when.join(" and ") : "any message"} → ${then.join(", ") || "nothing"}`;
  };

  async function save() {
    if (!form) return;
    const input: MailRuleInput = {
      displayName: form.name.trim(),
      isEnabled: true,
      fromAddresses: parseAddresses(form.from),
      subjectContains: words(form.subject),
      bodyOrSubjectContains: words(form.anywhere),
      hasAttachments: form.hasAttachments,
      moveToFolder: form.moveTo || null,
      markAsRead: form.markAsRead,
      markImportant: form.markImportant,
      deleteIt: form.deleteIt,
      stopProcessingRules: form.stop,
    };
    if (!input.displayName) return setError("Give the rule a name.");
    if (!input.fromAddresses.length && !input.subjectContains.length && !input.bodyOrSubjectContains.length && !input.hasAttachments)
      return setError("Say which messages it is for: a sender, words in the subject, or words anywhere.");
    if (!input.moveToFolder && !input.markAsRead && !input.markImportant && !input.deleteIt) return setError("Say what to do with them.");
    const bad = input.fromAddresses.find((a) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a));
    if (bad) return setError(`"${bad}" is not an email address.`);
    setBusy(true);
    setError(null);
    try {
      await createRule(mailbox, input);
      setForm(null);
      load();
    } catch (e) {
      if (e instanceof GraphForbiddenError) setForbidden(true);
      else setError(e instanceof Error ? e.message : "Could not save the rule.");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(r: MailRule) {
    setRules((prev) => prev?.map((x) => (x.id === r.id ? { ...x, isEnabled: !r.isEnabled } : x)) ?? prev);
    try {
      await setRuleEnabled(r.id, !r.isEnabled);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change the rule.");
      load();
    }
  }

  async function remove(r: MailRule) {
    if (!window.confirm(`Delete the rule "${r.displayName}"? Mail it already moved stays where it is.`)) return;
    try {
      await deleteRule(r.id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the rule.");
    }
  }

  const targets = folders.filter((f) => !["inbox", "sent", "drafts", "deleted"].includes(f.id));
  const set = (patch: Partial<typeof EMPTY>) => setForm((f) => (f ? { ...f, ...patch } : f));

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-6" onClick={requestClose}>
      <div ref={panel} className="flex max-h-[92vh] w-full flex-col rounded-t-card bg-surface-1 shadow-xl sm:card sm:max-w-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Rules">
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="flex items-center gap-2 text-[14px] font-medium text-text-primary">
            <ListFilter size={15} /> Rules
          </h2>
          <button onClick={requestClose} className="text-text-muted hover:text-text-primary" aria-label="Close">
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="mb-3 text-[12px] text-text-secondary">
            Outlook's own rules: they run as mail arrives, even when the CRM is closed, and they show in Outlook too.
          </p>

          {error && (
            <div role="alert" className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
              <AlertCircle size={13} className="mt-px shrink-0" />
              {error}
            </div>
          )}

          {rules === null ? (
            <p className="flex items-center gap-2 py-6 text-[12.5px] text-text-muted">
              <Loader2 size={13} className="animate-spin" /> Reading the rules…
            </p>
          ) : forbidden ? (
            <div className="rounded-lg border border-border bg-bg-warning px-4 py-3 text-[12.5px] leading-relaxed text-text-warning">
              <p className="font-medium">Rules need one more Microsoft permission.</p>
              <p className="mt-1">
                The CRM can read and send mail, but Microsoft keeps rules under mailbox settings. Your Microsoft 365 administrator grants
                it once, for everyone: Azure portal → App registrations → the CRM's app → API permissions → Add a permission → Microsoft
                Graph → Delegated → <strong className="font-medium">MailboxSettings.ReadWrite</strong> → Grant admin consent. The CRM then
                needs a small update to ask for it.
              </p>
              <p className="mt-2">Rules already set up in Outlook keep working meanwhile.</p>
            </div>
          ) : (
            <>
              {rules.length === 0 && !form && <p className="py-3 text-[12.5px] text-text-muted">No rules yet.</p>}
              <ul className="divide-y divide-border">
                {rules.map((r) => (
                  <li key={r.id} className="flex items-start gap-3 py-2.5">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={r.isEnabled}
                      onClick={() => void toggle(r)}
                      title={r.isEnabled ? "On — turn off" : "Off — turn on"}
                      className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${r.isEnabled ? "bg-brand" : "bg-border-strong"}`}
                    >
                      <span className={`size-4 rounded-full bg-white shadow transition-transform ${r.isEnabled ? "translate-x-4" : ""}`} />
                    </button>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-[13px] ${r.isEnabled ? "text-text-primary" : "text-text-muted"}`}>{r.displayName}</span>
                      <span className="block break-words text-[11.5px] text-text-secondary">{summary(r)}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => void remove(r)}
                      aria-label={`Delete the rule ${r.displayName}`}
                      title="Delete the rule"
                      className="rounded p-1 text-text-muted hover:bg-surface-2 hover:text-text-danger"
                    >
                      <Trash2 size={13} />
                    </button>
                  </li>
                ))}
              </ul>

              {form ? (
                <div className="mt-3 rounded-xl border border-border p-3.5">
                  <label className="block text-[11.5px] text-text-secondary">
                    Name
                    <input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. MSC rate sheets to Rates" className="mt-1 h-8 w-full" autoFocus />
                  </label>

                  <p className="mt-3 text-[11px] font-medium uppercase tracking-wide text-text-muted">When a message arrives that…</p>
                  <div className="mt-1 space-y-2">
                    <label className="block text-[11.5px] text-text-secondary">
                      is from
                      <div className="mt-1">
                        <AddressInput value={form.from} onChange={(v) => set({ from: v })} label="From" placeholder="Names or addresses" />
                      </div>
                    </label>
                    <label className="block text-[11.5px] text-text-secondary">
                      has in the subject
                      <input value={form.subject} onChange={(e) => set({ subject: e.target.value })} placeholder="Words, comma separated" className="mt-1 h-8 w-full" />
                    </label>
                    <label className="block text-[11.5px] text-text-secondary">
                      has in the subject or body
                      <input value={form.anywhere} onChange={(e) => set({ anywhere: e.target.value })} placeholder="Words, comma separated" className="mt-1 h-8 w-full" />
                    </label>
                    <Check label="has an attachment" on={form.hasAttachments} onChange={(v) => set({ hasAttachments: v })} />
                  </div>

                  <p className="mt-3 text-[11px] font-medium uppercase tracking-wide text-text-muted">Do this</p>
                  <div className="mt-1 space-y-2">
                    <label className="block text-[11.5px] text-text-secondary">
                      Move it to
                      <select value={form.moveTo} onChange={(e) => set({ moveTo: e.target.value as FolderId | "" })} className="mt-1 h-8 w-full">
                        <option value="">— leave it in the Inbox —</option>
                        {targets.map((f) => (
                          <option key={f.id} value={f.id}>
                            {(f.depth ? "  " : "") + f.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Check label="Mark it read" on={form.markAsRead} onChange={(v) => set({ markAsRead: v })} />
                    <Check label="Mark it important" on={form.markImportant} onChange={(v) => set({ markImportant: v })} />
                    <Check label="Delete it (to Deleted Items)" on={form.deleteIt} onChange={(v) => set({ deleteIt: v })} />
                    <Check label="Stop there: no other rule runs on it" on={form.stop} onChange={(v) => set({ stop: v })} />
                  </div>

                  <div className="mt-3 flex justify-end gap-2">
                    <button type="button" onClick={() => setForm(null)} className="h-8 rounded-lg border border-border px-3 text-[12px] text-text-secondary hover:text-text-primary">
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void save()}
                      disabled={busy}
                      className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-[12px] font-medium text-white hover:bg-brand-dark disabled:opacity-60"
                    >
                      {busy && <Loader2 size={13} className="animate-spin" />}
                      Save rule
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setForm({ ...EMPTY })}
                  className="mt-3 flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] text-text-secondary hover:border-border-strong hover:text-text-primary"
                >
                  <Plus size={13} /> New rule
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Check({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-[12.5px] text-text-primary">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} className="size-4" />
      {label}
    </label>
  );
}
