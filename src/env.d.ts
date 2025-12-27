/// <reference types="vite/client" />

declare interface ImportMetaEnv {
  readonly VITE_API_HOST?: string;
  readonly VITE_API_PORT?: string;
  readonly VITE_REDIRECT_URI?: string;
  // add more env vars here if needed
}

declare interface ImportMeta {
  readonly env: ImportMetaEnv;
}
