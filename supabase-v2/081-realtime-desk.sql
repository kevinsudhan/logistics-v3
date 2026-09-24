-- 081: Enquiries, shipments, the intake queue and a job's steps change on
-- screen as they change in the database.
--
-- ---------------------------------------------------------------------------
-- WHY
--
-- 080 made quotes live, and the approvals page stopped needing a reload. The
-- rest of the desk still did: somebody books an enquiry and the colleague
-- looking at the board sees it as inbound until they press Refresh; a step
-- ticked on a job stays open on everybody else's worklist. With several
-- people on the desk at once, the screen is only as good as its last reload.
--
-- The pages listen for changes to these four tables (useTableChanges) and
-- read themselves again when one lands.
--
-- WHO SEES WHAT
--
-- Realtime applies each table's own read policy to every subscriber. All four
-- are readable by any signed-in user already (enquiries_read, shipments_read,
-- intake_read, shipment_checkpoints_read), so this publishes nothing that a
-- signed-in person could not already read. The anonymous customer pages do
-- not subscribe.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['enquiries', 'shipments', 'intake', 'shipment_checkpoints'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
