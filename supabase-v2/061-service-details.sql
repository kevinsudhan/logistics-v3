-- ---------------------------------------------------------------------------
-- The service being asked for, as the desk's enquiry form records it.
--
-- WHAT WAS ALREADY THERE
--
-- The mode (047), the direction (031), the lane and the Incoterm (005), and
-- the place cargo is collected from (005). What was missing is the handful of
-- facts that decide what the job actually includes:
--
--   pickup_required    Whether we collect from the shipper, or they deliver.
--                      Not the same as having a pickup address: an address can
--                      be known for a job where the shipper still delivers.
--   delivery_required  Whether we deliver at destination, and where to. A
--                      door delivery is a trucking leg and a set of charges;
--                      a port-to-port job has neither.
--   transit_days       What the customer was told, or asked for.
--   customer_reference The customer's own number for this — their PO or
--                      booking ref. It is what they quote when they chase, and
--                      what their accounts team looks for on our invoice.
--
-- WHY "OTHER" JOINS THE MODES
--
-- The form offers AIR, LCL, FCL and Others. Courier, rail and multimodal jobs
-- are real and rare, and forcing one into "road" to satisfy the check would
-- put a road ratio on its chargeable weight and a road checklist on its
-- booking. `other` has neither: no chargeable weight is claimed, and the
-- booking gets the default follow-ups.
-- ---------------------------------------------------------------------------

alter table public.enquiries
  add column if not exists pickup_required    boolean,
  add column if not exists delivery_required  boolean,
  add column if not exists delivery_location  text,
  add column if not exists transit_days       int check (transit_days is null or transit_days between 0 and 365),
  add column if not exists customer_reference text;

comment on column public.enquiries.customer_reference is
  'The customer''s own number for this job — their PO or booking reference.';

-- The mode check, widened to 'other' on both tables that carry it.
alter table public.enquiries drop constraint if exists enquiries_transport_mode_check;
alter table public.enquiries add constraint enquiries_transport_mode_check
  check (transport_mode is null or transport_mode in ('sea_lcl', 'sea_fcl', 'air', 'road', 'other'));

alter table public.shipments drop constraint if exists shipments_transport_mode_check;
alter table public.shipments add constraint shipments_transport_mode_check
  check (transport_mode is null or transport_mode in ('sea_lcl', 'sea_fcl', 'air', 'road', 'other'));
