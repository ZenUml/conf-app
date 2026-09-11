import { describe, expect, it } from 'vitest';
import { normalizePlantUmlSvg } from './normalizeSvg';

describe('normalizePlantUmlSvg', () => {
  it('removes PlantUML processing instructions while preserving diagram shapes', () => {
    const svg =
      '<svg viewBox="0 0 200 120"><g><rect width="100" height="40" />' +
      '<?plantuml-src encoded-source?><?plantuml version="1.2026.7"?>' +
      '</g></svg>';

    const normalized = normalizePlantUmlSvg(svg);

    expect(normalized).toContain('<rect width="100" height="40" />');
    expect(normalized).not.toContain('<?plantuml-src');
    expect(normalized).not.toContain('<?plantuml version');
  });
});
