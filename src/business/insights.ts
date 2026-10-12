// Plain-language read of a client's jobs against their market. Facts and arithmetic only;
// each line says where the comparison comes from.
import type { MetroDetail, NationalData } from "../data/types";
import { fmtCompact, fmtInt, fmtMoneyC, fmtPct, monthLabel, MONTHS_LONG } from "../lib/format";
import { city } from "../market/geo";
import type { BusinessSummary } from "./analytics";

export interface Insight { lead: string; text: string }

const upDown = (v: number) => (v >= 0 ? "up " : "down ") + fmtPct(Math.abs(v), 1);
const span = (from: string, to: string) => monthLabel(from).split(" ")[0] + " to " + monthLabel(to);
const topMonths = (shares: number[], n = 3) =>
  shares.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0]).slice(0, n).map((x) => x[1]).sort((a, b) => a - b);
const listMonths = (idx: number[]) => {
  const names = idx.map((i) => MONTHS_LONG[i]);
  return names.length > 1 ? names.slice(0, -1).join(", ") + " and " + names[names.length - 1] : names[0];
};

export function businessInsights(s: BusinessSummary, home: MetroDetail, N: NationalData): Insight[] {
  const out: Insight[] = [];
  const add = (lead: string, text: string) => out.push({ lead, text });
  const here = city(home.n);

  if (s.marketShare != null && home.hhm) {
    const point = home.hhm * 0.01;
    add(`You handled about ${fmtPct(s.marketShare, 1)} of ${here}'s household moves`,
      `${fmtInt(s.homeJobs12)} of your jobs in the last 12 months started or ended in the ${home.n} area, which sees about ${fmtCompact(home.hhm)} household moves a year. ` +
      `Each extra point of share is about ${fmtInt(point)} jobs a year` + (s.avgRevenue12 ? `, or ${fmtMoneyC(point * s.avgRevenue12)} at your average job price.` : "."));
  }

  const r = s.recent;
  if (r && r.yourChange != null) {
    const when = "From " + span(r.from, r.to);
    if (r.marketChange != null) {
      const gap = r.yourChange - r.marketChange;
      const what = home.z?.s ? "home sales" : "new listings";
      const lead = gap > 0.03 ? "You're outpacing your market" : gap < -0.03 ? "Your jobs are lagging your market" : "You're moving with your market";
      add(lead, `${when}, your jobs were ${upDown(r.yourChange)} from a year earlier, while ${what} in ${here} were ${upDown(r.marketChange)} (Zillow). ` +
        (gap > 0.03 ? "You're taking a bigger share of the moves happening here."
          : gap < -0.03 ? "The market did better than your bookings, so the gap is likely on the sales side: lead response, pricing or reviews."
            : "Your bookings are tracking the local housing market."));
    } else {
      add("Your recent volume", `${when}, your jobs were ${upDown(r.yourChange)} from the same months a year earlier.`);
    }
  }

  const p = s.price;
  if (p && p.yourChange != null && p.ppiChange != null) {
    const gap = p.yourChange - p.ppiChange;
    const lead = gap < -0.03 ? "Your prices are rising slower than the industry's" : gap > 0.03 ? "Your prices are rising faster than the industry's" : "Your prices are keeping pace with the industry";
    add(lead, `Your revenue per job, adjusted for your mix of job types, was ${upDown(p.yourChange)} from a year earlier. What U.S. movers charge rose ${fmtPct(p.ppiChange, 1)} over the same stretch (BLS producer price index). ` +
      (gap < -0.03 ? "If your costs rise with the industry, your margin is shrinking, and there may be room to raise prices."
        : gap > 0.03 ? "Keep an eye on your win rate as prices rise." : ""));
  }

  const u = s.untapped;
  if (u) {
    const lane = u.dir === "out" ? `${here} to ${city(u.name)}` : `${city(u.name)} to ${here}`;
    add(`${lane} is your biggest untapped lane`,
      `About ${fmtInt(u.households)} households a year make this ${fmtInt(u.miles)}-mile move (IRS); you booked ${fmtInt(u.yourJobs)} of them in the last 12 months. ` +
      "A realtor, relocation or agent partner at the other end is a common way in.");
  }

  if (s.longRevShare12 != null) {
    const ec = home.ec || {};
    const local = ec.rev && ec.ld ? ec.ld / ec.rev : null;
    const bench = local ?? N.us.econ.ld / N.us.econ.rev;
    const where = local != null ? "moving companies based in " + home.n : "U.S. moving companies";
    const gap = s.longRevShare12 - bench;
    add(gap < -0.1 ? "Long-distance is a smaller part of your business than the market's"
      : gap > 0.1 ? "You lean on long-distance more than the market does" : "Your long-distance mix matches the market",
    `Long-distance moves brought in ${fmtPct(s.longRevShare12)} of your revenue in the last 12 months. For ${where}, long-distance work is ${fmtPct(bench)} of revenue (2022 Economic Census).`);
  }

  const ms: number[] | undefined = home.k?.seas;
  if (s.season && ms) {
    const yours = topMonths(s.season), theirs = topMonths(ms);
    const same = yours.join() === theirs.join();
    add(same ? "Your busy season lines up with the market's" : "Your busy season and the market's don't line up",
      `Your busiest months were ${listMonths(yours)}. Home ${home.k.seas_src === "sales" ? "sales" : "listings"} in ${here} are usually busiest in ${listMonths(theirs)} (Zillow, 2019–2025).` +
      (same ? "" : home.k.seas_src === "sales"
        ? " Moves cluster around home closings, so check whether you're turning away work in the market's busiest months."
        : " New listings tend to turn into moves one to two months later."));
  }

  const src = s.bySource.filter((x) => x.label !== "Not given");
  if (src.length >= 2) {
    const tot = s.bySource.reduce((a, x) => a + x.jobs, 0);
    const [a, b] = src;
    add(a.jobs / tot > 0.4 ? "Most of your jobs come from one source" : "Where your jobs come from",
      `${a.label} brought in ${fmtPct(a.jobs / tot)} of your jobs in the last 12 months, followed by ${b.label} at ${fmtPct(b.jobs / tot)}.` +
      (a.jobs / tot > 0.4 ? " A change at that one source would hit your volume hard." : ""));
  }
  return out.slice(0, 7);
}
