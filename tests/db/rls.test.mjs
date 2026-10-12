// Checks the database rules (row-level security, invite codes) against an in-memory Postgres.
// Run: npm run test:db
// It mimics Supabase: an auth schema with auth.users and auth.uid(), plus the anon and
// authenticated roles, then runs supabase/migrations/0001_init.sql unchanged.
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import assert from "node:assert/strict";

const db = new PGlite();
const ids = {
  admin: "00000000-0000-0000-0000-00000000000a",
  alice: "00000000-0000-0000-0000-0000000000a1",
  bob: "00000000-0000-0000-0000-0000000000b0",
  carol: "00000000-0000-0000-0000-0000000000c0",
};
let passed = 0;
const ok = (name) => { passed++; console.log("  ok -", name); };

await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`);
for (const f of ["0001_init.sql", "0002_admin_market_data.sql"])
  await db.exec(readFileSync(new URL("../../supabase/migrations/" + f, import.meta.url), "utf8"));
// Supabase grants table privileges to these roles by default; row-level security does the limiting.
await db.exec(`
  grant usage on schema public to anon, authenticated;
  grant select, insert, update, delete on all tables in schema public to authenticated;
  grant usage, select on all sequences in schema public to authenticated;
`);

async function as(who, sql, params = []) {
  await db.exec(`set role authenticated`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [ids[who]]);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec(`reset role`);
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  }
}
async function fails(who, sql, params, pattern, name) {
  let err = null;
  try { await as(who, sql, params); } catch (e) { err = e; }
  assert.ok(err, `${name}: expected an error`);
  if (pattern) assert.match(String(err.message), pattern, name);
  ok(name);
}

console.log("database rules");
// users sign up (as Supabase would), admin is marked in the SQL editor
for (const [k, v] of Object.entries(ids)) await db.query(`insert into auth.users (id, email) values ($1, $2)`, [v, `${k}@example.com`]);
await db.query(`insert into public.platform_admins (user_id) values ($1)`, [ids.admin]);
const prof = await db.query(`select count(*)::int as n from public.profiles`);
assert.equal(prof.rows[0].n, 4); ok("new logins get a profile");

// market data loaded with the service role (bypasses row-level security)
await db.exec(`
  insert into public.national_snapshot (id, data) values (1, '{"built":"2026-10-11"}');
  insert into public.metro_index (cbsa_code, data) values ('19820', '{"n":"Detroit, MI"}'), ('14460', '{"n":"Boston, MA"}');
  insert into public.market_snapshots (cbsa_code, data) values ('19820', '{"n":"Detroit, MI"}'), ('14460', '{"n":"Boston, MA"}');
`);

// admin sets up a client company with one market and an invite code
const alpha = (await as("admin", `insert into public.organizations (name, home_cbsa, plan) values ('Alpha Movers', '19820', 'selected') returning id`)).rows[0].id;
await as("admin", `insert into public.org_markets (org_id, cbsa_code) values ($1, '19820')`, [alpha]);
const code = (await as("admin", `select public.create_invite($1) as c`, [alpha])).rows[0].c;
assert.match(code, /^[0-9A-F]{10}$/); ok("admin creates a company, a market and an invite code");

// before joining, Alice sees the metro list but no market detail
assert.equal((await as("alice", `select * from public.metro_index`)).rows.length, 2);
assert.equal((await as("alice", `select * from public.market_snapshots`)).rows.length, 0);
assert.equal((await as("alice", `select * from public.national_snapshot`)).rows.length, 1);
ok("a login without a company sees the metro list only");

await as("alice", `select public.join_org($1)`, [code.toLowerCase()]);
const aliceSnaps = (await as("alice", `select cbsa_code from public.market_snapshots`)).rows.map((r) => r.cbsa_code);
assert.deepEqual(aliceSnaps, ["19820"]); ok("after joining, Alice sees only the market her company pays for");

const sess = (await as("alice", `select public.my_session() as s`)).rows[0].s;
assert.equal(sess.org.name, "Alpha Movers");
assert.deepEqual(sess.markets, ["19820"]);
assert.equal(sess.is_admin, false); ok("my_session returns company and markets");

await fails("alice", `select public.join_org($1)`, [code], /already belongs/, "a login can't join a second company");
await fails("alice", `select public.create_invite($1)`, [alpha], /Only admins/, "clients can't create invite codes");
await fails("alice", `insert into public.organizations (name) values ('Sneaky Co')`, [], /row-level security/, "clients can't create companies");
await fails("alice", `insert into public.org_markets (org_id, cbsa_code) values ($1, '14460')`, [alpha], /row-level security/, "clients can't add markets to their plan");

// a second company on the all-markets plan
const beta = (await as("admin", `insert into public.organizations (name, plan) values ('Beta Van Lines', 'all') returning id`)).rows[0].id;
const code2 = (await as("admin", `select public.create_invite($1, 'owner', 30, 1) as c`, [beta])).rows[0].c;
await as("bob", `select public.join_org($1)`, [code2]);
assert.equal((await as("bob", `select * from public.market_snapshots`)).rows.length, 2); ok("all-markets plan sees every market");
await fails("carol", `select public.join_org($1)`, [code2], /maximum number of times/, "single-use code can't be reused");

// client job data stays inside the company
await as("alice", `insert into public.client_jobs (org_id, job_date, origin_zip, destination_zip, revenue) values ($1, '2026-06-01', '48226', '60601', 4200)`, [alpha]);
await fails("alice", `insert into public.client_jobs (org_id, job_date) values ($1, '2026-06-02')`, [beta], /row-level security/, "a client can't write jobs into another company");
await as("bob", `insert into public.client_jobs (org_id, job_date, revenue) values ($1, '2026-06-03', 900)`, [beta]);
const aliceJobs = (await as("alice", `select org_id from public.client_jobs`)).rows;
assert.equal(aliceJobs.length, 1); assert.equal(aliceJobs[0].org_id, alpha);
const bobJobs = (await as("bob", `select org_id from public.client_jobs`)).rows;
assert.equal(bobJobs.length, 1); assert.equal(bobJobs[0].org_id, beta); ok("each company sees only its own jobs");
const delOther = await as("alice", `delete from public.client_jobs where org_id = $1`, [beta]);
assert.equal(delOther.affectedRows ?? 0, 0);
assert.equal((await db.query(`select count(*)::int n from public.client_jobs where org_id = $1`, [beta])).rows[0].n, 1);
ok("a client can't delete another company's jobs");

// company and member visibility
assert.deepEqual((await as("alice", `select name from public.organizations`)).rows.map((r) => r.name), ["Alpha Movers"]);
assert.equal((await as("alice", `select * from public.memberships`)).rows.length, 1);
assert.equal((await as("admin", `select * from public.organizations`)).rows.length, 2); ok("clients see only their own company; admins see all");
const overview = (await as("admin", `select * from public.admin_org_overview()`)).rows;
assert.equal(overview.length, 2);
const alphaRow = overview.find((o) => o.name === "Alpha Movers");
assert.equal(Number(alphaRow.jobs), 1);
assert.equal(Number(alphaRow.members), 1);
assert.deepEqual(alphaRow.markets, ["19820"]);
await fails("alice", `select * from public.admin_org_overview()`, [], /Only admins/, "admin overview is admin-only");

// expired codes are refused
const code3 = (await as("admin", `select public.create_invite($1) as c`, [alpha])).rows[0].c;
await db.query(`update public.org_invites set expires_at = now() - interval '1 day' where code = $1`, [code3]);
await fails("carol", `select public.join_org($1)`, [code3], /expired/, "expired codes are refused");

// signed-out visitors get nothing
let anonRows = null;
try {
  await db.exec(`set role anon`);
  anonRows = (await db.query(`select * from public.metro_index`)).rows;
} catch (e) {
  anonRows = [];
} finally {
  await db.exec(`reset role`);
}
assert.equal(anonRows.length, 0); ok("signed-out visitors can't read anything");

// market data: admins can load it, clients can't change it
await as("admin", `insert into public.metro_index (cbsa_code, data) values ('99999', '{}'::jsonb)
                   on conflict (cbsa_code) do update set data = excluded.data`);
await as("admin", `insert into public.national_snapshot (id, data) values (1, '{"built":"x"}'::jsonb)
                   on conflict (id) do update set data = excluded.data`);
ok("admins can load market data");
await fails("alice", `insert into public.metro_index (cbsa_code, data) values ('88888', '{}'::jsonb)`, [], /row-level security/, "clients can't add market data");
const upd = await as("alice", `update public.market_snapshots set data = '{}'::jsonb returning cbsa_code`);
assert.equal(upd.rows.length, 0); ok("clients can't change market data");

console.log(`\n${passed} checks passed`);
