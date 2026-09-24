import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  Archive,
  Handshake,
  Mail,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
} from "lucide-react";
import PageHeader from "../components/PageHeader";
import {
  listPartners,
  archivePartner,
  restorePartner,
  PARTNER_ROLES,
  PARTNER_ROLE_LABEL,
  type Partner,
  type PartnerRole,
} from "../services/partners";
import { ListSkeleton } from "../components/Loading";

/**
 * Everyone outside this company that a shipment needs.
 *
 * The list is a directory, but the tags are the reason it exists: they are what
 * lets an enquiry suggest the right agent instead of relying on whoever happens
 * to remember. Nothing here is sample data -- an empty book looks empty.
 */
export default function Partners() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<PartnerRole | "all">("all");
  const [tag, setTag] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPartners(await listPartners(true));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load partners.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const tags = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of partners)
      for (const t of p.tags) if (!seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [partners]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return partners
      .filter((p) => (showArchived ? true : p.active))
      .filter((p) => role === "all" || p.role === role)
      .filter((p) => !tag || p.tags.some((t) => t.toLowerCase() === tag.toLowerCase()))
      .filter((p) =>
        !needle
          ? true
          : [p.name, p.organisation, ...p.emails, ...p.phones, ...p.tags, p.notes]
              .filter(Boolean)
              .some((v) => String(v).toLowerCase().includes(needle))
      );
  }, [partners, query, role, tag, showArchived]);

  const counts = useMemo(() => {
    const live = partners.filter((p) => p.active);
    const c: Record<string, number> = { all: live.length };
    for (const r of PARTNER_ROLES) c[r] = live.filter((p) => p.role === r).length;
    return c;
  }, [partners]);

  async function toggleArchive(p: Partner) {
    setError(null);
    try {
      if (p.active) await archivePartner(p.id);
      else await restorePartner(p.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change that partner.");
    }
  }

  return (
    <div>
      <PageHeader
        title="Partner directory"
        subtitle="The directory: who they are, how to reach them, and the tags an enquiry matches them on. Their correspondence is under Partner mail."
      />

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Link
          to="/partners/new"
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-brand hover:bg-brand-dark text-white text-[12px] font-medium"
        >
          <Plus size={13} />
          Add partner
        </Link>

        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Company, contact, tag, email…"
            className="w-full pl-8 h-8"
          />
        </div>

        <button
          onClick={() => void load()}
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-surface-1 text-[12px] text-text-secondary hover:text-text-primary"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>

        <label className="flex items-center gap-1.5 text-[12px] text-text-secondary">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Show archived
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        <Chip active={role === "all"} onClick={() => setRole("all")}>
          All <span className="opacity-60">{counts.all}</span>
        </Chip>
        {PARTNER_ROLES.map((r) => (
          <Chip key={r} active={role === r} onClick={() => setRole(r)}>
            {PARTNER_ROLE_LABEL[r]} <span className="opacity-60">{counts[r] ?? 0}</span>
          </Chip>
        ))}
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-4">
          <span className="text-[11px] text-text-muted mr-1">By tag</span>
          {tags.map((t) => (
            <Chip key={t} active={tag?.toLowerCase() === t.toLowerCase()} onClick={() => setTag(tag?.toLowerCase() === t.toLowerCase() ? null : t)}>
              {t}
            </Chip>
          ))}
        </div>
      )}

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      {loading && !partners.length ? (
        <ListSkeleton />
      ) : !partners.length ? (
        <div className="rounded-card border border-dashed border-border-strong bg-surface-1 p-10 text-center">
          <Handshake size={20} className="mx-auto text-text-muted" />
          <p className="mt-2 text-[14px] font-medium text-text-primary">No partners yet</p>
          <p className="mt-1 text-[13px] text-text-secondary max-w-md mx-auto">
            Add the agents and consol partners you already work with, and tag them with the lanes
            and cargo they handle. Enquiries will then suggest them by themselves.
          </p>
          <Link
            to="/partners/new"
            className="mt-4 inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-brand hover:bg-brand-dark text-white text-[12px] font-medium"
          >
            <Plus size={13} />
            Add partner
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((p) => (
            <div
              key={p.id}
              className={`card p-4 ${
                p.active ? "" : "opacity-60"
              }`}
            >
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  {/*
                    The name is the way in to their correspondence, so it is a
                    link rather than a row you have to find a chevron on. The
                    address sits directly under it because that is what the mail
                    is matched on — the thing to check before you write, and the
                    thing that explains an empty thread list when it is wrong.
                  */}
                  <Link
                    to={`/partners/mail/${p.id}`}
                    className="text-[14px] font-medium text-text-primary hover:text-text-accent hover:underline"
                  >
                    {p.organisation || p.name}
                    {!p.active && <span className="ml-2 text-[11px] text-text-muted">archived</span>}
                  </Link>

                  <div className="mt-0.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-text-secondary">
                    {p.emails.length ? (
                      p.emails.map((e) => (
                        <a
                          key={e}
                          href={`mailto:${e}`}
                          className="inline-flex items-center gap-1 hover:text-text-primary"
                        >
                          <Mail size={11} />
                          {e}
                        </a>
                      ))
                    ) : (
                      <span className="text-text-muted">No email address — no threads will match</span>
                    )}
                  </div>

                  <p className="mt-1 text-[12px] text-text-secondary">
                    {PARTNER_ROLE_LABEL[p.role]}
                    {p.organisation && p.name ? ` · ${p.name}` : ""}
                  </p>

                  <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-text-secondary">
                    {p.phones.map((n) => (
                      <a
                        key={n}
                        href={`tel:${n}`}
                        className="inline-flex items-center gap-1 hover:text-text-primary"
                      >
                        <Phone size={11} />
                        {n}
                      </a>
                    ))}
                  </div>

                  {p.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {p.tags.map((t) => (
                        <button
                          key={t}
                          onClick={() => setTag(t)}
                          className="rounded-full bg-bg-accent px-2 py-0.5 text-[11px] text-text-accent hover:opacity-80"
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  )}

                  {p.notes && (
                    <p className="mt-2 text-[12px] text-text-muted max-w-prose">{p.notes}</p>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Link
                    to={`/partners/${p.id}/edit`}
                    className="flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-border text-[12px] text-text-secondary hover:text-text-primary"
                  >
                    <Pencil size={12} />
                    Edit
                  </Link>
                  <button
                    onClick={() => void toggleArchive(p)}
                    className="flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-border text-[12px] text-text-secondary hover:text-text-primary"
                    title={
                      p.active
                        ? "Hide from pickers — past shipments keep them"
                        : "Put back in the pickers"
                    }
                  >
                    {p.active ? <Archive size={12} /> : <RotateCcw size={12} />}
                    {p.active ? "Archive" : "Restore"}
                  </button>
                </div>
              </div>
            </div>
          ))}
          {!visible.length && <p className="text-[13px] text-text-muted py-6">Nothing matches that.</p>}
        </div>
      )}

    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[12px] border transition-colors ${
        active
          ? "border-brand bg-brand text-white"
          : "border-border bg-surface-1 text-text-secondary hover:text-text-primary hover:border-border-strong"
      }`}
    >
      {children}
    </button>
  );
}
