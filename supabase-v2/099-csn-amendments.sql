-- 099: Amending a filed CSN (SCA).
--
-- An amendment tells ICEGATE only what changed since the CSN it amends: a
-- house B/L added (S), one taken off (D), a seal or an address corrected (U).
-- To know what changed the CRM has to know what it sent. So every file now
-- keeps the form it was made from, and the amendment compares the console as
-- it is with the last live file made for it (lib/icegateCsn.ts, buildAmendment).
--
-- csn_file_new takes the form as a fifth argument and keeps it on the file's
-- row; the four-argument version goes, so there is one way to make a file.

alter table public.csn_files add column if not exists draft jsonb;

drop function if exists public.csn_file_new(uuid, text, text, int);

create or replace function public.csn_file_new(p_console uuid, p_event text, p_indicator text, p_houses int, p_draft jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id   text := (select s.icegate_id from public.icegate_settings s where s.id);
  v_now  timestamp := now() at time zone 'Asia/Kolkata';
  v_job  int;
  v_name text;
begin
  if auth.uid() is null then
    raise exception 'sign in first';
  end if;
  if coalesce(trim(v_id), '') = '' then
    raise exception 'set the desk''s ICEGATE ID first (CSN settings)';
  end if;
  if p_event not in ('SCE', 'SCX', 'SCA') or p_indicator not in ('P', 'T') then
    raise exception 'unknown CSN event or indicator';
  end if;
  insert into public.csn_files (console_id, event, indicator, houses, created_by, draft)
  values (p_console, p_event, p_indicator, greatest(coalesce(p_houses, 0), 0), auth.uid(), p_draft)
  returning job_no into v_job;
  v_name := format('F_SACHM22_%s_%s_%s_%s_DEC.json', p_event, upper(trim(v_id)), v_job, to_char(v_now, 'YYYYMMDD'));
  update public.csn_files set file_name = v_name where job_no = v_job;
  return jsonb_build_object('job_no', v_job, 'file_name', v_name, 'date', to_char(v_now, 'YYYYMMDD'), 'time', to_char(v_now, '"T"HH24:MI'));
end $$;

revoke all on function public.csn_file_new(uuid, text, text, int, jsonb) from public, anon;
grant execute on function public.csn_file_new(uuid, text, text, int, jsonb) to authenticated;
