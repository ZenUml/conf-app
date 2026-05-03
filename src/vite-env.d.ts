/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly PRODUCT_TYPE: 'full' | 'lite' | 'diagramly';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
