/**
 * Polices the path→tag impact map behind PR test selection (ADR-0007 §5):
 * every tag must exist in the closed taxonomy, every glob must still match a
 * tracked file (a rename would otherwise silently un-map an area and turn
 * every PR touching it into a full run), and the selector's rules hold.
 */
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { ALL_TAGS, EXECUTION_SELECTOR_TAGS } from '../e2e-tests/config/tags';
import { EXECUTION_IMPACT, IMPACT, NO_E2E_IMPACT, RUN_EVERYTHING } from '../e2e-tests/config/impact-map.mjs';
import { globToRegExp, select } from '../../scripts/e2e-select.mjs';

const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);
const matchesTracked = (glob: string) => tracked.some((f) => globToRegExp(glob).test(f));

describe('impact map', () => {
  it('uses only tags from the closed taxonomy', () => {
    const unknown = IMPACT.flatMap(({ glob, tags }) => tags.filter((t) => !ALL_TAGS.includes(t as never)).map((t) => `${glob}: ${t}`));
    expect(unknown).toEqual([]);
  });

  it('maps execution impact only to behavior selectors or required smoke', () => {
    const invalid = EXECUTION_IMPACT.flatMap(({ glob, tags }) => tags
      .filter((tag) => tag !== '@smoke' && !EXECUTION_SELECTOR_TAGS.includes(tag))
      .map((tag) => `${glob}: ${tag}`));
    expect(invalid).toEqual([]);
  });

  it.each(IMPACT.map(({ glob }) => glob))('IMPACT glob %s matches a tracked file', (glob) => {
    expect(matchesTracked(glob)).toBe(true);
  });

  it.each(EXECUTION_IMPACT.map(({ glob }) => glob))('EXECUTION_IMPACT glob %s matches a tracked file', (glob) => {
    expect(matchesTracked(glob)).toBe(true);
  });

  it.each(RUN_EVERYTHING)('RUN_EVERYTHING glob %s matches a tracked file', (glob) => {
    expect(matchesTracked(glob)).toBe(true);
  });

  it('has no duplicate IMPACT globs', () => {
    const globs = IMPACT.map(({ glob }) => glob);
    expect(new Set(globs).size).toBe(globs.length);
  });
});

describe('glob matching', () => {
  it('handles **, *, and {a,b}', () => {
    expect(globToRegExp('src/utils/mermaid/**').test('src/utils/mermaid/a/b.ts')).toBe(true);
    expect(globToRegExp('src/utils/mermaid/**').test('src/utils/mermaidx.ts')).toBe(false);
    expect(globToRegExp('**/*.spec.ts').test('a.spec.ts')).toBe(true);
    expect(globToRegExp('**/*.spec.ts').test('src/a/b.spec.ts')).toBe(true);
    expect(globToRegExp('src/forge-graph-*.ts').test('src/forge-graph-editor.ts')).toBe(true);
    expect(globToRegExp('src/forge-graph-*.ts').test('src/forge-graph-editor.spec.ts')).toBe(true);
    expect(globToRegExp('src/{a,b}.ts').test('src/b.ts')).toBe(true);
    expect(globToRegExp('src/{a,b}.ts').test('src/c.ts')).toBe(false);
  });
});

describe('select()', () => {
  it('selects Mermaid render and viewport behavior, plus required smoke', () => {
    const r = select(['src/components/Mermaid.vue']);
    expect(r.mode).toBe('selected');
    expect(r.tags).toEqual(['@smoke', '@test:mermaid', '@test:mermaid-render', '@test:viewport-mermaid']);
    expect(r.grep).toBe('@smoke|@test:mermaid|@test:mermaid-render|@test:viewport-mermaid');
  });

  it('selects Mermaid syntax behavior without viewer or editor expansion', () => {
    const r = select(['src/utils/mermaid/validate.ts']);
    expect(r.mode).toBe('selected');
    expect(r.tags).toEqual(['@smoke', '@test:mermaid-syntax']);
  });

  it('falls back to all tests for an area that only has descriptive impact tags', () => {
    const r = select(['src/utils/paywall/gate.ts']);
    expect(r.mode).toBe('all');
    expect(r.reasons).toEqual(['src/utils/paywall/gate.ts: descriptive impact tags → runs everything (@paywall)']);
  });

  it('runs everything for a shared file, an unmapped file, or no files', () => {
    expect(select(['src/forgeIndex.ts']).mode).toBe('all');
    expect(select(['src/components/Mermaid.vue', 'package.json']).mode).toBe('all');
    expect(select(['some/new/area.ts']).mode).toBe('all');
    expect(select([]).mode).toBe('all');
    expect(select(['src/forgeIndex.ts']).grep).toBe('');
  });

  it('runs everything when an E2E spec changes', () => {
    expect(select(['tests/e2e-tests/tests/insert/mermaid.spec.ts']).mode).toBe('all');
  });

  it('selects only @smoke for files with no E2E impact', () => {
    const r = select(['src/components/Viewer/GenericViewer.spec.ts', 'docs/adr/0001.md', 'tests/unit/x.spec.ts']);
    expect(r.mode).toBe('selected');
    expect(r.tags).toEqual(['@smoke']);
  });

  it('explains every file', () => {
    const r = select(['src/components/Mermaid.vue', 'docs/x.md']);
    expect(r.reasons).toHaveLength(2);
  });
});
