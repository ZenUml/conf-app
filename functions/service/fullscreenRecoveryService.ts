import {
  FULLSCREEN_RECOVERY_POLICY_VERSION,
  FULLSCREEN_RECOVERY_SCENARIOS,
  type RecoveryActivateInput,
  type RecoveryMailState,
  type RecoveryRequestInput,
  type RecoveryResult,
  type RecoverySnapshot,
  type RecoverySupportOutcome,
} from '../../shared/fullscreenRecovery';
import { mixpanelImportServiceEvents } from './mixpanelService';
import type { AnalyticsEventName } from './analyticsTypes';
import { RECOVERY_SPACE_KEY, recoveryEligibility } from './fullscreenRecoveryEligibility';

export const LITE_FORGE_APP_ID = '8ad26115-211f-4216-971b-0540f606303d';
const DAY_MS = 86_400_000;
const SCENARIOS = new Set<string>(FULLSCREEN_RECOVERY_SCENARIOS);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface RecoveryEnv {
  DB?: D1Database;
  KV_FEATURE_FLAGS?: KVNamespace;
  SPACE_LICENSE_KV?: KVNamespace;
  confluence_plugin_features?: KVNamespace;
  MACRO_COUNT_SNAPSHOT_BUCKET?: R2Bucket;
  FULLSCREEN_RECOVERY_ENCRYPTION_KEY?: string;
  FULLSCREEN_RECOVERY_SUPPORT_TOKENS?: string;
  RESEND_REPLY_TO?: string;
  MIXPANEL_TOKEN?: string;
}
export interface RecoveryIdentity { cloudId: string; accountId: string; forgeAppId: string }
export interface FullscreenRecoveryRequestRow {
  id: string; cloudId: string; accountId: string; feature: 'fullscreen';
  scenariosJson: string; noteCiphertext: string; emailCiphertext: string;
  consentVersion: string; consentAt: string; contentId: string | null;
  customContentId: string | null; spaceKey: string | null; createdAt: string;
  grantId: string; activatedAt: string | null; expiresAt: string | null;
  supportOutcome: RecoverySupportOutcome | null; supportOutcomeAt: string | null;
}
export interface RecoveryPolicy {
  enabled: true;
  exemptionOverrideReviewed?: boolean;
}
export class RecoveryError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}

function base64Bytes(value: string): Uint8Array {
  if (!B64.test(value) || value.length % 4 !== 0) throw new RecoveryError('invalid_encryption_key', 503);
  try { return Uint8Array.from(atob(value), c => c.charCodeAt(0)); }
  catch { throw new RecoveryError('invalid_encryption_key', 503); }
}
function bytesBase64(bytes: Uint8Array): string {
  let result = '';
  for (const byte of bytes) result += String.fromCharCode(byte);
  return btoa(result);
}
async function encryptionKey(base64Key: string): Promise<CryptoKey> {
  const bytes = base64Bytes(base64Key);
  if (bytes.length !== 32) throw new RecoveryError('invalid_encryption_key', 503);
  return crypto.subtle.importKey('raw', Uint8Array.from(bytes).buffer, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encryptRecoveryField(plaintext: string, base64Key: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, await encryptionKey(base64Key), new TextEncoder().encode(plaintext),
  ));
  const combined = new Uint8Array(iv.length + ciphertext.length);
  combined.set(iv); combined.set(ciphertext, iv.length);
  return bytesBase64(combined);
}
export async function decryptRecoveryField(ciphertext: string, base64Key: string): Promise<string> {
  const bytes = base64Bytes(ciphertext);
  // AES-GCM authenticates even an empty optional note: 12-byte IV + 16-byte tag.
  if (bytes.length < 28) throw new RecoveryError('invalid_ciphertext', 500);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.slice(0, 12) }, await encryptionKey(base64Key), bytes.slice(12),
  );
  return new TextDecoder().decode(plaintext);
}

export function isRecoveryIdentity(value: unknown): value is RecoveryIdentity {
  if (!value || typeof value !== 'object') return false;
  const fit = value as Partial<RecoveryIdentity>;
  return fit.forgeAppId === LITE_FORGE_APP_ID
    && typeof fit.cloudId === 'string' && fit.cloudId.length > 0
    && typeof fit.accountId === 'string' && fit.accountId.length > 0;
}

/** Only a server-managed KV policy can enforce this gate. Malformed policy fails open. */
export async function readRecoveryPolicy(env: RecoveryEnv, cloudId: string): Promise<RecoveryPolicy | null | 'unavailable'> {
  if (!env.KV_FEATURE_FLAGS) return 'unavailable';
  let raw: string | null;
  try { raw = await env.KV_FEATURE_FLAGS.get(`fullscreen-recovery:policy:${cloudId}`); }
  catch { return 'unavailable'; }
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Partial<RecoveryPolicy>;
    if (value.enabled !== true) return null;
    if (value.exemptionOverrideReviewed !== undefined && typeof value.exemptionOverrideReviewed !== 'boolean') return 'unavailable';
    return value as RecoveryPolicy;
  } catch { return 'unavailable'; }
}

export async function getRecoveryCase(db: D1Database, id: string): Promise<FullscreenRecoveryRequestRow | null> {
  return db.prepare('SELECT * FROM FullscreenRecoveryRequest WHERE id = ?1').bind(id).first<FullscreenRecoveryRequestRow>();
}
async function getOwnRequest(db: D1Database, identity: RecoveryIdentity): Promise<FullscreenRecoveryRequestRow | null> {
  return db.prepare(`SELECT * FROM FullscreenRecoveryRequest
    WHERE cloudId = ?1 AND accountId = ?2 AND feature = 'fullscreen'`)
    .bind(identity.cloudId, identity.accountId).first<FullscreenRecoveryRequestRow>();
}

export async function recoverySnapshot(
  env: RecoveryEnv, identity: RecoveryIdentity | null, now = new Date(), spaceKey?: string,
): Promise<RecoverySnapshot> {
  const serverNow = now.toISOString();
  const base: RecoverySnapshot = {
    state: 'disabled', serverNow, policyVersion: FULLSCREEN_RECOVERY_POLICY_VERSION,
    exemptionOverrideReviewed: false,
  };
  if (!identity) return base;
  const policy = await readRecoveryPolicy(env, identity.cloudId);
  if (policy === 'unavailable') return { ...base, state: 'unavailable' };
  if (!policy) return base;
  const supportEmail = typeof env.RESEND_REPLY_TO === 'string'
    && env.RESEND_REPLY_TO.length <= 254 && EMAIL.test(env.RESEND_REPLY_TO)
    ? env.RESEND_REPLY_TO : undefined;
  const withPolicy: RecoverySnapshot = {
    ...base, supportEmail,
    exemptionOverrideReviewed: policy.exemptionOverrideReviewed === true,
  };
  if (!env.DB || !env.FULLSCREEN_RECOVERY_ENCRYPTION_KEY) return { ...withPolicy, state: 'unavailable' };
  const eligibility = await recoveryEligibility(env, identity, spaceKey, policy, now);
  if (eligibility !== 'eligible') return { ...withPolicy, state: eligibility };
  try {
    const row = await getOwnRequest(env.DB, identity);
    if (!row) return { ...withPolicy, state: 'not_requested' };
    const [email, note] = await Promise.all([
      decryptRecoveryField(row.emailCiphertext, env.FULLSCREEN_RECOVERY_ENCRYPTION_KEY),
      decryptRecoveryField(row.noteCiphertext, env.FULLSCREEN_RECOVERY_ENCRYPTION_KEY),
    ]);
    let mailState: RecoveryMailState | undefined;
    try {
      const mail = await env.DB.prepare(`SELECT state FROM FullscreenRecoveryMailOutbox
        WHERE requestId = ?1 AND templateVersion = 'requester-first-reply-v1'`)
        .bind(row.id).first<{ state: RecoveryMailState | 'sending' }>();
      mailState = mail?.state === 'sending' ? 'queued' : mail?.state;
    } catch {
      // Mail status is informational; the grant decision remains readable.
    }
    const state = !row.activatedAt ? 'pending_activation'
      : row.expiresAt && now.getTime() < Date.parse(row.expiresAt) ? 'active' : 'expired';
    return {
      ...withPolicy, state,
      request: {
        id: row.id, scenarios: JSON.parse(row.scenariosJson), email, note,
        createdAt: row.createdAt, mailState, supportOutcome: row.supportOutcome || undefined,
      },
      grant: { id: row.grantId, activatedAt: row.activatedAt, expiresAt: row.expiresAt },
    };
  } catch { return { ...withPolicy, state: 'unavailable' }; }
}

function validOptionalId(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === 'string' && value.length > 0 && value.length <= 128);
}
export function parseRecoveryRequest(value: unknown): RecoveryRequestInput {
  if (!value || typeof value !== 'object') throw new RecoveryError('invalid_request');
  const v = value as Partial<RecoveryRequestInput>;
  if (v.action !== 'request' || typeof v.attemptId !== 'string' || !UUID.test(v.attemptId)
    || !Array.isArray(v.scenarios) || v.scenarios.length < 1 || v.scenarios.length > 4
    || v.scenarios.some(s => !SCENARIOS.has(s)) || new Set(v.scenarios).size !== v.scenarios.length
    || typeof v.note !== 'string' || v.note.length > 2000
    || typeof v.email !== 'string' || v.email.length > 254 || !EMAIL.test(v.email)
    || v.consent !== true || v.consentVersion !== FULLSCREEN_RECOVERY_POLICY_VERSION
    || !validOptionalId(v.contentId) || !validOptionalId(v.customContentId)
    || typeof v.spaceKey !== 'string' || !RECOVERY_SPACE_KEY.test(v.spaceKey)) throw new RecoveryError('invalid_request');
  return v as RecoveryRequestInput;
}
export function parseRecoveryActivation(value: unknown): RecoveryActivateInput {
  if (!value || typeof value !== 'object') throw new RecoveryError('invalid_activation');
  const v = value as Partial<RecoveryActivateInput>;
  if (v.action !== 'activate' || typeof v.attemptId !== 'string' || !UUID.test(v.attemptId)
    || typeof v.requestId !== 'string' || !UUID.test(v.requestId)
    || typeof v.spaceKey !== 'string' || !RECOVERY_SPACE_KEY.test(v.spaceKey)) throw new RecoveryError('invalid_activation');
  return v as RecoveryActivateInput;
}

/** Persistence happens before qualification; INSERT OR IGNORE preserves the original contact and grant. */
export async function createRecoveryRequest(
  env: RecoveryEnv, identity: RecoveryIdentity, input: RecoveryRequestInput, now = new Date(),
): Promise<RecoveryResult> {
  if (!env.DB || !env.FULLSCREEN_RECOVERY_ENCRYPTION_KEY) throw new RecoveryError('unavailable', 503);
  const policy = await readRecoveryPolicy(env, identity.cloudId);
  if (policy === 'unavailable') throw new RecoveryError('unavailable', 503);
  if (!policy) throw new RecoveryError('not_enforced', 409);
  const eligibility = await recoveryEligibility(env, identity, input.spaceKey, policy, now);
  if (eligibility !== 'eligible') throw new RecoveryError(eligibility === 'disabled' ? 'not_eligible' : 'unavailable', eligibility === 'disabled' ? 409 : 503);
  const id = crypto.randomUUID(), grantId = crypto.randomUUID(), createdAt = now.toISOString();
  const [emailCiphertext, noteCiphertext] = await Promise.all([
    encryptRecoveryField(input.email.trim(), env.FULLSCREEN_RECOVERY_ENCRYPTION_KEY),
    encryptRecoveryField(input.note.trim(), env.FULLSCREEN_RECOVERY_ENCRYPTION_KEY),
  ]);
  const inserted = await env.DB.prepare(`INSERT OR IGNORE INTO FullscreenRecoveryRequest
    (id,cloudId,accountId,feature,scenariosJson,noteCiphertext,emailCiphertext,consentVersion,consentAt,
     contentId,customContentId,spaceKey,createdAt,grantId)
    VALUES (?1,?2,?3,'fullscreen',?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)`)
    .bind(id, identity.cloudId, identity.accountId, JSON.stringify(input.scenarios), noteCiphertext,
      emailCiphertext, input.consentVersion, createdAt, input.contentId || null,
      input.customContentId || null, input.spaceKey || null, createdAt, grantId).run();
  const row = await getOwnRequest(env.DB, identity);
  if (!row) throw new RecoveryError('unavailable', 503);
  const snapshot = await recoverySnapshot(env, identity, now, input.spaceKey);
  if (snapshot.state === 'unavailable') throw new RecoveryError('unavailable', 503);
  return { snapshot, outcome: inserted.meta.changes === 1 ? 'created' : 'reused' };
}

/** A verified UI receipt starts 168 hours exactly once; request ownership is in the SQL predicate. */
export async function activateRecovery(
  env: RecoveryEnv, identity: RecoveryIdentity, input: RecoveryActivateInput, now = new Date(),
): Promise<RecoveryResult> {
  if (!env.DB) throw new RecoveryError('unavailable', 503);
  const policy = await readRecoveryPolicy(env, identity.cloudId);
  if (policy === 'unavailable') throw new RecoveryError('unavailable', 503);
  if (!policy) throw new RecoveryError('not_enforced', 409);
  const eligibility = await recoveryEligibility(env, identity, input.spaceKey, policy, now);
  if (eligibility !== 'eligible') throw new RecoveryError(eligibility === 'disabled' ? 'not_eligible' : 'unavailable', eligibility === 'disabled' ? 409 : 503);
  const current = await getOwnRequest(env.DB, identity);
  if (!current || current.id !== input.requestId) throw new RecoveryError('not_found', 404);
  const activatedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 7 * DAY_MS).toISOString();
  const result = await env.DB.prepare(`UPDATE FullscreenRecoveryRequest
    SET activatedAt = ?1, expiresAt = ?2
    WHERE id = ?3 AND cloudId = ?4 AND accountId = ?5 AND activatedAt IS NULL`)
    .bind(activatedAt, expiresAt, input.requestId, identity.cloudId, identity.accountId).run();
  const snapshot = await recoverySnapshot(env, identity, now, input.spaceKey);
  if (snapshot.state === 'unavailable') throw new RecoveryError('unavailable', 503);
  return { snapshot, outcome: result.meta.changes === 1 ? 'activated' : 'already_active' };
}

/** Trusted internal bearer map; actor comes solely from the matching configured token. */
export function authenticateRecoverySupport(
  request: Request, env: Pick<RecoveryEnv, 'FULLSCREEN_RECOVERY_SUPPORT_TOKENS'>,
): { id: string } | null {
  if (!env.FULLSCREEN_RECOVERY_SUPPORT_TOKENS) return null;
  let tokens: Record<string, unknown>;
  try { tokens = JSON.parse(env.FULLSCREEN_RECOVERY_SUPPORT_TOKENS); }
  catch { return null; }
  if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) return null;
  const match = /^Bearer (.+)$/.exec(request.headers.get('Authorization') || '');
  if (!match) return null;
  const candidate = new TextEncoder().encode(match[1]);
  for (const [id, secret] of Object.entries(tokens)) {
    if (!/^[A-Za-z0-9_.-]{1,80}$/.test(id) || typeof secret !== 'string' || secret.length < 24) continue;
    const configured = new TextEncoder().encode(secret);
    let difference = candidate.length ^ configured.length;
    for (let i = 0; i < Math.max(candidate.length, configured.length); i++)
      difference |= (candidate[i] || 0) ^ (configured[i] || 0);
    if (difference === 0) return { id };
  }
  return null;
}

export function emitFullscreenRecoveryEvent(
  env: RecoveryEnv, event: AnalyticsEventName, insertId: string, distinctId: string,
  properties: Record<string, string | number | boolean | null | readonly string[]>,
  waitUntil?: (promise: Promise<unknown>) => void,
): void {
  if (!env.MIXPANEL_TOKEN) return;
  const delivery = mixpanelImportServiceEvents([{
    event, insertId, distinctId, time: Math.floor(Date.now() / 1000),
    properties: { feature_area: 'upgrade', surface: 'fullscreen_viewer', feature: 'fullscreen',
      policy_version: FULLSCREEN_RECOVERY_POLICY_VERSION, ...properties },
  }], env.MIXPANEL_TOKEN, { runtime: env }).catch(() => {
    console.warn('[fullscreen-recovery] analytics delivery failed');
  });
  if (waitUntil) waitUntil(delivery); else void delivery;
}
