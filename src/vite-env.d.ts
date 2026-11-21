/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly PRODUCT_TYPE: 'full' | 'lite' | 'diagramly' | 'asyncapi';
  /** Non-default Connect key of a development environment; '' when the variant's fixed key applies. */
  readonly CONNECT_KEY_OVERRIDE: string;
  readonly VITE_TITLE_DRAFT_COPY_EXPERIMENT_ENABLED: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
