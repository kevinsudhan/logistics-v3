/**
 * Restores a nightly backup (093).
 *
 *   node supabase-v2/restore-backup.mjs --test [file]     prove a backup restores, touching nothing
 *   node supabase-v2/restore-backup.mjs --restore <file>  load it into this project's (empty) tables
 *
 * <file> is a db/YYYY-MM-DD.json.gz from the `backups` bucket or a local copy
 * (supabase-v2/backup-download.mjs). With --test and no file, today's copy in
 * the bucket is used.
 *
 * ---------------------------------------------------------------------------
 * HOW A RESTORE WORKS
 *
 * The backup is data only; the schema is the numbered migrations. So:
 *
 *   1. A project with the schema and no data: a new Supabase project with
 *      every migration applied (apply-all.mjs), or this one after a decision
 *      to empty it.
 *   2. This script loads every table in one transaction: parents before the
 *      tables that point at them (read from the target's foreign keys),
 *      generated columns left for the database to compute, identity values
 *      kept, and the tables' own triggers switched off for the load — they
 *      number, log and stamp, and a restore must put the rows back as they
 *      were rather than as new events. Sequences are moved past the highest
 *      value loaded. Any failure and nothing is kept.
 *   3. Staff accounts are in the backup without passwords: recreate them on
 *      the admin console's Staff accounts (same emails), and they sign in with
 *      Microsoft. Stored files are listed, not copied: they live in Storage,
 *      and a lost project needs them from a local copy (backup-download.mjs).
 *
 * --test runs step 2 into a scratch schema built like `public` — the same
 * tables, the same foreign keys between them — compares every table with the
 * live one, and rolls back. That is how the procedure itself is known to work.
 * ---------------------------------------------------------------------------
 */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { accessToken, PROJECT } from "./token.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const keys = JSON.parse(readFileSync(join(root, "server-v2", ".keys.json"), "utf-8"));
const mode = process.argv.includes("--restore") ? "restore" : process.argv.includes("--test") ? "test" : null;
const fileArg = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!mode) {
  console.error("usage: node supabase-v2/restore-backup.mjs --test [file] | --restore <file>");
  process.exit(1);
}
if (mode === "restore" && !fileArg) {
  console.error("--restore needs the backup file");
  process.exit(1);
}

async function loadText() {
  if (fileArg && !fileArg.startsWith("db/")) return gunzipSync(readFileSync(fileArg)).toString("utf-8");
  const name = fileArg ?? `db/${new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10)}.json.gz`;
  const r = await fetch(`https://${PROJECT}.supabase.co/storage/v1/object/backups/${name}`, {
    headers: { apikey: keys.service_role, Authorization: `Bearer ${keys.service_role}` },
  });
  if (!r.ok) throw new Error(`${name}: ${r.status} ${await r.text()}`);
  return gunzipSync(new Uint8Array(await r.arrayBuffer())).toString("utf-8");
}

const text = await loadText();
const doc = JSON.parse(text);
if (doc.format !== "araxys-crm-v2 backup 1") throw new Error(`not a backup this script knows: ${doc.format}`);
if (text.includes("$bk$")) throw new Error("the backup contains the SQL delimiter; cannot embed it safely");
console.log(`backup taken ${doc.taken_at}: ${Object.keys(doc.public).length} tables, ${doc.rows} rows, ${doc.auth_users.length} accounts`);

/*
 * The load, for any target schema. `target` is 'public' for a restore and
 * 'restore_test' for a test. Tables in parent-before-child order; a table the
 * target does not have (from a later migration) is reported, not guessed at.
 */
const load = (target) => `
  -- Parents first: a table's depth is one more than the deepest table it points at.
  create temp table _order on commit drop as
  with recursive fk as (
    select c.conrelid::regclass::text as child, c.confrelid::regclass::text as parent
      from pg_constraint c join pg_namespace n on n.oid = c.connamespace
     where c.contype = 'f' and n.nspname = '${target}' and c.conrelid <> c.confrelid
  ), tbl as (
    select c.relname, format('%I.%I', '${target}', c.relname)::regclass::text as qname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = '${target}' and c.relkind in ('r', 'p')
  ), depth(qname, d) as (
    select qname, 0 from tbl
    union all
    select k.child, depth.d + 1 from fk k join depth on depth.qname = k.parent where depth.d < 50
  )
  select t.relname, max(depth.d) as d from tbl t join depth on depth.qname = t.qname group by t.relname;

  for t in select relname from _order where doc -> 'public' ? relname order by d, relname loop
    -- Every column the database does not compute itself.
    select string_agg(format('%I', a.attname), ', ' order by a.attnum) into cols
      from pg_attribute a
     where a.attrelid = format('%I.%I', '${target}', t)::regclass and a.attnum > 0 and not a.attisdropped and a.attgenerated = '';
    execute format('alter table %I.%I disable trigger user', '${target}', t);
    execute format('insert into %I.%I (%s) overriding system value select %s from jsonb_populate_recordset(null::%I.%I, $1)',
                   '${target}', t, cols, cols, '${target}', t) using doc -> 'public' -> t;
    execute format('alter table %I.%I enable trigger user', '${target}', t);
    loaded := loaded + 1;
    -- Sequences past the highest value loaded.
    for s in
      select a.attname, pg_get_serial_sequence(format('%I.%I', '${target}', t), a.attname) as seq
        from pg_attribute a
       where a.attrelid = format('%I.%I', '${target}', t)::regclass and a.attnum > 0 and not a.attisdropped
         and pg_get_serial_sequence(format('%I.%I', '${target}', t), a.attname) is not null
    loop
      execute format('select setval(%L, greatest(coalesce((select max(%I) from %I.%I), 0), 1))', s.seq, s.attname, '${target}', t);
    end loop;
  end loop;
  missing := (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(doc -> 'public') k where not exists (select 1 from _order o where o.relname = k));
`;

const sql =
  mode === "test"
    ? `
do $t$
declare
  doc jsonb := $bk$${text}$bk$::jsonb;
  t text; cols text; s record; f record; a text; b text;
  loaded int := 0; missing jsonb; differ jsonb := '[]'::jsonb;
begin
  -- A schema built like public: the same tables and the same foreign keys between them.
  create schema restore_test;
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r', 'p')
              and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e') loop
    execute format('create table restore_test.%I (like public.%I including all)', t, t);
  end loop;
  for f in select c.conname, c.conrelid::regclass as child, pg_get_constraintdef(c.oid) as def,
                  (select n2.nspname from pg_class c2 join pg_namespace n2 on n2.oid = c2.relnamespace where c2.oid = c.confrelid) as ref_schema
             from pg_constraint c join pg_namespace n on n.oid = c.connamespace
            where c.contype = 'f' and n.nspname = 'public' loop
    execute format('alter table restore_test.%I add constraint %I %s', (select relname from pg_class where oid = f.child), f.conname,
                   case when f.ref_schema = 'public' then regexp_replace(f.def, 'REFERENCES (public\\.)?', 'REFERENCES restore_test.') else f.def end);
  end loop;
  ${load("restore_test")}
  for t in select relname from _order loop
    execute format('select md5(coalesce(string_agg(x::text, E''\\n'' order by x::text), '''')) from restore_test.%I x', t) into a;
    execute format('select md5(coalesce(string_agg(x::text, E''\\n'' order by x::text), '''')) from public.%I x', t) into b;
    if a <> b then differ := differ || to_jsonb(t); end if;
  end loop;
  raise exception 'RESULTS %', jsonb_build_object('loaded', loaded, 'foreign_keys', (select count(*) from pg_constraint c join pg_namespace n on n.oid = c.connamespace where c.contype = 'f' and n.nspname = 'restore_test'), 'not_in_target', missing, 'differ_from_live', differ);
end $t$;`
    : `
do $t$
declare
  doc jsonb := $bk$${text}$bk$::jsonb;
  t text; cols text; s record; u jsonb; loaded int := 0; missing jsonb; nonempty text; accounts int := 0;
begin
  -- The staff accounts, with the ids the data points at, email confirmed and
  -- no password: they sign in with Microsoft (linked by the email), or an
  -- administrator sets a password on Staff accounts.
  for u in select * from jsonb_array_elements(doc -> 'auth_users') loop
    if not exists (select 1 from auth.users where id = (u ->> 'id')::uuid) then
      insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, banned_until)
      values ('00000000-0000-0000-0000-000000000000', (u ->> 'id')::uuid, 'authenticated', 'authenticated', u ->> 'email', now(),
              coalesce(u -> 'app_metadata', '{}'::jsonb), coalesce(u -> 'user_metadata', '{}'::jsonb),
              coalesce((u ->> 'created_at')::timestamptz, now()), now(), (u ->> 'banned_until')::timestamptz);
      insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
      values ((u ->> 'id'), (u ->> 'id')::uuid, jsonb_build_object('sub', u ->> 'id', 'email', u ->> 'email', 'email_verified', true), 'email', now(), now());
      accounts := accounts + 1;
    end if;
  end loop;
  -- Creating an account makes its profile (handle_new_user); the backup's
  -- profiles are the real ones.
  delete from public.profiles where id in (select (e ->> 'id')::uuid from jsonb_array_elements(doc -> 'auth_users') e)
     and exists (select 1 from jsonb_array_elements(doc -> 'public' -> 'profiles') p where (p ->> 'id')::uuid = public.profiles.id);

  -- Only into empty tables: a restore over live data would duplicate or collide.
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r', 'p') loop
    execute format('select case when exists (select 1 from public.%I) then %L end', t, t) into nonempty;
    if nonempty is not null and doc -> 'public' ? nonempty then
      raise exception 'public.% already has rows: restore into an empty project', nonempty;
    end if;
  end loop;
  ${load("public")}
  raise notice 'RESTORED %', jsonb_build_object('accounts', accounts, 'loaded', loaded, 'not_in_target', missing);
end $t$;`;

const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${accessToken()}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: sql }),
});
const out = await r.text();
if (mode === "test") {
  const m = out.match(/RESULTS (\{.*?\})\\n/);
  console.log(m ? `test: ${m[1].replace(/\\"/g, '"')}` : `test failed: ${out.slice(0, 800)}`);
} else {
  console.log(r.ok ? "restored." : `restore failed, nothing kept: ${out.slice(0, 800)}`);
}
