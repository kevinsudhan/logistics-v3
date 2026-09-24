-- 080: Quotes change on screen as they change in the database.
--
-- ---------------------------------------------------------------------------
-- WHY
--
-- An admin clears a quotation on the approvals page; the person who asked for
-- it has the enquiry open and still sees "Waiting for approval" until they
-- reload — so they wait, or ask, for a decision that has already been made.
-- The enquiry page and the approvals page now listen for changes to `quotes`
-- (Supabase Realtime) and refresh the moment one lands.
--
-- WHO SEES WHAT
--
-- Realtime applies the table's own read policy to every subscriber, so this
-- publishes nothing a signed-in person could not already read (quotes_read);
-- the anonymous customer page does not subscribe.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'quotes'
  ) then
    alter publication supabase_realtime add table public.quotes;
  end if;
end $$;
