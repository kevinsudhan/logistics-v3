-- 100: Reading ICEGATE's reply to a CSN file.
--
-- ICEGATE answers each file with an ACK (read and checked: accepted, or
-- rejected with error codes) or an SFL (the structure failed). The desk
-- uploads that reply on the console; the CRM reads it (lib/icegateReply.ts),
-- finds the file answered by its job number and keeps what it said here:
--
--   csn_files.reply_status   accepted | rejected | failed; null while awaited
--   csn_files.reply          what the reply said, as read: the CSN number and
--                            date, the CINs, every error with where it is.
--                            The reply as read, not the file (no signature).
--   csn_files.replied_at/by  when, and who read it in
--
-- A live file ICEGATE rejected is not what ICEGATE holds, so the next
-- amendment compares with the last live file not rejected (services/icegateCsn
-- filedDraftFor).
--
-- An accepted live CSN also brings the cargo identification numbers Customs
-- gave: the master line's goes on the console (cin_type,
-- cargo_identification_no, 035), each house's on its job's customs record,
-- here.

alter table public.csn_files
  add column if not exists reply_status text check (reply_status in ('accepted', 'rejected', 'failed')),
  add column if not exists reply        jsonb,
  add column if not exists replied_at   timestamptz,
  add column if not exists replied_by   uuid references auth.users (id) on delete set null;

alter table public.shipment_customs
  add column if not exists cin_type text,
  add column if not exists cin_no   text;

/*
 * Keep a reply on the file it answers. The file list is read-only to staff,
 * so this is the one way to write on it. Reading the same reply again is
 * harmless: the last reading stands.
 */
create or replace function public.csn_file_reply(p_job int, p_status text, p_reply jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'sign in first';
  end if;
  if p_status not in ('accepted', 'rejected', 'failed') then
    raise exception 'unknown reply status';
  end if;
  if pg_column_size(p_reply) > 262144 then
    raise exception 'that reply is too large to keep';
  end if;
  update public.csn_files
     set reply_status = p_status, reply = p_reply, replied_at = now(), replied_by = auth.uid()
   where job_no = p_job;
  if not found then
    raise exception 'no CSN file with job number %', p_job;
  end if;
end $$;

revoke all on function public.csn_file_reply(int, text, jsonb) from public, anon;
grant execute on function public.csn_file_reply(int, text, jsonb) to authenticated;
