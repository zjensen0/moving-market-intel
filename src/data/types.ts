// Shapes of the data the app works with. Market data mirrors data/market_data.json
// (built by the data pipeline); see scripts/prepare_app_data.py.

/* eslint-disable @typescript-eslint/no-explicit-any */
export type ScoreParts = { size: number | null; mom: number | null; room: number | null; val: number | null; lab: number | null };

/** Full detail for one metro (the per-metro object in market_data.json). */
export interface MetroDetail {
  c: string; // CBSA code
  n: string; // short name, e.g. "Detroit, MI"
  t: string; // official title
  s: string; // primary state
  st: string[];
  lat: number;
  lon: number;
  pop: (number | null)[]; // 2020..2025
  dm: (number | null)[]; // net domestic migration 2021..2025
  im: (number | null)[];
  nc: (number | null)[];
  acs: any;
  hhm: number | null;
  irs: any;
  ln: { in: any[]; out: any[] };
  z: { s: (number | null)[] | null; nl: (number | null)[]; hv: (number | null)[] } | null;
  k: any;
  fm: any;
  top: any[];
  q: any;
  ec?: any;
  dz: string;
  dmr: number | null;
  mpc: number | null;
  wage: number | null;
  sc: ScoreParts;
  pr: Record<string, number | null>;
}

/** Light row for every metro: enough for the picker and Compare markets. */
export interface MetroIndexRow {
  c: string;
  n: string;
  t: string;
  s: string;
  st: string[];
  lat: number;
  lon: number;
  pop25: number;
  hhm: number | null;
  dmr: number | null;
  movers: number;
  sc: ScoreParts;
}

export interface NationalData {
  built: string;
  zm: string[];
  last_month: string;
  weeks: string[];
  diesel: Record<string, { name: string; v: (number | null)[] }>;
  prices: any;
  gov: any;
  bench: any;
  us: any;
}

export interface Org {
  id: string;
  name: string;
  home_cbsa: string | null;
  plan: "selected" | "all";
  created_at?: string;
}

export interface Session {
  userId: string;
  email: string;
  isAdmin: boolean;
  org: Org | null;
  role: "owner" | "member" | null;
  markets: string[];
}

export interface Job {
  id?: number | string;
  job_date: string; // YYYY-MM-DD
  origin_zip: string | null;
  destination_zip: string | null;
  origin_cbsa: string | null;
  destination_cbsa: string | null;
  job_type: string | null;
  status: string | null;
  revenue: number | null;
  weight_lbs: number | null;
  crew_hours: number | null;
  lead_source: string | null;
}

export interface OrgOverview extends Org {
  markets: string[];
  members: number;
  jobs: number;
}

export interface Member {
  user_id: string;
  email: string;
  role: string;
}

export interface DataSource {
  readonly demo: boolean;
  // auth
  session(): Promise<Session | null>;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<"signed-in" | "check-email">;
  sendMagicLink(email: string): Promise<void>;
  signOut(): Promise<void>;
  joinOrg(code: string): Promise<void>;
  onAuthChange(cb: () => void): void;
  // market data
  national(): Promise<NationalData>;
  metroIndex(): Promise<MetroIndexRow[]>;
  metro(cbsa: string): Promise<MetroDetail | null>;
  // the signed-in company's jobs
  jobs(): Promise<Job[]>;
  addJobs(jobs: Job[]): Promise<number>;
  deleteAllJobs(): Promise<void>;
  // admin
  adminOverview(): Promise<OrgOverview[]>;
  createOrg(name: string, homeCbsa: string | null, plan: Org["plan"]): Promise<string>;
  updateOrg(id: string, patch: Partial<Pick<Org, "name" | "home_cbsa" | "plan">>): Promise<void>;
  setOrgMarkets(orgId: string, codes: string[]): Promise<void>;
  createInvite(orgId: string, role: "owner" | "member", days: number, maxUses: number): Promise<string>;
  listMembers(orgId: string): Promise<Member[]>;
  removeMember(orgId: string, userId: string): Promise<void>;
}

/** Build the light index row from a full metro object. */
export function indexRow(m: MetroDetail): MetroIndexRow {
  return {
    c: m.c, n: m.n, t: m.t, s: m.s, st: m.st, lat: m.lat, lon: m.lon,
    pop25: (m.pop[5] as number) ?? 0, hhm: m.hhm, dmr: m.dmr, movers: m.fm?.n ?? 0, sc: m.sc,
  };
}
