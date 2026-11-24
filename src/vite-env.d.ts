/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly PRODUCT_TYPE: 'full' | 'lite' | 'diagramly' | 'asyncapi';
  readonly VITE_REMOTE_BASE_URL_OVERRIDE?: string;
  readonly VITE_TITLE_DRAFT_COPY_EXPERIMENT_ENABLED: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
