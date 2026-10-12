import { h, type Child } from "../lib/dom";
import { fmtInt } from "../lib/format";

export interface BarRow { label: Child; value: number | null; muted?: boolean; note?: string; missing?: string }

/** Horizontal bars built from HTML (labels wrap, values sit at the bar tip). */
export function hbars(el: HTMLElement, rows: BarRow[], opts: { fmt?: (v: number) => string; max?: number } = {}) {
  const max = opts.max || Math.max(...rows.map((r) => r.value || 0)) || 1;
  el.replaceChildren(h("div", { class: "hbars" }, rows.map((r) => {
    const w = r.value == null ? 0 : Math.max(0.5, (r.value / max) * 100);
    return h("div", { class: "hbar" },
      h("span", { class: "hb-label" }, r.label),
      h("span", { class: "hb-track" },
        r.value == null ? null : h("span", { class: "hb-bar" + (r.muted ? " muted" : ""), style: `width:calc(${w}% - ${w > 60 ? 70 : 0}px)` }),
        h("span", { class: "hb-val" }, r.value == null ? r.missing || "Not published" : opts.fmt ? opts.fmt(r.value) : fmtInt(r.value),
          r.note ? h("small", null, " " + r.note) : null)));
  })));
}
