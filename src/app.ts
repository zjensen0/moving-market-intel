// App shell: masthead with the market picker, navigation, routing between pages.
import type { DataSource, MetroDetail, MetroIndexRow, NationalData, Session } from "./data/types";
import { $, h } from "./lib/dom";
import { fmtCompact, fmtInt } from "./lib/format";
import { load, save } from "./lib/store";
import { hideTip } from "./lib/tooltip";
import { rank, rankedCount, rescore, score } from "./market/scoring";
import type { DemoSource, DemoRole } from "./data/demo";
import { brandBlock } from "./brand";
import { themeSwitch } from "./theme";

export interface Ctx {
  ds: DataSource;
  session: Session;
  N: NationalData;
  index: MetroIndexRow[];
  byCode: Map<string, MetroIndexRow>;
  allowed(c: string): boolean;
  current: string;
  detail(c: string): Promise<MetroDetail | null>;
  go(route: string): void;
  zipMap(): Promise<Record<string, string>>;
  renderMasthead(): void;
  rerender(): void;
}

type Route = { page: "market"; code: string } | { page: "compare" | "business" | "admin" | "methods" | "ask" };

export function parseRoute(hash: string): Route | null {
  const m = hash.match(/^#\/market\/(\d{5})$/);
  if (m) return { page: "market", code: m[1] };
  const p = hash.replace(/^#\//, "");
  if (p === "compare" || p === "business" || p === "admin" || p === "methods" || p === "ask") return { page: p };
  return null;
}

export async function startApp(root: HTMLElement, ds: DataSource, session: Session,
                               zipMap: () => Promise<Record<string, string>>) {
  const [N, index] = await Promise.all([ds.national(), ds.metroIndex()]);
  index.sort((a, b) => b.pop25 - a.pop25);
  rescore(index);
  const byCode = new Map(index.map((m) => [m.c, m]));
  const cache = new Map<string, Promise<MetroDetail | null>>();
  const allowed = (c: string) => session.isAdmin || session.org?.plan === "all" || session.markets.includes(c);
  const firstAllowed = session.org?.home_cbsa && byCode.has(session.org.home_cbsa) ? session.org.home_cbsa
    : index.find((m) => allowed(m.c))?.c || index[0].c;
  const saved = load<string>("mmi.metro");

  const ctx: Ctx = {
    ds, session, N, index, byCode, allowed, zipMap,
    current: saved && byCode.has(saved) && allowed(saved) ? saved : firstAllowed,
    detail(c) {
      if (!cache.has(c)) cache.set(c, ds.metro(c));
      return cache.get(c) as Promise<MetroDetail | null>;
    },
    go(route) { if (location.hash === route) render(); else location.hash = route; },
    renderMasthead: () => renderMasthead(),
    rerender: () => render(),
  };

  // ------------------------------------------------------------------ skeleton
  root.replaceChildren(h("div", { class: "wrap" },
    h("header", null,
      ds.demo ? demoBar(ds as DemoSource) : null,
      h("div", { class: "sign", id: "top" },
        h("div", { class: "exit-tab", id: "rank-tab" }, ""),
        h("div", { class: "sign-row" },
          h("div", { class: "sign-left" },
            brandBlock(),
            h("p", { class: "eyebrow" }, "Moving Market Intelligence"),
            h("div", { class: "picker", id: "picker" }),
            h("p", { class: "sign-sub", id: "sign-sub" }, " ")),
          h("div", { class: "sign-score", id: "sign-score" }))),
      h("div", { class: "bar" },
        h("div", { class: "bar-row" },
          h("nav", { class: "views", "aria-label": "Pages" },
            tab("market", "Market snapshot"), tab("compare", "Compare markets"), tab("ask", "✦ Ask Acumena"),
            session.org || ds.demo ? tab("business", "Your business") : null,
            session.isAdmin ? tab("admin", "Admin") : null,
            tab("methods", "Data & methods")),
          account()),
        h("nav", { class: "jump", id: "jump", "aria-label": "Snapshot sections" },
          ...[["s-overview", "Overview"], ["s-demand", "Demand"], ["s-lanes", "Lanes"], ["s-competition", "Competition"], ["s-labor", "Labor & costs"]]
            .map(([id, t]) => h("a", { href: "#" + id, "data-jump": id, onclick: (e: Event) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: "smooth" }); } }, t))))),
    h("main", { id: "main" }),
    h("footer", null,
      h("span", null, h("span", { class: "foot-brand" }, "Acumena Analytics"), " · Built from public data as of " + longDate(N.built) + "."),
      h("span", { id: "foot-metro" }))));

  function tab(page: string, label: string) {
    return h("button", { type: "button", class: "tab", "data-page": page, onclick: () => ctx.go(page === "market" ? "#/market/" + ctx.current : "#/" + page) }, label);
  }
  function account() {
    if (ds.demo) return h("div", { class: "account" }, themeSwitch(), h("span", { class: "tag" }, "Demo"));
    return h("div", { class: "account" }, themeSwitch(),
      h("span", { class: "acct-name" }, session.org ? session.org.name : session.isAdmin ? "Admin" : ""),
      h("span", { class: "acct-email" }, session.email),
      h("button", { type: "button", class: "btn btn-quiet", onclick: async () => { await ds.signOut(); location.hash = ""; location.reload(); } }, "Sign out"));
  }

  // ------------------------------------------------------------------ masthead
  let mode: "market" | "page" = "market";
  let pageTitle = "", pageSub = "";
  function renderMasthead() {
    const picker = $("#picker"), sub = $("#sign-sub"), scoreBox = $("#sign-score"), tabEl = $("#rank-tab");
    if (mode === "page") {
      picker.replaceChildren(h("h1", { class: "sign-title" }, pageTitle));
      sub.textContent = pageSub;
      scoreBox.replaceChildren();
      tabEl.textContent = ds.demo ? "DEMO" : "ACCOUNT";
      $("#foot-metro").textContent = "";
      return;
    }
    const m = byCode.get(ctx.current) as MetroIndexRow;
    picker.replaceChildren(metroPicker(ctx));
    sub.textContent = m.t + " · " + fmtInt(m.pop25) + " people (2025)";
    const s = score(m.c), r = rank(m.c);
    scoreBox.replaceChildren(
      h("span", { class: "score-label" }, "Opportunity score"),
      h("span", { class: "score-value" }, s == null ? "–" : String(Math.round(s))),
      h("span", { class: "score-note" }, "out of 100"));
    tabEl.textContent = r ? `RANK ${r} OF ${rankedCount()}` : "NOT RANKED";
    $("#foot-metro").textContent = "Showing " + m.t + ", metro code " + m.c + ".";
  }

  // ------------------------------------------------------------------ routing
  let renderToken = 0;
  async function render() {
    hideTip();
    const token = ++renderToken;
    let route = parseRoute(location.hash);
    if (!route) { location.replace("#/market/" + ctx.current); return; }
    if (route.page === "admin" && !session.isAdmin) { location.replace("#/market/" + ctx.current); return; }
    if (route.page === "market") {
      if (!byCode.has(route.code)) { location.replace("#/market/" + ctx.current); return; }
      ctx.current = route.code;
      if (allowed(route.code)) save("mmi.metro", route.code);
    }
    document.querySelectorAll<HTMLButtonElement>(".views .tab").forEach((b) =>
      b.setAttribute("aria-current", b.dataset.page === route!.page ? "page" : "false"));
    ($("#jump") as HTMLElement).hidden = route.page !== "market" || !allowed(ctx.current);
    const main = $("#main");
    if (route.page === "business" || route.page === "admin" || route.page === "ask") {
      mode = "page";
      pageTitle = route.page === "admin" ? "Admin" : route.page === "ask" ? "Ask Acumena" : session.org?.name || "Your business";
      pageSub = route.page === "ask" ? "Ask anything about your markets, in plain English"
        : route.page === "admin" ? "Client companies, their markets and invite codes"
        : session.org?.home_cbsa ? "Home market: " + (byCode.get(session.org.home_cbsa)?.t ?? session.org.home_cbsa) : "Your jobs against your market";
    } else mode = "market";
    renderMasthead();
    main.replaceChildren(h("p", { class: "loading" }, "Loading…"));
    try {
      const view = await loadView(route.page, ctx);
      if (token !== renderToken) return;
      await view(main, ctx);
    } catch (e) {
      if (token !== renderToken) return;
      main.replaceChildren(h("div", { class: "notice notice-error" }, "Couldn't load this page: " + (e as Error).message));
    }
    window.scrollTo({ top: 0 });
  }
  window.addEventListener("hashchange", render);
  let rt: number | undefined;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = window.setTimeout(() => document.dispatchEvent(new Event("mmi:redraw")), 150); });
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener("change", () => document.dispatchEvent(new Event("mmi:redraw")));
  await render();
  return ctx;
}

async function loadView(page: Route["page"], _ctx: Ctx): Promise<(el: HTMLElement, ctx: Ctx) => Promise<void> | void> {
  switch (page) {
    case "market": return (await import("./views/snapshot")).marketView;
    case "compare": return (await import("./views/compare")).compareView;
    case "business": return (await import("./views/business")).businessView;
    case "admin": return (await import("./views/admin")).adminView;
    case "ask": return (await import("./views/ask")).askView;
    default: return (await import("./views/methods")).methodsView;
  }
}

function longDate(d: string) {
  const dt = new Date(d + "T12:00:00");
  return dt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function demoBar(ds: DemoSource) {
  const set = (r: DemoRole) => { ds.setDemoRole(r); location.reload(); };
  const role = ds.demoRole();
  return h("div", { class: "demo-bar" },
    h("span", null, h("b", null, "Demo"), " with made-up client data. Viewing as:"),
    h("div", { class: "seg", role: "group", "aria-label": "View as" },
      h("button", { type: "button", "aria-pressed": String(role === "client"), onclick: () => set("client") }, "Client: Sample Moving Co."),
      h("button", { type: "button", "aria-pressed": String(role === "admin"), onclick: () => set("admin") }, "You (admin)")));
}

// ------------------------------------------------------------------ metro picker (combobox)
function metroPicker(ctx: Ctx) {
  const cur = ctx.byCode.get(ctx.current) as MetroIndexRow;
  const input = h("input", { id: "metro-input", type: "text", autocomplete: "off", spellcheck: "false", role: "combobox",
    "aria-expanded": "false", "aria-controls": "metro-options", "aria-autocomplete": "list", placeholder: "Type a city or state", value: cur.n });
  const list = h("ul", { id: "metro-options", class: "options", role: "listbox", "aria-label": "Metro areas", hidden: true });
  const search = ctx.index.map((m) => ({ m, key: (m.t + " " + m.st.join(" ")).toLowerCase() }));
  let items: HTMLLIElement[] = [], active = -1;
  const mark = () => {
    items.forEach((li, i) => li.setAttribute("aria-selected", i === active ? "true" : "false"));
    if (active >= 0) { input.setAttribute("aria-activedescendant", items[active].id); items[active].scrollIntoView({ block: "nearest" }); }
  };
  const open = (q: string) => {
    const qq = q.trim().toLowerCase();
    const hits = (qq ? search.filter((x) => x.key.includes(qq)) : search).slice(0, 40);
    list.replaceChildren();
    items = hits.map((x) => {
      const locked = !ctx.allowed(x.m.c);
      const li = h("li", { role: "option", id: "opt-" + x.m.c, "aria-selected": "false", "data-c": x.m.c, class: locked ? "locked" : "" },
        h("span", null, x.m.t), h("span", null, locked ? "Not in your plan" : fmtCompact(x.m.pop25) + " people"));
      li.addEventListener("mousedown", (e) => { e.preventDefault(); choose(x.m.c); });
      list.append(li);
      return li;
    });
    if (!items.length) list.append(h("li", { class: "empty" }, "No metro matches. Try a city or a state code such as TX."));
    active = items.length ? 0 : -1;
    mark();
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
  };
  const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); };
  const choose = (c: string) => { close(); input.blur(); ctx.go("#/market/" + c); };
  input.addEventListener("focus", () => { input.select(); open(""); });
  input.addEventListener("input", () => open(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); if (list.hidden) open(input.value); else { active = Math.min(items.length - 1, active + 1); mark(); } }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(0, active - 1); mark(); }
    else if (e.key === "Enter") { e.preventDefault(); if (active >= 0 && items[active]) choose(items[active].dataset.c as string); }
    else if (e.key === "Escape") { close(); input.value = cur.n; input.blur(); }
  });
  input.addEventListener("blur", () => setTimeout(() => { close(); input.value = cur.n; }, 120));
  return h("div", { class: "picker-box" },
    h("label", { for: "metro-input", class: "sr-only" }, "Choose a metro area"),
    input,
    svgCaret(),
    list);
}
function svgCaret() {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("class", "caret"); s.setAttribute("viewBox", "0 0 20 20"); s.setAttribute("aria-hidden", "true");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", "M4 7l6 6 6-6"); p.setAttribute("fill", "none"); p.setAttribute("stroke", "currentColor");
  p.setAttribute("stroke-width", "2.4"); p.setAttribute("stroke-linecap", "round"); p.setAttribute("stroke-linejoin", "round");
  s.append(p);
  return s;
}
