import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadTargetedSurvey } from './survey';

const boundary = vi.hoisted(() => ({
  remote: vi.fn(), context: vi.fn(), page: vi.fn(), property: vi.fn(),
}));
vi.mock('@/utils/requestUtil', () => ({ callRemote: boundary.remote }));
vi.mock('@/model/globals/forgeGlobal', () => ({ getContext: boundary.context }));
vi.mock('@/utils/byline/unplacedMarker', () => ({ deriveUnplacedIdentity: boundary.page }));
vi.mock('@/utils/byline/unplacedProperty', () => ({ readUnplacedProperty: boundary.property }));

const survey = {
  uuid: '71861d63-dc0b-4a75-8a04-724711577d70', revision: 1,
  expiresAt: '2099-01-01T00:00:00.000Z', title: 'Help us improve ZenUML',
  question: 'What could we improve?', options: [{ id: 'editing', label: 'Editing diagrams' }],
};

describe('targeted survey page-banner eligibility', () => {
  beforeEach(() => {
    vi.stubEnv('PRODUCT_TYPE', 'full');
    localStorage.clear();
    boundary.remote.mockReset().mockResolvedValue({ survey });
    boundary.context.mockReset().mockResolvedValue({ cloudId: 'example-cloud', accountId: 'example-account' });
    boundary.page.mockReset().mockReturnValue({ pageId: 'example-page' });
    boundary.property.mockReset().mockResolvedValue({ status: 'absent' });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

  it('does not query the backend in Lite', async () => {
    vi.stubEnv('PRODUCT_TYPE', 'lite');
    expect(await loadTargetedSurvey()).toBeNull();
    expect(boundary.remote).not.toHaveBeenCalled();
  });

  it('fails closed without a browser identity or a verifiable page', async () => {
    boundary.context.mockResolvedValueOnce({ accountId: 'example-account' });
    expect(await loadTargetedSurvey()).toBeNull();
    expect(boundary.remote).not.toHaveBeenCalled();
    boundary.page.mockReturnValueOnce(null);
    expect(await loadTargetedSurvey()).toBeNull();
  });

  it('gives the independent unplaced-diagram banner priority on present or uncertain properties', async () => {
    for (const status of ['ok', 'error', 'forbidden']) {
      boundary.property.mockResolvedValueOnce({ status });
      expect(await loadTargetedSurvey()).toBeNull();
    }
    expect((await loadTargetedSurvey())?.survey).toEqual(survey);
  });

  it('bounds an unavailable backend and ignores late eligibility', async () => {
    vi.useFakeTimers();
    boundary.remote.mockReturnValue(new Promise(() => {}));
    const result = loadTargetedSurvey();
    await vi.advanceTimersByTimeAsync(2500);
    expect(await result).toBeNull();
  });
});
