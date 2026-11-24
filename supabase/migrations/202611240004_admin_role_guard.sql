create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.admin_profiles p
    where p.user_id = (select auth.uid())
      and p.active = true
      and p.role in ('owner','admin','editor')
  );
$$;

drop policy if exists admin_profiles_admin_all on public.admin_profiles;
create policy admin_profiles_admin_read on public.admin_profiles
  for select to authenticated using (public.is_admin());
revoke insert, update, delete on public.admin_profiles from authenticated;
grant select on public.admin_profiles to authenticated;
