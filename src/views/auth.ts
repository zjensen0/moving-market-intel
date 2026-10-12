// Sign-in, join-with-code and setup screens for the live site. The demo build never loads this.
import type { DataSource } from "../data/types";
import { h, type Child } from "../lib/dom";
import { brandBlock } from "../brand";

function shell(root: HTMLElement, title: string, sub: string, ...body: Child[]) {
  root.replaceChildren(h("div", { class: "wrap auth-wrap" },
    h("div", { class: "sign auth-sign" },
      brandBlock(),
      h("p", { class: "eyebrow" }, "Moving Market Intelligence"),
      h("h1", { class: "sign-title" }, title),
      h("p", { class: "sign-sub" }, sub)),
    h("div", { class: "panel auth-card" }, ...body)));
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
