import { describe, it, expect } from 'vitest';
import {
  COMBINED_DSL_GUIDE,
  COMBINED_DSL_TOOL_HINT,
  getGuideByUri,
  getGuideText,
  listGuideResources,
  resolveGuideSelection,
  selectInstructions,
  selectToolHint,
} from './dslGuides';
import { ZENUML_DSL_GUIDE, ZENUML_DSL_GUIDE_URI } from './zenumlDslGuide';
import { MERMAID_DSL_GUIDE, MERMAID_DSL_GUIDE_URI } from './mermaidDslGuide';
import { PLANTUML_DSL_GUIDE, PLANTUML_DSL_GUIDE_URI } from './plantumlDslGuide';

describe('guide content — each dialect leads with its disambiguation table', () => {
  it('ZenUML: "This is ZenUML — NOT Mermaid or PlantUML"', () => {
    expect(ZENUML_DSL_GUIDE).toContain('This is ZenUML — NOT Mermaid or PlantUML');
    // the exact blended constructs the mining data flagged
    expect(ZENUML_DSL_GUIDE).toMatch(/alt cond/);
    expect(ZENUML_DSL_GUIDE).toMatch(/@startuml/);
    expect(ZENUML_DSL_GUIDE).toMatch(/sequenceDiagram/);
  });

  it('Mermaid: "This is Mermaid — NOT ZenUML or PlantUML"', () => {
    expect(MERMAID_DSL_GUIDE).toContain('This is Mermaid — NOT ZenUML or PlantUML');
    expect(MERMAID_DSL_GUIDE).toMatch(/@startuml/);
    expect(MERMAID_DSL_GUIDE).toMatch(/ID\["Name"\]/);
  });

  it('PlantUML: "This is PlantUML — NOT Mermaid or ZenUML"', () => {
    expect(PLANTUML_DSL_GUIDE).toContain('This is PlantUML — NOT Mermaid or ZenUML');
    expect(PLANTUML_DSL_GUIDE).toMatch(/sequenceDiagram/);
    expect(PLANTUML_DSL_GUIDE).toMatch(/@Actor/);
  });
});

describe('guide content — each guide encodes its top-3 mined signatures', () => {
  it('ZenUML top-3: sync/async form, if/no-alt, if-condition mixing', () => {
    expect(ZENUML_DSL_GUIDE).toContain('never bolt a { } body onto');
    expect(ZENUML_DSL_GUIDE).toContain('there is NO `alt` keyword');
    expect(ZENUML_DSL_GUIDE).toContain('EITHER bare words OR an operator expression');
    // the existing resources/read test contract: the control-flow example
    expect(ZENUML_DSL_GUIDE).toMatch(/if \(cond\)/);
    // honesty annotation: rules trace to real failure counts
    expect(ZENUML_DSL_GUIDE).toMatch(/Grounded in .* failures/);
  });

  it('Mermaid top-3: quote special chars, no fence leakage, flowchart-vs-sequence', () => {
    expect(MERMAID_DSL_GUIDE).toContain('Quote any label containing');
    expect(MERMAID_DSL_GUIDE).toContain('Never leave markdown fences');
    expect(MERMAID_DSL_GUIDE).toContain("alias with `as`");
    expect(MERMAID_DSL_GUIDE).toContain('23.7%'); // the #1 signature's real share
  });

  it('PlantUML top-3: sub-type mixing, !define, quoting/envelope', () => {
    expect(PLANTUML_DSL_GUIDE).toContain("Don't mix construct families");
    expect(PLANTUML_DSL_GUIDE).toContain('!define NAME value');
    expect(PLANTUML_DSL_GUIDE).toContain('curly/smart quotes');
    expect(PLANTUML_DSL_GUIDE).toContain('Exactly one `@startuml`');
  });

  it('Combined guide leads with the cross-dialect blending warning + all three resource URIs', () => {
    expect(COMBINED_DSL_GUIDE).toContain('DO NOT blend');
    expect(COMBINED_DSL_GUIDE).toContain(ZENUML_DSL_GUIDE_URI);
    expect(COMBINED_DSL_GUIDE).toContain(MERMAID_DSL_GUIDE_URI);
    expect(COMBINED_DSL_GUIDE).toContain(PLANTUML_DSL_GUIDE_URI);
    // explicitly excuses non-DSL types so a Graph/OpenApi session isn't misled
    expect(COMBINED_DSL_GUIDE).toMatch(/Graph, OpenApi, AsyncApi, or Embed/);
  });
});

describe('resolveGuideSelection maps a macro diagramType to what to serve', () => {
  it('not-yet-known type (undefined/blank) → combined', () => {
    expect(resolveGuideSelection(undefined)).toBe('combined');
    expect(resolveGuideSelection(null)).toBe('combined');
    expect(resolveGuideSelection('')).toBe('combined');
    expect(resolveGuideSelection('   ')).toBe('combined');
  });

  it('DSL types → their dialect (case/synonym-insensitive via normalizeDialect)', () => {
    expect(resolveGuideSelection('Sequence')).toBe('zenuml');
    expect(resolveGuideSelection('zenuml')).toBe('zenuml');
    expect(resolveGuideSelection('Mermaid')).toBe('mermaid');
    expect(resolveGuideSelection('PlantUml')).toBe('plantuml');
  });

  it('known non-DSL types → none (no guide, generic behavior)', () => {
    for (const t of ['Graph', 'OpenApi', 'AsyncApi', 'Embed', 'Unknown']) {
      expect(resolveGuideSelection(t)).toBe('none');
    }
  });
});

describe('selectInstructions (initialize) picks the right guide', () => {
  it('unknown type → combined guide', () => {
    expect(selectInstructions(undefined)).toBe(COMBINED_DSL_GUIDE);
  });
  it('sequence → ZenUML guide, mermaid → Mermaid guide, plantuml → PlantUML guide', () => {
    expect(selectInstructions('Sequence')).toBe(ZENUML_DSL_GUIDE);
    expect(selectInstructions('Mermaid')).toBe(MERMAID_DSL_GUIDE);
    expect(selectInstructions('PlantUml')).toBe(PLANTUML_DSL_GUIDE);
  });
  it('non-DSL type → undefined (serve no instructions)', () => {
    expect(selectInstructions('Graph')).toBeUndefined();
    expect(selectInstructions('OpenApi')).toBeUndefined();
  });
});

describe('selectToolHint (update_diagram description) picks the right hint', () => {
  it('unknown → combined hint; DSL → dialect hint; non-DSL → undefined', () => {
    expect(selectToolHint(undefined)).toBe(COMBINED_DSL_TOOL_HINT);
    expect(selectToolHint('Sequence')).toMatch(/ZenUML DSL/);
    expect(selectToolHint('Mermaid')).toMatch(/Mermaid DSL/);
    expect(selectToolHint('PlantUml')).toMatch(/PlantUML DSL/);
    expect(selectToolHint('Graph')).toBeUndefined();
  });
});

describe('resources', () => {
  it('listGuideResources advertises all three dialect guides', () => {
    const uris = listGuideResources().map((r) => r.uri).sort();
    expect(uris).toEqual([MERMAID_DSL_GUIDE_URI, PLANTUML_DSL_GUIDE_URI, ZENUML_DSL_GUIDE_URI].sort());
  });

  it('getGuideByUri resolves each dialect URI to its guide text', () => {
    expect(getGuideByUri(ZENUML_DSL_GUIDE_URI)?.text).toBe(ZENUML_DSL_GUIDE);
    expect(getGuideByUri(MERMAID_DSL_GUIDE_URI)?.text).toBe(MERMAID_DSL_GUIDE);
    expect(getGuideByUri(PLANTUML_DSL_GUIDE_URI)?.text).toBe(PLANTUML_DSL_GUIDE);
  });

  it('getGuideByUri returns undefined for an unknown URI', () => {
    expect(getGuideByUri('zenuml://nope')).toBeUndefined();
    expect(getGuideByUri('')).toBeUndefined();
  });
});

describe('getGuideText (Track E1 single-source accessor)', () => {
  it('returns the right text per dialect key + combined', () => {
    expect(getGuideText('zenuml')).toBe(ZENUML_DSL_GUIDE);
    expect(getGuideText('mermaid')).toBe(MERMAID_DSL_GUIDE);
    expect(getGuideText('plantuml')).toBe(PLANTUML_DSL_GUIDE);
    expect(getGuideText('combined')).toBe(COMBINED_DSL_GUIDE);
  });
});

// Client-privacy hard rule: no real tenant/user/product/company names may
// appear in any public-repo file. The mining artifact claims it sanitized its
// examples, but several corpus participant/company identifiers still appeared
// there (e.g. "FM Logistics", "Kvinta", "Alpaca", "Prime API"). Every guide
// example here genericised its identifiers while preserving the syntactic shape
// of the bug — this test proves none of those strings leaked through.
describe('sanitization — no corpus-identifying strings leak into any guide', () => {
  const FORBIDDEN = [
    'FM Logistics', 'Kvinta', 'Alpaca', 'Prime API', 'TLZEventService',
    'LiveopsService', 'KEVEL', 'Unity Test Connector', 'PluginRequest',
    'domain.models', 'moonactive', 'colesgroup', 'Hiển thị', '契約',
    'OpCo', 'isValidPlate',
  ];
  const ALL = [ZENUML_DSL_GUIDE, MERMAID_DSL_GUIDE, PLANTUML_DSL_GUIDE, COMBINED_DSL_GUIDE].join('\n');
  for (const s of FORBIDDEN) {
    it(`does not contain "${s}"`, () => {
      expect(ALL).not.toContain(s);
    });
  }
});
