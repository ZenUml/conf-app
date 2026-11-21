// src/utils/analytics/mixpanelClient.ts
//
// The one Mixpanel SDK instance for this iframe. Import it from here, never
// from "mixpanel-browser" directly: the package's default entry
// (dist/mixpanel.module.js) bundles the session-replay recorder (rrweb,
// ~330 KB minified) into the boot path of every macro view, although only a
// sampled fraction of iframes ever record (measured on the Lite build of
// 2026-11-21: 330 KB of the 564 KB `tailwind-*.js` boot chunk was rrweb).
//
// The async-modules loader is the same SDK without the recorder. It loads the
// recorder with a <script> tag only when a recording actually starts —
// `record_sessions_percent` sampling at init, or start_session_recording().
//
// MIXPANEL_RECORDER_SRC points that <script> at our own copy of the
// recorder, emitted by Vite as a content-hashed asset next to our chunks,
// instead of the SDK default (cdn.mxpnl.com/libs/mixpanel-recorder-<hash>.js):
// - Forge CSP allows same-origin scripts; the CDN URL the SDK would build is
//   not in manifest.yml `permissions.external.scripts`, and adding one would
//   be a manifest change.
// - The recorder always matches the installed SDK version, and its URL only
//   changes when the SDK changes, so the browser keeps it cached across our
//   releases.
// dist/mixpanel-recorder.min.js is byte-identical to the SDK's
// async-modules/mixpanel-recorder-<hash>.min.js bar the source-map comment;
// it is a classic script that registers itself on window.__mp_recorder,
// which is what the loader waits for.
import type { OverridedMixpanel } from "mixpanel-browser";
// The loader's .d.ts is `export * from '../index'`, which drops the default
// export at the type level although the module has one at runtime — hence
// the namespace import and the typed read of `default`.
import * as asyncModulesLoader from "mixpanel-browser/src/loaders/loader-module-with-async-modules";
import recorderUrl from "mixpanel-browser/dist/mixpanel-recorder.min.js?url";

const mixpanel = (asyncModulesLoader as unknown as { default: OverridedMixpanel })
  .default;

// Absolute URL: the SDK hands it straight to a <script src>, and Vite's
// relative asset URL must resolve against the bundle, not the origin root
// (Forge serves the app under a path; see utils/mermaid/loadMermaid.ts).
export const MIXPANEL_RECORDER_SRC: string = new URL(
  recorderUrl,
  import.meta.url,
).href;

export default mixpanel;
