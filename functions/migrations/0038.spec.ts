import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
const sql = (file: string) => readFileSync(resolve(process.cwd(), 'functions/migrations', file), 'utf8');
const MIGRATION = '0038_recovery_request_edit_feature.sql';

function seeded() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  expect((db.prepare('PRAGMA foreign_keys').get() as any).foreign_keys).toBe(1);
  for (const f of ['0033_fullscreen_recovery.sql', '0034_fullscreen_recovery_mail.sql']) db.exec(sql(f));
  const insert = db.prepare(`INSERT INTO FullscreenRecoveryRequest
    (id,cloudId,accountId,scenariosJson,noteCiphertext,emailCiphertext,consentVersion,consentAt,createdAt,grantId,activatedAt,expiresAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  insert.run('req-1', 'cloud-1', 'acct-1', '["present"]', 'n1', 'e1', 'fullscreen-contact-v1', 't', '2026-11-01T00:00:00Z', 'g1', '2026-11-02T00:00:00Z', '2026-11-09T00:00:00Z');
  insert.run('req-2', 'cloud-1', 'acct-2', '["other"]', 'n2', 'e2', 'fullscreen-contact-v1', 't', '2026-11-03T00:00:00Z', 'g2', null, null);
  db.exec(`INSERT INTO FullscreenRecoverySupportAction (commandId,requestId,action,actorId,reason,createdAt)
    VALUES ('cmd-1','req-1','extend','op','why','2026-11-04T00:00:00Z')`);
  db.exec(`INSERT INTO FullscreenRecoveryMailOutbox (id,requestId,templateVersion,recipientCiphertext,snapshotCiphertext,snapshotHmacSha256,state,createdBy,createdAt,updatedAt)
    VALUES ('mail-1','req-1','requester-first-reply-v1','r','s','h','accepted','op','t','t')`);
  db.exec(`INSERT INTO FullscreenRecoveryMailWebhookReceipt (eventId,outboxId,providerMessageId,eventType,occurredAt,receivedAt)
    VALUES ('ev-1','mail-1','pm-1','email.delivered','t','t')`);
  return db;
}
// D1 runs a migration in one implicit transaction; node:sqlite commits per statement, so wrap it.
const migrate = (db: any, text = sql(MIGRATION)) => { db.exec('BEGIN'); try { db.exec(text); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } };
const insertEdit = (db: any, id: string, acct = 'acct-1', grant = 'g-' + id) => db.prepare(`INSERT INTO FullscreenRecoveryRequest
  (id,cloudId,accountId,feature,scenariosJson,noteCiphertext,emailCiphertext,consentVersion,consentAt,createdAt,grantId)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, 'cloud-1', acct, 'edit', '["fix_or_update"]', 'n', 'e', 'edit-contact-v1', 't', 't', grant);

describe('0038_recovery_request_edit_feature', () => {
  it('keeps every row and id, and the children still resolve, with foreign keys on', () => {
    const db = seeded();
    const before = db.prepare('SELECT * FROM FullscreenRecoveryRequest ORDER BY id').all();
    migrate(db);
    expect(db.prepare('SELECT * FROM FullscreenRecoveryRequest ORDER BY id').all()).toEqual(before);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(db.prepare(`SELECT a.commandId FROM FullscreenRecoverySupportAction a JOIN FullscreenRecoveryRequest r ON r.id=a.requestId`).all()).toHaveLength(1);
    expect(db.prepare(`SELECT o.id FROM FullscreenRecoveryMailOutbox o JOIN FullscreenRecoveryRequest r ON r.id=o.requestId`).all()).toHaveLength(1);
    expect(db.prepare(`SELECT w.eventId FROM FullscreenRecoveryMailWebhookReceipt w JOIN FullscreenRecoveryMailOutbox o ON o.id=w.outboxId`).all()).toHaveLength(1);
    // children must still be enforced against the new table
    expect(() => db.exec(`INSERT INTO FullscreenRecoverySupportAction (commandId,requestId,action,actorId,reason,createdAt) VALUES ('c2','nope','extend','op','x','t')`)).toThrow(/FOREIGN KEY/);
    const refs = db.prepare(`PRAGMA foreign_key_list('FullscreenRecoverySupportAction')`).all() as any[];
    expect(refs[0].table).toBe('FullscreenRecoveryRequest');
  });

  it('accepts feature = edit and rejects another value', () => {
    const db = seeded(); migrate(db);
    insertEdit(db, 'req-e1');
    expect(() => db.prepare(`INSERT INTO FullscreenRecoveryRequest (id,cloudId,accountId,feature,scenariosJson,noteCiphertext,emailCiphertext,consentVersion,consentAt,createdAt,grantId)
      VALUES ('x','c','a','other','[]','n','e','v','t','t','gx')`).run()).toThrow(/CHECK/);
  });

  it('lets a fullscreen row and an edit row coexist for one cloudId + accountId, and keeps the unique constraints and index', () => {
    const db = seeded(); migrate(db);
    insertEdit(db, 'req-e1', 'acct-1');
    expect((db.prepare(`SELECT count(*) c FROM FullscreenRecoveryRequest WHERE cloudId='cloud-1' AND accountId='acct-1'`).get() as any).c).toBe(2);
    expect(() => insertEdit(db, 'req-e2', 'acct-1')).toThrow(/UNIQUE/);          // (cloudId, accountId, feature)
    expect(() => insertEdit(db, 'req-e3', 'acct-9', 'g1')).toThrow(/UNIQUE/);    // grantId
    const idx = db.prepare(`PRAGMA index_list('FullscreenRecoveryRequest')`).all() as any[];
    expect(idx.map(i => i.name)).toContain('idx_fullscreen_recovery_support_pending');
    expect(db.prepare(`PRAGMA table_info('FullscreenRecoveryRequest')`).all().map((c: any) => c.name)).toHaveLength(18);
    expect((db.prepare(`PRAGMA table_info('FullscreenRecoveryRequest')`).all().find((c: any) => c.name === 'feature') as any).dflt_value).toBe("'fullscreen'");
  });

  it('needs defer_foreign_keys: without it the rebuild fails', () => {
    const db = seeded();
    expect(() => migrate(db, sql(MIGRATION).replace('PRAGMA defer_foreign_keys = on;', ''))).toThrow(/FOREIGN KEY/);
  });
});
