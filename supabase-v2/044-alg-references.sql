-- ---------------------------------------------------------------------------
-- References the desk reads, and a second series for partner correspondence.
--
-- ALG09012-26  the twelfth enquiry opened in September 2026
-- PALG09003-26 the third partner conversation given a reference that month
--
-- ALG is the company. 09 is the month, 012 the number within that month, 26 the
-- year. The month is in the reference because it is the thing anybody says out
-- loud -- "the September one" -- and it keeps the running number short enough
-- to read over a phone.
--
-- WHY NOT ARX-C0001-E01
--
-- The old form numbered within a customer: the first enquiry from customer
-- C0001 was E01, their second E02. That is a sound scheme and it answers the
-- wrong question. Nobody on this desk asks "which enquiry of this customer's
-- is it"; they ask "which job is it", and two customers each having an E01
-- means the suffix alone never identifies anything. It also leaked the
-- customer's own id onto paperwork the customer receives.
--
-- ARX was the vendor's prefix. ALG is the company's.
--
-- WHY A SECOND SERIES RATHER THAN ONE
--
-- Because a rate negotiation with an agent is not a shipment and never becomes
-- one. Numbering it in the same run would leave gaps in the shipment series
-- that correspond to nothing a customer ever saw, and make "how many jobs did
-- we open in September" unanswerable from the references. PALG is its own
-- count.
--
-- WHY THE COUNTER RESETS EVERY MONTH
--
-- Because the month is already in the reference. A number that runs all year
-- beside a month that repeats is two facts saying the same thing, and the
-- number grows for no reason. 001 in October is not 001 in September.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- The counter
--
-- One row per series per month. `next_number` is taken under `for update`, the
-- same gapless treatment the invoice series gets in 030 -- not because a
-- statute requires it here, but because a reference is what a customer quotes
-- back at you, and two enquiries sharing one would be worse than any gap.
-- ---------------------------------------------------------------------------
create table if not exists public.reference_series (
  series       text not null,          -- 'ALG' or 'PALG'
  yy           text not null,          -- '26'
  mm           text not null,          -- '09'
  next_number  int  not null default 1,
  primary key (series, yy, mm)
);

alter table public.reference_series enable row level security;
-- No policies. It is touched only through the security-definer function below;
-- a counter anybody can update is a counter that will be updated.


/**
 * The next reference in a series, and moves the series on.
 *
 * `p_on` decides the month and year, so a reference allocated for something
 * that arrived last month can be made to say so. It defaults to today, which
 * is what every caller wants.
 */
create or replace function public.allocate_reference(
  p_series text,
  p_on     date default current_date
)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_yy text := to_char(p_on, 'YY');
  v_mm text := to_char(p_on, 'MM');
  v_n  int;
begin
  if p_series not in ('ALG', 'PALG') then
    raise exception 'Unknown reference series %', p_series
      using hint = 'ALG is a shipment enquiry; PALG is partner correspondence.';
  end if;

  insert into public.reference_series (series, yy, mm, next_number)
  values (p_series, v_yy, v_mm, 1)
  on conflict (series, yy, mm) do nothing;

  select next_number into v_n
    from public.reference_series
   where series = p_series and yy = v_yy and mm = v_mm
     for update;

  update public.reference_series
     set next_number = next_number + 1
   where series = p_series and yy = v_yy and mm = v_mm;

  -- ALG09012-26. Three digits carries 999 in a month, which this desk will not
  -- reach; if it ever does, lpad stops padding rather than truncating, so the
  -- reference grows a character instead of colliding.
  return p_series || v_mm || lpad(v_n::text, 3, '0') || '-' || v_yy;
end $fn$;

grant execute on function public.allocate_reference(text, date) to authenticated;


-- ---------------------------------------------------------------------------
-- Enquiries take the new form
--
-- `seq` stays on the table and stays unique per customer. It is no longer in
-- the reference, but it is still the answer to "how many times has this
-- customer come to us", and dropping a column to remove it from a string would
-- be throwing away the fact to change its presentation.
-- ---------------------------------------------------------------------------
create or replace function public.create_enquiry(
  p_customer_id text,
  p_source      text default 'manual',
  p_origin      text default null,
  p_destination text default null,
  p_cargo       text default null
) returns public.enquiries
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_seq int;
  v_ref text;
  v_row public.enquiries;
begin
  select coalesce(max(seq), 0) + 1 into v_seq
    from public.enquiries where customer_id = p_customer_id;

  v_ref := public.allocate_reference('ALG');

  insert into public.enquiries (ref, customer_id, seq, source, origin, destination, cargo)
  values (v_ref, p_customer_id, v_seq, p_source, p_origin, p_destination, p_cargo)
  returning * into v_row;

  insert into public.enquiry_events (enquiry_ref, kind, summary, actor)
  values (v_ref, 'created', format('Enquiry opened from %s', p_source), auth.uid());

  return v_row;
end $fn$;

grant execute on function public.create_enquiry(text, text, text, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- Partner correspondence that has been given a reference
--
-- A row appears here only when somebody presses the button. Most mail with an
-- agent is a line and an answer and wants no number at all; minting one for
-- every thread would spend the series on newsletters and leave the count
-- meaning nothing.
--
-- The conversation id is the key, because that is what Outlook threads on and
-- what the partner screen already groups by. It is not a foreign key to
-- anything: the mailbox is the record, and there is no messages table here to
-- point at.
-- ---------------------------------------------------------------------------
create table if not exists public.partner_threads (
  conversation_id text primary key,
  ref             text not null unique,   -- PALG09003-26
  partner_id      uuid not null references public.partners(id) on delete cascade,

  -- Kept so the list reads without opening every thread. Both are a snapshot
  -- from the moment the reference was given: the subject of a live thread can
  -- change under you, and what the reference was issued against should not.
  subject         text not null default '',
  note            text not null default '',

  assigned_by     uuid references auth.users(id),
  created_at      timestamptz not null default now()
);

create index if not exists partner_threads_partner_idx
  on public.partner_threads (partner_id, created_at desc);

alter table public.partner_threads enable row level security;

drop policy if exists partner_threads_read on public.partner_threads;
create policy partner_threads_read on public.partner_threads
  for select to authenticated using (true);

drop policy if exists partner_threads_insert on public.partner_threads;
create policy partner_threads_insert on public.partner_threads
  for insert to authenticated with check (true);

drop policy if exists partner_threads_update on public.partner_threads;
create policy partner_threads_update on public.partner_threads
  for update to authenticated using (true) with check (true);

-- Deliberately no delete policy, for the same reason enquiries have none: once
-- a reference has been quoted to an agent it is the name of that conversation,
-- and taking it back leaves them holding a number nothing answers to.


/**
 * Gives a partner conversation a PALG reference, once.
 *
 * Pressing twice returns what the first press produced rather than raising or
 * minting a second. That is the same rule as promote_enquiry and for the same
 * reason: the second press means "did that work?", and an error there reads as
 * a failure that has to be undone.
 */
create or replace function public.assign_partner_ref(
  p_conversation_id text,
  p_partner_id      uuid,
  p_subject         text default '',
  p_note            text default ''
) returns public.partner_threads
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row public.partner_threads;
begin
  select * into v_row from public.partner_threads where conversation_id = p_conversation_id;
  if found then
    return v_row;
  end if;

  if not exists (select 1 from public.partners where id = p_partner_id) then
    raise exception 'No partner %', p_partner_id;
  end if;

  insert into public.partner_threads (conversation_id, ref, partner_id, subject, note, assigned_by)
  values (
    p_conversation_id,
    public.allocate_reference('PALG'),
    p_partner_id,
    coalesce(p_subject, ''),
    coalesce(p_note, ''),
    auth.uid()
  )
  returning * into v_row;

  return v_row;
end $fn$;

grant execute on function public.assign_partner_ref(text, uuid, text, text) to authenticated;
