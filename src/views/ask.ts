// Ask Acumena: plain-English questions answered by AI from the market data.
import type { Ctx } from "../app";
import { $, h, type Child } from "../lib/dom";
import { summarize } from "../business/analytics";
import { fmtPct } from "../lib/format";

interface Turn { q: string; a?: string; error?: string }
const history: Turn[] = [];
let business: Record<string, unknown> | null | undefined;

const EXAMPLES = [
  "Where should we add long-distance routes from Charlotte?",
  "Which mid-size metros in the Southeast have the least competition?",
  "What's the outlook for Charlotte this fall?",
  "Which Texas metros are growing fastest, and how many movers are there?",
  "How do wages for moving crews compare across my markets?",
  "Which large movers have the worst safety records in my home market?",
];

export async function askView(el: HTMLElement, ctx: Ctx) {
  const examples = ctx.ds.demo ? EXAMPLES.slice(0, 3) : EXAMPLES;
  const input = h("textarea", { id: "ask-input", rows: 2, maxlength: 500, placeholder: "e.g. Which metros near us have the most households moving in but few movers?", "aria-label": "Your question" });
  const send = h("button", { class: "btn btn-primary", type: "submit" }, "Ask");
  const form = h("form", { class: "ask-form" }, input, send);
  const thread = h("div", { class: "ask-thread", id: "ask-thread", "aria-live": "polite" });
  el.replaceChildren(h("section", { class: "block", style: "margin-top:22px" },
    h("div", { class: "grid" },
      h("div", { class: "panel w8 ask-panel" },
        form,
        h("div", { class: "ask-examples" }, h("span", { class: "sub" }, "Try:"),
          ...examples.map((q) => h("button", { class: "chip", type: "button", onclick: () => { input.value = q; void submit(); } }, q))),
        thread),
      h("div", { class: "panel w4" },
        h("h3", null, "What it can answer"),
        h("ul", { class: "checks" },
          h("li", null, "Rankings across all 387 metros: size, growth, competition, the 90-day outlook."),
          h("li", null, "Deep dives on markets in your plan: lanes, competing movers, safety, pay, costs."),
          h("li", null, "Your own numbers, if you've uploaded jobs: share, prices, untapped lanes."),
          h("li", null, "Industry trends: moving prices, mortgage rates, diesel, jobs.")),
        h("p", { class: "foot" }, ctx.ds.demo ? "The demo shows example answers. The live app answers any question with AI, using only the data in these pages."
          : "Answers are written by AI (Claude) from the same data as these pages, and say where numbers come from. Check anything important against the market pages. Questions are logged for quality and limited per person per day.")))));
  renderThread();
  form.addEventListener("submit", (e) => { e.preventDefault(); void submit(); });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(); } });
  input.focus();

  async function submit() {
    const q = input.value.trim();
    if (!q || send.disabled) return;
    input.value = "";
    send.disabled = true;
    const turn: Turn = { q };
    history.unshift(turn);
    renderThread();
    try {
      if (business === undefined) business = await businessContext(ctx);
      const out = await ctx.ds.ask(q, { market: ctx.current, business });
      turn.a = out.answer;
    } catch (e) {
      turn.error = (e as Error).message;
    } finally {
      send.disabled = false;
      renderThread();
    }
  }
  function renderThread() {
    thread.replaceChildren(...history.map((t) => h("div", { class: "ask-turn" },
      h("p", { class: "ask-q" }, t.q),
      t.error ? h("div", { class: "notice notice-error" }, t.error)
        : t.a ? h("div", { class: "ask-a" }, ...renderAnswer(t.a, ctx))
          : h("p", { class: "sub ask-wait" }, "Looking through the data…"))));
  }
}

/** A compact summary of the client's own jobs, so answers can reference their business. */
async function businessContext(ctx: Ctx): Promise<Record<string, unknown> | null> {
  const home = ctx.session.org?.home_cbsa;
  if (!ctx.session.org || !home) return null;
  try {
    const [jobs, detail] = await Promise.all([ctx.ds.jobs(), ctx.detail(home)]);
    if (!jobs.length || !detail) return null;
    const s = summarize(jobs, detail, ctx.N, ctx.byCode);
    if (!s) return null;
    return {
      period: `${s.windowStart} to ${s.windowEnd}`, jobs_last_12_months: s.jobs12, jobs_prior_12_months: s.jobsPrior12,
      revenue_last_12_months: s.revenue12 && Math.round(s.revenue12), average_job: s.avgRevenue12 && Math.round(s.avgRevenue12),
      share_of_home_market_moves: s.marketShare != null ? fmtPct(s.marketShare, 2) : null,
      long_distance_share_of_jobs: s.longShare12 != null ? fmtPct(s.longShare12) : null,
      long_distance_share_of_revenue: s.longRevShare12 != null ? fmtPct(s.longRevShare12) : null,
      win_rate: s.winRate != null ? fmtPct(s.winRate) : null,
      price_change_past_year: s.price?.yourChange != null ? fmtPct(s.price.yourChange, 1) : null,
      lanes_vs_market: s.lanes.slice(0, 8).map((l) => ({ lane: (l.dir === "out" ? "to " : "from ") + l.name, households_per_year: l.households, your_jobs: l.yourJobs })),
      top_lead_sources: s.bySource.slice(0, 4).map((x) => ({ source: x.label, jobs: x.jobs })),
      booking_forecast_next_3_months: s.outlook ? { months: s.outlook.months, jobs: s.outlook.f, low: s.outlook.lo, high: s.outlook.hi } : null,
    };
  } catch {
    return null;
  }
}

/** Minimal, safe Markdown: paragraphs, "- " bullets, **bold**, and links to app pages or https. Never uses innerHTML. */
export function renderAnswer(text: string, ctx: Ctx): Node[] {
  const inline = (s: string): Child[] => {
    const out: Child[] = [];
    const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
    let last = 0, m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      if (m.index > last) out.push(s.slice(last, m.index));
      if (m[1]) out.push(h("strong", null, m[1]));
      else {
        const href = m[3];
        if (/^#\/market\/\d{5}$/.test(href) || /^#\/(compare|business|methods)$/.test(href)) {
          out.push(h("a", { href, onclick: (e: Event) => { e.preventDefault(); ctx.go(href); } }, m[2]));
        } else if (/^https:\/\//.test(href)) out.push(h("a", { href, target: "_blank", rel: "noopener noreferrer" }, m[2]));
        else out.push(m[2]);
      }
      last = re.lastIndex;
    }
    if (last < s.length) out.push(s.slice(last));
    return out;
  };
  const nodes: Node[] = [];
  let list: HTMLUListElement | null = null;
  for (const raw of text.split(/\n/)) {
    const line = raw.trim();
    if (!line) { list = null; continue; }
    const b = line.match(/^[-*•]\s+(.*)$/) || line.match(/^\d+\.\s+(.*)$/);
    if (b) {
      if (!list) { list = h("ul"); nodes.push(list); }
      list.append(h("li", null, ...inline(b[1])));
    } else {
      list = null;
      const hd = line.match(/^#{1,4}\s+(.*)$/);
      nodes.push(hd ? h("h4", null, ...inline(hd[1])) : h("p", null, ...inline(line)));
    }
  }
  return nodes;
}
