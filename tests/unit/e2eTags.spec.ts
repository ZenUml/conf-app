/**
 * Every E2E spec carries the closed tag taxonomy (ADR-0007 §5).
 *
 * The impact-based selection on PRs runs only the specs whose tags match the
 * changed source paths (plus `@smoke`), so a spec with a missing or misspelt
 * tag is a spec that is silently never selected for the change it covers.
 * This guard makes that impossible to land: every top-level `test.describe`
 * / `test` block in tests/e2e-tests/tests must declare a `{ tag: [...] }`
 * details object whose tags all come from `tests/e2e-tests/config/tags.ts`,
 * with at least one SURFACE tag and at least one TYPE or CONCERN tag — the
 * same closed-set discipline `storyTitles.spec.ts` applies to the Storybook
 * tree.
 *
 * Only top-level blocks are checked: Playwright propagates a describe's tags
 * to everything nested in it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_TAGS, CONCERN_TAGS, SURFACE_TAGS, TYPE_TAGS } from '../e2e-tests/config/tags';

const ROOT = path.resolve(__dirname, '../e2e-tests/tests');

function specFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return specFiles(p);
    return d.isFile() && d.name.endsWith('.spec.ts') ? [p] : [];
  });
}

/** Top-level `test(...)` / `test.describe(...)` / `test.describe.serial(...)` heads, with their details object if any. */
const HEAD = /^(test(?:\.describe(?:\.serial|\.parallel)?)?)\(\s*(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`[^`]*`)\s*,\s*(\{[^}]*\})?/gm;

function topLevelBlocks(source: string): Array<{ head: string; tags: string[] | null }> {
  const out: Array<{ head: string; tags: string[] | null }> = [];
  for (const m of source.matchAll(HEAD)) {
    const details = m[2];
    const tagMatch = details?.match(/tag:\s*(\[[^\]]*\]|'[^']*'|"[^"]*")/);
    out.push({
      head: m[0].slice(0, 80),
      tags: tagMatch ? [...tagMatch[1].matchAll(/@[\w-]+/g)].map((t) => t[0]) : null,
    });
  }
  return out;
}

const files = specFiles(ROOT);

describe('E2E tag taxonomy', () => {
  it('finds the specs', () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it('keeps the three axes disjoint', () => {
    const all = [...SURFACE_TAGS, ...TYPE_TAGS, ...CONCERN_TAGS];
    expect(new Set(all).size).toBe(all.length);
  });

  for (const file of files) {
    const rel = path.relative(ROOT, file);
    it(`${rel}: every top-level block carries a surface tag and a type or concern tag from the closed sets`, () => {
      const blocks = topLevelBlocks(fs.readFileSync(file, 'utf8'));
      expect(blocks.length, 'at least one top-level test/describe').toBeGreaterThan(0);
      for (const b of blocks) {
        expect(b.tags, `missing { tag: [...] } on: ${b.head}`).not.toBeNull();
        const tags = b.tags!;
        expect(tags.filter((t) => !ALL_TAGS.includes(t)), `tags not in config/tags.ts on: ${b.head}`).toEqual([]);
        expect(tags.some((t) => (SURFACE_TAGS as readonly string[]).includes(t)), `no surface tag on: ${b.head}`).toBe(true);
        expect(
          tags.some((t) => (TYPE_TAGS as readonly string[]).includes(t) || (CONCERN_TAGS as readonly string[]).includes(t)),
          `no type or concern tag on: ${b.head}`,
        ).toBe(true);
      }
    });
  }
});
