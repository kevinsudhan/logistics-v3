import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, Handshake, Mail as MailIcon, Search } from "lucide-react";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import StatusPill from "../components/StatusPill";
import { failureText, type FailureText } from "../lib/errorText";
import { mailIsLive } from "../services/backend";
import {
  listPartners,
  PARTNER_ROLES,
  PARTNER_ROLE_LABEL,
  type Partner,
  type PartnerRole,
} from "../services/partners";
import { ListSkeleton } from "../components/Loading";

/**
 * Whose correspondence to open.
 *
 * ---------------------------------------------------------------------------
 * WHY THE MAIL IS ITS OWN SECTION AND NOT A TAB ON THE DIRECTORY
 *
 * Because they are different jobs done at different times. The directory is
 * maintenance -- somebody new, somebody's address changed, somebody retired --
 * and it is touched rarely. The mail is the daily work: what did the agent say,
 * what is still unanswered. Putting the second behind the first meant opening a
 * list of records to get to a list of conversations.
 *
 * WHY THIS PAGE DOES NOT SHOW THREAD COUNTS
 *
 * It would need one mailbox search per partner to say "4 threads", which is
 * forty searches to draw a list of forty names, every time the page opens. The
 * count is not worth that, and a number that takes six seconds to arrive is
 * worse than no number. The search happens when you pick somebody.
 *
 * Partners with no address are listed, greyed, saying why: they will match
 * nothing, and the fix is on the directory rather than here.
 * ---------------------------------------------------------------------------
 */
export default function PartnerMail() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<PartnerRole | "all">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<FailureText | null>(null);

  const live = mailIsLive();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Archived partners are left out here. Their record stays on the
      // directory because past shipments point at it; their mail is not what
      // anybody is looking for on a screen about today's work.
      setPartners(await listPartners(false));
    } catch (e) {
      setError(failureText(e, "Could not load partners."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: partners.length };
    for (const r of PARTNER_ROLES) c[r] = partners.filter((p) => p.role === r).length;
    return c;
  }, [partners]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return partners
      .filter((p) => role === "all" || p.role === role)
      .filter((p) =>
        !needle
          ? true
          : [p.name, p.organisation, ...p.emails, ...p.tags]
              .filter(Boolean)
              .some((v) => String(v).toLowerCase().includes(needle))
      );
  }, [partners, query, role]);

  return (
    <div>
      <PageHeader
        title="Partner mail"
        subtitle="Open an agent to read and answer everything exchanged with them. Matched on their email address, read straight from the mailbox."
      />

      {!live && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-bg-warning px-3 py-2.5 text-[12px] text-text-warning">
          <AlertCircle size={13} className="mt-px shrink-0" />
          <span>
            Outlook is not connected on this session, so no threads will load.{" "}
            <Link to="/mail" className="underline">
              Sign in with Microsoft on the Mail screen
            </Link>{" "}
            and this works without any further setup — nothing here is stored.
          </span>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] max-w-sm flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Company, contact, tag, email…"
            className="h-8 w-full pl-8"
          />
        </div>
        <Link
          to="/partners"
          className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary hover:text-text-primary"
        >
          <Handshake size={13} />
          Directory
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <Chip active={role === "all"} onClick={() => setRole("all")}>
          All <span className="opacity-60">{counts.all}</span>
        </Chip>
        {PARTNER_ROLES.map((r) => (
          <Chip key={r} active={role === r} onClick={() => setRole(r)}>
            {PARTNER_ROLE_LABEL[r]} <span className="opacity-60">{counts[r] ?? 0}</span>
          </Chip>
        ))}
      </div>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          <span>
            {error.message}
            {error.hint && <span className="mt-1 block opacity-80">{error.hint}</span>}
          </span>
        </div>
      )}

      {loading && !partners.length ? (
        <ListSkeleton />
      ) : !partners.length ? (
        <EmptyState
          icon={Handshake}
          title="No partners yet"
          hint="Add the agents you work with and their mail appears here, matched on their address."
          action={
            <Link
              to="/partners/new"
              className="inline-flex h-8 items-center rounded-lg bg-brand px-3 text-[12px] font-medium text-white hover:bg-brand-dark"
            >
              Add a partner
            </Link>
          }
        />
      ) : !visible.length ? (
        <p className="py-6 text-[13px] text-text-muted">Nothing matches that.</p>
      ) : (
        <div className="space-y-2">
          {visible.map((p) => {
            const reachable = p.emails.length > 0;
            return (
              <Link
                key={p.id}
                to={reachable ? `/partners/mail/${p.id}` : "/partners"}
                className={`card flex items-start justify-between gap-4 p-4 transition-colors hover:bg-surface-2 ${
                  reachable ? "" : "opacity-70"
                }`}
              >
                <div className="min-w-0">
                  <p className="text-[14px] font-medium text-text-primary">
                    {p.organisation || p.name}
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[12px] text-text-secondary">
                    {reachable ? (
                      p.emails.map((e) => (
                        <span key={e} className="inline-flex items-center gap-1">
                          <MailIcon size={11} />
                          {e}
                        </span>
                      ))
                    ) : (
                      <span className="text-text-muted">
                        No email address — add one on the directory and their mail appears here
                      </span>
                    )}
                  </div>
                  {p.organisation && p.name && (
                    <p className="mt-1 text-[12px] text-text-secondary">{p.name}</p>
                  )}
                </div>
                <StatusPill tone="accent">{PARTNER_ROLE_LABEL[p.role]}</StatusPill>
              </Link>
            );
          })}
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
      type="button"
      onClick={onClick}
      className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] transition-colors ${
        active
          ? "border-brand bg-brand text-white"
          : "border-border bg-surface-1 text-text-secondary hover:border-border-strong hover:text-text-primary"
      }`}
    >
      {children}
    </button>
  );
}
