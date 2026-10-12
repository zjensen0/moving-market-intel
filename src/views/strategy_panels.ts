// Market snapshot panels: round-trip (backhaul) lanes and the demand pricing calendar.
import type { Ctx } from "../app";
import type { MetroDetail } from "../data/types";
import { $, h } from "../lib/dom";
import { fmtInt } from "../lib/format";
import { pricingCalendar, roundTrips } from "../business/market_strategy";

const city = (n: string) => n.split(",")[0].split("-")[0];

export function pricingPanel() {
  return h("div", { class: "panel w12" }, h("h3", null, "Pricing calendar: the next six months"),
    h("p", { class: "sub" }, "Expected moving demand each week against an average week here. Charge more when demand is high; discount to fill trucks when it's low."),
    h("div", { class: "cal-legend" }, ...[["peak", "Peak: +15%"], ["busy", "Busy: +7%"], ["standard", "Standard"], ["slow", "Slow: −10%"]].map(([b, t]) => h("span", null, h("i", { class: "cal-" + b }), t))),
    h("div", { class: "cal-grid", id: "price-cal" }), h("p", { class: "foot", id: "price-cal-foot" }));
}
export function roundTripPanel() {
  return h("div", { class: "panel w12" }, h("h3", null, "Round trips: lanes that pay both ways"),
    h("p", { class: "sub" }, "A long-distance truck that comes home empty earns half. These lanes, 100 miles or longer, have enough households moving in both directions to keep trucks loaded each way."),
    h("div", { id: "round-trips" }), h("p", { class: "foot", id: "round-foot" }));
}

export function drawStrategy(m: MetroDetail, ctx: Ctx) {
  const here = city(m.n);
  // pricing calendar
  const cal = pricingCalendar(m);
  $("#price-cal").replaceChildren(...cal.map((w) => {
    const label = w.start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const tip = `Week of ${label}: demand ${Math.round(w.index * 100)} (average week = 100)${w.why.length ? ". " + w.why.join("; ") : ""}. Suggested: ${w.adjust ? (w.adjust > 0 ? "+" : "−") + Math.round(Math.abs(w.adjust) * 100) + "% on your standard rate" : "standard rate"}.`;
    return h("div", { class: "cal-cell cal-" + w.band, title: tip, tabindex: "0", "aria-label": tip },
      h("span", { class: "cal-date" }, label), h("span", { class: "cal-idx" }, String(Math.round(w.index * 100))),
      h("span", { class: "cal-adj" }, w.adjust ? (w.adjust > 0 ? "+" : "−") + Math.round(Math.abs(w.adjust) * 100) + "%" : "–"));
  }));
  const peak = cal.filter((w) => w.band === "peak").length, slow = cal.filter((w) => w.band === "slow").length;
  $("#price-cal-foot").textContent = `${peak} peak and ${slow} slow weeks ahead in ${here}. Demand index: this market's share of home sales by month (Zillow, 2019–2025), raised 15% for weeks that include a month-end (leases and closings cluster there) and lowered 15% for holiday weeks, times the 90-day home-sales forecast. The month-end and holiday effects and the suggested price changes are industry rules of thumb, not measured for this market. Hover a week for the reasons.`;

  // round trips
  const trips = roundTrips(m).slice(0, 10);
  const name = (c: string) => city(ctx.byCode.get(c)?.n ?? c);
  $("#round-trips").replaceChildren(trips.length ? h("div", { class: "tbl-wrap", style: "margin-top:0" }, h("table", null,
    h("thead", null, h("tr", null, h("th", null, "Lane"), h("th", { class: "n" }, "Households out"), h("th", { class: "n" }, "Households back"), h("th", { class: "n" }, "Miles"), h("th", null, "Balance"), h("th", null, "What to do"))),
    h("tbody", null, ...trips.map((t) => h("tr", { class: t.kind === "both" ? "flag" : "" },
      h("td", null, h("b", null, `${here} ⇄ ${name(t.code)}`)),
      h("td", { class: "n" }, fmtInt(t.out)), h("td", { class: "n" }, fmtInt(t.back)), h("td", { class: "n" }, fmtInt(t.miles)),
      h("td", null, h("span", { class: "tag" + (t.kind === "both" ? " tag-flag" : "") }, t.kind === "both" ? "Pays both ways" : t.kind === "out" ? "Mostly outbound" : "Mostly inbound"),
        h("div", { class: "cell-note" }, `${Math.round(t.balance * 100)}% balanced`)),
      h("td", null, h("span", { class: "cell-note", style: "white-space:normal" }, t.advice)))))))
    : h("p", { class: "sub" }, "No lanes of 100 miles or more above the IRS reporting threshold for this metro."));
  $("#round-foot").textContent = "Households a year moving each way, IRS county-to-county address changes, 2022 to 2023. Balanced = the lighter direction as a share of the heavier one; 70% or more counts as paying both ways. Only the metro's 12 biggest lanes each way are in the data, so smaller round trips may be missing.";
}
