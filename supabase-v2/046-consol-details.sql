-- ---------------------------------------------------------------------------
-- What a consol agent asks for before they will take the cargo.
--
-- WHAT WAS ALREADY THERE
--
-- Most of it. 005 holds the route, the cargo, the piece dimensions, the weight
-- and the volume; 028 and 033 hold the shipper, consignee and notify blocks
-- with their GSTIN, IEC and state codes; the extractor catalogue already knows
-- about MSDS, UN packaging, reefer setpoints and wood treatment.
--
-- These are the ones a co-loader asks for that had nowhere to go, and the
-- symptom was always the same: the answer arrived in a mail, somebody read it,
-- and it stayed in the mail.
--
-- WHY THEY ARE ON THE ENQUIRY AND NOT THE SHIPMENT
--
-- Because they are answered before there is a shipment. A consol agent wants
-- the CFS, the cut-off and the DG class to quote at all — asking for them after
-- the booking exists is asking a week late, and `promote_enquiry` copies what
-- the enquiry knows onto the booking when it is made.
--
-- WHY CHARGEABLE WEIGHT IS NOT A COLUMN
--
-- It is `max(weight, volume)` in the mode's own ratio, and both sides are
-- already here. Storing it would be storing a third fact that must agree with
-- two others, and the day somebody corrects a weight without recomputing it,
-- the stored figure is a quotation that no longer matches its own cargo. It is
-- computed at the point of reading, in src/lib/chargeableWeight.ts, where the
-- rounding rules that differ by mode live with it.
-- ---------------------------------------------------------------------------

alter table public.enquiries
  -- Where the cargo is delivered to be consolidated. `pickup_location` already
  -- holds where it is collected FROM, which is a different place and usually a
  -- different city — a shipper in Tirupur delivering into a Chennai CFS.
  add column if not exists cfs_location        text,

  -- The date the consol agent stops accepting cargo for a sailing, and the
  -- date they stop accepting shipping instructions. `sailings.cutoff_date`
  -- holds the carrier's; these are the agent's own and are earlier.
  add column if not exists cargo_cutoff        date,
  add column if not exists si_cutoff           date,

  -- Printed on the packages and on the bill of lading. Free text because it is
  -- whatever the shipper stencilled on the crate, which is frequently nothing
  -- ("NIL") and occasionally three lines of Chinese.
  add column if not exists marks_and_numbers   text,

  -- Who pays the freight. Distinct from `payment_terms` on the shipment, which
  -- is when the customer pays us; this is which end of the shipment pays the
  -- carrier, and it changes who the agent invoices.
  add column if not exists freight_terms       text
    check (freight_terms is null or freight_terms in ('prepaid', 'collect')),

  -- The party to be told on arrival. Often the consignee and often not — a
  -- buyer's customs broker, typically — and a house B/L prints it either way.
  add column if not exists notify_name         text,
  add column if not exists notify_address      text,

  -- Dangerous goods, in the four facts a carrier's DG desk actually asks for.
  -- The catalogue already captures whether an MSDS exists and whether the
  -- carrier approved it; these are what goes on the declaration.
  add column if not exists un_number           text,
  add column if not exists imo_class           text,
  add column if not exists packing_group       text
    check (packing_group is null or packing_group in ('I', 'II', 'III')),
  add column if not exists flash_point_c       numeric;

comment on column public.enquiries.cfs_location is
  'Where cargo is delivered for consolidation. Not pickup_location, which is where it is collected from.';
comment on column public.enquiries.freight_terms is
  'Who pays the carrier: prepaid (shipper) or collect (consignee).';


-- ---------------------------------------------------------------------------
-- Carried onto the booking
--
-- `promote_enquiry` copies what was agreed onto the shipment so that later
-- edits to the enquiry are a correction of the sales record rather than a
-- silent change to a live booking. These belong in that copy: a B/L prints the
-- marks and the notify party, and the DG declaration prints the rest.
-- ---------------------------------------------------------------------------
alter table public.shipments
  add column if not exists cfs_location        text,
  add column if not exists cargo_cutoff        date,
  add column if not exists si_cutoff           date,
  add column if not exists marks_and_numbers   text,
  add column if not exists freight_terms       text
    check (freight_terms is null or freight_terms in ('prepaid', 'collect')),
  add column if not exists un_number           text,
  add column if not exists imo_class           text,
  add column if not exists packing_group       text
    check (packing_group is null or packing_group in ('I', 'II', 'III')),
  add column if not exists flash_point_c       numeric;
