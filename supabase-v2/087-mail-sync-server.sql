-- 087: Every mailbox's sent mail, copied by the server.
--
-- ---------------------------------------------------------------------------
-- WHY
--
-- 086 copies a mailbox's Sent Items from the browser of whoever is signed in
-- to it, so a mailbox whose owner has not opened the CRM is missing from Team
-- oversight until they do. The user asked for every mailbox, all the time.
--
-- HOW
--
-- The `mail-sync` edge function signs in to Microsoft as the CRM's own Azure
-- app (the one people sign in through), not as a person, and reads each CRM
-- login's Sent Items through Graph. That needs the application permission
-- Mail.ReadBasic.All, which only the tenant's Azure admin can grant; until
-- they do, each mailbox records Microsoft's refusal here and the page says so.
-- pg_cron asks the function every five minutes. The browser copy (086) keeps
-- running beside it: it is quicker just after a send, and it keeps Outlook's
-- preview line, which Mail.ReadBasic.All does not include.
--
-- Rows the server records carry no `synced_by` (it is nobody's session), so
-- only administrators read them.
-- ---------------------------------------------------------------------------

-- A mailbox the server has tried and failed has never been checked.
alter table public.mail_log_mailboxes
  alter column last_synced_at drop not null,
  add column if not exists server_error    text,
  add column if not exists server_error_at timestamptz;


-- ---------------------------------------------------------------------------
-- The one place rows are written, for a person's session (p_by) or the
-- server (p_by null). Not callable by anybody directly.
-- ---------------------------------------------------------------------------
create or replace function public.mail_log_upsert(p_box text, p_rows jsonb, p_by uuid)
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_n int;
begin
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
    select p_box,
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
           p_by,
           now()
      from src
    on conflict (mailbox, internet_message_id) do update
       set subject         = excluded.subject,
           -- The server copy has no preview; it must not wipe the one a
           -- person's session already recorded.
           preview         = coalesce(nullif(excluded.preview, ''), public.mail_log.preview),
           to_addrs        = excluded.to_addrs,
           cc_addrs        = excluded.cc_addrs,
           has_attachments = excluded.has_attachments,
           enquiry_ref     = coalesce(excluded.enquiry_ref, public.mail_log.enquiry_ref),
           kind            = excluded.kind,
           synced_at       = now()
    returning 1
  )
  select count(*) into v_n from upserted;

  -- Checked just now, even when there was nothing new (an empty list). A
  -- successful server run clears the server's last error.
  insert into public.mail_log_mailboxes (mailbox, last_synced_at, synced_by)
  values (p_box, now(), p_by)
  on conflict (mailbox) do update
     set last_synced_at = now(),
         synced_by      = p_by,
         server_error    = case when p_by is null then null else public.mail_log_mailboxes.server_error end,
         server_error_at = case when p_by is null then null else public.mail_log_mailboxes.server_error_at end;

  return v_n;
end $fn$;

revoke execute on function public.mail_log_upsert(text, jsonb, uuid) from public, anon, authenticated;


-- A person's session (086), now through mail_log_upsert.
create or replace function public.record_sent_mail(p_mailbox text, p_rows jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_box text := lower(btrim(coalesce(p_mailbox, '')));
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
  return public.mail_log_upsert(v_box, p_rows, auth.uid());
end $fn$;


-- The server (the mail-sync function, with the service key).
create or replace function public.record_sent_mail_server(p_mailbox text, p_rows jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_box text := lower(btrim(coalesce(p_mailbox, '')));
begin
  if v_box !~ '^[^@\s]+@[^@\s]+$' then
    raise exception 'Not a mailbox: %', p_mailbox;
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Expected a list of messages';
  end if;
  return public.mail_log_upsert(v_box, p_rows, null);
end $fn$;

-- Why the server could not read a mailbox, for the page to say.
create or replace function public.mail_sync_error(p_mailbox text, p_error text)
returns void
language sql
security definer
set search_path = public
as $fn$
  insert into public.mail_log_mailboxes (mailbox, last_synced_at, synced_by, server_error, server_error_at)
  values (lower(btrim(p_mailbox)), null, null, left(p_error, 500), now())
  on conflict (mailbox) do update
     set server_error    = excluded.server_error,
         server_error_at = excluded.server_error_at;
$fn$;

-- Which mailboxes the server copies: every CRM login, with where its last copy got to.
create or replace function public.mail_sync_targets()
returns table (mailbox text, last_sent timestamptz)
language sql
stable
security definer
set search_path = public
as $fn$
  select b.mailbox, (select max(l.sent_at) from public.mail_log l where l.mailbox = b.mailbox)
    from (select distinct lower(btrim(email)) as mailbox
            from public.profiles
           where email ~ '^[^@\s]+@[^@\s]+$') b
   order by 1;
$fn$;

revoke execute on function public.record_sent_mail_server(text, jsonb) from public, anon, authenticated;
revoke execute on function public.mail_sync_error(text, text)          from public, anon, authenticated;
revoke execute on function public.mail_sync_targets()                  from public, anon, authenticated;
grant  execute on function public.record_sent_mail_server(text, jsonb) to service_role;
grant  execute on function public.mail_sync_error(text, text)          to service_role;
grant  execute on function public.mail_sync_targets()                  to service_role;


-- ---------------------------------------------------------------------------
-- Every five minutes. The credentials are read from Vault when the job runs,
-- never written here: supabase-v2/set-mail-sync-secret.mjs puts the shared
-- secret in Vault and in the function's secrets together (as 073 does).
-- ---------------------------------------------------------------------------
select cron.unschedule('araxys-v2-mail-sync')
  where exists (select 1 from cron.job where jobname = 'araxys-v2-mail-sync');

select cron.schedule(
  'araxys-v2-mail-sync',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url     := 'https://izgbrdeybhbepftloxgk.supabase.co/functions/v1/mail-sync',
    headers := jsonb_build_object(
      'Content-Type',       'application/json',
      'Authorization',      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'mail_sync_anon_key'),
      'x-mail-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'mail_sync_secret')
    ),
    body    := jsonb_build_object('sweep', true),
    timeout_milliseconds := 120000
  );
  $cron$
);
