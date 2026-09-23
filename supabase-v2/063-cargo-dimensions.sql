-- ---------------------------------------------------------------------------
-- Cargo measured in more than one size, and whether it is hazardous.
--
-- WHAT WAS WRONG
--
-- An enquiry held ONE set of piece dimensions. A real consignment is routinely
-- "10 cases of 100 x 120 x 130 and 4 of 60 x 40 x 50", and the only way to
-- record that was to invent an average piece — which gets the volume wrong,
-- which gets the chargeable weight wrong, which gets the price wrong.
--
-- THE SHAPE
--
-- `enquiry_dimensions` holds the lines, as entered, in the unit they were
-- entered in. The enquiry's own totals — piece_count, volume_cbm,
-- gross_weight_kg — are derived from them, because everything downstream reads
-- those: the chargeable weight, the quotation PDF, promotion onto a booking.
-- Keeping the totals as the one interface means none of that had to change.
--
-- THE RULE FOR EACH TOTAL (pieces, volume, weight)
--
--   every line gives it   -> the sum of the lines
--   no line gives it      -> left as it was: a figure the customer STATED
--                            ("total 2.4 CBM, 850 kg") stays, and can still
--                            be typed directly
--   some lines, not all   -> blank. A sum over the measured lines is lower
--                            than the real total, and a low volume is a low
--                            chargeable weight — the error that loses money.
--
-- WHY THE LINES WIN ONCE THEY GIVE A FIGURE
--
-- The extractor and older forms write straight onto the enquiry. Left alone, a
-- single-piece size written onto an enquiry with three lines would recompute
-- the volume from one line's measurements times every piece — a confident
-- wrong number. So once lines exist, direct writes to the piece size are
-- ignored, and so are direct writes to any total the lines provide. Before any
-- line exists, a complete single-piece size becomes the first line, so the
-- table always shows what the enquiry knows.
-- ---------------------------------------------------------------------------

alter table public.enquiries
  -- Whether the cargo is dangerous goods. Decides whether the DG fields are
  -- shown at all — four empty fields about UN numbers on every ordinary job is
  -- how a form gets skimmed.
  add column if not exists hazardous              boolean,
  add column if not exists expected_delivery_date date,
  -- The unit the dimension lines were entered in. The customer's packing list
  -- is in inches and pounds or it is not, and re-typing it converted is how a
  -- digit gets lost.
  add column if not exists dimension_unit         text not null default 'cm_kg'
    check (dimension_unit in ('cm_kg', 'in_lb'));

create table if not exists public.enquiry_dimensions (
  id               uuid primary key default gen_random_uuid(),
  enquiry_ref      text not null references public.enquiries(ref) on delete cascade,
  position         int  not null default 0,
  pieces           int     check (pieces is null or pieces > 0),
  length           numeric check (length is null or length > 0),
  width            numeric check (width  is null or width  > 0),
  height           numeric check (height is null or height > 0),
  -- Per piece OR for the line; the line figure wins where both are given.
  weight_per_piece numeric check (weight_per_piece is null or weight_per_piece >= 0),
  gross_weight     numeric check (gross_weight     is null or gross_weight     >= 0),
  created_at       timestamptz not null default now()
);

create index if not exists enquiry_dimensions_ref_idx
  on public.enquiry_dimensions (enquiry_ref, position);

alter table public.enquiry_dimensions enable row level security;
drop policy if exists enquiry_dimensions_all on public.enquiry_dimensions;
create policy enquiry_dimensions_all on public.enquiry_dimensions
  for all to authenticated using (true) with check (true);


-- ---------------------------------------------------------------------------
-- The totals, from the lines
-- ---------------------------------------------------------------------------
create or replace function public.recompute_enquiry_dimensions(p_ref text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_unit   text;
  f_len    numeric;   -- to centimetres
  f_wt     numeric;   -- to kilograms
  v        record;
  v_first  public.enquiry_dimensions;
begin
  select dimension_unit into v_unit from public.enquiries where ref = p_ref;
  if not found then
    return;  -- the enquiry itself is being deleted
  end if;
  f_len := case v_unit when 'in_lb' then 2.54 else 1 end;
  f_wt  := case v_unit when 'in_lb' then 0.45359237 else 1 end;

  -- Only lines with something in them: an empty row is not a half-measured one.
  select count(*)                                                        as lines,
         bool_and(pieces is not null)                                    as pcs_all,
         bool_or(pieces is not null)                                     as pcs_any,
         sum(pieces)                                                     as pcs,
         bool_and(pieces is not null and length is not null
                  and width is not null and height is not null)          as vol_all,
         bool_or(length is not null or width is not null or height is not null) as vol_any,
         sum(pieces * length * width * height) * f_len ^ 3 / 1000000.0  as vol,
         bool_and(gross_weight is not null
                  or (weight_per_piece is not null and pieces is not null)) as wt_all,
         bool_or(gross_weight is not null or weight_per_piece is not null) as wt_any,
         sum(coalesce(gross_weight, weight_per_piece * pieces)) * f_wt  as wt
    into v
    from public.enquiry_dimensions
   where enquiry_ref = p_ref
     and coalesce(pieces::numeric, length, width, height, weight_per_piece, gross_weight) is not null;

  select * into v_first from public.enquiry_dimensions
   where enquiry_ref = p_ref
     and coalesce(pieces::numeric, length, width, height, weight_per_piece, gross_weight) is not null
   order by position, created_at
   limit 1;

  -- Tells derive_cargo_figures this write is the lines speaking.
  perform set_config('araxys.from_dimensions', 'on', true);

  update public.enquiries e set
    piece_count     = case when v.pcs_all then v.pcs
                           when v.pcs_any then null
                           else e.piece_count end,
    volume_cbm      = case when v.vol_all then round(v.vol, 3)
                           when v.vol_any then null
                           else e.volume_cbm end,
    gross_weight_kg = case when v.wt_all then round(v.wt, 2)
                           when v.wt_any then null
                           else e.gross_weight_kg end,
    -- One line is one piece size, and the single-piece columns can say so.
    -- Several lines have no single piece size; saying one would invent it.
    piece_length_cm     = case when v.lines = 1 then round(v_first.length * f_len, 2) end,
    piece_width_cm      = case when v.lines = 1 then round(v_first.width  * f_len, 2) end,
    piece_height_cm     = case when v.lines = 1 then round(v_first.height * f_len, 2) end,
    weight_per_piece_kg = case when v.lines = 1 then round(v_first.weight_per_piece * f_wt, 3) end,
    updated_at          = now()
   where e.ref = p_ref;

  perform set_config('araxys.from_dimensions', 'off', true);
end $fn$;

revoke execute on function public.recompute_enquiry_dimensions(text) from public, anon;

create or replace function public.enquiry_dimensions_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  perform public.recompute_enquiry_dimensions(coalesce(new.enquiry_ref, old.enquiry_ref));
  return null;
end $fn$;

drop trigger if exists enquiry_dimensions_recompute on public.enquiry_dimensions;
create trigger enquiry_dimensions_recompute
  after insert or update or delete on public.enquiry_dimensions
  for each row execute function public.enquiry_dimensions_changed();


-- ---------------------------------------------------------------------------
-- The derivation from 054, taught about lines and about hazardous cargo
-- ---------------------------------------------------------------------------
create or replace function public.derive_cargo_figures()
returns trigger
language plpgsql
as $fn$
declare
  v_pcs boolean;
  v_vol boolean;
  v_wt  boolean;
begin
  if coalesce(current_setting('araxys.from_dimensions', true), 'off') = 'on' then
    -- The lines have already worked the totals out; nothing to derive.
    null;
  elsif tg_op = 'UPDATE'
        and exists (select 1 from public.enquiry_dimensions where enquiry_ref = new.ref)
  then
    select bool_or(pieces is not null),
           bool_or(length is not null or width is not null or height is not null),
           bool_or(gross_weight is not null or weight_per_piece is not null)
      into v_pcs, v_vol, v_wt
      from public.enquiry_dimensions where enquiry_ref = new.ref;

    -- The piece size always belongs to the lines once there are any.
    new.piece_length_cm     := old.piece_length_cm;
    new.piece_width_cm      := old.piece_width_cm;
    new.piece_height_cm     := old.piece_height_cm;
    new.weight_per_piece_kg := old.weight_per_piece_kg;
    -- A total belongs to the lines only if they give it.
    if coalesce(v_pcs, false) then new.piece_count     := old.piece_count;     end if;
    if coalesce(v_vol, false) then new.volume_cbm      := old.volume_cbm;      end if;
    if coalesce(v_wt,  false) then new.gross_weight_kg := old.gross_weight_kg; end if;
  else
    if new.piece_length_cm is not null
       and new.piece_width_cm is not null
       and new.piece_height_cm is not null
       and new.piece_count is not null
       and new.piece_count > 0
    then
      new.volume_cbm := round(
        (new.piece_length_cm * new.piece_width_cm * new.piece_height_cm * new.piece_count)
          / 1000000.0, 3);
    end if;

    if new.weight_per_piece_kg is not null
       and new.piece_count is not null
       and new.piece_count > 0
    then
      new.gross_weight_kg := round(new.weight_per_piece_kg * new.piece_count, 2);
    end if;
  end if;

  -- A UN number or an IMO class is a statement that the cargo is dangerous
  -- goods. Where nobody has answered the question, that answers it.
  if new.hazardous is null and (new.un_number is not null or new.imo_class is not null) then
    new.hazardous := true;
  end if;

  return new;
end $fn$;


-- ---------------------------------------------------------------------------
-- A single piece size becomes the first line; a change of unit is recomputed
-- ---------------------------------------------------------------------------
create or replace function public.enquiry_dimensions_seed()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  f_len numeric;
  f_wt  numeric;
begin
  if exists (select 1 from public.enquiry_dimensions where enquiry_ref = new.ref) then
    -- The unit was changed: the same numbers, read in the other unit. That is
    -- what the toggle means — "these figures are in inches".
    if tg_op = 'UPDATE' and old.dimension_unit is distinct from new.dimension_unit then
      perform public.recompute_enquiry_dimensions(new.ref);
    end if;
    return null;
  end if;

  if new.piece_length_cm is not null and new.piece_width_cm is not null
     and new.piece_height_cm is not null and coalesce(new.piece_count, 0) > 0
  then
    f_len := case new.dimension_unit when 'in_lb' then 2.54 else 1 end;
    f_wt  := case new.dimension_unit when 'in_lb' then 0.45359237 else 1 end;
    insert into public.enquiry_dimensions
      (enquiry_ref, position, pieces, length, width, height, weight_per_piece, gross_weight)
    values (
      new.ref, 1, new.piece_count,
      round(new.piece_length_cm / f_len, 2),
      round(new.piece_width_cm  / f_len, 2),
      round(new.piece_height_cm / f_len, 2),
      case when new.weight_per_piece_kg is not null
           then round(new.weight_per_piece_kg / f_wt, 3) end,
      -- A stated total with no per-piece weight is the line's weight.
      case when new.weight_per_piece_kg is null and new.gross_weight_kg is not null
           then round(new.gross_weight_kg / f_wt, 2) end
    );
  end if;
  return null;
end $fn$;

drop trigger if exists enquiries_dimensions_seed on public.enquiries;
create trigger enquiries_dimensions_seed
  after insert or update on public.enquiries
  for each row execute function public.enquiry_dimensions_seed();


-- ---------------------------------------------------------------------------
-- Backfill: every enquiry with a complete piece size gets it as its first
-- line. The seed trigger does the work; a no-op update fires it.
-- ---------------------------------------------------------------------------
update public.enquiries set updated_at = updated_at
 where piece_length_cm is not null and piece_width_cm is not null
   and piece_height_cm is not null and coalesce(piece_count, 0) > 0
   and not exists (select 1 from public.enquiry_dimensions d where d.enquiry_ref = enquiries.ref);

update public.enquiries set hazardous = true
 where hazardous is null and (un_number is not null or imo_class is not null);
