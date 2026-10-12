import type { MetroDetail, MetroIndexRow, NationalData } from "../data/types";
import { fmtInt, fmtMoney, fmtPct, fmtCompact, monthLabel, MONTHS_LONG } from "../lib/format";
import { city, shortRegion, stateNameBare } from "./geo";

export interface Insight { lead: string; text: string }

/** Plain-language read of one metro's numbers (same rules as the original web tool). */
export function insights(m: MetroDetail, N: NationalData, byCode: Map<string, MetroIndexRow>): Insight[] {
  const out: Insight[] = [];
  const add = (lead: string, text: string) => out.push({ lead, text });
  const B = N.bench;
  const k = m.k || {};

  if (m.hhm) {
    add("About " + fmtCompact(m.hhm) + " household moves a year",
      fmtInt(m.acs.mv) + " people moved into or within the area in 2024. At " + Number(m.acs.ahs).toFixed(2) +
      " people per household, that is roughly " + fmtInt(m.hhm) + " household moves, more than " +
      Math.round(m.pr.size ?? 0) + "% of U.S. metros.");
  }

  if (k.s3 != null || k.n3 != null) {
    const n3 = k.n3, s3 = k.s3;
    const lead = n3 == null ? "Home sales trend" : n3 > 0.03 ? "More homes are coming up for sale"
      : n3 < -0.03 ? "Fewer homes are coming up for sale" : "Home listings are steady";
    const span = monthLabel(N.zm[N.zm.length - 3]).split(" ")[0] + " to " + monthLabel(N.last_month);
    let txt = "From " + span + ", ";
    if (s3 != null) txt += "home sales were " + (s3 >= 0 ? "up " : "down ") + fmtPct(Math.abs(s3), 1) + " from a year earlier" + (n3 != null ? " and " : ". ");
    if (n3 != null) txt += "new listings were " + (n3 >= 0 ? "up " : "down ") + fmtPct(Math.abs(n3), 1) + (s3 == null ? " from a year earlier. " : ". ");
    if (n3 != null) txt += n3 > 0.03 ? "Expect more booked moves over the next one to two months."
      : n3 < -0.03 ? "Expect a slower stretch over the next one to two months." : "Expect a typical fall season.";
    add(lead, txt);
  }

  const dm = m.dm[4], im = m.im[4];
  if (dm != null && m.dmr != null) {
    if (dm >= 0) add("Gaining people from the rest of the U.S.", fmtInt(dm) + " more people moved here from other U.S. places than left in 2025 (" +
      m.dmr.toFixed(1) + " per 1,000 residents; the typical metro gained " + Number(B.dmr).toFixed(1) + ").");
    else add("Losing people to the rest of the U.S.", fmtInt(-dm) + " more people left for other U.S. places than arrived in 2025" +
      (im != null && im > 0 ? ", while arrivals from abroad added " + fmtInt(im) : "") +
      ". With more households leaving than arriving, outbound long-distance moves are the stronger line of work.");
  }

  const outs = (m.ln.out || []).filter((l: any[]) => l[3] >= 150 && l[2] != null);
  let best: { l: any[]; gap: number } | null = null;
  for (const l of outs) {
    const gap = l[1] - l[2];
    if (gap > 0 && (!best || gap > best.gap)) best = { l, gap };
  }
  if (best) {
    const o = byCode.get(best.l[0]);
    if (o) add("Return loads: " + city(m.n) + " to " + city(o.n),
      fmtInt(best.l[1]) + " households a year move to the " + o.n + " area, but only " + fmtInt(best.l[2]) +
      " come back the other way (" + fmtInt(best.l[3]) + " miles). Trucks on this lane often return light, so a partner agent there could fill return loads.");
  } else {
    const ins = (m.ln.in || []).filter((l: any[]) => l[3] >= 150);
    const o = ins.length ? byCode.get(ins[0][0]) : null;
    if (o) add("Top long-distance source: " + o.n, fmtInt(ins[0][1]) + " households a year move here from the " + o.n + " area (" + fmtInt(ins[0][3]) + " miles).");
  }

  if (m.mpc) {
    const ratio = m.mpc / B.mpc;
    const crowd = ratio > 1.25 ? "less crowded than most" : ratio < 0.8 ? "more crowded than most" : "about as crowded as most";
    add("A market " + crowd, fmtInt(m.fm.n) + " household-goods movers are based here (" + fmtInt(m.fm.i) +
      " interstate). That is about " + fmtInt(m.mpc) + " household moves per mover, against " + fmtInt(B.mpc) +
      " in the typical metro." + (m.fm.new ? " " + fmtInt(m.fm.new) + " of them registered in the last two years." : ""));
  }

  const q = m.q || {}, qs = q.st || {};
  const metroOK = q["484210"]?.[2] && q["4841"]?.[2];
  const src = metroOK ? q : qs;
  const mv = src["484210"]?.[2], tv = src["4841"]?.[2], wv = src["493110"]?.[2];
  if (mv && tv) {
    const where = metroOK ? "in this metro" : "across " + stateNameBare(m.s) + " (metro figures are withheld)";
    let txt = "Moving companies " + where + " paid an average of " + fmtMoney(mv) + " a week in 2025. General freight trucking paid " + fmtMoney(tv);
    if (wv) txt += " and warehouses paid " + fmtMoney(wv);
    txt += ". " + (tv > mv * 1.05 ? "Drivers can earn " + fmtPct(tv / mv - 1) + " more hauling freight, so expect pressure on driver pay."
      : "Movers are holding their own on pay against freight trucking.");
    add(tv > mv * 1.05 ? "Freight trucking pays more" : "Pay is competitive", txt);
  }

  if (m.irs?.ia) {
    add("Who is arriving", "Households that moved in reported average income of " + fmtMoney(m.irs.ia) +
      " on their tax returns, against " + fmtMoney(m.irs.oa) + " for those who left (2022 to 2023). Arrivals in the typical metro averaged " + fmtMoney(B.ia) + ".");
  }

  const seas: number[] | undefined = k.seas;
  if (seas) {
    const top = seas.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0]).slice(0, 3).sort((a, b) => a[1] - b[1]);
    const share = top.reduce((s, x) => s + x[0], 0);
    add("Peak season", MONTHS_LONG[top[0][1]] + ", " + MONTHS_LONG[top[1][1]] + " and " + MONTHS_LONG[top[2][1]] +
      " usually bring " + fmtPct(share) + " of the year's home " + (k.seas_src === "sales" ? "sales" : "listings") + " here. Line up crews and trucks before then.");
  }

  const dz = N.diesel[m.dz], dv = dz ? dz.v : [];
  const ppi = N.prices.ppi.v as number[];
  const ppiY = ppi[ppi.length - 1] / ppi[ppi.length - 13] - 1;
  if (dv.length) {
    const last = dv[dv.length - 1] as number, prev = dv[dv.length - 53] as number;
    add("Fuel is the cost to watch", "Diesel in the " + shortRegion(dz.name) + " region was $" + last.toFixed(2) +
      " a gallon in early October 2026, " + fmtPct(last / prev - 1) + " above a year earlier. Prices U.S. movers charge rose " +
      fmtPct(ppiY, 1) + " over the year to " + monthLabel(N.prices.ppi.m[N.prices.ppi.m.length - 1]) + ".");
  }
  return out;
}
