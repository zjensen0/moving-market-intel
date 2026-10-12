import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Two builds:
//   npm run build       -> dist/       the real app (needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY)
//   npm run build:demo  -> dist-demo/  one self-contained HTML file with a sample mover and no login
export default defineConfig(({ mode }) => {
  const demo = mode === "demo";
  return {
    base: "./",
    define: { __DEMO__: JSON.stringify(demo) },
    plugins: demo ? [viteSingleFile()] : [],
    build: {
      outDir: demo ? "dist-demo" : "dist",
      target: "es2020",
      chunkSizeWarningLimit: 4000,
    },
  };
});
