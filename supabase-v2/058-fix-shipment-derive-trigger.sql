-- ---------------------------------------------------------------------------
-- 054 put a trigger on a table that does not have the columns it reads.
--
-- WHAT BROKE
--
-- `derive_cargo_figures` reads piece_length_cm, piece_width_cm,
-- piece_height_cm and weight_per_piece_kg. Those live on `enquiries`. They do
-- not exist on `shipments`, which carries only the totals — piece_count,
-- volume_cbm and gross_weight_kg — because 010 copies the conclusions of the
-- measurement onto the booking rather than the measurement itself.
--
-- plpgsql resolves a record's fields at run time, so the function compiled
-- happily and failed on the first insert:
--
--     record "new" has no field "piece_length_cm"
--
-- Which meant `promote_enquiry` could not create a shipment at all. The whole
-- handover from selling to operating was dead, and it was dead silently — no
-- syntax error, no failing migration, just an exception at the one moment a
-- booking is made.
--
-- THE FIX
--
-- The trigger comes off `shipments`. It was never doing anything there that
-- could work: there is nothing on that table to derive a volume FROM. The
-- enquiry derives it, `promote_enquiry` copies the derived figure across, and a
-- shipment whose dimensions are corrected is corrected on the enquiry it came
-- from.
--
-- WHAT THIS SHOULD HAVE BEEN CAUGHT BY
--
-- A migration that adds a trigger to two tables ought to be exercised against
-- both. It was tested on `enquiries`, which has the columns, and assumed for
-- `shipments`, which does not.
-- ---------------------------------------------------------------------------

drop trigger if exists shipments_derive_cargo on public.shipments;

comment on function public.derive_cargo_figures() is
  'Enquiries only. Shipments carry totals, not piece dimensions — see 058.';
