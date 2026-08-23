import { PAYWALL_EXTENSION_MS } from './paywallExtensionService';

// Integration boundary: the grant endpoint persists one schedule, but a
// scheduled delivery job still needs an authoritative SPACE_LICENSE_KV read,
// an approved requester/admin recipient path, and a reminder-specific outbox.
// That job should call preparePaywallExtensionReminder immediately before
// enqueueing, then emit the already-registered paywall_extension_expiring
// event. This service does not bypass typed analytics or infer an email address.

export const PAYWALL_EXTENSION_REMINDER_LEAD_MS = 24 * 60 * 60 * 1000;

export type PaywallExtensionReminderState =
  | 'scheduled'
  | 'ready'
  | 'suppressed_paid'
  | 'suppressed_expired'
  | 'dispatched';

export type PaidSpaceEntitlementCheckOutcome = 'confirmed' | 'absent' | 'unknown';

export interface PaywallExtensionReminderRow {
  reminderId: string;
  grantId: string;
  cloudId: string;
  accountId: string;
  spaceId: string;
  spaceKey: string;
  dueAt: string;
  expiresAt: string;
  state: PaywallExtensionReminderState;
  entitlementCheckOutcome: PaidSpaceEntitlementCheckOutcome | null;
  entitlementCheckedAt: string | null;
  lastErrorCode: string | null;
  dispatchedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReminderGrant {
  grantId: string;
  cloudId: string;
  accountId: string;
  spaceId: string;
  spaceKey: string;
  grantedAt: string;
  expiresAt: string;
}

interface ReminderDependencies {
  now?: Date;
  randomUUID?: () => string;
}

interface PrepareReminderDependencies {
  now?: Date;
  checkPaidSpaceEntitlement: (identity: {
    cloudId: string;
    spaceKey: string;
  }) => Promise<PaidSpaceEntitlementCheckOutcome>;
}

async function reminderForGrant(
  db: D1Database,
  grantId: string,
): Promise<PaywallExtensionReminderRow> {
  const row = await db.prepare(
    'SELECT * FROM PaywallExtensionReminder WHERE grantId = ?1 LIMIT 1',
  ).bind(grantId).first<PaywallExtensionReminderRow>();
  if (!row) throw new Error('Paywall extension reminder was not persisted');
  return row;
}

async function reminderById(
  db: D1Database,
  reminderId: string,
): Promise<PaywallExtensionReminderRow> {
  const row = await db.prepare(
    'SELECT * FROM PaywallExtensionReminder WHERE reminderId = ?1 LIMIT 1',
  ).bind(reminderId).first<PaywallExtensionReminderRow>();
  if (!row) throw new Error('Paywall extension reminder was not persisted');
  return row;
}

/**
 * Persist the only reminder allowed for an exact seven-day grant. The unique
 * grant constraint is the idempotency authority; replay cannot move dueAt.
 */
export async function createPaywallExtensionReminder(
  db: D1Database,
  grant: ReminderGrant,
  dependencies: ReminderDependencies = {},
): Promise<PaywallExtensionReminderRow> {
  const grantedAt = Date.parse(grant.grantedAt);
  const expiresAt = Date.parse(grant.expiresAt);
  if (!Number.isFinite(grantedAt) || !Number.isFinite(expiresAt)
    || expiresAt - grantedAt !== PAYWALL_EXTENSION_MS) {
    throw new Error('Paywall extension reminder requires an exact seven-day grant');
  }

  const now = (dependencies.now ?? new Date()).toISOString();
  const reminderId = (dependencies.randomUUID ?? (() => crypto.randomUUID()))();
  const dueAt = new Date(expiresAt - PAYWALL_EXTENSION_REMINDER_LEAD_MS).toISOString();
  await db.prepare(
    `INSERT OR IGNORE INTO PaywallExtensionReminder (
       reminderId, grantId, cloudId, accountId, spaceId, spaceKey,
       dueAt, expiresAt, state, createdAt, updatedAt
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'scheduled', ?9, ?9)`,
  ).bind(
    reminderId, grant.grantId, grant.cloudId, grant.accountId,
    grant.spaceId, grant.spaceKey, dueAt, grant.expiresAt, now,
  ).run();
  return reminderForGrant(db, grant.grantId);
}

/**
 * Resolve the last safety gate before a reminder is handed to a delivery
 * adapter. Only a positive paid Space read suppresses as paid; `absent` and
 * `unknown` remain distinct outcomes.
 */
export async function preparePaywallExtensionReminder(
  db: D1Database,
  reminder: PaywallExtensionReminderRow,
  dependencies: PrepareReminderDependencies,
): Promise<PaywallExtensionReminderRow> {
  if (reminder.state !== 'scheduled') return reminder;
  const now = dependencies.now ?? new Date();
  const nowIso = now.toISOString();
  if (now.getTime() < Date.parse(reminder.dueAt)) return reminder;

  if (now.getTime() >= Date.parse(reminder.expiresAt)) {
    await db.prepare(
      `UPDATE PaywallExtensionReminder
          SET state = ?1, entitlementCheckOutcome = ?2,
              entitlementCheckedAt = ?3, lastErrorCode = ?4, updatedAt = ?3
        WHERE reminderId = ?5 AND state = 'scheduled'`,
    ).bind('suppressed_expired', null, nowIso, null, reminder.reminderId).run();
    return reminderById(db, reminder.reminderId);
  }

  let outcome: PaidSpaceEntitlementCheckOutcome;
  try {
    outcome = await dependencies.checkPaidSpaceEntitlement({
      cloudId: reminder.cloudId,
      spaceKey: reminder.spaceKey,
    });
  } catch {
    outcome = 'unknown';
  }

  const state: PaywallExtensionReminderState = outcome === 'confirmed'
    ? 'suppressed_paid'
    : outcome === 'absent'
      ? 'ready'
      : 'scheduled';
  const lastErrorCode = outcome === 'unknown' ? 'paid_entitlement_check_failed' : null;
  await db.prepare(
    `UPDATE PaywallExtensionReminder
        SET state = ?1, entitlementCheckOutcome = ?2,
            entitlementCheckedAt = ?3, lastErrorCode = ?4, updatedAt = ?3
      WHERE reminderId = ?5 AND state = 'scheduled'`,
  ).bind(state, outcome, nowIso, lastErrorCode, reminder.reminderId).run();
  return reminderById(db, reminder.reminderId);
}
