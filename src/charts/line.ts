import * as d3 from "d3";
import { h, cssVar } from "../lib/dom";
import { fmtInt } from "../lib/format";
import { hideTip, showTip, tipRow } from "../lib/tooltip";

export interface Series { name: string; color: string; values: (number | null)[]; width?: number; area?: boolean; noDot?: boolean }
export interface LineCfg {
  x: Date[];
  series: Series[];
  yFmt?: (v: number, exact?: boolean) => string;
  tipFmt?: (v: number) => string;
  xLabel: (i: number) => string;
  label?: string;
  height?: number;
  left?: number;
  zero?: boolean;
  refLine?: number; // e.g. 100 for indexed charts
  xTickFmt?: (d: Date) => string;
  tip?: (i: number) => Node[]; // custom tooltip rows (the title still comes from xLabel)
}

/** Line chart with a crosshair tooltip; arrow keys move the crosshair when focused. */
export function lineChart(el: HTMLElement, cfg: LineCfg) {
  el.replaceChildren();
  const W0 = Math.max(260, el.clientWidth || 600), H0 = cfg.height || 220;
  const M = { t: 10, r: 14, b: 26, l: cfg.left || 44 };
  const x = d3.scaleTime().domain(d3.extent(cfg.x) as [Date, Date]).range([M.l, W0 - M.r]);
  const all = cfg.series.flatMap((s) => s.values.filter((v): v is number => v != null));
  if (cfg.refLine != null) all.push(cfg.refLine);
  if (!all.length) { el.append(h("p", { class: "sub" }, "No data to chart.")); return; }
  let lo = d3.min(all)!, hi = d3.max(all)!;
  if (cfg.zero) lo = Math.min(0, lo);
  const pad = (hi - lo) * 0.08 || 1;
  const y = d3.scaleLinear().domain([cfg.zero ? lo : lo - pad, hi + pad]).nice(4).range([H0 - M.b, M.t]);
  const yF = cfg.yFmt || ((v: number) => String(v));
  const svg = d3.select(el).append("svg").attr("viewBox", `0 0 ${W0} ${H0}`).attr("role", "img").attr("aria-label", cfg.label || "line chart");
  svg.append("g").selectAll("line").data(y.ticks(4)).join("line").attr("class", "grid-line")
    .attr("x1", M.l).attr("x2", W0 - M.r).attr("y1", (d) => y(d)).attr("y2", (d) => y(d));
  svg.append("g").selectAll("text").data(y.ticks(4)).join("text").attr("x", M.l - 6).attr("y", (d) => y(d) + 4)
    .attr("text-anchor", "end").text((d) => yF(d));
  svg.append("line").attr("class", "axis-line").attr("x1", M.l).attr("x2", W0 - M.r).attr("y1", H0 - M.b).attr("y2", H0 - M.b);
  if (cfg.refLine != null) svg.append("line").attr("class", "axis-line").attr("x1", M.l).attr("x2", W0 - M.r).attr("y1", y(cfg.refLine)).attr("y2", y(cfg.refLine));
  const first = cfg.x[0], last = cfg.x[cfg.x.length - 1];
  const spanYears = (last.getTime() - first.getTime()) / (365.25 * 864e5);
  let ticks: Date[];
  if (spanYears > 2.5) {
    const yrs = d3.timeYear.range(d3.timeYear.ceil(first), last);
    const step = Math.ceil(yrs.length / Math.max(2, Math.floor((W0 - M.l - M.r) / 70)));
    ticks = yrs.filter((_, i) => i % step === 0);
  } else {
    const ms = d3.timeMonth.range(d3.timeMonth.ceil(first), last);
    const step = Math.max(1, Math.ceil(ms.length / Math.max(2, Math.floor((W0 - M.l - M.r) / 60))));
    ticks = ms.filter((_, i) => i % step === 0);
  }
  const tf = cfg.xTickFmt || (spanYears > 2.5 ? d3.timeFormat("%Y") : d3.timeFormat("%b %y"));
  svg.append("g").selectAll("text").data(ticks).join("text").attr("x", (d) => x(d)).attr("y", H0 - 8)
    .attr("text-anchor", "middle").text((d) => tf(d));
  const surface = cssVar("--panel");
  cfg.series.forEach((s) => {
    const pts = cfg.x.map((d, i) => [d, s.values[i]] as [Date, number | null]);
    if (s.area) svg.append("path").attr("fill", s.color).attr("opacity", 0.1)
      .attr("d", d3.area<[Date, number | null]>().defined((p) => p[1] != null).x((p) => x(p[0])).y0(y(y.domain()[0])).y1((p) => y(p[1] as number))(pts));
    svg.append("path").attr("fill", "none").attr("stroke", s.color).attr("stroke-width", s.width || 2)
      .attr("stroke-linejoin", "round").attr("stroke-linecap", "round")
      .attr("d", d3.line<[Date, number | null]>().defined((p) => p[1] != null).x((p) => x(p[0])).y((p) => y(p[1] as number))(pts));
    let li = s.values.length - 1;
    while (li > 0 && s.values[li] == null) li--;
    if (s.values[li] != null && !s.noDot)
      svg.append("circle").attr("cx", x(cfg.x[li])).attr("cy", y(s.values[li] as number)).attr("r", 4)
        .attr("fill", s.color).attr("stroke", surface).attr("stroke-width", 2);
  });
  const cross = svg.append("line").attr("class", "axis-line").attr("y1", M.t).attr("y2", H0 - M.b).attr("opacity", 0);
  const dots = cfg.series.map((s) => svg.append("circle").attr("r", 4).attr("fill", s.color).attr("stroke", surface).attr("stroke-width", 2).attr("opacity", 0));
  const overlay = svg.append("rect").attr("x", M.l).attr("y", M.t).attr("width", W0 - M.l - M.r).attr("height", H0 - M.t - M.b)
    .attr("fill", "transparent").attr("tabindex", 0).attr("aria-label", (cfg.label || "chart") + ". Use arrow keys to read values.");
  let idx = cfg.x.length - 1;
  const fmt = cfg.tipFmt || ((v: number) => (cfg.yFmt ? cfg.yFmt(v, true) : fmtInt(v)));
  function show(i: number, cx: number, cy: number) {
    idx = Math.max(0, Math.min(cfg.x.length - 1, i));
    const xd = cfg.x[idx];
    cross.attr("x1", x(xd)).attr("x2", x(xd)).attr("opacity", 1);
    cfg.series.forEach((s, j) => {
      const v = s.values[idx];
      dots[j].attr("cx", x(xd)).attr("cy", v == null ? -99 : y(v)).attr("opacity", v == null ? 0 : 1);
    });
    const rows = cfg.tip ? cfg.tip(idx) : cfg.series.map((s) => tipRow(s.color, s.name, s.values[idx] == null ? "–" : fmt(s.values[idx] as number)));
    showTip([h("div", { class: "tt-title" }, cfg.xLabel(idx)), ...rows], cx, cy);
  }
  const clear = () => { cross.attr("opacity", 0); dots.forEach((d) => d.attr("opacity", 0)); hideTip(); };
  overlay.on("pointermove", (ev: PointerEvent) => {
    const [px] = d3.pointer(ev, svg.node());
    show(d3.bisector((d: Date) => d).center(cfg.x, x.invert(px)), ev.clientX, ev.clientY);
  }).on("pointerleave", clear).on("blur", clear).on("keydown", (ev: KeyboardEvent) => {
    if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
    ev.preventDefault();
    const r = el.getBoundingClientRect();
    show(idx + (ev.key === "ArrowRight" ? 1 : -1), r.left + r.width / 2, r.top + 20);
  });
}
