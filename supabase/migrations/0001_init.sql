-- Moving Market Intelligence: database schema v1
-- Run once in the Supabase SQL editor (Dashboard > SQL editor > New query > paste > Run),
-- or with the Supabase CLI: supabase db push.
--
-- Who can see what
--   * Market data (public data we compile) is readable by any signed-in user for the metro list and
--     scores, but a metro's full detail is only readable if the user's company pays for that metro,
--     the company is on the all-markets plan, or the user is a platform admin.
--   * Client job data is readable and writable only by members of the company that uploaded it
--     (and platform admins).
--   * Companies, markets and invite codes are managed by platform admins.

-- ===================================================================== tables

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null default '',
  full_name text,
  created_at timestamptz not null default now()
);

create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  home_cbsa text,
  plan text not null default 'selected' check (plan in ('selected', 'all')),
  created_at timestamptz not null default now()
);

create table public.memberships (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
-- Version 1: each login belongs to one company.
create unique index memberships_one_org_per_user on public.memberships (user_id);

create table public.org_markets (
  org_id uuid not null references public.organizations (id) on delete cascade,
  cbsa_code text not null check (cbsa_code ~ '^[0-9]{5}$'),
  primary key (org_id, cbsa_code)
);

create table public.org_invites (
  code text primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  expires_at timestamptz not null default now() + interval '30 days',
  max_uses int not null default 5 check (max_uses > 0),
  uses int not null default 0,
  created_at timestamptz not null default now()
);

create table public.national_snapshot (
  id int primary key check (id = 1),
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.metro_index (
  cbsa_code text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.market_snapshots (
  cbsa_code text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.client_jobs (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  job_date date not null,
  origin_zip text,
  destination_zip text,
  origin_cbsa text,
  destination_cbsa text,
  job_type text,
  status text,
  revenue numeric(12, 2),
  weight_lbs numeric(12, 1),
  crew_hours numeric(10, 2),
  lead_source text,
  upload_batch uuid,
  created_at timestamptz not null default now()
);
create index client_jobs_org_date on public.client_jobs (org_id, job_date);

-- ===================================================================== helper functions
-- SECURITY DEFINER so row-level policies can call them without recursive policy checks.

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;

create or replace function public.my_org_id() returns uuid
language sql stable security definer set search_path = public as $$
  select org_id from public.memberships where user_id = auth.uid() limit 1;
$$;

create or replace function public.can_view_market(p_cbsa text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or exists (select 1 from public.organizations o
                 where o.id = public.my_org_id() and o.plan = 'all')
      or exists (select 1 from public.org_markets m
                 where m.org_id = public.my_org_id() and m.cbsa_code = p_cbsa);
$$;

-- Every new login gets a profile row (used by admins to see who joined).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, coalesce(new.email, ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- A signed-in user joins a company with an invite code.
create or replace function public.join_org(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  inv public.org_invites;
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;
  select * into inv from public.org_invites where code = upper(trim(p_code)) for update;
  if not found then
    raise exception 'That invite code was not found';
  end if;
  if inv.expires_at < now() then
    raise exception 'That invite code has expired';
  end if;
  if inv.uses >= inv.max_uses then
    raise exception 'That invite code has already been used the maximum number of times';
  end if;
  if exists (select 1 from public.memberships where user_id = auth.uid()) then
    raise exception 'This login already belongs to a company';
  end if;
  insert into public.memberships (org_id, user_id, role) values (inv.org_id, auth.uid(), inv.role);
  update public.org_invites set uses = uses + 1 where code = inv.code;
  return inv.org_id;
end;
$$;

-- Admins create invite codes (10 characters, letters A-F and digits).
create or replace function public.create_invite(p_org uuid, p_role text default 'member',
                                                p_days int default 30, p_max_uses int default 5)
returns text
language plpgsql security definer set search_path = public as $$
declare
  c text;
begin
  if not public.is_admin() then
    raise exception 'Only admins can create invite codes';
  end if;
  c := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into public.org_invites (code, org_id, role, expires_at, max_uses)
  values (c, p_org, p_role, now() + make_interval(days => p_days), p_max_uses);
  return c;
end;
$$;

-- One call for the app: who am I, which company, which markets.
create or replace function public.my_session() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'user_id', auth.uid(),
    'email', (select email from public.profiles where id = auth.uid()),
    'is_admin', public.is_admin(),
    'org', (select to_jsonb(o) from public.organizations o where o.id = public.my_org_id()),
    'role', (select role from public.memberships where user_id = auth.uid() limit 1),
    'markets', coalesce((select jsonb_agg(cbsa_code order by cbsa_code)
                         from public.org_markets where org_id = public.my_org_id()), '[]'::jsonb)
  );
$$;

-- Admin overview of companies with member and market counts.
create or replace function public.admin_org_overview() returns table (
  id uuid, name text, home_cbsa text, plan text, created_at timestamptz,
  markets text[], members bigint, jobs bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can see all companies';
  end if;
  return query
    select o.id, o.name, o.home_cbsa, o.plan, o.created_at,
           coalesce((select array_agg(m.cbsa_code order by m.cbsa_code) from public.org_markets m where m.org_id = o.id), '{}'),
           (select count(*) from public.memberships ms where ms.org_id = o.id),
           (select count(*) from public.client_jobs j where j.org_id = o.id)
    from public.organizations o
    order by o.name;
end;
$$;

revoke all on function public.is_admin(), public.my_org_id(), public.can_view_market(text),
  public.join_org(text), public.create_invite(uuid, text, int, int), public.my_session(),
  public.admin_org_overview() from public, anon;
grant execute on function public.is_admin(), public.my_org_id(), public.can_view_market(text),
  public.join_org(text), public.create_invite(uuid, text, int, int), public.my_session(),
  public.admin_org_overview() to authenticated;

-- ===================================================================== row-level security

alter table public.profiles enable row level security;
alter table public.platform_admins enable row level security;
alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.org_markets enable row level security;
alter table public.org_invites enable row level security;
alter table public.national_snapshot enable row level security;
alter table public.metro_index enable row level security;
alter table public.market_snapshots enable row level security;
alter table public.client_jobs enable row level security;

-- profiles: see yourself, your colleagues, or everyone if admin; edit only yourself
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin()
         or id in (select user_id from public.memberships where org_id = public.my_org_id()));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- platform_admins: readable by admins only; changed only in the SQL editor
create policy admins_select on public.platform_admins for select to authenticated
  using (public.is_admin());

-- organizations
create policy orgs_select on public.organizations for select to authenticated
  using (id = public.my_org_id() or public.is_admin());
create policy orgs_insert on public.organizations for insert to authenticated
  with check (public.is_admin());
create policy orgs_update on public.organizations for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy orgs_delete on public.organizations for delete to authenticated
  using (public.is_admin());

-- memberships: see your own company's members; admins manage
create policy members_select on public.memberships for select to authenticated
  using (org_id = public.my_org_id() or public.is_admin());
create policy members_insert on public.memberships for insert to authenticated
  with check (public.is_admin());
create policy members_update on public.memberships for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy members_delete on public.memberships for delete to authenticated
  using (public.is_admin());

-- org_markets
create policy markets_select on public.org_markets for select to authenticated
  using (org_id = public.my_org_id() or public.is_admin());
create policy markets_insert on public.org_markets for insert to authenticated
  with check (public.is_admin());
create policy markets_delete on public.org_markets for delete to authenticated
  using (public.is_admin());

-- org_invites: admins only (clients redeem through join_org)
create policy invites_all on public.org_invites for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- market data: list and national data for every signed-in user, detail per plan
create policy national_select on public.national_snapshot for select to authenticated using (true);
create policy index_select on public.metro_index for select to authenticated using (true);
create policy snapshots_select on public.market_snapshots for select to authenticated
  using (public.can_view_market(cbsa_code));

-- client jobs: your company's rows only
create policy jobs_select on public.client_jobs for select to authenticated
  using (org_id = public.my_org_id() or public.is_admin());
create policy jobs_insert on public.client_jobs for insert to authenticated
  with check (org_id = public.my_org_id() or public.is_admin());
create policy jobs_delete on public.client_jobs for delete to authenticated
  using (org_id = public.my_org_id() or public.is_admin());
