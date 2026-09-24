import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, Handshake, Loader2, Mail, Phone, Plus, Sparkles, X } from "lucide-react";
import {
  assignPartner,
  assignmentsFor,
  listPartners,
  suggestPartners,
  unassignPartner,
  PARTNER_ROLES,
  PARTNER_ROLE_LABEL,
  type Assignment,
  type Partner,
  type PartnerRole,
} from "../services/partners";
import type { Enquiry } from "../services/enquiries";
import PartnerForm from "./PartnerForm";
import { SectionSkeleton } from "./Loading";

/**
 * Who is working this shipment with us.
 *
 * ---------------------------------------------------------------------------
 * WHY SUGGESTIONS COME WITH REASONS
 *
 * A ranked list nobody can interrogate gets ignored the first time it is wrong.
 * Each suggestion shows which of the partner's tags matched, and what it
 * matched against -- "textiles → cargo", "Singapore → destination" -- so the
 * desk can disagree with the ranking rather than the software.
 *
 * The manual picker is not a fallback for when matching fails. It is the normal
 * path for everything the tags cannot know: who owes us a favour, who is short
 * of space this week, who the customer has asked for by name.
 * ---------------------------------------------------------------------------
 */
export default function PartnersPanel({
  enquiry,
  onChanged,
}: {
  enquiry: Enquiry;
  /** So the case file can refresh its parties and timeline after an assignment. */
  onChanged: () => void;
}) {
  const [assigned, setAssigned] = useState<Array<Assignment & { partner: Partner }>>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  /** The new-partner form, opened from inside the picker. */
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  /** Which kind of partner is being looked for. Null means all of them. */
  const [pickRole, setPickRole] = useState<PartnerRole | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, p] = await Promise.all([assignmentsFor(enquiry.ref), listPartners()]);
      setAssigned(a);
      setPartners(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load partners.");
    } finally {
      setLoading(false);
    }
  }, [enquiry.ref]);

  useEffect(() => {
    void load();
  }, [load]);

  const assignedIds = useMemo(() => new Set(assigned.map((a) => a.partner_id)), [assigned]);

  /** Top matches, minus anyone already on the shipment. */
  const suggestions = useMemo(
    () => suggestPartners(enquiry, partners).filter((s) => !assignedIds.has(s.partner.id)).slice(0, 4),
    [enquiry, partners, assignedIds]
  );

  /** Everyone not already on this shipment — the pool the picker draws from. */
  const available = useMemo(
    () => partners.filter((p) => !assignedIds.has(p.id)),
    [partners, assignedIds]
  );

  /**
   * Tags already in use, offered to the new-partner form.
   *
   * Drawn from the partners already loaded rather than fetched again: the tags
   * are what makes a partner findable later, and offering the existing ones is
   * how "Jebel Ali" stays one tag instead of becoming three spellings.
   */
  const tagsInUse = useMemo(
    () => [...new Set(partners.flatMap((p) => p.tags))].sort(),
    [partners]
  );

  /**
   * How many of each kind are left to choose from.
   *
   * Shown on the chips so a role with nobody behind it is visibly empty rather
   * than a button that opens an empty list.
   */
  const roleCounts = useMemo(() => {
    const c: Record<string, number> = { all: available.length };
    for (const r of PARTNER_ROLES) c[r] = available.filter((p) => p.role === r).length;
    return c;
  }, [available]);

  const pickable = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return available
      .filter((p) => !pickRole || p.role === pickRole)
      .filter((p) =>
        !needle
          ? true
          : [p.organisation, p.name, ...p.tags, ...p.emails]
              .filter(Boolean)
              .some((v) => String(v).toLowerCase().includes(needle))
      )
      .slice(0, 30);
  }, [available, pickRole, query]);

  async function assign(p: Partner) {
    setBusy(p.id);
    setError(null);
    try {
      await assignPartner(enquiry.ref, p.id);
      setPicking(false);
      setQuery("");
      setPickRole(null);
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not assign that partner.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(partnerId: string) {
    setBusy(partnerId);
    setError(null);
    try {
      await unassignPartner(enquiry.ref, partnerId);
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove that partner.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mt-4 card p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
          <Handshake size={12} /> Partners on this shipment
        </h2>
        <button
          onClick={() => setPicking((v) => !v)}
          className="flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-border text-[12px] text-text-secondary hover:text-text-primary"
        >
          <Plus size={12} />
          Assign manually
        </button>
      </div>

      {loading ? (
        <SectionSkeleton lines={2} className="py-1" />
      ) : (
        <>
          {/* ---- already on it ---- */}
          {assigned.length > 0 ? (
            <ul className="space-y-2">
              {assigned.map((a) => (
                <li
                  key={a.id}
                  className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-[13px] text-text-primary">
                      {a.partner.organisation || a.partner.name}
                      <span className="ml-2 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-text-secondary">
                        {PARTNER_ROLE_LABEL[a.role]}
                      </span>
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-text-secondary">
                      {a.partner.name && a.partner.organisation && <span>{a.partner.name}</span>}
                      {a.partner.emails.map((e) => (
                        <a key={e} href={`mailto:${e}`} className="inline-flex items-center gap-1 hover:text-text-primary">
                          <Mail size={11} />
                          {e}
                        </a>
                      ))}
                      {a.partner.phones.map((n) => (
                        <a key={n} href={`tel:${n}`} className="inline-flex items-center gap-1 hover:text-text-primary">
                          <Phone size={11} />
                          {n}
                        </a>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() => void remove(a.partner_id)}
                    disabled={busy !== null}
                    className="shrink-0 text-text-muted hover:text-text-danger disabled:opacity-60"
                    aria-label={`Remove ${a.partner.organisation || a.partner.name}`}
                    title="Take them off this shipment"
                  >
                    {busy === a.partner_id ? <Loader2 size={13} className="animate-spin" /> : <X size={14} />}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] text-text-muted">
              Nobody assigned yet.{" "}
              {suggestions.length > 0
                ? "The matches below come from the tags on each partner."
                : "Add tags to your partners and matching ones will appear here."}
            </p>
          )}

          {/* ---- suggested by tag ---- */}
          {suggestions.length > 0 && (
            <div className="mt-4">
              <h3 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-text-secondary mb-2">
                <Sparkles size={11} /> Suggested for this cargo and lane
              </h3>
              <ul className="space-y-2">
                {suggestions.map((s) => (
                  <li
                    key={s.partner.id}
                    className="flex items-start justify-between gap-3 rounded-lg border border-dashed border-border-strong px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-[13px] text-text-primary">
                        {s.partner.organisation || s.partner.name}
                        <span className="ml-2 text-[11px] text-text-secondary">
                          {PARTNER_ROLE_LABEL[s.partner.role]}
                        </span>
                      </p>
                      {/* The whole reason to trust the ordering. */}
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {s.reasons.map((r) => (
                          <span
                            key={`${r.tag}-${r.because}`}
                            className="rounded-full bg-bg-accent px-2 py-0.5 text-[11px] text-text-accent"
                          >
                            {r.tag} <span className="opacity-70">· {r.because}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                    <button
                      onClick={() => void assign(s.partner)}
                      disabled={busy !== null}
                      className="shrink-0 flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-brand hover:bg-brand-dark disabled:opacity-60 text-white text-[12px] font-medium"
                    >
                      {busy === s.partner.id ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Plus size={12} />
                      )}
                      Assign
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ---- manual: pick the kind of partner, then the partner ---- */}
          {picking && (
            <div className="mt-4 rounded-lg border border-border p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-[11px] font-medium uppercase tracking-wide text-text-secondary">
                  Assign partners
                </h3>
                {/*
                  Adding somebody who is not on the list yet, without leaving
                  the enquiry. The partner list is the pool this picker draws
                  from, so the moment a new agent is needed the only way through
                  used to be: open Partners in another tab, add them, come back,
                  reopen this. The work is here; the form should be too.
                */}
                <button
                  onClick={() => setCreating(true)}
                  className="inline-flex items-center gap-1 text-[12px] text-text-accent hover:underline"
                >
                  <Plus size={12} />
                  New partner
                </button>
              </div>

              {/*
                The type comes first because that is how the desk thinks about
                it -- you go looking for a CHA, not for a name. Counts are on
                the chips so an empty category is visible before it is opened.
              */}
              <div className="flex flex-wrap items-center gap-1.5 mb-3">
                <RoleChip active={pickRole === null} onClick={() => setPickRole(null)}>
                  Anyone <span className="opacity-60">{roleCounts.all}</span>
                </RoleChip>
                {PARTNER_ROLES.map((r) => (
                  <RoleChip
                    key={r}
                    active={pickRole === r}
                    disabled={!roleCounts[r]}
                    onClick={() => setPickRole(pickRole === r ? null : r)}
                  >
                    {PARTNER_ROLE_LABEL[r]} <span className="opacity-60">{roleCounts[r] ?? 0}</span>
                  </RoleChip>
                ))}
              </div>

              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={
                  pickRole
                    ? // No plural 's': the labels already read as categories,
                      // and "CHA / customss" is what appending one produces.
                      `Search within ${PARTNER_ROLE_LABEL[pickRole]} — company, contact, tag…`
                    : "Search every partner — company, contact, tag…"
                }
                className="w-full h-8 mb-2"
                autoFocus
              />
              {!partners.length ? (
                <p className="text-[12px] text-text-muted">
                  No partners on file yet —{" "}
                  <Link to="/partners" className="text-text-accent hover:underline">
                    add some first
                  </Link>
                  .
                </p>
              ) : !pickable.length ? (
                <p className="text-[12px] text-text-muted">
                  {pickRole && !query.trim()
                    ? `Nobody on file under ${PARTNER_ROLE_LABEL[pickRole]}.`
                    : "Nothing matches that."}
                </p>
              ) : (
                <ul className="max-h-64 overflow-y-auto divide-y divide-border">
                  {pickable.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 py-1.5">
                      <div className="min-w-0">
                        <p className="text-[13px] text-text-primary truncate">
                          {p.organisation || p.name}
                          <span className="ml-2 text-[11px] text-text-secondary">
                            {PARTNER_ROLE_LABEL[p.role]}
                          </span>
                        </p>
                        {p.tags.length > 0 && (
                          <p className="text-[11px] text-text-muted truncate">{p.tags.join(" · ")}</p>
                        )}
                      </div>
                      <button
                        onClick={() => void assign(p)}
                        disabled={busy !== null}
                        className="shrink-0 h-7 px-2.5 rounded-lg border border-border-strong text-[12px] font-medium text-text-primary hover:bg-surface-2 disabled:opacity-60"
                      >
                        {busy === p.id ? <Loader2 size={12} className="animate-spin" /> : "Assign"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      {/*
        The same form the Partners page uses, not a cut-down copy. A second
        abbreviated form here would be the one that forgets a field, and the
        two would drift.

        Reloading afterwards puts the new partner into `partners`, so the
        picker below is already showing them by the time the form closes.
      */}
      {creating && (
        <PartnerForm
          suggestions={tagsInUse}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            void load();
          }}
        />
      )}
    </section>
  );
}

/**
 * A category chip in the picker.
 *
 * Disabled rather than hidden when the category is empty: a role that
 * disappears makes the desk wonder whether the CRM has forgotten about CHAs,
 * where a greyed one with a zero says plainly that none are on file.
 */
function RoleChip({
  active,
  disabled = false,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[12px] border transition-colors ${
        active
          ? "border-brand bg-brand text-white"
          : disabled
          ? "border-border bg-surface-1 text-text-muted cursor-not-allowed opacity-60"
          : "border-border bg-surface-1 text-text-secondary hover:text-text-primary hover:border-border-strong"
      }`}
    >
      {children}
    </button>
  );
}
