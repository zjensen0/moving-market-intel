import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Two builds:
//   npm run build       -> dist/       the real app (needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY)
//   npm run build:demo  -> dist-demo/  one self-contained HTML file with a sample mover and no login
export default defineConfig(({ mode }) => {
  // npm run build:real -> dist-real/  one HTML file with real data only (all markets, Hiring radar), no sample clients
  const real = mode === "real";
  const demo = mode === "demo" || real;
  return {
    base: "./",
    define: { __DEMO__: JSON.stringify(demo), __REAL__: JSON.stringify(real) },
    plugins: demo ? [viteSingleFile()] : [],
    build: {
      outDir: real ? "dist-real" : demo ? "dist-demo" : "dist",
      target: "es2020",
      chunkSizeWarningLimit: 4000,
    },
  };
});
