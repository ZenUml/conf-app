import { isPlantUmlLocalRendererEnabled } from '@/apis/aiTitleFeatureFlag';

/**
 * Which engine this viewer asks first for PlantUML (ADR-0010): `local`, the
 * in-browser engine, or `server`, www.plantuml.com. A `local` choice still
 * falls back to the server for a diagram the engine cannot draw.
 *
 * The Forge flag `plantuml-local-renderer-enabled` decides, per site. A browser
 * can override it either way with `localStorage.plantumlRenderer` in the macro
 * iframe's origin (`local` or `server`), for testing without touching the flag.
 */
export type PlantUmlEngineChoice = 'server' | 'local';

export const PLANTUML_RENDERER_STORAGE_KEY = 'plantumlRenderer';

function storedOverride(): PlantUmlEngineChoice | null {
  try {
    const value = localStorage.getItem(PLANTUML_RENDERER_STORAGE_KEY);
    return value === 'local' || value === 'server' ? value : null;
  } catch {
    return null; // storage blocked: let the flag decide
  }
}

// One flag lookup per iframe: validation and render both ask, on every edit.
let flagChoice: Promise<PlantUmlEngineChoice> | null = null;

export function plantUmlRenderer(): Promise<PlantUmlEngineChoice> {
  const override = storedOverride();
  if (override) return Promise.resolve(override);
  flagChoice ??= isPlantUmlLocalRendererEnabled().then(
    (enabled): PlantUmlEngineChoice => (enabled ? 'local' : 'server'),
    (): PlantUmlEngineChoice => 'server',
  );
  return flagChoice;
}

/** Test hook: forget the cached flag answer. */
export function resetPlantUmlRendererForTests(): void {
  flagChoice = null;
}
