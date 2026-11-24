create or replace function public.claim_campaign_recipients(p_batch_size integer default 25)
returns table(
  recipient_id uuid, campaign_id uuid, lead_id uuid, email text, first_name text,
  campaign_name text, subject text, preheader text, sender_name text, sender_email text, reply_to text, content_html text, attempts integer
)
language plpgsql security definer set search_path = '' as $$
begin
  if p_batch_size < 1 or p_batch_size > 100 then raise exception 'Tamanho do lote inválido'; end if;
  update public.campaign_recipients r set status='cancelled', locked_at=null
   where r.status in ('queued','failed') and (
     exists (select 1 from public.leads l where l.id=r.lead_id and l.status <> 'active')
     or not exists(select 1 from public.lead_consents lc where lc.lead_id=r.lead_id and lc.consent_type='commercial_email' and lc.revoked_at is null)
     or exists(select 1 from public.suppression_list s join public.leads l on l.id=r.lead_id where s.email_hash=encode(extensions.digest(lower(l.email),'sha256'),'hex'))
   );
  return query
  with due as (
    select r.id
      from public.campaign_recipients r
      join public.campaigns c on c.id=r.campaign_id
      join public.leads l on l.id=r.lead_id
     where r.status in ('queued','failed') and r.attempts < 5 and r.next_attempt_at <= now()
       and c.status in ('queued','sending','scheduled') and (c.scheduled_at is null or c.scheduled_at <= now())
       and l.status='active'
       and exists(select 1 from public.lead_consents lc where lc.lead_id=l.id and lc.consent_type='commercial_email' and lc.revoked_at is null)
       and not exists(select 1 from public.suppression_list s where s.email_hash=encode(extensions.digest(lower(l.email),'sha256'),'hex'))
     order by r.next_attempt_at, r.created_at
     for update of r skip locked
     limit p_batch_size
  ), claimed as (
    update public.campaign_recipients r set status='sending', locked_at=now(), attempts=r.attempts+1
      from due where r.id=due.id returning r.id,r.campaign_id,r.lead_id,r.attempts
  )
  select cl.id, c.id, l.id, l.email, l.first_name, c.name, c.subject, c.preheader,
         c.sender_name, c.sender_email, c.reply_to, c.content_html, cl.attempts
    from claimed cl join public.campaigns c on c.id=cl.campaign_id join public.leads l on l.id=cl.lead_id;
end; $$;
revoke all on function public.claim_campaign_recipients(integer) from public,anon,authenticated;
grant execute on function public.claim_campaign_recipients(integer) to service_role;

create or replace function public.recover_stale_campaign_recipients(p_stale_minutes integer default 15)
returns integer language plpgsql security definer set search_path = '' as $$
declare restored integer;
begin
  with changed as (
    update public.campaign_recipients r set status=case when r.attempts >= 5 then 'failed' else 'queued' end,
      locked_at=null, error_message='Envio interrompido; tarefa recuperada.'
    where r.status='sending' and r.locked_at < now() - make_interval(mins=>p_stale_minutes)
    returning 1
  ) select count(*) into restored from changed;
  return restored;
end; $$;
revoke all on function public.recover_stale_campaign_recipients(integer) from public,anon,authenticated;
grant execute on function public.recover_stale_campaign_recipients(integer) to service_role;

create index leads_status_created_idx on public.leads(status,created_at desc);
create index lead_consents_active_idx on public.lead_consents(lead_id,consent_type) where revoked_at is null;
create index email_events_type_created_idx on public.email_events(event_type,created_at desc);
