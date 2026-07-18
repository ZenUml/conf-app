// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPair, SignJWT } from 'jose';
import authenticate, {
  normalizeAllowedForgeAppAris,
  validateContextToken,
} from './authenticate';

const APP_ID = '8ad26115-211f-4216-971b-0540f606303d';
const APP_ARI = `ari:cloud:ecosystem::app/${APP_ID}`;
const INSTALLATION_ID = 'ari:cloud:ecosystem::installation/install-1';
const CLOUD_ID = 'cloud-1';

async function signedFit(overrides: {
  appId?: string;
  audience?: string;
  issuer?: string;
  expiresIn?: string | number;
  notBefore?: string | number;
  omitExpiration?: boolean;
  legacyInstallationId?: string;
  nestedInstallationId?: string;
} = {}) {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const appId = overrides.appId ?? APP_ARI;
  const legacyInstallationId = overrides.legacyInstallationId ?? INSTALLATION_ID;
  const nestedInstallationId = overrides.nestedInstallationId ?? INSTALLATION_ID;
  let signer = new SignJWT({
    app: {
      id: appId,
      installationId: legacyInstallationId,
      apiBaseUrl: `https://api.atlassian.com/ex/confluence/${CLOUD_ID}`,
      installation: {
        id: nestedInstallationId,
        contexts: [{
          name: 'confluence',
          cloudId: CLOUD_ID,
          apiBaseUrl: `https://api.atlassian.com/ex/confluence/${CLOUD_ID}`,
        }],
      },
      environment: {
        id: 'ari:cloud:ecosystem::environment/env-1',
        type: 'STAGING',
      },
    },
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .setIssuer(overrides.issuer ?? 'forge/invocation-token')
    .setAudience(overrides.audience ?? APP_ARI)
    .setIssuedAt()
    .setNotBefore(overrides.notBefore ?? '0s');
  if (!overrides.omitExpiration) {
    signer = signer.setExpirationTime(overrides.expiresIn ?? '2m');
  }
  const token = await signer.sign(privateKey);
  return { token, publicKey };
}

describe('validateContextToken', () => {
  it('normalizes short app IDs to full audience ARIs', () => {
    expect(normalizeAllowedForgeAppAris(`${APP_ID}, ${APP_ARI}`)).toEqual([APP_ARI]);
  });

  it('accepts a signed FIT and returns authenticated installation identity', async () => {
    const { token, publicKey } = await signedFit();

    const result = await validateContextToken(token, APP_ID, async () => publicKey);

    expect(result).toMatchObject({
      apiBaseUrl: `https://api.atlassian.com/ex/confluence/${CLOUD_ID}`,
      cloudId: CLOUD_ID,
      environmentType: 'STAGING',
      forgeAppId: APP_ID,
      forgeAppAri: APP_ARI,
      installationId: INSTALLATION_ID,
    });
  });

  it.each([
    ['wrong issuer', { issuer: 'attacker' }],
    ['wrong audience', { audience: 'ari:cloud:ecosystem::app/other' }],
    ['expired', { expiresIn: '-1s' }],
    ['future not-before', { notBefore: '2m' }],
    ['missing expiration', { omitExpiration: true }],
  ])('rejects %s', async (_name, overrides) => {
    const { token, publicKey } = await signedFit(overrides);
    await expect(validateContextToken(token, APP_ID, async () => publicKey)).rejects.toBeDefined();
  });

  it('rejects inconsistent installation IDs', async () => {
    const { token, publicKey } = await signedFit({
      legacyInstallationId: 'ari:cloud:ecosystem::installation/other',
    });
    await expect(validateContextToken(token, APP_ID, async () => publicKey))
      .rejects.toThrow('installation IDs do not match');
  });

  it('rejects when verified app.id and audience disagree', async () => {
    const otherAri = 'ari:cloud:ecosystem::app/other';
    const { token, publicKey } = await signedFit({
      appId: otherAri,
      audience: APP_ARI,
    });
    await expect(validateContextToken(token, `${APP_ID},other`, async () => publicKey))
      .rejects.toThrow('app.id does not match aud');
  });

  it('does not log decoded FIT payloads on failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(validateContextToken('not-a-jwt', APP_ID, async () => {
      throw new Error('should not resolve');
    })).rejects.toBeDefined();

    expect(JSON.stringify(warn.mock.calls)).not.toContain('not-a-jwt');
    expect(JSON.stringify(warn.mock.calls)).not.toContain(CLOUD_ID);
  });
});

describe('authenticate', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 500 when ALLOWED_FORGE_APP_IDS is not configured', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const request = new Request('https://example.com/diagramly/chat', {
      headers: {
        Authorization: 'Bearer test-token',
      },
    });

    const result = await authenticate({
      request,
      env: {},
      data: {},
    });

    expect(result.status).toBe(500);
    await expect(result.json()).resolves.toEqual({
      error: 'Server configuration error: ALLOWED_FORGE_APP_IDS not configured',
    });
    expect(consoleError).toHaveBeenCalledWith(
      'ALLOWED_FORGE_APP_IDS environment variable is not set',
    );
  });
});
