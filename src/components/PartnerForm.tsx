import { useEffect, useState } from "react";
import { AlertCircle, Loader2, Plus, X } from "lucide-react";
import Select from "./Select";
import {
  createPartner,
  updatePartner,
  cleanTags,
  PARTNER_ROLES,
  PARTNER_ROLE_LABEL,
  type Partner,
  type PartnerRole,
} from "../services/partners";

/**
 * Add or edit one partner.
 *
 * The same form for both, because an edit is a create with the fields already
 * filled -- splitting them would duplicate the validation and the tag editor
 * for no gain.
 */
export default function PartnerForm({
  partner,
  suggestions,
  onClose,
  onSaved,
  inline = false,
}: {
  /** Absent when adding. */
  partner?: Partner;
  /** Tags already in use, so the same idea is not spelled three ways. */
  suggestions: string[];
  onClose: () => void;
  onSaved: () => void;
  /**
   * Rendered as a panel on a page rather than as a dialog over one.
   *
   * A dialog dismisses on a click outside it and on Escape, which is right when
   * it is floating over something you were already looking at. On a page of its
   * own there is no "outside" — the backdrop is the whole screen — so the same
   * behaviour means one stray click throws away a half-typed partner. Inline
   * drops the backdrop and the Escape key; Cancel is then the only way out,
   * which on a page is the only one that should exist.
   */
  inline?: boolean;
}) {
  const [name, setName] = useState(partner?.name ?? "");
  const [organisation, setOrganisation] = useState(partner?.organisation ?? "");
  const [role, setRole] = useState<PartnerRole>(partner?.role ?? "overseas_agent");
  const [emails, setEmails] = useState((partner?.emails ?? []).join(", "));
  const [phones, setPhones] = useState((partner?.phones ?? []).join(", "));
  const [tags, setTags] = useState<string[]>(partner?.tags ?? []);
  const [draftTag, setDraftTag] = useState("");
  const [notes, setNotes] = useState(partner?.notes ?? "");
  const [address, setAddress] = useState(partner?.address ?? "");
  const [mto, setMto] = useState(partner?.mto_registration ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Whether anything has been typed.
   *
   * A dialog that dismisses on a click outside it is right for one you are
   * only reading. Once there is work in it, the same click is a way to lose
   * that work silently — you meant to click the panel, you missed by ten
   * pixels, and the contact you were halfway through entering is gone with no
   * undo. Cancel and Escape still close it; they are deliberate.
   */
  const dirty =
    name.trim() !== "" ||
    organisation.trim() !== "" ||
    emails.trim() !== "" ||
    phones.trim() !== "" ||
    notes.trim() !== "" ||
    address.trim() !== "" ||
    mto.trim() !== "" ||
    draftTag.trim() !== "" ||
    tags.length > 0;

  useEffect(() => {
    if (inline) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, inline]);

  const list = (s: string) =>
    s
      .split(/[,;]/)
      .map((x) => x.trim())
      .filter(Boolean);

  function addTag(raw: string) {
    const t = raw.trim().replace(/,$/, "");
    if (!t) return;
    setTags((prev) => cleanTags([...prev, t]));
    setDraftTag("");
  }

  const unusedSuggestions = suggestions.filter(
    (s) => !tags.some((t) => t.toLowerCase() === s.toLowerCase())
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim() && !organisation.trim())
      return setError("Give at least a contact name or a company.");

    const emailList = list(emails);
    const bad = emailList.find((a) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a));
    if (bad) return setError(`"${bad}" is not a valid email address.`);

    setBusy(true);
    try {
      // The draft tag is committed on save too. Somebody who types a tag and
      // hits Save without pressing Enter means to keep it.
      const finalTags = draftTag.trim() ? cleanTags([...tags, draftTag]) : tags;
      const body = {
        name: name.trim(),
        organisation: organisation.trim(),
        role,
        emails: emailList,
        phones: list(phones),
        tags: finalTags,
        notes: notes.trim(),
        address: address.trim(),
        mto_registration: mto.trim().toUpperCase(),
      };
      if (partner) await updatePartner(partner.id, body);
      else await createPartner(body);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the partner.");
      setBusy(false);
    }
  }

  return (
    <div
      className={
        inline
          ? ""
          : "fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 p-0 sm:p-6"
      }
      // No backdrop to dismiss on when inline: the click target would be the
      // whole page. And even as a dialog, it stops dismissing once there is
      // something typed — same reason, smaller target.
      onClick={inline || dirty ? undefined : onClose}
    >
      <div
        className={
          inline
            ? "card max-w-2xl flex flex-col"
            : "w-full sm:max-w-lg rounded-t-card sm:card shadow-xl max-h-[92vh] flex flex-col"
        }
        onClick={inline ? undefined : (e) => e.stopPropagation()}
        role={inline ? "group" : "dialog"}
        aria-label={partner ? "Edit partner" : "Add partner"}
      >
        <header className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="text-[14px] font-medium text-text-primary">
            {partner ? "Edit partner" : "Add partner"}
          </h2>
          {/* The close cross belongs to a dialog. On a page, Cancel in the
              footer is the way back and a second one would be clutter. */}
          {!inline && (
            <button onClick={onClose} className="text-text-muted hover:text-text-primary" aria-label="Close">
              <X size={16} />
            </button>
          )}
        </header>

        <form onSubmit={submit} className="flex-1 overflow-y-auto px-5 py-4 space-y-3" noValidate>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Company">
              <input
                value={organisation}
                onChange={(e) => setOrganisation(e.target.value)}
                placeholder="Pacific Consolidators Pte"
                className="w-full h-8"
              />
            </Field>
            <Field label="Contact name">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Wei Ling"
                className="w-full h-8"
              />
            </Field>
          </div>

          <Field label="They are our">
            <Select
              label="They are our"
              value={role}
              onChange={(v) => setRole(v as PartnerRole)}
              options={PARTNER_ROLES.map((r) => ({ value: r, label: PARTNER_ROLE_LABEL[r] }))}
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Email">
              <input
                value={emails}
                onChange={(e) => setEmails(e.target.value)}
                placeholder="ops@company.com"
                className="w-full h-8"
                autoComplete="off"
              />
            </Field>
            <Field label="Phone">
              <input
                value={phones}
                onChange={(e) => setPhones(e.target.value)}
                placeholder="+65 6123 4567"
                className="w-full h-8"
                autoComplete="off"
              />
            </Field>
          </div>
          <p className="text-[11px] text-text-muted -mt-1">
            More than one? Separate them with commas.
          </p>

          <Field label="Address">
            <textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              rows={2}
              placeholder="Printed in the delivery agent box of a house B/L"
              className="w-full"
            />
          </Field>

          <Field label="MTO registration">
            <input
              value={mto}
              onChange={(e) => setMto(e.target.value)}
              placeholder="MTO/DGS/1234/2025 — only if we issue house B/Ls under theirs"
              className="w-full h-8 font-mono"
              autoComplete="off"
            />
          </Field>

          {/* ---- tags ---- */}
          <Field label="Tags">
            <div className="rounded-lg border border-border bg-surface-1 p-2">
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 rounded-full bg-bg-accent px-2 py-0.5 text-[11px] text-text-accent"
                  >
                    {t}
                    <button
                      type="button"
                      onClick={() => setTags(tags.filter((x) => x !== t))}
                      className="hover:text-text-primary"
                      aria-label={`Remove ${t}`}
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
                <input
                  value={draftTag}
                  onChange={(e) => {
                    // A comma is how people end a tag when typing quickly.
                    if (e.target.value.endsWith(",")) addTag(e.target.value);
                    else setDraftTag(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTag(draftTag);
                    } else if (e.key === "Backspace" && !draftTag && tags.length) {
                      setTags(tags.slice(0, -1));
                    }
                  }}
                  placeholder={tags.length ? "" : "textiles, Singapore, LCL…"}
                  className="flex-1 min-w-[120px] !h-6 !border-0 !bg-transparent !px-1 text-[12px]"
                  autoComplete="off"
                />
              </div>
            </div>
          </Field>
          <p className="text-[11px] text-text-muted -mt-1">
            What they are good for — a lane, a cargo, a service. This is what matches them to an
            enquiry, so write them the way the cargo gets described.
          </p>

          {unusedSuggestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {unusedSuggestions.slice(0, 12).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => addTag(s)}
                  className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-text-secondary hover:text-text-primary hover:border-border-strong"
                >
                  <Plus size={9} />
                  {s}
                </button>
              ))}
            </div>
          )}

          <Field label="Notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Anything the next person should know before using them."
              className="w-full"
            />
          </Field>

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger"
            >
              <AlertCircle size={13} className="mt-px shrink-0" />
              {error}
            </div>
          )}
        </form>

        <footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            className="h-8 px-3 rounded-lg border border-border text-[12px] text-text-secondary hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="flex items-center gap-1.5 h-8 px-3.5 rounded-lg bg-brand hover:bg-brand-dark disabled:opacity-60 text-white text-[12px] font-medium"
          >
            {busy && <Loader2 size={13} className="animate-spin" />}
            {partner ? "Save changes" : "Add partner"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] text-text-secondary mb-1">{label}</span>
      {children}
    </label>
  );
}
