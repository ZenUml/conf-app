import type { PlantUmlRenderer } from '@/utils/analytics/catalog';

/**
 * Which engine draws PlantUML for this viewer (ADR-0010).
 *
 * Spike gate: `server` for everyone, `local` only for a browser that opted in
 * with `localStorage.plantumlRenderer = 'local'` in the macro iframe's origin
 * (the same trick as `zenumlDebug`, see the check-version skill). A Forge
 * feature flag replaces this before any customer sees the local engine.
 */
export const PLANTUML_RENDERER_STORAGE_KEY = 'plantumlRenderer';

export function plantUmlRenderer(): PlantUmlRenderer {
  try {
    return localStorage.getItem(PLANTUML_RENDERER_STORAGE_KEY) === 'local' ? 'local' : 'server';
  } catch {
    return 'server'; // storage blocked: keep today's behaviour
  }
}
