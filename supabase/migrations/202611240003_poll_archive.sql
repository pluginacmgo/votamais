alter table public.polls add column if not exists archived boolean not null default false;

create or replace function public.set_active_poll(p_poll_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Acesso administrativo necessário'; end if;
  if not exists(select 1 from public.polls p where p.id=p_poll_id and not p.archived) then raise exception 'Enquete não encontrada'; end if;
  update public.polls set active=false where active;
  update public.polls set active=true where id=p_poll_id;
end; $$;
revoke all on function public.set_active_poll(uuid) from public,anon;
grant execute on function public.set_active_poll(uuid) to authenticated;
