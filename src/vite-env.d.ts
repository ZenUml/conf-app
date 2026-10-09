/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly PRODUCT_TYPE: 'full' | 'lite' | 'diagramly' | 'asyncapi';
  readonly VITE_SESSION_REPLAY_DEV_CLOUD_ID?: string;
  readonly VITE_SESSION_REPLAY_DEV_PAGE_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
