// Entry point. The demo build (npm run build:demo) bundles the market data and a sample client;
// the live build (npm run build) signs people in through Supabase.
import "@fontsource/barlow/latin-400.css";
import "@fontsource/barlow/latin-500.css";
import "@fontsource/barlow/latin-600.css";
import "@fontsource/barlow/latin-700.css";
import "@fontsource/barlow-condensed/latin-500.css";
import "@fontsource/barlow-condensed/latin-600.css";
import "@fontsource/barlow-condensed/latin-700.css";
import "@fontsource/overpass-mono/latin-400.css";
import "@fontsource/overpass-mono/latin-600.css";
import "./styles.css";

const root = document.getElementById("app") as HTMLElement;

async function bootDemo() {
  const { createDemoSource } = await import("./data/demo");
  const ds = await createDemoSource();
  const { startApp } = await import("./app");
  await startApp(root, ds, await ds.session(), async () => ds.zipMap());
}

async function bootLive() {
  const auth = await import("./views/auth");
  try {
    const url = import.meta.env.VITE_SUPABASE_URL, key = import.meta.env.VITE_SUPABASE_ANON_KEY;
    if (!url || !key) return auth.setupScreen(root);
    // An expired or reused email link comes back as #error=...&error_description=...
    const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
    const linkError = hash.get("error_description");
    if (linkError) history.replaceState(null, "", location.pathname + location.search);
    const { createSupabaseSource } = await import("./data/supabase");
    const ds = createSupabaseSource(url, key);
    const session = await ds.session();
    ds.onAuthChange(() => location.reload());
    if (!session) return auth.signInScreen(root, ds, linkError ? linkError.replace(/\+/g, " ") + ". Request a new link below." : undefined);
    if (!session.org && !session.isAdmin) return auth.joinScreen(root, ds, session.email);
    const { startApp } = await import("./app");
    await startApp(root, ds, session, () => ds.zipMap());
  } catch (e) {
    auth.errorScreen(root, e);
  }
}

if (__DEMO__) void bootDemo().catch((e) => {
  root.textContent = "The demo couldn't start: " + ((e as Error)?.message || String(e));
});
else void bootLive();
