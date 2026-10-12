// Made-up jobs for the demo company, so the "Your business" page has something to show.
// Deterministic (seeded), shaped by the real market: monthly volume follows the metro's seasonality,
// long-distance moves follow its real lanes, and prices drift up more slowly than the industry index.
import type { Job, MetroDetail, NationalData } from "../data/types";
import { addMonths, monthRange } from "./analytics";

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Lane = [string, number, number | null, number, number]; // [other metro, households, reverse, miles, avg income]

export function sampleJobs(home: MetroDetail, N: NationalData, zipToCbsa: Record<string, string>, skipLaneCode?: string): Job[] {
  const r = rng(20261012);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const weighted = <T,>(items: T[], w: (x: T) => number) => {
    const tot = items.reduce((s, x) => s + w(x), 0);
    let u = r() * tot;
    for (const x of items) { u -= w(x); if (u <= 0) return x; }
    return items[items.length - 1];
  };
  const lognorm = (median: number, spread: number) => median * Math.exp(spread * Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r()));

  const zipsBy = new Map<string, string[]>();
  for (const [z, c] of Object.entries(zipToCbsa)) { const a = zipsBy.get(c) || []; a.push(z); zipsBy.set(c, a); }
  const homeZips = zipsBy.get(home.c) || ["00000"];
  const outLanes = ((home.ln.out || []) as Lane[]).filter((l) => l[3] >= 100 && l[0] !== skipLaneCode && zipsBy.has(l[0]));
  const inLanes = ((home.ln.in || []) as Lane[]).filter((l) => l[3] >= 100 && l[0] !== skipLaneCode && zipsBy.has(l[0]));
  const seas: number[] = home.k?.seas || Array(12).fill(1 / 12);
  const end = N.last_month; // align the sample with the newest housing data
  const months = monthRange(end, 24);
  const types = [["Local", 0.64], ["Long distance", 0.2], ["Commercial", 0.08], ["Storage", 0.05], ["Labor only", 0.03]] as const;
  const sources = [["Google", 34], ["Referral", 22], ["Realtor partner", 14], ["Repeat customer", 12], ["Van line", 10], ["Yelp", 8]] as const;
  const jobs: Job[] = [];
  months.forEach((ym, t) => {
    const mIdx = Number(ym.slice(5, 7)) - 1;
    const volume = Math.round(62 * seas[mIdx] * 12 * (1 + 0.006 * t) * (0.92 + r() * 0.16));
    const priceDrift = 1 + 0.0035 * t; // about +4% a year, slower than the industry price index
    const days = new Date(Date.UTC(+ym.slice(0, 4), mIdx + 1, 0)).getUTCDate();
    for (let k = 0; k < volume; k++) {
      const type = weighted([...types], (x) => x[1])[0];
      let oz = pick(homeZips), dz = pick(homeZips), miles = 12;
      if (type === "Long distance") {
        if (r() < 0.62 && outLanes.length) {
          const l = weighted(outLanes, (x) => x[1]);
          dz = pick(zipsBy.get(l[0]) as string[]); miles = l[3];
        } else if (inLanes.length) {
          const l = weighted(inLanes, (x) => x[1]);
          oz = pick(zipsBy.get(l[0]) as string[]); miles = l[3];
        }
      }
      const base = { Local: 1650, "Long distance": 3200 + miles * 3.1, Commercial: 4300, Storage: 480, "Labor only": 690 }[type];
      const revenue = Math.round(lognorm(base, 0.25) * priceDrift);
      const weight = type === "Local" || type === "Long distance" ? Math.round(lognorm(type === "Local" ? 5800 : 8400, 0.35) / 10) * 10 : null;
      const late = t >= months.length - 1;
      const u = r();
      const status = u < 0.1 ? "Lost" : late && u < 0.3 ? "Booked" : "Completed";
      jobs.push({
        job_date: `${ym}-${String(1 + Math.floor(r() * days)).padStart(2, "0")}`,
        origin_zip: oz, destination_zip: dz, origin_cbsa: zipToCbsa[oz] ?? null, destination_cbsa: zipToCbsa[dz] ?? null,
        job_type: type, status, revenue, weight_lbs: weight,
        crew_hours: type === "Storage" ? null : Math.round(lognorm(type === "Long distance" ? 16 : 7, 0.3) * 2) / 2,
        lead_source: weighted([...sources], (x) => x[1])[0],
      });
    }
  });
  jobs.sort((a, b) => a.job_date.localeCompare(b.job_date));
  return jobs.map((j, i) => ({ ...j, id: i + 1 }));
}

export const SAMPLE_WINDOW_NOTE = (N: NationalData) =>
  `Sample data: about 1,700 made-up jobs from ${addMonths(N.last_month, -23)} to ${N.last_month}.`;
