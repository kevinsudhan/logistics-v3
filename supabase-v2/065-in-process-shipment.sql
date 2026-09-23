-- ---------------------------------------------------------------------------
-- The in-process shipment: what it carries over from the enquiry, and what it
-- adds of its own.
--
-- WHAT WAS WRONG
--
-- `promote_enquiry` writes the customer, the sailing date and the agreed
-- amount, and nothing else. Every shipment has been born with no route, no
-- cargo, no mode, no terms and no consignee — the booking page said "Route not
-- recorded" about a job whose enquiry named both ports, and every document
-- drafted from a booking was missing what the enquiry already knew.
--
-- ONE HOME PER FACT
--
-- The enquiry and the shipment are one job. So:
--
--   JOB FACTS — service, trade, route, terms, the cargo and its size, DG — are
--   kept on the enquiry, edited from either page through the same panels, and
--   copied onto the shipment's own columns, which the documents and billing
--   read. Always, while the job is live: there is one answer to "what is the
--   cargo", not two that drift.
--
--   BOOKING PARTICULARS — consignee, notify, marks, HS code, cut-offs, freight
--   terms — belong to the shipment once it exists: the B/L is drafted from
--   it. The enquiry's values fill the shipment's BLANKS only, so an answer
--   read out of a later mail still lands without overwriting what operations
--   typed.
--
--   SHIPMENT-ONLY — the schedule, routings, extra parties, booking persons —
--   exist only here.
-- ---------------------------------------------------------------------------


-- ===========================================================================
-- 1. What the shipment page adds
-- ===========================================================================
alter table public.shipments
  -- When the job ships, as the desk records it. Not the booking timestamp:
  -- a job booked on the 3rd for the 18th ships on the 18th.
  add column if not exists shipment_date date,
  -- Direct: the carrier's own bill goes to the shipper and no house bill is
  -- issued. The alternative is ours, under a master — a consolidation.
  add column if not exists direct boolean not null default false,
  -- Who brought the cargo: our own sales ('self'), or an overseas agent who
  -- nominated it to us ('agent').
  add column if not exists routed text not null default 'self'
    check (routed in ('self', 'agent')),
  add column if not exists routed_agent_id uuid references public.partners(id) on delete set null,
  add column if not exists origin_booking_person text,
  add column if not exists destination_booking_person text,
  -- The schedule. Vessel and voyage exist since 010; a flight has neither.
  add column if not exists flight_number text,
  add column if not exists etd_time time,
  add column if not exists eta_time time,
  -- Where it is loaded and discharged. Not the origin and destination: a
  -- shipper in Sriperumbudur ships out of Chennai.
  add column if not exists port_of_loading text,
  add column if not exists port_of_discharge text,
  -- Where the B/L parties are written to. Never printed; used to send them
  -- the shipment's news.
  add column if not exists shipper_email text,
  add column if not exists consignee_email text,
  add column if not exists notify_email text;


-- ---------------------------------------------------------------------------
-- Routings: the legs, where there is more than one
--
-- A pickup by truck to the airport, a flight to Dubai, a truck to the
-- consignee. The schedule above is the main carriage; these are all of them,
-- with who is carrying each and whether it has happened.
-- ---------------------------------------------------------------------------
create table if not exists public.shipment_routings (
  id             uuid primary key default gen_random_uuid(),
  shipment_id    text not null references public.shipments(id) on delete cascade,
  position       int  not null default 0,
  move           text not null default 'road' check (move in ('road', 'air', 'sea', 'rail')),
  from_place     text,
  to_place       text,
  etd            date,
  eta            date,
  carrier        text,
  voyage_flight  text,
  vehicle_number text,
  driver_name    text,
  status         text not null default 'planned'
                   check (status in ('planned', 'in_transit', 'completed', 'cancelled')),
  created_at     timestamptz not null default now()
);
create index if not exists shipment_routings_idx on public.shipment_routings (shipment_id, position);

alter table public.shipment_routings enable row level security;
drop policy if exists shipment_routings_all on public.shipment_routings;
create policy shipment_routings_all on public.shipment_routings
  for all to authenticated using (true) with check (true);


-- ---------------------------------------------------------------------------
-- The parties beyond the three a B/L prints
--
-- Shipper, consignee and the first notify party are columns on the shipment
-- since 028/033 — the documents are drafted from them and they stay there.
-- These are the rest a job involves: the agents at each end, who is billed,
-- a second notify party, another forwarder, the customs house agent.
--
-- A partner or a customer is LINKED where one is chosen, and its name and
-- contact details COPIED: the link says who it is, the copy is what this job
-- was told — the same reason a B/L party is a copy.
-- ---------------------------------------------------------------------------
create table if not exists public.shipment_parties (
  id             uuid primary key default gen_random_uuid(),
  shipment_id    text not null references public.shipments(id) on delete cascade,
  role           text not null check (role in (
                   'destination_agent', 'origin_agent', 'billing_customer',
                   'notify_2', 'forwarder', 'customs_house_agent')),
  partner_id     uuid references public.partners(id) on delete set null,
  customer_id    text references public.customers(id) on delete set null,
  name           text,
  address        text,
  city           text,
  country        text,
  contact_person text,
  email          text,
  phone          text,
  gstin          text,
  notes          text,
  updated_at     timestamptz not null default now(),
  unique (shipment_id, role)
);

alter table public.shipment_parties enable row level security;
drop policy if exists shipment_parties_all on public.shipment_parties;
create policy shipment_parties_all on public.shipment_parties
  for all to authenticated using (true) with check (true);


-- ---------------------------------------------------------------------------
-- Attachments: what each file is, and whether it may be removed
--
-- The job's files already live in `enquiry_files` (049) — one store for the
-- enquiry and the shipment, because they are one job and a shipper's invoice
-- filed from a mail on day one is the same invoice operations needs on day
-- ten.
--
-- PROTECTED means it stays: only an admin can delete a protected file or take
-- the protection off. An issued B/L or a signed POD is not something a tidy-up
-- should be able to lose.
-- ---------------------------------------------------------------------------
alter table public.enquiry_files
  add column if not exists document_type    text,
  add column if not exists reference_number text,
  add column if not exists protected        boolean not null default false;

-- Type and reference are edited after upload; 049 gave no update policy.
drop policy if exists enquiry_files_update on public.enquiry_files;
create policy enquiry_files_update on public.enquiry_files
  for update to authenticated using (true) with check (true);

drop policy if exists enquiry_files_delete on public.enquiry_files;
create policy enquiry_files_delete on public.enquiry_files
  for delete to authenticated
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
    or (not protected and filed_by = auth.uid())
  );

create or replace function public.guard_file_protection()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if old.protected and not new.protected
     and auth.uid() is not null
     and not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  then
    raise exception 'only an admin can unprotect a file';
  end if;
  return new;
end $fn$;

drop trigger if exists enquiry_files_protection on public.enquiry_files;
create trigger enquiry_files_protection
  before update on public.enquiry_files
  for each row execute function public.guard_file_protection();


-- ===========================================================================
-- 2. The carry-over
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- At promotion: everything the enquiry knows, onto the new shipment
--
-- A BEFORE INSERT trigger rather than a longer insert in promote_enquiry, so
-- that any path that creates a shipment gets it — and a column added to both
-- tables later is added here once.
-- ---------------------------------------------------------------------------
create or replace function public.shipment_from_enquiry()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  e public.enquiries;
begin
  select * into e from public.enquiries where ref = new.enquiry_ref;
  if not found then
    return new;
  end if;

  -- Job facts.
  new.origin          := coalesce(new.origin, e.origin);
  new.destination     := coalesce(new.destination, e.destination);
  new.cargo           := coalesce(new.cargo, e.cargo);
  new.piece_count     := coalesce(new.piece_count, e.piece_count);
  new.volume_cbm      := coalesce(new.volume_cbm, e.volume_cbm);
  new.gross_weight_kg := coalesce(new.gross_weight_kg, e.gross_weight_kg);
  new.transport_mode  := coalesce(new.transport_mode, e.transport_mode);
  new.trade_direction := coalesce(new.trade_direction, e.trade_direction);
  new.incoterm        := coalesce(new.incoterm, e.incoterm);
  new.un_number       := coalesce(new.un_number, e.un_number);
  new.imo_class       := coalesce(new.imo_class, e.imo_class);
  new.packing_group   := coalesce(new.packing_group, e.packing_group);
  new.flash_point_c   := coalesce(new.flash_point_c, e.flash_point_c);
  new.msds_provided   := coalesce(new.msds_provided, e.msds_provided);

  -- Booking particulars, as a starting point.
  new.consignee_name    := coalesce(new.consignee_name, e.consignee_name);
  new.consignee_address := coalesce(new.consignee_address, e.consignee_address);
  new.consignee_country := coalesce(new.consignee_country, e.consignee_country);
  new.notify_name       := coalesce(new.notify_name, e.notify_name);
  new.notify_address    := coalesce(new.notify_address, e.notify_address);
  new.marks_and_numbers := coalesce(new.marks_and_numbers, e.marks_and_numbers);
  new.hs_code           := coalesce(new.hs_code, e.hs_code);
  new.package_count     := coalesce(new.package_count, e.package_count);
  new.package_type      := coalesce(new.package_type, e.package_type);
  new.net_weight_kg     := coalesce(new.net_weight_kg, e.net_weight_kg);
  new.cfs_location      := coalesce(new.cfs_location, e.cfs_location);
  new.cargo_cutoff      := coalesce(new.cargo_cutoff, e.cargo_cutoff);
  new.si_cutoff         := coalesce(new.si_cutoff, e.si_cutoff);
  new.freight_terms     := coalesce(new.freight_terms, e.freight_terms);

  -- Shipment-only, with the defaults the enquiry implies.
  new.shipment_date     := coalesce(new.shipment_date, e.ready_date, current_date);
  new.port_of_loading   := coalesce(new.port_of_loading, e.origin);
  new.port_of_discharge := coalesce(new.port_of_discharge, e.destination);
  new.etd               := coalesce(new.etd, new.sailing_date);

  return new;
end $fn$;

drop trigger if exists shipments_from_enquiry on public.shipments;
create trigger shipments_from_enquiry
  before insert on public.shipments
  for each row execute function public.shipment_from_enquiry();


-- ---------------------------------------------------------------------------
-- After promotion: the enquiry's job facts follow it; its particulars fill
-- blanks
--
-- Not once the job is delivered or cancelled — a closed job's record is what
-- happened, and a correction to the sales record afterwards must not rewrite
-- it.
-- ---------------------------------------------------------------------------
create or replace function public.shipment_follows_enquiry()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not exists (select 1 from public.shipments where enquiry_ref = new.ref) then
    return null;
  end if;

  update public.shipments s set
    -- Job facts: the enquiry's value, always.
    origin          = new.origin,
    destination     = new.destination,
    cargo           = new.cargo,
    piece_count     = new.piece_count,
    volume_cbm      = new.volume_cbm,
    gross_weight_kg = new.gross_weight_kg,
    transport_mode  = new.transport_mode,
    trade_direction = new.trade_direction,
    incoterm        = new.incoterm,
    un_number       = new.un_number,
    imo_class       = new.imo_class,
    packing_group   = new.packing_group,
    flash_point_c   = new.flash_point_c,
    msds_provided   = new.msds_provided,
    -- Particulars: only into a blank.
    consignee_name    = coalesce(s.consignee_name, new.consignee_name),
    consignee_address = coalesce(s.consignee_address, new.consignee_address),
    consignee_country = coalesce(s.consignee_country, new.consignee_country),
    notify_name       = coalesce(s.notify_name, new.notify_name),
    notify_address    = coalesce(s.notify_address, new.notify_address),
    marks_and_numbers = coalesce(s.marks_and_numbers, new.marks_and_numbers),
    hs_code           = coalesce(s.hs_code, new.hs_code),
    package_count     = coalesce(s.package_count, new.package_count),
    package_type      = coalesce(s.package_type, new.package_type),
    net_weight_kg     = coalesce(s.net_weight_kg, new.net_weight_kg),
    cfs_location      = coalesce(s.cfs_location, new.cfs_location),
    cargo_cutoff      = coalesce(s.cargo_cutoff, new.cargo_cutoff),
    si_cutoff         = coalesce(s.si_cutoff, new.si_cutoff),
    freight_terms     = coalesce(s.freight_terms, new.freight_terms),
    updated_at        = now()
   where s.enquiry_ref = new.ref
     and s.stage not in ('delivered', 'cancelled')
     -- Only when something the shipment carries actually moved, so opening a
     -- case file (which stamps details_read_at) does not touch the booking.
     and (row(old.origin, old.destination, old.cargo, old.piece_count, old.volume_cbm,
              old.gross_weight_kg, old.transport_mode, old.trade_direction, old.incoterm,
              old.un_number, old.imo_class, old.packing_group, old.flash_point_c,
              old.msds_provided, old.consignee_name, old.consignee_address,
              old.consignee_country, old.notify_name, old.notify_address,
              old.marks_and_numbers, old.hs_code, old.package_count, old.package_type,
              old.net_weight_kg, old.cfs_location, old.cargo_cutoff, old.si_cutoff,
              old.freight_terms)
          is distinct from
          row(new.origin, new.destination, new.cargo, new.piece_count, new.volume_cbm,
              new.gross_weight_kg, new.transport_mode, new.trade_direction, new.incoterm,
              new.un_number, new.imo_class, new.packing_group, new.flash_point_c,
              new.msds_provided, new.consignee_name, new.consignee_address,
              new.consignee_country, new.notify_name, new.notify_address,
              new.marks_and_numbers, new.hs_code, new.package_count, new.package_type,
              new.net_weight_kg, new.cfs_location, new.cargo_cutoff, new.si_cutoff,
              new.freight_terms));
  return null;
end $fn$;

drop trigger if exists enquiries_to_shipment on public.enquiries;
create trigger enquiries_to_shipment
  after update on public.enquiries
  for each row execute function public.shipment_follows_enquiry();


-- ---------------------------------------------------------------------------
-- Backfill: every live shipment gets what its enquiry knew
-- ---------------------------------------------------------------------------
update public.shipments s set
  origin          = coalesce(s.origin, e.origin),
  destination     = coalesce(s.destination, e.destination),
  cargo           = coalesce(s.cargo, e.cargo),
  piece_count     = coalesce(s.piece_count, e.piece_count),
  volume_cbm      = coalesce(s.volume_cbm, e.volume_cbm),
  gross_weight_kg = coalesce(s.gross_weight_kg, e.gross_weight_kg),
  transport_mode  = coalesce(s.transport_mode, e.transport_mode),
  trade_direction = coalesce(s.trade_direction, e.trade_direction),
  incoterm        = coalesce(s.incoterm, e.incoterm),
  un_number       = coalesce(s.un_number, e.un_number),
  imo_class       = coalesce(s.imo_class, e.imo_class),
  packing_group   = coalesce(s.packing_group, e.packing_group),
  flash_point_c   = coalesce(s.flash_point_c, e.flash_point_c),
  msds_provided   = coalesce(s.msds_provided, e.msds_provided),
  consignee_name    = coalesce(s.consignee_name, e.consignee_name),
  consignee_address = coalesce(s.consignee_address, e.consignee_address),
  consignee_country = coalesce(s.consignee_country, e.consignee_country),
  notify_name       = coalesce(s.notify_name, e.notify_name),
  notify_address    = coalesce(s.notify_address, e.notify_address),
  marks_and_numbers = coalesce(s.marks_and_numbers, e.marks_and_numbers),
  hs_code           = coalesce(s.hs_code, e.hs_code),
  package_count     = coalesce(s.package_count, e.package_count),
  package_type      = coalesce(s.package_type, e.package_type),
  net_weight_kg     = coalesce(s.net_weight_kg, e.net_weight_kg),
  cfs_location      = coalesce(s.cfs_location, e.cfs_location),
  cargo_cutoff      = coalesce(s.cargo_cutoff, e.cargo_cutoff),
  si_cutoff         = coalesce(s.si_cutoff, e.si_cutoff),
  freight_terms     = coalesce(s.freight_terms, e.freight_terms),
  shipment_date     = coalesce(s.shipment_date, e.ready_date, s.created_at::date),
  port_of_loading   = coalesce(s.port_of_loading, e.origin),
  port_of_discharge = coalesce(s.port_of_discharge, e.destination),
  etd               = coalesce(s.etd, s.sailing_date)
from public.enquiries e
where e.ref = s.enquiry_ref;
