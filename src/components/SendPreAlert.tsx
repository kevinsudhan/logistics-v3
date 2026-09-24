import { useEffect, useState } from "react";
import { Check, Loader2, PlaneTakeoff } from "lucide-react";
import ComposeMail from "./ComposeMail";
import { useAuth } from "../lib/auth";
import { chargeableWeight } from "../lib/chargeableWeight";
import { failureText } from "../lib/errorText";
import { hawbFileName, hawbPdfBytes } from "../lib/documents/hawbPdf";
import { PRE_ALERT_DOCUMENTS, preAlertHtml, preAlertSubject } from "../lib/preAlertMail";
import { when } from "../lib/shipmentUpdateMail";
import { supabase } from "../lib/supabase";
import { fileAsAttachment, listFiles } from "../services/attachments";
import { customsFor } from "../services/customs";
import type { Customer, Enquiry, Shipment } from "../services/enquiries";
import { getHawb } from "../services/hawb";
import { listPartners } from "../services/partners";
import { extraPartiesFor } from "../services/shipmentExtras";
import { listShipmentContainers } from "../services/shipmentContainers";

/**
 * "Pre-alert" — the mail to the destination agent, from the job (078).
 *
 * ---------------------------------------------------------------------------
 * WHO IT GOES TO
 *
 * The destination agent on the Party tab first; failing that, the agent the
 * job is routed through (Shipment details); failing that, the consignee. The
 * compose window lets the desk change it, like every other mail.
 *
 * WHAT GOES WITH IT
 *
 * The HAWB as saved on the HAWB tab, drawn fresh, and the job's documents an
 * agent needs — invoice, packing list, master bill, shipping bill,
 * certificates, DG papers — already attached and removable. Large files are
 * the compose window's to refuse, with the reason, before anything is sent.
 *
 * WHAT SENDING DOES
 *
 * Puts it on the job's history and ticks "Pre-alert sent to agent" on the
 * workflow (record_pre_alert). Nothing is recorded if the mail is not sent.
 * ---------------------------------------------------------------------------
 */

type Attachment = { name: string; contentType: string; bytes: Uint8Array };

/** An address and the city and country after it — each only if the address does not already say it. */
const place = (...parts: Array<string | null | undefined>) =>
  parts
    .map((p) => (p ?? "").trim())
    .reduce<string[]>((out, p) => (p && !out.join(", ").toLowerCase().includes(p.toLowerCase()) ? [...out, p] : out), [])
    .join(", ");

export default function SendPreAlert({
  shipment: s,
  enquiry,
  onSent,
}: {
  shipment: Shipment & { customer: Customer | null };
  enquiry: Pick<Enquiry, "delivery_required" | "delivery_location"> | null;
  onSent: () => void;
}) {
  const { session } = useAuth();
  const [draft, setDraft] = useState<{ to: string; agent: string | null; subject: string; body: string; attachments: Attachment[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSent, setLastSent] = useState<string | null>(null);

  useEffect(() => {
    void supabase
      .from("enquiry_events")
      .select("at")
      .eq("enquiry_ref", s.enquiry_ref)
      .eq("kind", "pre_alert_sent")
      .eq("detail->>shipment_id", s.id)
      .order("at", { ascending: false })
      .limit(1)
      .then(({ data }) => setLastSent((data?.[0]?.at as string) ?? null));
  }, [s.id, s.enquiry_ref]);

  async function open() {
    setBusy(true);
    setError(null);
    try {
      const [parties, partners, hawb, files, customs, containers] = await Promise.all([
        extraPartiesFor(s.id).catch(() => []),
        s.routed === "agent" && s.routed_agent_id ? listPartners().catch(() => []) : Promise.resolve([]),
        s.transport_mode === "air" ? getHawb(s.id).catch(() => null) : Promise.resolve(null),
        listFiles(s.enquiry_ref).catch(() => []),
        customsFor(s.id).catch(() => []),
        listShipmentContainers(s.id).catch(() => []),
      ]);

      // Who: the destination agent, the routing agent, the consignee.
      const dest = parties.find((p) => p.role === "destination_agent" && p.email);
      const routed = partners.find((p) => p.id === s.routed_agent_id);
      const to = dest?.email ?? routed?.emails[0] ?? s.consignee_email ?? "";
      const agent = dest ? dest.contact_person || dest.name : routed ? routed.organisation || routed.name : null;

      // What: the HAWB as saved, then the job's documents of the kinds an agent needs.
      const attachments: Attachment[] = [];
      if (hawb) {
        const input = { data: hawb.data, hawbNo: hawb.hawb_no, hawbDate: hawb.hawb_date, kind: hawb.awb_kind };
        attachments.push({ name: hawbFileName(input), contentType: "application/pdf", bytes: hawbPdfBytes(input) });
      }
      const wanted = files
        .filter((f) => f.document_type && PRE_ALERT_DOCUMENTS.includes(f.document_type))
        // The HAWB just drawn is the current one; an older filed copy would contradict it.
        .filter((f) => !(hawb && f.document_type === "HAWB"))
        .sort((a, b) => PRE_ALERT_DOCUMENTS.indexOf(a.document_type!) - PRE_ALERT_DOCUMENTS.indexOf(b.document_type!));
      for (const f of wanted) attachments.push(await fileAsAttachment(f));

      const exportClearance = customs.find((c) => c.side === "export");
      const gross = s.gross_weight_kg === null ? null : Number(s.gross_weight_kg);
      const volume = s.volume_cbm === null ? null : Number(s.volume_cbm);
      const chargeable =
        Number(hawb?.data.rates.reduce((n, r) => n + (parseFloat(r.chargeable) || 0), 0)) ||
        (gross !== null && volume !== null ? (chargeableWeight(gross, volume, "air")?.value ?? null) : null);

      const input = {
        ref: s.enquiry_ref,
        shipmentId: s.id,
        agentName: agent,
        mode: s.transport_mode,
        masterBill: s.mainline_no,
        houseBill: s.bl_number,
        carrier: s.carrier,
        flightNumber: s.flight_number,
        vessel: s.vessel,
        voyage: s.voyage,
        etd: s.etd ?? s.sailing_date,
        etdTime: s.etd_time,
        eta: s.eta,
        etaTime: s.eta_time,
        portOfLoading: s.port_of_loading ?? s.origin,
        portOfDischarge: s.port_of_discharge ?? s.destination,
        finalDestination: s.destination,
        shipper: [s.shipper_name, place(s.shipper_city, s.shipper_country)].filter(Boolean).join("\n") || null,
        consignee: [s.consignee_name, place(s.consignee_address, s.consignee_city, s.consignee_country)].filter(Boolean).join("\n") || null,
        notify: [s.notify_name, place(s.notify_city, s.notify_country)].filter(Boolean).join("\n") || null,
        containers: [...new Set([s.container_number, ...containers.map((c) => c.container_no)].filter((c): c is string => Boolean(c)))],
        pieces: s.piece_count ?? s.package_count,
        packageType: s.package_type,
        grossKg: gross,
        chargeableKg: chargeable,
        volumeCbm: volume,
        commodity: s.cargo,
        hsCode: s.hs_code,
        marks: s.marks_and_numbers,
        incoterm: s.incoterm,
        freightTerms: s.freight_terms,
        unNumber: s.un_number,
        imoClass: s.imo_class,
        deliveryTo: enquiry?.delivery_required ? enquiry.delivery_location || s.consignee_address : null,
        shippingBill: exportClearance?.sb_number ? `${exportClearance.sb_number}${exportClearance.sb_date ? ` dated ${when(exportClearance.sb_date)}` : ""}` : null,
        attachmentNames: attachments.map((a) => a.name),
      };
      setDraft({ to, agent, subject: preAlertSubject(input), body: preAlertHtml(input), attachments });
    } catch (e) {
      setError(failureText(e, "Could not prepare the pre-alert.").message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void open()}
        disabled={busy}
        title={lastSent ? `Last sent ${new Date(lastSent).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "Draft the pre-alert to the destination agent"}
        className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-2.5 text-[11.5px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary disabled:opacity-60"
      >
        {busy ? <Loader2 size={11} className="animate-spin" /> : lastSent ? <Check size={11} className="text-text-success" /> : <PlaneTakeoff size={11} />}
        {lastSent ? "Pre-alert sent" : "Pre-alert"}
      </button>
      {error && <span className="text-[11.5px] text-text-danger">{error}</span>}

      {draft && (
        <ComposeMail
          mailbox={session?.email ?? ""}
          fromName={session?.name ?? ""}
          signature={session?.signature ?? ""}
          enquiryRef={s.enquiry_ref}
          reference={s.enquiry_ref}
          initial={{ to: draft.to, subject: draft.subject, body: draft.body }}
          attachments={draft.attachments}
          onClose={() => setDraft(null)}
          onSent={() => {
            const sent = draft;
            setDraft(null);
            setLastSent(new Date().toISOString());
            void supabase
              .rpc("record_pre_alert", { p_shipment_id: s.id, p_to: sent.agent ? `${sent.agent} <${sent.to}>` : sent.to, p_attachments: sent.attachments.length })
              .then(() => onSent());
          }}
        />
      )}
    </>
  );
}
