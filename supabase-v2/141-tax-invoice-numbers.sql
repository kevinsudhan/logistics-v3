-- ===========================================================================
-- 141: Tax invoice numbers, ALG/26-27/0001 on (25 Oct 2026)
-- ---------------------------------------------------------------------------
-- The user: the tax invoice is numbered automatically, across all shipments,
-- ALG/26-27/XXXX, one after the other as the invoices are made, from 0001.
--
-- ONE NUMBER PER B/L
--
-- A tax invoice is made for a house B/L, on the Manual documents page or on
-- the shipment's Documents tab. The first time one is made for a B/L it takes
-- the next number; made again (a correction, a reprint, the other page) it
-- keeps that number, so printing twice never spends two serials on one
-- invoice. The B/L is written one way first, as 139 keeps it.
--
-- THE SERIES
--
-- The 'ALG' series of invoice_series (030), the same counter accounts uses for
-- its own series, so the financial year turns over in April as it does there
-- (fy_of) and the number is handed out under the same row lock
-- (allocate_invoice_number). The year is the invoice date's.
--
-- Two people making the invoice for the same B/L at the same moment queue on
-- an advisory lock for that B/L: the second is handed the first one's number.
-- ===========================================================================

create table if not exists public.tax_invoice_numbers (
  -- The house B/L (or AWB) the invoice is for: upper case, single spaces.
  bl_number   text primary key check (btrim(bl_number) <> '' and length(bl_number) <= 80),
  number      text not null unique,
  fy          text not null,
  issued_by   uuid references auth.users(id) default auth.uid(),
  issued_at   timestamptz not null default now()
);

comment on table public.tax_invoice_numbers is 'The ALG/yy-yy/nnnn number given to each B/L''s tax invoice, the first time one is made (141).';

alter table public.tax_invoice_numbers enable row level security;
revoke all on public.tax_invoice_numbers from public, anon, authenticated;
grant select on public.tax_invoice_numbers to authenticated;

drop policy if exists tax_invoice_numbers_read on public.tax_invoice_numbers;
create policy tax_invoice_numbers_read on public.tax_invoice_numbers
  for select to authenticated using (true);

-- The B/L's number: the one it was given, or the next in the series.
create or replace function public.tax_invoice_number(p_bl text, p_date date default current_date)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_bl  text := upper(btrim(regexp_replace(coalesce(p_bl, ''), '\s+', ' ', 'g')));
  v_day date := coalesce(p_date, current_date);
  v_no  text;
begin
  if v_bl = '' then
    raise exception 'A tax invoice is numbered for its B/L, and there is no B/L number'
      using hint = 'Fill in the house B/L number first.';
  end if;

  perform pg_advisory_xact_lock(hashtext('tax_invoice_number:' || v_bl));

  select number into v_no from public.tax_invoice_numbers where bl_number = v_bl;
  if found then
    return v_no;
  end if;

  v_no := public.allocate_invoice_number('ALG', v_day);
  insert into public.tax_invoice_numbers (bl_number, number, fy)
  values (v_bl, v_no, public.fy_of(v_day));
  return v_no;
end $fn$;

revoke execute on function public.tax_invoice_number(text, date) from public, anon;
grant execute on function public.tax_invoice_number(text, date) to authenticated;
