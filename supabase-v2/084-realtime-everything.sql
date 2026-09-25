-- 084: Everything on an enquiry or a job changes on screen for everybody.
--
-- ---------------------------------------------------------------------------
-- WHY
--
-- 080 and 081 made the enquiry, the shipment, the intake queue, the quotes and
-- the job's steps live. What sits under them did not: a container added, a
-- pickup booked, a customs step ticked, a file filed, a partner's rate come in,
-- a HAWB saved, a tracking update, an invoice or a bill — each showed for
-- everybody else only after they reloaded. On a desk where the same job is
-- worked by two or three people in a day, that is a desk working from
-- different versions of the job.
--
-- This adds every table the enquiry page and the job file draw from, so that
-- whoever has the page open sees the change as it is made.
--
-- WHO SEES WHAT
--
-- Realtime applies each table's read policy to every subscriber. Every table
-- here is already readable by any signed-in user; nothing new is exposed. A
-- delete carries only the row's key.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array[
    -- the enquiry
    'enquiry_events', 'enquiry_parties', 'enquiry_dimensions', 'enquiry_files',
    'enquiry_messages', 'enquiry_threads', 'partner_assignments', 'partner_quotes',
    -- the job
    'shipment_containers', 'shipment_customs', 'shipment_movements', 'shipment_parties',
    'shipment_routings', 'shipment_track_links', 'warehouse_receipts',
    'house_airwaybills', 'house_airwaybill_history',
    'tracking_events', 'tracking_positions', 'tracking_snapshots',
    -- the money, and the console a job sits on
    'invoices', 'bills', 'consoles'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
