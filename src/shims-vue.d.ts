// This project's tsconfig uses `moduleResolution: "node"` (classic), which does
// not read vue's package.json "exports" map, so TS can't see vue's named type
// exports (createApp, ref, computed, h, ...) on its own. Re-export them from
// @vue/runtime-dom so `import { createApp } from 'vue'` type-checks.
//
// (Previously this module also declared a `default` export + `configureCompat`
// for @vue/compat; both were removed when @vue/compat was dropped. Note: there
// is deliberately NO default export — real vue has none, so a stray
// `import x from 'vue'` correctly fails to type-check.)
declare module 'vue' {
  export * from '@vue/runtime-dom';
}
