/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly PRODUCT_TYPE: 'full' | 'lite' | 'diagramly' | 'asyncapi';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
