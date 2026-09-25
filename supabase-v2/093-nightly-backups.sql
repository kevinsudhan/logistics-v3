-- 093: A backup of the whole desk every night, kept for 30 days.
--
-- ---------------------------------------------------------------------------
-- WHY
--
-- On 25 Sep 2026 the project had no backups at all: the Free plan keeps none
-- and point-in-time recovery was off, while the desk was entering real
-- enquiries, quotations and shipments. A deleted row or a bad migration would
-- have been permanent.
--
-- WHAT RUNS
--
-- At 03:00 IST pg_cron asks the `db-backup` edge function, which calls
-- `backup_export()` below — every row of every table in `public`, the staff
-- accounts (not their passwords) and the list of stored files — gzips it and
-- files it in the private `backups` bucket as db/YYYY-MM-DD.json.gz. Anything
-- older than 30 days is removed. Each run is logged in `backup_runs`, which
-- the admin console shows, so a backup that stopped running is noticed.
--
-- The schema is not in the file: it is the numbered migrations in this folder.
-- Restoring is apply the migrations, then load the file
-- (supabase-v2/restore-backup.mjs). The Pro plan's own daily backups, when the
-- plan is upgraded, are a second copy of the whole database, schema included.
-- ---------------------------------------------------------------------------

create table if not exists public.backup_runs (
  id          uuid primary key default gen_random_uuid(),
  taken_at    timestamptz not null default now(),
  file        text,
  bytes       bigint,
  tables      int,
  rows        bigint,
  ok          boolean not null,
  error       text,
  trigger     text not null default 'schedule' check (trigger in ('schedule', 'manual'))
);

alter table public.backup_runs enable row level security;
drop policy if exists backup_runs_admin_read on public.backup_runs;
create policy backup_runs_admin_read on public.backup_runs for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);
revoke all on public.backup_runs from anon;


-- Everything, as one JSON document.
create or replace function public.backup_export()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  t       record;
  v_rows  jsonb;
  v_data  jsonb := '{}'::jsonb;
  v_count jsonb := '{}'::jsonb;
  v_total bigint := 0;
  v_n     bigint;
begin
  for t in
    select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
       and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
     order by c.relname
  loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb), count(*) from public.%I x', t.relname) into v_rows, v_n;
    v_data := v_data || jsonb_build_object(t.relname, v_rows);
    v_count := v_count || jsonb_build_object(t.relname, v_n);
    v_total := v_total + v_n;
  end loop;

  return jsonb_build_object(
    'format', 'araxys-crm-v2 backup 1',
    'taken_at', now(),
    'last_migration', '093',
    'counts', v_count,
    'rows', v_total,
    'public', v_data,
    -- Who can sign in, without their passwords: restored accounts sign in
    -- with Microsoft or are given a new password on the Staff accounts screen.
    'auth_users', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', u.id, 'email', u.email, 'created_at', u.created_at,
        'app_metadata', u.raw_app_meta_data, 'user_metadata', u.raw_user_meta_data,
        'banned_until', u.banned_until) order by u.email), '[]'::jsonb) from auth.users u),
    -- The files are not copied (they are in the same project); this says
    -- which should exist, for a restore to check against.
    'storage_objects', (select coalesce(jsonb_agg(jsonb_build_object(
        'bucket', o.bucket_id, 'name', o.name, 'size', o.metadata->>'size', 'created_at', o.created_at) order by o.bucket_id, o.name), '[]'::jsonb)
        from storage.objects o where o.bucket_id <> 'backups')
  );
end $fn$;

-- The same, as the text Postgres writes. What the edge function files: parsed
-- into JavaScript on the way, 48500.00 came out as 48500 and a long decimal
-- could lose digits; the text is exactly what the database holds.
create or replace function public.backup_export_text()
returns text
language sql
security definer
set search_path = public
as $fn$
  select public.backup_export()::text;
$fn$;

revoke execute on function public.backup_export()      from public, anon, authenticated;
revoke execute on function public.backup_export_text() from public, anon, authenticated;
grant  execute on function public.backup_export()      to service_role;
grant  execute on function public.backup_export_text() to service_role;


-- The private bucket the files go in. No policies: only the service key reads it.
insert into storage.buckets (id, name, public)
values ('backups', 'backups', false)
on conflict (id) do update set public = false;


-- 03:00 IST (21:30 UTC) every night. The secret is read from Vault at run
-- time (supabase-v2/set-backup-secret.mjs), as for tracking (073).
select cron.unschedule('araxys-v2-db-backup')
  where exists (select 1 from cron.job where jobname = 'araxys-v2-db-backup');

select cron.schedule(
  'araxys-v2-db-backup',
  '30 21 * * *',
  $cron$
  select net.http_post(
    url     := 'https://izgbrdeybhbepftloxgk.supabase.co/functions/v1/db-backup',
    headers := jsonb_build_object(
      'Content-Type',    'application/json',
      'Authorization',   'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'backup_anon_key'),
      'x-backup-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'backup_secret')
    ),
    body    := jsonb_build_object('trigger', 'schedule'),
    timeout_milliseconds := 120000
  );
  $cron$
);
