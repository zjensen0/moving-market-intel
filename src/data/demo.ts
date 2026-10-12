// Demo data source: everything runs in the browser with the bundled market data and a made-up
// client ("Sample Moving Co." in Charlotte). No login, nothing saved.
import type { DataSource, EmployerContact, Job, Member, MetroDetail, NationalData, Org, OrgOverview, Session } from "./types";
import { indexRow } from "./types";
import { sampleJobs } from "../business/sample";
import { fromIndeed, matchKey } from "../../server/jobs";
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

// Example answers for the demo (written from the bundled data; the live app generates answers with AI).
const DEMO_ANSWERS: { q: string; match: RegExp; answer: string }[] = [
  { q: "Where should we add long-distance routes from Charlotte?", match: /long.?distance|route|lane/i,
    answer: "Your biggest opportunity is the **New York to Charlotte** lane: about 3,700 households a year make that 541-mile move, and you booked none of them in the last 12 months.\n\n- **Charlotte to Raleigh** (1,789 households a year, 138 miles) is your strongest lane today at 1.8% share.\n- **Miami to Charlotte** (1,485 a year) and **Washington, DC to Charlotte** (1,219) are large inbound lanes where your share is under 1%.\n- Long-distance is 38% of your revenue against 50% for movers based in Charlotte (2022 Economic Census), so there is room to grow it.\n\nSource: IRS household moves 2022–23 and your uploaded jobs. See [Charlotte, NC](#/market/16740)." },
  { q: "Which mid-size metros in the Southeast have the least competition?", match: /competition|least|thin|crowd/i,
    answer: "Measured by household moves a year per licensed mover based there, the thinnest competition among the 47 mid-size Southeast metros (250,000 to 1 million people) is in Louisiana, Alabama and upstate South Carolina.\n\n- [Shreveport, LA](#/market/43340): about 18,500 household moves a year and only 4 licensed movers, roughly 4,600 moves per mover. Home sales are forecast up about 4% this fall.\n- [Tuscaloosa, AL](#/market/46220): about 19,800 moves and 5 movers, roughly 4,000 per mover.\n- [Spartanburg, SC](#/market/43900): about 18,100 moves and 5 movers, roughly 3,600 per mover, with sales forecast up about 4%.\n- [Baton Rouge, LA](#/market/12940): the largest of the group, about 45,400 moves and 14 movers.\n\nThese markets aren't in your plan, so I can only show these preview numbers; full lanes and competitor detail need them added. Source: Census 2024 movers and FMCSA mover counts (October 2026)."},
  { q: "What's the outlook for Charlotte this fall?", match: /outlook|forecast|fall|next/i,
    answer: "Expect about **33,100 household moves in Charlotte from September to November**, about 2% more than the same months last year (likely range 30,900 to 37,400).\n\n- Home sales over the last three months were up 1.0% on a year earlier and new listings were up 3.9% (Zillow, through August 2026).\n- Your own bookings were up 6.6% over the same stretch, so you're gaining share.\n- Your booking forecast for those three months is about 186 jobs (likely 155 to 227).\n\nSee the forecast on [Charlotte, NC](#/market/16740)." },
];

// Company-level contact channels for the demo sweep: business phone/email as filed with FMCSA (public
// record) and managers named on company websites.
const DEMO_CONTACTS: Omit<EmployerContact, "company_key">[] = [
  { company: "TWO MEN AND A TRUCK", cbsa: "41180", usdot: "714664", legal_name: "J & C ENTERPRISES INC", phone: "(314) 963-7766", email: "john@tmtstl.com", trucks: 32, contact_name: "John Judson", contact_title: "President and owner, J&C Enterprises (St. Louis franchise)", source: "franchising.com profile; FMCSA carrier census", notes: "Runs 15 TMAT franchises." },
  { company: "Next Stop Movers", cbsa: "39580", usdot: "3619230", legal_name: "NEXT STOP MOVERS LLC", phone: "(919) 249-8351", email: "info@nextstopmoversnc.com", trucks: 6, contact_name: "Josh Murray, Hale Hong", contact_title: "Owners", source: "nextstopmoversnc.com/about; FMCSA carrier census", notes: null },
  { company: "Gentle Giant", cbsa: "16740", usdot: "373544", legal_name: "GENTLE GIANT INTERSTATE COMPANY LLC", phone: "(704) 376-2338", email: null, trucks: 88, contact_name: "Bob Farnum", contact_title: "Charlotte Regional Manager", source: "gentlegiant.com Charlotte page", notes: "Charlotte branch phone; HQ Winchester, MA." },
  { company: "Bek Moving", cbsa: "41180", usdot: "3237297", legal_name: "BEK MOVING COMPANY LLC", phone: "(314) 337-9988", email: "home@bekmoving.com", trucks: 7, contact_name: null, contact_title: null, source: "FMCSA carrier census", notes: null },
  { company: "MJC Movers", cbsa: "12060", usdot: "3041812", legal_name: "MJC MOVERS LLC", phone: "(770) 885-9343", email: "mjcmoving@gmail.com", trucks: 5, contact_name: null, contact_title: null, source: "FMCSA carrier census", notes: null },
  { company: "All My Sons Moving & Storage", cbsa: "26900", usdot: "818918", legal_name: "GREEN LINE MOVING & STORAGE OF INDIANAPOLIS LLC", phone: "(469) 461-5000", email: "compliance@allmysons.com", trucks: 10, contact_name: null, contact_title: "Corporate talent acquisition (Carrollton, TX); local GM", source: "FMCSA carrier census", notes: null },
];

export async function createDemoSource(): Promise<DemoSource> {
  const market = (await import("../../data/market_data.json")).default as unknown as NationalData & { metros: MetroDetail[] };
  const zip = (await import("../../data/zip_cbsa.json")).default as Record<string, string>;
  const byCode = new Map(market.metros.map((m) => [m.c, m]));
  const national: NationalData = { ...market };
  delete (national as Partial<typeof market>).metros;

  const home = byCode.get("16740") as MetroDetail; // Charlotte, NC
  const orgs: DemoOrg[] = __REAL__ ? [] : [
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
  let role: DemoRole = __REAL__ ? "admin" : load<DemoRole>("mmi.demoRole") || "client";
  let sample = !__REAL__;
  let realContacts: EmployerContact[] | null = null;
  const me = () => orgs[0];

  const src: DemoSource = {
    demo: true,
    demoRole: () => role,
    setDemoRole(r) { role = r; save("mmi.demoRole", r); },
    zipMap: () => zip,
    isSample: () => sample,
    async session(): Promise<Session> {
      if (__REAL__) return { userId: "offline", email: "", isAdmin: true, org: null, role: "owner", markets: [] };
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
    async jobs() { return __REAL__ ? [] : me().jobs; },
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
    async ask(question) {
      if (__REAL__) return { answer: "Ask Acumena works on the live site." };
      await new Promise((r) => setTimeout(r, 700));
      const hit = DEMO_ANSWERS.find((a) => a.match.test(question));
      return { answer: hit ? hit.answer : "In the demo, Ask Acumena answers the example questions shown above. In the live app it answers any question about the markets in your plan, using the same data as these pages." };
    },
    async postings() {
      const rows = (__REAL__ ? (await import("../../data/indeed_sweep_2026-10-12b.json")).default : (await import("../../data/demo_indeed_sweep.json")).default) as unknown[];
      const keys = new Set<string>();
      for (const m of market.metros) for (const t of m.top || []) keys.add(matchKey(t[0]));
      return fromIndeed(rows, keys);
    },
    async refreshPostings() { throw new Error(__REAL__ ? "This offline copy holds the Indeed sweep from October 12, 2026. Refreshing works on the live site." : "The demo shows a real Indeed sweep from October 12, 2026. In the live app this button pulls fresh postings from Adzuna."); },
    async importPostings(rows) { return rows.length; },
    async lastPostingsRefresh() { return { created_at: "2026-10-12T16:00:00Z", source: "indeed", postings: (await src.postings()).length }; },
    async employerContacts() {
      if (__REAL__) { if (!realContacts) realContacts = (await import("../../data/employer_contacts_2026-10-12.json")).default as EmployerContact[]; return realContacts; }
      return DEMO_CONTACTS.map((c) => ({ ...c, company_key: matchKey(c.company) }));
    },
    async lookupEmployerContacts() { return { found: 0 }; },
    async saveEmployerContact(c) {
      if (__REAL__) {
        const list = (await src.employerContacts()) as EmployerContact[];
        const i = list.findIndex((x) => x.company_key === c.company_key);
        if (i >= 0) list[i] = { ...list[i], ...c }; else list.push({ cbsa: null, usdot: null, legal_name: null, phone: null, email: null, trucks: null, contact_name: null, contact_title: null, source: null, notes: null, ...c });
        return;
      }
      const i = DEMO_CONTACTS.findIndex((x) => matchKey(x.company) === c.company_key);
      const row = { ...(i >= 0 ? DEMO_CONTACTS[i] : { company: c.company, cbsa: null, usdot: null, legal_name: null, phone: null, email: null, trucks: null, contact_name: null, contact_title: null, source: null, notes: null }), ...c } as (typeof DEMO_CONTACTS)[number];
      if (i >= 0) DEMO_CONTACTS[i] = row; else DEMO_CONTACTS.push(row);
    },
    async aiLog() {
      if (__REAL__) return [];
      return [{ id: 1, user_id: "u1", org_id: "org-sample", email: "owner@samplemoving.example", question: DEMO_ANSWERS[0].q, answer: DEMO_ANSWERS[0].answer, tokens_in: 9800, tokens_out: 420, created_at: new Date().toISOString() }];
    },
    async loadMarketData(file, progress) { progress?.(1); return file.metros.length; },
    async removeMember(id, userId) {
      const o = orgs.find((x) => x.id === id) as DemoOrg;
      o.members = o.members.filter((m) => m.user_id !== userId);
    },
  };
  return src;
}
