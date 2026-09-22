-- ---------------------------------------------------------------------------
-- Quotes go out only after somebody senior has seen them.
--
-- WHY THIS IS A STATE ON THE QUOTE AND NOT A SEPARATE TABLE
--
-- Because it is a property of the quote, not an event that happened near it.
-- "Has this been approved" must be answerable from the row you are about to
-- send, in the same query that loads it — not by joining a log and hoping the
-- newest entry is the relevant one. A second table would also allow the two to
-- disagree, and the disagreement would be discovered by a quotation reaching a
-- customer that nobody cleared.
--
-- WHY approval_status IS SEPARATE FROM status
--
-- They answer different questions and both have to be true to send. `status`
-- is where the quote is with the CUSTOMER — draft, sent, accepted. This is
-- where it is with US. Folding them into one column produces states like
-- "sent_but_not_approved" that mean nothing to either side, and loses the
-- ordinary case of a quote that was approved, sent, and then superseded.
-- ---------------------------------------------------------------------------

alter table public.quotes
  add column if not exists approval_status text not null default 'draft'
    check (approval_status in ('draft', 'pending', 'approved', 'rejected')),

  -- Who asked, and when. Kept because the useful question on the approval
  -- queue is "how long has this been waiting", which needs the submission
  -- time rather than the quote's creation time.
  add column if not exists submitted_at  timestamptz,
  add column if not exists submitted_by  uuid references auth.users(id) on delete set null,

  add column if not exists approved_at   timestamptz,
  add column if not exists approved_by   uuid references auth.users(id) on delete set null,

  -- Why it came back. Required on a rejection by the application, because a
  -- quotation returned with no reason is a quotation that gets resubmitted
  -- unchanged.
  add column if not exists approval_note text not null default '',

  -- ---------------------------------------------------------------------------
  -- The terms printed under the charges.
  --
  -- An array of {scope, text} rather than two text columns: the desk keeps
  -- general terms and terms that apply only to a mode ("air export"), the
  -- lists are of a length nobody can predict, and the ORDER is meaningful
  -- because terms are numbered on the document.
  --
  -- Copied onto the quote rather than referenced from the defaults table, so a
  -- quotation reprinted next year says what it said when it was sent. A term
  -- edited centrally must not silently rewrite a document a customer is
  -- holding.
  -- ---------------------------------------------------------------------------
  add column if not exists terms jsonb not null default '[]'::jsonb;

create index if not exists quotes_approval_idx
  on public.quotes (approval_status, submitted_at desc)
  where approval_status = 'pending';

comment on column public.quotes.approval_status is
  'Where the quote is with US. quotes.status is where it is with the customer.';


-- ---------------------------------------------------------------------------
-- Who may approve
--
-- A flag on the profile rather than a list of addresses in the application.
-- The two people who do this today are seeded below, but a hard-coded list
-- cannot be changed without a deploy — and the first time somebody is on leave
-- the desk needs a third approver that afternoon, not next release.
--
-- Deliberately not the same thing as `role = 'admin'`. Administering the system
-- and being allowed to commit the company to a price are different authorities,
-- and the person who does the first is not always the person who should do the
-- second.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists can_approve_quotes boolean not null default false;

update public.profiles
   set can_approve_quotes = true
 where lower(email) in ('aashish@aashishlogistics.com', 'parasu@aashishlogistics.com');

-- The same two, for accounts that have not signed in yet and so have no
-- profile row. A trigger rather than a one-off update, because the profile is
-- created on first sign-in and an update today cannot reach a row that does
-- not exist.
create or replace function public.grant_quote_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if lower(new.email) in ('aashish@aashishlogistics.com', 'parasu@aashishlogistics.com') then
    new.can_approve_quotes := true;
  end if;
  return new;
end $fn$;

drop trigger if exists profiles_seed_approvers on public.profiles;
create trigger profiles_seed_approvers
  before insert on public.profiles
  for each row execute function public.grant_quote_approval();


-- ---------------------------------------------------------------------------
-- The queue, and the two acts that empty it
--
-- RPCs rather than updates from the client, because each one has a rule the
-- client cannot be trusted with: only an approver may approve, and nobody may
-- approve their own quotation. The second is the one that matters — an
-- approval step you can perform on your own work is not an approval step.
-- ---------------------------------------------------------------------------
create or replace function public.submit_quote_for_approval(p_quote_id uuid)
returns public.quotes
language plpgsql
security definer
set search_path = public
as $fn$
declare v_row public.quotes;
begin
  update public.quotes
     set approval_status = 'pending',
         submitted_at    = now(),
         submitted_by    = auth.uid(),
         approval_note   = ''
   where id = p_quote_id
     and status = 'draft'
   returning * into v_row;

  if not found then
    raise exception 'that quote cannot be submitted: it is not a draft, or it does not exist';
  end if;
  return v_row;
end $fn$;

create or replace function public.decide_quote(
  p_quote_id uuid,
  p_approve  boolean,
  p_note     text default ''
) returns public.quotes
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row public.quotes;
  v_may boolean;
begin
  select can_approve_quotes into v_may from public.profiles where id = auth.uid();
  if not coalesce(v_may, false) then
    raise exception 'you are not an approver';
  end if;

  select * into v_row from public.quotes where id = p_quote_id;
  if not found then
    raise exception 'no such quote';
  end if;

  -- Nobody clears their own. The whole point of the step is a second pair of
  -- eyes, and one person doing both is the step not happening.
  if v_row.submitted_by = auth.uid() then
    raise exception 'a quotation cannot be approved by the person who submitted it';
  end if;

  if v_row.approval_status <> 'pending' then
    raise exception 'that quote is not waiting for approval';
  end if;

  if not p_approve and coalesce(btrim(p_note), '') = '' then
    raise exception 'say why it is being sent back';
  end if;

  update public.quotes
     set approval_status = case when p_approve then 'approved' else 'rejected' end,
         approved_at     = now(),
         approved_by     = auth.uid(),
         approval_note   = coalesce(p_note, '')
   where id = p_quote_id
   returning * into v_row;

  insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
  values (
    v_row.enquiry_ref,
    case when p_approve then 'quote_approved' else 'quote_rejected' end,
    case when p_approve
         then 'Quotation v' || v_row.version || ' approved to send'
         else 'Quotation v' || v_row.version || ' sent back: ' || coalesce(p_note, '')
    end,
    jsonb_build_object('quote_id', v_row.id, 'version', v_row.version),
    auth.uid()
  );

  return v_row;
end $fn$;

grant execute on function public.submit_quote_for_approval(uuid) to authenticated;
grant execute on function public.decide_quote(uuid, boolean, text) to authenticated;


-- ---------------------------------------------------------------------------
-- The standing terms, and where "Fetch defaults" reads from
--
-- Separate from the copies held on each quote. This table is what the desk
-- maintains; the quote holds what was actually printed. Editing one does not
-- rewrite the other, which is the only way a quotation reprinted in a year can
-- still say what the customer agreed to.
-- ---------------------------------------------------------------------------
create table if not exists public.quote_term_defaults (
  id        uuid primary key default gen_random_uuid(),
  -- 'general', or a mode: 'air', 'sea_lcl', 'sea_fcl', 'road'.
  scope     text not null default 'general',
  position  int  not null default 0,
  text      text not null,
  active    boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists quote_term_defaults_scope_idx
  on public.quote_term_defaults (scope, position) where active;

alter table public.quote_term_defaults enable row level security;

drop policy if exists quote_term_defaults_read on public.quote_term_defaults;
create policy quote_term_defaults_read on public.quote_term_defaults
  for select to authenticated using (true);

drop policy if exists quote_term_defaults_write on public.quote_term_defaults;
create policy quote_term_defaults_write on public.quote_term_defaults
  for all to authenticated using (true) with check (true);

-- A starting set, so the first quotation has something to fetch. Plain trade
-- terms rather than legal drafting: these are what a forwarder's quotation
-- actually says, and the desk will edit them.
insert into public.quote_term_defaults (scope, position, text)
select * from (values
  ('general', 1, 'Rates quoted are valid until the date shown above and are subject to space and equipment availability at the time of booking.'),
  ('general', 2, 'Rates are subject to change without notice in the event of a general rate increase, peak season surcharge, or currency fluctuation.'),
  ('general', 3, 'Charges are based on the cargo particulars provided. Any variation in weight, volume or commodity will be re-quoted.'),
  ('general', 4, 'Quotation excludes duties, taxes, demurrage, detention, storage, and any charge not expressly listed above.'),
  ('general', 5, 'Business is transacted subject to our standard trading conditions, a copy of which is available on request.'),
  ('air', 1, 'Chargeable weight is the greater of actual gross weight and volumetric weight, calculated at 6000 cubic centimetres per kilogram.'),
  ('air', 2, 'Rates exclude airline security, screening and fuel surcharges unless separately listed.'),
  ('sea_lcl', 1, 'Chargeable is the greater of one tonne or one cubic metre, per revenue tonne, subject to the minimum shown.'),
  ('sea_lcl', 2, 'Rates exclude destination terminal handling, delivery order and CFS charges unless separately listed.'),
  ('sea_fcl', 1, 'Rates are per container and assume standard free time at both ends. Detention and demurrage beyond free time are for the account of the customer.')
) as seed(scope, position, text)
where not exists (select 1 from public.quote_term_defaults);
