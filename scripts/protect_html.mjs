// Password-protects a one-file HTML page by encrypting it (not just hiding it).
// The page is gzipped, then encrypted with AES-256-GCM using a key derived from the password
// (PBKDF2-SHA256, 600,000 rounds). The output shows an Acumena sign-in screen; the browser
// decrypts the page only when the right password is typed. Without the password the file is unreadable.
//
// Usage:  PROTECT_PASSWORD='...' node scripts/protect_html.mjs dist-real/index.html Acumena_Analytics_Private.html
// The password is read from the environment so it never lands in a file or the shell history of a script.
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { webcrypto as crypto } from "node:crypto";

const [, , input, output] = process.argv;
const password = process.env.PROTECT_PASSWORD || "";
if (!input || !output) { console.error("Usage: PROTECT_PASSWORD=... node scripts/protect_html.mjs <in.html> <out.html>"); process.exit(1); }
if (password.length < 12) { console.error("Use a password of at least 12 characters."); process.exit(1); }

const ITER = 600000;
const salt = crypto.getRandomValues(new Uint8Array(16));
const iv = crypto.getRandomValues(new Uint8Array(12));
const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: ITER, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
const plain = gzipSync(readFileSync(input), { level: 9 });
const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
const b64 = (u) => Buffer.from(u).toString("base64");

const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Acumena Analytics</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0a0a0a; color: #f2f2f2;
    font: 15px/1.5 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 16px; }
  .card { width: 100%; max-width: 380px; }
  .brand { font-weight: 700; letter-spacing: .04em; font-size: 26px; }
  .sub { color: #73a5ff; font-size: 12px; letter-spacing: .18em; text-transform: uppercase; margin: 2px 0 28px; }
  label { display: block; font-size: 13px; color: #bdbdbd; margin-bottom: 6px; }
  input { width: 100%; padding: 11px 12px; border-radius: 8px; border: 1px solid #3a3a3a; background: #161616; color: #fff; font-size: 15px; }
  input:focus { outline: 2px solid #73a5ff; outline-offset: 1px; }
  button { margin-top: 14px; width: 100%; padding: 11px; border: 0; border-radius: 8px; background: #73a5ff; color: #06152e; font-weight: 700; font-size: 15px; cursor: pointer; }
  button:disabled { opacity: .6; cursor: progress; }
  .msg { min-height: 22px; margin-top: 12px; font-size: 13px; color: #ff8a80; }
  .note { margin-top: 26px; font-size: 12px; color: #8a8a8a; }
</style></head>
<body><form class="card" id="f" autocomplete="off">
  <div class="brand">Acumena</div><div class="sub">Acumena Analytics</div>
  <label for="pw">Password</label>
  <input id="pw" type="password" autofocus required>
  <button id="go" type="submit">Open</button>
  <div class="msg" id="msg" role="alert"></div>
  <div class="note">Private copy for Acumena. Contains company contact details from public filings; don't forward.</div>
</form>
<script>
const D = { s: "${b64(salt)}", i: "${b64(iv)}", n: ${ITER}, c: "${b64(cipher)}" };
const u8 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
document.getElementById("f").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("go"), msg = document.getElementById("msg");
  btn.disabled = true; btn.textContent = "Opening…"; msg.textContent = "";
  try {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(document.getElementById("pw").value), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: u8(D.s), iterations: D.n, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    const zipped = await crypto.subtle.decrypt({ name: "AES-GCM", iv: u8(D.i) }, key, u8(D.c));
    const html = await new Response(new Blob([zipped]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
    document.open(); document.write(html); document.close();
  } catch (err) {
    msg.textContent = err && err.name === "OperationError" ? "That password isn't right." : "This browser can't open the file. Try a current Chrome, Edge, Safari or Firefox.";
    btn.disabled = false; btn.textContent = "Open";
  }
});
</script></body></html>
`;
writeFileSync(output, page);
console.log(`Wrote ${output} (${(page.length / 1e6).toFixed(1)} MB, from ${(readFileSync(input).length / 1e6).toFixed(1)} MB)`);
