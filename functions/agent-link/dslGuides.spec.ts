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
import { OPENAPI_DSL_GUIDE, OPENAPI_DSL_GUIDE_URI } from './openApiDslGuide';

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

  it('OpenAPI: leads with "this is a SPEC, not a diagram DSL"', () => {
    expect(OPENAPI_DSL_GUIDE).toContain('This is a SPEC, not a diagram DSL');
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

  it('PlantUML top-3: sub-type mixing, C4 style macros, quoting/envelope', () => {
    expect(PLANTUML_DSL_GUIDE).toContain("Don't mix construct families");
    // rule #2 was rewritten (Track E1 deep-fix): the old `!define` fix was
    // verified inert for C4-PlantUML; UpdateElementStyle/AddElementTag is the
    // real mechanism (reports/E1-PLANTUML-DEEPFIX.md).
    expect(PLANTUML_DSL_GUIDE).toContain('UpdateElementStyle');
    expect(PLANTUML_DSL_GUIDE).toContain('AddElementTag');
    expect(PLANTUML_DSL_GUIDE).toContain('curly/smart quotes');
    expect(PLANTUML_DSL_GUIDE).toContain('Exactly one `@startuml`');
  });

  it('PlantUML: the arrow-comparison-table correction — ->>/-->> are real PlantUML, not a Mermaid-ism', () => {
    // Track E1 deep-fix: the table used to wrongly claim these were Mermaid-only
    // and should be rewritten as ->/-->; that false premise is corrected here.
    expect(PLANTUML_DSL_GUIDE).toContain('ARE real PlantUML, not a Mermaid-ism');
    expect(PLANTUML_DSL_GUIDE).toContain('Do NOT "correct"');
    expect(PLANTUML_DSL_GUIDE).toContain('those tokens are not a Mermaid-ism to fix');
  });

  it('OpenAPI top-2 (100% of the mined corpus): indentation, duplicate keys', () => {
    expect(OPENAPI_DSL_GUIDE).toContain('Keep indentation consistent at every mapping level');
    expect(OPENAPI_DSL_GUIDE).toContain('Never repeat a key at the same mapping level');
    expect(OPENAPI_DSL_GUIDE).toContain('52.9%');
    expect(OPENAPI_DSL_GUIDE).toContain('47.1%');
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

// Track E1 (diagramly.ai-agent-link-eval) validated the minimal-edit contract
// as the single biggest lever on mermaid/plantuml (+60pp class improvement —
// reports/E1-nonclean-attribution.md + reports/E1-ROUND23-SYNTHESIS.md).
// Ported into every dialect guide, including zenuml/openapi/combined which
// were not individually A/B-tested (cross-dialect application, not a
// separately measured win for those three).
describe('guide content — the minimal-edit contract is present on every dialect guide', () => {
  const ALL_GUIDES: Record<string, string> = {
    zenuml: ZENUML_DSL_GUIDE,
    mermaid: MERMAID_DSL_GUIDE,
    plantuml: PLANTUML_DSL_GUIDE,
    openapi: OPENAPI_DSL_GUIDE,
    combined: COMBINED_DSL_GUIDE,
  };
  for (const [name, guide] of Object.entries(ALL_GUIDES)) {
    it(`${name}: carries the "Minimal-edit contract" section + the no-op-is-a-failure rule`, () => {
      expect(guide).toContain('Minimal-edit contract');
      expect(guide).toMatch(/no-op is a failure, not a safe default/i);
    });
  }
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

  it('OpenAPI → its own minimal guide (a spec, not a diagram DSL, but still guided)', () => {
    expect(resolveGuideSelection('OpenApi')).toBe('openapi');
    expect(resolveGuideSelection('openapi')).toBe('openapi');
  });

  it('known non-guided types → none (no guide, generic behavior)', () => {
    for (const t of ['Graph', 'AsyncApi', 'Embed', 'Unknown']) {
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
  it('openapi → the OpenAPI guide', () => {
    expect(selectInstructions('OpenApi')).toBe(OPENAPI_DSL_GUIDE);
  });
  it('non-guided type → undefined (serve no instructions)', () => {
    expect(selectInstructions('Graph')).toBeUndefined();
    expect(selectInstructions('AsyncApi')).toBeUndefined();
  });
});

describe('selectToolHint (update_diagram description) picks the right hint', () => {
  it('unknown → combined hint; DSL → dialect hint; openapi → its hint; non-guided → undefined', () => {
    expect(selectToolHint(undefined)).toBe(COMBINED_DSL_TOOL_HINT);
    expect(selectToolHint('Sequence')).toMatch(/ZenUML DSL/);
    expect(selectToolHint('Mermaid')).toMatch(/Mermaid DSL/);
    expect(selectToolHint('PlantUml')).toMatch(/PlantUML DSL/);
    expect(selectToolHint('OpenApi')).toMatch(/OpenAPI\/Swagger/);
    expect(selectToolHint('Graph')).toBeUndefined();
  });
});

describe('resources', () => {
  it('listGuideResources advertises all four guides (three diagram DSLs + OpenAPI)', () => {
    const uris = listGuideResources().map((r) => r.uri).sort();
    expect(uris).toEqual(
      [MERMAID_DSL_GUIDE_URI, PLANTUML_DSL_GUIDE_URI, ZENUML_DSL_GUIDE_URI, OPENAPI_DSL_GUIDE_URI].sort(),
    );
  });

  it('getGuideByUri resolves each dialect URI to its guide text', () => {
    expect(getGuideByUri(ZENUML_DSL_GUIDE_URI)?.text).toBe(ZENUML_DSL_GUIDE);
    expect(getGuideByUri(MERMAID_DSL_GUIDE_URI)?.text).toBe(MERMAID_DSL_GUIDE);
    expect(getGuideByUri(PLANTUML_DSL_GUIDE_URI)?.text).toBe(PLANTUML_DSL_GUIDE);
    expect(getGuideByUri(OPENAPI_DSL_GUIDE_URI)?.text).toBe(OPENAPI_DSL_GUIDE);
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
    expect(getGuideText('openapi')).toBe(OPENAPI_DSL_GUIDE);
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
  const ALL = [ZENUML_DSL_GUIDE, MERMAID_DSL_GUIDE, PLANTUML_DSL_GUIDE, OPENAPI_DSL_GUIDE, COMBINED_DSL_GUIDE].join(
    '\n',
  );
  for (const s of FORBIDDEN) {
    it(`does not contain "${s}"`, () => {
      expect(ALL).not.toContain(s);
    });
  }
});
