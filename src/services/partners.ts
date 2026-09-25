import { supabase } from "../lib/supabase";
import type { Enquiry } from "./enquiries";

/**
 * The companies outside this one that a shipment needs.
 *
 * ---------------------------------------------------------------------------
 * WHY TAGS AND NOT CATEGORIES
 *
 * The desk's knowledge about a partner is not a field. It is "good on textiles
 * into Singapore, slow on hazmat, do not use for reefer" -- distinctions no
 * enum written in advance would have contained. Tags let that be written down
 * as it is learned, and the matching below reads them back against the enquiry
 * so the knowledge outlives whoever holds it.
 * ---------------------------------------------------------------------------
 */

export type PartnerRole =
  | "overseas_agent"
  | "consol_partner"
  | "carrier"
  | "cha_customs"
  | "cfs_transport"
  | "other";

export const PARTNER_ROLES: PartnerRole[] = [
  "overseas_agent",
  "consol_partner",
  "carrier",
  "cha_customs",
  "cfs_transport",
  "other",
];

export const PARTNER_ROLE_LABEL: Record<PartnerRole, string> = {
  overseas_agent: "Overseas agent",
  consol_partner: "Consol partner",
  carrier: "Carrier / line",
  cha_customs: "CHA / customs",
  cfs_transport: "CFS / transport",
  other: "Other",
};

export interface Partner {
  id: string;
  name: string;
  organisation: string;
  /** Printed where the partner is named on a document: the agent box on a house B/L (085). */
  address: string;
  /** Their multimodal transport operator registration, where we issue house B/Ls under it (085). */
  mto_registration: string;
  role: PartnerRole;
  emails: string[];
  phones: string[];
  tags: string[];
  notes: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Assignment {
  id: string;
  enquiry_ref: string;
  partner_id: string;
  role: PartnerRole;
  note: string;
  assigned_at: string;
}

// ---------------------------------------------------------------------------
// Reading and writing
// ---------------------------------------------------------------------------

export async function listPartners(includeArchived = false): Promise<Partner[]> {
  let q = supabase.from("partners").select("*").order("organisation").order("name");
  if (!includeArchived) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as Partner[];
}

export async function createPartner(input: {
  name: string;
  organisation: string;
  role: PartnerRole;
  emails: string[];
  phones: string[];
  tags: string[];
  notes: string;
  address?: string;
  mto_registration?: string;
}): Promise<Partner> {
  const { data, error } = await supabase
    .from("partners")
    .insert({ ...input, tags: cleanTags(input.tags) })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Partner;
}

export async function updatePartner(
  id: string,
  patch: Partial<Omit<Partner, "id" | "created_at" | "updated_at">>
): Promise<Partner> {
  const body: Record<string, unknown> = { ...patch, updated_at: new Date().toISOString() };
  if (patch.tags) body.tags = cleanTags(patch.tags);
  const { data, error } = await supabase
    .from("partners")
    .update(body)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Partner;
}

/**
 * Retire a partner without losing them.
 *
 * They stay resolvable on every shipment they have worked on; they simply stop
 * appearing in the pickers. Deleting would leave past enquiries pointing at
 * nothing.
 */
export const archivePartner = (id: string) => updatePartner(id, { active: false });
export const restorePartner = (id: string) => updatePartner(id, { active: true });

/** Every tag anyone has used, for suggesting rather than re-typing. */
export async function allTags(): Promise<string[]> {
  const partners = await listPartners(true);
  const seen = new Map<string, string>();
  for (const p of partners) {
    for (const t of p.tags) if (!seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------

export async function assignmentsFor(ref: string): Promise<Array<Assignment & { partner: Partner }>> {
  const { data, error } = await supabase
    .from("partner_assignments")
    .select("*, partner:partners(*)")
    .eq("enquiry_ref", ref.toUpperCase())
    .order("assigned_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<Assignment & { partner: Partner }>;
}

/**
 * Put a partner on a shipment.
 *
 * The RPC also writes them onto the correspondence, so their mail groups under
 * the right heading on the case file instead of arriving as an unknown sender.
 * Doing both in the database keeps them from coming apart.
 */
export async function assignPartner(
  ref: string,
  partnerId: string,
  role?: PartnerRole,
  note = ""
): Promise<Assignment> {
  const { data, error } = await supabase.rpc("assign_partner", {
    p_ref: ref.toUpperCase(),
    p_partner_id: partnerId,
    p_role: role ?? null,
    p_note: note,
  });
  if (error) throw new Error(error.message);
  return data as Assignment;
}

export async function unassignPartner(ref: string, partnerId: string): Promise<void> {
  const { error } = await supabase
    .from("partner_assignments")
    .delete()
    .eq("enquiry_ref", ref.toUpperCase())
    .eq("partner_id", partnerId);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

export interface Suggestion {
  partner: Partner;
  score: number;
  /** Which tag matched what, so the ranking can be argued with rather than trusted. */
  reasons: Array<{ tag: string; because: string }>;
}

const norm = (s: string) => s.toLowerCase().trim();

/** Loose containment both ways: "singapore" matches "Singapore (SIN)" and vice versa. */
function touches(tag: string, value: string | null | undefined): boolean {
  if (!value) return false;
  const t = norm(tag);
  const v = norm(value);
  if (!t || !v) return false;
  if (v.includes(t) || t.includes(v)) return true;
  // Word-level, so a "textiles" tag still matches "cotton textile bales".
  return v.split(/[^a-z0-9]+/).some((w) => w.length > 2 && (w === t || t.includes(w)));
}

/**
 * Rank partners against one enquiry.
 *
 * Deliberately simple and done in the browser: the desk needs to see WHY a
 * partner was suggested, and a scoring rule anyone can read beats a better one
 * nobody can check. A partner with no matching tag scores zero and is not
 * suggested -- they are still assignable by hand, which is the escape hatch for
 * everything this cannot know.
 */
export function suggestPartners(enquiry: Enquiry, partners: Partner[]): Suggestion[] {
  const out: Suggestion[] = [];

  for (const p of partners) {
    if (!p.active) continue;
    const reasons: Suggestion["reasons"] = [];
    let score = 0;

    for (const tag of p.tags) {
      // A route tag ("Chennai-Singapore") naming both ends is the strongest
      // signal there is -- it says this partner works exactly this lane.
      if (
        enquiry.origin &&
        enquiry.destination &&
        touches(tag, enquiry.origin) &&
        touches(tag, enquiry.destination)
      ) {
        score += 5;
        reasons.push({ tag, because: "this lane" });
        continue;
      }
      if (touches(tag, enquiry.destination)) {
        score += 3;
        reasons.push({ tag, because: "destination" });
        continue;
      }
      if (touches(tag, enquiry.origin)) {
        score += 2;
        reasons.push({ tag, because: "origin" });
        continue;
      }
      if (touches(tag, enquiry.cargo)) {
        score += 3;
        reasons.push({ tag, because: "cargo" });
        continue;
      }
      if (touches(tag, enquiry.cargo_type)) {
        score += 2;
        reasons.push({ tag, because: "cargo type" });
        continue;
      }
      if (enquiry.incoterm && norm(tag) === norm(enquiry.incoterm)) {
        score += 1;
        reasons.push({ tag, because: "incoterm" });
      }
    }

    if (score > 0) out.push({ partner: p, score, reasons });
  }

  return out.sort(
    (a, b) =>
      b.score - a.score ||
      (a.partner.organisation || a.partner.name).localeCompare(
        b.partner.organisation || b.partner.name
      )
  );
}

/** Trim, drop blanks, and de-duplicate case-insensitively, keeping first spelling. */
export function cleanTags(tags: string[]): string[] {
  const seen = new Map<string, string>();
  for (const raw of tags) {
    const t = raw.trim();
    if (t && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  }
  return [...seen.values()];
}
