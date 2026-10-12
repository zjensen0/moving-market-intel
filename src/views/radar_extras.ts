// Extra Hiring radar sections (Acumena admins only): new and growing movers, pay benchmark,
// hard-to-fill signals and hiring pressure by market.
import type { Ctx } from "../app";
import type { EmployerContact } from "../data/types";
import { $, h } from "../lib/dom";
import { fmtInt } from "../lib/format";
import { ROLE_NAMES, type Posting } from "../../server/jobs";
import { fleetChanges, fleetNow, newMovers, type FleetChange, type NewMover } from "../data/fmcsa";
import { BENCH_ROLES, hardToFill, hiringPressure, payBenchmark } from "../business/radar_insights";
import type { Prediction } from "../business/hiring_forecast";

const money = (v: number | null) => (v == null ? "–" : "$" + v.toFixed(2));
const roleShort = (r: string) => ({ driver: "Driver", mover: "Mover / crew", sales: "Estimator / sales", ops: "Crew lead / ops" } as Record<string, string>)[r] || ROLE_NAMES[r as keyof typeof ROLE_NAMES] || r;
const dateFmt = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

let showAllHard = false;
let showAllNew = false;
let fmcsaCache: { key: string; movers: NewMover[]; changes: FleetChange[]; tracked: number; at: Date } | null = null;

export function extrasSkeleton() {
  return [
    h("section", { class: "block" },
      h("div", { class: "sec-head" }, h("h2", null, "New and growing movers"), h("p", null, "Movers that just registered with FMCSA or added trucks: both have to hire")),
      h("div", { class: "panel w12" },
        h("div", { class: "radar-actions", style: "margin:0 0 10px" },
          h("button", { class: "btn btn-primary", type: "button", id: "fm-check" }, "Check FMCSA now"),
          h("span", { class: "sub", id: "fm-when" }, "Looks up the live FMCSA carrier register for the markets in view (takes a few seconds).")),
        h("h3", null, "Registered in the last 12 months"),
        h("div", { id: "fm-new" }, h("p", { class: "sub" }, "Click “Check FMCSA now”.")),
        h("h3", { style: "margin-top:18px" }, "Fleet changes since the last data refresh"),
        h("div", { id: "fm-growth" }, h("p", { class: "sub" }, "Click “Check FMCSA now”.")),
        h("p", { class: "foot", id: "fm-foot" }))),
    h("section", { class: "block" },
      h("div", { class: "sec-head" }, h("h2", null, "Pay benchmark"), h("p", null, "Median posted hourly pay by market and role, against the median across every market in view")),
      h("div", { class: "panel w12" }, h("div", { id: "pay-bench" }), h("p", { class: "foot", id: "pay-bench-foot" }))),
    h("section", { class: "block" },
      h("div", { class: "sec-head" }, h("h2", null, "Hard to fill"), h("p", null, "Employers whose postings say they're struggling: up a long time, posted more than once, or pay out of line with the market")),
      h("div", { class: "panel w12" }, h("div", { id: "hard-fill" }), h("div", { class: "more" }, h("button", { class: "btn", type: "button", id: "hard-more" }, "Show all")), h("p", { class: "foot", id: "hard-foot" }))),
    h("section", { class: "block" },
      h("div", { class: "sec-head" }, h("h2", null, "Hiring pressure by market"), h("p", null, "Where finding people is hardest: open and expected openings against the local driver workforce")),
      h("div", { class: "panel w12" }, h("div", { id: "pressure" }), h("p", { class: "foot", id: "pressure-foot" }))),
  ];
}

export interface ExtrasArgs {
  ctx: Ctx;
  ps: Posting[];                 // postings in view (scope, role and search filters applied)
  codes: string[];               // markets in view
  details: Map<string, any>;     // market detail by code
  preds90: Prediction[];         // predictions for the next 90 days, unfiltered
  contactFor: (company: string | null, cbsa?: string | null) => EmployerContact | null;
  name: (c: string | null) => string;
  rerender: () => void;
}

export function renderExtras(a: ExtrasArgs) {
  const { ps, codes, details, name } = a;
  // pay benchmark
  const pb = payBenchmark(ps, codes, (c) => details.get(c)?.q);
  const cell = (v: { median: number | null; n: number }, overall: number | null) => {
    if (v.median == null) return h("td", { class: "n dim" }, "–");
    const d = overall ? v.median / overall - 1 : 0;
    const cls = Math.abs(d) < 0.05 ? "" : d > 0 ? " up" : " down";
    return h("td", { class: "n" + cls }, h("b", null, money(v.median)), h("div", { class: "cell-note" }, `${v.n} posting${v.n > 1 ? "s" : ""}${overall && Math.abs(d) >= 0.05 ? ` · ${d > 0 ? "+" : "−"}${Math.round(Math.abs(d) * 100)}%` : ""}`));
  };
  $("#pay-bench").replaceChildren(pb.rows.length ? h("div", { class: "tbl-wrap", style: "margin-top:0" }, h("table", null,
    h("thead", null, h("tr", null, h("th", null, "Market"), ...BENCH_ROLES.map((r) => h("th", { class: "n" }, roleShort(r))), h("th", { class: "n" }, "BLS: moving company average"))),
    h("tbody", null,
      h("tr", { class: "flag" }, h("td", null, h("b", null, "All markets in view")), ...BENCH_ROLES.map((r) => h("td", { class: "n" }, h("b", null, money(pb.overall[r].median)), h("div", { class: "cell-note" }, `${pb.overall[r].n} postings`))), h("td", { class: "n" }, "")),
      ...pb.rows.map((r) => h("tr", null, h("td", null, name(r.cbsa)), ...BENCH_ROLES.map((x) => cell(r.byRole[x], pb.overall[x].median)),
        h("td", { class: "n" }, money(r.blsHourly), r.blsState ? h("div", { class: "cell-note" }, "statewide") : null))))))
    : h("p", { class: "sub" }, "No postings with pay in view."));
  $("#pay-bench-foot").textContent = "Posted pay is what employers advertise, converted to hourly at 40 hours a week; postings over $80 an hour (owner-operator contracts) and per-mile pay are left out. Green and red mark markets 5% or more above or below the all-market median. The BLS column is the 2025 average weekly wage at moving companies (all jobs, office included) divided by 40. Use it on sales calls: “your posting is $3 below the Atlanta median.”";

  // hard to fill
  const hard = hardToFill(ps);
  const rows = showAllHard ? hard : hard.slice(0, 15);
  $("#hard-fill").replaceChildren(hard.length ? h("div", { class: "tbl-wrap", style: "margin-top:0" }, h("table", null,
    h("thead", null, h("tr", null, ...["Employer", "Market", "Role", "What the postings say", "Business contact"].map((t) => h("th", null, t)))),
    h("tbody", null, ...rows.map((r) => {
      const c = a.contactFor(r.company, r.cbsa);
      return h("tr", null, h("td", null, h("b", null, r.company)), h("td", null, name(r.cbsa)), h("td", null, roleShort(r.role)),
        h("td", null, h("div", { class: "cell-note", style: "white-space:normal" }, r.signals.join(" · "))),
        h("td", null, c?.phone ? h("a", { href: "tel:" + c.phone.replace(/[^\d+]/g, "") }, c.phone) : h("span", { class: "dim" }, "–")));
    })))) : h("p", { class: "sub" }, "Nothing stands out in the postings in view."));
  const hm = $("#hard-more") as HTMLButtonElement;
  hm.hidden = hard.length <= 15; hm.textContent = showAllHard ? "Show fewer" : `Show all ${hard.length}`;
  hm.onclick = () => { showAllHard = !showAllHard; a.rerender(); };
  $("#hard-foot").textContent = "Signals come from the postings themselves: how long ago the employer posted, how many postings they have for the same role, and their pay against other employers posting that role in the same market. As the radar refreshes daily it will also catch reposts and pay raises over time.";

  // hiring pressure
  const pr = hiringPressure(codes, ps, a.preds90, (c) => details.get(c));
  $("#pressure").replaceChildren(pr.length ? h("div", { class: "tbl-wrap", style: "margin-top:0" }, h("table", null,
    h("thead", null, h("tr", null, h("th", null, "Market"), h("th", { class: "n" }, "Open postings"), h("th", { class: "n" }, "Employers posting"), h("th", { class: "n" }, "Expected openings, next 90 days"), h("th", { class: "n" }, "Drivers at local movers (FMCSA)"), h("th", { class: "n" }, "Openings per 100 drivers"), h("th", null, "Pressure"))),
    h("tbody", null, ...pr.map((r) => h("tr", null, h("td", null, name(r.cbsa)), h("td", { class: "n" }, fmtInt(r.postings)), h("td", { class: "n" }, fmtInt(r.employersPosting)),
      h("td", { class: "n" }, fmtInt(Math.round(r.predicted))), h("td", { class: "n" }, r.drivers == null ? "–" : fmtInt(r.drivers)),
      h("td", { class: "n" }, r.perHundred == null ? "–" : r.perHundred.toFixed(0)), h("td", null, h("span", { class: "tag" + (r.level === "High" ? " tag-flag" : "") }, r.level)))))))
    : h("p", { class: "sub" }, "No markets in view."));
  $("#pressure-foot").textContent = "Openings per 100 drivers = (postings now + openings the “Likely to hire soon” estimate expects over 90 days at movers not already posting) ÷ drivers reported by the market's FMCSA-registered movers × 100. High means each opening competes for fewer experienced people: placements are harder, and worth more. Levels split the markets in view into thirds.";

  // FMCSA: show cached results for the same markets
  const key = codes.slice().sort().join(",");
  if (fmcsaCache && fmcsaCache.key === key) drawFmcsa(a, fmcsaCache);
  ($("#fm-check") as HTMLButtonElement).onclick = () => checkFmcsa(a, key);
}

async function checkFmcsa(a: ExtrasArgs, key: string) {
  const btn = $("#fm-check") as HTMLButtonElement;
  btn.disabled = true; btn.textContent = "Checking FMCSA…";
  try {
    const zip = await a.ctx.zipMap();
    const states = a.codes.flatMap((c) => a.ctx.byCode.get(c)?.st || []);
    const tops = new Map(a.codes.map((c) => [c, (a.details.get(c)?.top || []) as unknown[][]]));
    const dots = [...tops.values()].flatMap((t) => t.map((r) => String(r[7] ?? "")));
    const [movers, now] = await Promise.all([newMovers(states, new Set(a.codes), zip), fleetNow(dots)]);
    fmcsaCache = { key, movers, changes: fleetChanges(tops, now), tracked: now.size, at: new Date() };
    drawFmcsa(a, fmcsaCache);
  } catch (e) {
    $("#fm-new").replaceChildren(h("div", { class: "notice notice-err" }, "Couldn't reach FMCSA: " + (e as Error).message + ". Check the internet connection and try again."));
  } finally { btn.disabled = false; btn.textContent = "Check FMCSA now"; }
}

function drawFmcsa(a: ExtrasArgs, r: NonNullable<typeof fmcsaCache>) {
  const { name } = a;
  $("#fm-when").textContent = `Checked ${r.at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}: ${fmtInt(r.movers.length)} new movers, ${fmtInt(r.tracked)} established movers tracked.`;
  $("#fm-new").replaceChildren(r.movers.length ? h("div", { class: "tbl-wrap", style: "margin-top:0" }, h("table", null,
    h("thead", null, h("tr", null, ...["Registered", "Mover", "Market", "Trucks", "Drivers", "Officer on file", "Phone", "Email"].map((t, i) => h("th", { class: i === 3 || i === 4 ? "n" : "" }, t)))),
    h("tbody", null, ...(showAllNew ? r.movers : r.movers.slice(0, 30)).map((m) => h("tr", null,
      h("td", null, dateFmt(m.added)),
      h("td", null, h("b", null, m.name), h("div", { class: "cell-note" }, `${m.city}, ${m.state} · USDOT ${m.usdot}${m.interstate ? " · interstate" : ""}`)),
      h("td", null, name(m.cbsa)), h("td", { class: "n" }, fmtInt(m.trucks)), h("td", { class: "n" }, fmtInt(m.drivers)),
      h("td", null, m.officer || "–"),
      h("td", { style: "white-space:nowrap" }, m.phone ? h("a", { href: "tel:" + m.phone.replace(/[^\d+]/g, "") }, m.phone) : "–"),
      h("td", null, m.email ? h("a", { href: "mailto:" + m.email }, m.email) : "–"))))))
    : h("p", { class: "sub" }, "No new household-goods movers registered in these markets in the last 12 months."),
    r.movers.length > 30 ? h("div", { class: "more" }, h("button", { class: "btn", type: "button", onclick: () => { showAllNew = !showAllNew; drawFmcsa(a, r); } }, showAllNew ? "Show fewer" : `Show all ${fmtInt(r.movers.length)}`)) : "");
  $("#fm-growth").replaceChildren(r.changes.length ? h("div", { class: "tbl-wrap", style: "margin-top:0" }, h("table", null,
    h("thead", null, h("tr", null, h("th", null, "Mover"), h("th", null, "Market"), h("th", { class: "n" }, "Trucks"), h("th", { class: "n" }, "Drivers"), h("th", null, "Status"))),
    h("tbody", null, ...r.changes.map((c) => {
      const dt = c.trucksNow - c.trucksWas, dd = c.driversNow - c.driversWas;
      const chg = (was: number, now: number, d: number) => h("td", { class: "n" + (d > 0 ? " up" : d < 0 ? " down" : "") }, `${fmtInt(was)} → ${fmtInt(now)}`, d ? h("div", { class: "cell-note" }, (d > 0 ? "+" : "") + d) : null);
      return h("tr", null, h("td", null, h("b", null, c.name), h("div", { class: "cell-note" }, "USDOT " + c.usdot)), h("td", null, name(c.cbsa)),
        chg(c.trucksWas, c.trucksNow, dt), chg(c.driversWas, c.driversNow, dd), h("td", null, c.active ? (dt > 0 || dd > 0 ? "Growing: will need drivers and crew" : "Shrinking") : "No longer active"));
    })))) : h("p", { class: "sub" }, `No changes yet among the ${fmtInt(r.tracked)} largest movers in these markets since the data was refreshed on ${dateFmt(a.ctx.N.built)}. Movers update their FMCSA filing every two years at least, so changes show up gradually.`));
  $("#fm-foot").textContent = "Source: FMCSA carrier census (data.transportation.gov), checked live. New movers are active carriers registered for household goods whose business address is in the market and whose name says moving, or who haul household goods only (box-truck freight start-ups are left out). The officer is the person the company lists on its federal filing. Fleet changes compare the market's largest movers with their filing on the date the app's data was last refreshed.";
}
