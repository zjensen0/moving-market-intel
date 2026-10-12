// Sign-in, join-with-code and setup screens for the live site. The demo build never loads this.
import type { DataSource } from "../data/types";
import { h, type Child } from "../lib/dom";
import { brandBlock } from "../brand";
import { themeSwitch } from "../theme";

function shell(root: HTMLElement, title: string, sub: string, ...body: Child[]) {
  const stat = (n: string, label: string) => h("li", null, h("b", null, n), h("span", null, label));
  root.replaceChildren(h("div", { class: "auth-split" },
    h("aside", { class: "auth-brand" },
      brandBlock(),
      h("div", { class: "auth-pitch" },
        h("p", { class: "eyebrow" }, "Moving Market Intelligence"),
        h("h2", null, "Know every moving market before your competitors do."),
        h("p", { class: "auth-lead" }, "Demand, long-distance lanes, competitors, labor and costs for every U.S. metro, plus your own jobs measured against the market."),
        h("ul", { class: "auth-stats" },
          stat("387", "metro areas, every one in the U.S."),
          stat("10,699", "licensed household-goods movers tracked"),
          stat("4,000+", "long-distance lanes with household counts"),
          stat("13", "public sources, refreshed as they publish"))),
      h("p", { class: "auth-legal" }, "Acumena Analytics · ", h("a", { href: "https://acumenasolutions.com", target: "_blank", rel: "noopener" }, "acumenasolutions.com"))),
    h("main", { class: "auth-main" },
      h("div", { class: "auth-box" },
        h("h1", { class: "auth-title" }, title),
        h("p", { class: "auth-sub" }, sub),
        h("div", { class: "auth-card" }, ...body),
        h("div", { class: "auth-foot" }, themeSwitch())))));
}
const note = (kind: "error" | "ok" | "info", text: string) => h("div", { class: "notice notice-" + kind, role: "status" }, text);
const field = (label: string, input: HTMLInputElement) => h("div", { class: "field" }, h("label", { for: input.id }, label), input);

export function signInScreen(root: HTMLElement, ds: DataSource, message?: string) {
  let mode: "signin" | "signup" = "signin";
  const email = h("input", { id: "email", type: "email", name: "email", required: true, autocomplete: "username", placeholder: "you@company.com" });
  const pass = h("input", { id: "password", type: "password", name: "password", required: true, minlength: 8, autocomplete: "current-password" });
  const submit = h("button", { class: "btn btn-primary btn-wide", type: "submit" }, "Sign in");
  const status = h("div", { "aria-live": "polite" }, message ? note("error", message) : null);
  const tabs = h("div", { class: "seg seg-wide", role: "group", "aria-label": "Sign in or create an account" },
    h("button", { type: "button", "aria-pressed": "true", "data-mode": "signin" }, "Sign in"),
    h("button", { type: "button", "aria-pressed": "false", "data-mode": "signup" }, "Create account"));
  const help = h("p", { class: "foot" });
  const setMode = (m: typeof mode) => {
    mode = m;
    tabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === m)));
    submit.textContent = m === "signin" ? "Sign in" : "Create account";
    pass.autocomplete = m === "signin" ? "current-password" : "new-password";
    help.textContent = m === "signin" ? "New client? Choose Create account, then enter the invite code from your account manager."
      : "Use your work email and a password of at least 8 characters. Next you'll enter your invite code.";
    status.replaceChildren();
  };
  tabs.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode as typeof mode)));
  const form = h("form", { class: "form" }, field("Email", email), field("Password", pass), submit);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    submit.disabled = true;
    status.replaceChildren(note("info", mode === "signin" ? "Signing in…" : "Creating your account…"));
    try {
      if (mode === "signin") {
        await ds.signIn(email.value.trim(), pass.value);
        location.reload();
      } else {
        const r = await ds.signUp(email.value.trim(), pass.value);
        if (r === "signed-in") location.reload();
        else status.replaceChildren(note("ok", "Check your email for a link to confirm your address. It brings you back here signed in."));
      }
    } catch (err) {
      status.replaceChildren(note("error", friendly((err as Error).message)));
    } finally {
      submit.disabled = false;
    }
  });
  const magic = h("button", { class: "btn btn-wide", type: "button" }, "Email me a sign-in link instead");
  magic.addEventListener("click", async () => {
    if (!email.value.trim() || !email.checkValidity()) { status.replaceChildren(note("error", "Enter your email address first.")); email.focus(); return; }
    magic.disabled = true;
    try {
      await ds.sendMagicLink(email.value.trim());
      status.replaceChildren(note("ok", "Check your email for a sign-in link. It works once and expires after an hour."));
    } catch (err) {
      status.replaceChildren(note("error", friendly((err as Error).message)));
    } finally {
      magic.disabled = false;
    }
  });
  shell(root, "Sign in", "Market data and insights for moving and storage companies", tabs, form,
    h("div", { class: "divider" }, h("span", null, "or")), magic, status, help);
  setMode("signin");
  if (message) status.replaceChildren(note("error", message));
}

export function joinScreen(root: HTMLElement, ds: DataSource, email: string) {
  const code = h("input", { id: "code", type: "text", name: "code", required: true, autocomplete: "off", spellcheck: "false",
    maxlength: 24, placeholder: "Example: 3F9A0C21B7", class: "code-input" });
  code.addEventListener("input", () => { code.value = code.value.toUpperCase(); });
  const submit = h("button", { class: "btn btn-primary btn-wide", type: "submit" }, "Join my company");
  const status = h("div", { "aria-live": "polite" });
  const form = h("form", { class: "form" }, field("Invite code", code), submit);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    submit.disabled = true;
    try {
      await ds.joinOrg(code.value.replace(/\s+/g, ""));
      location.reload();
    } catch (err) {
      status.replaceChildren(note("error", friendly((err as Error).message)));
      submit.disabled = false;
    }
  });
  const out = h("button", { class: "btn btn-quiet", type: "button" }, "Sign out");
  out.addEventListener("click", async () => { await ds.signOut(); location.reload(); });
  shell(root, "Connect to your company", "Signed in as " + email,
    h("p", { class: "lead" }, "Enter the invite code from your account manager. It links your login to your company's markets and data."),
    form, status, h("p", { class: "foot" }, "No code yet? Ask your account manager to send one. ", out));
}

export function setupScreen(root: HTMLElement) {
  shell(root, "Almost there", "This copy of the site isn't connected to its database yet",
    h("div", { class: "prose" },
      h("p", null, "Add two settings where the site is hosted (for Cloudflare Pages: Settings > Environment variables), then deploy again:"),
      h("pre", { class: "template-pre" }, "VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co\nVITE_SUPABASE_ANON_KEY=your-anon-public-key"),
      h("p", null, "Both are on the Supabase dashboard under Project settings > API. The step-by-step guide is in SETUP.md in the code.")));
}

export function errorScreen(root: HTMLElement, err: unknown) {
  shell(root, "Something went wrong", "The site couldn't start",
    note("error", (err as Error)?.message || String(err)),
    h("p", { class: "foot" }, "Reload the page to try again. If it keeps happening, contact your account manager."));
}

function friendly(msg: string) {
  if (/invalid login credentials/i.test(msg)) return "That email and password don't match. Try again, or use the sign-in link.";
  if (/email not confirmed/i.test(msg)) return "Confirm your email first: open the link we sent you, then sign in.";
  if (/already registered|already exists/i.test(msg)) return "There's already an account with that email. Choose Sign in instead.";
  if (/rate limit|too many/i.test(msg)) return "Too many tries in a short time. Wait a minute and try again.";
  if (/password/i.test(msg) && /characters|short|weak/i.test(msg)) return "Use a longer password: at least 8 characters.";
  return msg;
}

/** Empty database: admins load market_data.json here; everyone else waits. */
export function firstLoadScreen(root: HTMLElement, ds: DataSource, isAdmin: boolean) {
  if (!isAdmin) {
    shell(root, "Almost ready", "Market data hasn't been loaded yet",
      h("p", { class: "lead" }, "Your account is set up. Your account manager is loading the market data; check back shortly."));
    return;
  }
  const status = h("div", { "aria-live": "polite" });
  const input = h("input", { type: "file", accept: ".json,application/json", class: "sr-only", id: "md-file" }) as HTMLInputElement;
  input.addEventListener("change", async () => {
    const f = input.files?.[0];
    input.value = "";
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!Array.isArray(data.metros) || !data.built) throw new Error("This doesn't look like market_data.json (no metros list).");
      const bar = h("div", { class: "m-track" }, h("div", { class: "m-fill", style: "width:0%" }));
      status.replaceChildren(h("p", { class: "sub" }, `Loading ${data.metros.length} metros…`), bar);
      await ds.loadMarketData(data, (p) => { (bar.firstChild as HTMLElement).style.width = Math.round(p * 100) + "%"; });
      status.replaceChildren(note("ok", "Loaded. Opening the app…"));
      setTimeout(() => location.reload(), 800);
    } catch (err) {
      status.replaceChildren(note("error", (err as Error).message));
    }
  });
  shell(root, "Load the market data", "One-time step for admins",
    h("p", { class: "lead" }, "The database is set up but empty. Choose the market_data.json file to load all 387 metros. You can refresh it the same way later from the Admin page."),
    h("label", { class: "dropzone", for: "md-file" }, input,
      h("span", { class: "dz-main" }, "Choose ", h("u", null, "market_data.json")),
      h("span", { class: "dz-note" }, "About 2 MB. Takes under a minute.")),
    status);
}
