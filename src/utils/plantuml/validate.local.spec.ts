import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validatePlantUmlSyntax } from './validate';
import { renderPlantUmlLocally } from './engine';
import { PLANTUML_RENDERER_STORAGE_KEY } from './renderer';

vi.mock('./engine', () => ({ renderPlantUmlLocally: vi.fn() }));

// What @plantuml/core 1.2026.9 drew for a bad arrow on line 3, abridged.
const SYNTAX_SVG =
  '<svg><text>[From textarea (line 3) ]</text><text>Syntax Error? (Assumed diagram type: sequence)</text></svg>';

describe('validatePlantUmlSyntax with the local renderer (ADR-0010)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem(PLANTUML_RENDERER_STORAGE_KEY, 'local');
    window.fetch = vi.fn(() => Promise.reject(new Error('no network in local mode'))) as typeof fetch;
  });

  afterEach(() => {
    localStorage.removeItem(PLANTUML_RENDERER_STORAGE_KEY);
  });

  it('reads the line and message from the engine drawing, without a fetch', async () => {
    vi.mocked(renderPlantUmlLocally).mockResolvedValue(SYNTAX_SVG);
    const result = await validatePlantUmlSyntax('@startuml\nAlice -> : \nfoo ->>> \n@enduml');
    expect(result).toMatchObject({
      valid: false,
      error: 'PlantUML syntax error at line 3: Assumed diagram type: sequence',
      location: { startLine: 3 },
    });
    expect(window.fetch).not.toHaveBeenCalled();
  });

  it('passes a diagram the engine draws cleanly', async () => {
    vi.mocked(renderPlantUmlLocally).mockResolvedValue('<svg viewBox="0 0 10 10"></svg>');
    await expect(validatePlantUmlSyntax('@startuml\nA -> B: clean\n@enduml')).resolves.toMatchObject({ valid: true });
  });
});
