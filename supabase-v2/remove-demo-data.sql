-- ---------------------------------------------------------------------------
-- Takes the seeded demo data back out.
--
-- The same deletes as `remove-demo-data.mjs`, as plain SQL, so it can be run
-- from the Supabase dashboard's SQL editor with nothing to install and no
-- access token. The script is the better route once a token exists; this is
-- the one that works right now.
--
--   Dashboard -> SQL Editor -> paste -> Run
--
-- WHAT IT TOUCHES
--
--   'Demo Consol Partner' / 'Lanka Consol Lines'   seed-showcase.mjs
--   the twelve organisations below                 seed-partners.mjs
--   DEMO-CUS-1, DEMO-E01, DEMO-SHP-1               seed-showcase.mjs
--   sailings whose notes start 'Demo container'    seed-showcase.mjs
--
-- Identified by exact name, not by matching the word "demo", so a customer
-- genuinely called Demo Logistics survives it.
--
-- ORDER MATTERS
--
-- `shipments.enquiry_ref` and `shipments.customer_id` are ON DELETE RESTRICT,
-- so the booking goes before the enquiry and the enquiry before the customer.
-- Everything else hanging off an enquiry is ON DELETE CASCADE and goes with it.
-- ---------------------------------------------------------------------------

-- Run this on its own first. It changes nothing and shows what would go.
select 'partners'  as tbl, organisation, name from public.partners
 where name = 'Demo Consol Partner'
    or organisation in (
      'Lanka Consol Lines',
      'Pacific Consolidators Pte', 'Gulf Line Freight LLC', 'Seabridge Groupage',
      'Indus Consol Services', 'Meridian Lines', 'Orient Star Shipping',
      'Coastline Clearing Agents', 'Trident Customs House', 'Metro Haulage',
      'Redhills CFS & Logistics', 'Southern Marine Surveyors', 'Anchor Marine Insurance'
    );


-- ---------------------------------------------------------------------------
-- The deletes. One transaction: if any part is refused, nothing is removed.
--
-- To also remove a partner you added by hand while testing, put its name or
-- organisation into the list in BOTH places below — the assignments delete and
-- the partners delete have to agree, or the second is blocked by the first.
-- ---------------------------------------------------------------------------
begin;

-- The booking first, or the enquiry and customer cannot go.
delete from public.shipments where id = 'DEMO-SHP-1';

delete from public.partner_assignments
 where partner_id in (
   select id from public.partners
    where name = 'Demo Consol Partner'
       or organisation in (
         'Lanka Consol Lines',
         'Pacific Consolidators Pte', 'Gulf Line Freight LLC', 'Seabridge Groupage',
         'Indus Consol Services', 'Meridian Lines', 'Orient Star Shipping',
         'Coastline Clearing Agents', 'Trident Customs House', 'Metro Haulage',
         'Redhills CFS & Logistics', 'Southern Marine Surveyors', 'Anchor Marine Insurance'
       )
 );

-- Takes its events, parties, quotes and threads with it.
delete from public.enquiries where ref = 'DEMO-E01';

delete from public.intake
 where message_id in ('DEMO-MSG-0001', 'DEMO-MSG-KEVIN-01')
    or call_id in ('demo-call-1', 'demo-call-kevin');

delete from public.customers where id = 'DEMO-CUS-1';

delete from public.partners
 where name = 'Demo Consol Partner'
    or organisation in (
      'Lanka Consol Lines',
      'Pacific Consolidators Pte', 'Gulf Line Freight LLC', 'Seabridge Groupage',
      'Indus Consol Services', 'Meridian Lines', 'Orient Star Shipping',
      'Coastline Clearing Agents', 'Trident Customs House', 'Metro Haulage',
      'Redhills CFS & Logistics', 'Southern Marine Surveyors', 'Anchor Marine Insurance'
    );

delete from public.sailings where notes like 'Demo container%';

commit;
