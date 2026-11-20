/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_TON_CONNECT_ENABLE_PAYMENTS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
