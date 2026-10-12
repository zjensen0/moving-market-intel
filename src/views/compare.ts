// Compare markets: rank all 387 metros with weights the user can change.
import type { Ctx } from "../app";
import type { MetroIndexRow, ScoreParts } from "../data/types";
import { $, $$, h } from "../lib/dom";
import { fmtCompact, fmtInt } from "../lib/format";
import { COMP, rank, rescore, resetWeights, score, setWeight, sizeClass, weights } from "../market/scoring";
import { stateNameBare } from "../market/geo";

type SortKey = "rank" | "name" | "score" | keyof ScoreParts | "hhm" | "dmr" | "movers";
let sortKey: SortKey = "score";
let sortDir = -1;
let sizeF = "all";
let stateF = "";
let searchF = "";
let planOnly = false;

export function compareView(el: HTMLElement, ctx: Ctx) {
  const limited = !ctx.session.isAdmin && ctx.session.org?.plan !== "all";
  const states = [...new Set(ctx.index.flatMap((m) => m.st))].sort((a, b) => stateNameBare(a).localeCompare(stateNameBare(b)));
  const cols: [SortKey, string, string][] = [
    ["rank", "Rank", "n"], ["name", "Metro", ""], ["score", "Score", ""], ["size", "Size", "n"], ["mom", "Momentum", "n"],
    ["room", "Room", "n"], ["val", "Value", "n"], ["lab", "Labor", "n"], ["hhm", "Moves / yr", "n"],
    ["dmr", "Net migration per 1K", "n"], ["movers", "Movers", "n"],
  ];
  el.replaceChildren(h("section", { class: "block", style: "margin-top:22px" },
    h("div", { class: "sec-head" }, h("h2", null, "Compare markets"), h("p", null, "Rank all 387 U.S. metros by what matters to your business")),
    h("div", { class: "cmp-controls" },
      h("div", { class: "panel" },
        h("h3", null, "Weights"),
        h("p", { class: "sub" }, "Slide to change how much each part counts. The score updates as you go."),
        h("div", { class: "weights", id: "weights" }),
        h("div", { class: "more" }, h("button", { class: "btn", type: "button", id: "reset-w" }, "Reset weights"))),
      h("div", { class: "panel" },
        h("h3", null, "Filter"),
        h("div", { class: "filters" },
          h("div", { class: "f-row" }, h("span", null, "Size"),
            h("div", { class: "seg", role: "group", "aria-label": "Metro size", id: "size-seg" },
              ...[["all", "All"], ["big", "1M+"], ["mid", "250K–1M"], ["small", "Under 250K"]].map(([v, t]) =>
                h("button", { type: "button", "data-size": v, "aria-pressed": String(v === sizeF) }, t)))),
          h("div", { class: "f-row" },
            h("label", { for: "state-sel" }, "State"),
            h("select", { id: "state-sel" }, h("option", { value: "" }, "All states"),
              ...states.map((s) => h("option", { value: s, selected: s === stateF }, stateNameBare(s)))),
            h("label", { for: "cmp-search", class: "sr-only" }, "Search metros"),
            h("input", { type: "search", id: "cmp-search", placeholder: "Search a metro", value: searchF })),
          limited ? h("label", { class: "f-row check" }, h("input", { type: "checkbox", id: "plan-only", checked: planOnly }), " Only markets in my plan") : null,
          h("p", { class: "sub", id: "cmp-count" })))),
    h("div", { class: "panel w12", style: "margin-top:14px" },
      h("div", { class: "tbl-wrap", style: "margin-top:0" },
        h("table", { id: "cmp-table" },
          h("thead", null, h("tr", null, ...cols.map(([k, t, cls]) =>
            h("th", { class: ("sortable " + cls).trim(), "data-k": k, scope: "col", tabindex: 0 }, t)))),
          h("tbody"))),
      h("p", { class: "foot" }, "Size, Momentum, Room, Value and Labor are rankings from 0 to 100 against all 387 metros. Select a row to open that market's snapshot." +
        (limited ? " Markets marked “Not in your plan” show a preview only." : "")))));

  // weights
  const buildWeights = () => {
    const W = weights();
    $("#weights").replaceChildren(...COMP.map((c) => {
      const id = "w-" + c.k;
      const out = h("output", { for: id }, String(W[c.k]));
      const r = h("input", { type: "range", id, min: "0", max: "50", step: "5", value: String(W[c.k]), "aria-label": c.name + " weight" });
      r.addEventListener("input", () => {
        setWeight(c.k, +r.value);
        out.textContent = r.value;
        changed();
      });
      return h("div", { class: "wrow" }, h("label", { for: id }, c.name), r, out);
    }));
  };
  const changed = () => { rescore(ctx.index); renderTable(); ctx.renderMasthead(); };
  ($("#reset-w") as HTMLButtonElement).addEventListener("click", () => { resetWeights(); buildWeights(); changed(); });
  buildWeights();

  // filters
  $$<HTMLButtonElement>("#size-seg [data-size]").forEach((b) => b.addEventListener("click", () => {
    sizeF = b.dataset.size as string;
    $$("#size-seg [data-size]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    renderTable();
  }));
  ($("#state-sel") as HTMLSelectElement).addEventListener("change", (e) => { stateF = (e.target as HTMLSelectElement).value; renderTable(); });
  ($("#cmp-search") as HTMLInputElement).addEventListener("input", (e) => { searchF = (e.target as HTMLInputElement).value.trim().toLowerCase(); renderTable(); });
  ($("#plan-only") as HTMLInputElement | null)?.addEventListener("change", (e) => { planOnly = (e.target as HTMLInputElement).checked; renderTable(); });

  // sorting
  $$<HTMLTableCellElement>("#cmp-table th.sortable").forEach((th) => {
    const sortBy = () => {
      const k = th.dataset.k as SortKey;
      if (sortKey === k) sortDir = -sortDir;
      else { sortKey = k; sortDir = k === "name" || k === "rank" ? 1 : -1; }
      renderTable();
    };
    th.addEventListener("click", sortBy);
    th.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); sortBy(); } });
  });

  function sortVal(m: MetroIndexRow, k: SortKey): number | string | null {
    switch (k) {
      case "rank": return rank(m.c) ?? 9999;
      case "name": return m.n;
      case "score": return score(m.c);
      case "hhm": return m.hhm;
      case "dmr": return m.dmr;
      case "movers": return m.movers;
      default: return m.sc[k];
    }
  }

  function renderTable() {
    const rows = ctx.index.filter((m) => (sizeF === "all" || sizeClass(m) === sizeF) && (!stateF || m.st.includes(stateF)) &&
      (!searchF || m.t.toLowerCase().includes(searchF)) && (!planOnly || ctx.allowed(m.c)));
    rows.sort((a, b) => {
      const va = sortVal(a, sortKey), vb = sortVal(b, sortKey);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "string") return sortDir * va.localeCompare(vb as string);
      return sortDir * (va - (vb as number));
    });
    $$("#cmp-table th.sortable").forEach((th) => {
      if ((th as HTMLElement).dataset.k === sortKey) th.setAttribute("aria-sort", sortDir > 0 ? "ascending" : "descending");
      else th.removeAttribute("aria-sort");
    });
    $("#cmp-count").textContent = rows.length + " of " + ctx.index.length + " metros shown";
    const pctCell = (v: number | null) => h("td", { class: "n" }, v == null ? "–" : String(Math.round(v)));
    $("#cmp-table tbody").replaceChildren(...rows.map((m) => {
      const s = score(m.c), mine = ctx.allowed(m.c);
      const tr = h("tr", { class: "click" + (ctx.current === m.c ? " current" : "") + (mine ? "" : " not-mine"), tabindex: "0", "aria-label": "Open " + m.n },
        h("td", { class: "n" }, String(rank(m.c) || "–")),
        h("td", null, m.n, h("div", { class: "cell-note" }, fmtCompact(m.pop25) + " people", mine ? null : h("span", { class: "tag tag-lock" }, "Not in your plan"))),
        h("td", null, h("div", { class: "scorebar" }, h("b", { class: "num" }, s == null ? "–" : String(Math.round(s))),
          h("div", { class: "sb-track" }, h("div", { class: "sb-fill", style: "width:" + (s || 0) + "%" })))),
        pctCell(m.sc.size), pctCell(m.sc.mom), pctCell(m.sc.room), pctCell(m.sc.val), pctCell(m.sc.lab),
        h("td", { class: "n" }, m.hhm ? fmtCompact(m.hhm) : "–"),
        h("td", { class: "n" }, m.dmr == null ? "–" : (m.dmr > 0 ? "+" : "") + m.dmr.toFixed(1)),
        h("td", { class: "n" }, fmtInt(m.movers)));
      const open = () => ctx.go("#/market/" + m.c);
      tr.addEventListener("click", open);
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
      return tr;
    }));
  }
  renderTable();
}
