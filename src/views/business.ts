// Your business: the client's own jobs set against the public data for their home market.
import { drawPlan, planSections } from "./plan";
import type { Ctx } from "../app";
import type { Job, MetroDetail } from "../data/types";
import { $, h, cssVar, type Child } from "../lib/dom";
import { fmtCompact, fmtInt, fmtMoney, fmtMoneyC, fmtPct, fmtSignedPct, monthLabel, MONTHS, MONTHS_LONG } from "../lib/format";
import { tipRow } from "../lib/tooltip";
import { hbars } from "../charts/hbars";
import { lineChart } from "../charts/line";
import { columnChart } from "../charts/columns";
import { legend } from "../charts/legend";
import { addMonths, summarize, type BusinessSummary } from "../business/analytics";
import { businessInsights } from "../business/insights";
import { jobsToCsv, parseJobsCsv, TEMPLATE_COLUMNS, TEMPLATE_CSV, type ParseResult } from "../business/jobs";
import { city } from "../market/geo";
import { deltaSpan } from "./snapshot";
import type { DemoSource } from "../data/demo";

let redraw: AbortController | null = null;
let pending: { file: string; result: ParseResult } | null = null;
let flash: { kind: "ok" | "error"; text: string } | null = null;
const MAX_BYTES = 25 * 1024 * 1024;

export async function businessView(el: HTMLElement, ctx: Ctx) {
  redraw?.abort();
  const org = ctx.session.org;
  if (!org) {
    return message(el, "Your login isn't linked to a company yet", ctx.session.isAdmin
      ? "This page shows a client company's own jobs against its market. Admins aren't part of a client company, so there's nothing to show here."
      : "Sign out and back in, then enter the invite code from your account manager.");
  }
  const homeCode = org.home_cbsa;
  if (!homeCode || !ctx.byCode.has(homeCode)) {
    return message(el, "Your company doesn't have a home market yet", ctx.session.isAdmin
      ? "Set a home market for this company on the Admin page." : "Ask your account manager to set your home market.");
  }
  const [jobs, home] = await Promise.all([ctx.ds.jobs(), ctx.detail(homeCode)]);
  if (!home) {
    return message(el, "Your home market isn't in your plan", `Ask your account manager to add ${ctx.byCode.get(homeCode)?.n} to your plan.`);
  }
  const s = summarize(jobs, home, ctx.N, ctx.byCode);
  el.replaceChildren(s ? filledLayout(ctx, home, s, jobs) : emptyLayout(ctx, home));
  wireUpload(ctx, jobs);
  if (s) {
    const draw = () => drawCharts(ctx, home, s);
    draw();
    void drawPlan(ctx, home, s, jobs).catch(() => { /* plan panels are extras: never block the page */ });
    redraw = new AbortController();
    document.addEventListener("mmi:redraw", () => { if ($("#b-overview")) draw(); }, { signal: redraw.signal });
  }
}

// ---------------------------------------------------------------------------------------------
function message(el: HTMLElement, title: string, text: string) {
  el.replaceChildren(h("section", { class: "block" }, h("div", { class: "grid" },
    h("div", { class: "panel w12 empty-state" }, h("h2", { class: "locked-title" }, title), h("p", { class: "lead" }, text)))));
}
const panel = (cls: string, title: Child, sub: Child, ...body: Child[]) =>
  h("div", { class: "panel " + cls }, h("h3", null, title), sub ? h("p", { class: "sub" }, sub) : null, ...body);
const section = (id: string, title: string, sub: string, ...body: Child[]) =>
  h("section", { class: "block", id }, h("div", { class: "sec-head" }, h("h2", null, title), h("p", null, sub)), ...body);
const ref = (id: string, cls = "") => h("div", { id, class: cls });
const foot = (id: string, text = "") => h("p", { class: "foot", id }, text);
const tile = (label: string, value: string, note?: Child) =>
  h("div", { class: "tile" }, h("span", { class: "t-label" }, label), h("span", { class: "t-value" }, value), note ? h("span", { class: "t-note" }, note) : null);
const win = (s: BusinessSummary) => monthLabel(s.windowStart) + " – " + monthLabel(s.windowEnd);

function emptyLayout(ctx: Ctx, home: MetroDetail) {
  return h("div", null,
    h("section", { class: "block", id: "b-start" },
      h("div", { class: "grid" },
        h("div", { class: "panel w12 hero-panel" },
          h("p", { class: "eyebrow-dark" }, "Your business against your market"),
          h("h2", { class: "locked-title" }, "Upload your jobs to see how you stack up in " + city(home.n)),
          h("ul", { class: "checks" },
            h("li", null, h("b", null, "Your share of local moves. "), `How many of the ${fmtCompact(home.hhm)} household moves a year in your metro you handle.`),
            h("li", null, h("b", null, "Volume against the housing market. "), "Whether your bookings rise and fall with home sales, or lag them."),
            h("li", null, h("b", null, "Prices against the industry. "), "Your average job price next to what U.S. movers charge."),
            h("li", null, h("b", null, "Untapped long-distance lanes. "), "The busiest routes out of and into your metro, and how many of those moves you booked.")),
          h("p", { class: "foot" }, "Your jobs stay in your company's private space. See Data & methods for who can see them.")))),
    uploadSection(ctx, 0));
}

function filledLayout(ctx: Ctx, home: MetroDetail, s: BusinessSummary, jobs: Job[]) {
  const here = city(home.n);
  const growth = s.jobsPrior12 ? s.jobs12 / s.jobsPrior12 - 1 : null;
  const sample = ctx.ds.demo && jobs.length > 0 && (ctx.ds as Partial<DemoSource>).isSample?.() === true;
  return h("div", null,
    h("section", { class: "block", id: "b-overview" },
      h("div", { class: "data-strip" },
        h("p", null,
          h("b", null, fmtInt(jobs.length) + " jobs"), ` from ${monthLabel(s.firstMonth)} to ${monthLabel(s.lastMonth)}. `,
          `This page covers the latest 12 complete months, ${win(s)}.`,
          s.upcoming ? ` ${fmtInt(s.upcoming)} later jobs (future bookings or this month) aren't counted yet.` : "",
          sample ? h("span", { class: "muted" }, " These are made-up sample jobs.") : null),
        h("div", { class: "strip-actions" },
          h("a", { class: "btn", href: "#b-data", onclick: (e: Event) => { e.preventDefault(); document.getElementById("b-data")?.scrollIntoView({ behavior: "smooth" }); } }, "Upload jobs"),
          h("a", { class: "btn btn-primary", href: "#/report" }, "Monthly report"),
          h("button", { class: "btn", type: "button", onclick: () => download(jobsToCsv(jobs), fileSafe(ctx.session.org?.name || "jobs") + "-jobs.csv") }, "Download your jobs"))),
      flashBox(),
      h("div", { class: "tiles" },
        tile("Jobs, last 12 months", fmtInt(s.jobs12),
          growth == null ? "Upload 24 months to see the change" : h("span", null, deltaSpan(growth), " vs the 12 months before")),
        tile("Revenue, last 12 months", s.revenue12 == null ? "–" : fmtMoneyC(s.revenue12),
          s.avgRevenue12 == null ? "Add a revenue column to see this" : "Average job " + fmtMoney(s.avgRevenue12)),
        tile("Share of " + here + " moves", s.marketShare == null ? "–" : fmtPct(s.marketShare, 1),
          `${fmtInt(s.homeJobs12)} of about ${fmtCompact(home.hhm)} household moves a year`),
        tile("Long-distance jobs", s.longShare12 == null ? "–" : fmtPct(s.longShare12),
          s.longRevShare12 == null ? "Share of jobs with a job type" : fmtPct(s.longRevShare12) + " of your revenue"),
        tile("Win rate", s.winRate == null ? "–" : fmtPct(s.winRate),
          s.winRate == null ? "Add a status column (Completed, Booked, Lost)" : "Booked or completed, of jobs with an outcome"),
        tile("Your prices, past year", s.price?.yourChange == null ? "–" : fmtSignedPct(s.price.yourChange),
          s.price?.ppiChange == null ? "Needs revenue and 15+ months of jobs" : "Industry price index " + fmtSignedPct(s.price.ppiChange))),
      h("div", { class: "grid", style: "margin-top:14px" },
        h("div", { class: "panel w7" }, h("h3", null, "What stands out"),
          h("p", { class: "sub" }, "Your jobs read against public data for " + home.n + "."),
          h("ul", { class: "insights", id: "b-insights" })),
        panel("w5", "Jobs by type", "Last 12 months, with revenue", ref("b-types"), foot("ft-types")))),
    section("b-volume", "Volume and prices", "How your bookings and prices move against the market",
      h("div", { class: "grid" },
        h("div", { class: "panel w5 fc-panel", id: "b-outlook" }),
        panel("w7", "Your next three months", "Jobs per month, with the forecast and its likely range", ref("lg-out", "legend"), ref("ch-out", "chart"), foot("ft-out")),
        panel("w7", "Your jobs against the housing market", "Each line is scaled so its own average is 100. Compare the shape, not the height.",
          ref("lg-vol", "legend"), ref("ch-vol", "chart"), foot("ft-vol")),
        panel("w5", "Jobs per month", "Lost jobs left out. The latest 12 months are in blue.", ref("ch-jobs", "chart"), foot("ft-jobs")),
        panel("w7", "Your prices against the industry", "Your average job price and the moving price index, both set to 100 at the start",
          ref("lg-price", "legend"), ref("ch-price", "chart"), foot("ft-price")),
        panel("w5", "Busiest months: you and the market", "Share of the year's jobs and home sales falling in each month",
          ref("lg-season", "legend"), ref("ch-season-b", "chart"), foot("ft-season-b")))),
    section("b-lanes", "Long-distance lanes", "The busiest routes out of and into " + here + ", and the jobs you booked on them",
      h("div", { class: "grid" },
        h("div", { class: "panel w12" },
          h("h3", null, "Lanes 100 miles or longer"),
          h("p", { class: "sub" }, "Households a year from IRS address changes, 2022 to 2023. Your jobs are from the latest 12 months."),
          h("div", { class: "tbl-wrap" }, h("table", { id: "b-lanes-table" },
            h("thead", null, h("tr", null, h("th", null, "Lane"), h("th", { class: "n" }, "Households a year"), h("th", { class: "n" }, "Your jobs"),
              h("th", { class: "n" }, "Your share"), h("th", { class: "n" }, "Miles"))),
            h("tbody"))),
          ref("b-other-lanes"),
          h("p", { class: "foot" }, "A lane is flagged as untapped when at least 300 households a year make that move and you booked a small fraction of your usual share. Your share compares 12 months of your jobs with a year of IRS household moves, so read it as a rough gauge.")))),
    ...planSections(here),
    section("b-customers", "Customers", "Which lead sources bring the most jobs, and the biggest ones",
      h("div", { class: "grid" },
        panel("w6", "Where your jobs come from", "Lead source, last 12 months", ref("b-sources"), foot("ft-sources")),
        panel("w6", "Average job by lead source", "Revenue per job, last 12 months", ref("b-source-avg"), foot("ft-source-avg")))),
    uploadSection(ctx, jobs.length));
}

function flashBox() {
  if (!flash) return null;
  const f = flash;
  flash = null;
  return h("div", { class: "notice " + (f.kind === "ok" ? "notice-ok" : "notice-error"), role: "status" }, f.text);
}

// ---------------------------------------------------------------------------------------------
function drawCharts(ctx: Ctx, home: MetroDetail, s: BusinessSummary) {
  const N = ctx.N, here = city(home.n);
  const s1 = cssVar("--s1"), s2 = cssVar("--s2");
  const toDate = (m: string) => new Date(+m.slice(0, 4), +m.slice(5, 7) - 1, 1);

  $("#b-insights").replaceChildren(...businessInsights(s, home, N).map((x, i) =>
    h("li", null, h("span", { class: "badge", "aria-hidden": "true" }, String(i + 1)),
      h("div", null, h("strong", null, x.lead), h("span", { class: "txt" }, x.text)))));

  const totJobs = s.byType.reduce((a, x) => a + x.jobs, 0) || 1, totRev = s.byType.reduce((a, x) => a + x.revenue, 0);
  hbars($("#b-types"), s.byType.map((x) => ({ label: x.label, value: x.jobs, note: totRev ? fmtMoneyC(x.revenue) : fmtPct(x.jobs / totJobs) })), { fmt: (v) => fmtInt(v) + " jobs" });
  $("#ft-types").textContent = totRev ? `Revenue shown after the job count. ${fmtMoneyC(totRev)} in all.` : "Share of jobs shown after the count.";

  drawOutlook(ctx, home, s);

  // volume vs market
  const mo = s.monthly;
  if (mo) {
    const series = [{ name: "Your jobs", color: s1, values: mo.jobsIdx }, { name: mo.marketLabel.replace("in your metro", "in " + here), color: s2, values: mo.marketIdx }];
    legend($("#lg-vol"), series);
    const mk = home.z ? (home.z.s ?? home.z.nl) : null;
    const zi = new Map(N.zm.map((m, i) => [m, i]));
    lineChart($("#ch-vol"), {
      x: mo.months.map(toDate), series, refLine: 100, height: 240, yFmt: (v) => String(Math.round(v)),
      xLabel: (i) => monthLabel(mo.months[i]), label: "Your monthly jobs and your metro's home sales, indexed",
      tip: (i) => [
        tipRow(s1, "your jobs", mo.jobs[i] == null ? "–" : fmtInt(mo.jobs[i])),
        tipRow(s2, mo.marketLabel.replace(" in your metro", "").toLowerCase(), mk && zi.has(mo.months[i]) ? fmtInt(mk[zi.get(mo.months[i]) as number]) : "–"),
      ],
    });
    $("#ft-vol").textContent = `100 = each line's own average over the chart. Housing data from Zillow through ${monthLabel(N.last_month)}.` +
      (s.recent?.marketChange != null && s.recent.yourChange != null
        ? ` ${monthLabel(s.recent.from).split(" ")[0]}–${monthLabel(s.recent.to)}: your jobs ${fmtSignedPct(s.recent.yourChange)}, market ${fmtSignedPct(s.recent.marketChange)} vs a year earlier.` : "");
  } else {
    $("#lg-vol").replaceChildren();
    $("#ch-vol").replaceChildren(h("p", { class: "sub", style: "margin-top:14px" },
      home.z ? "Upload at least six months of jobs that overlap Zillow's data to see this chart." : "Zillow doesn't publish monthly housing data for this metro."));
  }
  const months = mo?.months ?? Array.from({ length: 24 }, (_, i) => addMonths(s.windowEnd, i - 23));
  const counts = mo?.jobs ?? months.map(() => null);
  if (mo) {
    columnChart($("#ch-jobs"), {
      labels: months.map((m) => MONTHS[+m.slice(5, 7) - 1][0]), values: counts, fmt: (v) => fmtInt(v), label: "Jobs per month",
      colorOf: (_, i) => (months[i] >= s.windowStart ? s1 : cssVar("--bar-muted")), labelIf: () => false,
      tipLabel: (i) => monthLabel(months[i]), height: 200,
    });
    $("#ft-jobs").textContent = `${fmtInt(s.jobs12)} jobs in the latest 12 months` + (s.jobsPrior12 ? `, ${fmtInt(s.jobsPrior12)} in the 12 before.` : ".");
  } else {
    $("#ch-jobs").replaceChildren(h("p", { class: "sub", style: "margin-top:14px" }, "Not enough months of jobs yet."));
  }

  // prices vs PPI
  const p = s.price;
  if (p) {
    const series = [{ name: "Your average job price", color: s1, values: p.yourIdx }, { name: "Moving price index (U.S.)", color: s2, values: p.ppiIdx }];
    legend($("#lg-price"), series);
    lineChart($("#ch-price"), {
      x: p.months.map(toDate), series, refLine: 100, height: 220, yFmt: (v) => String(Math.round(v)),
      xLabel: (i) => monthLabel(p.months[i]), label: "Your average job price and the moving price index, indexed",
      tip: (i) => [
        tipRow(s1, "your average job, mix-adjusted", p.yourAvg[i] == null ? "–" : fmtMoney(p.yourAvg[i])),
        tipRow(s2, "price index", p.ppi[i] == null ? "–" : (p.ppi[i] as number).toFixed(1)),
      ],
    });
    $("#ft-price").textContent = "Your line is revenue per job, three-month rolling average, weighted by your usual mix of job types so a shift between local and long-distance work doesn't count as a price change. Price index: BLS producer price index for used household and office goods moving." +
      (p.yourChange != null && p.ppiChange != null ? ` Past year: you ${fmtSignedPct(p.yourChange)}, industry ${fmtSignedPct(p.ppiChange)}.` : "");
  } else {
    $("#lg-price").replaceChildren();
    $("#ch-price").replaceChildren(h("p", { class: "sub", style: "margin-top:14px" }, "Add a revenue column and at least eight months of jobs to see this chart."));
  }

  // seasonality
  const ms: number[] | undefined = home.k?.seas;
  if (s.season && ms) {
    const series = [{ name: "Your jobs", color: s1, values: s.season }, { name: (home.k.seas_src === "sales" ? "Home sales" : "New listings") + " in " + here, color: s2, values: ms }];
    legend($("#lg-season"), series);
    lineChart($("#ch-season-b"), {
      x: MONTHS.map((_, i) => new Date(2025, i, 1)), series, height: 200, yFmt: (v, exact) => fmtPct(v, exact ? 1 : 0),
      xLabel: (i) => MONTHS_LONG[i], xTickFmt: (d) => MONTHS[d.getMonth()], label: "Share of the year by month, you and the market", left: 40,
    });
    $("#ft-season-b").textContent = `Your jobs: ${win(s)}. Market: average of 2019–2025 (Zillow).`;
  } else {
    $("#lg-season").replaceChildren();
    $("#ch-season-b").replaceChildren(h("p", { class: "sub", style: "margin-top:14px" }, "Needs 12 months of jobs (at least 50) to compare."));
  }

  // lanes
  const tb = $("#b-lanes-table tbody");
  tb.replaceChildren(...(s.lanes.length ? s.lanes.map((l) => {
    const flag = s.untappedKeys.includes(l.dir + "|" + l.code);
    const name = l.dir === "out" ? `${here} → ${l.name}` : `${l.name} → ${here}`;
    return h("tr", { class: flag ? "flag" : "" },
      h("td", null, name, " ", h("span", { class: "tag" }, l.dir === "out" ? "Moving out" : "Moving in"), flag ? h("span", { class: "tag tag-flag" }, "Untapped") : null),
      h("td", { class: "n" }, fmtInt(l.households)), h("td", { class: "n" }, fmtInt(l.yourJobs)),
      h("td", { class: "n" }, fmtPct(l.share, 1)), h("td", { class: "n" }, fmtInt(l.miles)));
  }) : [h("tr", null, h("td", { colspan: 5, class: "dim" }, "No long-distance lanes above the IRS reporting threshold for this metro."))]));
  $("#b-other-lanes").replaceChildren(s.otherLanes.length ? h("p", { class: "sub other-lanes" }, "Other lanes you served: ",
    s.otherLanes.map((o, i) => (i ? ", " : "") + (o.dir === "out" ? "to " : "from ") + city(o.name) + " (" + fmtInt(o.yourJobs) + ")").join("")) : "");

  const totSrc = s.bySource.reduce((a, x) => a + x.jobs, 0) || 1;
  const srcRows = s.bySource.slice(0, 8);
  hbars($("#b-sources"), srcRows.map((x) => ({ label: x.label, value: x.jobs, note: fmtPct(x.jobs / totSrc), muted: x.label === "Not given" })), { fmt: (v) => fmtInt(v) });
  $("#ft-sources").textContent = s.bySource.length > 8 ? `Top 8 of ${s.bySource.length} sources. Share of jobs after each count.` : "Share of jobs after each count.";
  const avgRows = srcRows.filter((x) => x.avg != null);
  if (avgRows.length) {
    const hasWin = avgRows.some((x) => x.winRate != null);
    hbars($("#b-source-avg"), avgRows.map((x) => ({ label: x.label, value: x.avg, muted: x.label === "Not given",
      note: x.winRate == null ? undefined : fmtPct(x.winRate) + " won" })), { fmt: (v) => fmtMoney(v) });
    $("#ft-source-avg").textContent = (s.avgRevenue12 ? `Your overall average: ${fmtMoney(s.avgRevenue12)}.` : "") +
      (hasWin ? " “Won” is the share of quotes with a status that were booked or completed." : "");
  } else {
    $("#b-source-avg").replaceChildren(h("p", { class: "sub", style: "margin-top:14px" }, "Add revenue and lead source columns to see this."));
  }
}

function drawOutlook(ctx: Ctx, home: MetroDetail, s: BusinessSummary) {
  const o = s.outlook, box = $("#b-outlook");
  const s1 = cssVar("--s1"), s2 = cssVar("--s2");
  if (!o) {
    box.replaceChildren(h("h3", null, "Your next three months"), h("p", { class: "sub" }, "Upload at least 15 months of jobs, with 15 or more jobs in each three-month stretch, to see a booking forecast."));
    $("#ch-out").replaceChildren(); $("#lg-out").replaceChildren();
    return;
  }
  const tot = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const span = monthLabel(o.months[0]).split(" ")[0] + "–" + monthLabel(o.months[2]);
  box.replaceChildren(
    h("p", { class: "eyebrow-dark" }, "Booking forecast · " + span),
    h("h3", { class: "fc-head" }, "About " + fmtInt(tot(o.f)) + " jobs"),
    h("p", { class: "fc-range" }, "Likely range " + fmtInt(tot(o.lo)) + " to " + fmtInt(tot(o.hi)) + " · same months last year: " + fmtInt(tot(o.ly))),
    h("div", { class: "fc-row" },
      h("div", null, h("span", { class: "p-label" }, "Your recent trend"), h("span", { class: "fc-big" }, deltaSpan(o.yourTrend)), h("span", { class: "p-note" }, "last 3 months vs a year earlier")),
      h("div", null, h("span", { class: "p-label" }, "Market forecast, " + city(home.n)), h("span", { class: "fc-big" }, deltaSpan(o.marketTrend)), h("span", { class: "p-note" }, "home sales, next 3 months"))),
    h("ul", { class: "plain-list fc-months" }, ...o.months.map((m, i) => h("li", null, h("b", null, monthLabel(m)), " " + fmtInt(o.f[i]) + " jobs ", h("span", { class: "muted" }, `(${fmtInt(o.lo[i])}–${fmtInt(o.hi[i])})`)))),
    h("p", { class: "foot" }, "Half your own recent trend, half the market forecast for your home metro, applied to the same months last year." +
      (o.check != null ? ` Checked on your last ${o.checkN} months: off by ${fmtPct(o.check)} on average.` : "")));
  const back = Math.min(12, s.monthly?.months.length ?? 0);
  const histMonths = s.monthly ? s.monthly.months.slice(-back) : [];
  const hist = s.monthly ? s.monthly.jobs.slice(-back) : [];
  const months = [...histMonths, ...o.months];
  const nh = histMonths.length;
  const last = hist[nh - 1] ?? null;
  const toDate = (m: string) => new Date(+m.slice(0, 4), +m.slice(5, 7) - 1, 1);
  const series = [
    { name: "Your jobs", color: s1, values: [...hist, null, null, null] as (number | null)[] },
    { name: "Forecast", color: s2, values: months.map((_, i) => (i === nh - 1 ? last : i >= nh ? o.f[i - nh] : null)), dash: "5 4" },
    { name: "Same months last year", color: cssVar("--muted"), values: months.map((_, i) => (i >= nh ? o.ly[i - nh] : null)), width: 1.5, noDot: true },
  ];
  legend($("#lg-out"), [...series.map((x) => ({ name: x.name, color: x.color })), { name: "Likely range (80%)", color: s2, dot: true }]);
  if (!nh) { $("#ch-out").replaceChildren(); return; }
  lineChart($("#ch-out"), {
    x: months.map(toDate), series, height: 220, yFmt: (v) => fmtInt(v), tipFmt: (v) => fmtInt(v), zero: true,
    band: { lo: months.map((_, i) => (i === nh - 1 ? last : i >= nh ? o.lo[i - nh] : null)), hi: months.map((_, i) => (i === nh - 1 ? last : i >= nh ? o.hi[i - nh] : null)), color: s2 },
    xLabel: (i) => monthLabel(months[i]) + (i >= nh ? " (forecast)" : ""), label: "Your monthly jobs with a three-month forecast",
  });
  $("#ft-out").textContent = "Lost jobs left out. Use it to plan crews, trucks and marketing spend.";
}

// ---------------------------------------------------------------------------------------------
function uploadSection(ctx: Ctx, existing: number) {
  return section("b-data", "Your data", existing ? "Add new jobs or replace what's here" : "One row per job, from your moving software or a spreadsheet",
    h("div", { class: "grid" },
      h("div", { class: "panel w7" },
        h("h3", null, existing ? "Upload more jobs" : "Upload your jobs"),
        h("p", { class: "sub" }, "Export jobs from your moving software (most can export to CSV) or save a spreadsheet as CSV. Two years of jobs gives the best comparisons."),
        h("label", { class: "dropzone", id: "dropzone" },
          h("input", { type: "file", id: "file-input", accept: ".csv,text/csv", class: "sr-only" }),
          h("span", { class: "dz-main" }, "Drop a CSV file here, or ", h("u", null, "choose a file")),
          h("span", { class: "dz-note" }, "Up to 25 MB. Excel files: use File > Save As > CSV first.")),
        h("div", { id: "up-status", "aria-live": "polite" }),
        ctx.ds.demo ? h("p", { class: "foot" }, "In the demo, uploads stay in this browser tab and disappear when you reload.") : null,
        existing ? h("div", { class: "danger-zone" },
          h("button", { class: "btn btn-quiet", type: "button", id: "delete-all" }, "Delete all " + fmtInt(existing) + " jobs"),
          h("div", { id: "delete-confirm" })) : null),
      h("div", { class: "panel w5" },
        h("h3", null, "Columns we read"),
        h("p", { class: "sub" }, "Names don't have to match exactly. “Move date”, “From ZIP” and “Amount” work too."),
        h("table", { class: "cols-table" },
          h("tbody", null, ...TEMPLATE_COLUMNS.map((c) => h("tr", null,
            h("td", null, h("code", null, c.key), c.required ? h("span", { class: "req" }, " required") : null),
            h("td", null, c.help))))),
        h("div", { class: "more" },
          h("button", { class: "btn", type: "button", onclick: () => download(TEMPLATE_CSV, "jobs-template.csv") }, "Download the template")),
        h("pre", { class: "template-pre", "aria-label": "Template rows" }, TEMPLATE_CSV.trim()))));
}

function wireUpload(ctx: Ctx, jobs: Job[]) {
  const input = $("#file-input") as HTMLInputElement | null;
  const zone = $("#dropzone");
  if (!input || !zone) return;
  input.addEventListener("change", () => { if (input.files?.[0]) void readFile(input.files[0]); input.value = ""; });
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("over"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("over"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault(); zone.classList.remove("over");
    const f = (e as DragEvent).dataTransfer?.files?.[0];
    if (f) void readFile(f);
  });
  const status = $("#up-status");
  const say = (kind: "error" | "info", text: string) => status.replaceChildren(h("div", { class: "notice notice-" + kind }, text));

  async function readFile(f: File) {
    if (f.size > MAX_BYTES) return say("error", "That file is larger than 25 MB. Export fewer years, or split it into two files and add them one at a time.");
    if (/\.(xlsx|xls|numbers)$/i.test(f.name)) return say("error", "That's a spreadsheet file, not a CSV. In Excel, use File > Save As and pick “CSV UTF-8”, then upload that file.");
    say("info", "Reading " + f.name + "…");
    try {
      const text = await f.text();
      const result = parseJobsCsv(text, await ctx.zipMap());
      pending = { file: f.name, result };
      renderPreview();
    } catch (e) {
      say("error", "Couldn't read that file: " + (e as Error).message);
    }
  }

  function renderPreview() {
    if (!pending) { status.replaceChildren(); return; }
    const { file, result: r } = pending;
    if (!r.columns.job_date) {
      return status.replaceChildren(h("div", { class: "notice notice-error" },
        `We couldn't find a move date column in ${file}. Name it job_date (or “Move date”), or start from the template.`));
    }
    if (!r.jobs.length) return say("error", `None of the ${fmtInt(r.rows)} rows in ${file} had a date we could read.`);
    const dates = r.jobs.map((j) => j.job_date).sort();
    const notes: Child[] = [];
    if (r.missingRequired.length) notes.push(h("li", { class: "warn" }, "No " + r.missingRequired.map((k) => k.replace("_", " ")).join(" or ") + " column found. Lanes and market share need origin and destination ZIP codes."));
    if (r.skipped.length) notes.push(h("li", null, `${fmtInt(r.skipped.length)} rows skipped: ` + r.skipped.slice(0, 4).map((x) => `row ${x.row} (${x.reason})`).join(", ") + (r.skipped.length > 4 ? ", …" : "") + "."));
    if (r.zipMisses) notes.push(h("li", null, `${fmtInt(r.zipMisses)} jobs have a ZIP code outside the 387 metros (often rural). They still count in your totals.`));
    const matched = Object.entries(r.columns) as [string, string][];
    status.replaceChildren(h("div", { class: "preview" },
      h("p", null, h("b", null, fmtInt(r.jobs.length) + " jobs ready"), ` from ${file}, ${monthLabel(dates[0].slice(0, 7))} to ${monthLabel(dates[dates.length - 1].slice(0, 7))}.`),
      notes.length ? h("ul", { class: "preview-notes" }, ...notes) : null,
      h("p", { class: "sub" }, "Columns used: ", matched.map(([k, v]) => (v === k ? k : `“${v}” as ${k}`)).join(", "), "."),
      h("div", { class: "btn-row" },
        h("button", { class: "btn btn-primary", type: "button", id: "up-add" }, jobs.length ? `Add ${fmtInt(r.jobs.length)} jobs` : `Save ${fmtInt(r.jobs.length)} jobs`),
        jobs.length ? h("button", { class: "btn", type: "button", id: "up-replace" }, `Replace all ${fmtInt(jobs.length)} jobs with these`) : null,
        h("button", { class: "btn btn-quiet", type: "button", id: "up-cancel" }, "Cancel"))));
    ($("#up-cancel") as HTMLButtonElement).onclick = () => { pending = null; renderPreview(); };
    ($("#up-add") as HTMLButtonElement).onclick = () => void commit(false);
    const rep = $("#up-replace") as HTMLButtonElement | null;
    if (rep) rep.onclick = () => void commit(true);
  }

  async function commit(replace: boolean) {
    if (!pending) return;
    const add = pending.result.jobs;
    status.querySelectorAll("button").forEach((b) => ((b as HTMLButtonElement).disabled = true));
    say("info", `Saving ${fmtInt(add.length)} jobs…`);
    try {
      if (replace) await ctx.ds.deleteAllJobs();
      const n = await ctx.ds.addJobs(add);
      pending = null;
      flash = { kind: "ok", text: `${replace ? "Replaced your jobs with" : "Added"} ${fmtInt(n)} jobs.` };
      ctx.rerender();
    } catch (e) {
      say("error", "Saving stopped partway: " + (e as Error).message + (replace ? " Some jobs may be missing; upload the file again with “Replace” to fix it." : " Some jobs may have been saved; use “Replace” next time to avoid duplicates."));
    }
  }

  const del = $("#delete-all") as HTMLButtonElement | null;
  if (del) del.onclick = () => {
    $("#delete-confirm").replaceChildren(h("div", { class: "confirm" },
      h("p", null, `This removes all ${fmtInt(jobs.length)} jobs for your company. It can't be undone.`),
      h("div", { class: "btn-row" },
        h("button", { class: "btn btn-danger", type: "button", onclick: async (e: Event) => {
          (e.target as HTMLButtonElement).disabled = true;
          try {
            await ctx.ds.deleteAllJobs();
            flash = { kind: "ok", text: "Deleted all jobs." };
            ctx.rerender();
          } catch (err) {
            $("#delete-confirm").replaceChildren(h("div", { class: "notice notice-error" }, "Couldn't delete: " + (err as Error).message));
          }
        } }, "Yes, delete them"),
        h("button", { class: "btn btn-quiet", type: "button", onclick: () => $("#delete-confirm").replaceChildren() }, "Keep them"))));
  };
}

function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = h("a", { href: url, download: name, style: "display:none" });
  document.body.append(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
}
const fileSafe = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "jobs";
