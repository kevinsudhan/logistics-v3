import { useEffect, useMemo, useState } from "react";
import { Loader2, Send } from "lucide-react";
import ComposeMail from "./ComposeMail";
import Select, { type SelectOption } from "./Select";
import { useAuth } from "../lib/auth";
import { failureText } from "../lib/errorText";
import { trackingMailHtml, trackingMailSubject } from "../lib/trackingLinkMail";
import { logEvent, stageLabel, type Customer, type Shipment } from "../services/enquiries";
import { isReachable } from "../services/publicQuote";
import { extraPartiesFor, type ExtraParty } from "../services/shipmentExtras";
import { issueTrackLink, trackUrl } from "../services/tracking";

/**
 * "Email the tracking link" — the customer's page, sent from the Tracking tab.
 *
 * ---------------------------------------------------------------------------
 * The addresses offered are the ones the job already holds: the customer's
 * own, then the shipper, consignee and notify party, then the other parties
 * on the Party tab. The link is issued on the way if there is none yet.
 *
 * Like every mail to somebody outside, it opens as a draft in the compose
 * window under the person's name, and it goes on the job's timeline only once
 * it has actually been sent — "we sent them the link on Tuesday" is what
 * somebody needs when the customer says nobody did.
 *
 * A link to this machine (no public address configured) is not offered: a
 * customer cannot open localhost.
 * ---------------------------------------------------------------------------
 */

const ROLE: Record<string, string> = {
  destination_agent: "Destination agent",
  origin_agent: "Origin agent",
  billing_customer: "Billing customer",
  notify_2: "Second notify",
  forwarder: "Forwarder",
  customs_house_agent: "Customs broker",
};

export default function SendTrackingLink({
  shipment: s,
  customer,
  onSent,
}: {
  shipment: Shipment;
  customer: Customer | null;
  /** The link may have been issued on the way, and the timeline has a new line. */
  onSent: () => void;
}) {
  const { session } = useAuth();
  const [extra, setExtra] = useState<ExtraParty[]>([]);
  const [to, setTo] = useState("");
  const [draft, setDraft] = useState<{ subject: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void extraPartiesFor(s.id)
      .then(setExtra)
      .catch(() => setExtra([]));
  }, [s.id]);

  const options = useMemo(() => {
    const out: Array<SelectOption & { name: string | null }> = [];
    const add = (email: string | null | undefined, who: string, name: string | null) => {
      const e = email?.trim();
      if (e && !out.some((o) => o.value.toLowerCase() === e.toLowerCase())) out.push({ value: e, label: e, hint: who, name });
    };
    const custName = customer?.name || customer?.company || null;
    for (const e of customer?.emails ?? []) add(e, "Customer", custName);
    add(s.shipper_email, "Shipper", s.shipper_name);
    add(s.consignee_email, "Consignee", s.consignee_name);
    add(s.notify_email, "Notify party", s.notify_name);
    for (const p of extra) add(p.email, ROLE[p.role] ?? p.role, p.contact_person || p.name);
    return out;
  }, [customer, s, extra]);

  useEffect(() => {
    if (!to && options[0]) setTo(options[0].value);
  }, [options, to]);

  const reachable = isReachable(trackUrl("x"));
  const mode = s.transport_mode;

  async function open() {
    setBusy(true);
    setError(null);
    try {
      const link = await issueTrackLink(s.id);
      const chosen = options.find((o) => o.value === to);
      const input = {
        ref: s.enquiry_ref,
        shipmentId: s.id,
        url: trackUrl(link.token),
        customerName: chosen?.name ?? null,
        mode,
        stage: stageLabel(s.stage, mode),
        origin: s.origin,
        destination: s.destination,
        carrier: s.carrier,
        flightNumber: s.flight_number,
        vessel: s.vessel,
        voyage: s.voyage,
        etd: s.etd ?? s.sailing_date,
        etdTime: s.etd_time,
        eta: s.eta,
        etaTime: s.eta_time,
        houseBill: s.bl_number,
      };
      setDraft({ subject: trackingMailSubject(input), body: trackingMailHtml(input) });
    } catch (e) {
      setError(failureText(e, "Could not prepare the mail.").message);
    } finally {
      setBusy(false);
    }
  }

  if (!reachable) return null;

  return (
    <div className="mt-3 border-t border-border pt-3">
      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-secondary">Email it</p>
      {options.length ? (
        <div className="flex flex-wrap items-center gap-2">
          <Select label="Send the tracking link to" value={to} options={options} onChange={setTo} className="min-w-[240px] flex-1" />
          <button
            type="button"
            disabled={busy || !to}
            onClick={() => void open()}
            className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-medium text-white hover:bg-brand-dark disabled:opacity-60"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            Write the mail
          </button>
        </div>
      ) : (
        <p className="text-[12px] text-text-muted">
          No email on this job yet. Add one to the customer, or to the shipper or consignee on the Party tab.
        </p>
      )}
      {error && <p className="mt-2 text-[12px] text-text-danger">{error}</p>}

      {draft && (
        <ComposeMail
          mailbox={session?.email ?? ""}
          fromName={session?.name ?? ""}
          signature={session?.signature ?? ""}
          enquiryRef={s.enquiry_ref}
          reference={s.enquiry_ref}
          initial={{ to, subject: draft.subject, body: draft.body }}
          onClose={() => setDraft(null)}
          onSent={() => {
            setDraft(null);
            const who = options.find((o) => o.value === to);
            void logEvent(s.enquiry_ref, "tracking_link_sent", `Tracking link sent to ${who?.name || to}${who?.hint ? ` (${who.hint})` : ""}`, {
              to,
              shipment_id: s.id,
            })
              .catch(() => {})
              .finally(onSent);
          }}
        />
      )}
    </div>
  );
}
