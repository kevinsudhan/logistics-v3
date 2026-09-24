-- 083: Free time, demurrage and detention, per box.
--
-- ---------------------------------------------------------------------------
-- WHAT IT IS
--
-- The carrier lets a full container sit at the port, or stay out with the
-- consignee, for a number of free days. After that it charges by the day, per
-- box: demurrage while the box is in the terminal, detention while it is out
-- of the terminal and not yet back as an empty. Some carriers grant the two
-- as one combined allowance instead. Nobody on the desk was counting, so the
-- first sign of a lapsed free period was the carrier's invoice.
--
-- THE TERMS ARE THE JOB'S; THE DATES ARE THE BOX'S
--
-- The free days and the tariff come with the booking (the carrier grants them
-- against the bill), so they are columns on the shipment. The dates that start
-- and stop each clock happen to each container separately — one box is
-- collected on Monday, the other waits for a truck till Thursday — so they are
-- columns on shipment_containers:
--
--   import   discharged_on      the box comes off the ship    demurrage starts
--            gate_out_on        leaves the terminal full      demurrage stops, detention starts
--            empty_returned_on  comes back empty to the line  detention stops
--
--   export   empty_picked_on    collected empty for stuffing  detention starts
--            gate_in_on         enters the terminal full      detention stops, demurrage starts
--            loaded_on          loaded onto the ship          demurrage stops
--
-- Combined free time runs from the first date to the last. A shipper-owned box
-- (is_soc) pays no detention: it is not the line's box to return.
--
-- The counting — calendar days, the day a clock starts as day one, in IST —
-- lives in src/lib/freeTime.ts, where it is tested, not here.
-- ---------------------------------------------------------------------------

alter table public.shipments
  add column if not exists free_time_basis     text not null default 'separate',
  add column if not exists demurrage_free_days int,
  add column if not exists detention_free_days int,
  add column if not exists combined_free_days  int,
  -- Per box, per day, once free time has run out. Optional: without one the
  -- clock still says how many days are over, just not what they cost.
  add column if not exists demurrage_rate      numeric(12, 2),
  add column if not exists detention_rate      numeric(12, 2),
  add column if not exists combined_rate       numeric(12, 2),
  add column if not exists dnd_currency        text not null default 'USD';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'shipments_free_time_check') then
    alter table public.shipments add constraint shipments_free_time_check check (
          free_time_basis in ('separate', 'combined')
      and (demurrage_free_days is null or demurrage_free_days between 0 and 365)
      and (detention_free_days is null or detention_free_days between 0 and 365)
      and (combined_free_days  is null or combined_free_days  between 0 and 365)
      and (demurrage_rate is null or demurrage_rate >= 0)
      and (detention_rate is null or detention_rate >= 0)
      and (combined_rate  is null or combined_rate  >= 0)
      and dnd_currency ~ '^[A-Z]{3}$'
    );
  end if;
end $$;

alter table public.shipment_containers
  add column if not exists discharged_on     date,
  add column if not exists gate_out_on       date,
  add column if not exists empty_returned_on date,
  add column if not exists empty_picked_on   date,
  add column if not exists gate_in_on        date,
  add column if not exists loaded_on         date;
