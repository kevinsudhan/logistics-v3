-- ---------------------------------------------------------------------------
-- The charge grid a forwarder actually quotes on.
--
-- WHAT WAS MISSING
--
-- 039 gave a line a sell rate, a currency, an exchange rate and a single
-- `cost_inr`. That is enough to show a margin and not enough to build a
-- quotation, because the buying side has its own shape:
--
--   * The cost arrives in the agent's currency, not ours. An agent quoting
--     USD 140 per tonne is a USD figure with a USD rate of exchange, and
--     storing only its rupee equivalent loses what was actually agreed — so
--     when the rate moves, nobody can tell whether the agent put their price
--     up or the rupee fell.
--
--   * A charge has a minimum. "USD 12 per CBM, minimum 3 CBM" is two facts,
--     and a line holding only the first under-charges every small consignment
--     that goes on it.
--
--   * A charge belongs to a vendor. Four lines from three agents is the
--     ordinary case, and "who is this one with" was unanswerable without
--     opening the partner replies.
--
--   * A charge has a code. ADO, CDO, ASFRT — the desk quotes and invoices
--     against them, and the SAC code is a tax classification rather than a
--     name anybody uses out loud.
--
-- WHY THE COST IS DERIVED AND THE SELL IS TOO
--
-- Both sides are now quantity x rate x fx, computed by the database. They were
-- generated columns on the sell side already; making the cost match means the
-- margin cannot drift from the figures it is a margin on, which is the one
-- number on this screen somebody makes a decision with.
-- ---------------------------------------------------------------------------

alter table public.quote_lines
  -- The code the desk quotes against. Free text rather than a foreign key: the
  -- catalogue lives in the application, and a desk needs to add "ODC surcharge"
  -- without a migration.
  add column if not exists charge_code   text,

  -- The floor, in the line's own selling currency.
  add column if not exists min_amount    numeric check (min_amount is null or min_amount >= 0),

  -- The buying side, in the currency it was bought in.
  add column if not exists cost_currency text not null default 'INR',
  add column if not exists cost_fx_rate  numeric not null default 1 check (cost_fx_rate > 0),
  add column if not exists cost_rate     numeric,

  -- Who it is with. Free text because plenty of costs come from someone who is
  -- not in the partner book yet, and refusing to record the name until they are
  -- is how the name ends up in nobody's notes.
  add column if not exists vendor        text;

comment on column public.quote_lines.cost_rate is
  'Cost per unit in cost_currency. cost_inr is derived from it; see 055.';
comment on column public.quote_lines.min_amount is
  'Minimum for this charge, in the line currency. Applied to the sell amount.';


-- ---------------------------------------------------------------------------
-- The figures, kept in step
--
-- A trigger rather than more generated columns, because `cost_inr` already
-- exists as a plain column carrying data that was entered directly. A generated
-- column cannot be added over it without dropping what is there, and a
-- quotation somebody built last week should not lose its costs to a migration.
--
-- So: where a cost rate is given, the rupee figure follows from it. Where one
-- is not, whatever was entered stands.
-- ---------------------------------------------------------------------------
create or replace function public.derive_quote_line_cost()
returns trigger
language plpgsql
as $fn$
begin
  if new.cost_rate is not null then
    new.cost_inr := round(new.quantity * new.cost_rate * new.cost_fx_rate, 2);
  end if;
  return new;
end $fn$;

drop trigger if exists quote_lines_derive_cost on public.quote_lines;
create trigger quote_lines_derive_cost
  before insert or update on public.quote_lines
  for each row execute function public.derive_quote_line_cost();


-- ---------------------------------------------------------------------------
-- The quotation's own header
--
-- What the reference sheet carries above the grid: the currency the customer is
-- quoted in, the rate it converts at, and what kind of quotation this is.
--
-- `currency` is NOT the same as a line's currency. A quotation presented in USD
-- can still carry a line bought in AED — the header is what the customer is
-- asked to pay in, and the lines are what each charge was priced in.
-- ---------------------------------------------------------------------------
alter table public.quotes
  add column if not exists currency      text not null default 'INR',
  add column if not exists fx_rate       numeric not null default 1 check (fx_rate > 0),
  add column if not exists quote_type    text not null default 'standard'
    check (quote_type in ('standard', 'spot', 'contract')),
  -- Whether the customer is being offered more than one carrier on the same
  -- quotation. It changes what the document says, not what it charges.
  add column if not exists multi_carrier boolean not null default false;

comment on column public.quotes.currency is
  'What the customer is quoted in. Line currencies are what each charge was priced in.';
comment on column public.quotes.fx_rate is
  'Rate of exchange from the quote currency to INR, as agreed on the quotation.';
