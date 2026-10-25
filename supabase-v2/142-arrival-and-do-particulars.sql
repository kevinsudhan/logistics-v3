-- ===========================================================================
-- 142: What the arrival notice and the delivery order print (25 Oct 2026)
-- ---------------------------------------------------------------------------
-- The user, with a line's CAN (HCSE2609X113) and DO (QDWJ26093202): every
-- field on those papers is to be in the CRM, typed on the job or read in
-- from what the job already holds.
--
-- Most of it is held already: the parties, the vessel and the ports, the IGM
-- line on the import customs record, the boxes and their seals, the bills and
-- their release (the agent's B/L as Gemini read it, 088; our own, 123), the
-- console's master, CFS and destuffing. These are the ones nothing kept:
--
--   po_number, sales_ref, invoice_ref   the references the notice quotes
--   bl_date, mainline_date              the two bills' dates, where no bill
--                                       on the job carries them
--   auth_bl_no, auth_bl_date            a bill between the master and the
--                                       house: the co-loader's ("Auth. B/L")
--   final_eta, cfs_eta                  when it reaches the final destination
--                                       and the CFS, beside the vessel's ETA
--   cfs_address                         the CFS's address, for "Attention to"
--   consignee_iec_type                  the importer's type, beside its IEC
--   deliver_to                          whom the DO releases the cargo to,
--                                       when not the consignee (its CHA)
--   do_issued_on, do_valid_until        the DO's date and validity, on a job
--                                       without the agent's B/L (088 keeps
--                                       them for one with it)
--
-- Typed on the shipment's Documents tab. All nullable: a document prints TBD
-- or leaves the line off while one is empty.
-- ===========================================================================

alter table public.shipments
  add column if not exists po_number text,
  add column if not exists sales_ref text,
  add column if not exists invoice_ref text,
  add column if not exists bl_date date,
  add column if not exists mainline_date date,
  add column if not exists auth_bl_no text,
  add column if not exists auth_bl_date date,
  add column if not exists final_eta date,
  add column if not exists cfs_eta date,
  add column if not exists cfs_address text,
  add column if not exists consignee_iec_type text,
  add column if not exists deliver_to text,
  add column if not exists do_issued_on date,
  add column if not exists do_valid_until date;

comment on column public.shipments.auth_bl_no is 'A bill between the master and the house, as an arrival notice prints it ("Auth. B/L"): the co-loader''s (142).';
comment on column public.shipments.deliver_to is 'Whom the delivery order releases the cargo to, when not the consignee: its CHA (142).';
comment on column public.shipments.do_issued_on is 'Our delivery order''s date, on a job without the agent''s B/L; received_house_bills keeps it for one with it (142).';
