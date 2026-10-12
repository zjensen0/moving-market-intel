// Hiring radar (Acumena admins only): moving and storage job postings in each client's markets.
import type { Ctx } from "../app";
import type { EmployerContact, OrgOverview, Posting } from "../data/types";
import { $, h, type Child } from "../lib/dom";
import { fmtInt, fmtMoney } from "../lib/format";
import { hbars } from "../charts/hbars";
import { contactAdvice, fromIndeed, matchKey, ROLE_NAMES, type Role } from "../../server/jobs";

let scope = "clients"; // "clients" | "all" | org id
let roleF: Role | "all" = "all";
let q = "";
let showAll = false;

type Kind = "client" | "competitor" | "other";
const KIND_NAMES: Record<Kind, string> = { client: "Client", competitor: "Competing mover", other: "Other employer" };

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), i = Math.floor(s.length / 2);
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
};
const payText = (p: Posting) => {
  if (p.pay_min == null && p.pay_max == null) return "–";
  const f = (v: number) => (p.pay_period === "hour" || p.pay_period === "mile" ? "$" + v.toFixed(2).replace(/\.00$/, "") : fmtMoney(v));
  const range = p.pay_min != null && p.pay_max != null && p.pay_min !== p.pay_max ? `${f(p.pay_min)}–${f(p.pay_max)}` : p.pay_min != null ? "from " + f(p.pay_min) : "up to " + f(p.pay_max as number);
  return range + (p.pay_period ? " / " + (p.pay_period === "hour" ? "hr" : p.pay_period === "week" ? "wk" : p.pay_period === "month" ? "mo" : p.pay_period === "year" ? "yr" : "mile") : "");
};
const sameCompany = (a: string | null | undefined, b: string | null | undefined) => {
  const x = matchKey(a), y = matchKey(b);
  return x.length >= 4 && y.length >= 4 && (x === y || x.includes(y) || y.includes(x));
};
const clientMarkets = (o: OrgOverview) => [...new Set([...(o.plan === "all" ? [] : o.markets), ...(o.home_cbsa ? [o.home_cbsa] : [])])];
/** Two-letter state from "Charlotte, NC" or a metro name like "Charlotte-Concord-Gastonia, NC-SC". */
const stateOf = (...texts: (string | null | undefined)[]) => {
  for (const t of texts) { const m = /,\s*([A-Z]{2})\b/.exec(t || ""); if (m) return m[1]; }
  return null;
};

export async function hiringView(el: HTMLElement, ctx: Ctx) {
  const [orgs, all, last, contactRows] = await Promise.all([ctx.ds.adminOverview(), ctx.ds.postings(), ctx.ds.lastPostingsRefresh(), ctx.ds.employerContacts().catch(() => [] as EmployerContact[])]);
  if (!orgs.length && scope === "clients") scope = "all"; // no client companies yet: show every market
  const contacts = new Map(contactRows.map((c) => [c.company_key, c]));
  const contactFor = (company: string | null) => contacts.get(matchKey(company)) || null;
  const clientCodes = [...new Set(orgs.flatMap(clientMarkets))];
  // FMCSA movers based in each metro, to tell competing movers from other employers
  const moverKeys = new Map<string, Set<string>>();
  const codes = [...new Set([...clientCodes, ...all.map((p) => p.cbsa).filter((c): c is string => !!c)])];
  await Promise.all(codes.map(async (c) => {
    const d = await ctx.detail(c).catch(() => null);
    moverKeys.set(c, new Set((d?.top || []).map((t: unknown[]) => matchKey(t[0] as string)).filter(Boolean)));
  }));
  const kindOf = (p: Posting): { kind: Kind; client?: OrgOverview } => {
    const own = orgs.find((o) => clientMarkets(o).includes(p.cbsa || "") && sameCompany(o.name, p.company));
    if (own) return { kind: "client", client: own };
    return { kind: p.cbsa && moverKeys.get(p.cbsa)?.has(matchKey(p.company)) ? "competitor" : "other" };
  };
  const name = (c: string | null) => (c ? ctx.byCode.get(c)?.n ?? c : "–");

  el.replaceChildren(h("div", null,
    h("section", { class: "block", style: "margin-top:22px" },
      h("div", { class: "panel w12 radar-controls" },
        h("div", { class: "filters" },
          h("div", { class: "f-row" },
            h("label", { for: "radar-scope" }, "Show"),
            h("select", { id: "radar-scope" },
              h("option", { value: "clients", selected: scope === "clients" }, `All client markets (${clientCodes.length})`),
              h("option", { value: "all", selected: scope === "all" }, "Every market with postings"),
              ...orgs.map((o) => h("option", { value: o.id, selected: scope === o.id }, o.name))),
            h("label", { for: "radar-q", class: "sr-only" }, "Search postings"),
            h("input", { type: "search", id: "radar-q", placeholder: "Search title or employer", value: q })),
          h("div", { class: "f-row" }, h("span", null, "Role"),
            h("div", { class: "seg", role: "group", "aria-label": "Role", id: "radar-role" },
              ...(["all", "driver", "mover", "sales", "ops", "warehouse", "office", "other"] as const).map((r) =>
                h("button", { type: "button", "data-role": r, "aria-pressed": String(r === roleF) }, r === "all" ? "All" : ROLE_NAMES[r as Role].split(" ")[0]))))),
        h("div", { class: "radar-actions" },
          h("button", { class: "btn btn-primary", type: "button", id: "radar-refresh" }, "Refresh from Adzuna"),
          h("label", { class: "btn", for: "radar-file" }, "Import Indeed sweep", h("input", { type: "file", id: "radar-file", accept: ".json,application/json", class: "sr-only" })),
          h("button", { class: "btn", type: "button", id: "radar-contacts", title: "Pull each employer's business phone and email from the FMCSA carrier register" }, "Look up FMCSA contacts"),
          h("span", { class: "sub" }, last ? `Last refresh: ${new Date(last.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} (${last.source}, ${fmtInt(last.postings)} postings)` : "Not refreshed yet"),
          h("div", { id: "radar-status", "aria-live": "polite" })))),
    h("section", { class: "block" }, h("div", { class: "tiles", id: "radar-tiles", style: "margin-top:0" })),
    h("section", { class: "block", id: "radar-clients-sec" },
      h("div", { class: "sec-head" }, h("h2", null, "By client"), h("p", null, "Openings in each client's markets: their own (a staffing lead), competing movers, and other employers chasing the same people")),
      h("div", { class: "grid" }, h("div", { class: "panel w12", id: "radar-clients" }))),
    h("section", { class: "block" },
      h("div", { class: "grid" },
        h("div", { class: "panel w12" }, h("h3", null, "Employers hiring & who to contact"), h("p", { class: "sub" }, "Most postings first. “Competing mover” means a mover headquartered in that market on the FMCSA list; branches of out-of-town movers show as other employers. Business phone and email come from the public FMCSA carrier register (click “Look up FMCSA contacts”); the named contact is whatever you add by hand, for example from the company's own website."), h("div", { id: "radar-employers" })),
        h("div", { class: "panel w12" }, h("h3", null, "Posted pay by role"), h("p", { class: "sub" }, "Median hourly pay where the posting lists it (yearly and weekly pay converted at 40 hours a week)."), h("div", { id: "radar-pay" }), h("p", { class: "foot", id: "radar-pay-foot" })))),
    h("section", { class: "block" },
      h("div", { class: "sec-head" }, h("h2", null, "Postings")),
      h("div", { class: "panel w12" }, h("div", { class: "tbl-wrap", style: "margin-top:0" }, h("table", { id: "radar-table" },
        h("thead", null, h("tr", null, ...["Posted", "Job", "Employer", "Market", "Role", "Pay", "Source"].map((t) => h("th", null, t)))), h("tbody"))),
        h("div", { class: "more" }, h("button", { class: "btn", type: "button", id: "radar-more" }, "Show all")),
        h("p", { class: "foot" }, "Sources: ", h("a", { href: "https://www.adzuna.com", target: "_blank", rel: "noopener" }, "Jobs by Adzuna"),
          " and Indeed searches. Shows postings found in a search within the last 60 days that look like moving, storage or van line jobs; the Posted date is when the employer listed it. Employer contacts are company-level business details only (FMCSA register, company websites); no individual employee records are collected. Visible to Acumena admins only.")))));

  // ---- controls
  ($("#radar-scope") as HTMLSelectElement).addEventListener("change", (e) => { scope = (e.target as HTMLSelectElement).value; showAll = false; render(); });
  ($("#radar-q") as HTMLInputElement).addEventListener("input", (e) => { q = (e.target as HTMLInputElement).value.trim().toLowerCase(); render(); });
  document.querySelectorAll<HTMLButtonElement>("#radar-role [data-role]").forEach((b) => b.addEventListener("click", () => {
    roleF = b.dataset.role as Role | "all";
    document.querySelectorAll("#radar-role [data-role]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    render();
  }));
  ($("#radar-more") as HTMLButtonElement).onclick = () => { showAll = !showAll; render(); };
  const status = $("#radar-status");
  const note = (kind: string, t: Child) => status.replaceChildren(h("div", { class: "notice notice-" + kind }, t));
  ($("#radar-contacts") as HTMLButtonElement).addEventListener("click", async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    if (ctx.ds.demo) { note("info", "In the demo the contacts are built in. On the live site this looks up every employer in view in the FMCSA carrier register."); return; }
    // employers in view that don't have a contact record yet, with the state we can tell from the posting
    const want = new Map<string, { company: string; state: string; cbsa?: string }>();
    for (const p of inScope()) {
      const key = matchKey(p.company);
      if (!p.company || !key || contacts.has(key) || want.has(key)) continue;
      const state = stateOf(p.location, p.cbsa ? ctx.byCode.get(p.cbsa)?.n : null);
      if (state) want.set(key, { company: p.company, state, cbsa: p.cbsa || undefined });
    }
    const list = [...want.values()];
    if (!list.length) { note("info", "Every employer in view already has a contact record (or has no state to search in)."); return; }
    btn.disabled = true; btn.textContent = "Looking up…";
    try {
      let found = 0;
      for (let i = 0; i < list.length; i += 20) found += (await ctx.ds.lookupEmployerContacts(list.slice(i, i + 20))).found;
      const fresh = await ctx.ds.employerContacts();
      contacts.clear(); for (const c of fresh) contacts.set(c.company_key, c);
      note("ok", `Found FMCSA records for ${found} of ${list.length} employers. The rest aren't registered carriers under that name (brokers, storage-only companies, or a different legal name).`);
      render();
    } catch (err) { note("err", (err as Error).message); }
    finally { btn.disabled = false; btn.textContent = "Look up FMCSA contacts"; }
  });
  const editContact = (cell: HTMLElement, company: string, cbsa: string | null, existing: EmployerContact | null) => {
    const nameIn = h("input", { type: "text", placeholder: "Name (e.g. owner or GM)", value: existing?.contact_name || "" }) as HTMLInputElement;
    const titleIn = h("input", { type: "text", placeholder: "Title", value: existing?.contact_title || "" }) as HTMLInputElement;
    const srcIn = h("input", { type: "text", placeholder: "Where you found it (company website, LinkedIn page…)", value: existing?.source || "" }) as HTMLInputElement;
    const save = h("button", { class: "btn btn-primary", type: "button" }, "Save") as HTMLButtonElement;
    const cancel = h("button", { class: "btn", type: "button" }, "Cancel") as HTMLButtonElement;
    cancel.onclick = () => render();
    save.onclick = async () => {
      save.disabled = true;
      try {
        const row = { company_key: matchKey(company), company, cbsa, contact_name: nameIn.value.trim() || null, contact_title: titleIn.value.trim() || null, source: srcIn.value.trim() || null };
        await ctx.ds.saveEmployerContact(row);
        const fresh = await ctx.ds.employerContacts();
        contacts.clear(); for (const c of fresh) contacts.set(c.company_key, c);
        render();
      } catch (err) { note("err", (err as Error).message); save.disabled = false; }
    };
    cell.replaceChildren(h("div", { class: "form mini" }, nameIn, titleIn, srcIn, h("div", { class: "actions" }, save, cancel)));
  };
  ($("#radar-refresh") as HTMLButtonElement).addEventListener("click", async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    const targets = scope === "clients" || scope === "all" ? clientCodes : clientMarkets(orgs.find((o) => o.id === scope) as OrgOverview);
    if (!targets.length) return note("error", "No client markets yet. Add a client company with markets on the Admin page first.");
    btn.disabled = true;
    let got = 0; const errs: string[] = [];
    try {
      for (let i = 0; i < targets.length; i += 8) {
        note("info", `Searching Adzuna… ${Math.min(i + 8, targets.length)} of ${targets.length} markets`);
        const r = await ctx.ds.refreshPostings(targets.slice(i, i + 8));
        got += r.postings; errs.push(...r.errors);
      }
      note(errs.length ? "error" : "ok", `Found ${fmtInt(got)} moving and storage postings.` + (errs.length ? ` Some searches failed: ${errs.slice(0, 2).join("; ")}` : " Reloading…"));
      if (!errs.length) setTimeout(() => ctx.rerender(), 900);
    } catch (err) { note("error", (err as Error).message); } finally { btn.disabled = false; }
  });
  ($("#radar-file") as HTMLInputElement).addEventListener("change", async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = "";
    if (!f) return;
    try {
      const raw = JSON.parse(await f.text());
      const keys = new Set<string>(); moverKeys.forEach((s) => s.forEach((k) => keys.add(k)));
      const rows = fromIndeed(Array.isArray(raw) ? raw : raw.postings || [], keys);
      if (!rows.length) return note("error", "No moving or storage postings found in that file.");
      const n = await ctx.ds.importPostings(rows);
      note("ok", `Imported ${fmtInt(n)} postings. Reloading…`);
      setTimeout(() => ctx.rerender(), 900);
    } catch (err) { note("error", "Couldn't read that file: " + (err as Error).message); }
  });

  // ---- views
  function inScope(): Posting[] {
    const codesIn = scope === "all" ? null : new Set(scope === "clients" ? clientCodes : clientMarkets(orgs.find((o) => o.id === scope) as OrgOverview));
    return all.filter((p) => (!codesIn || codesIn.has(p.cbsa || "")) && (roleF === "all" || p.role === roleF) &&
      (!q || (p.title + " " + (p.company || "")).toLowerCase().includes(q)));
  }
  function render() {
    const ps = inScope();
    const kinds = new Map(ps.map((p) => [p.id, kindOf(p)]));
    const pay = (r: Role) => median(ps.filter((p) => p.role === r && p.pay_hourly_mid != null).map((p) => p.pay_hourly_mid as number));
    const employers = new Map<string, Posting[]>();
    for (const p of ps) { const k = (p.company_norm || p.company || "Unknown") + "|" + (p.cbsa || ""); employers.set(k, [...(employers.get(k) || []), p]); }
    const tile = (label: string, value: string, note2: string) => h("div", { class: "tile" }, h("span", { class: "t-label" }, label), h("span", { class: "t-value" }, value), h("span", { class: "t-note" }, note2));
    const money = (v: number | null) => (v == null ? "–" : "$" + v.toFixed(2));
    $("#radar-tiles").replaceChildren(
      tile("Open postings", fmtInt(ps.length), `${fmtInt(new Set(ps.map((p) => p.cbsa)).size)} markets`),
      tile("Employers hiring", fmtInt(employers.size), `${fmtInt([...kinds.values()].filter((k) => k.kind === "competitor").length)} postings from competing movers`),
      tile("Client postings", fmtInt([...kinds.values()].filter((k) => k.kind === "client").length), "Staffing leads"),
      tile("Driver pay, median", money(pay("driver")), "per hour, where posted"),
      tile("Mover pay, median", money(pay("mover")), "per hour, where posted"),
      tile("Estimator pay, median", money(pay("sales")), "per hour, where posted"));

    // by client
    const showClients = scope !== "all";
    ($("#radar-clients-sec") as HTMLElement).hidden = !showClients;
    if (showClients) {
      const list = scope === "clients" ? orgs : orgs.filter((o) => o.id === scope);
      $("#radar-clients").replaceChildren(list.length ? h("div", { class: "tbl-wrap", style: "margin-top:0" }, h("table", null,
        h("thead", null, h("tr", null, h("th", null, "Client"), h("th", null, "Markets"), h("th", { class: "n" }, "Postings"), h("th", { class: "n" }, "Their own"),
          h("th", { class: "n" }, "Competing movers"), h("th", { class: "n" }, "Other employers"), h("th", { class: "n" }, "Mover pay, median"), h("th", null, "What to do"))),
        h("tbody", null, ...list.map((o) => {
          const cm = new Set(clientMarkets(o));
          const mine = ps.filter((p) => cm.has(p.cbsa || ""));
          const own = mine.filter((p) => sameCompany(o.name, p.company));
          const comp = mine.filter((p) => !own.includes(p) && kinds.get(p.id)?.kind === "competitor");
          const mp = median(mine.filter((p) => p.role === "mover" && p.pay_hourly_mid != null).map((p) => p.pay_hourly_mid as number));
          const action = own.length ? `${o.name} has ${own.length} open posting${own.length > 1 ? "s" : ""}: offer to fill them.`
            : comp.length ? `${comp.length} opening${comp.length > 1 ? "s" : ""} at competing movers, so they're competing for the same crews: offer a candidate pipeline.`
              : mine.length ? "Labor market active; check in on their hiring plans." : "No postings found in their markets.";
          return h("tr", null, h("td", null, h("b", null, o.name)), h("td", null, [...cm].map(name).join("; ") || "–"),
            h("td", { class: "n" }, fmtInt(mine.length)), h("td", { class: "n" }, own.length ? h("b", null, fmtInt(own.length)) : "0"),
            h("td", { class: "n" }, fmtInt(comp.length)), h("td", { class: "n" }, fmtInt(mine.length - own.length - comp.length)),
            h("td", { class: "n" }, money(mp)), h("td", null, action));
        })))) : h("p", { class: "sub" }, "No client companies yet."));
    }

    // employers
    const emps = [...employers.values()].sort((a, b) => b.length - a.length).slice(0, 60);
    $("#radar-employers").replaceChildren(emps.length ? h("div", { class: "tbl-wrap" }, h("table", null,
      h("thead", null, h("tr", null, h("th", null, "Employer"), h("th", null, "Market"), h("th", { class: "n" }, "Postings"), h("th", { class: "n" }, "Pay / hr"),
        h("th", null, "Reach out to"), h("th", null, "Business contact (FMCSA)"), h("th", null, "Named contact"))),
      h("tbody", null, ...emps.map((g) => {
        const k = kindOf(g[0]);
        const hrs = g.map((p) => p.pay_hourly_mid).filter((v): v is number => v != null);
        const c = contactFor(g[0].company);
        const adv = contactAdvice(g[0].company, g.length, k.kind, c?.trucks);
        const namedCell = h("td", null) as HTMLElement;
        const edit = h("button", { class: "btn btn-sm", type: "button" }, c?.contact_name ? "Edit" : "Add") as HTMLButtonElement;
        edit.onclick = () => editContact(namedCell, g[0].company || "Unknown", g[0].cbsa, c);
        namedCell.append(c?.contact_name ? h("div", null, h("b", null, c.contact_name), c.contact_title ? h("div", { class: "cell-note" }, c.contact_title) : null, c.source ? h("div", { class: "cell-note" }, "Source: " + c.source) : null) : h("span", { class: "dim" }, "–"), " ", edit);
        return h("tr", null, h("td", null, g[0].company || "Unknown", " ", h("span", { class: "tag" + (k.kind === "client" ? " tag-flag" : "") }, k.kind === "client" ? "Client: " + k.client?.name : KIND_NAMES[k.kind]),
          h("div", { class: "cell-note" }, [...new Set(g.map((p) => ROLE_NAMES[p.role].split(" ")[0]))].join(", "))),
          h("td", null, name(g[0].cbsa)), h("td", { class: "n" }, fmtInt(g.length)),
          h("td", { class: "n" }, hrs.length ? (Math.min(...hrs) === Math.max(...hrs) ? money(hrs[0]) : `${money(Math.min(...hrs))}–${money(Math.max(...hrs))}`) : "–"),
          h("td", null, adv.role, h("div", { class: "cell-note" }, adv.why)),
          h("td", null, c && (c.phone || c.email) ? h("div", null,
            c.phone ? h("div", null, h("a", { href: "tel:" + c.phone.replace(/[^\d+]/g, "") }, c.phone)) : null,
            c.email ? h("div", null, h("a", { href: "mailto:" + c.email }, c.email)) : null,
            h("div", { class: "cell-note" }, [c.legal_name ? c.legal_name : null, c.usdot ? "USDOT " + c.usdot : null, c.trucks != null ? `${fmtInt(c.trucks)} trucks` : null].filter(Boolean).join(" · ")))
            : h("span", { class: "dim" }, c ? "Not in FMCSA register" : "Not looked up yet")),
          namedCell);
      })))) : h("p", { class: "sub" }, "No postings match."));

    // pay by role
    const roles = (["driver", "mover", "sales", "ops", "warehouse", "office"] as Role[]).map((r) => ({ r, v: pay(r), n: ps.filter((p) => p.role === r && p.pay_hourly_mid != null).length }));
    hbars($("#radar-pay"), roles.map(({ r, v, n }) => ({ label: ROLE_NAMES[r], value: v, note: n ? `${n} posting${n > 1 ? "s" : ""}` : undefined, missing: "No pay posted" })), { fmt: (v) => "$" + v.toFixed(2) });
    $("#radar-pay-foot").textContent = "Posted pay is what employers advertise, often a range; it isn't what they end up paying. Per-mile driver pay is left out.";

    // postings table
    const sorted = [...ps].sort((a, b) => (b.posted_at || "").localeCompare(a.posted_at || ""));
    const rows = showAll ? sorted : sorted.slice(0, 40);
    $("#radar-table tbody").replaceChildren(...(rows.length ? rows.map((p) => {
      const k = kinds.get(p.id) as { kind: Kind; client?: OrgOverview };
      return h("tr", { class: k.kind === "client" ? "flag" : "" },
        h("td", { class: "n", style: "text-align:left" }, p.posted_at ? new Date(p.posted_at + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" }) : "–"),
        h("td", null, p.url ? h("a", { href: p.url, target: "_blank", rel: "noopener noreferrer" }, p.title) : p.title, p.job_type ? h("div", { class: "cell-note" }, p.job_type) : null),
        h("td", null, p.company || "–", h("div", { class: "cell-note" }, k.kind === "client" ? "Client" : KIND_NAMES[k.kind])),
        h("td", null, name(p.cbsa), h("div", { class: "cell-note" }, p.location || "")),
        h("td", null, ROLE_NAMES[p.role].split(" ")[0]), h("td", { class: "n" }, payText(p)), h("td", null, p.source === "adzuna" ? "Adzuna" : "Indeed"));
    }) : [h("tr", null, h("td", { colspan: 7, class: "dim" }, all.length ? "No postings match these filters." : "No postings yet. Click “Refresh from Adzuna” or import an Indeed sweep."))]));
    const more = $("#radar-more") as HTMLButtonElement;
    more.hidden = sorted.length <= 40;
    more.textContent = showAll ? "Show fewer" : `Show all ${fmtInt(sorted.length)}`;
  }
  render();
  // refresh automatically when the last Adzuna pull is over a day old (live site only)
  if (!ctx.ds.demo && clientCodes.length && (!last || Date.now() - new Date(last.created_at).getTime() > 864e5)) {
    if (last) ($("#radar-refresh") as HTMLButtonElement).click(); // Adzuna has worked before: refresh on its own
    else note("info", "No Adzuna refresh yet. Click “Refresh from Adzuna” once the Adzuna keys are added in Cloudflare.");
  }
}
