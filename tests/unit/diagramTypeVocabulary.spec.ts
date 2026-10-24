import { describe, it, expect } from 'vitest';
import { DiagramType } from '../../src/model/Diagram/Diagram';
import { STORED_DIAGRAM_TYPES, foldDiagramType, toMacroType } from '../../src/lib/diagramTypeVocabulary.js';
import { toMacroType as bylineToMacroType } from '../../src/utils/byline/pageDiagrams';
import { macroTypeFromParsed } from '../../src/export.js';

// The module cannot import the enum (it must stay import-free for the Forge
// bundler), so this test is the link between the two.
const ENUM_TYPES = Object.values(DiagramType).filter((v) => v !== DiagramType.Unknown);

describe('diagramTypeVocabulary', () => {
  it('stored spellings equal the DiagramType enum values (minus Unknown)', () => {
    expect([...STORED_DIAGRAM_TYPES].sort()).toEqual([...ENUM_TYPES].sort());
  });

  it.each(ENUM_TYPES)('%s resolves to a macro type in stored and lower-case spelling', (type) => {
    expect(toMacroType(type)).not.toBe('none');
    expect(toMacroType(type.toLowerCase())).not.toBe('none');
    expect(toMacroType(type)).toBe(type.toLowerCase());
    expect(foldDiagramType(type.toLowerCase())).toBe(type);
    expect(foldDiagramType(type.toUpperCase())).toBe(type);
  });

  it('unknown or non-string input folds to null / none', () => {
    expect(foldDiagramType('drawio')).toBeNull();
    expect(foldDiagramType('unknown')).toBeNull();
    expect(foldDiagramType(undefined)).toBeNull();
    expect(foldDiagramType(42)).toBeNull();
    expect(toMacroType('drawio')).toBe('none');
    expect(toMacroType(null)).toBe('none');
  });

  it('every surface agrees for every type', () => {
    for (const type of ENUM_TYPES) {
      for (const spelling of [type, type.toLowerCase()]) {
        expect(bylineToMacroType(spelling)).toBe(toMacroType(spelling));
        expect(macroTypeFromParsed({ diagramType: spelling })).toBe(toMacroType(spelling));
      }
    }
  });

  it('export.js folds case: an openapi-spelled body is openapi, not none', () => {
    expect(macroTypeFromParsed({ diagramType: 'openapi' })).toBe('openapi');
    expect(macroTypeFromParsed({ diagramType: 'asyncapi' })).toBe('asyncapi');
    expect(macroTypeFromParsed({ diagramType: 'bogus' })).toBe('none');
    expect(macroTypeFromParsed(null)).toBe('none');
  });
});
