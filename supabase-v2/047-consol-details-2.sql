-- ---------------------------------------------------------------------------
-- The rest of what the shipment details panel edits.
--
-- WHY THIS EXISTS SEPARATELY FROM 046
--
-- 046 added the fields that had nowhere at all to go. These are different: they
-- already exist, on `shipments`, put there by 028 and 033 for the bill of
-- lading and the packing list. The panel edits an ENQUIRY, so every one of them
-- was a field an operator could type into and not save — PostgREST answers a
-- patch naming a column that is not there with a 400, and the whole save fails,
-- including the fields that were fine.
--
-- The reasoning is 046's: a consol agent asks for the HS code and the package
-- count to quote, which is before there is a shipment to hold them. Adding them
-- here does not duplicate the shipment's copy, it feeds it — `promote_enquiry`
-- carries what was agreed onto the booking.
--
-- WHY transport_mode
--
-- The chargeable weight is computed per mode and the ratios are not
-- interchangeable: air converts at 6000 cm3 to the kilo, sea at a tonne to the
-- cube. Reading it off the sailing does not work, because an enquiry has no
-- sailing yet at the point somebody wants the figure, and `sailings.mode` is
-- LCL/FCL — which box, not which vehicle. Until this column, the panel had no
-- honest source and every enquiry computed as sea: an air consignment would
-- have shown a figure six times under its own rate.
-- ---------------------------------------------------------------------------

alter table public.enquiries
  -- How it travels. Drives which ratio the chargeable weight uses, so it is
  -- asked rather than guessed. FCL is here because it is a real answer to the
  -- question, even though FCL is charged per box and has no chargeable weight.
  add column if not exists transport_mode    text
    check (transport_mode is null or transport_mode in ('sea_lcl','sea_fcl','air','road')),

  -- Printed on the B/L under the consignee's name. `consignee_name` and
  -- `consignee_country` were already here; the address was not, which made the
  -- party block unfillable at enquiry stage.
  add column if not exists consignee_address text,

  -- The packing list and the customs entry. Package count and type are what
  -- the B/L says the cargo is ("42 cartons"), and are not the piece dimensions
  -- already here — those describe one piece for stowage.
  add column if not exists package_count     int,
  add column if not exists package_type      text,
  add column if not exists hs_code           text,

  -- Net of packaging. Distinct from `gross_weight_kg`, and it is the net that
  -- goes on a DG declaration and a certificate of origin.
  add column if not exists net_weight_kg     numeric,

  -- Whether the safety data sheet is in hand. The gate on a hazardous booking:
  -- no carrier's DG desk looks at the UN number without it.
  add column if not exists msds_provided     boolean;

comment on column public.enquiries.transport_mode is
  'How it travels. Selects the chargeable-weight ratio; see src/lib/chargeableWeight.ts.';
comment on column public.enquiries.net_weight_kg is
  'Net of packaging. gross_weight_kg includes it.';

-- Carried onto the booking, for the same reason as 046: the B/L prints these.
alter table public.shipments
  add column if not exists transport_mode    text
    check (transport_mode is null or transport_mode in ('sea_lcl','sea_fcl','air','road')),
  add column if not exists msds_provided     boolean;
