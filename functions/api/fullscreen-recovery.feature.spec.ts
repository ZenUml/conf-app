import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../service/fullscreenRecoveryService', async (importOriginal) => ({
  ...await importOriginal<typeof import('../service/fullscreenRecoveryService')>(),
  createRecoveryRequest: vi.fn(),
  activateRecovery: vi.fn(),
  recoverySnapshot: vi.fn(),
}));
import { activateRecovery, createRecoveryRequest, parseRecoveryActivation, parseRecoveryRequest, recoverySnapshot } from '../service/fullscreenRecoveryService';
import { onRequestGet, onRequestPost } from './fullscreen-recovery';

const fit = { cloudId: 'cloud-a', accountId: 'user-a', forgeAppId: '8ad26115-211f-4216-971b-0540f606303d' };
const request = {
  action: 'request', attemptId: '34307364-d627-453f-948f-3cf183955a81', scenarios: ['present'],
  note: '', email: 'person@example.test', consent: true, consentVersion: 'fullscreen-contact-v1', spaceKey: 'ENG',
};
const activation = {
  action: 'activate', attemptId: '34307364-d627-453f-948f-3cf183955a81',
  requestId: '11111111-2222-4333-8444-555555555555', spaceKey: 'ENG',
};
const snapshot = { state: 'not_requested', serverNow: '2026-11-13T00:00:00.000Z', policyVersion: 'fullscreen-contact-v1' };

const post = (body: object) => onRequestPost({
  request: new Request('https://example.test/api/fullscreen-recovery', { method: 'POST', body: JSON.stringify(body) }),
  env: {}, data: { forgeContext: fit }, waitUntil: () => {},
} as never);
const get = (query = '') => onRequestGet({
  request: new Request(`https://example.test/api/fullscreen-recovery${query}`),
  env: {}, data: { forgeContext: fit },
} as never);

afterEach(() => vi.clearAllMocks());

describe('recovery feature parameter on the API', () => {
  it('treats an absent feature as fullscreen on every action', async () => {
    vi.mocked(recoverySnapshot).mockResolvedValue(snapshot as never);
    vi.mocked(createRecoveryRequest).mockResolvedValue({ snapshot, outcome: 'reused' } as never);
    vi.mocked(activateRecovery).mockResolvedValue({ snapshot, outcome: 'already_active' } as never);
    expect((await get('?spaceKey=ENG')).status).toBe(200);
    expect((await post(request)).status).toBe(200);
    expect((await post(activation)).status).toBe(200);
    expect(parseRecoveryRequest(request).feature ?? 'fullscreen').toBe('fullscreen');
    expect(parseRecoveryActivation(activation).feature ?? 'fullscreen').toBe('fullscreen');
  });

  it('accepts an explicit fullscreen feature', async () => {
    vi.mocked(createRecoveryRequest).mockResolvedValue({ snapshot, outcome: 'reused' } as never);
    expect((await post({ ...request, feature: 'fullscreen' })).status).toBe(200);
  });

  it('rejects an unknown feature with the existing invalid-input errors', async () => {
    const bad = await post({ ...request, feature: 'edit' });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'invalid_request' });
    const badActivation = await post({ ...activation, feature: 'edit' });
    expect(badActivation.status).toBe(400);
    expect(await badActivation.json()).toEqual({ error: 'invalid_activation' });
    const badGet = await get('?feature=edit');
    expect(badGet.status).toBe(400);
    expect(await badGet.json()).toEqual({ error: 'invalid_request' });
    expect(createRecoveryRequest).not.toHaveBeenCalled();
    expect(activateRecovery).not.toHaveBeenCalled();
    expect(recoverySnapshot).not.toHaveBeenCalled();
  });
});
