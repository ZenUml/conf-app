import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Connect cleanup Task 3: window.AP?.resize() was a Connect-era call that
// silently no-ops in pure Forge (window.AP is undefined). @forge/bridge
// has no public `view.resize()` — Custom UI iframes auto-size. So the
// correct cleanup is to delete the dead calls, not replace them.
//
// This test locks in that the two known call sites no longer reference
// window.AP. A regex-against-source test is appropriate here because the
// surrounding code paths (ResizeObserver, EventBus 'diagramLoaded') are
// otherwise hard to drive in a unit test.
describe('Connect cleanup: window.AP removed from former resize call sites', () => {
  const targets = [
    'src/forgeIndex.ts',
    'src/components/Viewer/ViewResizer.vue',
  ];

  for (const rel of targets) {
    it(`${rel} contains no window.AP references`, () => {
      const abs = resolve(__dirname, '..', '..', rel);
      const source = readFileSync(abs, 'utf8');
      expect(source).not.toMatch(/window\.AP/);
    });
  }
});
