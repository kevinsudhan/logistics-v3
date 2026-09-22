-- ---------------------------------------------------------------------------
-- The rate master.
--
-- WHAT IT IS FOR
--
-- Every quotation this desk builds is the same handful of charges — freight,
-- documentation, customs, THC, the administration fee — and for a lane the desk
-- runs weekly the figures barely move. Today each of them is typed in again
-- from somebody's memory of what we charged last time, which is how two
-- operators quote the same shipper two different documentation fees in a week.
--
-- This is where the figures live, so the quotation is assembled from them
-- rather than remembered.
--
-- WHY A RATE IS PER LANE AND NOT GLOBAL
--
-- Because freight is. A documentation fee may be the same everywhere and an
-- ocean freight never is, and a table that cannot express the difference forces
-- the freight line to be typed by hand anyway — which is the line that matters
-- most and the one most worth not getting wrong.
--
-- WHY origin AND destination ARE NULLABLE
--
-- Null means "any", and that is what makes the table small enough to maintain.
-- The administration fee is one row with both null. The Chennai documentation
-- fee is one row with an origin and no destination. Only freight needs the full
-- pair. Without the wildcards, a desk running twenty lanes would need twenty
-- copies of every fixed charge, and nineteen of them would go stale.
--
-- HOW A CONFLICT IS RESOLVED: THE MOST SPECIFIC ROW WINS
--
-- A rate naming both ends beats one naming the origin, which beats one naming
-- neither. That is the rule people already expect, because it is how they
-- think: "we charge 4,000 for documentation, except out of Chennai where it is
-- 4,500, except on the Jebel Ali run where it is 5,000." `specificity` scores
-- it so the resolution is one ORDER BY and not client-side reasoning that each
-- caller has to repeat.
--
-- WHY A DATE RANGE
--
-- Freight is quoted per validity period and the whole trade knows it. A rate
-- with no `valid_to` is standing until somebody changes it; one with dates is
-- offered only inside them, so an expired GRI does not quietly go on a
-- quotation a month after it lapsed.
-- ---------------------------------------------------------------------------

create table if not exists public.rate_cards (
  id            uuid primary key default gen_random_uuid(),

  -- What is being charged. Free text matching the labels in
  -- src/services/charges.ts rather than a foreign key: that catalogue is a
  -- front-end constant with SAC codes attached, and a desk needs to be able to
  -- add "ODC surcharge" without a migration.
  charge_head   text not null,
  sac_code      text,

  -- Where it applies. Null on any of these means "any" — see the note above.
  mode          text check (mode is null or mode in ('sea_lcl','sea_fcl','air','road')),
  direction     text check (direction is null or direction in ('export','import','cross_trade')),
  origin        text,
  destination   text,

  -- What it costs the customer, and what it costs us.
  unit          text not null default 'Shipment',
  currency      text not null default 'INR',
  sell_rate     numeric not null check (sell_rate >= 0),
  -- Optional, and deliberately never copied into the sell figure: a partner's
  -- price is a buying price, and putting one in front of a shipper sends them
  -- the agent's cost.
  cost_rate     numeric check (cost_rate is null or cost_rate >= 0),
  -- The floor. An LCL freight of USD 12 per CBM with a 3 CBM minimum is two
  -- facts, and a table holding only the first under-quotes every small
  -- consignment that goes on it.
  min_amount    numeric check (min_amount is null or min_amount >= 0),

  -- Whose rate it is, where it came from an agent. Informational: it says who
  -- to go back to when the figure is questioned.
  partner_id    uuid references public.partners(id) on delete set null,

  valid_from    date,
  valid_to      date,
  check (valid_from is null or valid_to is null or valid_to >= valid_from),

  notes         text not null default '',
  active        boolean not null default true,

  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- The lookup the quote builder makes: everything that could apply to one lane.
create index if not exists rate_cards_lane_idx
  on public.rate_cards (charge_head, origin, destination) where active;
create index if not exists rate_cards_active_idx on public.rate_cards (active);

alter table public.rate_cards enable row level security;

-- Operations, not oversight. Anybody quoting needs to read these, and the desk
-- that discovers a rate has moved is the desk that should be able to correct
-- it — a rate table only one person may edit is a rate table that goes stale.
drop policy if exists rate_cards_read on public.rate_cards;
create policy rate_cards_read on public.rate_cards
  for select to authenticated using (true);

drop policy if exists rate_cards_write on public.rate_cards;
create policy rate_cards_write on public.rate_cards
  for insert to authenticated with check (true);

drop policy if exists rate_cards_update on public.rate_cards;
create policy rate_cards_update on public.rate_cards
  for update to authenticated using (true);

drop policy if exists rate_cards_delete on public.rate_cards;
create policy rate_cards_delete on public.rate_cards
  for delete to authenticated using (true);


-- ---------------------------------------------------------------------------
-- The rates that apply to one shipment, best first
--
-- Returns every row that could apply, scored by how specifically it was
-- written, so the caller takes the first per charge head and is done. Doing
-- this in SQL rather than in the browser means the quote builder and anything
-- else that ever needs a rate resolve it the same way — and "which rate did it
-- use" has one answer rather than one per caller.
--
-- A null argument matches everything, which is what an enquiry with no
-- destination recorded yet should do: show the standing charges rather than
-- nothing at all.
-- ---------------------------------------------------------------------------
create or replace function public.rates_for(
  p_origin      text default null,
  p_destination text default null,
  p_mode        text default null,
  p_direction   text default null,
  p_on          date default current_date
) returns table (
  id            uuid,
  charge_head   text,
  sac_code      text,
  mode          text,
  direction     text,
  origin        text,
  destination   text,
  unit          text,
  currency      text,
  sell_rate     numeric,
  cost_rate     numeric,
  min_amount    numeric,
  partner_id    uuid,
  valid_from    date,
  valid_to      date,
  notes         text,
  specificity   int
)
language sql
stable
security invoker
set search_path = public
as $fn$
  select r.id, r.charge_head, r.sac_code, r.mode, r.direction, r.origin, r.destination,
         r.unit, r.currency, r.sell_rate, r.cost_rate, r.min_amount, r.partner_id,
         r.valid_from, r.valid_to, r.notes,
         -- Two points for naming a place, one for naming a mode or a
         -- direction. A row written for this exact lane therefore always beats
         -- one written for the mode in general, which is the order people mean.
         ((case when r.origin      is not null then 2 else 0 end) +
          (case when r.destination is not null then 2 else 0 end) +
          (case when r.mode        is not null then 1 else 0 end) +
          (case when r.direction   is not null then 1 else 0 end))::int as specificity
    from public.rate_cards r
   where r.active
     -- A null column is a wildcard; a null argument matches anything.
     and (r.origin      is null or p_origin      is null or lower(r.origin)      = lower(p_origin))
     and (r.destination is null or p_destination is null or lower(r.destination) = lower(p_destination))
     and (r.mode        is null or p_mode        is null or r.mode      = p_mode)
     and (r.direction   is null or p_direction   is null or r.direction = p_direction)
     and (r.valid_from is null or r.valid_from <= p_on)
     and (r.valid_to   is null or r.valid_to   >= p_on)
   order by specificity desc, r.updated_at desc;
$fn$;

grant execute on function public.rates_for(text, text, text, text, date) to authenticated;
