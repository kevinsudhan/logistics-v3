-- 097: The CSN for ICEGATE, from an import console (SCE).
--
-- ---------------------------------------------------------------------------
-- WHAT
--
-- As consol agent the desk files the Cargo Summary Notification for an import
-- console: the carrier's master B/L as a consolidated line, and every house B/L
-- under it, 72 hours before the vessel arrives. ICEGATE takes it as a JSON file
-- in CBIC's format (docs/icegate-csn: the SACHM22 guide v1.6, 14 Aug 2026),
-- signed with the filer's Class III certificate and uploaded on ICEGATE.
--
-- The CRM builds the file (lib/icegateCsn.ts). This migration keeps what that
-- needs beyond the console and its bills:
--
--   icegate_settings  the desk's own identity on ICEGATE: its ICEGATE ID, its
--                     PAN (submitter and consolidator), the PAN of the person
--                     authorised to file, and the usual port of reporting.
--                     One row; everybody reads it, an administrator sets it.
--   consoles.csn_draft  the CSN form as last saved for the console: the codes
--                     and addresses the desk filled in, so a second attempt
--                     after an ICEGATE rejection starts from the first.
--   csn_files         every file made: its job number (ICEGATE wants a unique
--                     number per transmission from each sender, so it comes
--                     from a sequence and is never reused), its file name,
--                     test or live, who made it and when.
-- ---------------------------------------------------------------------------

create table if not exists public.icegate_settings (
  id                boolean primary key default true check (id),
  icegate_id        text not null default '',
  pan               text not null default '',
  authorised_pan    text not null default '',
  port_of_reporting text not null default '',
  updated_at        timestamptz not null default now(),
  updated_by        uuid references auth.users (id)
);
insert into public.icegate_settings (id) values (true) on conflict (id) do nothing;

alter table public.icegate_settings enable row level security;
revoke all on public.icegate_settings from public, anon;
grant select, update on public.icegate_settings to authenticated;

drop policy if exists icegate_settings_read on public.icegate_settings;
create policy icegate_settings_read on public.icegate_settings
  for select to authenticated using (true);

drop policy if exists icegate_settings_admin on public.icegate_settings;
create policy icegate_settings_admin on public.icegate_settings
  for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

alter table public.consoles add column if not exists csn_draft jsonb;

create sequence if not exists public.csn_job_seq;

create table if not exists public.csn_files (
  job_no      int primary key default nextval('public.csn_job_seq'),
  console_id  uuid references public.consoles (id) on delete set null,
  event       text not null default 'SCE' check (event in ('SCE', 'SCX', 'SCA')),
  indicator   text not null default 'P' check (indicator in ('P', 'T')),
  file_name   text not null default '',
  houses      int not null default 0,
  created_by  uuid references auth.users (id) default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists csn_files_console_idx on public.csn_files (console_id, created_at desc);

alter table public.csn_files enable row level security;
revoke all on public.csn_files from public, anon;
grant select on public.csn_files to authenticated;

drop policy if exists csn_files_read on public.csn_files;
create policy csn_files_read on public.csn_files
  for select to authenticated using (true);

/*
 * The next file: a job number from the sequence, and the name ICEGATE expects,
 * F_SACHM22_<event>_<ICEGATE ID>_<job no>_<yyyymmdd>_DEC.json, dated on India's
 * clock. Refused until the desk's ICEGATE ID is set: a file named for nobody
 * would be rejected before anybody read it.
 */
create or replace function public.csn_file_new(p_console uuid, p_event text, p_indicator text, p_houses int)
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
  insert into public.csn_files (console_id, event, indicator, houses, created_by)
  values (p_console, p_event, p_indicator, greatest(coalesce(p_houses, 0), 0), auth.uid())
  returning job_no into v_job;
  v_name := format('F_SACHM22_%s_%s_%s_%s_DEC.json', p_event, upper(trim(v_id)), v_job, to_char(v_now, 'YYYYMMDD'));
  update public.csn_files set file_name = v_name where job_no = v_job;
  return jsonb_build_object('job_no', v_job, 'file_name', v_name, 'date', to_char(v_now, 'YYYYMMDD'), 'time', to_char(v_now, '"T"HH24:MI'));
end $$;

revoke all on function public.csn_file_new(uuid, text, text, int) from public, anon;
grant execute on function public.csn_file_new(uuid, text, text, int) to authenticated;
