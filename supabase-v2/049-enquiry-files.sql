-- ---------------------------------------------------------------------------
-- The files an enquiry accumulates.
--
-- WHAT WAS WRONG
--
-- A forwarder's mailbox is attachments. The MSDS, the packing list, the
-- shipper's commercial invoice, the agent's draft bill of lading — every one of
-- them arrives as a file on a message, and until now every one of them stayed
-- there. The consequences were daily: the person who received it is the only
-- person who has it, "can you send me the MSDS again" is a normal sentence, and
-- a file needed at booking is three weeks up a thread nobody wants to scroll.
--
-- WHY A BUCKET AND NOT A URL BACK TO THE MESSAGE
--
-- A Graph attachment id is only resolvable by a token for the mailbox that
-- holds it. Storing the id would file the MSDS against the enquiry in a way
-- that works for exactly one member of staff — the one who already had it —
-- and breaks entirely when they leave. The bytes are copied because the point
-- is that the file stops belonging to a mailbox.
--
-- WHY THE BUCKET IS PRIVATE
--
-- Unlike `signatures` (004), which is public because a recipient's mail client
-- fetches those images while signed into nothing. These are customer commercial
-- documents — invoices with prices, party addresses, a shipper's HS codes — and
-- they are read inside the CRM by somebody who is signed in. Served through
-- short-lived signed urls.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('enquiry-files', 'enquiry-files', false)
on conflict (id) do nothing;


-- ---------------------------------------------------------------------------
-- The index of what is in the bucket
--
-- Storage holds bytes at a path. Everything worth knowing about a file — which
-- enquiry it belongs to, what it was called in the mail it came from, who filed
-- it and when — is here, because a bucket listing cannot answer any of it.
-- ---------------------------------------------------------------------------
create table if not exists public.enquiry_files (
  id            uuid primary key default gen_random_uuid(),
  enquiry_ref   text not null references public.enquiries(ref) on delete cascade,

  -- The name it had in the mail, shown as-is. Not the storage path: two mails
  -- three weeks apart both attaching "invoice.pdf" are two different invoices,
  -- so the path is uniquified and the display name is not.
  name          text not null,
  content_type  text not null default 'application/octet-stream',
  size_bytes    bigint,

  -- Where the bytes are, inside `enquiry-files`.
  path          text not null unique,

  -- Where it came from. 'mail' was filed off a message, 'upload' was put there
  -- by hand, 'generated' is a document this CRM produced and sent.
  source        text not null default 'mail'
                check (source in ('mail', 'upload', 'generated')),

  -- The message it was filed from, so the file can be traced back to the mail
  -- that carried it. Null for an upload. Deliberately NOT the way the file is
  -- fetched — see the note above about mailbox-bound ids.
  message_id    text,
  subject       text,

  filed_by      uuid references auth.users(id) on delete set null,
  filed_at      timestamptz not null default now()
);

create index if not exists enquiry_files_ref_idx on public.enquiry_files (enquiry_ref, filed_at desc);

-- The same attachment filed twice from the same message is one file, not two.
-- Hit whenever somebody presses save on a message they already saved — which
-- they will, because there is no way to tell from the message that they did.
create unique index if not exists enquiry_files_once_idx
  on public.enquiry_files (enquiry_ref, message_id, name)
  where message_id is not null;

alter table public.enquiry_files enable row level security;

-- Operations, not oversight: anybody working the desk needs the shipper's
-- packing list. Unlike the reply log in 045, which is a record OF the staff and
-- is the administrator's.
drop policy if exists enquiry_files_read on public.enquiry_files;
create policy enquiry_files_read on public.enquiry_files
  for select to authenticated using (true);

drop policy if exists enquiry_files_insert on public.enquiry_files;
create policy enquiry_files_insert on public.enquiry_files
  for insert to authenticated with check (filed_by = auth.uid());

-- Removable, unlike the reply log. A file is a thing rather than a record of
-- something that happened: the wrong attachment saved onto the wrong enquiry is
-- a mistake to undo, not history to preserve. Yours, or an administrator's.
drop policy if exists enquiry_files_delete on public.enquiry_files;
create policy enquiry_files_delete on public.enquiry_files
  for delete to authenticated
  using (
    filed_by = auth.uid()
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );


-- ---------------------------------------------------------------------------
-- Storage policies
--
-- Scoped to the bucket and to signed-in users. The path begins with the
-- enquiry reference, which is how a listing of one enquiry's files is possible
-- without trusting the client to filter.
-- ---------------------------------------------------------------------------
drop policy if exists "enquiry files are readable when signed in" on storage.objects;
create policy "enquiry files are readable when signed in"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'enquiry-files');

drop policy if exists "enquiry files may be filed when signed in" on storage.objects;
create policy "enquiry files may be filed when signed in"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'enquiry-files');

drop policy if exists "enquiry files may be removed when signed in" on storage.objects;
create policy "enquiry files may be removed when signed in"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'enquiry-files');
