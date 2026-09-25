-- 095: Connect Outlook from inside the CRM, to the login's own mailbox only.
--
-- ---------------------------------------------------------------------------
-- WHY
--
-- "Connect Outlook" on the Mail page used to be the Microsoft sign-in itself:
-- it replaced the CRM session with whichever Microsoft account signed in. So
-- somebody signed in as info@ with a password who connected as aashish@ was
-- aashish@ in the CRM from then on, an administrator.
--
-- Now connecting is a separate Microsoft sign-in, run by the outlook-connect
-- function, that only adds a mailbox to the CRM session already open:
--
--   1. The Mail page asks the function to start. It notes this sign-in, a
--      one-time `state` and the PKCE verifier here, and sends the browser to
--      Microsoft with the login's own address filled in.
--   2. Microsoft sends the browser back to the function with a code. The
--      function takes the note (once: the row is deleted as it is read),
--      trades the code for tokens, asks Graph whose mailbox it is, and only if
--      it is the CRM login's own keeps the refresh token against that sign-in
--      in private.outlook_links (094) — from where outlook-token renews it as
--      for a Microsoft sign-in. Otherwise nothing is kept.
--   3. The browser comes back to the Mail page, still signed in as before.
--
-- A note older than 15 minutes is refused, a used one is gone, and every note
-- goes with its sign-in (foreign key). Older ones are cleared as new ones are
-- written. Only service_role may call these functions.
-- ---------------------------------------------------------------------------

create table if not exists private.outlook_pending (
  state_hash  text primary key,        -- SHA-256 of the state Microsoft carries back
  session_id  uuid not null references auth.sessions (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  verifier    text not null,           -- PKCE: useless without the code, which only the function sees
  return_to   text not null,           -- origin and path, from the allowed sites
  created_at  timestamptz not null default now()
);
alter table private.outlook_pending enable row level security;
revoke all on private.outlook_pending from public, anon, authenticated;

/* Notes a connect starting. A second start from the same sign-in replaces the first. */
create or replace function public.outlook_pending_put(p_state_hash text, p_session uuid, p_user uuid, p_verifier text, p_return_to text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from auth.sessions s where s.id = p_session and s.user_id = p_user) then
    return false;
  end if;
  delete from private.outlook_pending p where p.created_at < now() - interval '1 hour' or p.session_id = p_session;
  insert into private.outlook_pending (state_hash, session_id, user_id, verifier, return_to)
  values (p_state_hash, p_session, p_user, p_verifier, p_return_to);
  return true;
end $$;

/* Takes the note for a returning state, once. `fresh` is under 15 minutes old. */
create or replace function public.outlook_pending_take(p_state_hash text)
returns table (session_id uuid, user_id uuid, verifier text, return_to text, fresh boolean)
language sql
security definer
set search_path = ''
as $$
  delete from private.outlook_pending p
   where p.state_hash = p_state_hash
  returning p.session_id, p.user_id, p.verifier, p.return_to, p.created_at > now() - interval '15 minutes';
$$;

revoke all on function public.outlook_pending_put(text, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.outlook_pending_take(text) from public, anon, authenticated;
grant execute on function public.outlook_pending_put(text, uuid, uuid, text, text) to service_role;
grant execute on function public.outlook_pending_take(text) to service_role;
