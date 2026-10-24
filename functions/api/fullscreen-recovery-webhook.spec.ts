import { describe, expect, it } from 'vitest';
import { onRequest } from './fullscreen-recovery-webhook';

describe('Fullscreen recovery webhook boundary', () => {
  const url = 'https://example.com/api/fullscreen-recovery-webhook';
  it('requires the configured signing secret and never trusts an unsigned body', async () => {
    const missingConfig = await onRequest({ request: new Request(url, { method: 'POST', body: '{}' }),
      env: { DB: {} } } as never);
    expect(missingConfig.status).toBe(503);
    const unsigned = await onRequest({ request: new Request(url, { method: 'POST', body: JSON.stringify({
      type: 'email.delivered', data: { email_id: 'provider-1' },
    }) }), env: { DB: {}, RESEND_WEBHOOK_SECRET: 'whsec_c2VjcmV0' } } as never);
    expect(unsigned.status).toBe(401);
    expect(unsigned.headers.get('cache-control')).toBe('no-store');
  });
});
