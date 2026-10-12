// Market strategy tools built from public data: round-trip (backhaul) lanes and a demand pricing calendar.
import type { MetroDetail } from "../data/types";

export interface RoundTrip {
  code: string; miles: number;
  out: number;   // households a year moving from this metro to the partner
  back: number;  // households a year moving from the partner to this metro
  balance: number; // smaller direction ÷ larger direction, 0..1
  kind: "both" | "out" | "in";
  advice: string;
}
/** Every partner metro in the lane data, with households in both directions. A lane "pays both ways" when the
 *  lighter direction is at least 70% of the heavier one, so a truck can be loaded for the trip home. */
export function roundTrips(m: MetroDetail, minMiles = 100): RoundTrip[] {
  const pairs = new Map<string, { out: number; back: number; miles: number }>();
  for (const r of m.ln?.out || []) pairs.set(r[0], { out: r[1], back: r[2], miles: r[3] });
  for (const r of m.ln?.in || []) if (!pairs.has(r[0])) pairs.set(r[0], { out: r[2], back: r[1], miles: r[3] });
  return [...pairs.entries()].filter(([, v]) => v.miles >= minMiles && v.out + v.back > 0).map(([code, v]) => {
    const balance = Math.min(v.out, v.back) / Math.max(v.out, v.back);
    const kind: RoundTrip["kind"] = balance >= 0.7 ? "both" : v.out > v.back ? "out" : "in";
    const advice = kind === "both" ? "Pays both ways: quote round trips and keep trucks loaded in each direction."
      : kind === "out" ? `Mostly one-way out: about ${Math.round((1 - balance) * 100)}% of return trips would run light. Price the outbound move to cover the empty return, or partner with a mover at the other end for return loads.`
      : `Mostly one-way in: movers there send more trucks here than go back. Offer return-load rates to movers at the other end, or price outbound moves to win their backhaul.`;
    return { code, miles: v.miles, out: v.out, back: v.back, balance, kind, advice };
  }).sort((a, b) => (b.kind === "both" ? 1 : 0) - (a.kind === "both" ? 1 : 0) || (Math.min(b.out, b.back) - Math.min(a.out, a.back)));
}

export interface WeekCell { start: Date; index: number; band: "peak" | "busy" | "standard" | "slow"; adjust: number; why: string[] }
const HOLIDAY_WEEKS: [number, number, string][] = [[10, 22, "Thanksgiving week"], [11, 22, "Christmas week"], [11, 29, "New Year week"]]; // [month, day-of-month start, label]
/** Expected moving demand for each of the next `weeks` weeks against the market's average week:
 *  monthly seasonality × the month-end rush (leases and closings cluster at month-end) × holiday dips × the 90-day forecast. */
export function pricingCalendar(m: MetroDetail, weeks = 26, today = new Date()): WeekCell[] {
  const seas: number[] = m.k?.seas && m.k.seas.length === 12 ? m.k.seas : Array(12).fill(1 / 12);
  const avg = seas.reduce((a, b) => a + b, 0) / 12;
  const g = m.fc?.g ?? 0;
  const fcMonths = new Set(m.fc?.m || []);
  const start = new Date(today); start.setHours(12, 0, 0, 0); start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // Monday
  const out: WeekCell[] = [];
  for (let w = 0; w < weeks; w++) {
    const d0 = new Date(start.getTime() + w * 7 * 864e5);
    const days = Array.from({ length: 7 }, (_, i) => new Date(d0.getTime() + i * 864e5));
    const why: string[] = [];
    // average the month seasonality over the week's days
    let idx = days.reduce((a, d) => a + seas[d.getMonth()] / avg, 0) / 7;
    const mName = d0.toLocaleDateString("en-US", { month: "long" });
    if (seas[d0.getMonth()] / avg >= 1.1) why.push(`${mName} is a busy month here`);
    if (seas[d0.getMonth()] / avg <= 0.9) why.push(`${mName} is a slow month here`);
    const monthEnd = days.some((d) => { const next = new Date(d.getTime() + 864e5); return next.getMonth() !== d.getMonth() || d.getDate() === 1; });
    if (monthEnd) { idx *= 1.15; why.push("Month-end rush"); }
    const hol = HOLIDAY_WEEKS.find(([mo, day]) => days.some((d) => d.getMonth() === mo && d.getDate() >= day && d.getDate() < day + 7));
    if (hol) { idx *= 0.85; why.push(hol[2]); }
    const ym = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, "0")}`;
    if (fcMonths.has(ym) && Math.abs(g) >= 0.02) { idx *= 1 + g; why.push(`Home sales forecast ${g > 0 ? "up" : "down"} ${Math.round(Math.abs(g) * 100)}%`); }
    const band: WeekCell["band"] = idx >= 1.25 ? "peak" : idx >= 1.08 ? "busy" : idx <= 0.88 ? "slow" : "standard";
    const adjust = band === "peak" ? 0.15 : band === "busy" ? 0.07 : band === "slow" ? -0.1 : 0;
    out.push({ start: d0, index: idx, band, adjust, why });
  }
  return out;
}
