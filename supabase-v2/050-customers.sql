-- ---------------------------------------------------------------------------
-- Customers as a thing you can look at.
--
-- WHAT WAS WRONG
--
-- The table has existed since 005 and every enquiry, shipment and invoice
-- points at it. What has never existed is any way to look at a customer: no
-- list, no search, no route to /customers at all. You could only reach one by
-- opening a job they happened to be on.
--
-- Which means the question a forwarder asks constantly — "what have we done
-- for these people before?" — had no answer in the system. Their rate history,
-- the lanes they ship, whether they pay, whether the last quote was lost: all
-- of it is in the database and none of it was reachable.
--
-- WHAT THIS ADDS
--
-- Three columns the record was missing, and one view that answers the
-- directory's questions in a single query.
-- ---------------------------------------------------------------------------

alter table public.customers
  -- Archived rather than deleted, because a customer cannot be deleted: the
  -- invoices reference them with `on delete restrict`, and a statutory
  -- document must keep pointing at the party it was raised on. Archiving is
  -- what "we do not work with them any more" has to mean.
  add column if not exists active boolean not null default true,

  -- What somebody needs to know before dealing with them that is not a field.
  -- "Pays on the 45th day whatever the terms say." "Always asks for the rate
  -- in USD." The partners table has had this since 013 and it is the most read
  -- thing on that screen.
  add column if not exists notes  text not null default '',

  -- The same free grouping as partners: 'garments', 'DG', 'monthly volume'.
  -- Tags rather than a category column because a customer is several things at
  -- once and a single-valued field forces a choice that is wrong by lunchtime.
  add column if not exists tags   text[] not null default '{}';

create index if not exists customers_active_idx on public.customers (active);
create index if not exists customers_tags_idx   on public.customers using gin (tags);

comment on column public.customers.active is
  'False = archived. Customers are never deleted; invoices reference them with on delete restrict.';


-- ---------------------------------------------------------------------------
-- The directory, in one query
--
-- WHY A VIEW AND NOT A QUERY PER ROW
--
-- The list wants, for each customer: how much work they have given us, when
-- they last shipped, what they owe, and which lane they use. Asking that per
-- row is four round trips per customer — a hundred customers is four hundred
-- queries, and the screen takes long enough that people stop opening it.
--
-- WHY IT JOINS customer_balances RATHER THAN RECOMPUTING THE MONEY
--
-- 034 already defines what a customer owes, and it is not a simple sum: it
-- nets cash received and TDS withheld against issued invoices, and holds
-- unallocated payments separately as money on account. Recomputing that here
-- would be a second definition of the same figure, and the day one of them is
-- corrected the directory and the outstanding report start disagreeing about
-- the same customer in front of the same person.
--
-- WHAT COUNTS AS WORK
--
-- Enquiries and shipments are counted separately because they answer different
-- questions. Enquiries are how much they ASK for, shipments are how much they
-- actually give us, and the gap between the two is the conversion rate — which
-- is the most useful single number about a customer and is invisible if you
-- only count the jobs that happened.
--
-- Cancelled shipments are excluded from the totals and the value. A booking
-- that was cancelled is not a shipment this desk performed, and counting it
-- flatters both the volume and the lifetime figure.
-- ---------------------------------------------------------------------------
create or replace view public.customer_summary as
  with enq as (
    select customer_id,
           count(*)                                                    as enquiries,
           count(*) filter (where status in ('new','qualifying','quoted')) as enquiries_open,
           count(*) filter (where status = 'accepted')                 as enquiries_won,
           count(*) filter (where status in ('lost','declined'))       as enquiries_lost,
           max(received_at)                                            as last_enquiry_at,
           -- The lane they use most, for the line under their name. `mode()`
           -- picks the commonest; ties resolve arbitrarily, which is fine for
           -- a label and is why nothing is decided from it.
           mode() within group (order by origin)      filter (where origin is not null)
             as top_origin,
           mode() within group (order by destination) filter (where destination is not null)
             as top_destination,
           mode() within group (order by trade_direction) filter (where trade_direction is not null)
             as trade_direction
      from public.enquiries
     group by customer_id
  ),
  shp as (
    select customer_id,
           count(*)                                                    as shipments,
           count(*) filter (where stage not in ('delivered','cancelled')) as shipments_live,
           count(*) filter (where stage = 'delivered')                 as shipments_delivered,
           -- The date the desk means by "when did we last ship for them":
           -- the sailing where there is one, and otherwise when the booking
           -- was made. A booking with no sailing date yet is still the most
           -- recent thing that happened.
           max(coalesce(sailing_date, created_at::date))               as last_shipped_on,
           sum(agreed_inr)                                             as lifetime_inr
      from public.shipments
     where stage <> 'cancelled'
     group by customer_id
  )
  select c.id,
         c.name,
         c.company,
         c.emails,
         c.phones,
         c.active,
         c.tags,
         c.gstin,
         c.iec,
         c.created_at,

         coalesce(e.enquiries, 0)            as enquiries,
         coalesce(e.enquiries_open, 0)       as enquiries_open,
         coalesce(e.enquiries_won, 0)        as enquiries_won,
         coalesce(e.enquiries_lost, 0)       as enquiries_lost,
         e.last_enquiry_at,
         e.top_origin,
         e.top_destination,
         e.trade_direction,

         coalesce(s.shipments, 0)            as shipments,
         coalesce(s.shipments_live, 0)       as shipments_live,
         coalesce(s.shipments_delivered, 0)  as shipments_delivered,
         s.last_shipped_on,
         coalesce(s.lifetime_inr, 0)         as lifetime_inr,

         coalesce(b.outstanding, 0)          as outstanding,
         coalesce(b.on_account, 0)           as on_account,
         coalesce(b.open_invoices, 0)        as open_invoices,

         -- Whether they can be invoiced at all. A tax invoice to an Indian
         -- business needs their GSTIN and an export needs the IEC; discovering
         -- one is missing at the point of raising the invoice is discovering it
         -- a month too late, with the cargo already gone.
         (c.gstin is null or c.gstin = '')   as gstin_missing,
         (c.iec   is null or c.iec   = '')   as iec_missing,

         -- The last thing that happened, whichever kind it was. This is what
         -- "dormant" is measured from: a customer who enquired last week is
         -- active even if they have not shipped since March.
         -- The sentinel is nulled back out rather than filtered: `filter` is for
         -- aggregates and `greatest` is not one, and a customer who has done
         -- nothing should read as null rather than as a date in 1900.
         nullif(
           greatest(
             coalesce(s.last_shipped_on, '1900-01-01'::date),
             coalesce(e.last_enquiry_at::date, '1900-01-01'::date)
           ),
           '1900-01-01'::date
         ) as last_activity_on
    from public.customers c
    left join enq e on e.customer_id = c.id
    left join shp s on s.customer_id = c.id
    left join public.customer_balances b on b.customer_id = c.id;

grant select on public.customer_summary to authenticated;
