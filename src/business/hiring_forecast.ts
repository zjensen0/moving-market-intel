// "Likely to hire soon" (Hiring radar, Acumena admins only).
// First version: a transparent estimate built from things we already know about each employer and market.
// Expected openings = staff in the role × yearly turnover × the share of the year's moves in the window
// (shifted a month ahead, because movers hire before the busy months) × the market's demand forecast.
// Chance of at least one opening = 1 − e^(−expected openings).
// Once the radar has a few months of daily postings, the turnover rates below get replaced by rates
// measured from how often each employer actually posts, and the result is back-tested.
import { matchKey, type Posting, type Role } from "../../server/jobs";

export type PredRole = "driver" | "mover" | "sales" | "ops";
export const PRED_ROLES: PredRole[] = ["driver", "mover", "sales", "ops"];

/** Staff per truck and yearly turnover, by role. Industry rules of thumb, not yet fitted to our data. */
export const ROLE_ASSUMPTIONS: Record<PredRole, { perTruck: number; min: number; turnover: number; label: string }> = {
  mover: { perTruck: 1.5, min: 2, turnover: 1.0, label: "movers and helpers" },
  driver: { perTruck: 1.0, min: 1, turnover: 0.6, label: "drivers" },
  sales: { perTruck: 0.1, min: 1, turnover: 0.35, label: "estimators and sales" },
  ops: { perTruck: 0.125, min: 1, turnover: 0.25, label: "crew leads, dispatch and managers" },
};

/** Average share of a year's moves by month (Jan..Dec), used when a metro has no seasonality of its own. */
export const NATIONAL_SEASON = [0.065, 0.065, 0.08, 0.085, 0.095, 0.105, 0.1, 0.1, 0.085, 0.08, 0.07, 0.07];

export interface EmployerIn {
  company: string;
  cbsa: string;
  trucks: number | null;      // FMCSA power units
  drivers: number | null;     // FMCSA drivers
  source: "fmcsa" | "posting" | "both";
}
export interface MarketIn { season?: number[] | null; growth?: number | null } // growth = forecast change in home sales, next 3 months vs a year earlier

export interface Prediction {
  company: string; cbsa: string; role: PredRole; trucks: number | null;
  chance: number;            // 0..1, at least one opening in the window
  expected: number;          // expected openings in the window
  openNow: boolean;          // already posting this role
  band: "High" | "Medium" | "Low";
  reasons: string[];
}

const pct = (v: number) => Math.round(v * 100) + "%";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Share of the year's moves in the hiring window: months start+1 .. start+n (hiring runs about a month ahead). */
export function windowShare(season: number[], startMonth: number, months: number): { share: number; label: string } {
  const s = season.length === 12 ? season : NATIONAL_SEASON;
  const total = s.reduce((a, b) => a + b, 0) || 1;
  let share = 0;
  const names: string[] = [];
  for (let i = 1; i <= months; i++) { const m = (startMonth + i) % 12; share += s[m] / total; names.push(MONTHS[m]); }
  return { share, label: names.length > 1 ? `${names[0]}–${names[names.length - 1]}` : names[0] };
}

export function predictOpenings(
  employers: EmployerIn[], markets: Map<string, MarketIn>, postings: Posting[],
  opts: { today?: Date; months?: 1 | 2 | 3 } = {},
): Prediction[] {
  const today = opts.today ?? new Date();
  const months = opts.months ?? 3;
  // what's posted right now, by employer and role (ops and office both count as "ops" here)
  const toPred = (r: Role): PredRole | null => (r === "driver" || r === "mover" || r === "sales" ? r : r === "ops" ? "ops" : null);
  const open = new Map<string, Set<PredRole>>();
  const postingEmployersByRole = new Map<string, number>(); // `${cbsa}|${role}` -> employers posting
  for (const p of postings) {
    const r = toPred(p.role); if (!r || !p.cbsa) continue;
    const k = matchKey(p.company) + "|" + p.cbsa;
    if (!open.has(k)) open.set(k, new Set());
    if (!open.get(k)!.has(r)) { open.get(k)!.add(r); postingEmployersByRole.set(p.cbsa + "|" + r, (postingEmployersByRole.get(p.cbsa + "|" + r) || 0) + 1); }
  }
  const out: Prediction[] = [];
  for (const e of employers) {
    const mk = markets.get(e.cbsa) || {};
    const { share, label } = windowShare(mk.season || NATIONAL_SEASON, today.getMonth(), months);
    const growth = Math.max(-0.3, Math.min(0.3, mk.growth ?? 0));
    const trucks = e.trucks && e.trucks > 0 ? e.trucks : null;
    const openRoles = open.get(matchKey(e.company) + "|" + e.cbsa) || new Set<PredRole>();
    for (const role of PRED_ROLES) {
      const a = ROLE_ASSUMPTIONS[role];
      const staff = role === "driver" && e.drivers ? Math.max(e.drivers, a.min) : Math.max((trucks ?? 2) * a.perTruck, a.min);
      const peers = postingEmployersByRole.get(e.cbsa + "|" + role) || 0;
      const surge = peers >= 3 ? 1.15 : 1;
      const expected = staff * a.turnover * share * (1 + growth) * surge;
      const chance = 1 - Math.exp(-expected);
      const openNow = openRoles.has(role);
      const reasons: string[] = [];
      reasons.push(trucks ? `${trucks} truck${trucks > 1 ? "s" : ""}${e.drivers ? `, ${e.drivers} drivers` : ""} on file with FMCSA → about ${Math.round(staff)} ${a.label}` : `Fleet size unknown; assumed a small crew`);
      reasons.push(`${label} carry ${pct(share)} of the year's moves in this market`);
      if (Math.abs(growth) >= 0.02) reasons.push(`Home sales forecast ${growth > 0 ? "up" : "down"} ${pct(Math.abs(growth))} vs a year ago`);
      if (surge > 1) reasons.push(`${peers} other employers here are hiring ${a.label} now`);
      if (openNow) reasons.unshift("Posting this role now");
      out.push({ company: e.company, cbsa: e.cbsa, role, trucks, chance, expected, openNow, band: chance >= 0.6 ? "High" : chance >= 0.3 ? "Medium" : "Low", reasons });
    }
  }
  return out.sort((a, b) => b.chance - a.chance);
}

/** Employers to score in one market: FMCSA movers based there plus anyone posting there; merged by name. */
export function employersFor(cbsa: string, top: unknown[][] | undefined, postings: Posting[], trucksByKey: Map<string, number | null>): EmployerIn[] {
  const m = new Map<string, EmployerIn>();
  for (const t of top || []) {
    const name = t[0] as string; const k = matchKey(name); if (!k) continue;
    m.set(k, { company: name, cbsa, trucks: Number(t[3]) || null, drivers: Number(t[4]) || null, source: "fmcsa" });
  }
  for (const p of postings) {
    if (p.cbsa !== cbsa || !p.company) continue;
    const k = matchKey(p.company); if (!k) continue;
    const have = m.get(k);
    if (have) { have.source = "both"; have.company = p.company; continue; }
    m.set(k, { company: p.company, cbsa, trucks: trucksByKey.get(k) ?? null, drivers: null, source: "posting" });
  }
  return [...m.values()];
}
