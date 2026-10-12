// Market snapshot: one metro's demand, lanes, competition, labor and costs.
import { drawStrategy, pricingPanel, roundTripPanel } from "./strategy_panels";
import type { Ctx } from "../app";
import type { MetroDetail, MetroIndexRow } from "../data/types";
import { $, h, cssVar, type Child } from "../lib/dom";
import {
  dateLabel, fmtCompact, fmtInt, fmtMoney, fmtMoneyC, fmtMoneyK, fmtPct, fmtSigned, fmtSignedPct, monthLabel,
  MONTHS, MONTHS_LONG, ordinal, sinceLabel,
} from "../lib/format";
import { hbars } from "../charts/hbars";
import { lineChart } from "../charts/line";
import { columnChart } from "../charts/columns";
import { legend } from "../charts/legend";
import { drawLanesMap, loadStates, type DrawnLane, type LaneDir } from "../charts/map";
import { COMP, rank, rankedCount, SIZE_NAMES, sizeClass, weights } from "../market/scoring";
import { insights } from "../market/insights";
import { city, shortRegion, stateName, stateNameBare } from "../market/geo";

let redraw: AbortController | null = null;

export async function marketView(el: HTMLElement, ctx: Ctx) {
  redraw?.abort();
  const idx = ctx.byCode.get(ctx.current) as MetroIndexRow;
  if (!ctx.allowed(ctx.current)) return lockedView(el, ctx, idx);
  const m = await ctx.detail(ctx.current);
  if (!m) return lockedView(el, ctx, idx);
  el.replaceChildren(skeleton());
  fillStatic(m, ctx);
  fillForecast(m, ctx);
  drawStrategy(m, ctx);
  const draw = () => drawCharts(m, ctx);
  await draw();
  redraw = new AbortController();
  document.addEventListener("mmi:redraw", () => { if ($("#s-overview")) void draw(); }, { signal: redraw.signal });
}

// ---------------------------------------------------------------------------------------------
function panel(cls: string, title: Child, sub: Child, ...body: Child[]) {
  return h("div", { class: "panel " + cls }, h("h3", null, title), sub ? h("p", { class: "sub" }, sub) : null, ...body);
}
function section(id: string, title: string, sub: string, ...body: Child[]) {
  return h("section", { class: "block", id }, h("div", { class: "sec-head" }, h("h2", null, title), h("p", null, sub)), ...body);
}
const ref = (id: string, cls = "") => h("div", { id, class: cls });
const foot = (id: string) => h("p", { class: "foot", id });

function skeleton() {
  return h("div", null,
    h("section", { class: "block", id: "s-overview" },
      h("div", { class: "tiles", id: "tiles" }),
      h("div", { class: "grid", style: "margin-top:14px" },
        h("div", { class: "panel w7" }, h("h3", { id: "ins-title" }, "What stands out"),
          h("p", { class: "sub" }, "Plain-language read of the numbers below."), h("ul", { class: "insights", id: "insights" })),
        h("div", { class: "panel w5" }, h("h3", null, "How the score breaks down"),
          h("p", { class: "sub" }, "Each part ranks this metro against all 387 U.S. metros (100 = top). The weight is in gray."),
          h("div", { class: "meters", id: "meters" }), h("ul", { class: "ranks", id: "ranks" }),
          h("p", { class: "foot" }, "Change the weights in ", h("a", { href: "#/compare" }, "Compare markets"), ".")))),
    section("s-demand", "Demand", "Who is moving, and where the housing market is heading",
      h("div", { class: "grid" },
        h("div", { class: "panel w5 fc-panel", id: "fc-panel" }),
        panel("w7", h("span", { id: "fc-title" }, "Outlook: the next three months"), h("span", { id: "fc-sub" }, "Monthly home sales, with the forecast and its likely range"),
          ref("lg-fc", "legend"), ref("ch-fc", "chart"), foot("ft-fc")),
        panel("w8", "Home sales and new listings each month", "New listings tend to turn into moves within one to two months.",
          ref("lg-housing", "legend"), ref("ch-housing", "chart"), foot("ft-housing")),
        panel("w4", "Busiest months", h("span", { id: "sub-season" }, "Average share of a year's home sales, 2019–2025"),
          ref("ch-season", "chart"), foot("ft-season")),
        panel("w6", "Where last year's movers came from", "People who moved into a home in this metro in the past year, 2024",
          ref("ch-origins"), foot("ft-origins")),
        panel("w6", "Net moves from the rest of the U.S.", "People moving in minus people moving out to other U.S. places, by year",
          ref("ch-mig", "chart"), foot("ft-mig")),
        panel("w12", "Households crossing the metro line", "Tax returns that changed address into or out of the metro, 2022 to 2023 (newest IRS data)",
          h("div", { class: "pair", id: "irs-pair" }),
          h("p", { class: "foot" }, "A tax return stands for a household. Moves between counties inside the metro are left out because they are local moves.")),
        pricingPanel())),
    section("s-lanes", "Long-distance lanes", "The metro pairs with the most households moving between them",
      h("div", { class: "grid" },
        h("div", { class: "panel w12" },
          h("h3", { id: "lanes-title" }, "Top lanes"),
          h("p", { class: "sub" }, "Line width shows households per year. Hover or tap a line for the numbers."),
          h("div", { class: "controls" },
            h("div", { class: "seg", role: "group", "aria-label": "Lane direction", id: "lane-dir" },
              ...[["both", "Both ways"], ["out", "Moving out"], ["in", "Moving in"]].map(([v, t]) =>
                h("button", { type: "button", "data-dir": v, "aria-pressed": String(v === laneDir) }, t))),
            h("label", null, h("input", { type: "checkbox", id: "long-only", checked: longOnly }), " 100+ miles only")),
          ref("lg-lanes", "legend"), ref("map", "map-wrap"),
          h("div", { class: "tbl-wrap" }, h("table", { id: "lanes-table" },
            h("thead", null, h("tr", null, h("th", null, "Lane"), h("th", { class: "n" }, "Households moving out"),
              h("th", { class: "n" }, "Households moving in"), h("th", { class: "n" }, "Out minus in"), h("th", { class: "n" }, "Miles"))),
            h("tbody"))),
          h("p", { class: "foot" }, "IRS county-to-county moves of tax filers, 2022 to 2023, added up to metros. The IRS hides county pairs with fewer than 20 returns, so small lanes are undercounted. A large positive “out minus in” means trucks heading there often come back light.")),
        roundTripPanel())),
    section("s-competition", "Competition", "Licensed household-goods movers based in the metro",
      h("div", { class: "tiles", id: "comp-tiles", style: "margin-top:0" }),
      h("div", { class: "grid", style: "margin-top:14px" },
        panel("w6", "Movers by fleet size", "Number of movers by trucks (power units) on their federal filing", ref("ch-fleet")),
        panel("w6", "Where the revenue comes from", h("span", { id: "sub-rev" }, "Moving company revenue by type of move, 2022 Economic Census"),
          ref("ch-rev"), foot("ft-rev")),
        panel("w12", "Largest movers based here", "Ranked by trucks. Safety columns come from FMCSA roadside inspections and crashes over the last two years.",
          h("div", { class: "tbl-wrap" }, h("table", { id: "movers-table" },
            h("thead", null, h("tr", null, ...["Mover", "Based in", "Trucks", "Drivers", "Authority", "Since", "Inspections", "Vehicle out of service", "Crashes"]
              .map((t, i) => h("th", { class: i >= 2 && i !== 4 ? "n" : "" }, t)))), h("tbody"))),
          h("div", { class: "more" }, h("button", { class: "btn", type: "button", id: "movers-more" }, "Show all")),
          foot("ft-movers")),
        panel("w12", "Largest movers in the U.S.", "The van lines and national fleets that local movers compete with or haul for, ranked by trucks on their federal filing",
          h("div", { class: "tbl-wrap" }, h("table", { id: "national-table" },
            h("thead", null, h("tr", null, h("th", { class: "n" }, "#"), h("th", null, "Mover"), h("th", null, "Headquarters"),
              h("th", { class: "n" }, "Trucks"), h("th", { class: "n" }, "Drivers"), h("th", { class: "n" }, "Since"))), h("tbody"))),
          h("p", { class: "foot" }, "Van lines report the owner-operators who haul under their authority, so their fleets are counted at headquarters. Carriers based outside a metro area are not listed.")))),
    section("s-labor", "Labor & costs", "What it costs to hire crews and run trucks here",
      h("div", { class: "grid" },
        panel("w6", "Average weekly pay by industry, 2025", "Moving companies compete with these employers for drivers and helpers",
          ref("ch-wages"), foot("ft-wages")),
        panel("w6", h("span", { id: "diesel-title" }, "Diesel price per gallon"), "Weekly retail on-highway diesel, since 2022",
          ref("lg-diesel", "legend"), ref("ch-diesel", "chart"), foot("ft-diesel")),
        panel("w4", "Price index for moving services", "What U.S. movers charge, Dec 2003 = 100", ref("ch-ppi", "chart"), foot("ft-ppi")),
        panel("w4", "30-year mortgage rate", "Higher rates keep owners in place, which slows moves", ref("ch-mort", "chart"), foot("ft-mort")),
        panel("w4", "Moving industry jobs, U.S.", "Employees at moving companies, thousands", ref("ch-emp", "chart"), foot("ft-emp")),
        panel("w12", h("span", { id: "gov-title" }, "Federal moving contracts"), "Direct federal contracts coded as household and office moving, fiscal year 2025",
          h("div", { class: "pair", id: "gov-pair" }),
          h("div", { class: "tbl-wrap" }, h("table", { id: "gov-table" },
            h("thead", null, h("tr", null, h("th", null, "Contractor"), h("th", { class: "n" }, "Obligated, FY2025"))), h("tbody"))),
          h("p", { class: "foot" }, "Source: USAspending.gov, place of performance. Most military household-goods moves are booked through the Defense Department's Tender of Service program and do not show up here.")))));
}

// ---------------------------------------------------------------------------------------------
function tile(label: string, value: string, note?: string, extra?: Child) {
  return h("div", { class: "tile" }, h("span", { class: "t-label" }, label), h("span", { class: "t-value" }, value), extra || null,
    note ? h("span", { class: "t-note" }, note) : null);
}
export function deltaSpan(v: number | null | undefined, opts: { upIsGood?: boolean; neutral?: boolean; fmt?: (v: number) => string } = {}) {
  if (v == null) return h("span", { class: "delta flat" }, "–");
  const up = v > 0.0005, down = v < -0.0005;
  const good = opts.upIsGood === false ? down : up;
  const cls = opts.neutral || (!up && !down) ? "flat" : good ? "up" : "down";
  return h("span", { class: "delta " + cls }, (up ? "▲ " : down ? "▼ " : "") + (opts.fmt ? opts.fmt(v) : fmtSignedPct(v)));
}

const monthRangeLabel = (ms: string[]) => monthLabel(ms[0]).split(" ")[0] + "–" + monthLabel(ms[ms.length - 1]);

function fillForecast(m: MetroDetail, ctx: Ctx) {
  const fc = m.fc, F = ctx.N.fc;
  const box = $("#fc-panel");
  if (!fc || !F) {
    box.replaceChildren(h("h3", null, "Outlook: next 90 days"), h("p", { class: "sub" }, "No forecast for this metro: Zillow doesn't publish monthly housing data for it."));
    return;
  }
  const what = fc.src === "sales" ? "home sales" : "new listings";
  const dir = fc.g == null ? "flat" : fc.g > 0.02 ? "up" : fc.g < -0.02 ? "down" : "flat";
  box.replaceChildren(
    h("p", { class: "eyebrow-dark" }, "Forecast · " + monthRangeLabel(fc.m)),
    h("h3", { class: "fc-head" }, fc.mv ? "About " + fmtInt(fc.mv) + " household moves" : "Housing activity " + (dir === "up" ? "rising" : dir === "down" ? "falling" : "steady")),
    ...(fc.mv ? [h("p", { class: "fc-range" }, "Likely range " + fmtInt(fc.mvlo) + " to " + fmtInt(fc.mvhi))] : []),
    h("div", { class: "fc-row" },
      h("div", null, h("span", { class: "p-label" }, "vs the same months last year"), h("span", { class: "fc-big" }, deltaSpan(fc.g)),
        h("span", { class: "p-note" }, "range " + fmtSignedPct(fc.glo) + " to " + fmtSignedPct(fc.ghi))),
      h("div", null, h("span", { class: "p-label" }, "Last three months"), h("span", { class: "fc-big" }, deltaSpan(fc.r3)),
        h("span", { class: "p-note" }, what + " vs a year earlier"))),
    h("p", { class: "sub fc-read" }, dir === "up" ? `More ${what} are expected than last fall, so plan crews and trucks for a busier stretch than last year.`
      : dir === "down" ? `Fewer ${what} are expected than a year ago. Expect more price shopping and competition for each job.`
        : `Expect about the same volume as the same months last year.`),
    h("p", { class: "foot" }, `Accuracy check: tested on ${fmtInt(F.n)} past forecasts, it was off by ${F.mae.toFixed(1)}% on average (simple “recent trend continues”: ${F.mae_trend.toFixed(1)}%). The range held the actual result 8 times in 10. `,
      h("a", { href: "#/methods" }, "How it works")));
}

function fillStatic(m: MetroDetail, ctx: Ctx) {
  const N = ctx.N, B = N.bench, k = m.k || {};
  const dz = N.diesel[m.dz], dv = dz ? dz.v : [];
  const dLast = dv[dv.length - 1], dYago = dv[dv.length - 53];
  const win = monthLabel(N.zm[N.zm.length - 3]).split(" ")[0] + "–" + monthLabel(N.last_month);
  $("#tiles").replaceChildren(
    tile("Household moves a year", m.hhm ? fmtCompact(m.hhm) : "–", "Estimate from 2024 Census survey"),
    tile("Net moves from rest of U.S., 2025", fmtSigned(m.dm[4]), m.dmr == null ? "" : (m.dmr > 0 ? "+" : "") + m.dmr.toFixed(1) + " per 1,000 residents"),
    tile("Home sales, " + win, k.s3 == null ? "–" : fmtSignedPct(k.s3), k.s3 == null ? "Zillow doesn't publish sales here" : "vs same months last year"),
    tile("New listings, " + win, k.n3 == null ? "–" : fmtSignedPct(k.n3), k.n3 == null ? "Not available" : "vs same months last year"),
    tile("Movers based here", fmtInt(m.fm.n), fmtInt(m.fm.i) + " licensed for interstate moves"),
    tile("Diesel, " + (dz ? shortRegion(dz.name) : ""), dLast == null ? "–" : "$" + (dLast as number).toFixed(2),
      "per gallon, week of " + dateLabel(N.weeks[N.weeks.length - 1]),
      dLast != null && dYago != null ? h("span", null, deltaSpan((dLast as number) / (dYago as number) - 1, { upIsGood: false }), h("span", { class: "t-note" }, " vs a year ago")) : null),
    ...(m.fc?.mv ? [tile("Moves expected, next 90 days", fmtCompact(m.fc.mv), `Likely ${fmtCompact(m.fc.mvlo)}–${fmtCompact(m.fc.mvhi)}, ${monthRangeLabel(m.fc.m)}`,
      m.fc.g == null ? null : h("span", null, deltaSpan(m.fc.g), h("span", { class: "t-note" }, " vs same months last year")))] : []));

  $("#ins-title").textContent = "What stands out in " + m.n;
  $("#insights").replaceChildren(...insights(m, N, ctx.byCode).map((x, i) =>
    h("li", null, h("span", { class: "badge", "aria-hidden": "true" }, String(i + 1)),
      h("div", null, h("strong", null, x.lead), h("span", { class: "txt" }, x.text)))));

  // score breakdown + ranks
  const W = weights();
  const tot = COMP.reduce((s, c) => s + (W[c.k] || 0), 0) || 1;
  $("#meters").replaceChildren(...COMP.map((c) => {
    const v = m.sc[c.k];
    return h("div", { class: "meter" },
      h("span", { class: "m-name" }, c.name, " ", h("span", { class: "m-w" }, Math.round(((W[c.k] || 0) / tot) * 100) + "%")),
      h("span", { class: "m-val" }, v == null ? "–" : String(Math.round(v))),
      h("div", { class: "m-track", role: "img", "aria-label": c.name + " " + (v == null ? "not available" : Math.round(v) + " out of 100") },
        h("div", { class: "m-fill", style: "width:" + (v ?? 0) + "%" })),
      h("span", { class: "m-help" }, c.help));
  }));
  const r = rank(m.c);
  const within = (pred: (x: MetroIndexRow) => boolean) => {
    const xs = ctx.index.filter((x) => pred(x) && rank(x.c) != null).sort((a, b) => (rank(a.c) as number) - (rank(b.c) as number));
    return [xs.findIndex((x) => x.c === m.c) + 1, xs.length];
  };
  const idx = ctx.byCode.get(m.c) as MetroIndexRow, sc = sizeClass(idx);
  const [rs, ns] = within((x) => sizeClass(x) === sc), [rt, nt] = within((x) => x.s === m.s);
  $("#ranks").replaceChildren(...(r ? [
    h("li", null, h("b", null, ordinal(r)), ` of ${rankedCount()} U.S. metros`),
    h("li", null, h("b", null, ordinal(rs)), ` of ${ns} ${SIZE_NAMES[sc]}`),
    ...(nt > 1 ? [h("li", null, h("b", null, ordinal(rt)), ` of ${nt} metros based in ${stateNameBare(m.s)}`)] : []),
  ] : []));

  // demand: origins + IRS
  const a = m.acs;
  hbars($("#ch-origins"), [
    { label: "Moved within the same county", value: a.wc }, { label: "From elsewhere in the state", value: a.ds },
    { label: "From another state", value: a.dst }, { label: "From abroad", value: a.ab }]);
  $("#ft-origins").textContent = `Total ${fmtInt(a.mv)} people, ${fmtPct(a.mv / a.pop1, 1)} of residents${a.mv23 ? ` (2023: ${fmtInt(a.mv23)})` : ""}. ${fmtInt(a.hh)} households, ${fmtPct(a.rent / a.hh)} renting. Census American Community Survey, 1-year.`;
  const ir = m.irs;
  const pc = (now: number, prev: number | null) => (prev ? h("span", { class: "p-note" }, deltaSpan(now / prev - 1, { neutral: true }), " vs 2021–22") : null);
  const pair = (label: string, value: string, note: Child) => h("div", null, h("div", { class: "p-label" }, label), h("div", { class: "p-val" }, value), note);
  $("#irs-pair").replaceChildren(
    pair("Moved in", fmtInt(ir.in), pc(ir.in, ir.pin)),
    pair("Moved out", fmtInt(ir.out), pc(ir.out, ir.pout)),
    pair("Net", fmtSigned(ir.net), h("span", { class: "p-note" }, "households")),
    pair("Avg income, arriving", fmtMoney(ir.ia), h("span", { class: "p-note" }, "U.S. metro median " + fmtMoney(B.ia))),
    pair("Avg income, leaving", fmtMoney(ir.oa), h("span", { class: "p-note" }, "per tax return")),
    pair("Moved between counties inside the metro", fmtInt(ir.wm), h("span", { class: "p-note" }, "local moves, shown county pairs only")));

  // competition
  const fm = m.fm, ec = m.ec || {}, q = m.q || {};
  $("#comp-tiles").replaceChildren(
    tile("Household-goods movers", fmtInt(fm.n), `${fmtInt(fm.i)} interstate, ${fmtInt(fm.x)} in-state only, ${fmtInt(fm.pu)} trucks in all`),
    tile("Household moves per mover", m.mpc ? fmtInt(m.mpc) : "–", "Typical metro: " + fmtInt(B.mpc)),
    tile("New movers, last 2 years", fmtInt(fm.new), "Registered since October 2024"),
    tile("Moving companies with payroll", q["484210"] ? fmtInt(q["484210"][0]) : "–", "Locations, 2025 (BLS)"),
    tile("Moving revenue, 2022", ec.rev ? fmtMoneyK(ec.rev) : "–", ec.rev ? `Economic Census, ${fmtInt(ec.est)} locations` : "Not published for this metro"),
    tile("Self-storage locations", q["531130"] ? fmtInt(q["531130"][0]) : "–", "Operators with payroll, 2025 (BLS)"));
  hbars($("#ch-fleet"), [
    { label: "1 truck", value: fm.sz[0] }, { label: "2–5 trucks", value: fm.sz[1] }, { label: "6–20 trucks", value: fm.sz[2] },
    { label: "21–100 trucks", value: fm.sz[3] }, { label: "Over 100 trucks", value: fm.sz[4] }]);
  if (ec.rev) {
    hbars($("#ch-rev"), [
      { label: "Long-distance", value: ec.ld, missing: "Withheld" }, { label: "Local, with storage", value: ec.lw, missing: "Withheld" },
      { label: "Local, no storage", value: ec.ln, missing: "Withheld" }], { fmt: fmtMoneyK, max: Math.max(ec.ld || 0, ec.lw || 0, ec.ln || 0) || 1 });
    const us = N.us.econ;
    $("#ft-rev").textContent = `Total ${fmtMoneyK(ec.rev)} across ${fmtInt(ec.est)} locations. Nationally, long-distance work is ${fmtPct(us.ld / us.rev)} of moving revenue. Revenue is counted where each company is based, so van line agents' long-distance work lands in their home metro.`;
  } else {
    $("#ch-rev").replaceChildren(h("p", { class: "sub", style: "margin-top:14px" },
      "The 2022 Economic Census does not publish moving revenue for this metro, usually because too few companies would be identifiable." + (ec.srev ? " Statewide revenue: " + fmtMoneyK(ec.srev) + "." : "")));
    $("#ft-rev").textContent = "";
  }
  let showAll = false;
  const renderMovers = () => {
    const rows = showAll ? m.top : m.top.slice(0, 12);
    $("#movers-table tbody").replaceChildren(...(rows.length ? rows.map((t: any[]) => {
      const [name, cityName, st, pu, dr, inter, yr, dot, vi, vo, , , cr, , it] = t;
      const rate = vi ? vo / vi : null, small = !vi || vi < 5;
      return h("tr", null,
        h("td", null, name || "Name withheld", h("div", { class: "mono muted" }, "USDOT " + dot)),
        h("td", null, cityName + ", " + st), h("td", { class: "n" }, fmtInt(pu)), h("td", { class: "n" }, fmtInt(dr)),
        h("td", null, h("span", { class: "tag" }, inter ? "Interstate" : "In-state only")),
        h("td", { class: "n" }, sinceLabel(yr)), h("td", { class: "n" }, it == null ? "0" : fmtInt(it)),
        h("td", { class: "n" + (small ? " dim" : "") }, rate == null ? "No inspections" : fmtPct(rate) + " of " + fmtInt(vi)),
        h("td", { class: "n" }, cr == null ? "–" : fmtInt(cr)));
    }) : [h("tr", null, h("td", { colspan: 9, class: "dim" }, "No household-goods movers with a federal filing are based in this metro."))]));
    const more = $("#movers-more") as HTMLButtonElement;
    more.hidden = m.top.length <= 12;
    more.textContent = showAll ? "Show fewer" : "Show all " + m.top.length;
    $("#ft-movers").textContent = `Typical vehicle out-of-service rate for movers in this tool: ${fmtPct(B.voos)} (${fmtInt(B.voos_n)} movers with 5 or more vehicle inspections). Rates on fewer than 5 inspections are grayed out. “≤1974” means on file since FMCSA's records begin. Source: FMCSA carrier census and SMS files.`;
  };
  ($("#movers-more") as HTMLButtonElement).onclick = () => { showAll = !showAll; renderMovers(); };
  renderMovers();
  $("#national-table tbody").replaceChildren(...(N.us.top as any[][]).map((t, i) => h("tr", null,
    h("td", { class: "n" }, String(i + 1)), h("td", null, t[0], h("div", { class: "mono muted" }, "USDOT " + t[6])),
    h("td", null, t[1] + ", " + t[2]), h("td", { class: "n" }, fmtInt(t[3])), h("td", { class: "n" }, fmtInt(t[4])), h("td", { class: "n" }, sinceLabel(t[5])))));

  // labor: wages with statewide fallback
  let usedState = false;
  const wageOf = (code: string) => {
    if (q[code]?.[2]) return { v: q[code][2] as number, state: false };
    const s = (q.st || {})[code];
    return s?.[2] ? { v: s[2] as number, state: true } : { v: null, state: false };
  };
  hbars($("#ch-wages"), [["484210", "Moving companies"], ["4841", "General freight trucking"], ["493110", "Warehousing and storage"],
    ["4921", "Couriers and delivery"], ["531130", "Self-storage operators"], ["10", "All private employers"]].map(([code, label], i) => {
    const w = wageOf(code);
    if (w.state) usedState = true;
    return { label: w.state ? h("span", null, label, h("small", null, stateNameBare(m.s) + " average")) : label, value: w.v, muted: i > 0 };
  }), { fmt: (v) => fmtMoney(v) });
  $("#ft-wages").textContent = "BLS Quarterly Census of Employment and Wages, 2025 annual averages for private employers." +
    (usedState ? " Where BLS withheld the metro figure to protect individual employers, the statewide average is shown and labeled." : "");

  // federal contracts
  const g25 = N.gov.state25[m.s], g24 = N.gov.state24[m.s];
  $("#gov-title").textContent = "Federal moving contracts performed in " + stateName(m.s);
  $("#gov-pair").replaceChildren(
    pair("FY2025, " + m.s, g25 == null ? "$0" : fmtMoneyC(g25), g24 ? h("span", { class: "p-note" }, "FY2024: " + fmtMoneyC(g24)) : null),
    pair("FY2025, all states", fmtMoneyC(N.gov.fy["2025"]), h("span", { class: "p-note" }, "FY2026 so far: " + fmtMoneyC(N.gov.fy["2026"]) + ", still being reported")));
  const recs = (N.gov.rec25[m.s] || []).filter((x: [string, number]) => x[1] > 0);
  $("#gov-table tbody").replaceChildren(...(recs.length ? recs.map((x: [string, number]) => h("tr", null, h("td", null, x[0]), h("td", { class: "n" }, fmtMoney(x[1]))))
    : [h("tr", null, h("td", { colspan: 2, class: "dim" }, "No federal moving contract spending was reported in this state for FY2025."))]));

  // lane controls
  document.querySelectorAll<HTMLButtonElement>("#lane-dir [data-dir]").forEach((b) => b.addEventListener("click", () => {
    laneDir = b.dataset.dir as LaneDir;
    document.querySelectorAll("#lane-dir [data-dir]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    void drawLanes(m, ctx);
  }));
  ($("#long-only") as HTMLInputElement).addEventListener("change", (e) => { longOnly = (e.target as HTMLInputElement).checked; void drawLanes(m, ctx); });
}

let laneDir: LaneDir = "both";
let longOnly = true;

async function drawLanes(m: MetroDetail, ctx: Ctx) {
  const topo = await loadStates();
  const lanes = drawLanesMap($("#map"), m, ctx.byCode, topo, laneDir, longOnly);
  const s1 = cssVar("--s1"), s2 = cssVar("--s2");
  legend($("#lg-lanes"), [{ name: "Moving out of " + city(m.n), color: s2 }, { name: "Moving in", color: s1 }]
    .filter((_, i) => laneDir === "both" || (laneDir === "out" ? i === 0 : i === 1)));
  const pairs = new Map<string, { code: string; out: number | null; inn: number | null; miles: number }>();
  for (const { dir, l } of lanes as DrawnLane[]) {
    const p = pairs.get(l[0]) || { code: l[0], out: null, inn: null, miles: l[3] };
    if (dir === "out") { p.out = l[1]; if (p.inn == null) p.inn = l[2]; } else { p.inn = l[1]; if (p.out == null) p.out = l[2]; }
    pairs.set(l[0], p);
  }
  const rows = [...pairs.values()].sort((a, b) => (b.out || 0) + (b.inn || 0) - ((a.out || 0) + (a.inn || 0)));
  $("#lanes-table tbody").replaceChildren(...(rows.length ? rows.map((p) => {
    const o = ctx.byCode.get(p.code);
    const gap = p.out == null || p.inn == null ? null : p.out - p.inn;
    return h("tr", null, h("td", null, city(m.n) + " ↔ " + (o ? o.n : p.code)), h("td", { class: "n" }, fmtInt(p.out)),
      h("td", { class: "n" }, fmtInt(p.inn)), h("td", { class: "n" }, gap == null ? "–" : fmtSigned(gap)), h("td", { class: "n" }, fmtInt(p.miles)));
  }) : [h("tr", null, h("td", { colspan: 5, class: "dim" }, "No lanes above the IRS reporting threshold for this filter. Try turning off 100+ miles only."))]));
  $("#lanes-title").textContent = "Top lanes for " + m.n;
}

async function drawCharts(m: MetroDetail, ctx: Ctx) {
  const N = ctx.N;
  const s1 = cssVar("--s1"), s2 = cssVar("--s2"), muted = cssVar("--muted"), neg = cssVar("--neg");
  const toDate = (s: string) => new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, s.length > 7 ? +s.slice(8, 10) : 1);
  const z = m.z;
  if (z) {
    const series = [] as { name: string; color: string; values: (number | null)[] }[];
    if (z.s) series.push({ name: "Home sales", color: s1, values: z.s });
    series.push({ name: "New listings", color: s2, values: z.nl });
    legend($("#lg-housing"), series);
    lineChart($("#ch-housing"), { x: N.zm.map(toDate), series, yFmt: (v) => fmtCompact(v), tipFmt: (v) => fmtInt(v),
      xLabel: (i) => monthLabel(N.zm[i]), label: "Monthly home sales and new listings", height: 240 });
    $("#ft-housing").textContent = "Zillow Research, through " + monthLabel(N.last_month) + ". Last 12 months: " +
      (m.k.s12 ? fmtInt(m.k.s12) + " sales, " : "") + (m.k.n12 ? fmtInt(m.k.n12) + " new listings." : "") +
      (z.s ? "" : " Zillow publishes sales counts only for about 300 larger metros.");
  } else {
    $("#lg-housing").replaceChildren();
    $("#ch-housing").replaceChildren(h("p", { class: "sub", style: "margin-top:14px" }, "Zillow has no matching metro for this area. Its older metro boundaries fold this area into a neighboring metro."));
    $("#ft-housing").textContent = "";
  }
  const seas: number[] | undefined = m.k?.seas;
  if (seas) {
    const top3 = seas.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0]).slice(0, 3).map((x) => x[1]);
    columnChart($("#ch-season"), { labels: MONTHS.map((x) => x[0]), values: seas, fmt: (v) => fmtPct(v), label: "Share of yearly home sales by month",
      colorOf: (_, i) => (top3.includes(i) ? s1 : cssVar("--bar-muted")), labelIf: (_, i) => top3.includes(i), tipLabel: (i) => MONTHS_LONG[i], height: 190 });
    $("#sub-season").textContent = "Average share of a year's home " + (m.k.seas_src === "sales" ? "sales" : "new listings") + " by month, 2019–2025";
    $("#ft-season").textContent = "The three busiest months are highlighted.";
  } else {
    $("#ch-season").replaceChildren(h("p", { class: "sub", style: "margin-top:14px" }, "Not enough monthly data for this metro."));
    $("#ft-season").textContent = "";
  }
  drawForecast(m, ctx, s1, s2);
  columnChart($("#ch-mig"), { labels: ["2021", "2022", "2023", "2024", "2025"], values: m.dm, fmt: (v) => fmtSigned(v),
    label: "Net domestic migration by year", colorOf: (v) => (v >= 0 ? s1 : neg), height: 190 });
  $("#ft-mig").textContent = `Census population estimates, Vintage 2025 (years ending July 1). Population ${fmtInt(m.pop[0])} in 2020, ${fmtInt(m.pop[5])} in 2025 (${fmtSignedPct((m.pop[5] as number) / (m.pop[0] as number) - 1)}).`;
  await drawLanes(m, ctx);

  const dz = N.diesel[m.dz], us = N.diesel.NUS;
  const dser = [{ name: shortRegion(dz.name), color: s1, values: dz.v }] as { name: string; color: string; values: (number | null)[]; width?: number; noDot?: boolean }[];
  if (m.dz !== "NUS") dser.push({ name: "U.S. average", color: muted, values: us.v, width: 1.5, noDot: true });
  legend($("#lg-diesel"), dser);
  lineChart($("#ch-diesel"), { x: N.weeks.map(toDate), series: dser, yFmt: (v, exact) => "$" + (exact ? v.toFixed(3) : v.toFixed(2)),
    xLabel: (i) => "Week of " + dateLabel(N.weeks[i]), label: "Weekly diesel price", height: 220 });
  $("#diesel-title").textContent = "Diesel price per gallon, " + shortRegion(dz.name);
  $("#ft-diesel").textContent = `U.S. Energy Information Administration, through the week of ${dateLabel(N.weeks[N.weeks.length - 1])}. Regional prices are for EIA's fuel regions; this metro's state uses ${shortRegion(dz.name)}.`;
  const P = N.prices;
  lineChart($("#ch-ppi"), { x: P.ppi.m.map(toDate), series: [{ name: "Moving services price index", color: s1, values: P.ppi.v, area: true }],
    yFmt: (v) => String(Math.round(v)), tipFmt: (v) => v.toFixed(1), xLabel: (i) => monthLabel(P.ppi.m[i]), label: "Producer price index for moving", height: 170, left: 38 });
  const pv = P.ppi.v as number[];
  $("#ft-ppi").textContent = `${monthLabel(P.ppi.m[P.ppi.m.length - 1])}: ${pv[pv.length - 1].toFixed(1)}, ${fmtSignedPct(pv[pv.length - 1] / pv[pv.length - 13] - 1)} from a year earlier. BLS producer price index for used household and office goods moving.`;
  lineChart($("#ch-mort"), { x: P.mort.m.map(toDate), series: [{ name: "30-year fixed rate", color: s1, values: P.mort.v, area: true }],
    yFmt: (v, exact) => (exact ? v.toFixed(2) + "%" : v.toFixed(0) + "%"), xLabel: (i) => monthLabel(P.mort.m[i]) + " average", label: "30-year mortgage rate", height: 170, left: 38 });
  $("#ft-mort").textContent = `Week of ${dateLabel(P.mort_last[0])}: ${P.mort_last[1].toFixed(2)}%, against ${P.mort_yago[1].toFixed(2)}% a year earlier. Freddie Mac survey, monthly averages.`;
  const ev = P.emp.v as number[];
  lineChart($("#ch-emp"), { x: P.emp.m.map(toDate), series: [{ name: "Employees (thousands)", color: s1, values: ev, area: true }],
    yFmt: (v) => Math.round(v) + "K", tipFmt: (v) => v.toFixed(1) + "K", xLabel: (i) => monthLabel(P.emp.m[i]), label: "U.S. moving industry employment", height: 170, left: 38 });
  $("#ft-emp").textContent = `${monthLabel(P.emp.m[P.emp.m.length - 1])}: ${ev[ev.length - 1].toFixed(1)} thousand, ${fmtSignedPct(ev[ev.length - 1] / ev[ev.length - 13] - 1)} from a year earlier (preliminary). BLS Current Employment Statistics.`;
}

function drawForecast(m: MetroDetail, ctx: Ctx, s1: string, s2: string) {
  const fc = m.fc, N = ctx.N;
  if (!fc || !m.z) { $("#ch-fc").replaceChildren(h("p", { class: "sub", style: "margin-top:14px" }, "No forecast for this metro.")); $("#lg-fc").replaceChildren(); return; }
  const src = fc.src === "sales" ? (m.z.s as (number | null)[]) : m.z.nl;
  const back = 21, start = Math.max(0, N.zm.length - back);
  const hist = N.zm.slice(start), months = [...hist, ...fc.m];
  const toDate = (s: string) => new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, 1);
  const nh = hist.length, lastActual = src[N.zm.length - 1];
  const actual = [...src.slice(start), null, null, null];
  const fcst = months.map((_, i) => (i === nh - 1 ? lastActual : i >= nh ? fc.f[i - nh] : null));
  const lo = months.map((_, i) => (i === nh - 1 ? lastActual : i >= nh ? fc.lo[i - nh] : null));
  const hi = months.map((_, i) => (i === nh - 1 ? lastActual : i >= nh ? fc.hi[i - nh] : null));
  const ly = months.map((_, i) => (i >= nh ? fc.ly[i - nh] : null));
  const what = fc.src === "sales" ? "Home sales" : "New listings";
  const muted = cssVar("--muted");
  const series = [
    { name: what + ", actual", color: s1, values: actual },
    { name: "Forecast", color: s2, values: fcst, dash: "5 4" },
    { name: "Same months last year", color: muted, values: ly, width: 1.5, noDot: true },
  ];
  legend($("#lg-fc"), [...series, { name: "Likely range (80%)", color: s2 }].map((x, i) => ({ name: x.name, color: x.color, dot: i === 3 })));
  lineChart($("#ch-fc"), {
    x: months.map(toDate), series, band: { lo, hi, color: s2 }, yFmt: (v) => fmtCompact(v), tipFmt: (v) => fmtInt(v),
    xLabel: (i) => monthLabel(months[i]) + (i >= nh ? " (forecast)" : ""), label: "Monthly home sales with a three-month forecast", height: 240,
  });
  $("#fc-title").textContent = "Outlook for " + city(m.n) + ": the next three months";
  $("#fc-sub").textContent = "Monthly " + what.toLowerCase() + ", with the forecast and its likely range";
  $("#ft-fc").textContent = `Forecast made from data through ${monthLabel(N.fc.origin)}, using recent sales, new listings, mortgage rates and the national trend. Moves follow closings, so home sales track move demand closely. Zillow Research data.` +
    (fc.src === "listings" ? " Zillow doesn't publish sales counts here, so this forecast uses new listings." : "");
}

// ---------------------------------------------------------------------------------------------
function lockedView(el: HTMLElement, ctx: Ctx, idx: MetroIndexRow) {
  const mine = ctx.session.markets.map((c) => ctx.byCode.get(c)).filter(Boolean) as MetroIndexRow[];
  el.replaceChildren(h("section", { class: "block" },
    h("div", { class: "grid" },
      h("div", { class: "panel w7 locked-panel" },
        h("p", { class: "eyebrow-dark" }, "Not in your plan"),
        h("h2", { class: "locked-title" }, idx.n),
        h("p", { class: "lead" }, `Your plan covers ${mine.length === 1 ? "one market" : mine.length + " markets"}. Add ${idx.n} to see its demand, long-distance lanes, the movers you'd compete with, and local pay and costs.`),
        h("div", { class: "pair" },
          h("div", null, h("div", { class: "p-label" }, "Household moves a year"), h("div", { class: "p-val" }, idx.hhm ? fmtCompact(idx.hhm) : "–")),
          h("div", null, h("div", { class: "p-label" }, "Opportunity rank"), h("div", { class: "p-val" }, rank(idx.c) ? `${ordinal(rank(idx.c) as number)} of ${rankedCount()}` : "–")),
          h("div", null, h("div", { class: "p-label" }, "Movers based here"), h("div", { class: "p-val" }, fmtInt(idx.movers)))),
        h("p", { class: "foot" }, ctx.ds.demo ? "In the demo, switch to the admin view at the top to see every market."
          : "Ask your account manager to add this market to your plan.")),
      h("div", { class: "panel w5" },
        h("h3", null, "Markets in your plan"),
        mine.length ? h("ul", { class: "plain-list" }, ...mine.map((x) => h("li", null, h("a", { href: "#/market/" + x.c }, x.n))))
          : h("p", { class: "sub" }, "No markets yet.")))));
}
