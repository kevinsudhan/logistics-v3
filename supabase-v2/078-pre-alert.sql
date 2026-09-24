-- 078: The pre-alert to the destination agent, on the workflow.
--
-- ---------------------------------------------------------------------------
-- WHAT IT IS
--
-- Once an export has left, the agent who will receive it at destination is
-- sent the pre-alert: the bills (MAWB and HAWB, or master and house B/L),
-- the flight or vessel and its dates, the parties, the cargo, and the
-- documents they need to clear and deliver it. Until they have it, the
-- cargo arrives to an agent who does not know it is theirs.
--
-- ON THE WORKFLOW
--
-- A step, "Pre-alert sent to agent", after departure, on export jobs by air
-- and sea, due the day after the ETD. Sending the pre-alert from the job
-- ticks it and puts it on the job's history (record_pre_alert); it can also
-- be ticked by hand, for a pre-alert sent another way.
-- ---------------------------------------------------------------------------

insert into public.checkpoint_templates (mode, position, code, label, direction, due_rule) values
  ('air',     85, 'pre_alert', 'Pre-alert sent to agent', 'export', '[{"anchor":"etd","days":1}]'),
  ('sea_lcl', 85, 'pre_alert', 'Pre-alert sent to agent', 'export', '[{"anchor":"etd","days":1}]'),
  ('sea_fcl', 85, 'pre_alert', 'Pre-alert sent to agent', 'export', '[{"anchor":"etd","days":1}]')
on conflict (mode, code) do update
  set label = excluded.label, direction = excluded.direction, due_rule = excluded.due_rule, position = excluded.position;

-- Export jobs already under way get the step.
insert into public.shipment_checkpoints (shipment_id, position, code, label, stage, due_rule)
select s.id, t.position, t.code, t.label, t.stage, t.due_rule
  from public.shipments s
  join public.checkpoint_templates t on t.mode = public.checkpoint_mode(s.transport_mode) and t.code = 'pre_alert' and t.active
 where s.trade_direction = 'export' and s.signed_off_at is null
on conflict (shipment_id, code) do nothing;

do $$
declare r record;
begin
  for r in select id from public.shipments where trade_direction = 'export' and signed_off_at is null loop
    perform public.refresh_checkpoint_dues(r.id);
  end loop;
end $$;


-- Sent from the job: on its history, and the step ticked if it is open.
create or replace function public.record_pre_alert(p_shipment_id text, p_to text, p_attachments int default 0)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_ref text;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  select enquiry_ref into v_ref from public.shipments where id = p_shipment_id;
  if v_ref is null then
    raise exception 'No shipment %', p_shipment_id;
  end if;

  insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
  values (v_ref, 'pre_alert_sent',
          format('Pre-alert sent to %s', coalesce(nullif(btrim(p_to), ''), 'the agent')),
          jsonb_build_object('shipment_id', p_shipment_id, 'to', p_to, 'attachments', p_attachments),
          auth.uid());

  update public.shipment_checkpoints
     set done_at = now(), done_by = auth.uid()
   where shipment_id = p_shipment_id and code = 'pre_alert' and done_at is null;
end $fn$;

grant execute on function public.record_pre_alert(text, text, int) to authenticated;
revoke execute on function public.record_pre_alert(text, text, int) from public, anon;
