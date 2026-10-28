import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderPlantUmlLocally, resetPlantUmlEngine, PlantUmlLocalRenderError } from './engine';
import { renderToString } from '@plantuml/core';

// The real engine measures text on a canvas, which jsdom lacks; these specs pin
// this module's own behaviour around it. The SVG strings are abridged from
// what @plantuml/core 1.2026.9 actually returned in Chromium (ADR-0010).
vi.mock('@plantuml/core', () => ({ renderToString: vi.fn() }));
vi.mock('@plantuml/core/themes.js', () => ({}));
vi.mock('@plantuml/core/openiconic.js', () => ({}));
vi.mock('@plantuml/core/emoji.js', () => ({}));

const OK_SVG = '<svg viewBox="0 0 106 148" width="106" height="148"><text>Alice</text></svg>';
const SYNTAX_SVG = '<svg><text>[From textarea (line 3) ]</text><text>Syntax Error? (Assumed diagram type: sequence)</text></svg>';
const INCLUDE_SVG = '<svg><text>[From textarea (line 2) ]</text><text>cannot include &lt;azure/AzureCommon&gt;</text></svg>';
const URL_INCLUDE_SVG = '<svg><text>[From textarea (line 2) ]</text><text>cannot include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Context.puml</text></svg>';
const LOCAL_INCLUDE_SVG = '<svg><text>[From textarea (line 2) ]</text><text>cannot include styles/common.puml</text></svg>';
const CRASH_SVG = '<svg><text>An error has occurred!</text><text>What the hell is a gigawatt?</text></svg>';

function engineReturns(svg: string) {
  vi.mocked(renderToString).mockImplementation((_lines, onSuccess) => onSuccess(svg));
}

describe('renderPlantUmlLocally (ADR-0010)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPlantUmlEngine();
  });

  it('hands the engine the trimmed source as lines and returns its SVG', async () => {
    engineReturns(OK_SVG);
    await expect(renderPlantUmlLocally('  @startuml\nA -> B\n@enduml\n')).resolves.toBe(OK_SVG);
    expect(vi.mocked(renderToString).mock.calls[0][0]).toEqual(['@startuml', 'A -> B', '@enduml']);
  });

  it('returns a syntax-error drawing as a normal SVG for validate.ts to read', async () => {
    engineReturns(SYNTAX_SVG);
    await expect(renderPlantUmlLocally('@startuml\nbad\n@enduml')).resolves.toBe(SYNTAX_SVG);
  });

  it.each([
    ['include', INCLUDE_SVG],
    ['engine_error', CRASH_SVG],
  ])('classifies an error page as %s', async (reason, svg) => {
    engineReturns(svg);
    const err = await renderPlantUmlLocally('@startuml\nx\n@enduml').catch((e) => e);
    expect(err).toBeInstanceOf(PlantUmlLocalRenderError);
    expect(err.reason).toBe(reason);
  });

  it.each([
    ['stdlib', INCLUDE_SVG],
    ['url', URL_INCLUDE_SVG],
    ['local', LOCAL_INCLUDE_SVG],
  ])('says which kind of include was unresolved: %s', async (kind, svg) => {
    engineReturns(svg);
    const err = await renderPlantUmlLocally('@startuml\nx\n@enduml').catch((e) => e);
    expect(err.reason).toBe('include');
    expect(err.unresolvedInclude).toBe(kind);
  });

  it('renders GitHub C4 URL includes from the hosted library', async () => {
    engineReturns(OK_SVG);
    await renderPlantUmlLocally('@startuml\n!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Context.puml\nPerson(a, "A")\n@enduml');
    expect(vi.mocked(renderToString).mock.calls[0][0]).toEqual(['@startuml', '!include <C4/C4_Context>', 'Person(a, "A")', '@enduml']);
  });

  it('gives a rewritten diagram that hits a syntax error back to the server', async () => {
    engineReturns(SYNTAX_SVG);
    const err = await renderPlantUmlLocally('@startuml\n!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/v1.0.0/C4_Context.puml\nOldMacro(a)\n@enduml').catch((e) => e);
    expect(err).toBeInstanceOf(PlantUmlLocalRenderError);
    expect(err).toMatchObject({ reason: 'include', unresolvedInclude: 'url', includeRewritten: true });
  });

  it('still shows a syntax error in a diagram nothing was rewritten in', async () => {
    engineReturns(SYNTAX_SVG);
    await expect(renderPlantUmlLocally('@startuml\nbad\n@enduml')).resolves.toBe(SYNTAX_SVG);
  });

  it('draws the block the server would draw from a doubled header', async () => {
    engineReturns(OK_SVG);
    await renderPlantUmlLocally('@startuml\n@startuml\nA -> B\n@enduml');
    expect(vi.mocked(renderToString).mock.calls[0][0]).toEqual(['', '@startuml', 'A -> B', '@enduml']);
  });

  it('hands several complete diagrams to the server without running the engine', async () => {
    engineReturns(OK_SVG);
    const err = await renderPlantUmlLocally('@startuml\nA -> B\n@enduml\n@startuml\nC -> D\n@enduml').catch((e) => e);
    expect(err).toMatchObject({ reason: 'engine_error' });
    expect(renderToString).not.toHaveBeenCalled();
  });

  it('installs the stdlib loader before the engine runs', async () => {
    delete (globalThis as Record<string, unknown>).PLANTUML_STDLIB_LOADER;
    engineReturns(OK_SVG);
    await renderPlantUmlLocally('@startuml\nA\n@enduml');
    expect(typeof (globalThis as Record<string, unknown>).PLANTUML_STDLIB_LOADER).toBe('function');
  });

  it('does not mistake a label that says "cannot include" for an include failure', async () => {
    const svg = '<svg><text>Policy: cannot include PII</text></svg>';
    engineReturns(svg);
    await expect(renderPlantUmlLocally('@startuml\nnote "Policy: cannot include PII"\n@enduml')).resolves.toBe(svg);
  });

  it('turns the engine error callback into engine_error', async () => {
    vi.mocked(renderToString).mockImplementation((_lines, _ok, onError) => onError('boom'));
    const err = await renderPlantUmlLocally('@startuml\nx\n@enduml').catch((e) => e);
    expect(err.reason).toBe('engine_error');
  });

  it('runs the engine once for validation and render of the same source', async () => {
    engineReturns(OK_SVG);
    await Promise.all([renderPlantUmlLocally('@startuml\nA\n@enduml'), renderPlantUmlLocally('@startuml\nA\n@enduml ')]);
    await renderPlantUmlLocally('@startuml\nA\n@enduml');
    expect(renderToString).toHaveBeenCalledTimes(1);
  });

  it('does not keep a failure, so the next render tries again', async () => {
    vi.mocked(renderToString)
      .mockImplementationOnce((_lines, _ok, onError) => onError('boom'))
      .mockImplementationOnce((_lines, onSuccess) => onSuccess(OK_SVG));
    await expect(renderPlantUmlLocally('@startuml\nA\n@enduml')).rejects.toThrow();
    await expect(renderPlantUmlLocally('@startuml\nA\n@enduml')).resolves.toBe(OK_SVG);
  });
});
