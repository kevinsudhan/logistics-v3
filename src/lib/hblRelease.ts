import { originalsInWords, type ReleaseMode } from "./hbl";

/**
 * Releasing our own house B/L, once issued (089).
 *
 * ---------------------------------------------------------------------------
 * THE STEPS, BY HOW IT IS RELEASED
 *
 *   original  charges received · originals handed over (to the shipper, their
 *             bank or a courier) · released at destination, when our agent
 *             takes one original from the consignee
 *   telex     charges received · the full set back with us · the telex
 *             release sent to our agent · released
 *   express   charges received · release instructions sent to our agent ·
 *             released (a sea waybill has no originals)
 *
 * On a telex release the originals may have gone out first and come back;
 * handing them over is shown, and not required.
 *
 * The database refuses the two things that must not happen (089): recording
 * a release on an unissued B/L, and a telex release before every original is
 * back. This file says what is next and writes the release message.
 * ---------------------------------------------------------------------------
 */

export interface OurRelease {
  status: "draft" | "issued";
  release_mode: ReleaseMode;
  originals: number;
  issued_at: string | null;
  charges_received_on: string | null;
  originals_released_on: string | null;
  originals_released_to: string;
  originals_returned: number;
  originals_returned_on: string | null;
  release_sent_on: string | null;
  release_sent_to: string;
  released_on: string | null;
}

export type StepKey = "charges_received_on" | "originals_released_on" | "originals_returned_on" | "release_sent_on" | "released_on";

export interface ReleaseStep {
  key: StepKey;
  label: string;
  /** What the step means, for the person ticking it. */
  hint: string;
  done: boolean;
  on: string | null;
  /** "to RAVI, KAVITHA TEXTILES", "2 of 3 back". */
  detail: string;
  /** Not needed for the release to be complete. */
  optional: boolean;
}

export function releaseSteps(r: OurRelease): { steps: ReleaseStep[]; next: ReleaseStep | null; complete: boolean } {
  const step = (key: StepKey, label: string, hint: string, done: boolean, on: string | null, detail = "", optional = false): ReleaseStep => ({ key, label, hint, done, on, detail, optional });
  const charges = step("charges_received_on", "Charges received from the shipper", "Freight and our charges paid, or cleared on credit, before the B/L leaves us.", Boolean(r.charges_received_on), r.charges_received_on);
  const handedOver = (optional: boolean) =>
    step(
      "originals_released_on",
      optional ? "Originals handed over (if they left us)" : `${originalsInWords(r.originals)} original${r.originals === 1 ? "" : "s"} handed over`,
      "To the shipper, their bank or a courier. Say who took them.",
      Boolean(r.originals_released_on),
      r.originals_released_on,
      r.originals_released_to.trim() ? `to ${r.originals_released_to.trim()}` : "",
      optional
    );
  const released = step("released_on", "Released at destination", r.release_mode === "original" ? "Our agent took one original from the consignee and released the cargo." : "Our agent confirmed the cargo released to the consignee.", Boolean(r.released_on), r.released_on);

  const steps: ReleaseStep[] =
    r.release_mode === "original"
      ? [charges, handedOver(false), released]
      : r.release_mode === "telex"
        ? [
            charges,
            handedOver(true),
            step(
              "originals_returned_on",
              "Full set surrendered to us",
              `All ${r.originals} originals back with us, so no original is left to claim the cargo.`,
              r.originals > 0 && r.originals_returned >= r.originals,
              r.originals_returned_on,
              `${r.originals_returned} of ${r.originals} back`
            ),
            step("release_sent_on", "Telex release sent to our agent", "The message telling our agent to release without an original.", Boolean(r.release_sent_on), r.release_sent_on, r.release_sent_to.trim() ? `to ${r.release_sent_to.trim()}` : ""),
            released,
          ]
        : [
            charges,
            step("release_sent_on", "Release instructions sent to our agent", "A sea waybill: the consignee collects against identity, on our word to the agent.", Boolean(r.release_sent_on), r.release_sent_on, r.release_sent_to.trim() ? `to ${r.release_sent_to.trim()}` : ""),
            released,
          ];

  const next = r.status === "issued" ? (steps.find((s) => !s.done && !s.optional) ?? null) : null;
  return { steps, next, complete: r.status === "issued" && Boolean(r.released_on) };
}

/**
 * Where it stands, in a line: for the header of the release card.
 */
export function releaseSummary(r: OurRelease): string {
  if (r.status !== "issued") return "Issue the B/L to start its release.";
  const { next, complete } = releaseSteps(r);
  if (complete) return "Released at destination.";
  if (r.release_mode === "original" && r.originals_released_on) return `Originals with ${r.originals_released_to.trim() || "the shipper"}; waiting for one to be surrendered at destination.`;
  if (r.release_mode === "telex" && r.originals_returned < r.originals && r.originals_returned > 0) return `${r.originals_returned} of ${r.originals} originals back; waiting for the rest before the telex release.`;
  return next ? `Next: ${next.label.charAt(0).toLowerCase()}${next.label.slice(1)}.` : "";
}

// ---------------------------------------------------------------------------
// The release message to our agent
// ---------------------------------------------------------------------------

export interface ReleaseMailInput {
  ref: string;
  mode: ReleaseMode;
  hblNo: string;
  mblNo: string | null;
  agentName: string | null;
  shipper: string;
  consignee: string;
  vessel: string;
  voyage: string;
  portOfLoading: string;
  portOfDischarge: string;
  containers: string[];
  packages: string;
  grossKg: string;
  originals: number;
  /** Where the originals were surrendered to us: CHENNAI. */
  place: string;
  freightTerms: "prepaid" | "collect";
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function releaseMailSubject(i: ReleaseMailInput): string {
  const bills = [`HBL ${i.hblNo}`, i.mblNo && `MBL ${i.mblNo}`].filter(Boolean).join(" / ");
  return `[${i.ref}] ${i.mode === "express" ? "RELEASE — SEA WAYBILL" : "TELEX RELEASE"} — ${bills}`;
}

/**
 * The message itself: what to release, to whom, on what authority. The
 * particulars are there so the agent can match it to the cargo without
 * opening anything else.
 */
export function releaseMailHtml(i: ReleaseMailInput): string {
  const rows: Array<[string, string]> = (
    [
      ["House B/L", i.hblNo],
      ["Master B/L", i.mblNo ?? ""],
      ["Shipper", i.shipper],
      ["Consignee", i.consignee],
      ["Vessel / voyage", [i.vessel, i.voyage].filter(Boolean).join(" / ")],
      ["Port of loading", i.portOfLoading],
      ["Port of discharge", i.portOfDischarge],
      [i.containers.length > 1 ? "Containers" : "Container", i.containers.join(", ")],
      ["Packages", i.packages],
      ["Gross weight", i.grossKg ? `${i.grossKg} kg` : ""],
      ["Our reference", i.ref],
    ] as Array<[string, string]>
  ).filter(([, v]) => v.trim());
  const table = `<table style="border-collapse:collapse;font-size:14px;margin:0 0 12px">${rows
    .map(([k, v]) => `<tr><td style="padding:3px 16px 3px 0;color:#555;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:3px 0;color:#111">${esc(v).replace(/\n/g, "<br>")}</td></tr>`)
    .join("")}</table>`;

  const authority =
    i.mode === "express"
      ? `<p>This shipment moves on our <strong>sea waybill ${esc(i.hblNo)}</strong>. No original bills of lading were issued. Please release the cargo to the named consignee against proof of identity, without surrender of any document.</p>`
      : `<p>Please release the cargo under our house B/L <strong>${esc(i.hblNo)}</strong> to the consignee <strong>without surrender of an original B/L</strong>. The full set of ${esc(originalsInWords(i.originals))} original${i.originals === 1 ? "" : "s"} has been surrendered to us at ${esc(i.place)}.</p>`;

  return (
    `<p>${i.agentName ? `Dear ${esc(i.agentName)},` : "Dear Partner,"}</p>` +
    authority +
    (i.freightTerms === "collect" ? `<p><strong>Freight is collect:</strong> please release only against payment of the freight and your charges.</p>` : "") +
    table +
    `<p>Kindly confirm once the cargo is released.</p>` +
    `<p>Please keep <strong>${esc(i.ref)}</strong> in the subject line when you reply, so it reaches the right file.</p>`
  );
}
