// POST /api/ask  — Cloudflare Pages Function behind the "Ask Acumena" box.
// Needs these settings in Cloudflare Pages (Settings > Variables and secrets):
//   ANTHROPIC_API_KEY  (secret)   from console.anthropic.com
//   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY   (already set for the site build)
//   optional: AI_MODEL (default claude-sonnet-5-5), AI_DAILY_LIMIT (default 25 per person; admins get 10x)
// Every database read uses the asking person's own login token, so plan limits and access rules apply.
import { ask, type AskData, type IndexRow } from "../../server/ai";

interface Env {
  ANTHROPIC_API_KEY?: string; VITE_SUPABASE_URL?: string; VITE_SUPABASE_ANON_KEY?: string;
  AI_MODEL?: string; AI_DAILY_LIMIT?: string;
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  const url = env.VITE_SUPABASE_URL, anon = env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) return json({ error: "The site isn't connected to its database." }, 500);
  if (!env.ANTHROPIC_API_KEY) return json({ error: "Ask Acumena isn't switched on yet. An admin needs to add the AI key in Cloudflare.", code: "no_key" }, 503);
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Sign in first." }, 401);

  let body: any;
  try { body = await request.json(); } catch { return json({ error: "Bad request." }, 400); }
  const question = String(body?.question || "").trim();
  if (!question) return json({ error: "Type a question." }, 400);
  if (question.length > 500) return json({ error: "Keep questions under 500 characters." }, 400);
  const business = body?.business && JSON.stringify(body.business).length < 6000 ? body.business : null;

  const H = { apikey: anon, authorization: "Bearer " + token, "content-type": "application/json" };
  const rest = async (path: string, init: RequestInit = {}) => {
    const r = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
    if (!r.ok) throw new Error(`database ${r.status}`);
    return r.status === 204 ? null : r.json();
  };

  let session: any;
  try { session = await rest("rpc/my_session", { method: "POST", body: "{}" }); } catch { return json({ error: "Your sign-in has expired. Reload the page." }, 401); }
  if (!session?.user_id) return json({ error: "Sign in first." }, 401);
  const isAdmin = !!session.is_admin;
  const limit = Number(env.AI_DAILY_LIMIT || 25) * (isAdmin ? 10 : 1);
  const used = Number(await rest("rpc/ai_questions_today", { method: "POST", body: "{}" }));
  if (used >= limit) return json({ error: `You've reached today's limit of ${limit} questions. It resets at midnight UTC.`, code: "limit" }, 429);

  const markets = new Set<string>(session.markets || []);
  const allPlan = isAdmin || session.org?.plan === "all";
  let indexCache: IndexRow[] | null = null;
  const data: AskData = {
    async index() {
      if (!indexCache) indexCache = ((await rest("metro_index?select=data")) as { data: IndexRow }[]).map((r) => r.data);
      return indexCache;
    },
    async snapshot(code) {
      const rows = (await rest(`market_snapshots?select=data&cbsa_code=eq.${encodeURIComponent(code)}`)) as { data: unknown }[];
      return rows.length ? rows[0].data : null;
    },
    async national() { return ((await rest("national_snapshot?select=data&id=eq.1")) as { data: unknown }[])[0]?.data; },
    allowed: (code) => allPlan || markets.has(code),
  };
  const idx = await data.index();
  const name = (c?: string | null) => (c ? idx.find((m) => m.c === c)?.n || null : null);
  const model = env.AI_MODEL || "claude-sonnet-5-5";
  try {
    const out = await ask({
      question, orgName: session.org?.name || null, homeMarket: name(session.org?.home_cbsa),
      currentMarket: name(typeof body?.market === "string" ? body.market : null), business,
    }, data, env.ANTHROPIC_API_KEY, model, fetch as never);
    await rest("ai_questions", {
      method: "POST", headers: { prefer: "return=minimal" },
      body: JSON.stringify({ org_id: session.org?.id || null, question, answer: out.answer, model: out.model, tokens_in: out.tokensIn, tokens_out: out.tokensOut }),
    }).catch(() => null);
    return json({ answer: out.answer, remaining: Math.max(0, limit - used - 1) });
  } catch (e) {
    return json({ error: (e as Error).message || "Something went wrong." }, 502);
  }
}
