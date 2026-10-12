// Admin: client companies, the markets each one pays for, invite codes and people.
import type { Ctx } from "../app";
import type { MetroIndexRow, Org, OrgOverview } from "../data/types";
import { $, h, type Child } from "../lib/dom";
import { fmtCompact, fmtInt } from "../lib/format";

let selected: string | null = null;

export async function adminView(el: HTMLElement, ctx: Ctx) {
  const orgs = await ctx.ds.adminOverview();
  if (selected && !orgs.some((o) => o.id === selected)) selected = null;
  const byName = [...ctx.index].sort((a, b) => a.n.localeCompare(b.n));
  const name = (c: string | null) => (c ? ctx.byCode.get(c)?.n ?? c : "–");

  el.replaceChildren(
    h("section", { class: "block", style: "margin-top:22px" },
      h("div", { class: "sec-head" }, h("h2", null, "Client companies"), h("p", null, orgs.length + (orgs.length === 1 ? " company" : " companies"))),
      h("div", { class: "panel w12" },
        h("div", { class: "tbl-wrap", style: "margin-top:0" }, h("table", { id: "org-table" },
          h("thead", null, h("tr", null, ...["Company", "Plan", "Home market", "Markets", "People", "Jobs uploaded", ""].map((t, i) =>
            h("th", { class: i >= 3 && i <= 5 ? "n" : "" }, t)))),
          h("tbody", null, ...(orgs.length ? orgs.map((o) => {
            const tr = h("tr", { class: "click" + (o.id === selected ? " current" : ""), tabindex: "0", "aria-label": "Manage " + o.name },
              h("td", null, h("b", null, o.name)),
              h("td", null, h("span", { class: "tag" }, o.plan === "all" ? "All markets" : "Selected markets")),
              h("td", null, name(o.home_cbsa)),
              h("td", { class: "n" }, o.plan === "all" ? "All " + ctx.index.length : fmtInt(o.markets.length)),
              h("td", { class: "n" }, fmtInt(o.members)), h("td", { class: "n" }, fmtInt(o.jobs)),
              h("td", { class: "n" }, h("span", { class: "linkish" }, "Manage")));
            const open = () => { selected = o.id; ctx.rerender(); };
            tr.addEventListener("click", open);
            tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
            return tr;
          }) : [h("tr", null, h("td", { colspan: 7, class: "dim" }, "No client companies yet. Add one below."))])))))),
    ...(selected ? [editor(ctx, orgs.find((o) => o.id === selected) as OrgOverview, byName)] : []),
    h("section", { class: "block" },
      h("div", { class: "sec-head" }, h("h2", null, "Add a client company")),
      h("div", { class: "grid" },
        h("form", { class: "panel w5 form", id: "new-org" },
          field("Company name", h("input", { type: "text", name: "name", required: true, maxlength: 120, autocomplete: "organization", placeholder: "Example: Blue Ridge Movers" })),
          field("Home market", metroSelect("home", byName, null)),
          field("Plan", planSeg("new-plan", "selected")),
          h("div", { class: "btn-row" }, h("button", { class: "btn btn-primary", type: "submit" }, "Add company")),
          h("div", { id: "new-org-status", "aria-live": "polite" })),
        h("div", { class: "panel w7" },
          h("h3", null, "How a new client gets in"),
          h("ol", { class: "steps" },
            h("li", null, "Add the company here and pick its home market and plan."),
            h("li", null, "Choose the markets it pays for, then create an invite code."),
            h("li", null, "Send the code and the site link to your contact at the company."),
            h("li", null, "They create an account with their work email and enter the code. That ties their login to the company."),
            h("li", null, "They upload their jobs on the Your business page. Colleagues join with the same code if it allows more than one use.")),
          h("p", { class: "foot" }, "Logins are emails and passwords (or emailed sign-in links). One login belongs to one company. To remove someone, use People in the company's settings.")))));

  // new company
  const form = $("#new-org") as HTMLFormElement;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const nm = String(fd.get("name") || "").trim();
    const home = String(fd.get("home") || "") || null;
    const plan = (form.querySelector("[data-plan][aria-pressed='true']") as HTMLElement).dataset.plan as Org["plan"];
    const status = $("#new-org-status");
    if (!nm) return status.replaceChildren(note("error", "Enter a company name."));
    try {
      (form.querySelector("button[type=submit]") as HTMLButtonElement).disabled = true;
      const id = await ctx.ds.createOrg(nm, home, plan);
      if (home && plan === "selected") await ctx.ds.setOrgMarkets(id, [home]);
      selected = id;
      ctx.rerender();
    } catch (err) {
      (form.querySelector("button[type=submit]") as HTMLButtonElement).disabled = false;
      status.replaceChildren(note("error", (err as Error).message));
    }
  });
  wirePlanSeg("new-plan");
  if (selected) $("#org-editor")?.scrollIntoView({ block: "start" });
}

// ---------------------------------------------------------------------------------------------
function editor(ctx: Ctx, o: OrgOverview, byName: MetroIndexRow[]) {
  const sec = h("section", { class: "block", id: "org-editor" },
    h("div", { class: "sec-head" }, h("h2", null, o.name), h("p", null, h("button", { class: "btn btn-quiet", type: "button", onclick: () => { selected = null; ctx.rerender(); } }, "Close"))),
    h("div", { class: "grid" },
      h("form", { class: "panel w5 form", id: "org-details" },
        h("h3", null, "Company details"),
        field("Company name", h("input", { type: "text", name: "name", required: true, maxlength: 120, value: o.name })),
        field("Home market", metroSelect("home", byName, o.home_cbsa)),
        field("Plan", planSeg("edit-plan", o.plan)),
        h("div", { class: "btn-row" }, h("button", { class: "btn btn-primary", type: "submit" }, "Save details")),
        h("div", { id: "details-status", "aria-live": "polite" })),
      h("div", { class: "panel w7", id: "markets-panel" }),
      h("div", { class: "panel w6" },
        h("h3", null, "Invite codes"),
        h("p", { class: "sub" }, "Anyone with the code can join this company until it expires or runs out of uses."),
        h("div", { class: "form-row" },
          field("Role", h("select", { id: "inv-role" }, h("option", { value: "member" }, "Member"), h("option", { value: "owner" }, "Owner"))),
          field("Valid for", h("select", { id: "inv-days" }, ...[7, 14, 30, 90].map((d) => h("option", { value: d, selected: d === 14 }, d + " days")))),
          field("Uses", h("select", { id: "inv-uses" }, ...[1, 5, 25].map((u) => h("option", { value: u, selected: u === 5 }, u === 1 ? "1 person" : u + " people"))))),
        h("div", { class: "btn-row" }, h("button", { class: "btn btn-primary", type: "button", id: "inv-create" }, "Create invite code")),
        h("div", { id: "inv-out", "aria-live": "polite" })),
      h("div", { class: "panel w6" },
        h("h3", null, "People"),
        h("p", { class: "sub" }, "Logins that joined this company."),
        h("div", { id: "people" }, h("p", { class: "sub" }, "Loading…")))));

  // after the section is in the page
  queueMicrotask(() => {
    const form = $("#org-details") as HTMLFormElement;
    wirePlanSeg("edit-plan", (plan) => renderMarkets(ctx, o, plan));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const nm = String(fd.get("name") || "").trim();
      const home = String(fd.get("home") || "") || null;
      const plan = (form.querySelector("[data-plan][aria-pressed='true']") as HTMLElement).dataset.plan as Org["plan"];
      const status = $("#details-status");
      if (!nm) return status.replaceChildren(note("error", "Enter a company name."));
      try {
        await ctx.ds.updateOrg(o.id, { name: nm, home_cbsa: home, plan });
        if (home && plan === "selected" && !o.markets.includes(home)) await ctx.ds.setOrgMarkets(o.id, [...o.markets, home]);
        ctx.rerender();
      } catch (err) {
        status.replaceChildren(note("error", (err as Error).message));
      }
    });
    renderMarkets(ctx, o, o.plan);
    wireInvites(ctx, o);
    void renderPeople(ctx, o);
  });
  return sec;
}

function renderMarkets(ctx: Ctx, o: OrgOverview, plan: Org["plan"]) {
  const box = $("#markets-panel");
  if (plan === "all") {
    box.replaceChildren(h("h3", null, "Markets in the plan"),
      h("p", { class: "sub" }, `With the all-markets plan, ${o.name} sees all ${ctx.index.length} metros. Save details to apply a plan change.`));
    return;
  }
  const chosen = new Set(o.markets);
  let q = "", onlyChosen = false;
  const list = h("div", { class: "checklist", role: "group", "aria-label": "Markets" });
  const count = h("span", { class: "sub" });
  const rows = [...ctx.index].sort((a, b) => b.pop25 - a.pop25);
  const draw = () => {
    const qq = q.toLowerCase();
    const shown = rows.filter((m) => (!qq || (m.t + " " + m.st.join(" ")).toLowerCase().includes(qq)) && (!onlyChosen || chosen.has(m.c)))
      .sort((a, b) => Number(chosen.has(b.c)) - Number(chosen.has(a.c)));
    list.replaceChildren(...shown.slice(0, 120).map((m) => {
      const cb = h("input", { type: "checkbox", value: m.c, checked: chosen.has(m.c) });
      cb.addEventListener("change", () => { if (cb.checked) chosen.add(m.c); else chosen.delete(m.c); count.textContent = summary(); });
      return h("label", { class: "check-row" + (m.c === o.home_cbsa ? " home" : "") }, cb,
        h("span", null, m.n, m.c === o.home_cbsa ? h("span", { class: "tag" }, "Home") : null),
        h("span", { class: "muted" }, fmtCompact(m.pop25)));
    }), ...(shown.length > 120 ? [h("p", { class: "sub" }, `Showing 120 of ${shown.length}. Search to narrow the list.`)] : []));
    count.textContent = summary();
  };
  const summary = () => `${chosen.size} market${chosen.size === 1 ? "" : "s"} selected`;
  const search = h("input", { type: "search", placeholder: "Search a metro or state", "aria-label": "Search markets" });
  search.addEventListener("input", () => { q = search.value.trim(); draw(); });
  const only = h("input", { type: "checkbox" });
  only.addEventListener("change", () => { onlyChosen = only.checked; draw(); });
  const status = h("div", { "aria-live": "polite" });
  const save = h("button", { class: "btn btn-primary", type: "button" }, "Save markets");
  save.addEventListener("click", async () => {
    save.disabled = true;
    try {
      if (o.home_cbsa) chosen.add(o.home_cbsa);
      await ctx.ds.setOrgMarkets(o.id, [...chosen].sort());
      ctx.rerender();
    } catch (err) {
      save.disabled = false;
      status.replaceChildren(note("error", (err as Error).message));
    }
  });
  box.replaceChildren(h("h3", null, "Markets in the plan"),
    h("p", { class: "sub" }, "Clients see full detail for these markets. Every other market shows a preview with an upgrade prompt."),
    h("div", { class: "filters" }, h("div", { class: "f-row" }, search, h("label", { class: "check" }, only, " Selected only"))),
    list,
    h("div", { class: "btn-row" }, save, count),
    status);
  draw();
}

function wireInvites(ctx: Ctx, o: OrgOverview) {
  ($("#inv-create") as HTMLButtonElement).addEventListener("click", async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    const role = ($("#inv-role") as HTMLSelectElement).value as "owner" | "member";
    const days = +($("#inv-days") as HTMLSelectElement).value, uses = +($("#inv-uses") as HTMLSelectElement).value;
    const out = $("#inv-out");
    btn.disabled = true;
    try {
      const code = await ctx.ds.createInvite(o.id, role, days, uses);
      const until = new Date(Date.now() + days * 864e5).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
      const site = location.origin + location.pathname;
      const msg = `You're invited to Moving Market Intelligence for ${o.name.replace(/\.$/, "")}.\n\n1. Go to ${site}\n2. Create an account with your work email.\n3. Enter this invite code: ${code}\n\nThe code works for ${uses === 1 ? "one person" : uses + " people"} and expires on ${until}.`;
      const ta = h("textarea", { class: "invite-msg", rows: 7, readonly: true, "aria-label": "Invite message" }, msg);
      const copy = h("button", { class: "btn", type: "button" }, "Copy message");
      copy.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(msg); copy.textContent = "Copied"; }
        catch { ta.select(); copy.textContent = "Press Ctrl+C (⌘C) to copy"; }
      });
      out.replaceChildren(h("div", { class: "invite" },
        h("p", { class: "code-big" }, code),
        h("p", { class: "sub" }, `${role === "owner" ? "Owner" : "Member"} code, ${uses === 1 ? "one use" : uses + " uses"}, expires ${until}.` + (ctx.ds.demo ? " Demo codes don't work anywhere." : "")),
        ta, h("div", { class: "btn-row" }, copy)));
    } catch (err) {
      out.replaceChildren(note("error", (err as Error).message));
    } finally {
      btn.disabled = false;
    }
  });
}

async function renderPeople(ctx: Ctx, o: OrgOverview) {
  const box = $("#people");
  try {
    const people = await ctx.ds.listMembers(o.id);
    if (!people.length) { box.replaceChildren(h("p", { class: "sub" }, "Nobody has joined yet. Create an invite code and send it to your contact.")); return; }
    box.replaceChildren(h("table", null,
      h("thead", null, h("tr", null, h("th", null, "Email"), h("th", null, "Role"), h("th"))),
      h("tbody", null, ...people.map((p) => {
        const cell = h("td", { class: "n" });
        const ask = () => cell.replaceChildren(
          h("button", { class: "btn btn-danger", type: "button", onclick: async () => {
            try { await ctx.ds.removeMember(o.id, p.user_id); ctx.rerender(); }
            catch (err) { cell.replaceChildren(note("error", (err as Error).message)); }
          } }, "Remove"),
          " ", h("button", { class: "btn btn-quiet", type: "button", onclick: () => cell.replaceChildren(removeBtn()) }, "Keep"));
        const removeBtn = () => h("button", { class: "btn btn-quiet", type: "button", onclick: ask }, "Remove…");
        cell.append(removeBtn());
        return h("tr", null, h("td", null, p.email), h("td", null, p.role === "owner" ? "Owner" : "Member"), cell);
      }))));
  } catch (err) {
    box.replaceChildren(note("error", (err as Error).message));
  }
}

// ---------------------------------------------------------------------------------------------
let fieldN = 0;
function field(label: string, control: HTMLElement) {
  if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement) {
    if (!control.id) control.id = "f-" + ++fieldN;
    return h("div", { class: "field" }, h("label", { for: control.id }, label), control);
  }
  return h("div", { class: "field" }, h("span", { class: "field-label" }, label), control);
}
function metroSelect(name: string, byName: MetroIndexRow[], value: string | null) {
  return h("select", { name }, h("option", { value: "" }, "Choose a metro"),
    ...byName.map((m) => h("option", { value: m.c, selected: m.c === value }, m.n)));
}
function planSeg(id: string, value: Org["plan"]) {
  return h("div", { class: "seg", role: "group", "aria-label": "Plan", id },
    h("button", { type: "button", "data-plan": "selected", "aria-pressed": String(value === "selected") }, "Selected markets"),
    h("button", { type: "button", "data-plan": "all", "aria-pressed": String(value === "all") }, "All markets"));
}
function wirePlanSeg(id: string, onChange?: (p: Org["plan"]) => void) {
  const seg = document.getElementById(id);
  seg?.querySelectorAll<HTMLButtonElement>("[data-plan]").forEach((b) => b.addEventListener("click", () => {
    seg.querySelectorAll("[data-plan]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    onChange?.(b.dataset.plan as Org["plan"]);
  }));
}
const note = (kind: "error" | "ok" | "info", text: Child) => h("div", { class: "notice notice-" + kind }, text);
