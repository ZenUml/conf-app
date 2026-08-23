export const MARKETPLACE_CONTACT_SCHEMA_VERSION = 'licenses-export-v2';
export const MARKETPLACE_CONTACT_CACHE_MAX_AGE_MS = 36 * 60 * 60 * 1000;
export const MARKETPLACE_CONTACT_RETENTION_DAYS = 90;

export type MarketplaceContactClassification =
  | 'direct_customer'
  | 'partner'
  | 'uncertain'
  | 'missing';

export type MarketplaceContactRoutingOutcome = 'automatic' | 'manual' | 'suppressed';

export interface NormalizedMarketplaceContact {
  cloudId: string;
  contact: { email: string; name: string | null } | null;
  classification: MarketplaceContactClassification;
  routingOutcome: MarketplaceContactRoutingOutcome;
  reasonCodes: string[];
  sourceLastSeenAt: string;
  sourceRecordCount: number;
}

export interface MarketplaceAdminRoute {
  routingOutcome: MarketplaceContactRoutingOutcome;
  reasonCodes: string[];
  overrideUsed: boolean;
  cacheAgeHours: number | null;
}

/** Server-only notification target. Never serialize this object to a response or analytics. */
export interface MarketplaceAdminNotificationTarget {
  route: MarketplaceAdminRoute;
  recipient: string | null;
}

interface ClassificationOptions {
  fetchedAt: Date;
  now?: Date;
  knownResellerDomains?: ReadonlySet<string>;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function technicalContact(row: Record<string, unknown>): { email: string; name: string | null } | null {
  const details = record(row.contactDetails);
  const technical = record(details?.technicalContact);
  const email = nonEmptyString(technical?.email)?.toLowerCase() ?? null;
  if (!email || !email.includes('@')) return null;
  return { email, name: nonEmptyString(technical?.name) };
}

function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf('@') + 1).toLowerCase();
}

function hasPartnerDetails(row: Record<string, unknown>): boolean {
  const details = record(row.partnerDetails);
  return !!details && Object.values(details).some((value) => nonEmptyString(value));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function base64UrlDecode(value: string): Uint8Array {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  if (secret.length < 32) throw new Error('Marketplace contact encryption key is invalid');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptMarketplaceContact(
  contact: { email: string; name: string | null },
  secret: string,
  randomBytes: (length: number) => Uint8Array = (length) => crypto.getRandomValues(new Uint8Array(length)),
): Promise<string> {
  const iv = new Uint8Array(randomBytes(12));
  if (iv.byteLength !== 12) throw new Error('Marketplace contact encryption IV is invalid');
  const plaintext = new Uint8Array(new TextEncoder().encode(JSON.stringify(contact)));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(secret), plaintext);
  return `v1.${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(ciphertext))}`;
}

export async function decryptMarketplaceContact(
  encoded: string,
  secret: string,
): Promise<{ email: string; name: string | null }> {
  const [version, ivPart, ciphertextPart, extra] = encoded.split('.');
  if (version !== 'v1' || !ivPart || !ciphertextPart || extra) throw new Error('Marketplace contact ciphertext is invalid');
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(base64UrlDecode(ivPart)) },
    await encryptionKey(secret),
    new Uint8Array(base64UrlDecode(ciphertextPart)),
  );
  const value = record(JSON.parse(new TextDecoder().decode(plaintext)));
  const email = nonEmptyString(value?.email);
  const nameValue = value?.name;
  if (!email || !email.includes('@') || (nameValue !== null && typeof nameValue !== 'string')) {
    throw new Error('Marketplace contact plaintext is invalid');
  }
  return { email: email.toLowerCase(), name: nameValue as string | null };
}

function parseReasonCodes(value: unknown): string[] {
  if (typeof value !== 'string') return ['contact_resolution_invalid'];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((reason) => typeof reason === 'string')
      ? parsed
      : ['contact_resolution_invalid'];
  } catch {
    return ['contact_resolution_invalid'];
  }
}

interface OverrideRow {
  decision: 'approved' | 'partner' | 'suppress';
  contactCiphertext: string | null;
  expiresAt: string | null;
}

interface ResolutionRow {
  classification: MarketplaceContactClassification;
  routingOutcome: 'automatic' | 'manual';
  reasonCodes: string;
  contactCiphertext: string | null;
  sourceRefreshedAt: string;
  cacheExpiresAt: string;
}

export async function resolveMarketplaceAdminNotificationTarget(
  db: D1Database,
  cloudId: string,
  encryptionSecret: string | undefined,
  now: Date = new Date(),
): Promise<MarketplaceAdminNotificationTarget> {
  const target = (
    route: MarketplaceAdminRoute,
    recipient: string | null = null,
  ): MarketplaceAdminNotificationTarget => ({ route, recipient });
  const override = await db.prepare(
    `SELECT decision, contactCiphertext, expiresAt
       FROM MarketplaceContactOverride
      WHERE cloudId = ?1
        AND effectiveAt <= ?2
        AND (expiresAt IS NULL OR expiresAt > ?2)
      ORDER BY createdAt DESC
      LIMIT 1`,
  ).bind(cloudId, now.toISOString()).first<OverrideRow>();

  let approvedCacheOverride = false;
  if (override) {
    if (override.decision === 'suppress') {
      return target({ routingOutcome: 'suppressed', reasonCodes: ['override_suppressed'], overrideUsed: true, cacheAgeHours: null });
    }
    if (override.decision === 'partner') {
      return target({ routingOutcome: 'manual', reasonCodes: ['override_partner'], overrideUsed: true, cacheAgeHours: null });
    }
    if (!encryptionSecret) {
      return target({ routingOutcome: 'manual', reasonCodes: ['override_contact_unavailable'], overrideUsed: true, cacheAgeHours: null });
    }
    if (override.contactCiphertext) {
      try {
        const contact = await decryptMarketplaceContact(override.contactCiphertext, encryptionSecret);
        return target(
          { routingOutcome: 'automatic', reasonCodes: ['override_approved'], overrideUsed: true, cacheAgeHours: null },
          contact.email,
        );
      } catch {
        return target({ routingOutcome: 'manual', reasonCodes: ['contact_decryption_failed'], overrideUsed: true, cacheAgeHours: null });
      }
    }
    approvedCacheOverride = true;
  }

  const resolution = await db.prepare(
    `SELECT classification, routingOutcome, reasonCodes, contactCiphertext,
            sourceRefreshedAt, cacheExpiresAt
       FROM MarketplaceContactResolution
      WHERE cloudId = ?1
      LIMIT 1`,
  ).bind(cloudId).first<ResolutionRow>();
  if (!resolution) {
    return target({
      routingOutcome: 'manual',
      reasonCodes: [approvedCacheOverride ? 'override_contact_unavailable' : 'contact_resolution_missing'],
      overrideUsed: approvedCacheOverride,
      cacheAgeHours: null,
    });
  }
  const refreshedAt = Date.parse(resolution.sourceRefreshedAt);
  const cacheAgeHours = Number.isFinite(refreshedAt)
    ? Math.max(0, Math.round(((now.getTime() - refreshedAt) / 3_600_000) * 10) / 10)
    : null;
  if (!Number.isFinite(Date.parse(resolution.cacheExpiresAt)) || resolution.cacheExpiresAt <= now.toISOString()) {
    return target({ routingOutcome: 'manual', reasonCodes: ['source_stale'], overrideUsed: approvedCacheOverride, cacheAgeHours });
  }
  if (approvedCacheOverride) {
    if (!resolution.contactCiphertext) {
      return target({ routingOutcome: 'manual', reasonCodes: ['override_contact_unavailable'], overrideUsed: true, cacheAgeHours });
    }
    try {
      const contact = await decryptMarketplaceContact(resolution.contactCiphertext, encryptionSecret as string);
      return target(
        { routingOutcome: 'automatic', reasonCodes: ['override_approved'], overrideUsed: true, cacheAgeHours },
        contact.email,
      );
    } catch {
      return target({ routingOutcome: 'manual', reasonCodes: ['contact_decryption_failed'], overrideUsed: true, cacheAgeHours });
    }
  }
  if (resolution.routingOutcome !== 'automatic') {
    return target({ routingOutcome: 'manual', reasonCodes: parseReasonCodes(resolution.reasonCodes), overrideUsed: false, cacheAgeHours });
  }
  if (!encryptionSecret || !resolution.contactCiphertext) {
    return target({ routingOutcome: 'manual', reasonCodes: ['contact_unavailable'], overrideUsed: false, cacheAgeHours });
  }
  try {
    const contact = await decryptMarketplaceContact(resolution.contactCiphertext, encryptionSecret);
    return target(
      {
        routingOutcome: 'automatic', reasonCodes: parseReasonCodes(resolution.reasonCodes),
        overrideUsed: false, cacheAgeHours,
      },
      contact.email,
    );
  } catch {
    return target({ routingOutcome: 'manual', reasonCodes: ['contact_decryption_failed'], overrideUsed: false, cacheAgeHours });
  }
}

/**
 * Frontend-safe routing metadata. The companion target resolver above is only
 * for server-side dispatch and its recipient must never cross the API boundary.
 */
export async function resolveMarketplaceAdminRoute(
  db: D1Database,
  cloudId: string,
  encryptionSecret: string | undefined,
  now: Date = new Date(),
): Promise<MarketplaceAdminRoute> {
  return (await resolveMarketplaceAdminNotificationTarget(db, cloudId, encryptionSecret, now)).route;
}

/**
 * Normalize the bulk license export into one deterministic resolution per
 * tenant. Billing contacts are deliberately never read: the registered
 * technical contact is the only automatic-notification candidate.
 */
export function classifyMarketplaceContacts(
  payload: unknown,
  options: ClassificationOptions,
): NormalizedMarketplaceContact[] {
  if (!Array.isArray(payload)) throw new Error('Marketplace license export must be an array');

  const byTenant = new Map<string, Array<{
    contact: { email: string; name: string | null } | null;
    partnerReason: string | null;
  }>>();
  for (const value of payload) {
    const row = record(value);
    if (!row || row.status !== 'active') continue;
    const cloudId = nonEmptyString(row.cloudId);
    if (!cloudId) continue;
    const contact = technicalContact(row);
    const partnerReason = hasPartnerDetails(row)
      ? 'marketplace_partner_present'
      : contact && options.knownResellerDomains?.has(emailDomain(contact.email))
        ? 'known_reseller_domain'
        : null;
    const candidates = byTenant.get(cloudId) ?? [];
    candidates.push({ contact, partnerReason });
    byTenant.set(cloudId, candidates);
  }

  const emailTenants = new Map<string, Set<string>>();
  for (const [cloudId, candidates] of byTenant) {
    for (const candidate of candidates) {
      if (!candidate.contact) continue;
      const tenants = emailTenants.get(candidate.contact.email) ?? new Set<string>();
      tenants.add(cloudId);
      emailTenants.set(candidate.contact.email, tenants);
    }
  }

  const sourceLastSeenAt = options.fetchedAt.toISOString();
  const sourceAge = (options.now ?? options.fetchedAt).getTime() - options.fetchedAt.getTime();
  const sourceIsStale = sourceAge < 0 || sourceAge > MARKETPLACE_CONTACT_CACHE_MAX_AGE_MS;
  return [...byTenant.entries()].map(([cloudId, candidates]) => {
    const contacts = new Map<string, { email: string; name: string | null }>();
    for (const candidate of candidates) {
      if (candidate.contact) contacts.set(candidate.contact.email, candidate.contact);
    }
    if (contacts.size === 0) {
      return {
        cloudId, contact: null, classification: 'missing' as const,
        routingOutcome: 'manual' as const,
        reasonCodes: ['technical_contact_missing'], sourceLastSeenAt,
        sourceRecordCount: candidates.length,
      };
    }
    if (contacts.size > 1) {
      return {
        cloudId, contact: null, classification: 'uncertain' as const,
        routingOutcome: 'manual' as const,
        reasonCodes: ['technical_contact_conflict'], sourceLastSeenAt,
        sourceRecordCount: candidates.length,
      };
    }
    const contact = [...contacts.values()][0];
    if (sourceIsStale) {
      return {
        cloudId, contact, classification: 'uncertain' as const,
        routingOutcome: 'manual' as const,
        reasonCodes: ['source_stale'], sourceLastSeenAt,
        sourceRecordCount: candidates.length,
      };
    }
    const partnerReason = candidates.find(({ partnerReason }) => partnerReason)?.partnerReason;
    if (partnerReason) {
      return {
        cloudId, contact, classification: 'partner' as const,
        routingOutcome: 'manual' as const, reasonCodes: [partnerReason], sourceLastSeenAt,
        sourceRecordCount: candidates.length,
      };
    }
    if ((emailTenants.get(contact.email)?.size ?? 0) > 1) {
      return {
        cloudId, contact, classification: 'uncertain' as const,
        routingOutcome: 'manual' as const,
        reasonCodes: ['technical_contact_reused'], sourceLastSeenAt,
        sourceRecordCount: candidates.length,
      };
    }
    return {
      cloudId, contact, classification: 'direct_customer' as const,
      routingOutcome: 'automatic' as const,
      reasonCodes: ['technical_contact_unique'], sourceLastSeenAt,
      sourceRecordCount: candidates.length,
    };
  });
}

function addDays(date: Date, days: number): string {
  return new Date(date.getTime() + days * 86_400_000).toISOString();
}

function maskContact(email: string): string {
  const [local, domain = ''] = email.split('@');
  const labels = domain.split('.');
  const firstLabel = labels.shift() ?? '';
  const suffix = labels.length ? `.${labels.join('.')}` : '';
  return `${local.slice(0, 1)}***@${firstLabel.slice(0, 1)}***${suffix}`;
}

interface PersistResolutionOptions {
  encryptionSecret: string | undefined;
  now?: Date;
  randomBytes?: (length: number) => Uint8Array;
}

/** Encrypt and atomically replace machine cache rows; override rows are never touched. */
export async function persistMarketplaceContactResolutions(
  db: D1Database,
  resolutions: NormalizedMarketplaceContact[],
  options: PersistResolutionOptions,
): Promise<void> {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const cacheExpiresAt = new Date(now.getTime() + MARKETPLACE_CONTACT_CACHE_MAX_AGE_MS).toISOString();
  const retentionUntil = addDays(now, MARKETPLACE_CONTACT_RETENTION_DAYS);
  const statements: D1PreparedStatement[] = [];

  for (const resolution of resolutions) {
    let contactCiphertext: string | null = null;
    let classification = resolution.classification;
    let routingOutcome: 'automatic' | 'manual' = resolution.routingOutcome === 'automatic' ? 'automatic' : 'manual';
    let reasonCodes = resolution.reasonCodes;
    if (resolution.contact) {
      try {
        if (!options.encryptionSecret) throw new Error('Marketplace contact encryption key is unavailable');
        contactCiphertext = await encryptMarketplaceContact(
          resolution.contact,
          options.encryptionSecret,
          options.randomBytes,
        );
      } catch {
        contactCiphertext = null;
        classification = 'uncertain';
        routingOutcome = 'manual';
        reasonCodes = ['contact_encryption_failed'];
      }
    }
    statements.push(db.prepare(
      `INSERT INTO MarketplaceContactResolution (
         cloudId, contactCiphertext, maskedOperatorDisplay, classification,
         routingOutcome, reasonCodes, sourceSchemaVersion, sourceRecordCount,
         sourceRefreshedAt, sourceLastSeenAt, cacheExpiresAt, retentionUntil,
         createdAt, updatedAt
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
       ON CONFLICT(cloudId) DO UPDATE SET
         contactCiphertext = excluded.contactCiphertext,
         maskedOperatorDisplay = excluded.maskedOperatorDisplay,
         classification = excluded.classification,
         routingOutcome = excluded.routingOutcome,
         reasonCodes = excluded.reasonCodes,
         sourceSchemaVersion = excluded.sourceSchemaVersion,
         sourceRecordCount = excluded.sourceRecordCount,
         sourceRefreshedAt = excluded.sourceRefreshedAt,
         sourceLastSeenAt = excluded.sourceLastSeenAt,
         cacheExpiresAt = excluded.cacheExpiresAt,
         retentionUntil = excluded.retentionUntil,
         updatedAt = excluded.updatedAt`,
    ).bind(
      resolution.cloudId,
      contactCiphertext,
      resolution.contact ? maskContact(resolution.contact.email) : null,
      classification,
      routingOutcome,
      JSON.stringify(reasonCodes),
      MARKETPLACE_CONTACT_SCHEMA_VERSION,
      resolution.sourceRecordCount,
      nowIso,
      resolution.sourceLastSeenAt,
      cacheExpiresAt,
      retentionUntil,
      nowIso,
      nowIso,
    ));
  }

  statements.push(db.prepare(
    'DELETE FROM MarketplaceContactResolution WHERE retentionUntil <= ?1',
  ).bind(nowIso));
  statements.push(db.prepare(
    `DELETE FROM MarketplaceContactOverride
      WHERE retentionUntil <= ?1 AND expiresAt IS NOT NULL AND expiresAt <= ?1`,
  ).bind(nowIso));
  await db.batch(statements);
}
