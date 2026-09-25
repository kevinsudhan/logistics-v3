-- 094: Outlook stays connected for as long as the person is signed in.
--
-- ---------------------------------------------------------------------------
-- WHY
--
-- The CRM talks to Outlook with the Microsoft access token Supabase hands back
-- at sign-in, and that token lives about an hour. Supabase renews its own
-- session, not Microsoft's token, so an hour after signing in every send failed
-- with "Outlook is not connected" until the person signed in with Microsoft
-- again.
--
-- The sign-in also hands back Microsoft's refresh token (the offline_access
-- scope), which buys a new access token without asking the person anything —
-- but redeeming it needs the Azure app's client secret, which cannot be in the
-- browser. So the browser gives the refresh token to the `outlook-token`
-- function once, at sign-in, and asks that function for a fresh access token
-- whenever the one it holds runs out.
--
-- WHERE IT IS KEPT
--
-- One row per sign-in, not per person, in a schema no API role can reach:
--
--   - keyed by the Supabase session (auth.sessions), and deleted with it. A
--     sign-out deletes the session, so the Microsoft connection ends exactly
--     when the CRM one does, as it did before; the next sign-in connects
--     again. A token can only be used by a request carrying that session's own
--     sign-in, so a stolen row is no use to another account;
--   - encrypted by the function (AES-GCM, key OUTLOOK_TOKEN_KEY in the
--     function's secrets, the session id bound in as associated data), so the
--     database alone — a backup, a leaked dump — does not hold a usable token;
--   - outside `public`, so the nightly backup (093) never copies it and the
--     REST API cannot expose it. The function reaches it through the three
--     functions below, which only service_role may execute.
-- ---------------------------------------------------------------------------

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.outlook_links (
  session_id  uuid primary key references auth.sessions (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  token       text not null,          -- iv.ciphertext, base64url; see outlook-token
  linked_at   timestamptz not null default now(),
  renewed_at  timestamptz,
  renewals    int not null default 0
);
alter table private.outlook_links enable row level security;
revoke all on private.outlook_links from public, anon, authenticated;

/*
 * Keeps the (sealed) refresh token for a sign-in. `p_renewal` says it came back
 * from Microsoft in exchange for the previous one rather than from a new
 * sign-in. False when the session is not this person's — or no longer exists,
 * which is how a renewal racing a sign-out loses.
 */
create or replace function public.outlook_link_put(p_session uuid, p_user uuid, p_token text, p_renewal boolean default false)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from auth.sessions s where s.id = p_session and s.user_id = p_user) then
    return false;
  end if;
  insert into private.outlook_links as l (session_id, user_id, token)
  values (p_session, p_user, p_token)
  on conflict (session_id) do update
     set token      = excluded.token,
         linked_at  = case when p_renewal then l.linked_at else now() end,
         renewed_at = case when p_renewal then now() end,
         renewals   = case when p_renewal then l.renewals + 1 else 0 end;
  return true;
end $$;

/* The sealed refresh token for this person's sign-in, or null. */
create or replace function public.outlook_link_get(p_session uuid, p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select l.token from private.outlook_links l where l.session_id = p_session and l.user_id = p_user;
$$;

/*
 * Forgets a sign-in's connection (Microsoft refused the token), or all of a
 * person's (their account was disabled). Returns how many were forgotten.
 */
create or replace function public.outlook_link_drop(p_session uuid default null, p_user uuid default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare n int;
begin
  if p_session is null and p_user is null then
    raise exception 'outlook_link_drop needs a session or a person';
  end if;
  delete from private.outlook_links l
   where (p_session is null or l.session_id = p_session)
     and (p_user is null or l.user_id = p_user);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.outlook_link_put(uuid, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.outlook_link_get(uuid, uuid) from public, anon, authenticated;
revoke all on function public.outlook_link_drop(uuid, uuid) from public, anon, authenticated;
grant execute on function public.outlook_link_put(uuid, uuid, text, boolean) to service_role;
grant execute on function public.outlook_link_get(uuid, uuid) to service_role;
grant execute on function public.outlook_link_drop(uuid, uuid) to service_role;

/*
 * A tab closed without signing out leaves its sign-in, and so its row, behind:
 * nobody holds that sign-in any more, so nothing will use the token again. An
 * open CRM renews hourly (the mail copy alone calls Outlook every few minutes),
 * so three days without a renewal is a tab that is gone. Daily at 04:00 IST.
 */
select cron.schedule(
  'araxys-v2-outlook-links-prune',
  '30 22 * * *',
  $$delete from private.outlook_links where coalesce(renewed_at, linked_at) < now() - interval '3 days'$$
);
