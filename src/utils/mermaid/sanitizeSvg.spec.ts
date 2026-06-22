import { describe, it, expect } from 'vitest';
import { sanitizeSvg } from './sanitizeSvg';

describe('sanitizeSvg', () => {
  it('returns undefined for empty / non-string / non-svg input', () => {
    expect(sanitizeSvg('')).toBeUndefined();
    expect(sanitizeSvg(undefined)).toBeUndefined();
    expect(sanitizeSvg(null)).toBeUndefined();
    expect(sanitizeSvg('<div>not an svg</div>')).toBeUndefined();
  });

  it('preserves the mermaid SVG structure (fidelity): svg/g/path/text/style/foreignObject/marker', () => {
    const mermaidish = [
      '<svg id="m" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">',
      '<style>.node{fill:#fff}</style>',
      '<marker id="arrow"><path d="M0,0 L10,5 L0,10"/></marker>',
      '<g class="root"><path class="edge" d="M0,0 L50,50"/>',
      '<text x="10" y="20">Alice</text>',
      '<foreignObject width="80" height="20"><div xmlns="http://www.w3.org/1999/xhtml">Label</div></foreignObject>',
      '</g></svg>',
    ].join('');
    const clean = sanitizeSvg(mermaidish);
    expect(clean).toBeDefined();
    expect(clean).toMatch(/<svg/i);
    expect(clean).toMatch(/<path/i);
    expect(clean).toMatch(/<text[^>]*>Alice<\/text>/i);
    expect(clean).toMatch(/<foreignObject/i);
    expect(clean).toMatch(/Label/);
    expect(clean).toMatch(/<marker/i);
  });

  it('strips <script> elements', () => {
    const clean = sanitizeSvg('<svg><script>alert(1)</script><path d="M0 0"/></svg>');
    expect(clean).toBeDefined();
    expect(clean!.toLowerCase()).not.toContain('<script');
    expect(clean).toMatch(/<path/i);
  });

  it('strips inline event handlers (onload/onclick/onerror)', () => {
    const clean = sanitizeSvg(
      '<svg onload="alert(1)"><rect onclick="steal()"/><image href="x" onerror="alert(2)"/></svg>',
    );
    expect(clean).toBeDefined();
    const lc = clean!.toLowerCase();
    expect(lc).not.toContain('onload');
    expect(lc).not.toContain('onclick');
    expect(lc).not.toContain('onerror');
    expect(lc).not.toContain('alert');
  });

  it('strips javascript: URIs in links', () => {
    const clean = sanitizeSvg('<svg><a href="javascript:alert(1)"><text>x</text></a></svg>');
    expect(clean).toBeDefined();
    expect(clean!.toLowerCase()).not.toContain('javascript:');
  });
});
