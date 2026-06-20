/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly PRODUCT_TYPE: 'full' | 'lite' | 'diagramly';
  readonly VITE_DIAGRAMLY_LOCAL_API_BASE_URL?: string;
  readonly VITE_DIAGRAMLY_LOCAL_API_ENABLED?: 'true' | 'false';
  readonly VITE_DIAGRAMLY_LOCAL_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
