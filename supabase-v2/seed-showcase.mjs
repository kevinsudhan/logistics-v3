/**
 * One complete case, so every feature has something to show.
 *
 *   node supabase-v2/seed-showcase.mjs [partner-email]
 *
 * ---------------------------------------------------------------------------
 * WHAT IT MAKES
 *
 * A customer, an enquiry with enough cargo detail that the documents come out
 * as finals rather than drafts, a partner with a real address so the rate burst
 * has somewhere to go, a container to put the enquiry on, and a booking so the
 * in-process page has a row with paperwork behind it.
 *
 * WHY THE PARTNER ADDRESS IS AN ARGUMENT
 *
 * Because the rate burst only demonstrates anything if a reply can come back.
 * Point it at an address you can read and you can send the request, answer it,
 * press Check for replies, and watch the quote appear — which is the whole
 * feature end to end rather than a screenshot of the first half.
 *
 * WHY IT IS SAFE TO RUN TWICE
 *
 * Every insert is an upsert on a fixed id. Running it again refreshes the same
 * rows rather than growing a second demo customer, and nothing it writes
 * collides with real work: the ids are all prefixed DEMO.
 * ---------------------------------------------------------------------------
 */
import { accessToken, PROJECT } from "./token.mjs";

const TOKEN = accessToken();
const PARTNER_EMAIL = (process.argv[2] || "partner@example.com").trim();

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const body = await r.text();
  if (!r.ok) {
    console.error(body.slice(0, 900));
    process.exit(1);
  }
  return JSON.parse(body);
}

const esc = (s) => String(s).replace(/'/g, "''");

const out = await sql(`
do $$
declare
  v_cust  public.customers;
  v_enq   public.enquiries;
  v_part  uuid;
  v_sail  text;
  v_ship  text;
begin
  -- ---- customer -------------------------------------------------------
  insert into public.customers (id, name, company, emails, phones)
  values ('DEMO-CUS-1', 'Priya Raghavan', 'Sunrise Textiles Pvt Ltd',
          array['priya@sunrisetextiles.in'], array['+91 98402 55671'])
  on conflict (id) do update
    set name = excluded.name, company = excluded.company,
        emails = excluded.emails, phones = excluded.phones
  returning * into v_cust;

  -- ---- enquiry, filled in enough that documents print as finals -------
  insert into public.enquiries (
    ref, customer_id, seq, status, source,
    origin, destination, cargo, cargo_type, incoterm, ready_date, pickup_location,
    piece_count, piece_length_cm, piece_width_cm, piece_height_cm,
    weight_per_piece_kg, gross_weight_kg, volume_cbm, stackable, upright_only,
    notes
  ) values (
    'DEMO-E01', v_cust.id, 99, 'accepted', 'email',
    'Chennai', 'Colombo', '4 pallets of cotton fabric', 'general', 'FOB',
    current_date + 6, 'Tirupur, Tamil Nadu',
    4, 120, 100, 125, 450, 1800, 6.0, true, false,
    'Demo case — created by seed-showcase.mjs. Safe to delete.'
  )
  on conflict (ref) do update
    set status = excluded.status, origin = excluded.origin,
        destination = excluded.destination, cargo = excluded.cargo,
        incoterm = excluded.incoterm, ready_date = excluded.ready_date,
        pickup_location = excluded.pickup_location,
        piece_count = excluded.piece_count, gross_weight_kg = excluded.gross_weight_kg,
        volume_cbm = excluded.volume_cbm, notes = excluded.notes
  returning * into v_enq;

  -- ---- partner, with an address the burst can actually reach ----------
  select id into v_part from public.partners where name = 'Demo Consol Partner';
  if v_part is null then
    insert into public.partners (name, organisation, role, emails, phones, tags, notes)
    values ('Demo Consol Partner', 'Lanka Consol Lines', 'consol_partner',
            array['${esc(PARTNER_EMAIL)}'], array['+94 11 234 5678'],
            array['Colombo','LCL'],
            'Demo partner — created by seed-showcase.mjs. Safe to delete.')
    returning id into v_part;
  else
    update public.partners set emails = array['${esc(PARTNER_EMAIL)}'] where id = v_part;
  end if;

  -- ---- a container, and the enquiry on it -----------------------------
  select id into v_sail from public.sailings where notes like 'Demo container%' limit 1;
  if v_sail is null then
    v_sail := (public.create_container(
      'Chennai', 'Colombo', current_date + 10, v_part, '40GP', 'CMA CGM',
      current_date + 8, 'FCL', 'Demo container — created by seed-showcase.mjs.')).id;
  end if;
  update public.enquiries set sailing_id = v_sail where ref = v_enq.ref;

  -- ---- a booking, so in-process has a row with paperwork --------------
  insert into public.shipments (
    id, enquiry_ref, customer_id, stage,
    origin, destination, cargo, piece_count, volume_cbm, gross_weight_kg,
    agreed_inr, sailing_date, carrier, booking_number, container_number,
    bl_number, vessel, etd, eta, container_type,
    consignee_name, consignee_address, consignee_country,
    shipper_name, shipper_gstin_iec,
    package_count, package_type, hs_code, net_weight_kg,
    invoice_value_inr, incoterm, payment_terms, letter_of_credit
  ) values (
    'DEMO-SHP-1', v_enq.ref, v_cust.id, 'stuffed',
    'Chennai', 'Colombo', '4 pallets of cotton fabric', 4, 6.0, 1800,
    48500, current_date + 10, 'CMA CGM', 'BKG-DEMO-7741', 'TCLU-2291883',
    'CMDUCHE0099821', 'CMA CGM NIAGARA v.0FA9K', current_date + 10, current_date + 14, '40GP',
    -- The particulars a shipping document is made of. Without these the B/L,
    -- the invoice and the delivery order can only ever print as drafts.
    'Ceylon Fabrics (Pvt) Ltd',
    'No. 214, Galle Road, Colombo 03, Sri Lanka',
    'Sri Lanka',
    'Sunrise Textiles Pvt Ltd',
    '33AABCS1429B1ZQ',
    4, 'Pallets', '5208.52', 1720, 412000, 'FOB', '30 days from B/L date', false
  )
  on conflict (id) do update
    set stage = excluded.stage, agreed_inr = excluded.agreed_inr,
        sailing_date = excluded.sailing_date, carrier = excluded.carrier,
        booking_number = excluded.booking_number,
        container_number = excluded.container_number,
        bl_number = excluded.bl_number, vessel = excluded.vessel,
        etd = excluded.etd, eta = excluded.eta,
        container_type = excluded.container_type,
        consignee_name = excluded.consignee_name,
        consignee_address = excluded.consignee_address,
        consignee_country = excluded.consignee_country,
        shipper_name = excluded.shipper_name,
        shipper_gstin_iec = excluded.shipper_gstin_iec,
        package_count = excluded.package_count,
        package_type = excluded.package_type,
        hs_code = excluded.hs_code,
        net_weight_kg = excluded.net_weight_kg,
        invoice_value_inr = excluded.invoice_value_inr,
        incoterm = excluded.incoterm,
        payment_terms = excluded.payment_terms,
        letter_of_credit = excluded.letter_of_credit
  returning id into v_ship;

  raise notice 'seeded % % % %', v_cust.id, v_enq.ref, v_sail, v_ship;
end $$;

select jsonb_pretty(jsonb_build_object(
  'customer',  (select company from public.customers where id='DEMO-CUS-1'),
  'enquiry',   (select ref     from public.enquiries where ref='DEMO-E01'),
  'on_container', (select sailing_id from public.enquiries where ref='DEMO-E01'),
  'partner',   (select emails[1] from public.partners where name='Demo Consol Partner'),
  'booking',   (select id from public.shipments where id='DEMO-SHP-1'),
  'stage',     (select stage from public.shipments where id='DEMO-SHP-1')
)) as seeded;
`);

console.log(out[out.length - 1]?.seeded ?? out);
console.log(`\npartner address: ${PARTNER_EMAIL}`);
