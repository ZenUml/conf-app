import forgeGlobal from '@/model/globals/forgeGlobal';

/**
 * Which engine this viewer asks first for PlantUML (ADR-0010): `local`, the
 * in-browser engine, or `server`, www.plantuml.com. A `local` choice still
 * falls back to the server for a diagram the engine cannot draw.
 *
 * Fixed per variant. Lite and Diagramly draw locally: the Forge flag
 * `plantuml-local-renderer-enabled` served them 100% from 2026-10-31 and was
 * retired (2026-11-18) to free a Lite flag slot. Full and AsyncAPI never had
 * that flag, so they always read it as off and keep the server; moving them is
 * ADR-0010 rollout step 5, a separate decision. Outside Forge (standalone dev)
 * the server stays, as the flag's fail-closed lookup did.
 *
 * A browser can override the default either way with
 * `localStorage.plantumlRenderer` in the macro iframe's origin (`local` or
 * `server`).
 */
export type PlantUmlEngineChoice = 'server' | 'local';

export const PLANTUML_RENDERER_STORAGE_KEY = 'plantumlRenderer';

const LOCAL_BY_DEFAULT = new Set(['lite', 'diagramly']);

function storedOverride(): PlantUmlEngineChoice | null {
  try {
    const value = localStorage.getItem(PLANTUML_RENDERER_STORAGE_KEY);
    return value === 'local' || value === 'server' ? value : null;
  } catch {
    return null; // storage blocked: use the default
  }
}

function defaultChoice(): PlantUmlEngineChoice {
  if (!forgeGlobal.isForge) return 'server';
  return LOCAL_BY_DEFAULT.has(String(import.meta.env.PRODUCT_TYPE)) ? 'local' : 'server';
}

export function plantUmlRenderer(): Promise<PlantUmlEngineChoice> {
  return Promise.resolve(storedOverride() ?? defaultChoice());
}
