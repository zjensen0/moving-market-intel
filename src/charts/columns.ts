import * as d3 from "d3";
import { h, cssVar } from "../lib/dom";
import { hideTip, showTip, tipRow } from "../lib/tooltip";

export interface ColCfg {
  labels: string[];
  values: (number | null)[];
  fmt: (v: number) => string;
  label: string;
  colorOf?: (v: number, i: number) => string;
  labelIf?: (v: number, i: number) => boolean;
  tipLabel?: (i: number) => string;
  height?: number;
}

/** Column chart that handles negative values (bars grow from a shared zero line). */
export function columnChart(el: HTMLElement, cfg: ColCfg) {
  el.replaceChildren();
  const W0 = Math.max(240, el.clientWidth || 400), H0 = cfg.height || 200;
  const M = { t: 18, r: 6, b: 24, l: 8 };
  const x = d3.scaleBand<number>().domain(cfg.labels.map((_, i) => i)).range([M.l, W0 - M.r]).paddingInner(0.28).paddingOuter(0.1);
  const vals = cfg.values.filter((v): v is number => v != null);
  const lo = Math.min(0, d3.min(vals) ?? 0), hi = Math.max(0, d3.max(vals) ?? 0);
  const y = d3.scaleLinear().domain([lo, hi || 1]).nice(3).range([H0 - M.b, M.t]);
  const svg = d3.select(el).append("svg").attr("viewBox", `0 0 ${W0} ${H0}`).attr("role", "img").attr("aria-label", cfg.label);
  const bw = Math.min(24, x.bandwidth());
  cfg.values.forEach((v, i) => {
    const cx = (x(i) ?? 0) + x.bandwidth() / 2;
    svg.append("text").attr("x", cx).attr("y", H0 - 7).attr("text-anchor", "middle").text(cfg.labels[i]);
    if (v == null) return;
    const top = y(Math.max(0, v)), bot = y(Math.min(0, v));
    const hgt = Math.max(1, bot - top), r = Math.min(4, hgt);
    const pos = v >= 0;
    const p = d3.path();
    if (pos) {
      p.moveTo(cx - bw / 2, bot); p.lineTo(cx - bw / 2, top + r); p.quadraticCurveTo(cx - bw / 2, top, cx - bw / 2 + r, top);
      p.lineTo(cx + bw / 2 - r, top); p.quadraticCurveTo(cx + bw / 2, top, cx + bw / 2, top + r); p.lineTo(cx + bw / 2, bot);
    } else {
      p.moveTo(cx - bw / 2, top); p.lineTo(cx - bw / 2, bot - r); p.quadraticCurveTo(cx - bw / 2, bot, cx - bw / 2 + r, bot);
      p.lineTo(cx + bw / 2 - r, bot); p.quadraticCurveTo(cx + bw / 2, bot, cx + bw / 2, bot - r); p.lineTo(cx + bw / 2, top);
    }
    p.closePath();
    svg.append("path").attr("d", p.toString()).attr("fill", cfg.colorOf ? cfg.colorOf(v, i) : cssVar("--s1"));
    const title = cfg.tipLabel ? cfg.tipLabel(i) : cfg.labels[i];
    svg.append("rect").attr("x", x(i) ?? 0).attr("y", M.t).attr("width", x.bandwidth()).attr("height", H0 - M.t - M.b)
      .attr("fill", "transparent").attr("tabindex", 0).attr("aria-label", title + ": " + cfg.fmt(v))
      .on("pointermove", (ev: PointerEvent) => showTip([h("div", { class: "tt-title" }, title), tipRow(null, "", cfg.fmt(v))], ev.clientX, ev.clientY))
      .on("pointerleave", hideTip)
      .on("focus", (ev: FocusEvent) => {
        const rr = (ev.target as Element).getBoundingClientRect();
        showTip([h("div", { class: "tt-title" }, title), tipRow(null, "", cfg.fmt(v))], rr.right, rr.top);
      })
      .on("blur", hideTip);
    if (cfg.labelIf ? cfg.labelIf(v, i) : true)
      svg.append("text").attr("class", "label-strong").attr("x", cx).attr("y", pos ? top - 5 : bot + 13).attr("text-anchor", "middle").text(cfg.fmt(v));
  });
  svg.append("line").attr("class", "axis-line").attr("x1", M.l).attr("x2", W0 - M.r).attr("y1", y(0)).attr("y2", y(0));
}
