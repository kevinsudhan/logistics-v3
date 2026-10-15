-- ---------------------------------------------------------------------------
-- 139: Manual documents, kept by B/L number.
--
-- WHAT IT IS FOR
--
-- The Manual documents page (Documentation → Manual documents) types in the
-- paper no job in the CRM holds yet: a job still being moved over from the old
-- system, an import that arrived before anybody opened a file. Until now what
-- was typed lived in the browser tab and went with it. Now every document
-- printed there with a B/L number is kept under that number, and typing the
-- number on the page lists what was made for it, to open again or download.
--
-- ONE ROW PER B/L AND DOCUMENT
--
-- The latest of each: printed again, the row is replaced, so a B/L lists its
-- arrival notice once rather than every draft of it. `doc_key` is the
-- document — 'arrival-notice', 'house-bl', and the freight invoice's two
-- forms, 'freight-invoice' and 'proforma-invoice', which are different papers.
-- `values` is what was typed, as the page holds it (the store the document
-- reads), so it opens back into the same form.
--
-- NOT A JOB
--
-- Nothing here is numbered from a sequence, filed on a job or sent. It is the
-- desk's record of what it typed, readable by the whole desk; a row is taken
-- out only by whoever saved it or an administrator.
-- ---------------------------------------------------------------------------

create table if not exists public.manual_documents (
  id           uuid primary key default gen_random_uuid(),
  -- The house B/L (or AWB) number it is kept under, as written on it: upper case, single spaces.
  bl_number    text not null check (btrim(bl_number) <> '' and length(bl_number) <= 80),
  doc_key      text not null check (doc_key ~ '^[a-z0-9-]{2,60}$'),
  -- Its name and printed number when saved, for the list.
  title        text not null default '',
  document_no  text not null default '',
  -- Which of the page's sets of details the document reads.
  store        text not null check (store in ('shipment', 'console', 'hbl', 'hawb')),
  "values"     jsonb not null default '{}'::jsonb check (jsonb_typeof("values") = 'object' and pg_column_size("values") < 524288),
  created_by   uuid references auth.users(id) default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id),
  updated_at   timestamptz not null default now(),
  unique (bl_number, doc_key)
);

-- "HBL/26-27/00" finds every B/L it begins.
create index if not exists manual_documents_bl_prefix on public.manual_documents (bl_number text_pattern_ops);

alter table public.manual_documents enable row level security;
revoke all on public.manual_documents from public, anon;
grant select, insert, update, delete on public.manual_documents to authenticated;

drop policy if exists manual_documents_read on public.manual_documents;
create policy manual_documents_read on public.manual_documents
  for select to authenticated using (true);

drop policy if exists manual_documents_write on public.manual_documents;
create policy manual_documents_write on public.manual_documents
  for insert to authenticated with check (true);

drop policy if exists manual_documents_update on public.manual_documents;
create policy manual_documents_update on public.manual_documents
  for update to authenticated using (true) with check (true);

drop policy if exists manual_documents_delete on public.manual_documents;
create policy manual_documents_delete on public.manual_documents
  for delete to authenticated
  using (
    created_by = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- The number written one way, whoever typed it; who saved it and when, whatever the browser sent.
create or replace function public.manual_documents_touch()
returns trigger
language plpgsql
as $fn$
begin
  new.bl_number := upper(btrim(regexp_replace(new.bl_number, '\s+', ' ', 'g')));
  new.title := btrim(new.title);
  new.document_no := btrim(new.document_no);
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := coalesce(auth.uid(), new.created_by);
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  return new;
end $fn$;

revoke execute on function public.manual_documents_touch() from public, anon;

drop trigger if exists manual_documents_touch on public.manual_documents;
create trigger manual_documents_touch
  before insert or update on public.manual_documents
  for each row execute function public.manual_documents_touch();
