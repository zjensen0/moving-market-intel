// Demo data source: everything runs in the browser with the bundled market data and a made-up
// client ("Sample Moving Co." in Charlotte). No login, nothing saved.
import type { DataSource, Job, Member, MetroDetail, NationalData, Org, OrgOverview, Session } from "./types";
import { indexRow } from "./types";
import { sampleJobs } from "../business/sample";
import { load, save } from "../lib/store";

interface DemoOrg extends Org { markets: string[]; members: Member[]; jobs: Job[] }
export type DemoRole = "client" | "admin";

export interface DemoSource extends DataSource {
  session(): Promise<Session>;
  demoRole(): DemoRole;
  setDemoRole(r: DemoRole): void;
  zipMap(): Record<string, string>;
  /** True until someone uploads or deletes jobs in the demo. */
  isSample(): boolean;
}

export async function createDemoSource(): Promise<DemoSource> {
  const market = (await import("../../data/market_data.json")).default as unknown as NationalData & { metros: MetroDetail[] };
  const zip = (await import("../../data/zip_cbsa.json")).default as Record<string, string>;
  const byCode = new Map(market.metros.map((m) => [m.c, m]));
  const national: NationalData = { ...market };
  delete (national as Partial<typeof market>).metros;

  const home = byCode.get("16740") as MetroDetail; // Charlotte, NC
  const orgs: DemoOrg[] = [
    {
      id: "org-sample", name: "Sample Moving Co.", home_cbsa: "16740", plan: "selected",
      markets: ["16740", "39580", "17900", "24860", "12060"],
      members: [
        { user_id: "u1", email: "owner@samplemoving.example", role: "owner" },
        { user_id: "u2", email: "sales@samplemoving.example", role: "member" },
      ],
      jobs: sampleJobs(home, national, zip, "35620"), // this sample company never books New York moves
    },
    {
      id: "org-van", name: "Example Van Lines Agent", home_cbsa: "26900", plan: "all", markets: [],
      members: [{ user_id: "u3", email: "ops@examplevan.example", role: "owner" }], jobs: [],
    },
    {
      id: "org-river", name: "Riverside Moving & Storage", home_cbsa: "41180", plan: "selected", markets: ["41180"],
      members: [{ user_id: "u4", email: "gm@riverside.example", role: "owner" }], jobs: [],
    },
  ];
  let role: DemoRole = load<DemoRole>("mmi.demoRole") || "client";
  let sample = true;
  const me = () => orgs[0];

  const src: DemoSource = {
    demo: true,
    demoRole: () => role,
    setDemoRole(r) { role = r; save("mmi.demoRole", r); },
    zipMap: () => zip,
    isSample: () => sample,
    async session(): Promise<Session> {
      const o = me();
      return {
        userId: "demo", email: role === "admin" ? "you@yourfirm.example" : "owner@samplemoving.example",
        isAdmin: role === "admin", org: { id: o.id, name: o.name, home_cbsa: o.home_cbsa, plan: o.plan },
        role: "owner", markets: o.markets,
      };
    },
    async signIn() { /* no logins in the demo */ },
    async signUp() { return "signed-in"; },
    async sendMagicLink() { /* no logins in the demo */ },
    async signOut() { /* no logins in the demo */ },
    async joinOrg() { /* no logins in the demo */ },
    onAuthChange() { /* no logins in the demo */ },
    async national() { return national; },
    async metroIndex() { return market.metros.map(indexRow); },
    async metro(c) {
      const s = await src.session();
      const allowed = s.isAdmin || s.org?.plan === "all" || s.markets.includes(c);
      return allowed ? byCode.get(c) ?? null : null;
    },
    async jobs() { return me().jobs; },
    async addJobs(jobs) { sample = false; me().jobs = me().jobs.concat(jobs); return jobs.length; },
    async deleteAllJobs() { sample = false; me().jobs = []; },
    async adminOverview(): Promise<OrgOverview[]> {
      return orgs.map((o) => ({ id: o.id, name: o.name, home_cbsa: o.home_cbsa, plan: o.plan, markets: o.markets, members: o.members.length, jobs: o.jobs.length }));
    },
    async createOrg(name, homeCbsa, plan) {
      const id = "org-" + Math.random().toString(36).slice(2, 8);
      orgs.push({ id, name, home_cbsa: homeCbsa, plan, markets: homeCbsa ? [homeCbsa] : [], members: [], jobs: [] });
      return id;
    },
    async updateOrg(id, patch) { Object.assign(orgs.find((o) => o.id === id) as DemoOrg, patch); },
    async setOrgMarkets(id, codes) { (orgs.find((o) => o.id === id) as DemoOrg).markets = [...codes].sort(); },
    async createInvite() { return Array.from({ length: 10 }, () => "0123456789ABCDEF"[Math.floor(Math.random() * 16)]).join(""); },
    async listMembers(id) { return (orgs.find((o) => o.id === id) as DemoOrg).members; },
    async removeMember(id, userId) {
      const o = orgs.find((x) => x.id === id) as DemoOrg;
      o.members = o.members.filter((m) => m.user_id !== userId);
    },
  };
  return src;
}
