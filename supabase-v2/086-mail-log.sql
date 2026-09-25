-- 086: A record of the mail the desk sends, for Team oversight.
--
-- ---------------------------------------------------------------------------
-- WHY
--
-- Oversight showed when an enquiry arrived and who took it on, and nothing of
-- the correspondence — which is most of the work. "What did Parasu send the
-- agent about ALG09004-26, and when" could only be answered by asking Parasu.
-- The CRM recorded replies (mail_replies, without their recipients) and a few
-- timeline events, and knew nothing at all of mail sent from Outlook itself.
--
-- WHERE THE ROWS COME FROM
--
-- Each person's own Sent Items. The Microsoft connection a person signs in
-- with belongs to their browser session, so whenever somebody has the CRM open
-- with Outlook connected it copies what they have sent since the last copy —
-- from the CRM or from Outlook alike — into this table (src/services/
-- mailLog.ts), and again just after every send from the CRM. Mail sent while
-- nobody from that mailbox has the CRM open arrives the next time they do.
--
-- WHAT IS KEPT
--
-- Enough to see who wrote to whom about what: the mailbox, the recipients, the
-- subject, the first lines Outlook itself previews, whether it had
-- attachments, when it went, and the job it concerns — from our subject token,
-- or from the thread having been filed to an enquiry. Not the body.
--
-- WHO SEES IT
--
-- Administrators, on the Team oversight page (itself behind a second
-- password), and each person their own. Nobody else reads a colleague's sent
-- mail from here.
-- ---------------------------------------------------------------------------

create table if not exists public.mail_log (
  id                  uuid primary key default gen_random_uuid(),
  -- The address it was sent from, lower case.
  mailbox             text not null,
  -- The RFC 5322 Message-ID: the same in every mailbox and never reused.
  internet_message_id text not null,
  -- Graph's id for it, which only means something inside that mailbox.
  graph_id            text,
  conversation_id     text,
  sent_at             timestamptz not null,
  subject             text not null default '',
  preview             text not null default '',
  -- [{name, address}]
  to_addrs            jsonb not null default '[]'::jsonb,
  cc_addrs            jsonb not null default '[]'::jsonb,
  has_attachments     boolean not null default false,
  enquiry_ref         text,
  kind                text not null default 'other',
  -- Whose session copied it in: the person signed in to that mailbox.
  synced_by           uuid references auth.users(id) on delete set null,
  synced_at           timestamptz not null default now(),
  unique (mailbox, internet_message_id)
);

create index if not exists mail_log_sent_idx    on public.mail_log (sent_at desc);
create index if not exists mail_log_mailbox_idx on public.mail_log (mailbox, sent_at desc);
create index if not exists mail_log_ref_idx     on public.mail_log (enquiry_ref);

alter table public.mail_log enable row level security;

drop policy if exists mail_log_read on public.mail_log;
create policy mail_log_read on public.mail_log for select to authenticated using (
  synced_by = auth.uid()
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);
-- No insert or update policy: rows arrive through record_sent_mail only.

revoke all on public.mail_log from anon;

-- When each mailbox was last checked, whether or not anything new was found:
-- a mailbox nobody has checked for a day is not a person who sent nothing.
create table if not exists public.mail_log_mailboxes (
  mailbox        text primary key,
  last_synced_at timestamptz not null default now(),
  synced_by      uuid references auth.users(id) on delete set null
);

alter table public.mail_log_mailboxes enable row level security;

drop policy if exists mail_log_mailboxes_read on public.mail_log_mailboxes;
create policy mail_log_mailboxes_read on public.mail_log_mailboxes for select to authenticated using (
  synced_by = auth.uid()
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);

revoke all on public.mail_log_mailboxes from anon;


-- ---------------------------------------------------------------------------
-- Copying a batch in
--
-- p_rows: [{internet_message_id, graph_id, conversation_id, sent_at, subject,
-- preview, to, cc, has_attachments, enquiry_ref, kind}]. Upserted on the
-- mailbox and Message-ID, so copying the same mail twice changes nothing but
-- the time it was last seen. The job is the subject's token if it has one,
-- else the enquiry its thread or message was filed to. Every call, an empty
-- one included, marks the mailbox as checked.
--
-- The mailbox is the caller's word for it — a shared one like info@ has no
-- login of its own to check against — and every row carries whose session
-- recorded it.
-- ---------------------------------------------------------------------------
create or replace function public.record_sent_mail(p_mailbox text, p_rows jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_box text := lower(btrim(coalesce(p_mailbox, '')));
  v_n   int;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if v_box !~ '^[^@\s]+@[^@\s]+$' then
    raise exception 'Not a mailbox: %', p_mailbox;
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Expected a list of messages';
  end if;

  with src as (
    select r
      from jsonb_array_elements(p_rows) r
     where coalesce(r ->> 'internet_message_id', '') <> ''
       and coalesce(r ->> 'sent_at', '') <> ''
  ),
  upserted as (
    insert into public.mail_log (
      mailbox, internet_message_id, graph_id, conversation_id, sent_at, subject, preview,
      to_addrs, cc_addrs, has_attachments, enquiry_ref, kind, synced_by, synced_at
    )
    select v_box,
           r ->> 'internet_message_id',
           r ->> 'graph_id',
           r ->> 'conversation_id',
           (r ->> 'sent_at')::timestamptz,
           left(coalesce(r ->> 'subject', ''), 500),
           left(coalesce(r ->> 'preview', ''), 300),
           coalesce(r -> 'to', '[]'::jsonb),
           coalesce(r -> 'cc', '[]'::jsonb),
           coalesce((r ->> 'has_attachments')::boolean, false),
           coalesce(
             nullif(upper(r ->> 'enquiry_ref'), ''),
             (select t.enquiry_ref from public.enquiry_threads t where t.conversation_id = r ->> 'conversation_id' limit 1),
             (select m.enquiry_ref from public.enquiry_messages m where m.message_id = r ->> 'graph_id' limit 1)
           ),
           coalesce(nullif(r ->> 'kind', ''), 'other'),
           auth.uid(),
           now()
      from src
    on conflict (mailbox, internet_message_id) do update
       set subject         = excluded.subject,
           preview         = excluded.preview,
           to_addrs        = excluded.to_addrs,
           cc_addrs        = excluded.cc_addrs,
           has_attachments = excluded.has_attachments,
           enquiry_ref     = coalesce(excluded.enquiry_ref, public.mail_log.enquiry_ref),
           kind            = excluded.kind,
           synced_at       = now()
    returning 1
  )
  select count(*) into v_n from upserted;

  -- Checked just now, even when there was nothing new (an empty list).
  insert into public.mail_log_mailboxes (mailbox, last_synced_at, synced_by)
  values (v_box, now(), auth.uid())
  on conflict (mailbox) do update
     set last_synced_at = now(),
         synced_by      = auth.uid();

  return v_n;
end $fn$;

-- Where the last copy of a mailbox got to, so the next asks only for what is newer.
create or replace function public.mail_log_since(p_mailbox text)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $fn$
  select max(sent_at) from public.mail_log where mailbox = lower(btrim(p_mailbox));
$fn$;

revoke execute on function public.record_sent_mail(text, jsonb) from public, anon;
revoke execute on function public.mail_log_since(text)          from public, anon;
grant  execute on function public.record_sent_mail(text, jsonb) to authenticated;
grant  execute on function public.mail_log_since(text)          to authenticated;


-- Live on the oversight page (084).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mail_log'
  ) then
    alter publication supabase_realtime add table public.mail_log;
  end if;
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mail_log_mailboxes'
  ) then
    alter publication supabase_realtime add table public.mail_log_mailboxes;
  end if;
end $$;
