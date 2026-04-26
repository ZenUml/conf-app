import { describe, it, expect, vi } from 'vitest';
import { onRequestPost } from '../../functions/ai-generate-title';

function makeRequest(body: unknown): Request {
  return new Request('https://example.com/ai-generate-title', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeInvalidJsonRequest(): Request {
  return new Request('https://example.com/ai-generate-title', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not-valid-json',
  });
}

describe('ai-generate-title', () => {
  it('returns 400 when dsl is missing from body', async () => {
    const ai = { run: vi.fn() };
    const request = makeRequest({ type: 'sequence' });
    const response = await onRequestPost({ request, env: { AI: ai as any } });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('dsl');
  });

  it('returns 400 for invalid JSON', async () => {
    const ai = { run: vi.fn() };
    const request = makeInvalidJsonRequest();
    const response = await onRequestPost({ request, env: { AI: ai as any } });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('Invalid JSON body');
  });

  it('returns 200 with extracted title when strategy 1 matches triple-quoted title', async () => {
    const ai = {
      run: vi.fn().mockResolvedValue({ response: '"""My Diagram Title"""' }),
    };
    const request = makeRequest({ dsl: 'A -> B: hello', type: 'sequence' });
    const response = await onRequestPost({ request, env: { AI: ai as any } });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('My Diagram Title');
  });

  it('returns 500 when both strategies fail to extract a title', async () => {
    const ai = {
      run: vi.fn().mockResolvedValue({ response: 'No title here at all' }),
    };
    const request = makeRequest({ dsl: 'A -> B: hello' });
    const response = await onRequestPost({ request, env: { AI: ai as any } });
    expect(response.status).toBe(500);
  });
});
