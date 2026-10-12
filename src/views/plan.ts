// "Plan ahead" and "Competitor watch" on Your business, and the printable monthly report.
import type { Ctx } from "../app";
import type { Job, MarketHiringRow, MetroDetail } from "../data/types";
import { $, h } from "../lib/dom";
import { fmtInt, fmtMoney, fmtMoneyC, fmtPct } from "../lib/format";
import { load, save } from "../lib/store";
import { summarize, type BusinessSummary } from "../business/analytics";
import { crewPlan, DEFAULT_CREW, laneOpportunities, priceCheck, type CrewInputs } from "../business/planning";
import { fleetNow, type FleetNow } from "../data/fmcsa";
import { inputMetrics, type Metric } from "../business/input_metrics";
import type { PeerBench } from "../data/types";
import { matchKey } from "../../server/jobs";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthName = (ym: string) => `${MONTHS[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;
const city = (n: string) => n.split(",")[0].split("-")[0];

export function crewInputs(): CrewInputs { return { ...DEFAULT_CREW, ...(load<CrewInputs>("mmi.crew") || {}) }; }

/** Average revenue of long-distance jobs in the window, or null. */
export function avgLongJob(jobs: Job[], s: BusinessSummary): number | null {
  const xs = jobs.filter((j) => j.job_type === "Long distance" && j.revenue != null && j.status !== "Lost" && j.job_date.slice(0, 7) >= s.windowStart && j.job_date.slice(0, 7) <= s.windowEnd).map((j) => j.revenue as number);
  return xs.length >= 3 ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export function crewPay(rows: MarketHiringRow[]) {
  const med = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), i = Math.floor(s.length / 2); return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2; };
  const pick = (role: string) => rows.filter((r) => r.role === role && r.pay_median != null && Number(r.pay_median) < 80).map((r) => Number(r.pay_median));
  const n = rows.filter((r) => (r.role === "mover" || r.role === "driver")).reduce((a, r) => a + r.postings, 0);
  return { mover: med(pick("mover")), driver: med(pick("driver")), n };
}

export interface Competitor { name: string; dot: string; trucksWas: number; driversWas: number; now: FleetNow | null; inspections: number; oos: number; crashes: number; hiring: { role: string; postings: number }[] }
export async function competitors(ctx: Ctx, home: MetroDetail, hiring: MarketHiringRow[]): Promise<Competitor[]> {
  const own = matchKey(ctx.session.org?.name);
  const top = (home.top || []).filter((t: any[]) => !own || matchKey(t[0]) !== own).slice(0, 15);
  let now = new Map<string, FleetNow>();
  try { now = await fleetNow(top.map((t: any[]) => String(t[7]))); } catch { /* offline: show the data as of the refresh */ }
  return top.map((t: any[]) => {
    const k = matchKey(t[0]);
    const hires = hiring.filter((r) => k && matchKey(r.company) === k).map((r) => ({ role: r.role, postings: r.postings }));
    return { name: t[0], dot: String(t[7]), trucksWas: Number(t[3]) || 0, driversWas: Number(t[4]) || 0, now: now.get(String(t[7])) || null, inspections: Number(t[8]) || 0, oos: Number(t[9]) || 0, crashes: Number(t[12]) || 0, hiring: hires };
  });
}
const ROLE = (r: string) => ({ driver: "drivers", mover: "movers", sales: "estimators", ops: "crew leads/ops", warehouse: "warehouse", office: "office" } as Record<string, string>)[r] || r;
export function competitorNote(c: Competitor): string {
  const notes: string[] = [];
  if (c.now && !c.now.active) notes.push("No longer active with FMCSA");
  if (c.now && c.now.trucks > c.trucksWas) notes.push(`Added ${c.now.trucks - c.trucksWas} truck${c.now.trucks - c.trucksWas > 1 ? "s" : ""}`);
  if (c.now && c.now.trucks < c.trucksWas) notes.push(`Down ${c.trucksWas - c.now.trucks} truck${c.trucksWas - c.now.trucks > 1 ? "s" : ""}`);
  const hires = c.hiring.reduce((a, x) => a + x.postings, 0);
  if (hires) notes.push(`Hiring ${c.hiring.map((x) => ROLE(x.role)).join(", ")} (${hires} posting${hires > 1 ? "s" : ""})`);
  if (c.crashes >= 2) notes.push(`${c.crashes} reportable crashes in two years`);
  if (c.inspections >= 5 && c.oos / c.inspections >= 0.2) notes.push(`${Math.round((c.oos / c.inspections) * 100)}% of inspections put a vehicle out of service`);
  return notes.join(" · ");
}

// ---------------------------------------------------------------------------------------------- Your business sections
export function planSections(here: string) {
  return [
    h("section", { class: "block", id: "b-plan" },
      h("div", { class: "sec-head" }, h("h2", null, "Plan ahead"), h("p", null, "Crews for the months ahead, your prices against the market, and the lanes worth chasing")),
      h("div", { class: "grid" },
        h("div", { class: "panel w7" }, h("h3", null, "Crew planner"), h("p", { class: "sub" }, "How many crews your forecast needs. Change the numbers to match how you run."),
          h("div", { class: "crew-inputs" },
            h("label", null, "Crews you have", h("input", { type: "number", id: "crew-n", min: "0", step: "1" })),
            h("label", null, "Jobs per crew per day", h("input", { type: "number", id: "crew-rate", min: "0.1", step: "0.1" })),
            h("label", null, "Working days a month", h("input", { type: "number", id: "crew-days", min: "1", max: "31", step: "1" }))),
          h("div", { id: "crew-table" }), h("p", { class: "foot", id: "crew-foot" })),
        h("div", { class: "panel w5" }, h("h3", null, "Price check"), h("div", { id: "price-check" })),
        h("div", { class: "panel w12" }, h("h3", null, "Input metrics"), h("p", { class: "sub" }, "The numbers you control, which drive the results. Latest three complete months against the three before and a year earlier."),
          h("div", { id: "input-metrics" }), h("p", { class: "foot", id: "input-foot" })),
        h("div", { class: "panel w12" }, h("h3", null, "Movers like you"), h("p", { class: "sub" }, "Your numbers against other Acumena clients, anonymously. No company's figures are ever shown, only ranges."),
          h("div", { id: "peers" }, h("p", { class: "loading" }, "Loading…"))),
        h("div", { class: "panel w12" }, h("h3", null, "Lane opportunities"), h("p", { class: "sub" }, `Long-distance routes from and to ${here} where you're below your usual share, ranked by the jobs a year you'd add by matching it.`),
          h("div", { id: "lane-opps" }), h("p", { class: "foot", id: "lane-opps-foot" })))),
    h("section", { class: "block", id: "b-watch" },
      h("div", { class: "sec-head" }, h("h2", null, "Competitor watch"), h("p", null, `The largest movers based in ${here}: fleet changes, safety inspections and who's hiring`)),
      h("div", { class: "grid" }, h("div", { class: "panel w12" }, h("div", { id: "comp-watch" }, h("p", { class: "loading" }, "Checking FMCSA…")), h("p", { class: "foot", id: "comp-foot" })))),
  ];
}

export async function drawPlan(ctx: Ctx, home: MetroDetail, s: BusinessSummary, jobs: Job[]) {
  const here = city(home.n);
  // crew planner
  const inp = crewInputs();
  const nEl = $("#crew-n") as HTMLInputElement, rEl = $("#crew-rate") as HTMLInputElement, dEl = $("#crew-days") as HTMLInputElement;
  nEl.value = String(inp.crews); rEl.value = String(inp.jobsPerCrewDay); dEl.value = String(inp.workDays);
  const drawCrew = () => {
    const cur: CrewInputs = { crews: Math.max(0, Number(nEl.value) || 0), jobsPerCrewDay: Math.max(0.1, Number(rEl.value) || DEFAULT_CREW.jobsPerCrewDay), workDays: Math.min(31, Math.max(1, Number(dEl.value) || DEFAULT_CREW.workDays)) };
    save("mmi.crew", cur);
    const plan = crewPlan(s, home.k?.seas ?? null, cur);
    $("#crew-table").replaceChildren(plan.length ? h("div", { class: "tbl-wrap", style: "margin-top:8px" }, h("table", null,
      h("thead", null, h("tr", null, h("th", null, "Month"), h("th", { class: "n" }, "Jobs expected"), h("th", { class: "n" }, "Crews needed"), h("th", null, "Against today"))),
      h("tbody", null, ...plan.map((m) => h("tr", { class: m.gapHigh > 0 ? "flag" : "" },
        h("td", null, monthName(m.month), m.kind === "peak" ? h("div", { class: "cell-note" }, "Your busiest month") : null),
        h("td", { class: "n" }, fmtInt(m.jobs), h("div", { class: "cell-note" }, "up to " + fmtInt(m.jobsHigh))),
        h("td", { class: "n" }, h("b", null, fmtInt(m.crews)), m.crewsHigh > m.crews ? h("div", { class: "cell-note" }, "up to " + fmtInt(m.crewsHigh)) : null),
        h("td", null, m.gap > 0 ? h("b", null, `${m.gap} short`) : m.gapHigh > 0 ? `Enough, unless it's a strong month (${m.gapHigh} short)` : m.gap < -1 ? `${-m.gap} spare` : "Enough"))))))
      : h("p", { class: "sub" }, "Upload 12 months of jobs to plan crews."));
    const short = plan.find((m) => m.gapHigh > 0);
    $("#crew-foot").replaceChildren(
      "Crews needed = jobs ÷ (jobs per crew per day × working days), rounded up. Jobs expected come from your booking forecast; the busiest month uses your last 12 months, your seasonality and the market forecast. ",
      short ? h("span", null, h("b", null, `You'll be short in ${monthName(short.month).split(" ")[0]}. `), "Hiring for a busy month takes 4 to 6 weeks: Acumena can staff the gap.") : "");
  };
  [nEl, rEl, dEl].forEach((x) => x.addEventListener("input", drawCrew));
  drawCrew();

  // input metrics
  const im = inputMetrics(jobs, s.windowEnd);
  const fmtM = (m: Metric, v: number | null) => v == null ? "–" : m.fmt === "pct" ? fmtPct(v) : m.fmt === "money" ? fmtMoney(v) : fmtInt(v);
  const chg = (m: Metric, v: number | null, base: number | null) => {
    if (v == null || base == null || base === 0) return h("span", { class: "dim" }, "–");
    const d = m.fmt === "pct" ? v - base : v / base - 1;
    const good = (d > 0) === m.higherIsBetter;
    const txt = m.fmt === "pct" ? `${d >= 0 ? "+" : "−"}${Math.abs(d * 100).toFixed(1)} pts` : `${d >= 0 ? "+" : "−"}${Math.abs(d * 100).toFixed(0)}%`;
    return Math.abs(d) < 0.005 ? h("span", { class: "dim" }, "Flat") : h("span", { class: "delta " + (good ? "up" : "down") }, txt);
  };
  const mLabel = (r: string[]) => `${monthName(r[0]).split(" ")[0].slice(0, 3)}–${monthName(r[1]).slice(0, 3)} ${r[1].slice(0, 4)}`;
  const shown = im.metrics.filter((m) => m.now != null || m.prev != null);
  $("#input-metrics").replaceChildren(h("div", { class: "tbl-wrap", style: "margin-top:0" }, h("table", null,
    h("thead", null, h("tr", null, h("th", null, "Metric"), h("th", { class: "n" }, mLabel(im.months.now)), h("th", { class: "n" }, "vs " + mLabel(im.months.prev)), h("th", { class: "n" }, "vs " + mLabel(im.months.yearAgo)), h("th", null, "What moves it"))),
    h("tbody", null, ...shown.map((m) => h("tr", null, h("td", null, h("b", null, m.label)), h("td", { class: "n" }, fmtM(m, m.now)),
      h("td", { class: "n" }, chg(m, m.now, m.prev)), h("td", { class: "n" }, chg(m, m.now, m.yearAgo)), h("td", null, h("span", { class: "cell-note", style: "white-space:normal" }, m.help))))))));
  const missing = im.metrics.filter((m) => m.now == null && m.prev == null).map((m) => m.label.toLowerCase());
  $("#input-foot").textContent = "Amazon-style: watch the inputs weekly and the results follow. Year-ago comparisons cancel out seasonality; the three months before show the latest direction." + (missing.length ? ` Not shown (add the column to your upload): ${missing.join(", ")}.` : "");

  // movers like you
  void ctx.ds.peerBenchmarks().catch(() => ({ peers: 0, ready: false }) as PeerBench).then((pb) => drawPeers(ctx, pb));

  // lane opportunities
  const ld = avgLongJob(jobs, s);
  const opps = laneOpportunities(s, ld);
  $("#lane-opps").replaceChildren(opps.length ? h("div", { class: "tbl-wrap", style: "margin-top:0" }, h("table", null,
    h("thead", null, h("tr", null, h("th", null, "Lane"), h("th", { class: "n" }, "Households a year"), h("th", { class: "n" }, "Your jobs"), h("th", { class: "n" }, "Your share"), h("th", { class: "n" }, "Jobs a year at your usual share"), h("th", { class: "n" }, "Revenue"))),
    h("tbody", null, ...opps.map((o) => h("tr", null,
      h("td", null, o.lane.dir === "out" ? `${here} → ${city(o.lane.name)}` : `${city(o.lane.name)} → ${here}`, h("div", { class: "cell-note" }, `${fmtInt(o.lane.miles)} miles`)),
      h("td", { class: "n" }, fmtInt(o.lane.households)), h("td", { class: "n" }, fmtInt(o.lane.yourJobs)), h("td", { class: "n" }, fmtPct(o.lane.share, 1)),
      h("td", { class: "n" }, h("b", null, "+" + fmtInt(o.extraJobs))), h("td", { class: "n" }, o.extraRevenue == null ? "–" : "+" + fmtMoneyC(o.extraRevenue)))))))
    : h("p", { class: "sub" }, "Book long-distance jobs on at least one lane to see where you have room to grow."));
  $("#lane-opps-foot").textContent = opps.length ? `Your usual share is the median of your shares on lanes you already serve (${fmtPct(opps[0].target, 1)}). Revenue uses your average long-distance job${ld ? ` (${fmtMoney(ld)})` : ""}. Households a year: IRS address changes, 2022 to 2023.` : "";

  // price check and competitor watch need market hiring
  const hiring = await ctx.ds.marketHiring(home.c).catch(() => [] as MarketHiringRow[]);
  const q = home.q || {};
  const blsWk = q["484210"]?.[2] ?? q.st?.["484210"]?.[2] ?? null;
  const pc = priceCheck(s, crewPay(hiring), blsWk ? blsWk / 40 : null);
  $("#price-check").replaceChildren(
    pc.verdict ? h("p", { class: "pc-verdict pc-" + pc.verdict }, pc.verdict === "behind" ? "Behind the industry" : pc.verdict === "ahead" ? "Ahead of the industry" : "Keeping pace") : "",
    h("ul", { class: "plain-list" }, ...pc.lines.map((l) => h("li", null, l))));

  const comps = await competitors(ctx, home, hiring);
  drawCompetitors($("#comp-watch"), comps);
  $("#comp-foot").textContent = `Movers headquartered in ${here} with the most trucks, from the FMCSA carrier register. Trucks and drivers compare their filing when this app's data was refreshed with FMCSA today. Inspections: roadside vehicle inspections in the last two years and the share that put a vehicle out of service (the national average is about ${Math.round((ctx.N.bench?.voos ?? 0.14) * 100)}%). Crashes: reportable crashes in FMCSA's safety data over two years. Hiring: job postings seen in the last 60 days. FMCSA doesn't publish consumer complaints in bulk, so complaints aren't included.`;
}

function drawPeers(ctx: Ctx, pb: PeerBench) {
  const el = $("#peers");
  if (!el) return;
  if (!pb.ready || !pb.quartiles) {
    el.replaceChildren(h("p", { class: "sub" }, `This switches on when at least 5 other Acumena clients have uploaded a year of jobs (50 or more). Right now: ${pb.peers}. Until then nobody's numbers are compared, so no single company can be picked out.`));
    return;
  }
  const rows: [keyof NonNullable<PeerBench["quartiles"]>, string, "pct" | "money" | "num"][] = [["win", "Quotes won", "pct"], ["avg_rev", "Revenue per job", "money"], ["per_hour", "Revenue per crew-hour", "money"], ["long_share", "Long-distance share", "pct"], ["jobs", "Jobs, last 12 months", "num"]];
  const f = (v: number | null | undefined, k: "pct" | "money" | "num") => v == null ? "–" : k === "pct" ? fmtPct(v) : k === "money" ? fmtMoney(v) : fmtInt(v);
  const pos = (v: number | null | undefined, q: (number | null)[] | null) => {
    if (v == null || !q || q[0] == null || q[2] == null) return h("span", { class: "dim" }, "–");
    return v >= (q[2] as number) ? h("span", { class: "delta up" }, "Top quarter") : v <= (q[0] as number) ? h("span", { class: "delta down" }, "Bottom quarter") : h("span", null, "Middle half");
  };
  el.replaceChildren(h("div", { class: "tbl-wrap", style: "margin-top:0" }, h("table", null,
    h("thead", null, h("tr", null, h("th", null, "Metric"), h("th", { class: "n" }, "You"), h("th", { class: "n" }, "Peers: middle half"), h("th", { class: "n" }, "Peer median"), h("th", null, "Where you stand"))),
    h("tbody", null, ...rows.map(([k, label, kind]) => { const q = pb.quartiles![k]; const v = pb.mine?.[k];
      return h("tr", null, h("td", null, h("b", null, label)), h("td", { class: "n" }, f(v, kind)), h("td", { class: "n" }, q ? `${f(q[0], kind)} – ${f(q[2], kind)}` : "–"), h("td", { class: "n" }, f(q?.[1], kind)), h("td", null, pos(v, q))); })))),
    pb.markets && pb.markets.length ? h("p", { class: "sub", style: "margin-top:10px" }, h("b", null, "Movers like you also cover: "),
      ...pb.markets.flatMap((m, i) => [i ? ", " : "", h("a", { href: "#/market/" + m.cbsa }, ctx.byCode.get(m.cbsa)?.n ?? m.cbsa), ` (${m.peers})`])) : "",
    h("p", { class: "foot" }, `Compared with ${pb.peers} other Acumena clients with 50+ jobs in the last 12 complete months. Only ranges are shown; no other company's figures.`));
}

export function drawCompetitors(el: HTMLElement, comps: Competitor[]) {
  el.replaceChildren(comps.length ? h("div", { class: "tbl-wrap", style: "margin-top:0" }, h("table", null,
    h("thead", null, h("tr", null, h("th", null, "Mover"), h("th", { class: "n" }, "Trucks"), h("th", { class: "n" }, "Drivers"), h("th", { class: "n" }, "Out-of-service rate"), h("th", { class: "n" }, "Crashes, 2 years"), h("th", null, "What stands out"))),
    h("tbody", null, ...comps.map((c) => {
      const tr = (was: number, now: number | undefined) => now == null || now === was ? fmtInt(was) : h("span", { class: now > was ? "delta up" : "delta down" }, `${fmtInt(was)} → ${fmtInt(now)}`);
      const note = competitorNote(c);
      return h("tr", { class: note ? "flag" : "" }, h("td", null, h("b", null, c.name), h("div", { class: "cell-note" }, "USDOT " + c.dot)),
        h("td", { class: "n" }, tr(c.trucksWas, c.now?.trucks)), h("td", { class: "n" }, tr(c.driversWas, c.now?.drivers)),
        h("td", { class: "n" }, c.inspections ? `${fmtPct(c.oos / c.inspections)} of ${fmtInt(c.inspections)}` : h("span", { class: "dim" }, "No inspections")),
        h("td", { class: "n" }, fmtInt(c.crashes)),
        h("td", null, note || h("span", { class: "dim" }, "No change")));
    })))) : h("p", { class: "sub" }, "No household-goods movers with a federal filing are based in this metro."));
}

// ---------------------------------------------------------------------------------------------- monthly report
export async function reportView(el: HTMLElement, ctx: Ctx) {
  const org = ctx.session.org;
  const homeCode = org?.home_cbsa;
  const home = homeCode ? await ctx.detail(homeCode) : null;
  if (!org || !home) {
    el.replaceChildren(h("section", { class: "block" }, h("div", { class: "panel w12" }, h("h3", null, "The monthly report is for client companies"), h("p", { class: "sub" }, "It needs a company with a home market in its plan."))));
    return;
  }
  const jobs = await ctx.ds.jobs();
  const s = summarize(jobs, home, ctx.N, ctx.byCode);
  const hiring = await ctx.ds.marketHiring(home.c).catch(() => [] as MarketHiringRow[]);
  const comps = await competitors(ctx, home, hiring);
  const here = city(home.n);
  const today = new Date();
  const title = `${org.name}: ${MONTHS[today.getMonth()]} ${today.getFullYear()} market report`;
  const fc = home.fc;
  const lines: { h: string; items: string[] }[] = [];
  // market
  const mk: string[] = [];
  if (fc && fc.mv != null && fc.g != null) mk.push(`Expect about ${fmtInt(fc.mv)} household moves in ${here} from ${monthName(fc.m[0]).split(" ")[0]} to ${monthName(fc.m[2])}, ${fc.g >= 0 ? "up" : "down"} ${fmtPct(Math.abs(fc.g))} on the same months last year (likely ${fmtInt(fc.mvlo ?? fc.mv)} to ${fmtInt(fc.mvhi ?? fc.mv)}).`);
  if (home.k?.s3 != null) mk.push(`Home sales over the last three months: ${home.k.s3 >= 0 ? "up" : "down"} ${fmtPct(Math.abs(home.k.s3), 1)} on a year earlier${home.k?.n3 != null ? `; new listings ${home.k.n3 >= 0 ? "up" : "down"} ${fmtPct(Math.abs(home.k.n3), 1)}` : ""} (Zillow, through ${monthName(ctx.N.last_month)}).`);
  if (home.dm?.[4] != null) mk.push(`Net moves from the rest of the U.S. in 2025: ${home.dm[4] >= 0 ? "+" : ""}${fmtInt(home.dm[4])} people (Census).`);
  lines.push({ h: `${here} market`, items: mk });
  if (s) {
    const yb: string[] = [];
    yb.push(`${fmtInt(s.jobs12)} jobs in the last 12 months${s.jobsPrior12 ? `, ${s.jobs12 >= s.jobsPrior12 ? "up" : "down"} ${fmtPct(Math.abs(s.jobs12 / s.jobsPrior12 - 1))} on the 12 before` : ""}${s.marketShare != null ? `; about ${fmtPct(s.marketShare, 1)} of ${here} household moves` : ""}.`);
    if (s.outlook) yb.push(`Booking forecast, ${monthName(s.outlook.months[0]).split(" ")[0]}–${monthName(s.outlook.months[2])}: about ${fmtInt(s.outlook.f.reduce((a, b) => a + b, 0))} jobs (likely ${fmtInt(s.outlook.lo.reduce((a, b) => a + b, 0))} to ${fmtInt(s.outlook.hi.reduce((a, b) => a + b, 0))}).`);
    const plan = crewPlan(s, home.k?.seas ?? null, crewInputs());
    const short = plan.find((m) => m.gapHigh > 0);
    if (plan.length) yb.push(short ? `Crews: with ${crewInputs().crews} crews you'll be short ${Math.max(short.gap, short.gapHigh)} in ${monthName(short.month)}. Start hiring 4 to 6 weeks ahead.` : `Crews: your ${crewInputs().crews} crews cover the forecast.`);
    lines.push({ h: "Your business", items: yb });
    const pc = priceCheck(s, crewPay(hiring), null);
    lines.push({ h: "Price check", items: pc.lines.slice(0, 3) });
    const opp = laneOpportunities(s, avgLongJob(jobs, s))[0];
    if (opp) lines.push({ h: "Biggest lane opportunity", items: [`${opp.lane.dir === "out" ? `${here} → ${city(opp.lane.name)}` : `${city(opp.lane.name)} → ${here}`}: ${fmtInt(opp.lane.households)} households a year; you booked ${fmtInt(opp.lane.yourJobs)}. Matching your usual share would add about ${fmtInt(opp.extraJobs)} jobs a year${opp.extraRevenue ? ` (${fmtMoneyC(opp.extraRevenue)})` : ""}.`] });
  }
  const notable = comps.map((c) => ({ c, n: competitorNote(c) })).filter((x) => x.n).slice(0, 5);
  lines.push({ h: "Competitor watch", items: notable.length ? notable.map((x) => `${x.c.name}: ${x.n}.`) : ["No notable changes among the largest movers this month."] });

  const text = `${title}\n\n` + lines.map((g) => `${g.h.toUpperCase()}\n` + g.items.map((i) => `- ${i}`).join("\n")).join("\n\n") +
    `\n\nFull detail: ${location.origin}${location.pathname}#/market/${home.c}\nSources: Census, IRS, Zillow, FMCSA, BLS. Prepared by Acumena Analytics.`;
  el.replaceChildren(h("section", { class: "block report" },
    h("div", { class: "report-actions no-print" },
      h("button", { class: "btn btn-primary", type: "button", onclick: () => window.print() }, "Print or save as PDF"),
      h("button", { class: "btn", type: "button", onclick: async (e: Event) => {
        const b = e.currentTarget as HTMLButtonElement;
        try { await navigator.clipboard.writeText(text); b.textContent = "Copied"; } catch { b.textContent = "Couldn't copy"; }
        setTimeout(() => { b.textContent = "Copy as email text"; }, 2000);
      } }, "Copy as email text"),
      h("a", { class: "btn btn-quiet", href: "#/business" }, "Back to Your business")),
    h("div", { class: "panel w12 report-page" },
      h("p", { class: "eyebrow-dark" }, "Acumena Analytics · Monthly report"),
      h("h2", null, title),
      ...lines.map((g) => h("div", { class: "report-sec" }, h("h3", null, g.h), h("ul", { class: "plain-list" }, ...g.items.map((i) => h("li", null, i))))),
      h("p", { class: "foot" }, `Prepared ${today.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} from Census, IRS, Zillow, FMCSA and BLS data, and your uploaded jobs.`))));
}
