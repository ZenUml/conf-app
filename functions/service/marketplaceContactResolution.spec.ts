import { describe, expect, it } from 'vitest';
import {
  classifyMarketplaceContacts,
  decryptMarketplaceContact,
  encryptMarketplaceContact,
  persistMarketplaceContactResolutions,
  resolveMarketplaceAdminRoute,
} from './marketplaceContactResolution';

const fetchedAt = new Date('2026-08-23T02:00:00.000Z');

describe('classifyMarketplaceContacts', () => {
  it('routes one fresh technical contact for one tenant as a direct customer', () => {
    const resolutions = classifyMarketplaceContacts([
      {
        cloudId: 'cloud-direct',
        status: 'active',
        contactDetails: {
          technicalContact: { email: 'admin@example.com', name: 'Example Admin' },
          billingContact: { email: 'billing@example.com', name: 'Billing Contact' },
        },
      },
    ], { fetchedAt });

    expect(resolutions).toEqual([
      expect.objectContaining({
        cloudId: 'cloud-direct',
        classification: 'direct_customer',
        routingOutcome: 'automatic',
        reasonCodes: ['technical_contact_unique'],
        contact: { email: 'admin@example.com', name: 'Example Admin' },
      }),
    ]);
    expect(JSON.stringify(resolutions)).not.toContain('billing@example.com');
  });

  it('routes explicit partners and operational known-reseller domains to review', () => {
    const resolutions = classifyMarketplaceContacts([
      {
        cloudId: 'cloud-partner', status: 'active',
        partnerDetails: { partnerName: 'Example Partner' },
        contactDetails: { technicalContact: { email: 'admin@customer.example' } },
      },
      {
        cloudId: 'cloud-reseller', status: 'active',
        contactDetails: { technicalContact: { email: 'operator@reseller.invalid' } },
      },
    ], {
      fetchedAt,
      knownResellerDomains: new Set(['reseller.invalid']),
    });

    expect(resolutions).toEqual([
      expect.objectContaining({
        cloudId: 'cloud-partner', classification: 'partner', routingOutcome: 'manual',
        reasonCodes: ['marketplace_partner_present'],
      }),
      expect.objectContaining({
        cloudId: 'cloud-reseller', classification: 'partner', routingOutcome: 'manual',
        reasonCodes: ['known_reseller_domain'],
      }),
    ]);
  });

  it('routes conflicting tenant contacts and cross-tenant contact reuse to review', () => {
    const resolutions = classifyMarketplaceContacts([
      {
        cloudId: 'cloud-conflict', status: 'active',
        contactDetails: { technicalContact: { email: 'one@example.com' } },
      },
      {
        cloudId: 'cloud-conflict', status: 'active',
        contactDetails: { technicalContact: { email: 'two@example.com' } },
      },
      {
        cloudId: 'cloud-reused-a', status: 'active',
        contactDetails: { technicalContact: { email: 'shared@service.example' } },
      },
      {
        cloudId: 'cloud-reused-b', status: 'active',
        contactDetails: { technicalContact: { email: 'shared@service.example' } },
      },
    ], { fetchedAt });

    expect(resolutions).toHaveLength(3);
    expect(resolutions.find(({ cloudId }) => cloudId === 'cloud-conflict')).toMatchObject({
      classification: 'uncertain', routingOutcome: 'manual', reasonCodes: ['technical_contact_conflict'],
      contact: null,
    });
    for (const cloudId of ['cloud-reused-a', 'cloud-reused-b']) {
      expect(resolutions.find((resolution) => resolution.cloudId === cloudId)).toMatchObject({
        classification: 'uncertain', routingOutcome: 'manual', reasonCodes: ['technical_contact_reused'],
      });
    }
  });

  it('routes missing contacts and a stale export to review', () => {
    const missing = classifyMarketplaceContacts([
      { cloudId: 'cloud-missing', status: 'active', contactDetails: {} },
    ], { fetchedAt });
    expect(missing[0]).toMatchObject({
      classification: 'missing', routingOutcome: 'manual',
      reasonCodes: ['technical_contact_missing'], contact: null,
    });

    const stale = classifyMarketplaceContacts([
      {
        cloudId: 'cloud-stale', status: 'active',
        contactDetails: { technicalContact: { email: 'admin@example.com' } },
      },
    ], {
      fetchedAt: new Date('2026-08-20T00:00:00.000Z'),
      now: fetchedAt,
    });
    expect(stale[0]).toMatchObject({
      classification: 'uncertain', routingOutcome: 'manual', reasonCodes: ['source_stale'],
    });
  });
});

describe('Marketplace contact encryption and hot-path routing', () => {
  it('encrypts application data without embedding the contact in ciphertext', async () => {
    const contact = { email: 'admin@example.com', name: 'Example Admin' };
    const secret = 'test-only-secret-that-is-at-least-32-characters';
    const ciphertext = await encryptMarketplaceContact(contact, secret, () => new Uint8Array(12).fill(7));

    expect(ciphertext).toMatch(/^v1\./);
    expect(ciphertext).not.toContain(contact.email);
    expect(await decryptMarketplaceContact(ciphertext, secret)).toEqual(contact);
  });

  it('persists encrypted cache rows and degrades encryption failure to manual routing', async () => {
    const statements: Array<{ sql: string; args: unknown[] }> = [];
    const db = {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({ sql, args }),
      }),
      batch: async (batch: Array<{ sql: string; args: unknown[] }>) => {
        statements.push(...batch);
        return batch.map(() => ({ success: true }));
      },
    } as unknown as D1Database;
    const resolutions = classifyMarketplaceContacts([
      {
        cloudId: 'cloud-persist', status: 'active',
        contactDetails: { technicalContact: { email: 'admin@example.com', name: 'Example Admin' } },
      },
    ], { fetchedAt });

    await persistMarketplaceContactResolutions(db, resolutions, {
      encryptionSecret: 'test-only-secret-that-is-at-least-32-characters',
      now: fetchedAt,
      randomBytes: () => new Uint8Array(12).fill(3),
    });
    expect(JSON.stringify(statements)).not.toContain('admin@example.com');
    expect(statements[0].args).toContain('automatic');

    statements.length = 0;
    await persistMarketplaceContactResolutions(db, resolutions, {
      encryptionSecret: 'too-short', now: fetchedAt,
    });
    expect(JSON.stringify(statements)).not.toContain('admin@example.com');
    expect(statements[0].args).toContain('manual');
    expect(statements[0].args).toContain('["contact_encryption_failed"]');
  });

  it('uses an active approved override before cache and never returns the address', async () => {
    const secret = 'test-only-secret-that-is-at-least-32-characters';
    const ciphertext = await encryptMarketplaceContact(
      { email: 'override@example.com', name: null },
      secret,
      () => new Uint8Array(12).fill(9),
    );
    const db = {
      prepare: (sql: string) => ({
        bind: () => ({
          first: async () => sql.includes('MarketplaceContactOverride')
            ? { decision: 'approved', contactCiphertext: ciphertext, expiresAt: null }
            : { classification: 'missing', routingOutcome: 'manual', reasonCodes: '["technical_contact_missing"]' },
        }),
      }),
    } as unknown as D1Database;

    const result = await resolveMarketplaceAdminRoute(
      db, 'cloud-override', secret, new Date('2026-08-23T03:00:00.000Z'),
    );

    expect(result).toEqual({
      routingOutcome: 'automatic',
      reasonCodes: ['override_approved'],
      overrideUsed: true,
      cacheAgeHours: null,
    });
    expect(JSON.stringify(result)).not.toContain('override@example.com');
  });

  it('lets an approved override validate the encrypted machine contact without replacing it', async () => {
    const secret = 'test-only-secret-that-is-at-least-32-characters';
    const cachedCiphertext = await encryptMarketplaceContact(
      { email: 'cached@example.com', name: null }, secret,
      () => new Uint8Array(12).fill(5),
    );
    const db = {
      prepare: (sql: string) => ({
        bind: () => ({
          first: async () => sql.includes('MarketplaceContactOverride')
            ? { decision: 'approved', contactCiphertext: null, expiresAt: null }
            : {
                classification: 'uncertain', routingOutcome: 'manual',
                reasonCodes: '["technical_contact_reused"]', contactCiphertext: cachedCiphertext,
                sourceRefreshedAt: '2026-08-23T02:00:00.000Z',
                cacheExpiresAt: '2026-08-24T14:00:00.000Z',
              },
        }),
      }),
    } as unknown as D1Database;

    expect(await resolveMarketplaceAdminRoute(db, 'cloud-approved', secret, fetchedAt)).toEqual({
      routingOutcome: 'automatic', reasonCodes: ['override_approved'],
      overrideUsed: true, cacheAgeHours: 0,
    });
  });

  it('applies suppress/partner overrides and treats an expired cache as manual', async () => {
    const overrideDb = (decision: 'suppress' | 'partner') => ({
      prepare: (sql: string) => ({
        bind: () => ({ first: async () => sql.includes('MarketplaceContactOverride')
          ? { decision, contactCiphertext: null, expiresAt: null }
          : null }),
      }),
    }) as unknown as D1Database;
    await expect(resolveMarketplaceAdminRoute(overrideDb('suppress'), 'cloud', undefined, fetchedAt))
      .resolves.toMatchObject({ routingOutcome: 'suppressed', reasonCodes: ['override_suppressed'], overrideUsed: true });
    await expect(resolveMarketplaceAdminRoute(overrideDb('partner'), 'cloud', undefined, fetchedAt))
      .resolves.toMatchObject({ routingOutcome: 'manual', reasonCodes: ['override_partner'], overrideUsed: true });

    const staleDb = {
      prepare: (sql: string) => ({
        bind: () => ({ first: async () => sql.includes('MarketplaceContactOverride') ? null : {
          classification: 'direct_customer', routingOutcome: 'automatic',
          reasonCodes: '["technical_contact_unique"]', contactCiphertext: 'unused',
          sourceRefreshedAt: '2026-08-20T00:00:00.000Z',
          cacheExpiresAt: '2026-08-21T12:00:00.000Z',
        } }),
      }),
    } as unknown as D1Database;
    await expect(resolveMarketplaceAdminRoute(staleDb, 'cloud', undefined, fetchedAt)).resolves.toMatchObject({
      routingOutcome: 'manual', reasonCodes: ['source_stale'], overrideUsed: false,
    });
  });

  it('routes decryption failure to review without returning ciphertext or plaintext', async () => {
    const db = {
      prepare: (sql: string) => ({
        bind: () => ({
          first: async () => sql.includes('MarketplaceContactOverride') ? null : {
            classification: 'direct_customer',
            routingOutcome: 'automatic',
            reasonCodes: '["technical_contact_unique"]',
            contactCiphertext: 'v1.invalid.invalid',
            sourceRefreshedAt: '2026-08-23T02:00:00.000Z',
            cacheExpiresAt: '2026-08-24T14:00:00.000Z',
          },
        }),
      }),
    } as unknown as D1Database;
    const result = await resolveMarketplaceAdminRoute(
      db, 'cloud-broken', 'test-only-secret-that-is-at-least-32-characters',
      new Date('2026-08-23T03:00:00.000Z'),
    );
    expect(result).toEqual({
      routingOutcome: 'manual', reasonCodes: ['contact_decryption_failed'],
      overrideUsed: false, cacheAgeHours: 1,
    });
    expect(Object.keys(result)).not.toContain('contact');
  });

  it('uses a fresh encrypted direct-customer cache row without returning the contact', async () => {
    const secret = 'test-only-secret-that-is-at-least-32-characters';
    const ciphertext = await encryptMarketplaceContact(
      { email: 'admin@example.com', name: null }, secret,
      () => new Uint8Array(12).fill(4),
    );
    const db = {
      prepare: (sql: string) => ({
        bind: () => ({ first: async () => sql.includes('MarketplaceContactOverride') ? null : {
          classification: 'direct_customer', routingOutcome: 'automatic',
          reasonCodes: '["technical_contact_unique"]', contactCiphertext: ciphertext,
          sourceRefreshedAt: '2026-08-23T02:00:00.000Z',
          cacheExpiresAt: '2026-08-24T14:00:00.000Z',
        } }),
      }),
    } as unknown as D1Database;

    const result = await resolveMarketplaceAdminRoute(db, 'cloud-direct', secret, fetchedAt);
    expect(result).toEqual({
      routingOutcome: 'automatic', reasonCodes: ['technical_contact_unique'],
      overrideUsed: false, cacheAgeHours: 0,
    });
    expect(JSON.stringify(result)).not.toContain('admin@example.com');
  });
});
