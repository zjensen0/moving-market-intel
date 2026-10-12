// Loads data/market_data.json into Supabase: national_snapshot, metro_index, market_snapshots.
// Run on your computer (never from the website):
//   SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... node scripts/load_market_data.mjs
// Re-run whenever the data pipeline produces a new market_data.json. Rows are upserted, so it's safe to repeat.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY first.");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });
const market = JSON.parse(readFileSync(new URL("../data/market_data.json", import.meta.url), "utf8"));
const { metros, ...national } = market;

const indexRow = (m) => ({
  c: m.c, n: m.n, t: m.t, s: m.s, st: m.st, lat: m.lat, lon: m.lon,
  pop25: m.pop[5] ?? 0, hhm: m.hhm, dmr: m.dmr, movers: m.fm?.n ?? 0, sc: m.sc, fg: m.fc?.g ?? null,
});
const fail = (e, what) => { if (e) { console.error("Failed on " + what + ": " + e.message); process.exit(1); } };

console.log(`Loading ${metros.length} metros, data built ${national.built}…`);
fail((await sb.from("national_snapshot").upsert({ id: 1, data: national, updated_at: new Date().toISOString() })).error, "national_snapshot");
for (let i = 0; i < metros.length; i += 50) {
  const chunk = metros.slice(i, i + 50);
  fail((await sb.from("metro_index").upsert(chunk.map((m) => ({ cbsa_code: m.c, data: indexRow(m), updated_at: new Date().toISOString() })))).error, "metro_index");
  fail((await sb.from("market_snapshots").upsert(chunk.map((m) => ({ cbsa_code: m.c, data: m, updated_at: new Date().toISOString() })))).error, "market_snapshots");
  process.stdout.write(`\r${Math.min(i + 50, metros.length)} / ${metros.length}`);
}
console.log("\nDone.");
