-- Moving Market Intelligence: let platform admins load market data from the Admin page,
-- so no secret key is needed. Clients still only read (see 0001_init.sql).

create policy national_admin_write on public.national_snapshot for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy index_admin_write on public.metro_index for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy snapshots_admin_write on public.market_snapshots for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
