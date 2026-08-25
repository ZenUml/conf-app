import { describe, expect, it } from 'vitest';
import { mermaid112JisonParserFactory } from './mermaid112JisonParserFactory';

describe('mermaid112JisonParserFactory', () => {
  it('creates isolated browser-safe parsers from the pinned generated artifact', () => {
    const factory = mermaid112JisonParserFactory();
    const first = factory.createParser();
    const second = factory.createParser();

    expect(factory.adapterVersion).toBe('mermaid-flowchart-jison@11.12.2+39e8a84d');
    expect(first).not.toBe(second);
    expect(first.lexer).not.toBe(second.lexer);
    expect(first.lexer.options).not.toBe(second.lexer.options);
    expect(first.productions_.length).toBeGreaterThan(0);
    expect(Object.keys(first.symbols_)).toContain('vertex');
    expect(Object.keys(first.symbols_)).toContain('vertexStatement');
  });
});
