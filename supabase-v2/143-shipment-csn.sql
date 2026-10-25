-- ===========================================================================
-- 143: The IGM page: a job files its own CSN (25 Oct 2026)
-- ---------------------------------------------------------------------------
-- The user: the shipment page has an IGM page, with every particular of a
-- consol agent's Annexure III (Part II, the cargo declaration), filled from
-- what the CRM holds, and the JSON for ICEGATE downloaded from it.
--
-- A job on an import console is one house of the console's CSN (097): its
-- IGM page shows that form, the console's, which every house shares. A job
-- on no console — the desk's own master B/L with this one house under it —
-- files a CSN of its own: its form is kept on the job (csn_draft, as 097
-- keeps a console's), and its files are numbered from the same job-number
-- sequence, for the same ICEGATE sender, so an ACK finds the file it answers
-- whichever it was made for.
-- ===========================================================================

alter table public.shipments
  add column if not exists csn_draft jsonb;

comment on column public.shipments.csn_draft is 'The CSN form for a job filed on its own, off any console (143): as consoles.csn_draft.';

alter table public.csn_files
  add column if not exists shipment_id text references public.shipments (id) on delete set null;

create index if not exists csn_files_shipment_idx on public.csn_files (shipment_id, created_at desc);

-- A file is for a console or for a job: the job's own when p_shipment is given.
drop function if exists public.csn_file_new(uuid, text, text, int, jsonb);

create or replace function public.csn_file_new(
  p_console uuid,
  p_event text,
  p_indicator text,
  p_houses int,
  p_draft jsonb default null,
  p_shipment text default null
)
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
  if p_console is null and p_shipment is null then
    raise exception 'a CSN file is made for a console or for a job';
  end if;
  insert into public.csn_files (console_id, shipment_id, event, indicator, houses, created_by, draft)
  values (p_console, case when p_console is null then p_shipment end, p_event, p_indicator, greatest(coalesce(p_houses, 0), 0), auth.uid(), p_draft)
  returning job_no into v_job;
  v_name := format('F_SACHM22_%s_%s_%s_%s_DEC.json', p_event, upper(trim(v_id)), v_job, to_char(v_now, 'YYYYMMDD'));
  update public.csn_files set file_name = v_name where job_no = v_job;
  return jsonb_build_object('job_no', v_job, 'file_name', v_name, 'date', to_char(v_now, 'YYYYMMDD'), 'time', to_char(v_now, '"T"HH24:MI'));
end $$;

revoke all on function public.csn_file_new(uuid, text, text, int, jsonb, text) from public, anon;
grant execute on function public.csn_file_new(uuid, text, text, int, jsonb, text) to authenticated;
