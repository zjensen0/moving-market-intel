// Input metrics: the things a mover controls, from their own jobs. Compares the latest three complete months with
// the three before and with the same three months a year earlier.
import type { Job } from "../data/types";
import { addMonths } from "./analytics";

export interface Metric { key: string; label: string; fmt: "pct" | "money" | "num"; now: number | null; prev: number | null; yearAgo: number | null; higherIsBetter: boolean; help: string; n: number }

const inMonths = (j: Job, from: string, to: string) => { const m = j.job_date.slice(0, 7); return m >= from && m <= to; };
const isWon = (j: Job) => j.status === "Completed" || j.status === "Booked";
const isRef = (j: Job) => /referr|repeat|past customer|returning|word of mouth/i.test(j.lead_source || "");

function measure(all: Job[]) {
  const done = all.filter((j) => j.status !== "Lost");
  const withOutcome = all.filter((j) => j.status === "Lost" || isWon(j));
  const rev = done.filter((j) => j.revenue != null);
  const hrs = rev.filter((j) => (j.crew_hours ?? 0) > 0);
  const wt = rev.filter((j) => (j.weight_lbs ?? 0) > 0);
  const typed = done.filter((j) => j.job_type);
  const src = done.filter((j) => j.lead_source);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  return {
    jobs: done.length,
    win: withOutcome.length >= 10 ? withOutcome.filter(isWon).length / withOutcome.length : null,
    avg: rev.length >= 5 ? sum(rev.map((j) => j.revenue as number)) / rev.length : null,
    perHour: hrs.length >= 5 ? sum(hrs.map((j) => j.revenue as number)) / sum(hrs.map((j) => j.crew_hours as number)) : null,
    perThousandLb: wt.length >= 5 ? (sum(wt.map((j) => j.revenue as number)) / sum(wt.map((j) => j.weight_lbs as number))) * 1000 : null,
    referral: src.length >= 10 ? src.filter(isRef).length / src.length : null,
    longShare: typed.length >= 10 ? typed.filter((j) => j.job_type === "Long distance").length / typed.length : null,
    n: done.length,
  };
}

export function inputMetrics(jobs: Job[], windowEnd: string): { months: { now: string[]; prev: string[]; yearAgo: string[] }; metrics: Metric[] } {
  const nowFrom = addMonths(windowEnd, -2), prevFrom = addMonths(windowEnd, -5), prevTo = addMonths(windowEnd, -3);
  const yaFrom = addMonths(windowEnd, -14), yaTo = addMonths(windowEnd, -12);
  const a = measure(jobs.filter((j) => inMonths(j, nowFrom, windowEnd)));
  const b = measure(jobs.filter((j) => inMonths(j, prevFrom, prevTo)));
  const c = measure(jobs.filter((j) => inMonths(j, yaFrom, yaTo)));
  const row = (key: keyof typeof a, label: string, fmt: Metric["fmt"], higherIsBetter: boolean, help: string): Metric =>
    ({ key, label, fmt, now: a[key] as number | null, prev: b[key] as number | null, yearAgo: c[key] as number | null, higherIsBetter, help, n: a.n });
  return {
    months: { now: [nowFrom, windowEnd], prev: [prevFrom, prevTo], yearAgo: [yaFrom, yaTo] },
    metrics: [
      row("win", "Quotes won", "pct", true, "Booked or completed, of quotes with an outcome. Moved by response speed, follow-up and price."),
      row("avg", "Revenue per job", "money", true, "Moved by pricing, upsells (packing, storage) and job mix."),
      row("perHour", "Revenue per crew-hour", "money", true, "Your clearest efficiency number. Moved by crew size, routing and estimate accuracy."),
      row("perThousandLb", "Revenue per 1,000 lb", "money", true, "Long-distance pricing discipline."),
      row("referral", "Jobs from referrals and repeat customers", "pct", true, "The cheapest jobs you get. Moved by service quality and asking for referrals."),
      row("longShare", "Long-distance share of jobs", "pct", true, "Usually your highest-margin work."),
      row("jobs", "Jobs", "num", true, "The result of everything above."),
    ],
  };
}
