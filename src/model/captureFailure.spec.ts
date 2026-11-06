import { describe, it, expect } from 'vitest';
import {
  CaptureStageError,
  describeCaptureError,
  captureStageOf,
  captureMacroType,
  CAPTURE_ERROR_MAX_LENGTH,
} from './captureFailure';

function errorEvent(target?: Element): Event {
  const ev = new Event('error');
  if (target) Object.defineProperty(ev, 'target', { value: target });
  return ev;
}

describe('captureStageOf', () => {
  it('reads the stage off a CaptureStageError', () => {
    expect(captureStageOf(new CaptureStageError('svg_load', new Event('error')))).toBe('svg_load');
  });
  it('is unknown for any other rejection', () => {
    expect(captureStageOf(new Error('x'))).toBe('unknown');
    expect(captureStageOf(new Event('error'))).toBe('unknown');
    expect(captureStageOf(undefined)).toBe('unknown');
  });
});

describe('CaptureStageError', () => {
  it('keeps the original reason as cause and as readable message', () => {
    const cause = new Error('boom');
    const e = new CaptureStageError('dom_to_svg', cause);
    expect(e).toBeInstanceOf(Error);
    expect(e.cause).toBe(cause);
    expect(e.message).toBe('boom');
  });
  it('gives a DOM Event a readable message', () => {
    const e = new CaptureStageError('inline_images', errorEvent(document.createElement('img')));
    expect(e.message).toBe('image error event');
  });
});

describe('describeCaptureError', () => {
  it('turns a raw DOM Event from an image into readable text', () => {
    expect(describeCaptureError(errorEvent(document.createElement('img')))).toBe('image error event');
  });
  it('names a non-image target by its tag', () => {
    expect(describeCaptureError(errorEvent(document.createElement('canvas')))).toBe('canvas error event');
  });
  it('handles an Event with no target', () => {
    expect(describeCaptureError(new Event('error'))).toBe('error event');
  });
  it('uses the Error name and message', () => {
    expect(describeCaptureError(new TypeError('x is not a function'))).toBe('TypeError: x is not a function');
  });
  it('strips http URLs and query strings', () => {
    const out = describeCaptureError(new Error('captureBlob: image https://icons.example.com/a/b.svg?token=abc&x=1 returned 404'));
    expect(out).not.toContain('example.com');
    expect(out).not.toContain('token');
    expect(out).not.toContain('?');
    expect(out).toContain('returned 404');
  });
  it('strips data URLs', () => {
    const out = describeCaptureError(new Error('bad image data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dyI+SECRETDIAGRAMTEXT end'));
    expect(out).not.toContain('SECRET');
    expect(out).not.toContain('PHN2Zy');
  });
  it('strips blob URLs and protocol-relative URLs', () => {
    const out = describeCaptureError(new Error('blob:https://x.atlassian.net/1234-abcd and //cdn.example.com/x.png failed'));
    expect(out).not.toContain('atlassian');
    expect(out).not.toContain('cdn.example');
  });
  it('caps the length', () => {
    const out = describeCaptureError(new Error('a'.repeat(500)));
    expect(out.length).toBeLessThanOrEqual(CAPTURE_ERROR_MAX_LENGTH);
    expect(CAPTURE_ERROR_MAX_LENGTH).toBe(120);
  });
  it('collapses whitespace and newlines', () => {
    expect(describeCaptureError(new Error('a\n  b\t c'))).toBe('Error: a b c');
  });
  it('describes strings and other values without echoing objects', () => {
    expect(describeCaptureError('plain https://a.example/x')).toBe('plain <url>');
    expect(describeCaptureError({ secret: 'diagram text' })).toBe('non-error object');
    expect(describeCaptureError(undefined)).toBe('no error value');
    expect(describeCaptureError(null)).toBe('no error value');
    expect(describeCaptureError(42)).toBe('non-error number');
  });
  it('unwraps a CaptureStageError to its cause text', () => {
    expect(describeCaptureError(new CaptureStageError('canvas', new Error('no ctx')))).toBe('Error: no ctx');
  });
});

describe('captureMacroType', () => {
  it.each([
    ['sequence', 'sequence'],
    ['zenuml', 'sequence'],
    ['mermaid', 'mermaid'],
    ['plantuml', 'plantuml'],
    ['graph', 'graph'],
    ['OpenAPI', 'openapi'],
    ['AsyncAPI', 'asyncapi'],
    ['embed', 'embed'],
    ['markdown', 'markdown'],
    [undefined, 'none'],
    ['unknown', 'none'],
    ['something else', 'none'],
  ])('%s -> %s', (input, expected) => {
    expect(captureMacroType(input)).toBe(expected);
  });
});
