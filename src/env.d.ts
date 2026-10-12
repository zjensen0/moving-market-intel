/// <reference types="vite/client" />
declare const __DEMO__: boolean;
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}
declare module "*.png" { const src: string; export default src; }
