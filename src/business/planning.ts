// Client planning tools on "Your business": crew planning, price check and lane opportunities.
import type { BusinessSummary, LaneRow } from "./analytics";

export interface CrewInputs { crews: number; jobsPerCrewDay: number; workDays: number }
export const DEFAULT_CREW: CrewInputs = { crews: 4, jobsPerCrewDay: 1.2, workDays: 22 };

export interface CrewMonth { month: string; jobs: number; jobsHigh: number; crews: number; crewsHigh: number; gap: number; gapHigh: number; kind: "forecast" | "peak" }
/** Crews needed each month = forecast jobs ÷ (jobs a crew handles a day × working days). Uses the booking forecast for
 *  the next three months, plus the busiest month of the year estimated from the last 12 months and the season. */
export function crewPlan(s: BusinessSummary, season: number[] | null, inp: CrewInputs): CrewMonth[] {
  const perCrew = Math.max(0.1, inp.jobsPerCrewDay) * Math.max(1, inp.workDays);
  const row = (month: string, jobs: number, jobsHigh: number, kind: CrewMonth["kind"]): CrewMonth => {
    const crews = Math.ceil(jobs / perCrew), crewsHigh = Math.ceil(jobsHigh / perCrew);
    return { month, jobs, jobsHigh, crews, crewsHigh, gap: crews - inp.crews, gapHigh: crewsHigh - inp.crews, kind };
  };
  const out: CrewMonth[] = [];
  if (s.outlook) s.outlook.months.forEach((m, i) => out.push(row(m, s.outlook!.f[i], s.outlook!.hi[i], "forecast")));
  const seas = s.season || season;
  if (seas && s.jobs12) {
    const tot = seas.reduce((a, b) => a + b, 0) || 1;
    let peak = 0; seas.forEach((v, i) => { if (v > seas[peak]) peak = i; });
    const growth = s.outlook ? s.outlook.g : 0;
    const jobs = Math.round((s.jobs12 * seas[peak]) / tot * (1 + growth));
    // next occurrence of the peak month after the window
    const [y, m] = s.windowEnd.split("-").map(Number);
    const yr = peak + 1 > m ? y : y + 1;
    out.push(row(`${yr}-${String(peak + 1).padStart(2, "0")}`, jobs, Math.round(jobs * 1.15), "peak"));
  }
  return out;
}

export interface PriceCheck { verdict: "behind" | "pace" | "ahead" | null; lines: string[] }
/** Your price change over the past year against the industry price index, plus what crews are paid in your market. */
export function priceCheck(s: BusinessSummary, crewPay: { mover: number | null; driver: number | null; n: number } | null, blsHourly: number | null): PriceCheck {
  const lines: string[] = [];
  let verdict: PriceCheck["verdict"] = null;
  const y = s.price?.yourChange, p = s.price?.ppiChange;
  const pct = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)}%`;
  if (y != null && p != null) {
    const d = y - p;
    verdict = d < -0.02 ? "behind" : d > 0.02 ? "ahead" : "pace";
    lines.push(`Past year your average job price moved ${pct(y)}; U.S. moving prices moved ${pct(p)}.`);
    lines.push(verdict === "behind" ? "You're raising prices more slowly than the industry. With labor costs rising, that squeezes your margin: review your rates before the busy season."
      : verdict === "ahead" ? "You're raising prices faster than the industry. Watch your win rate: if it's falling, you may be pricing yourself out of jobs."
      : "You're keeping pace with industry pricing.");
  } else lines.push("Add a revenue column and 15+ months of jobs to compare your prices with the industry.");
  if (crewPay && (crewPay.mover || crewPay.driver)) {
    lines.push(`Movers here are advertising ${crewPay.mover ? `$${crewPay.mover.toFixed(2)}/hr for crew` : ""}${crewPay.mover && crewPay.driver ? " and " : ""}${crewPay.driver ? `$${crewPay.driver.toFixed(2)}/hr for drivers` : ""} (median of ${crewPay.n} current postings).`);
    if (s.avgRevenue12 && crewPay.mover) lines.push(`Your average job (${"$" + Math.round(s.avgRevenue12).toLocaleString("en-US")}) pays for about ${Math.round(s.avgRevenue12 / crewPay.mover)} crew-hours at that rate.`);
  }
  if (blsHourly) lines.push(`BLS: moving companies in your area paid an average of $${blsHourly.toFixed(2)} an hour in 2025 (all jobs, office included).`);
  return { verdict, lines };
}

export interface LaneOpp { lane: LaneRow; extraJobs: number; extraRevenue: number | null; target: number }
/** Long-distance lanes ranked by the jobs you'd add if you reached your usual share on each. */
export function laneOpportunities(s: BusinessSummary, avgLongJob: number | null): LaneOpp[] {
  const shares = s.lanes.map((l) => l.share).filter((v) => v > 0).sort((a, b) => a - b);
  const target = shares.length ? shares[Math.floor(shares.length / 2)] : 0;
  if (!target) return [];
  return s.lanes.map((l) => {
    const extraJobs = Math.max(0, Math.round(l.households * (target - l.share)));
    return { lane: l, extraJobs, extraRevenue: avgLongJob ? extraJobs * avgLongJob : null, target };
  }).filter((o) => o.extraJobs > 0).sort((a, b) => b.extraJobs - a.extraJobs).slice(0, 5);
}
