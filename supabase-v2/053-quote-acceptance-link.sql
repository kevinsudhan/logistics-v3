-- ---------------------------------------------------------------------------
-- Letting the customer accept from the quotation mail.
--
-- WHY THE LINK DOES NOT ACCEPT ANYTHING BY ITSELF
--
-- This is the part that has to be right. Corporate mail is scanned: Outlook
-- Safe Links, Proofpoint, Mimecast and every antivirus gateway FETCH the URLs
-- in a message before the recipient ever sees it, to check where they go. A
-- link that accepts on GET is therefore accepted by a machine, minutes after
-- sending, without the customer having opened the mail.
--
-- So the link opens a page. The page shows the quotation and has a button, and
-- only pressing that button accepts anything. A scanner following the link
-- reads a quotation and changes nothing.
--
-- WHY A TOKEN AND NOT A LOGIN
--
-- Customers do not have accounts here and should not need one to say yes. The
-- token is 64 hex characters of randomness — not guessable, not derived from
-- the quote id, and useful for exactly one quotation.
--
-- WHAT THE TOKEN IS ALLOWED TO REACH
--
-- One quotation and the enquiry it belongs to, and only the fields printed on
-- the document. Not the cost column, not the margin, not the partner replies,
-- not any other enquiry. This is enforced by returning a fixed shape from a
-- security-definer function rather than by granting `anon` a policy on the
-- tables — a policy is a thing somebody widens later without thinking about
-- this; a function that lists its columns is not.
--
-- WHY IT EXPIRES
--
-- A link that works forever is one that is still live in a forwarded mailbox
-- two years later, against a rate that lapsed. It dies with the quotation's own
-- validity, and a month after issue where none was given.
-- ---------------------------------------------------------------------------

create table if not exists public.quote_links (
  id          uuid primary key default gen_random_uuid(),
  quote_id    uuid not null references public.quotes(id) on delete cascade,

  token       text not null unique,

  expires_at  timestamptz not null,

  -- Filled in when the customer presses the button. Kept on the link rather
  -- than only on the quote because it is evidence: who said yes, from what, and
  -- when. "We never agreed to that" is a conversation this answers.
  accepted_at    timestamptz,
  accepted_name  text,
  accepted_note  text,

  -- Withdrawn by the desk: a quotation superseded by a new version should stop
  -- being acceptable at the old price.
  revoked     boolean not null default false,

  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists quote_links_quote_idx on public.quote_links (quote_id);

alter table public.quote_links enable row level security;

-- The desk can see and manage them. `anon` gets NOTHING here — the public path
-- goes through the two functions below, which return a fixed shape.
drop policy if exists quote_links_read on public.quote_links;
create policy quote_links_read on public.quote_links
  for select to authenticated using (true);

drop policy if exists quote_links_write on public.quote_links;
create policy quote_links_write on public.quote_links
  for all to authenticated using (true) with check (true);


-- ---------------------------------------------------------------------------
-- Minting a link
--
-- One live link per quotation: asking twice returns the same token rather than
-- leaving two valid ones, so revoking is a single act.
-- ---------------------------------------------------------------------------
create or replace function public.issue_quote_link(p_quote_id uuid)
returns public.quote_links
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row   public.quote_links;
  v_quote public.quotes;
begin
  select * into v_quote from public.quotes where id = p_quote_id;
  if not found then
    raise exception 'no such quote';
  end if;

  -- Only a cleared quotation may be offered for acceptance. Without this, a
  -- link could carry a price nobody internally has agreed to.
  if v_quote.approval_status <> 'approved' then
    raise exception 'that quotation has not been approved to send';
  end if;

  select * into v_row from public.quote_links
   where quote_id = p_quote_id and not revoked and expires_at > now()
   limit 1;
  if found then return v_row; end if;

  insert into public.quote_links (quote_id, token, expires_at, created_by)
  values (
    p_quote_id,
    -- Two random uuids with the hyphens taken out: 64 hex characters, 256
    -- bits of randomness. NOT gen_random_bytes, which lives in pgcrypto in the
    -- `extensions` schema and is therefore invisible to a function whose
    -- search_path is pinned to public — pinning it is worth more than the
    -- tidier call.
    replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
    -- The quotation's own validity, where it has one. A link that outlives the
    -- rate it offers is a rate the desk has to honour after it lapsed.
    coalesce(v_quote.valid_until::timestamptz + interval '1 day', now() + interval '30 days'),
    auth.uid()
  )
  returning * into v_row;

  return v_row;
end $fn$;

grant execute on function public.issue_quote_link(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- What the customer's browser may read
--
-- A fixed shape, listing its columns. Everything internal is absent by
-- construction: no cost, no margin, no partner, no other enquiry.
-- ---------------------------------------------------------------------------
create or replace function public.quote_by_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_link  public.quote_links;
  v_quote public.quotes;
  v_enq   public.enquiries;
  v_cust  public.customers;
  v_lines jsonb;
begin
  select * into v_link from public.quote_links where token = p_token;
  if not found then
    return jsonb_build_object('state', 'unknown');
  end if;

  select * into v_quote from public.quotes    where id  = v_link.quote_id;
  select * into v_enq   from public.enquiries where ref = v_quote.enquiry_ref;
  select * into v_cust  from public.customers where id  = v_enq.customer_id;

  -- The charge lines as the document prints them. `cost_inr` is deliberately
  -- not selected: it is what a partner charges us, and a customer seeing it is
  -- the one mistake on this path that cannot be undone.
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'description', l.description,
             'unit',        l.unit,
             'quantity',    l.quantity,
             'rate',        l.rate,
             'currency',    l.currency,
             'amount_inr',  l.amount_inr
           ) order by l.position
         ), '[]'::jsonb)
    into v_lines
    from public.quote_lines l
   where l.quote_id = v_quote.id;

  return jsonb_build_object(
    'state', case
               when v_link.revoked                then 'revoked'
               when v_link.accepted_at is not null then 'accepted'
               when v_link.expires_at <= now()    then 'expired'
               when v_quote.status = 'declined'   then 'declined'
               else 'open'
             end,
    'accepted_at',   v_link.accepted_at,
    'accepted_name', v_link.accepted_name,
    'reference',     v_enq.ref,
    'version',       v_quote.version,
    'issued_on',     v_quote.created_at,
    'valid_until',   v_quote.valid_until,
    'amount_inr',    v_quote.amount_inr,
    'terms',         v_quote.terms,
    'customer',      coalesce(nullif(v_cust.company, ''), v_cust.name),
    'origin',        v_enq.origin,
    'destination',   v_enq.destination,
    'cargo',         v_enq.cargo,
    'ready_date',    v_enq.ready_date,
    'lines',         v_lines
  );
end $fn$;


-- ---------------------------------------------------------------------------
-- Saying yes
--
-- Called from the page, by a person pressing a button — never by following the
-- link, for the reason at the top of this file.
-- ---------------------------------------------------------------------------
create or replace function public.accept_quote_by_token(
  p_token text,
  p_name  text default null,
  p_note  text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_link  public.quote_links;
  v_quote public.quotes;
begin
  select * into v_link from public.quote_links where token = p_token for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;

  -- Accepting twice is not an error worth showing: the customer pressed the
  -- button again, or their browser retried. The answer is the same either way.
  if v_link.accepted_at is not null then
    return jsonb_build_object('ok', true, 'reason', 'already');
  end if;
  if v_link.revoked then
    return jsonb_build_object('ok', false, 'reason', 'revoked');
  end if;
  if v_link.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  select * into v_quote from public.quotes where id = v_link.quote_id;
  if v_quote.status = 'declined' then
    return jsonb_build_object('ok', false, 'reason', 'declined');
  end if;

  update public.quote_links
     set accepted_at   = now(),
         accepted_name = nullif(btrim(coalesce(p_name, '')), ''),
         accepted_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = v_link.id;

  update public.quotes
     set status       = 'accepted',
         responded_at = now(),
         -- How the written confirmation arrived, which is what the acceptance
         -- panel reads. This one came from the customer themselves.
         accepted_via = 'email',
         acceptance_note = coalesce(
           'Accepted from the quotation link' ||
           case when nullif(btrim(coalesce(p_name, '')), '') is not null
                then ' by ' || btrim(p_name) else '' end,
           ''
         )
   where id = v_quote.id;

  update public.enquiries set status = 'accepted', updated_at = now()
   where ref = v_quote.enquiry_ref;

  insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
  values (
    v_quote.enquiry_ref,
    'accepted',
    'Customer accepted quotation v' || v_quote.version || ' from the emailed link'
      || case when nullif(btrim(coalesce(p_name, '')), '') is not null
              then ' (' || btrim(p_name) || ')' else '' end,
    jsonb_build_object('quote_id', v_quote.id, 'via', 'link'),
    -- No actor: nobody at this desk did it, and attributing it to whoever sent
    -- the mail would put a person's name on a customer's decision.
    null
  );

  return jsonb_build_object('ok', true, 'reason', 'accepted');
end $fn$;

-- The public pair, and only these two. `anon` has no table policies here.
grant execute on function public.quote_by_token(text)                         to anon, authenticated;
grant execute on function public.accept_quote_by_token(text, text, text)      to anon, authenticated;
