-- Competitor watch: hiring activity in a market, aggregated by employer and role.
-- Clients can read it for markets in their plan (postings themselves stay admin-only).
create or replace function public.market_hiring(p_cbsa text)
returns table (company text, company_norm text, role text, postings int, pay_median numeric)
language sql stable security definer set search_path = public as $$
  select min(company), company_norm, role, count(*)::int,
         percentile_cont(0.5) within group (order by pay_hourly_mid)::numeric
  from public.job_postings
  where cbsa = p_cbsa and last_seen > now() - interval '60 days' and public.can_view_market(p_cbsa)
  group by company_norm, role;
$$;
revoke all on function public.market_hiring(text) from public, anon;
grant execute on function public.market_hiring(text) to authenticated;
