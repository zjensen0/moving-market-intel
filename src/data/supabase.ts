// Live data source: Supabase for logins, market data and each company's jobs.
// Access rules live in the database (supabase/migrations/0001_init.sql), not here.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AiLogRow, DataSource, Job, Member, MetroDetail, MetroIndexRow, NationalData, OrgOverview, Session } from "./types";
import { indexRow } from "./types";

const PAGE = 1000;

export function createSupabaseSource(url: string, anonKey: string): DataSource & { zipMap(): Promise<Record<string, string>>; hasMarketData(): Promise<boolean> } {
  const sb: SupabaseClient = createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  let cached: Session | null = null;

  const fail = (e: { message?: string } | null) => {
    if (e) throw new Error(e.message || "Something went wrong talking to the database");
  };

  async function session(): Promise<Session | null> {
    const { data } = await sb.auth.getSession();
    if (!data.session) { cached = null; return null; }
    const { data: s, error } = await sb.rpc("my_session");
    fail(error);
    cached = {
      userId: s.user_id, email: s.email || data.session.user.email || "", isAdmin: !!s.is_admin,
      org: s.org ? { id: s.org.id, name: s.org.name, home_cbsa: s.org.home_cbsa, plan: s.org.plan } : null,
      role: s.role, markets: s.markets || [],
    };
    return cached;
  }

  let zipCache: Record<string, string> | null = null;

  return {
    demo: false,
    session,
    async zipMap() {
      if (!zipCache) zipCache = (await import("../../data/zip_cbsa.json")).default as Record<string, string>;
      return zipCache;
    },
    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      fail(error);
    },
    async signUp(email, password) {
      const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
      fail(error);
      return data.session ? "signed-in" : "check-email";
    },
    async sendMagicLink(email) {
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: true } });
      fail(error);
    },
    async signOut() { await sb.auth.signOut(); cached = null; },
    async joinOrg(code) {
      const { error } = await sb.rpc("join_org", { p_code: code });
      fail(error);
    },
    onAuthChange(cb) {
      // Fire only when the signed-in person changes (sign-in or sign-out, also from another tab).
      // Supabase repeats SIGNED_IN when a tab regains focus, so the event name alone isn't enough.
      let last: string | null | undefined;
      sb.auth.onAuthStateChange((_event, s) => {
        const uid = s?.user?.id ?? null;
        if (last === undefined) { last = uid; return; }
        if (uid !== last) { last = uid; cb(); }
      });
    },
    async ask(question, context) {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Your sign-in has expired. Reload the page.");
      let r: Response;
      try {
        r = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token },
          body: JSON.stringify({ question, market: context.market, business: context.business ?? null }) });
      } catch { throw new Error("Couldn't reach the server. Check your connection and try again."); }
      const out = await r.json().catch(() => ({ error: "The server sent back something unexpected." }));
      if (!r.ok) throw new Error(out.error || "Something went wrong.");
      return out;
    },
    async aiLog(): Promise<AiLogRow[]> {
      const { data, error } = await sb.from("ai_questions").select("id,user_id,org_id,question,answer,tokens_in,tokens_out,created_at")
        .order("created_at", { ascending: false }).limit(100);
      fail(error);
      const rows = (data || []) as AiLogRow[];
      const ids = [...new Set(rows.map((r) => r.user_id))];
      if (ids.length) {
        const { data: ps } = await sb.from("profiles").select("id,email").in("id", ids);
        const em = new Map((ps || []).map((p) => [p.id, p.email]));
        rows.forEach((r) => { r.email = em.get(r.user_id) || ""; });
      }
      return rows;
    },
    async hasMarketData() {
      const { data, error } = await sb.from("national_snapshot").select("id").eq("id", 1).maybeSingle();
      fail(error);
      return !!data;
    },
    async national(): Promise<NationalData> {
      const { data, error } = await sb.from("national_snapshot").select("data").eq("id", 1).single();
      fail(error);
      return data!.data as NationalData;
    },
    async metroIndex(): Promise<MetroIndexRow[]> {
      const { data, error } = await sb.from("metro_index").select("data").range(0, PAGE - 1);
      fail(error);
      return (data || []).map((r) => r.data as MetroIndexRow);
    },
    async metro(c): Promise<MetroDetail | null> {
      const { data, error } = await sb.from("market_snapshots").select("data").eq("cbsa_code", c).maybeSingle();
      fail(error);
      return data ? (data.data as MetroDetail) : null; // null when the plan doesn't include it
    },
    async jobs(): Promise<Job[]> {
      const orgId = (cached ?? (await session()))?.org?.id;
      if (!orgId) return [];
      const out: Job[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await sb.from("client_jobs")
          .select("id,job_date,origin_zip,destination_zip,origin_cbsa,destination_cbsa,job_type,status,revenue,weight_lbs,crew_hours,lead_source")
          .eq("org_id", orgId).order("job_date").order("id").range(from, from + PAGE - 1);
        fail(error);
        out.push(...((data || []) as Job[]).map((j) => ({ ...j, revenue: j.revenue == null ? null : Number(j.revenue),
          weight_lbs: j.weight_lbs == null ? null : Number(j.weight_lbs), crew_hours: j.crew_hours == null ? null : Number(j.crew_hours) })));
        if (!data || data.length < PAGE) break;
      }
      return out;
    },
    async addJobs(jobs) {
      const orgId = (cached ?? (await session()))?.org?.id;
      if (!orgId) throw new Error("Your login isn't linked to a company yet");
      const batch = crypto.randomUUID();
      for (let i = 0; i < jobs.length; i += 500) {
        const rows = jobs.slice(i, i + 500).map((j) => ({
          org_id: orgId, upload_batch: batch, job_date: j.job_date, origin_zip: j.origin_zip, destination_zip: j.destination_zip,
          origin_cbsa: j.origin_cbsa, destination_cbsa: j.destination_cbsa, job_type: j.job_type, status: j.status,
          revenue: j.revenue, weight_lbs: j.weight_lbs, crew_hours: j.crew_hours, lead_source: j.lead_source,
        }));
        const { error } = await sb.from("client_jobs").insert(rows);
        fail(error);
      }
      return jobs.length;
    },
    async deleteAllJobs() {
      const orgId = (cached ?? (await session()))?.org?.id;
      if (!orgId) return;
      const { error } = await sb.from("client_jobs").delete().eq("org_id", orgId);
      fail(error);
    },
    async adminOverview(): Promise<OrgOverview[]> {
      const { data, error } = await sb.rpc("admin_org_overview");
      fail(error);
      return (data || []).map((o: OrgOverview) => ({ ...o, members: Number(o.members), jobs: Number(o.jobs), markets: o.markets || [] }));
    },
    async createOrg(name, homeCbsa, plan) {
      const { data, error } = await sb.from("organizations").insert({ name, home_cbsa: homeCbsa, plan }).select("id").single();
      fail(error);
      return data!.id as string;
    },
    async updateOrg(id, patch) {
      const { error } = await sb.from("organizations").update(patch).eq("id", id);
      fail(error);
    },
    async setOrgMarkets(orgId, codes) {
      const { error: e1 } = await sb.from("org_markets").delete().eq("org_id", orgId);
      fail(e1);
      if (codes.length) {
        const { error: e2 } = await sb.from("org_markets").insert(codes.map((c) => ({ org_id: orgId, cbsa_code: c })));
        fail(e2);
      }
    },
    async createInvite(orgId, role, days, maxUses) {
      const { data, error } = await sb.rpc("create_invite", { p_org: orgId, p_role: role, p_days: days, p_max_uses: maxUses });
      fail(error);
      return data as string;
    },
    async listMembers(orgId): Promise<Member[]> {
      const { data: ms, error } = await sb.from("memberships").select("user_id, role").eq("org_id", orgId);
      fail(error);
      if (!ms?.length) return [];
      const { data: ps, error: e2 } = await sb.from("profiles").select("id, email").in("id", ms.map((m) => m.user_id));
      fail(e2);
      const email = new Map((ps || []).map((p) => [p.id, p.email]));
      return ms.map((m) => ({ user_id: m.user_id, role: m.role, email: email.get(m.user_id) || "(unknown)" }));
    },
    async loadMarketData(file, progress) {
      const { metros, ...national } = file;
      const now = new Date().toISOString();
      const { error } = await sb.from("national_snapshot").upsert({ id: 1, data: national, updated_at: now });
      fail(error);
      for (let i = 0; i < metros.length; i += 25) {
        const chunk = metros.slice(i, i + 25);
        const r1 = await sb.from("metro_index").upsert(chunk.map((m) => ({ cbsa_code: m.c, data: indexRow(m), updated_at: now })));
        fail(r1.error);
        const r2 = await sb.from("market_snapshots").upsert(chunk.map((m) => ({ cbsa_code: m.c, data: m, updated_at: now })));
        fail(r2.error);
        progress?.(Math.min(1, (i + chunk.length) / metros.length));
      }
      return metros.length;
    },
    async removeMember(orgId, userId) {
      const { error } = await sb.from("memberships").delete().eq("org_id", orgId).eq("user_id", userId);
      fail(error);
    },
  };
}
