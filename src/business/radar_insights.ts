// Hiring radar insights (Acumena admins only): pay benchmark, hard-to-fill signals, hiring pressure by market.
import { matchKey, type Posting, type Role } from "../../server/jobs";
import type { Prediction } from "./hiring_forecast";

export const BENCH_ROLES: Role[] = ["driver", "mover", "sales", "ops"];

export const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), i = Math.floor(s.length / 2);
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
};
const payOf = (ps: Posting[], role: Role) => ps.filter((p) => p.role === role && p.pay_hourly_mid != null && p.pay_hourly_mid < 80).map((p) => p.pay_hourly_mid as number);

export interface PayRow { cbsa: string; byRole: Record<string, { median: number | null; n: number }>; blsHourly: number | null; blsState: boolean }
/** Median posted hourly pay by market and role (per-mile and over-$80/hr outliers left out), with the BLS average
 *  for moving companies (metro, or statewide when BLS withholds the metro) converted to hourly at 40 hours a week. */
export function payBenchmark(postings: Posting[], codes: string[], qByCode: (c: string) => any): { rows: PayRow[]; overall: Record<string, { median: number | null; n: number }> } {
  const overall: Record<string, { median: number | null; n: number }> = {};
  for (const r of BENCH_ROLES) { const v = payOf(postings, r); overall[r] = { median: median(v), n: v.length }; }
  const rows = codes.map((c) => {
    const ps = postings.filter((p) => p.cbsa === c);
    const byRole: PayRow["byRole"] = {};
    for (const r of BENCH_ROLES) { const v = payOf(ps, r); byRole[r] = { median: median(v), n: v.length }; }
    const q = qByCode(c) || {};
    const metroWk = q["484210"]?.[2] as number | undefined, stWk = q.st?.["484210"]?.[2] as number | undefined;
    return { cbsa: c, byRole, blsHourly: metroWk ? metroWk / 40 : stWk ? stWk / 40 : null, blsState: !metroWk && !!stWk };
  }).filter((r) => BENCH_ROLES.some((x) => r.byRole[x].n > 0));
  return { rows, overall };
}

export interface HardRow { company: string; cbsa: string; role: Role; postings: number; daysOpen: number | null; payVsMarket: number | null; score: number; signals: string[] }
/** Employers that look like they're struggling to fill a role: postings up a long time, several postings for the
 *  same role, or pay set well above or below what others in the market post. */
export function hardToFill(postings: Posting[], today = new Date()): HardRow[] {
  const groups = new Map<string, Posting[]>();
  for (const p of postings) {
    if (!p.company || !p.cbsa || p.role === "other") continue;
    const k = `${matchKey(p.company)}|${p.cbsa}|${p.role}`;
    groups.set(k, [...(groups.get(k) || []), p]);
  }
  const out: HardRow[] = [];
  for (const g of groups.values()) {
    const p0 = g[0];
    const ages = g.map((p) => p.posted_at ? Math.floor((today.getTime() - new Date(p.posted_at + "T12:00:00").getTime()) / 864e5) : null).filter((d): d is number => d != null && d >= 0);
    const daysOpen = ages.length ? Math.max(...ages) : null;
    const market = median(payOf(postings.filter((p) => p.cbsa === p0.cbsa && matchKey(p.company) !== matchKey(p0.company)), p0.role));
    const mine = median(payOf(g, p0.role));
    const payVsMarket = market && mine ? mine / market - 1 : null;
    const signals: string[] = []; let score = 0;
    if (daysOpen != null && daysOpen >= 30) { signals.push(daysOpen >= 120 ? `Posted ${Math.round(daysOpen / 30)} months ago and still up` : `Up ${daysOpen} days`); score += Math.min(3, daysOpen / 45); }
    if (g.length >= 2) { signals.push(`${g.length} postings for this role`); score += g.length - 1; }
    if (payVsMarket != null && payVsMarket >= 0.1) { signals.push(`Paying ${Math.round(payVsMarket * 100)}% above others here: likely raised pay to fill it`); score += 1.5; }
    if (payVsMarket != null && payVsMarket <= -0.1) { signals.push(`Paying ${Math.round(-payVsMarket * 100)}% below others here: will struggle to fill it`); score += 1.5; }
    if (signals.length) out.push({ company: p0.company as string, cbsa: p0.cbsa as string, role: p0.role, postings: g.length, daysOpen, payVsMarket, score, signals });
  }
  return out.sort((a, b) => b.score - a.score);
}

export interface PressureRow { cbsa: string; postings: number; employersPosting: number; predicted: number; drivers: number | null; movingJobs: number | null; perHundred: number | null; level: "High" | "Medium" | "Low" | "–" }
/** How hard it is to find people: openings now plus openings expected in the next 90 days, per 100 drivers
 *  that the market's FMCSA-registered movers report. */
export function hiringPressure(codes: string[], postings: Posting[], preds90: Prediction[], detailOf: (c: string) => any): PressureRow[] {
  const rows: PressureRow[] = codes.map((c) => {
    const ps = postings.filter((p) => p.cbsa === c);
    const predicted = preds90.filter((x) => x.cbsa === c && !x.openNow).reduce((a, x) => a + x.expected, 0);
    const d = detailOf(c) || {};
    const drivers = d.fm?.dr ?? null;
    const movingJobs = d.q?.["484210"]?.[1] ?? null;
    const perHundred = drivers ? ((ps.length + predicted) / drivers) * 100 : null;
    return { cbsa: c, postings: ps.length, employersPosting: new Set(ps.map((p) => matchKey(p.company))).size, predicted, drivers, movingJobs, perHundred, level: "–" as const };
  });
  const vals = rows.map((r) => r.perHundred).filter((v): v is number => v != null).sort((a, b) => a - b);
  const t1 = vals[Math.floor(vals.length / 3)] ?? 0, t2 = vals[Math.floor((2 * vals.length) / 3)] ?? 0;
  for (const r of rows) if (r.perHundred != null) r.level = vals.length < 3 ? "Medium" : r.perHundred >= t2 ? "High" : r.perHundred >= t1 ? "Medium" : "Low";
  return rows.sort((a, b) => (b.perHundred ?? -1) - (a.perHundred ?? -1));
}

export interface BenchRow { cbsa: string; role: Role; openNow: number; expected90: number; bench: number; peakMonth: string; recruitBy: Date | null }
/** Anticipatory staffing: how many ready candidates Acumena should have in each market and role, and when to start.
 *  Bench = (open postings + openings expected in 90 days) × the share of openings Acumena aims to fill.
 *  Recruit by = six weeks before the busiest month in the next six months. */
export function benchPlan(codes: string[], postings: Posting[], preds90: Prediction[], seasonOf: (c: string) => number[] | null, share: number, today = new Date()): BenchRow[] {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const out: BenchRow[] = [];
  for (const c of codes) {
    const seas = seasonOf(c) || Array(12).fill(1);
    let best = 1, bestV = -1;
    for (let k = 1; k <= 6; k++) { const v = seas[(today.getMonth() + k) % 12]; if (v > bestV) { bestV = v; best = k; } }
    const peak = new Date(today.getFullYear(), today.getMonth() + best, 1, 12);
    const recruit = new Date(peak.getTime() - 42 * 864e5);
    for (const role of BENCH_ROLES) {
      const openNow = postings.filter((p) => p.cbsa === c && p.role === role).length;
      const expected90 = preds90.filter((x) => x.cbsa === c && x.role === role && !x.openNow).reduce((a, x) => a + x.expected, 0);
      const total = openNow + expected90;
      if (total < 0.5) continue;
      out.push({ cbsa: c, role, openNow, expected90, bench: Math.max(1, Math.ceil(total * share)), peakMonth: months[peak.getMonth()], recruitBy: recruit <= today ? null : recruit });
    }
  }
  return out.sort((a, b) => b.bench - a.bench || (b.openNow + b.expected90) - (a.openNow + a.expected90));
}
