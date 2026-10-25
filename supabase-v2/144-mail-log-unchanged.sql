-- 144: The sent-mail copy writes only what is new or has changed.
--
-- ---------------------------------------------------------------------------
-- WHY
--
-- Both copies (086 from a person's session, 087 from the server every five
-- minutes) ask Outlook for what was sent since a few minutes before the last
-- message seen, so each run hands back mail the log already has. The upsert
-- rewrote every one of those rows regardless: by 25 Oct 2026, 39,497 updates
-- on a log of 1,434 rows. Each rewrite is a change the database's realtime
-- feed reads and sends to every open Team oversight page, which then reads its
-- thirteen tables again — every five minutes, for nothing.
--
-- HOW
--
-- The update keeps its rules (the server's empty preview does not wipe a
-- person's, a reference once found is kept) and is skipped when the row would
-- come out as it already is. The mailbox is still marked as checked on every
-- run, as before. The count returned is now of rows new or changed; nothing
-- shows it. mail_log.synced_at, which nothing reads, stays the time the row
-- last changed.
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
     -- The same row again is left alone (144).
     where (public.mail_log.subject, public.mail_log.preview, public.mail_log.to_addrs, public.mail_log.cc_addrs,
            public.mail_log.has_attachments, public.mail_log.enquiry_ref, public.mail_log.kind)
           is distinct from
           (excluded.subject, coalesce(nullif(excluded.preview, ''), public.mail_log.preview), excluded.to_addrs, excluded.cc_addrs,
            excluded.has_attachments, coalesce(excluded.enquiry_ref, public.mail_log.enquiry_ref), excluded.kind)
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
