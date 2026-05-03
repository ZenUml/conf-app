declare module 'global' {
  global {
    interface Window {
      specListeners?: Array<(spec: string) => void>;
      specContent?: string;
      diagram?: Diagram;
      editor?: SwaggerEditorBundle;
    }
  }
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, any>;
  export default component;
}
