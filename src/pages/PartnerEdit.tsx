import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AlertCircle, ChevronLeft, Handshake } from "lucide-react";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import PartnerForm from "../components/PartnerForm";
import { failureText, type FailureText } from "../lib/errorText";
import { allTags, listPartners, type Partner } from "../services/partners";

/**
 * Adding a partner, or correcting one, on a page of its own.
 *
 * ---------------------------------------------------------------------------
 * WHY A PAGE AND NOT THE DIALOG IT WAS
 *
 * Because it has a URL. A half-finished partner is a thing somebody gets
 * interrupted in the middle of -- the agent is on the phone spelling their
 * address -- and a dialog cannot be linked to, refreshed, or reopened where it
 * was. It also cannot be sent to a colleague, which is what "can you add Gulf
 * Line properly" turns into.
 *
 * The form itself is unchanged and still the one the directory and the enquiry
 * picker use. What moved is where it is mounted.
 *
 * WHY EDIT AND ADD ARE ONE PAGE
 *
 * They are the same seven fields and the same validation; the only difference
 * is whether an id was given. Two pages would be two places to add the next
 * field to, and the one that gets forgotten is the one you are not looking at.
 * ---------------------------------------------------------------------------
 */
export default function PartnerEdit() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [partner, setPartner] = useState<Partner | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<FailureText | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // The tag list is what keeps "Jebel Ali" from becoming three spellings,
      // so it is fetched whether adding or editing.
      const [existing, known] = await Promise.all([
        id ? listPartners(true) : Promise.resolve<Partner[]>([]),
        allTags().catch(() => [] as string[]),
      ]);
      setTags(known);
      if (id) setPartner(existing.find((p) => p.id === id) ?? null);
    } catch (e) {
      setError(failureText(e, "Could not open this partner."));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const done = () => navigate("/partners");

  if (loading) return <p className="py-10 text-[13px] text-text-muted">Loading…</p>;

  if (id && !partner) {
    return (
      <EmptyState
        icon={Handshake}
        title="No partner with that id"
        hint="It may have been removed, or the link may be from an older record."
        action={
          <Link
            to="/partners"
            className="inline-flex h-8 items-center rounded-lg border border-border-strong bg-surface-1 px-3 text-[12px] font-medium text-text-primary transition-colors hover:bg-surface-2"
          >
            Back to the directory
          </Link>
        }
      />
    );
  }

  return (
    <div>
      <Link
        to="/partners"
        className="mb-4 inline-flex items-center gap-1 text-[12px] text-text-secondary hover:text-text-primary"
      >
        <ChevronLeft size={14} /> Back to the directory
      </Link>

      <PageHeader
        title={partner ? partner.organisation || partner.name : "Add a partner"}
        subtitle={
          partner
            ? "Correcting the record. Their correspondence is matched on the email address, so changing it changes what appears under their mail."
            : "An agent, consol partner, carrier or CHA. The email address is what their mail is matched on, so it is the field worth getting right."
        }
      />

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          <span>
            {error.message}
            {error.hint && <span className="mt-1 block opacity-80">{error.hint}</span>}
          </span>
        </div>
      )}

      {/*
        inline, because this is a page. As a dialog the form dismisses on a
        click outside it — and on a page of its own, "outside it" is everywhere,
        so adding a partner meant one stray click throwing the whole thing away.
      */}
      <PartnerForm
        partner={partner ?? undefined}
        suggestions={tags}
        onClose={done}
        onSaved={done}
        inline
      />
    </div>
  );
}
