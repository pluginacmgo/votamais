create extension if not exists pgcrypto with schema extensions;

create table public.admin_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null,
  role text not null default 'admin' check (role in ('owner','admin','editor','analyst')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admin_profiles p where p.user_id = (select auth.uid()) and p.active = true);
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

create table public.polls (
  id uuid primary key default gen_random_uuid(), title text not null, description text,
  slug text not null unique, active boolean not null default false,
  starts_at timestamptz, ends_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index polls_one_active_idx on public.polls(active) where active;
create table public.poll_options (
  id uuid primary key default gen_random_uuid(), poll_id uuid not null references public.polls(id) on delete cascade,
  name text not null, image_url text, position integer not null default 0, created_at timestamptz not null default now(),
  unique (id,poll_id)
);
create table public.poll_totals (
  id uuid primary key default gen_random_uuid(), poll_id uuid not null references public.polls(id) on delete cascade,
  option_id uuid not null, total bigint not null default 0 check (total >= 0),
  foreign key (option_id,poll_id) references public.poll_options(id,poll_id) on delete cascade,
  unique (poll_id,option_id)
);
create or replace function public.record_anonymous_vote(p_option_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_poll_id uuid;
begin
  select o.poll_id into v_poll_id from public.poll_options o join public.polls p on p.id=o.poll_id
   where o.id=p_option_id and p.active and (p.starts_at is null or p.starts_at <= now()) and (p.ends_at is null or p.ends_at > now());
  if v_poll_id is null then raise exception 'Enquete indisponível'; end if;
  insert into public.poll_totals(poll_id,option_id,total) values(v_poll_id,p_option_id,1)
  on conflict (poll_id,option_id) do update set total=public.poll_totals.total+1;
end; $$;
revoke all on function public.record_anonymous_vote(uuid) from public, anon, authenticated;
grant execute on function public.record_anonymous_vote(uuid) to service_role;

create table public.leads (
  id uuid primary key default gen_random_uuid(), email text not null unique,
  first_name text, status text not null default 'pending' check(status in ('pending','active','unsubscribed','bounced','complained')),
  confirmed_at timestamptz, unsubscribed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.lead_consents (
  id uuid primary key default gen_random_uuid(), lead_id uuid not null references public.leads(id) on delete cascade,
  consent_type text not null, consent_text text not null, policy_version text not null,
  granted_at timestamptz not null default now(), revoked_at timestamptz
);
create table public.tags (id uuid primary key default gen_random_uuid(), name text not null unique, color text, created_at timestamptz not null default now());
create table public.lead_tags (lead_id uuid not null references public.leads(id) on delete cascade, tag_id uuid not null references public.tags(id) on delete cascade, created_at timestamptz not null default now(), primary key(lead_id,tag_id));
create table public.campaigns (
  id uuid primary key default gen_random_uuid(), name text not null, subject text not null, preheader text,
  sender_name text not null, sender_email text not null, reply_to text, content_delta jsonb not null default '{}'::jsonb,
  content_html text not null default '', audience_filters jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check(status in ('draft','scheduled','queued','sending','sent','paused','failed','cancelled')),
  scheduled_at timestamptz, sent_at timestamptz, created_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.campaign_recipients (
  id uuid primary key default gen_random_uuid(), campaign_id uuid not null references public.campaigns(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete restrict,
  status text not null default 'queued' check(status in ('queued','sending','sent','delivered','bounced','complained','failed','cancelled')),
  provider_email_id text, attempts integer not null default 0, next_attempt_at timestamptz not null default now(), locked_at timestamptz,
  sent_at timestamptz, delivered_at timestamptz, error_message text, created_at timestamptz not null default now(), unique(campaign_id,lead_id)
);
create index campaign_recipients_queue_idx on public.campaign_recipients(status,next_attempt_at) where status in ('queued','failed');
create table public.email_events (
  id uuid primary key default gen_random_uuid(), recipient_id uuid references public.campaign_recipients(id) on delete set null,
  provider_event_id text unique not null, provider_email_id text not null, event_type text not null, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create table public.email_templates (
  id uuid primary key default gen_random_uuid(), name text not null, subject text not null default '', content_delta jsonb not null default '{}'::jsonb,
  content_html text not null default '', created_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.automations (
  id uuid primary key default gen_random_uuid(), name text not null, trigger_type text not null,
  trigger_config jsonb not null default '{}'::jsonb, active boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.automation_steps (
  id uuid primary key default gen_random_uuid(), automation_id uuid not null references public.automations(id) on delete cascade,
  position integer not null, action_type text not null, action_config jsonb not null default '{}'::jsonb, delay_minutes integer not null default 0, unique(automation_id,position)
);
create table public.automation_executions (
  id uuid primary key default gen_random_uuid(), automation_id uuid not null references public.automations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade, current_step integer not null default 0,
  status text not null default 'active', next_run_at timestamptz, created_at timestamptz not null default now(), unique(automation_id,lead_id)
);
create table public.suppression_list (id uuid primary key default gen_random_uuid(), email_hash text not null unique, reason text not null, created_at timestamptz not null default now());
create table public.settings (id uuid primary key default gen_random_uuid(), key text not null unique, value jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now());
create table public.audit_logs (id uuid primary key default gen_random_uuid(), admin_id uuid references auth.users(id), action text not null, resource_type text not null, resource_id uuid, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
create table public.signup_tokens (
  id uuid primary key default gen_random_uuid(), lead_id uuid not null references public.leads(id) on delete cascade,
  token_hash text not null unique, kind text not null check(kind in ('confirm','unsubscribe')), expires_at timestamptz not null,
  used_at timestamptz, created_at timestamptz not null default now()
);

do $$ declare t text; begin
  foreach t in array array['admin_profiles','polls','poll_options','poll_totals','leads','lead_consents','tags','lead_tags','campaigns','campaign_recipients','email_events','email_templates','automations','automation_steps','automation_executions','suppression_list','settings','audit_logs','signup_tokens'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

create policy polls_public_read on public.polls for select to anon,authenticated using(active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now()));
create policy polls_admin_all on public.polls for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy options_public_read on public.poll_options for select to anon,authenticated using(exists(select 1 from public.polls p where p.id=poll_id and p.active and (p.starts_at is null or p.starts_at <= now()) and (p.ends_at is null or p.ends_at > now())));
create policy options_admin_all on public.poll_options for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy poll_totals_admin_read on public.poll_totals for select to authenticated using(public.is_admin());

do $$ declare t text; begin
  foreach t in array array['admin_profiles','leads','lead_consents','tags','lead_tags','campaigns','campaign_recipients','email_events','email_templates','automations','automation_steps','automation_executions','suppression_list','settings','audit_logs','signup_tokens'] loop
    execute format('create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t || '_admin_all', t);
  end loop;
end $$;

grant select on public.polls,public.poll_options to anon,authenticated;
grant select on public.poll_totals to authenticated;
grant all on public.admin_profiles,public.leads,public.lead_consents,public.tags,public.lead_tags,public.campaigns,public.campaign_recipients,public.email_events,public.email_templates,public.automations,public.automation_steps,public.automation_executions,public.suppression_list,public.settings,public.audit_logs,public.signup_tokens to authenticated;
grant all on all tables in schema public to service_role;

create or replace function public.touch_updated_at() returns trigger language plpgsql set search_path='' as $$ begin new.updated_at=now(); return new; end $$;
create trigger polls_touch_updated_at before update on public.polls for each row execute function public.touch_updated_at();
create trigger leads_touch_updated_at before update on public.leads for each row execute function public.touch_updated_at();
create trigger campaigns_touch_updated_at before update on public.campaigns for each row execute function public.touch_updated_at();
create trigger templates_touch_updated_at before update on public.email_templates for each row execute function public.touch_updated_at();
create trigger automations_touch_updated_at before update on public.automations for each row execute function public.touch_updated_at();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
  ('public-assets','public-assets',true,5242880,array['image/jpeg','image/png','image/webp','image/gif']),
  ('campaign-images','campaign-images',true,5242880,array['image/jpeg','image/png','image/webp','image/gif'])
on conflict(id) do nothing;
create policy public_asset_read on storage.objects for select to anon,authenticated using(bucket_id='public-assets');
create policy campaign_asset_read on storage.objects for select to anon,authenticated using(bucket_id='campaign-images');
create policy admin_asset_insert on storage.objects for insert to authenticated with check(public.is_admin() and bucket_id in ('public-assets','campaign-images'));
create policy admin_asset_update on storage.objects for update to authenticated using(public.is_admin() and bucket_id in ('public-assets','campaign-images')) with check(public.is_admin() and bucket_id in ('public-assets','campaign-images'));
create policy admin_asset_delete on storage.objects for delete to authenticated using(public.is_admin() and bucket_id in ('public-assets','campaign-images'));
