-- Moving Market Intelligence: Hiring radar (Acumena admins only).
-- Job postings from Adzuna (refreshed by the /api/jobs/refresh function, using the admin's own login)
-- and from Indeed sweeps (imported as a file on the Hiring radar page). Clients can't see any of it.

create table public.job_postings (
  id text primary key,                     -- "<source>:<source id>"
  source text not null check (source in ('adzuna', 'indeed')),
  title text not null,
  company text,
  company_norm text,                       -- lower-case name without Inc/LLC etc., for matching
  location text,
  cbsa text,                               -- metro the posting is in (or was searched from)
  role text not null default 'other',      -- driver | mover | sales | ops | warehouse | office | other
  pay_min numeric,
  pay_max numeric,
  pay_period text,                         -- hour | week | month | year | mile
  pay_hourly_mid numeric,                  -- pay converted to an hourly midpoint, for comparing
  job_type text,
  url text,
  posted_at date,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
create index job_postings_cbsa on public.job_postings (cbsa, last_seen);

create table public.job_refresh_runs (
  id bigint generated always as identity primary key,
  source text not null,
  markets text[] not null default '{}',
  postings int not null default 0,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

alter table public.job_postings enable row level security;
alter table public.job_refresh_runs enable row level security;
create policy postings_admin on public.job_postings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy runs_admin on public.job_refresh_runs for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
