import { beforeAll, describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import { magicSourceHash, sanitizeMagicSvg, validateMagicArtifact } from './artifact';

beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
});

const source = 'graph LR\n  A-->B\n';
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><path d="M0 0L10 10"/><text x="2" y="20">A &amp; B</text></svg>';

describe('Magic artifact contract', () => {
  it('hashes exact UTF-8 bytes, including whitespace and Unicode', async () => {
    expect(await magicSourceHash('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await magicSourceHash(source)).not.toBe(await magicSourceHash(source.trim()));
    expect(await magicSourceHash('A')).not.toBe(await magicSourceHash('Ａ'));
  });

  it('accepts only a validated artifact for the exact source', async () => {
    const artifact = { sourceHash: await magicSourceHash(source), svg, rulesVersion: 'magic-v1' as const, outcome: 'validated' as const };
    expect(await validateMagicArtifact(artifact, source)).toEqual({ svg: sanitizeMagicSvg(svg) });
    expect(await validateMagicArtifact(artifact, source + ' ')).toEqual({ reason: 'stale_source' });
    expect(await validateMagicArtifact(undefined, source)).toEqual({ reason: 'missing_artifact' });
    expect(await validateMagicArtifact({ ...artifact, outcome: 'draft' } as never, source)).toEqual({ reason: 'invalid_artifact' });
  });

  it.each([
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><path d="M0 0"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>bad</div></foreignObject><path d="M0 0"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><path d="M0 0"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><path style="fill:url(https://evil.invalid/x)" d="M0 0"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.invalid/x"/><path d="M0 0"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><path fill="url(https://evil.invalid/x)" d="M0 0"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><text>A</text></a></svg>',
  ])('rejects dangerous SVG markup', malicious => {
    expect(sanitizeMagicSvg(malicious)).toBeNull();
  });

  it('keeps safe marker arrows, palette, fonts, and accessible text from prepared SVG', () => {
    const prepared = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60" role="img" aria-label="Flow">
      <title>Flow</title><desc>Input leads to result</desc>
      <style>.edge { stroke: #345678; stroke-width: 2; } .node { fill: #eef2ff; font-family: Arial; font-size: 14px; }  \n  </style>
      <defs><marker id="arrow-shared" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0 0L8 3L0 6" fill="#345678"/></marker></defs>
      <rect class="node" x="0" y="0" width="30" height="20"/>
      <path class="edge" d="M30 10L100 10" marker-end="url(#arrow-shared)"/>
      <text class="node" x="40" y="30">Input</text>
    </svg>`;
    const sanitized = sanitizeMagicSvg(prepared);
    expect(sanitized).toContain('marker-end="url(#arrow-shared)"');
    expect(sanitized).toContain('stroke="#345678"');
    expect(sanitized).toContain('font-family="Arial"');
    expect(sanitized).toContain('<title>Flow</title>');
    expect(sanitized).toContain('aria-label="Flow"');
    expect(sanitized).not.toContain('<style>');
  });

  it('preserves inert ARIA text containing punctuation and URL-like words', () => {
    const prepared = '<svg xmlns="http://www.w3.org/2000/svg" aria-label="x &lt; 10; see https://example.invalid"><text x="1" y="2">x &lt; 10</text></svg>';
    const sanitized = sanitizeMagicSvg(prepared);
    expect(sanitized).toContain('aria-label="x &lt; 10; see https://example.invalid"');
    expect(sanitized).toContain('x &lt; 10');
  });

  it('resolves supported CSS with presentation attributes, specificity, source order, inline style, and root matching', () => {
    const prepared = `<svg xmlns="http://www.w3.org/2000/svg" class="canvas" fill="red">
      <style>#special { fill: navy; } .node { fill: blue; } rect { fill: green; }
        .node { stroke: orange; } .node { stroke: purple; }
        .canvas { opacity: 0.7; }
      </style>
      <rect id="special" class="node" fill="yellow" x="1" y="2" width="10" height="10"/>
      <rect id="inline" class="node" fill="yellow" style="fill: pink; stroke: black" x="20" y="2" width="10" height="10"/>
    </svg>`;
    const sanitized = sanitizeMagicSvg(prepared);
    expect(sanitized).not.toBeNull();
    const doc = new DOMParser().parseFromString(sanitized!, 'image/svg+xml');
    expect(doc.documentElement.getAttribute('opacity')).toBe('0.7');
    expect(doc.getElementById('special')?.getAttribute('fill')).toBe('navy');
    expect(doc.getElementById('special')?.getAttribute('stroke')).toBe('purple');
    expect(doc.getElementById('inline')?.getAttribute('fill')).toBe('pink');
    expect(doc.getElementById('inline')?.getAttribute('stroke')).toBe('black');
  });

  it('fails closed on unsupported CSS priorities and variables even when selectors do not match', () => {
    expect(sanitizeMagicSvg('<svg xmlns="http://www.w3.org/2000/svg"><style>.absent { fill: red !important; }</style><path d="M0 0"/></svg>')).toBeNull();
    expect(sanitizeMagicSvg('<svg xmlns="http://www.w3.org/2000/svg"><style>.absent { fill: var(--color); }</style><path d="M0 0"/></svg>')).toBeNull();
  });

  it('keeps ID specificity above any number of class selectors', () => {
    const openGroups = '<g class="a">'.repeat(10);
    const selector = Array(11).fill('.a').join(' ');
    const prepared = `<svg xmlns="http://www.w3.org/2000/svg"><style>#special { fill: navy; } ${selector} { fill: blue; }</style>${openGroups}<rect id="special" class="a" x="1" y="1" width="5" height="5"/>${'</g>'.repeat(10)}</svg>`;
    const sanitized = sanitizeMagicSvg(prepared);
    expect(sanitized).not.toBeNull();
    const doc = new DOMParser().parseFromString(sanitized!, 'image/svg+xml');
    expect(doc.getElementById('special')?.getAttribute('fill')).toBe('navy');
  });
});
