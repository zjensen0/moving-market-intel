// Compare a client's own jobs with the public market data for their home metro.
import type { Job, MetroDetail, MetroIndexRow, NationalData } from "../data/types";

export interface LaneRow { code: string; name: string; dir: "out" | "in"; households: number; miles: number; yourJobs: number; share: number }
export interface BusinessSummary {
  /** Latest 12 complete months covered by the jobs (YYYY-MM). */
  windowStart: string;
  windowEnd: string;
  firstMonth: string;
  lastMonth: string;
  /** Jobs dated after the window: future bookings or the current, unfinished month. */
  upcoming: number;
  jobs12: number;
  jobsPrior12: number | null;
  revenue12: number | null;
  avgRevenue12: number | null;
  longShare12: number | null;
  longRevShare12: number | null;
  winRate: number | null;
  homeJobs12: number;
  marketShare: number | null;
  monthly: { months: string[]; jobs: (number | null)[]; jobsIdx: (number | null)[]; marketIdx: (number | null)[]; marketLabel: string } | null;
  recent: { from: string; to: string; yourChange: number | null; marketChange: number | null } | null;
  price: {
    months: string[]; yourIdx: (number | null)[]; ppiIdx: (number | null)[]; yourAvg: (number | null)[]; ppi: (number | null)[];
    yourChange: number | null; ppiChange: number | null;
  } | null;
  season: number[] | null;
  /** Next three months of jobs: last year's same months, moved by your recent trend and the market forecast. */
  outlook: {
    months: string[]; ly: number[]; f: number[]; lo: number[]; hi: number[]; g: number;
    yourTrend: number; marketTrend: number | null; check: number | null; checkN: number;
  } | null;
  lanes: LaneRow[];
  otherLanes: { code: string; name: string; dir: "out" | "in"; yourJobs: number }[];
  untapped: LaneRow | null;
  /** Every lane that qualifies as untapped ("out|code" / "in|code"); untapped is the biggest. */
  untappedKeys: string[];
  byType: { label: string; jobs: number; revenue: number }[];
  bySource: { label: string; jobs: number; revenue: number; avg: number | null; winRate: number | null }[];
}

export const monthOf = (d: string) => d.slice(0, 7);
export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}
export function monthRange(end: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addMonths(end, i - count + 1));
}
const counted = (j: Job) => j.status !== "Lost";
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const thisMonth = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

export function summarize(jobs: Job[], home: MetroDetail, N: NationalData, byCode: Map<string, MetroIndexRow>,
                          today: Date = new Date()): BusinessSummary | null {
  if (!jobs.length) return null;
  const firstMonth = monthOf(jobs.reduce((mn, j) => (j.job_date < mn ? j.job_date : mn), jobs[0].job_date));
  const lastMonth = monthOf(jobs.reduce((mx, j) => (j.job_date > mx ? j.job_date : mx), jobs[0].job_date));
  // Stop at the last complete month, so future bookings and a half-finished month don't look like a drop.
  const lastComplete = addMonths(thisMonth(today), -1);
  const end = lastMonth < lastComplete ? lastMonth : lastComplete;
  const months12 = new Set(monthRange(end, 12));
  const inWin = jobs.filter((j) => months12.has(monthOf(j.job_date)));
  const upcoming = jobs.filter((j) => monthOf(j.job_date) > end).length;
  const c12 = inWin.filter(counted);
  const withRev = c12.filter((j) => j.revenue != null && j.revenue > 0);
  const revenue12 = withRev.length ? withRev.reduce((s, j) => s + (j.revenue as number), 0) : null;
  const typed = c12.filter((j) => j.job_type);
  const typedRev = withRev.filter((j) => j.job_type);
  const typedRevTotal = typedRev.reduce((s, j) => s + (j.revenue as number), 0);
  const hasStatus = inWin.some((j) => j.status === "Lost" || j.status === "Booked");
  const decided = inWin.filter((j) => j.status === "Completed" || j.status === "Booked" || j.status === "Lost");
  const homeJobs12 = c12.filter((j) => j.origin_cbsa === home.c || j.destination_cbsa === home.c).length;

  const jobsByMonth = new Map<string, number>();
  for (const j of jobs) if (counted(j)) jobsByMonth.set(monthOf(j.job_date), (jobsByMonth.get(monthOf(j.job_date)) || 0) + 1);
  const sumJobs = (from: string, n: number) => monthRange(from, n).reduce((s, m) => s + (jobsByMonth.get(m) || 0), 0);
  const jobsPrior12 = firstMonth <= addMonths(end, -23) ? sumJobs(addMonths(end, -12), 12) : null;

  // ---- monthly volume vs the housing market (both indexed to their own average = 100)
  const months24 = monthRange(end, 24);
  const zi = new Map(N.zm.map((m, i) => [m, i]));
  const mk = home.z ? (home.z.s ?? home.z.nl) : null;
  const mkAt = (m: string) => (mk && zi.has(m) ? (mk[zi.get(m) as number] ?? null) : null);
  let monthly: BusinessSummary["monthly"] = null;
  if (mk) {
    const jobsArr = months24.map((m) => (m < firstMonth ? NaN : jobsByMonth.get(m) || 0));
    const mkArr = months24.map(mkAt);
    const both = months24.map((_, i) => i).filter((i) => mkArr[i] != null && !Number.isNaN(jobsArr[i]));
    const jAvg = mean(both.map((i) => jobsArr[i])), mAvg = mean(both.map((i) => mkArr[i] as number));
    if (both.length >= 6 && jAvg > 0 && mAvg > 0) {
      monthly = {
        months: months24, jobs: jobsArr.map((v) => (Number.isNaN(v) ? null : v)),
        jobsIdx: jobsArr.map((v) => (Number.isNaN(v) ? null : (v / jAvg) * 100)),
        marketIdx: mkArr.map((v) => (v == null ? null : (v / mAvg) * 100)),
        marketLabel: home.z?.s ? "Home sales in your metro" : "New listings in your metro",
      };
    }
  }

  // ---- latest three months against the same months a year earlier, you and the market
  let recent: BusinessSummary["recent"] = null;
  const to = mk && N.last_month < end ? N.last_month : end;
  if (firstMonth <= addMonths(to, -14)) {
    const yNow = sumJobs(addMonths(to, -2), 3), yPrev = sumJobs(addMonths(to, -14), 3);
    const mNow = monthRange(to, 3).map(mkAt), mPrev = monthRange(addMonths(to, -12), 3).map(mkAt);
    const mOk = mNow.every((v) => v != null) && mPrev.every((v) => v != null);
    const sum = (xs: (number | null)[]) => xs.reduce((s: number, v) => s + (v as number), 0);
    recent = {
      from: addMonths(to, -2), to,
      yourChange: yPrev > 0 ? yNow / yPrev - 1 : null,
      marketChange: mOk && sum(mPrev) > 0 ? sum(mNow) / sum(mPrev) - 1 : null,
    };
  }

  // ---- your prices vs the industry price index
  // Revenue per job, three-month rolling average, adjusted for job mix: each job type's own average,
  // combined with fixed weights (its share of priced jobs over the chart). A shift between local and
  // long-distance work then doesn't show up as a price change. Types too thin to price every month are left out.
  let price: BusinessSummary["price"] = null;
  const ppiMap = new Map<string, number>((N.prices.ppi.m as string[]).map((m, i) => [m, N.prices.ppi.v[i] as number]));
  const typeOf = (j: Job) => j.job_type || "Not given";
  const revBy = new Map<string, { s: number; n: number }>(); // "YYYY-MM|type"
  const typeN = new Map<string, number>();
  for (const j of jobs) if (counted(j) && j.revenue != null && j.revenue > 0 && monthOf(j.job_date) <= end) {
    const key = monthOf(j.job_date) + "|" + typeOf(j), r = revBy.get(key) || { s: 0, n: 0 };
    r.s += j.revenue; r.n++; revBy.set(key, r);
    typeN.set(typeOf(j), (typeN.get(typeOf(j)) || 0) + 1);
  }
  const windowAvg = (m: string, t: string) => {
    let s = 0, n = 0;
    for (let k = 0; k < 3; k++) { const r = revBy.get(addMonths(m, -k) + "|" + t); if (r) { s += r.s; n += r.n; } }
    return n >= 3 ? s / n : null;
  };
  const pm0 = months24.filter((m) => ppiMap.has(m) && addMonths(m, -2) >= firstMonth);
  const stable = [...typeN.keys()].filter((t) => pm0.every((m) => windowAvg(m, t) != null));
  const wTot = stable.reduce((a, t) => a + (typeN.get(t) as number), 0);
  const rolling = (m: string) => (stable.length
    ? stable.reduce((a, t) => a + (typeN.get(t) as number) * (windowAvg(m, t) as number), 0) / wTot : null);
  const pm = stable.length ? pm0 : [];
  if (pm.length >= 6) {
    const base = pm[0];
    const yb = rolling(base) as number, pb = ppiMap.get(base) as number;
    const yourIdx = months24.map((m) => (pm.includes(m) ? ((rolling(m) as number) / yb) * 100 : null));
    const ppiIdx = months24.map((m) => (ppiMap.has(m) && m >= base ? ((ppiMap.get(m) as number) / pb) * 100 : null));
    const last = pm[pm.length - 1], prior = addMonths(last, -12);
    const yourChange = pm.includes(prior) ? (rolling(last) as number) / (rolling(prior) as number) - 1 : null;
    const ppiChange = ppiMap.has(prior) ? (ppiMap.get(last) as number) / (ppiMap.get(prior) as number) - 1 : null;
    price = {
      months: months24, yourIdx, ppiIdx, yourChange, ppiChange,
      yourAvg: months24.map((m) => (pm.includes(m) ? (rolling(m) as number) : null)),
      ppi: months24.map((m) => (ppiMap.has(m) && m >= base ? (ppiMap.get(m) as number) : null)),
    };
  }

  // ---- your busiest months (latest 12 complete months, so each calendar month counts once)
  let season: number[] | null = null;
  if (firstMonth <= addMonths(end, -11) && c12.length >= 50) {
    const by = Array(12).fill(0);
    for (const j of c12) by[Number(j.job_date.slice(5, 7)) - 1]++;
    season = by.map((v) => v / c12.length);
  }

  // ---- your next three months
  // Same months last year, moved by half your own recent trend (last 3 months vs a year earlier) and half the
  // market forecast for your home metro. The range adds the market forecast's range to normal month-to-month
  // swings for a business your size. Checked against your own recent months, using your trend alone.
  let outlook: BusinessSummary["outlook"] = null;
  const jm = (m: string) => jobsByMonth.get(m) || 0;
  const trendAt = (o: string) => {
    const now = sumJobs(addMonths(o, -2), 3), prev = sumJobs(addMonths(o, -14), 3);
    return now > 0 && prev > 0 ? Math.log(now / prev) : null;
  };
  const yourTrend = firstMonth <= addMonths(end, -14) ? trendAt(end) : null;
  if (yourTrend != null) {
    const fc = home.fc;
    const marketTrend = fc && fc.g != null ? Math.log(1 + fc.g) : null;
    const g = marketTrend == null ? yourTrend : 0.5 * yourTrend + 0.5 * marketTrend;
    const wl = fc && fc.glo != null && fc.g != null ? Math.log(1 + fc.g) - Math.log(1 + fc.glo) : 0.08;
    const wh = fc && fc.ghi != null && fc.g != null ? Math.log(1 + fc.ghi) - Math.log(1 + fc.g) : 0.1;
    const months3 = [1, 2, 3].map((k) => addMonths(end, k));
    const ly = months3.map((m) => jm(addMonths(m, -12)));
    const f = ly.map((v) => v * Math.exp(g));
    const noise = (v: number) => (v > 0 ? 1.28 / Math.sqrt(v) : 0.5);
    const lo = f.map((v) => v * Math.exp(-Math.sqrt(wl * wl + noise(v) ** 2)));
    const hi = f.map((v) => v * Math.exp(Math.sqrt(wh * wh + noise(v) ** 2)));
    // check: forecasts made 3 to 6 months ago with your trend alone, against what you actually booked
    const errs: number[] = [];
    for (let back = 3; back <= 6; back++) {
      const o = addMonths(end, -back);
      if (firstMonth > addMonths(o, -14)) continue;
      const t = trendAt(o);
      if (t == null) continue;
      const pred = [1, 2, 3].reduce((a, k) => a + jm(addMonths(o, k - 12)) * Math.exp(t), 0);
      const act = [1, 2, 3].reduce((a, k) => a + jm(addMonths(o, k)), 0);
      if (act > 0) errs.push(Math.abs(pred / act - 1));
    }
    outlook = {
      months: months3, ly, f: f.map(Math.round), lo: lo.map(Math.round), hi: hi.map(Math.round), g: Math.expm1(g),
      yourTrend: Math.expm1(yourTrend), marketTrend: marketTrend == null ? null : Math.expm1(marketTrend),
      check: errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : null, checkN: errs.length,
    };
  }

  // ---- long-distance lanes: the market's biggest vs the jobs you booked on them
  const laneJobs = new Map<string, number>(); // "out|code" or "in|code"
  for (const j of c12) {
    if (j.origin_cbsa === home.c && j.destination_cbsa && j.destination_cbsa !== home.c) laneJobs.set("out|" + j.destination_cbsa, (laneJobs.get("out|" + j.destination_cbsa) || 0) + 1);
    else if (j.destination_cbsa === home.c && j.origin_cbsa && j.origin_cbsa !== home.c) laneJobs.set("in|" + j.origin_cbsa, (laneJobs.get("in|" + j.origin_cbsa) || 0) + 1);
  }
  const lanes: LaneRow[] = [];
  for (const dir of ["out", "in"] as const) {
    for (const l of (home.ln[dir] || []).filter((x: number[]) => x[3] >= 100).slice(0, 10)) {
      const o = byCode.get(l[0]);
      if (!o) continue;
      const yours = laneJobs.get(dir + "|" + l[0]) || 0;
      lanes.push({ code: l[0], name: o.n, dir, households: l[1], miles: l[3], yourJobs: yours, share: yours / l[1] });
    }
  }
  lanes.sort((a, b) => b.households - a.households);
  const known = new Set(lanes.map((l) => l.dir + "|" + l.code));
  const otherLanes = [...laneJobs.entries()].filter(([k]) => !known.has(k)).map(([k, n]) => {
    const [dir, code] = k.split("|") as ["out" | "in", string];
    return { code, name: byCode.get(code)?.n || code, dir, yourJobs: n };
  }).sort((a, b) => b.yourJobs - a.yourJobs).slice(0, 6);
  const served = lanes.filter((l) => l.yourJobs > 0).map((l) => l.share).sort((a, b) => a - b);
  const medShare = served.length ? served[Math.floor(served.length / 2)] : 0;
  const untappedAll = lanes.filter((l) => l.households >= 300 && l.share <= medShare * 0.25)
    .sort((a, b) => b.households - a.households);
  const untapped = untappedAll[0] || null;

  const group = (key: (j: Job) => string | null) => {
    const g = new Map<string, { jobs: number; revenue: number }>();
    for (const j of c12) {
      const k = key(j) || "Not given";
      const x = g.get(k) || { jobs: 0, revenue: 0 };
      x.jobs++; x.revenue += j.revenue || 0; g.set(k, x);
    }
    return [...g.entries()].map(([label, v]) => ({ label, ...v })).sort((a, b) => b.jobs - a.jobs);
  };

  // lead sources: jobs and revenue (lost jobs left out), average job, and win rate where statuses exist
  const sources = () => {
    const g = new Map<string, { jobs: number; revenue: number; priced: number; lost: number; decided: number }>();
    for (const j of inWin) {
      const k = j.lead_source || "Not given";
      const x = g.get(k) || { jobs: 0, revenue: 0, priced: 0, lost: 0, decided: 0 };
      if (j.status === "Completed" || j.status === "Booked" || j.status === "Lost") x.decided++;
      if (j.status === "Lost") x.lost++;
      else {
        x.jobs++;
        if (j.revenue != null && j.revenue > 0) { x.revenue += j.revenue; x.priced++; }
      }
      g.set(k, x);
    }
    return [...g.entries()].filter(([, v]) => v.jobs > 0).map(([label, v]) => ({
      label, jobs: v.jobs, revenue: v.revenue, avg: v.priced >= 3 ? v.revenue / v.priced : null,
      winRate: hasStatus && v.decided >= 5 ? (v.decided - v.lost) / v.decided : null,
    })).sort((a, b) => b.jobs - a.jobs);
  };

  return {
    windowStart: addMonths(end, -11), windowEnd: end, firstMonth, lastMonth, upcoming,
    jobs12: c12.length, jobsPrior12,
    revenue12, avgRevenue12: revenue12 != null ? revenue12 / withRev.length : null,
    longShare12: typed.length ? typed.filter((j) => j.job_type === "Long distance").length / typed.length : null,
    longRevShare12: typedRevTotal > 0 ? typedRev.filter((j) => j.job_type === "Long distance").reduce((s, j) => s + (j.revenue as number), 0) / typedRevTotal : null,
    winRate: hasStatus && decided.length ? decided.filter((j) => j.status !== "Lost").length / decided.length : null,
    homeJobs12, marketShare: home.hhm ? homeJobs12 / home.hhm : null,
    monthly, recent, price, season, outlook, lanes, otherLanes, untapped,
    untappedKeys: untappedAll.map((l) => l.dir + "|" + l.code),
    byType: group((j) => j.job_type), bySource: sources(),
  };
}
