insert into public.polls(title,description,slug,active)
select 'Entre Lula e Bolsonaro, em quem você votaria?',
       'Vote de forma anônima. Esta é uma enquete informal e não representa uma pesquisa científica ou resultado oficial.',
       'lula-ou-bolsonaro', not exists(select 1 from public.polls where active)
where not exists(select 1 from public.polls where slug='lula-ou-bolsonaro');

insert into public.poll_options(poll_id,name,position)
select p.id,choice.name,choice.position
from public.polls p
cross join (values ('Lula',0),('Bolsonaro',1)) as choice(name,position)
where p.slug='lula-ou-bolsonaro'
  and not exists(select 1 from public.poll_options o where o.poll_id=p.id and o.name=choice.name);

drop function public.record_anonymous_vote(uuid);
create function public.record_anonymous_vote(p_option_id uuid)
returns table(option_id uuid,total bigint)
language plpgsql security definer set search_path = '' as $$
declare v_poll_id uuid;
begin
  select o.poll_id into v_poll_id from public.poll_options o join public.polls p on p.id=o.poll_id
   where o.id=p_option_id and p.active and not p.archived
     and (p.starts_at is null or p.starts_at <= now()) and (p.ends_at is null or p.ends_at > now());
  if v_poll_id is null then raise exception 'Enquete indisponível'; end if;
  insert into public.poll_totals(poll_id,option_id,total) values(v_poll_id,p_option_id,1)
  on conflict (poll_id,option_id) do update set total=public.poll_totals.total+1;
  return query select pt.option_id,pt.total from public.poll_totals pt
    join public.poll_options po on po.id=pt.option_id
    where pt.poll_id=v_poll_id order by po.position;
end; $$;
revoke all on function public.record_anonymous_vote(uuid) from public, anon, authenticated;
grant execute on function public.record_anonymous_vote(uuid) to service_role;

create or replace function public.get_active_poll_results(p_poll_id uuid)
returns table(option_id uuid,total bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.polls p where p.id=p_poll_id and p.active and not p.archived
    and (p.starts_at is null or p.starts_at<=now()) and (p.ends_at is null or p.ends_at>now())) then
    raise exception 'Enquete indisponível';
  end if;
  return query select o.id,coalesce(t.total,0)::bigint from public.poll_options o
    left join public.poll_totals t on t.option_id=o.id and t.poll_id=o.poll_id
    where o.poll_id=p_poll_id order by o.position;
end; $$;
revoke all on function public.get_active_poll_results(uuid) from public;
grant execute on function public.get_active_poll_results(uuid) to anon,authenticated;

notify pgrst, 'reload schema';
