import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { onRequest } from './extension-actions';

describe('POST /api/support/extension-actions', () => {
  const auth = { Authorization: 'Bearer automation-secret' };

  it('rejects a request without the dedicated automation secret', async () => {
    const request = new Request('https://example.com/api/support/extension-actions', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const response = await onRequest({
      request,
      env: {
        EXTENSION_AUTOMATION_SECRET: 'automation-secret',
      },
    } as never);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      outcome: 'validation_failed',
      error: 'unauthorized',
    });
  });

  it('rejects commands outside the two fixed extension policies', async () => {
    const request = new Request('https://example.com/api/support/extension-actions', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        action: 'space-wide',
        ticketKey: 'ZEN-1234',
        requestTypeId: '9',
        planOptionId: '10037',
        description: 'ignored',
      }),
    });

    const response = await onRequest({
      request,
      env: { EXTENSION_AUTOMATION_SECRET: 'automation-secret' },
    } as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      outcome: 'validation_failed',
      error: 'invalid_action',
    });
  });

  it('is allowlisted as a Cloudflare Pages Function route', () => {
    const routes = JSON.parse(readFileSync('public/_routes.json', 'utf8')) as { include: string[] };
    expect(routes.include).toContain('/api/support/extension-actions');
  });

  it('rejects a request type that is not the extension form', async () => {
    const request = new Request('https://example.com/api/support/extension-actions', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        action: 'initial',
        ticketKey: 'ZEN-1234',
        requestTypeId: '8',
        planOptionId: '10037',
        description: 'ignored',
      }),
    });

    const response = await onRequest({
      request,
      env: { EXTENSION_AUTOMATION_SECRET: 'automation-secret' },
    } as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      outcome: 'validation_failed',
      error: 'invalid_request_type',
      retryable: false,
    });
  });

  it('rejects attempts to override scope or duration', async () => {
    const request = new Request('https://example.com/api/support/extension-actions', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        action: 'initial',
        ticketKey: 'ZEN-1234',
        requestTypeId: '9',
        planOptionId: '10037',
        description: 'ignored',
        days: 365,
      }),
    });

    const response = await onRequest({
      request,
      env: { EXTENSION_AUTOMATION_SECRET: 'automation-secret' },
    } as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'policy_override_rejected',
    });
  });
});
