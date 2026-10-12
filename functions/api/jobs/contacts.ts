// POST /api/jobs/contacts — look up employers' business phone and email in the FMCSA carrier census
// (public dataset az4n-8mr2) and save them for the Hiring radar. Admins only.
// Body: { employers: [{ company, state, cbsa }] } — at most 20 per call.
import { matchKey } from "../../../server/jobs";

interface Env { VITE_SUPABASE_URL?: string; VITE_SUPABASE_ANON_KEY?: string }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const sqlEsc = (s: string) => s.replace(/'/g, "''");

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  const url = env.VITE_SUPABASE_URL, anon = env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) return json({ error: "The site isn't connected to its database." }, 500);
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Sign in first." }, 401);
  const H = { apikey: anon, authorization: "Bearer " + token, "content-type": "application/json" };
  const rest = async (path: string, init: RequestInit = {}) => {
    const r = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
    if (!r.ok) throw new Error(`database ${r.status}`);
    return r.status === 204 || r.status === 201 ? null : r.json();
  };
  let session: any;
  try { session = await rest("rpc/my_session", { method: "POST", body: "{}" }); } catch { return json({ error: "Your sign-in has expired. Reload the page." }, 401); }
  if (!session?.is_admin) return json({ error: "Admins only." }, 403);

  const body: any = await request.json().catch(() => ({}));
  const employers: { company: string; state: string; cbsa?: string }[] = (Array.isArray(body?.employers) ? body.employers : [])
    .filter((e: any) => e && typeof e.company === "string" && /^[A-Z]{2}$/.test(e.state || "")).slice(0, 20);
  const found: any[] = [];
  for (const e of employers) {
    // first two significant words of the name, matched against DBA and legal names in the employer's state
    const words = (e.company.toUpperCase().replace(/[^A-Z0-9 &']/g, " ").split(/\s+/).filter((w) => w && !["THE", "LLC", "INC", "CO", "COMPANY", "OF", "AND", "A"].includes(w))).slice(0, 2);
    if (!words.length) continue;
    const like = sqlEsc(words.join(" "));
    const where = `phy_state='${e.state}' AND (upper(dba_name) like '%${like}%' OR upper(legal_name) like '%${like}%')`;
    const q = new URLSearchParams({ $where: where, $select: "dot_number,legal_name,dba_name,phy_city,phy_state,phone,email_address,power_units,crgo_household", $order: "power_units DESC", $limit: "5" });
    let rows: any[] = [];
    try { const r = await fetch(`https://data.transportation.gov/resource/az4n-8mr2.json?${q}`); if (r.ok) rows = await r.json(); } catch { /* skip */ }
    // prefer a record whose name matches closely and that hauls household goods
    const key = matchKey(e.company);
    const best = rows.filter((r) => { const k = matchKey(r.dba_name || r.legal_name); return k && (k === key || k.includes(key) || key.includes(k)); })
      .sort((a, b) => (b.crgo_household === "X" ? 1 : 0) - (a.crgo_household === "X" ? 1 : 0) || Number(b.power_units || 0) - Number(a.power_units || 0))[0];
    if (!best) continue;
    const p = String(best.phone || "").replace(/\D/g, "");
    found.push({ company_key: key, company: e.company, cbsa: e.cbsa || null, usdot: String(best.dot_number), legal_name: best.legal_name || null,
      phone: p.length === 10 ? `(${p.slice(0, 3)}) ${p.slice(3, 6)}-${p.slice(6)}` : best.phone || null, email: best.email_address || null,
      trucks: Number(best.power_units) || null, source: "FMCSA carrier census", updated_at: new Date().toISOString() });
  }
  if (found.length) {
    // keep any admin-typed contact name/notes: only the FMCSA columns are merged
    await rest("employer_contacts?on_conflict=company_key", { method: "POST", headers: { prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(found) });
  }
  return json({ looked_up: employers.length, found: found.length });
}
