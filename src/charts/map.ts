import * as d3 from "d3";
import * as topojson from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { MetroDetail, MetroIndexRow } from "../data/types";
import { h, cssVar } from "../lib/dom";
import { fmtInt } from "../lib/format";
import { hideTip, showTip, tipRow } from "../lib/tooltip";
import { city } from "../market/geo";

export type LaneDir = "both" | "out" | "in";
export interface DrawnLane { dir: "out" | "in"; l: [string, number, number | null, number, number] }

let statesTopo: Topology | null = null;
export async function loadStates(): Promise<Topology> {
  if (!statesTopo) statesTopo = (await import("../../data/us-states-albers.json")).default as unknown as Topology;
  return statesTopo;
}

/** US map with curved lines from the metro to its top moving partners (out = orange, in = blue). */
export function drawLanesMap(el: HTMLElement, m: MetroDetail, byCode: Map<string, MetroIndexRow>, topo: Topology,
                             dirSel: LaneDir, longOnly: boolean): DrawnLane[] {
  el.replaceChildren();
  const svg = d3.select(el).append("svg").attr("viewBox", "0 0 975 610").attr("role", "img").attr("aria-label", "Map of the top moving lanes for " + m.n);
  const states = topojson.feature(topo, topo.objects.states as GeometryCollection);
  svg.append("g").selectAll("path").data((states as unknown as { features: d3.GeoPermissibleObjects[] }).features).join("path")
    .attr("class", "state").attr("d", d3.geoPath() as never);
  const proj = d3.geoAlbersUsa().scale(1300).translate([487.5, 305]);
  const here = proj([m.lon, m.lat]);
  const lanes: DrawnLane[] = [];
  for (const dir of ["out", "in"] as const) {
    if (dirSel !== "both" && dirSel !== dir) continue;
    (m.ln[dir] || []).filter((l: number[]) => !longOnly || l[3] >= 100).slice(0, 10).forEach((l: DrawnLane["l"]) => lanes.push({ dir, l }));
  }
  const maxR = d3.max(lanes, (d) => d.l[1]) || 1;
  const wScale = d3.scaleSqrt().domain([0, maxR]).range([0.8, 7]);
  const g = svg.append("g");
  const s1 = cssVar("--s1"), s2 = cssVar("--s2"), surface = cssVar("--panel");
  lanes.slice().sort((a, b) => a.l[1] - b.l[1]).forEach(({ dir, l }) => {
    const o = byCode.get(l[0]);
    if (!o || !here) return;
    const there = proj([o.lon, o.lat]);
    if (!there) return;
    const dx = there[0] - here[0], dy = there[1] - here[1], dist = Math.hypot(dx, dy) || 1;
    const bend = (dir === "out" ? 1 : -1) * Math.min(70, dist * 0.18);
    const cx = (here[0] + there[0]) / 2 - (dy / dist) * bend, cy = (here[1] + there[1]) / 2 + (dx / dist) * bend;
    const d = `M${here[0]},${here[1]} Q${cx},${cy} ${there[0]},${there[1]}`;
    const color = dir === "out" ? s2 : s1;
    const tip = () => [
      h("div", { class: "tt-title" }, dir === "out" ? m.n + " → " + o.n : o.n + " → " + m.n),
      tipRow(color, "households a year", fmtInt(l[1])),
      tipRow(null, "the other way", fmtInt(l[2])),
      tipRow(null, "miles", fmtInt(l[3])),
    ];
    const hit = g.append("path").attr("class", "arc-hit").attr("d", d).attr("tabindex", 0)
      .attr("aria-label", (dir === "out" ? "To " : "From ") + o.n + ": " + fmtInt(l[1]) + " households a year");
    const arc = g.append("path").attr("class", "arc").attr("d", d).attr("stroke", color).attr("stroke-width", wScale(l[1]));
    hit.on("pointermove", (ev: PointerEvent) => { arc.classed("hot", true); showTip(tip(), ev.clientX, ev.clientY); })
      .on("pointerleave", () => { arc.classed("hot", false); hideTip(); })
      .on("focus", (ev: FocusEvent) => {
        arc.classed("hot", true);
        const r = (ev.target as Element).getBoundingClientRect();
        showTip(tip(), r.left + r.width / 2, r.top + r.height / 2);
      })
      .on("blur", () => { arc.classed("hot", false); hideTip(); });
    g.append("circle").attr("cx", there[0]).attr("cy", there[1]).attr("r", 4).attr("fill", color).attr("stroke", surface).attr("stroke-width", 2).attr("pointer-events", "none");
    if (l[1] >= maxR * 0.35) g.append("text").attr("class", "label-2").attr("x", there[0] + 7).attr("y", there[1] - 6).attr("pointer-events", "none").text(city(o.n));
  });
  if (here) {
    g.append("circle").attr("cx", here[0]).attr("cy", here[1]).attr("r", 7).attr("fill", cssVar("--ink")).attr("stroke", cssVar("--lane")).attr("stroke-width", 3);
    g.append("text").attr("class", "label-strong").attr("x", here[0] + 11).attr("y", here[1] + 4).text(city(m.n));
  }
  return lanes;
}
