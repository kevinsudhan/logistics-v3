-- ---------------------------------------------------------------------------
-- The sailing schedule: which vessels and flights go where, when.
--
-- WHY A TABLE OF ITS OWN
--
-- `sailings` (006, 026) is SPACE — one container on a departure, with a box
-- size and cargo placed in it. A schedule entry is the DEPARTURE itself: the
-- vessel and voyage, or the flight, from one port to another on a date, with
-- its cut-offs. Many containers, consoles and house shipments ride one
-- departure; they are not the same row, and folding them together would make
-- every container a copy of the vessel's dates.
--
-- USED WHERE A DEPARTURE IS NEEDED
--
-- A shipment, a console, a container and a quotation each point at the
-- schedule they were built from (`schedule_id`), and copy its dates onto
-- themselves when it is picked — a later change to the schedule is a new
-- fact for the desk to act on, not a silent change to a booking.
-- ---------------------------------------------------------------------------

create sequence if not exists public.sailing_schedule_seq;

create table if not exists public.sailing_schedules (
  id                 text primary key
                       default ('SAIL' || lpad(nextval('public.sailing_schedule_seq')::text, 7, '0')),
  mode               text not null default 'sea' check (mode in ('sea', 'air')),
  -- What the departure takes: LCL and/or FCL at sea, AIR for a flight.
  services           text[] not null default '{}'
                       check (services <@ array['LCL', 'FCL', 'AIR']),
  carrier            text,
  carrier_partner_id uuid references public.partners(id) on delete set null,
  vessel             text,
  voyage             text,
  flight_number      text,
  port_of_receipt    text,
  port_of_loading    text not null,
  port_of_discharge  text not null,
  final_destination  text,
  cfs_cutoff         date,
  port_cutoff        date,
  si_cutoff          date,
  etd                date not null,
  eta                date check (eta is null or eta >= etd),
  -- Days at sea or in the air, from the dates: never typed, never wrong.
  transit_days       int generated always as (eta - etd) stored,
  status             text not null default 'scheduled'
                       check (status in ('scheduled', 'closed', 'departed', 'cancelled')),
  notes              text,
  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists sailing_schedules_lane_idx
  on public.sailing_schedules (port_of_loading, port_of_discharge, etd);
create index if not exists sailing_schedules_etd_idx on public.sailing_schedules (etd);

alter table public.sailing_schedules enable row level security;
drop policy if exists sailing_schedules_all on public.sailing_schedules;
create policy sailing_schedules_all on public.sailing_schedules
  for all to authenticated using (true) with check (true);

-- Where a departure is used.
alter table public.shipments add column if not exists schedule_id text references public.sailing_schedules(id) on delete set null;
alter table public.consoles  add column if not exists schedule_id text references public.sailing_schedules(id) on delete set null;
alter table public.sailings  add column if not exists schedule_id text references public.sailing_schedules(id) on delete set null;
alter table public.quotes    add column if not exists schedule_id text references public.sailing_schedules(id) on delete set null;
