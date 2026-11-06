import { describe, expect, it } from 'vitest';
import { OPENAI_APPS_CHALLENGE_PATH, openaiAppsChallengeResponse } from './openaiAppsChallenge';

const URL_ = `https://conf-lite.zenuml.com${OPENAI_APPS_CHALLENGE_PATH}`;

describe('openaiAppsChallengeResponse', () => {
  it('ignores every other path', () => {
    const res = openaiAppsChallengeResponse(new Request('https://conf-lite.zenuml.com/agent-link/mcp'), {
      OPENAI_APPS_CHALLENGE: 'tok',
    });
    expect(res).toBeNull();
  });

  it('answers the configured token alone, as plain text', async () => {
    const res = openaiAppsChallengeResponse(new Request(URL_), { OPENAI_APPS_CHALLENGE: '  tok-123\n' })!;
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await res.text()).toBe('tok-123');
  });

  it('answers 404 when no token is configured', () => {
    expect(openaiAppsChallengeResponse(new Request(URL_), {})!.status).toBe(404);
    expect(openaiAppsChallengeResponse(new Request(URL_), { OPENAI_APPS_CHALLENGE: ' ' })!.status).toBe(404);
  });

  it('refuses methods other than GET and HEAD', () => {
    const res = openaiAppsChallengeResponse(new Request(URL_, { method: 'POST' }), { OPENAI_APPS_CHALLENGE: 'tok' })!;
    expect(res.status).toBe(405);
  });
});
