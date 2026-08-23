import { describe, expect, it } from 'vitest';
import {
  createPaywallExtensionReminder,
  PAYWALL_EXTENSION_REMINDER_LEAD_MS,
  preparePaywallExtensionReminder,
  type PaywallExtensionReminderRow,
} from './paywallExtensionLifecycle';

class ReminderDb {
  row: PaywallExtensionReminderRow | null = null;

  prepare(sql: string) {
    return {
      bind: (...args: unknown[]) => ({
        run: async () => {
          if (sql.includes('INSERT OR IGNORE INTO PaywallExtensionReminder')) {
            if (this.row) return { success: true, meta: { changes: 0 } };
            this.row = {
              reminderId: String(args[0]),
              grantId: String(args[1]),
              cloudId: String(args[2]),
              accountId: String(args[3]),
              spaceId: String(args[4]),
              spaceKey: String(args[5]),
              dueAt: String(args[6]),
              expiresAt: String(args[7]),
              state: 'scheduled',
              entitlementCheckOutcome: null,
              entitlementCheckedAt: null,
              lastErrorCode: null,
              dispatchedAt: null,
              createdAt: String(args[8]),
              updatedAt: String(args[8]),
            };
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.includes('UPDATE PaywallExtensionReminder') && this.row) {
            this.row.state = String(args[0]) as PaywallExtensionReminderRow['state'];
            this.row.entitlementCheckOutcome = args[1] == null
              ? null
              : String(args[1]) as PaywallExtensionReminderRow['entitlementCheckOutcome'];
            this.row.entitlementCheckedAt = String(args[2]);
            this.row.lastErrorCode = args[3] == null ? null : String(args[3]);
            this.row.updatedAt = String(args[2]);
            return { success: true, meta: { changes: 1 } };
          }
          throw new Error(`Unexpected run SQL: ${sql}`);
        },
        first: async () => this.row,
      }),
    };
  }
}

const grant = {
  grantId: 'grant-1',
  cloudId: 'cloud-1',
  accountId: 'user-1',
  spaceId: 'space-1',
  spaceKey: 'ENG',
  grantedAt: '2026-08-23T01:00:00.000Z',
  expiresAt: '2026-08-30T01:00:00.000Z',
};

describe('paywall extension reminder lifecycle', () => {
  it('schedules exactly one reminder at T-24h and replays it without moving the due time', async () => {
    const db = new ReminderDb();
    const first = await createPaywallExtensionReminder(db as unknown as D1Database, grant, {
      now: new Date('2026-08-23T01:00:01.000Z'),
      randomUUID: () => 'reminder-1',
    });
    const replay = await createPaywallExtensionReminder(db as unknown as D1Database, grant, {
      now: new Date('2026-08-24T01:00:00.000Z'),
      randomUUID: () => 'reminder-2',
    });

    expect(first).toEqual(replay);
    expect(first.reminderId).toBe('reminder-1');
    expect(Date.parse(first.expiresAt) - Date.parse(first.dueAt))
      .toBe(PAYWALL_EXTENSION_REMINDER_LEAD_MS);
    expect(first.dueAt).toBe('2026-08-29T01:00:00.000Z');
  });

  it('suppresses a due reminder only after a confirmed paid Space entitlement', async () => {
    const db = new ReminderDb();
    const reminder = await createPaywallExtensionReminder(db as unknown as D1Database, grant, {
      randomUUID: () => 'reminder-1',
    });

    const result = await preparePaywallExtensionReminder(db as unknown as D1Database, reminder, {
      now: new Date('2026-08-29T01:00:00.000Z'),
      checkPaidSpaceEntitlement: async () => 'confirmed',
    });

    expect(result).toMatchObject({
      state: 'suppressed_paid',
      entitlementCheckOutcome: 'confirmed',
      lastErrorCode: null,
    });
  });

  it('makes one due reminder ready when the paid Space entitlement is confirmed absent', async () => {
    const db = new ReminderDb();
    const reminder = await createPaywallExtensionReminder(db as unknown as D1Database, grant, {
      randomUUID: () => 'reminder-1',
    });

    const result = await preparePaywallExtensionReminder(db as unknown as D1Database, reminder, {
      now: new Date('2026-08-29T01:00:00.000Z'),
      checkPaidSpaceEntitlement: async () => 'absent',
    });

    expect(result).toMatchObject({
      state: 'ready',
      entitlementCheckOutcome: 'absent',
      lastErrorCode: null,
    });
  });

  it('defers rather than claiming paid activation when entitlement lookup fails', async () => {
    const db = new ReminderDb();
    const reminder = await createPaywallExtensionReminder(db as unknown as D1Database, grant, {
      randomUUID: () => 'reminder-1',
    });

    const result = await preparePaywallExtensionReminder(db as unknown as D1Database, reminder, {
      now: new Date('2026-08-29T01:00:00.000Z'),
      checkPaidSpaceEntitlement: async () => { throw new Error('fixture KV outage'); },
    });

    expect(result).toMatchObject({
      state: 'scheduled',
      entitlementCheckOutcome: 'unknown',
      lastErrorCode: 'paid_entitlement_check_failed',
    });
    expect(result.state).not.toBe('suppressed_paid');
  });

  it('does not check entitlement before T-24h and suppresses an already-expired reminder', async () => {
    const beforeDueDb = new ReminderDb();
    const beforeDue = await createPaywallExtensionReminder(
      beforeDueDb as unknown as D1Database,
      grant,
      { randomUUID: () => 'reminder-1' },
    );
    let checks = 0;
    const unchanged = await preparePaywallExtensionReminder(
      beforeDueDb as unknown as D1Database,
      beforeDue,
      {
        now: new Date('2026-08-29T00:59:59.999Z'),
        checkPaidSpaceEntitlement: async () => { checks += 1; return 'absent'; },
      },
    );
    expect(unchanged.state).toBe('scheduled');
    expect(checks).toBe(0);

    const expiredDb = new ReminderDb();
    const expired = await createPaywallExtensionReminder(expiredDb as unknown as D1Database, grant, {
      randomUUID: () => 'reminder-2',
    });
    const suppressed = await preparePaywallExtensionReminder(
      expiredDb as unknown as D1Database,
      expired,
      {
        now: new Date('2026-08-30T01:00:00.000Z'),
        checkPaidSpaceEntitlement: async () => { checks += 1; return 'absent'; },
      },
    );
    expect(suppressed.state).toBe('suppressed_expired');
    expect(checks).toBe(0);
  });

  it('refuses to schedule a reminder for a client-controlled non-seven-day expiry', async () => {
    const db = new ReminderDb();
    await expect(createPaywallExtensionReminder(db as unknown as D1Database, {
      ...grant,
      expiresAt: '2026-09-01T01:00:00.000Z',
    })).rejects.toThrow('exact seven-day grant');
    expect(db.row).toBeNull();
  });
});
