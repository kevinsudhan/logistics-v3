-- ===========================================================================
-- 140: Reworking beside Direct; who a job is billed to (24 Oct 2026)
-- ---------------------------------------------------------------------------
-- The user, on the shipment page:
--
--   - Booking details has Direct, yes or no; it has Reworking, yes or no,
--     beside it.
--   - The Parties tab's Billing customer was a party of its own, typed in
--     again. A job is billed to its consignee or to its customer, both already
--     on that tab, so it is a choice between the two, kept on the shipment.
--
-- The billing_customer rows already in shipment_parties are left where they
-- are (the page no longer shows them); nothing is deleted.
-- ===========================================================================

alter table public.shipments
  add column if not exists reworking boolean not null default false,
  -- Unset until the desk chooses.
  add column if not exists billed_party text
    check (billed_party in ('consignee', 'customer'));

comment on column public.shipments.reworking is 'Reworking, yes or no: beside Direct in Booking details (140).';
comment on column public.shipments.billed_party is 'Who the job is billed to: its consignee, or its customer on the Parties tab (140).';
