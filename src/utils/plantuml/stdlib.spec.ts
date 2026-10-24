import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installPlantUmlStdlibLoader, plantumlStdlibLoader, rewriteHostedIncludes } from './stdlib';

type Globals = Record<string, Record<string, unknown> | undefined>;
const g = globalThis as unknown as Globals;

describe('PlantUML stdlib loader (ADR-0010)', () => {
  beforeEach(() => {
    delete g.PLANTUML_STDLIB;
    delete g.PLANTUML_STDLIB_JSON;
    delete g.PLANTUML_STDLIB_INFO;
  });

  it('serves the hosted C4 library as data and reports success', async () => {
    const ok = vi.fn();
    const err = vi.fn();
    plantumlStdlibLoader('c4.min.js', ok, err);
    await vi.waitFor(() => expect(ok).toHaveBeenCalledOnce());
    expect(err).not.toHaveBeenCalled();
    const files = g.PLANTUML_STDLIB!.c4 as Record<string, string[]>;
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['c4_context', 'c4_container', 'c4_component']));
    expect(files.c4_context.length).toBeGreaterThan(10);
    expect(g.PLANTUML_STDLIB_INFO!.c4).toMatchObject({ name: 'C4', license: 'MIT', version: '2.14.0' });
  });

  it('accepts the bundle name with whatever prefix the engine puts in front', async () => {
    const ok = vi.fn();
    plantumlStdlibLoader('https://example.invalid/some/base/c4.min.js', ok, vi.fn());
    await vi.waitFor(() => expect(ok).toHaveBeenCalledOnce());
  });

  it('declines a library that is not hosted, without loading anything', () => {
    const ok = vi.fn();
    const err = vi.fn();
    plantumlStdlibLoader('azure.min.js', ok, err);
    expect(err).toHaveBeenCalledWith(expect.stringContaining('not hosted'));
    expect(ok).not.toHaveBeenCalled();
    expect(g.PLANTUML_STDLIB).toBeUndefined();
  });

  it('declines anything that is not a library bundle', () => {
    const err = vi.fn();
    plantumlStdlibLoader('themes.js', vi.fn(), err);
    expect(err).toHaveBeenCalled();
  });

  it('installs itself as the engine global', () => {
    installPlantUmlStdlibLoader();
    expect((globalThis as Record<string, unknown>).PLANTUML_STDLIB_LOADER).toBe(plantumlStdlibLoader);
  });
});

describe('rewriteHostedIncludes (ADR-0010)', () => {
  const RAW = 'https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML';

  it('rewrites the production form to the hosted library, one line for one line', () => {
    const code = `@startuml\n!include ${RAW}/master/C4_Container.puml\nContainer(api, "API")\n@enduml`;
    const { source, rewritten } = rewriteHostedIncludes(code);
    expect(rewritten).toBe(true);
    expect(source).toBe('@startuml\n!include <C4/C4_Container>\nContainer(api, "API")\n@enduml');
    expect(source.split('\n')).toHaveLength(code.split('\n').length);
  });

  it.each([
    [`!includeurl ${RAW}/master/C4_Context.puml`, '!include <C4/C4_Context>'],
    [`!include_once ${RAW}/v2.8.0/C4_Component.puml`, '!include_once <C4/C4_Component>'],
    [`  !include ${RAW}/refs/heads/master/C4_Deployment.puml  `, '  !include <C4/C4_Deployment>'],
    [`!include https://github.com/plantuml-stdlib/C4-PlantUML/raw/master/C4_Sequence.puml`, '!include <C4/C4_Sequence>'],
    [`!include ${RAW}/master/C4_Context.puml\r`, '!include <C4/C4_Context>'],
  ])('rewrites %s', (line, expected) => {
    expect(rewriteHostedIncludes(`@startuml\n${line}\n@enduml`).source).toBe(`@startuml\n${expected}\n@enduml`);
  });

  it.each([
    ['a file the hosted library does not have', `!include ${RAW}/master/percy/C4.puml`],
    ['a C4 file name the library lacks', `!include ${RAW}/master/C4_Bogus.puml`],
    ['another repository', '!include https://raw.githubusercontent.com/someone/C4-PlantUML/master/C4_Context.puml'],
    ['another stdlib repository', '!include https://raw.githubusercontent.com/plantuml-stdlib/gilbarbara-plantuml-sprites/master/sprites/aws.puml'],
    ['a URL inside a note', `note right: see ${RAW}/master/C4_Context.puml`],
  ])('leaves %s alone', (_label, line) => {
    const code = `@startuml\n${line}\n@enduml`;
    expect(rewriteHostedIncludes(code)).toEqual({ source: code, rewritten: false });
  });
});
