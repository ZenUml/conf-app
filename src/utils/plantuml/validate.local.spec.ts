import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validatePlantUmlSyntax } from './validate';
import { renderPlantUmlLocally } from './engine';
import { PLANTUML_RENDERER_STORAGE_KEY } from './renderer';

vi.mock('./engine', () => ({ renderPlantUmlLocally: vi.fn() }));
vi.mock('@/apis/aiTitleFeatureFlag', () => ({ isPlantUmlLocalRendererEnabled: vi.fn(() => Promise.resolve(false)) }));

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

  it('validates on the server when the engine cannot draw the diagram', async () => {
    vi.mocked(renderPlantUmlLocally).mockRejectedValue(new Error('cannot include'));
    window.fetch = vi.fn(() => Promise.resolve(new Response(SYNTAX_SVG, { status: 400 }))) as typeof fetch;
    const result = await validatePlantUmlSyntax('@startuml\n!include <C4/C4_Context>\nfoo ->>> \n@enduml');
    expect(result).toMatchObject({ valid: false, location: { startLine: 3 } });
    expect(String(vi.mocked(window.fetch).mock.calls[0][0])).toContain('www.plantuml.com/plantuml/svg/');
  });
});
