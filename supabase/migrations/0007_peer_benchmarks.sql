-- "Movers like you": anonymous benchmarks across Acumena's client companies, and the markets peers added.
-- Returns only aggregates (quartiles and counts), never another company's numbers, and nothing at all until
-- at least 5 other client companies have 50+ jobs in the last 12 complete months.
create or replace function public.peer_benchmarks()
returns jsonb
language sql stable security definer set search_path = public as $$
  with me as (select public.my_org_id() as id),
  win as (select (date_trunc('month', current_date) - interval '12 months')::date as f, date_trunc('month', current_date)::date as t),
  per as (
    select j.org_id,
      count(*) filter (where coalesce(j.status, '') <> 'Lost') as jobs,
      avg(j.revenue) filter (where coalesce(j.status, '') <> 'Lost' and j.revenue is not null) as avg_rev,
      sum(j.revenue) filter (where coalesce(j.status, '') <> 'Lost' and j.crew_hours > 0 and j.revenue is not null)
        / nullif(sum(j.crew_hours) filter (where coalesce(j.status, '') <> 'Lost' and j.crew_hours > 0 and j.revenue is not null), 0) as per_hour,
      (count(*) filter (where j.status in ('Completed', 'Booked')))::numeric
        / nullif(count(*) filter (where j.status in ('Completed', 'Booked', 'Lost')), 0) as win,
      (count(*) filter (where j.job_type = 'Long distance' and coalesce(j.status, '') <> 'Lost'))::numeric
        / nullif(count(*) filter (where j.job_type is not null and coalesce(j.status, '') <> 'Lost'), 0) as long_share
    from public.client_jobs j, win
    where j.job_date >= win.f and j.job_date < win.t
    group by j.org_id
  ),
  peers as (select p.* from per p, me where p.org_id <> me.id and p.jobs >= 50),
  mine as (select p.* from per p, me where p.org_id = me.id),
  q as (
    select count(*) as n,
      percentile_cont(array[0.25, 0.5, 0.75]) within group (order by jobs) as jobs,
      percentile_cont(array[0.25, 0.5, 0.75]) within group (order by avg_rev) as avg_rev,
      percentile_cont(array[0.25, 0.5, 0.75]) within group (order by per_hour) as per_hour,
      percentile_cont(array[0.25, 0.5, 0.75]) within group (order by win) as win,
      percentile_cont(array[0.25, 0.5, 0.75]) within group (order by long_share) as long_share
    from peers
  ),
  mkts as (
    select m.cbsa_code, count(distinct m.org_id) as peers
    from public.org_markets m join peers p on p.org_id = m.org_id
    where m.cbsa_code not in (select om.cbsa_code from public.org_markets om, me where om.org_id = me.id)
      and m.cbsa_code <> coalesce((select o.home_cbsa from public.organizations o, me where o.id = me.id), '')
    group by m.cbsa_code
    having count(distinct m.org_id) >= 2
    order by 2 desc
    limit 5
  )
  select case
    when (select id from me) is null then jsonb_build_object('peers', 0, 'ready', false)
    when (select n from q) < 5 then jsonb_build_object('peers', (select n from q), 'ready', false)
    else jsonb_build_object(
      'peers', (select n from q), 'ready', true,
      'quartiles', (select jsonb_build_object('jobs', jobs, 'avg_rev', avg_rev, 'per_hour', per_hour, 'win', win, 'long_share', long_share) from q),
      'mine', (select jsonb_build_object('jobs', jobs, 'avg_rev', avg_rev, 'per_hour', per_hour, 'win', win, 'long_share', long_share) from mine),
      'markets', coalesce((select jsonb_agg(jsonb_build_object('cbsa', cbsa_code, 'peers', peers)) from mkts), '[]'::jsonb))
  end;
$$;
revoke all on function public.peer_benchmarks() from public, anon;
grant execute on function public.peer_benchmarks() to authenticated;
