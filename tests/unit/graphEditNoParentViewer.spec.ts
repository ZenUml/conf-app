import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * EAG-28: Graph edit runs entirely in the nested drawio/index.html iframe
 * (app.min.js). The parent Forge iframe must not eagerly load viewer-static
 * or shape scripts — those are only needed on the graph viewer path.
 */
describe('graph edit: parent iframe skips DrawIO viewer bundle', () => {
  const repoRoot = resolve(__dirname, '..', '..');

  it('index.html does not eagerly load viewer-static or shape scripts', () => {
    const html = readFileSync(resolve(repoRoot, 'index.html'), 'utf8');
    expect(html).not.toMatch(/viewer-static\.min\.js/);
    expect(html).not.toMatch(/drawio\/shapes\/mx(Basic|AWS3D|AWS4)\.js/);
    expect(html).toMatch(/ensureDrawioViewerLoaded/);
  });

  it('forge-graph-editor does not call ensureDrawioViewerLoaded', () => {
    const source = readFileSync(resolve(repoRoot, 'src/forge-graph-editor.ts'), 'utf8');
    expect(source).not.toMatch(/ensureDrawioViewerLoaded/);
    expect(source).not.toMatch(/loadDrawioViewer/);
  });

  it('forge-graph-viewer still lazy-loads the parent viewer bundle', () => {
    const source = readFileSync(resolve(repoRoot, 'src/forge-graph-viewer.ts'), 'utf8');
    expect(source).toMatch(/ensureDrawioViewerLoaded/);
  });
});
