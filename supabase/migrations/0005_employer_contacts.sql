-- Hiring radar: company-level contact channels for employers (Acumena admins only).
-- Business phone and email come from the carrier's own FMCSA filing (public record); the named
-- contact and notes are typed in by an admin from what the company publishes.
create table public.employer_contacts (
  company_key text primary key,       -- matchKey(company) from server/jobs.ts
  company text not null,
  cbsa text,
  usdot text,
  legal_name text,
  phone text,
  email text,
  trucks int,
  contact_name text,
  contact_title text,
  source text,
  notes text,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
alter table public.employer_contacts enable row level security;
create policy contacts_admin on public.employer_contacts for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
