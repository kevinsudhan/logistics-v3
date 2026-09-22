-- ---------------------------------------------------------------------------
-- Volume and gross weight, derived wherever they can be.
--
-- WHAT WAS WRONG
--
-- Both figures were computed in one place: the cargo form's save handler. Every
-- other way a row could be written left them null — and by now there are
-- several. The extractor writes dimensions straight onto the enquiry, so a mail
-- stating "10 cases of 100 x 120 x 130" produced four populated columns and a
-- volume of null.
--
-- That is not a cosmetic gap. The chargeable weight needs a volume, so the
-- headline figure on the shipment page read "needs both a gross weight and a
-- volume" on an enquiry that plainly had both. The rate master matches on the
-- lane and the mode, but anything quoting per CBM had nothing to multiply.
-- Everything downstream inherited a hole that the data did not have.
--
-- WHY A TRIGGER AND NOT A GENERATED COLUMN
--
-- A generated column would be stricter and is the obvious first thought, but it
-- cannot be overridden — and both of these legitimately arrive stated. A
-- shipper who writes "total 15.6 CBM" and gives no dimensions has told us the
-- volume; a generated column would compute null over the top of it and there
-- would be no way to record what they said.
--
-- THE RULE, AND WHY IT IS THIS WAY ROUND
--
--   Parts present  -> derive, overwriting whatever is there.
--   Parts absent   -> leave alone, so a stated figure survives.
--
-- Deriving wins where it can because the parts are the more specific claim: if
-- somebody corrects a dimension, the volume that followed from the old one is
-- now wrong, and keeping it would leave two facts on the row disagreeing. Where
-- there are no parts there is nothing to disagree with.
-- ---------------------------------------------------------------------------

create or replace function public.derive_cargo_figures()
returns trigger
language plpgsql
as $fn$
begin
  -- Volume, in cubic metres, from centimetre dimensions. The divisor is
  -- 1,000,000 — using 1,000 reports a 1.2m crate as 0.0018 CBM and prices a
  -- container load as hand luggage.
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

  -- Gross, from the per-piece weight where one was given. A stated total with
  -- no per-piece figure is left exactly as it arrived — that is the ordinary
  -- case, because shippers quote totals.
  if new.weight_per_piece_kg is not null
     and new.piece_count is not null
     and new.piece_count > 0
  then
    new.gross_weight_kg := round(new.weight_per_piece_kg * new.piece_count, 2);
  end if;

  return new;
end $fn$;

drop trigger if exists enquiries_derive_cargo on public.enquiries;
create trigger enquiries_derive_cargo
  before insert or update on public.enquiries
  for each row execute function public.derive_cargo_figures();

-- The same on the booking, which is copied from the enquiry and then edited on
-- its own. A shipment whose dimensions are corrected must not keep the volume
-- that followed from the old ones.
drop trigger if exists shipments_derive_cargo on public.shipments;
create trigger shipments_derive_cargo
  before insert or update on public.shipments
  for each row execute function public.derive_cargo_figures();

-- ---------------------------------------------------------------------------
-- Backfill
--
-- Rows written before the trigger existed carry the hole. A no-op update fires
-- it for every one of them.
-- ---------------------------------------------------------------------------
update public.enquiries set updated_at = updated_at
 where volume_cbm is null
   and piece_length_cm is not null
   and piece_width_cm is not null
   and piece_height_cm is not null
   and piece_count is not null;
