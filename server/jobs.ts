// Hiring radar: turning raw job postings (Adzuna, Indeed) into clean rows for moving and storage.
// Shared by the Cloudflare refresh function and the browser (Indeed file import).

export interface Posting {
  id: string; source: "adzuna" | "indeed"; title: string; company: string | null; company_norm: string | null;
  location: string | null; cbsa: string | null; role: Role; pay_min: number | null; pay_max: number | null;
  pay_period: PayPeriod | null; pay_hourly_mid: number | null; job_type: string | null; url: string | null; posted_at: string | null;
  first_seen?: string; last_seen?: string;
}
export type Role = "driver" | "mover" | "sales" | "ops" | "warehouse" | "office" | "other";
export type PayPeriod = "hour" | "week" | "month" | "year" | "mile";
export const ROLE_NAMES: Record<Role, string> = {
  driver: "Drivers", mover: "Movers & crew", sales: "Estimators & sales", ops: "Operations & dispatch",
  warehouse: "Warehouse & storage", office: "Office & customer service", other: "Other",
};

const strip = (s: string) => s.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

export function classifyRole(title: string): Role {
  const t = title.toLowerCase();
  if (/estimat|sales|relocation consultant|move consultant|account (exec|manager)|business develop/.test(t)) return "sales";
  if (/dispatch|operations|general manager|branch manager|ops manager|supervisor|foreman|crew lead|crew chief|team lead|logistics coordinator|fleet manager/.test(t)) return "ops";
  if (/\bcdl\b|driver|truck operator|van operator|owner.?operator/.test(t)) return "driver";
  if (/mover|helper|crew|packer|loader|labor|installer|porter/.test(t)) return "mover";
  if (/warehouse|storage|inventory|forklift/.test(t)) return "warehouse";
  if (/customer service|coordinator|admin|billing|claims|receptionist|office|move manager|scheduler/.test(t)) return "office";
  return "other";
}

// Moving, van line and storage brands whose names don't say "moving"
const BRANDS = /two men and a truck|college hunks|all my sons|gentle giant|bellhop|mayflower|united van|allied van|atlas van|north american van|bekins|wheaton|arpin|graebel|suddath|sirva|cartwright|u-?haul|\bpods\b|public storage|extra space|cubesmart|life storage|storage king|smartstop/;

/** Keep postings from the moving and storage world; drop "prime mover" style noise. */
export function isRelevant(title: string, company: string | null, knownMover = false): boolean {
  if (knownMover) return true;
  const s = (title + " " + (company || "")).toLowerCase();
  if (/earth ?mover|prime mover|movers? and shakers|people mover|dirt|excavat|heavy equipment/.test(s)) return false;
  return /\bmov(ing|ers?|e manager|e coordinator)\b|relocation|van lines?|household goods|moving & storage|storage company|self.?storage|piano mov|furniture deliver/.test(s) || BRANDS.test(s);
}

export function normCompany(name: string | null | undefined): string | null {
  if (!name) return null;
  const n = name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(inc|llc|l l c|co|corp|corporation|company|ltd|the|of|dba)\b/g, " ").replace(/\s+/g, " ").trim();
  return n || null;
}
/** Shorter key used to match employer names to movers and clients ("Two Men and a Truck Charlotte" ~ "two men truck"). */
export const matchKey = (name: string | null | undefined) =>
  (normCompany(name) || "").replace(/\b(moving|movers?|and|storage|relocation|services?|transfer|van|lines?|group|systems?)\b/g, " ").replace(/\s+/g, " ").trim();

/** Indeed pay text: "From $21 an hour", "$18 - $22 an hour", "Up to $80,000 a year", "$0.70 - $0.80 per mile". */
export function parsePay(text: string | null | undefined): { min: number | null; max: number | null; period: PayPeriod | null } {
  if (!text) return { min: null, max: null, period: null };
  const t = text.toLowerCase();
  const nums = [...t.matchAll(/\$([\d,]+(?:\.\d+)?)/g)].map((m) => Number(m[1].replace(/,/g, "")));
  if (!nums.length) return { min: null, max: null, period: null };
  const period: PayPeriod | null = /hour/.test(t) ? "hour" : /week/.test(t) ? "week" : /month/.test(t) ? "month" : /year|annual/.test(t) ? "year" : /mile/.test(t) ? "mile" : null;
  if (/^up to/.test(t.trim())) return { min: null, max: nums[0], period };
  return { min: nums[0], max: nums[1] ?? (/^from/.test(t.trim()) ? null : nums[0]), period };
}

/** Pay as an hourly midpoint (2,080 hours a year). Per-mile pay can't be converted, so it stays empty. */
export function hourlyMid(min: number | null, max: number | null, period: PayPeriod | null): number | null {
  const v = min != null && max != null ? (min + max) / 2 : min ?? max;
  if (v == null || !period || period === "mile") return null;
  const h = period === "hour" ? v : period === "week" ? v / 40 : period === "month" ? (v * 12) / 2080 : v / 2080;
  return h >= 8 && h <= 200 ? Math.round(h * 100) / 100 : null;
}

export interface MetroPoint { c: string; lat: number; lon: number }
/** Nearest metro centre within maxKm, else the metro the search was run for. */
export function nearestMetro(lat: number | null | undefined, lon: number | null | undefined, metros: MetroPoint[], fallback: string, maxKm = 80): string {
  if (lat == null || lon == null) return fallback;
  let best = fallback, bd = Infinity;
  for (const m of metros) {
    const dy = (m.lat - lat) * 111, dx = (m.lon - lon) * 111 * Math.cos((lat * Math.PI) / 180);
    const d = Math.hypot(dx, dy);
    if (d < bd) { bd = d; best = m.c; }
  }
  return bd <= maxKm ? best : fallback;
}

/** One Adzuna search result -> Posting (Adzuna salaries are yearly). Returns null when it isn't a moving job. */
export function fromAdzuna(r: any, searchedCbsa: string, metros: MetroPoint[], moverKeys: Set<string>): Posting | null {
  const title = strip(String(r.title || ""));
  const company = r.company?.display_name ? strip(r.company.display_name) : null;
  const known = !!company && moverKeys.has(matchKey(company));
  if (!title || !isRelevant(title, company, known)) return null;
  const predicted = r.salary_is_predicted === "1" || r.salary_is_predicted === 1;
  const min = predicted ? null : (r.salary_min ?? null), max = predicted ? null : (r.salary_max ?? null);
  return {
    id: "adzuna:" + r.id, source: "adzuna", title, company, company_norm: normCompany(company),
    location: r.location?.display_name || null, cbsa: nearestMetro(r.latitude, r.longitude, metros, searchedCbsa),
    role: classifyRole(title), pay_min: min, pay_max: max, pay_period: min != null || max != null ? "year" : null,
    pay_hourly_mid: hourlyMid(min, max, min != null || max != null ? "year" : null),
    job_type: r.contract_time || null, url: r.redirect_url || null, posted_at: r.created ? String(r.created).slice(0, 10) : null,
  };
}

/** Rows from an Indeed sweep file ({ cbsa, id, title, company, location, posted, type, pay, url }) -> Postings. */
export function fromIndeed(rows: any[], moverKeys: Set<string> = new Set()): Posting[] {
  const out: Posting[] = [];
  for (const r of rows) {
    const title = strip(String(r.title || ""));
    const company = r.company ? strip(String(r.company)) : null;
    if (!title || !r.id || !isRelevant(title, company, !!company && moverKeys.has(matchKey(company)))) continue;
    const p = parsePay(r.pay);
    const posted = r.posted ? new Date(r.posted) : null;
    out.push({
      id: "indeed:" + r.id, source: "indeed", title, company, company_norm: normCompany(company), location: r.location || null,
      cbsa: r.cbsa || null, role: classifyRole(title), pay_min: p.min, pay_max: p.max, pay_period: p.period,
      pay_hourly_mid: hourlyMid(p.min, p.max, p.period), job_type: r.type && r.type !== "N/A" ? r.type : null, url: r.url || null,
      posted_at: posted && !isNaN(posted.getTime()) ? posted.toISOString().slice(0, 10) : null,
    });
  }
  return out;
}

export const ADZUNA_QUERIES = ["movers", "moving company", "household goods driver", "moving and storage"];

/** Who to approach for a recruiting agreement, from what the employer looks like. */
export function contactAdvice(company: string | null, postings: number, kind: "client" | "competitor" | "other", fleet?: number | null): { role: string; why: string } {
  const c = (company || "").toLowerCase();
  if (kind === "client") return { role: "Your existing contact", why: "Already a client; bring them these openings as a staffing lead." };
  if (/two men and a truck|college hunks|all my sons|bellhop|junk king|1-800|mr\.? junk/.test(c)) return { role: "Franchise owner or General Manager", why: "Franchise location; hiring decisions are made locally, not at the brand's head office." };
  if (/van lines?|mayflower|united|allied|atlas|north american|bekins|wheaton|arpin|graebel|suddath|sirva/.test(c)) return { role: "Director of Recruiting / Driver Recruiting", why: "Van line or large agent; they have a recruiting function and sign vendor agreements." };
  if ((fleet ?? 0) >= 21 || postings >= 4) return { role: "HR Manager or Operations Manager", why: "Mid-size operation hiring steadily; HR or ops owns staffing." };
  return { role: "Owner or General Manager", why: "Small mover; the owner hires directly and can sign an agreement on the spot." };
}
