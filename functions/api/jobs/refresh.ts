// POST /api/jobs/refresh — Hiring radar: pull moving and storage postings from Adzuna for a few metros.
// Admins only. Settings in Cloudflare Pages (Variables and secrets): ADZUNA_APP_ID, ADZUNA_APP_KEY (secret).
// Body: { markets: ["16740", ...] } — at most 8 per call (Cloudflare allows 50 outgoing requests per call;
// each metro uses 4 searches). The Hiring radar page calls this in batches.
// Writes use the admin's own login, so database rules apply as usual.
import { ADZUNA_QUERIES, fromAdzuna, matchKey, type MetroPoint, type Posting } from "../../../server/jobs";

interface Env { VITE_SUPABASE_URL?: string; VITE_SUPABASE_ANON_KEY?: string; ADZUNA_APP_ID?: string; ADZUNA_APP_KEY?: string }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  const url = env.VITE_SUPABASE_URL, anon = env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) return json({ error: "The site isn't connected to its database." }, 500);
  if (!env.ADZUNA_APP_ID || !env.ADZUNA_APP_KEY) return json({ error: "Adzuna isn't set up yet. Add ADZUNA_APP_ID and ADZUNA_APP_KEY in Cloudflare.", code: "no_key" }, 503);
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Sign in first." }, 401);
  const H = { apikey: anon, authorization: "Bearer " + token, "content-type": "application/json" };
  const rest = async (path: string, init: RequestInit = {}) => {
    const r = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
    if (!r.ok) throw new Error(`database ${r.status}: ${(await r.text()).slice(0, 160)}`);
    return r.status === 204 || r.status === 201 ? null : r.json();
  };
  let session: any;
  try { session = await rest("rpc/my_session", { method: "POST", body: "{}" }); } catch { return json({ error: "Your sign-in has expired. Reload the page." }, 401); }
  if (!session?.is_admin) return json({ error: "Only Acumena admins can use the Hiring radar." }, 403);

  const body: any = await request.json().catch(() => ({}));
  const markets: string[] = (Array.isArray(body?.markets) ? body.markets : []).filter((c: unknown) => typeof c === "string" && /^\d{5}$/.test(c)).slice(0, 8);
  if (!markets.length) return json({ error: "No markets given." }, 400);

  const index = ((await rest("metro_index?select=data")) as { data: any }[]).map((r) => r.data);
  const points: MetroPoint[] = index.map((m) => ({ c: m.c, lat: m.lat, lon: m.lon }));
  const byCode = new Map(index.map((m) => [m.c, m]));
  // known movers in these metros (FMCSA list in each market's snapshot), so their postings are always kept
  const snaps = (await rest(`market_snapshots?select=cbsa_code,data->top&cbsa_code=in.(${markets.join(",")})`)) as { cbsa_code: string; top: any[][] | null }[];
  const moverKeys = new Set<string>();
  for (const s of snaps) for (const t of s.top || []) { const k = matchKey(t[0]); if (k) moverKeys.add(k); }

  const found = new Map<string, Posting>();
  const errors: string[] = [];
  for (const c of markets) {
    const m = byCode.get(c);
    if (!m) continue;
    const where = m.n; // e.g. "Charlotte, NC"
    for (const what of ADZUNA_QUERIES) {
      const q = new URLSearchParams({ app_id: env.ADZUNA_APP_ID, app_key: env.ADZUNA_APP_KEY, what, where, distance: "50",
        max_days_old: "45", results_per_page: "50", "content-type": "application/json" });
      try {
        const r = await fetch(`https://api.adzuna.com/v1/api/jobs/us/search/1?${q}`);
        if (!r.ok) { errors.push(`${where} "${what}": Adzuna ${r.status}`); if (r.status === 401 || r.status === 403) break; continue; }
        const out: any = await r.json();
        for (const x of out.results || []) { const p = fromAdzuna(x, c, points, moverKeys); if (p) found.set(p.id, p); }
      } catch (e) { errors.push(`${where} "${what}": ${(e as Error).message}`); }
    }
  }
  const rows = [...found.values()].map((p) => ({ ...p, last_seen: new Date().toISOString() }));
  if (rows.length) {
    // upsert; keep first_seen from the original insert
    await rest("job_postings?on_conflict=id", { method: "POST", headers: { prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows) });
  }
  await rest("job_refresh_runs", { method: "POST", headers: { prefer: "return=minimal" },
    body: JSON.stringify({ source: "adzuna", markets, postings: rows.length, note: errors.slice(0, 5).join("; ") || null }) }).catch(() => null);
  return json({ postings: rows.length, markets: markets.length, errors });
}
