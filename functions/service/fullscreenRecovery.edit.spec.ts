import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  activateRecovery, createRecoveryRequest, parseRecoveryRequest, recoverySnapshot, RecoveryError,
  type RecoveryEnv, type RecoveryIdentity,
} from './fullscreenRecoveryService';
import { onRequestGet } from '../api/fullscreen-recovery';
import { renderFirstReply } from './fullscreenRecoveryMail';
import { renderRequestNotification } from './fullscreenRecoveryNotify';

// Edit request gate, spec examples E1-E9 (docs/superpowers/specs/2026-11-13-per-site-paywall-enforcement-design.md).
// Real SQLite (migrations 0033, 0034, 0038), real enforcement and eligibility code, fake KV.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
const LITE = '8ad26115-211f-4216-971b-0540f606303d';
const FULL = 'd9e4002b-120b-426b-834b-402a4a5adce7';
const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
const CLOUD = 'example-cloud-id';
const alice: RecoveryIdentity = { cloudId: CLOUD, accountId: 'alice', forgeAppId: LITE };
const bob: RecoveryIdentity = { cloudId: CLOUD, accountId: 'bob', forgeAppId: LITE };
const EFFECTIVE = '2026-12-08T00:00:00Z';
const BEFORE_ACTIVATION = new Date('2026-12-08T08:00:00Z');
const ACTIVATED = new Date('2026-12-08T09:00:00Z');
const edit = (n = 1) => ({
  action: 'request' as const, attemptId: `34307364-d627-453f-948f-3cf183955a8${n}`, feature: 'edit' as const,
  scenarios: ['fix_or_update' as const], note: '', email: 'person@example.test',
  consent: true as const, consentVersion: 'edit-contact-v1' as const, spaceKey: 'ENG',
});
const fullscreen = {
  action: 'request' as const, attemptId: '34307364-d627-453f-948f-3cf183955a89', scenarios: ['present' as const],
  note: '', email: 'person@example.test', consent: true as const, consentVersion: 'fullscreen-contact-v1' as const, spaceKey: 'ENG',
};

function setup(over: { stage?: string | null; count?: number; exemptions?: string | null; licenses?: Record<string, string>; fullscreenPolicy?: boolean; metricsThrow?: boolean } = {}) {
  const { stage = 'block_edit', count = 2282, exemptions = '{}', licenses = {}, fullscreenPolicy = false, metricsThrow = false } = over;
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  for (const f of ['0033_fullscreen_recovery.sql', '0034_fullscreen_recovery_mail.sql']) sqlite.exec(readFileSync(resolve(process.cwd(), 'functions/migrations', f), 'utf8'));
  sqlite.exec('BEGIN'); sqlite.exec(readFileSync(resolve(process.cwd(), 'functions/migrations/0038_recovery_request_edit_feature.sql'), 'utf8')); sqlite.exec('COMMIT');
  sqlite.exec(`CREATE TABLE AtlassianInstance (cloudId TEXT PRIMARY KEY, clientDomain TEXT);
    CREATE TABLE ForgeInstallation (cloudId TEXT, appId TEXT, createdAt TEXT, clientDomain TEXT);
    INSERT INTO AtlassianInstance VALUES ('${CLOUD}', 'example-tenant.atlassian.net');`);
  const db = { prepare(sql: string) {
    const st = sqlite.prepare(sql); let params: unknown[] = [];
    const b = { bind(...v: unknown[]) { params = v; return b; },
      first<T>() { return Promise.resolve((st.get(...params) || null) as T | null); },
      run() { const r = st.run(...params); return Promise.resolve({ meta: { changes: Number(r.changes) } }); },
      all<T>() { return Promise.resolve({ results: st.all(...params) as T[] }); } };
    return b; } } as unknown as D1Database;
  const env: RecoveryEnv = {
    DB: db, FULLSCREEN_RECOVERY_ENCRYPTION_KEY: KEY,
    KV_FEATURE_FLAGS: { get: async (k: string) => k === `paywall-enforcement:policy:${CLOUD}`
      ? (stage === null ? null : JSON.stringify({ stage, effectiveAt: EFFECTIVE }))
      : k === `fullscreen-recovery:policy:${CLOUD}` ? (fullscreenPolicy ? JSON.stringify({ enabled: true }) : null)
      : k === 'PAYWALL_EXEMPTIONS' ? exemptions : null } as KVNamespace,
    SPACE_LICENSE_KV: { get: async (k: string) => licenses[k] ?? null } as KVNamespace,
    confluence_plugin_features: { get: async (k: string) => {
      if (metricsThrow) throw new Error('kv down');
      return k === 'metrics:example-tenant:lite' ? { spaces: { ENG: { total: count } } } : null; } } as KVNamespace,
  };
  return { sqlite, env };
}
const snap = (env: RecoveryEnv, who: RecoveryIdentity, now: Date) => recoverySnapshot(env, who, now, 'ENG', 'edit');

describe('edit request gate: examples E1-E9', () => {
  it('E1 no request: gate with the request form; the snapshot carries the free limit', async () => {
    const { env } = setup();
    const s = await snap(env, alice, BEFORE_ACTIVATION);
    expect(s).toMatchObject({ state: 'not_requested', policyVersion: 'edit-contact-v1', limit: 100 });
  });
  it('E2 saved, never saved a diagram since: pending until the first successful save', async () => {
    const { env } = setup();
    const created = await createRecoveryRequest(env, alice, edit(), BEFORE_ACTIVATION);
    expect(created.outcome).toBe('created');
    expect(created.snapshot.state).toBe('pending_activation');
    const done = await activateRecovery(env, alice, { action: 'activate', attemptId: edit().attemptId, requestId: created.snapshot.request!.id, spaceKey: 'ENG', feature: 'edit' }, ACTIVATED);
    expect(done.outcome).toBe('activated');
    expect(done.snapshot.grant?.expiresAt).toBe('2026-12-15T09:00:00.000Z');
  });
  it('E3/E4 active until 168 hours after activation, then expired', async () => {
    const { env } = setup();
    const c = await createRecoveryRequest(env, alice, edit(), BEFORE_ACTIVATION);
    await activateRecovery(env, alice, { action: 'activate', attemptId: edit().attemptId, requestId: c.snapshot.request!.id, spaceKey: 'ENG', feature: 'edit' }, ACTIVATED);
    expect((await snap(env, alice, new Date('2026-12-15T08:59:00Z'))).state).toBe('active');
    expect((await snap(env, alice, new Date('2026-12-15T09:00:00Z'))).state).toBe('expired');
  });
  it('E5 a lookup that fails gives no gate state the client would block on', async () => {
    const { env } = setup({ metricsThrow: true });
    expect(['disabled', 'unavailable']).toContain((await snap(env, alice, BEFORE_ACTIVATION)).state);
    const noDb = await snap({ ...env, DB: undefined }, alice, BEFORE_ACTIVATION);
    expect(['disabled', 'unavailable']).toContain(noDb.state);
    const noKv = await snap({ ...env, KV_FEATURE_FLAGS: undefined }, alice, BEFORE_ACTIVATION);
    expect(['disabled', 'unavailable']).toContain(noKv.state);
  });
  it('E6 Full and Diagramly are unaffected (identity is not Lite)', async () => {
    const { env } = setup();
    const res = await onRequestGet({ request: new Request('https://x.test/api/fullscreen-recovery?feature=edit&spaceKey=ENG'), env,
      data: { forgeContext: { ...alice, forgeAppId: FULL } } } as any);
    expect((await res.json() as any).snapshot).toMatchObject({ state: 'disabled', policyVersion: 'edit-contact-v1' });
  });
  it('E7 a site at watermark or block_create has no edit gate; neither has one with no policy', async () => {
    for (const stage of ['notice', 'watermark', 'block_create', null]) {
      const { env } = setup({ stage });
      expect((await snap(env, alice, ACTIVATED)).state, String(stage)).toBe('disabled');
    }
    const { env } = setup({ stage: 'block_edit' });
    expect((await snap(env, alice, new Date('2026-12-07T23:59:59Z'))).state, 'before effectiveAt').toBe('disabled');
  });
  it('E8 the grant is personal: a second user has no request', async () => {
    const { env } = setup();
    await createRecoveryRequest(env, alice, edit(), BEFORE_ACTIVATION);
    expect((await snap(env, bob, BEFORE_ACTIVATION)).state).toBe('not_requested');
    expect((await snap(env, alice, BEFORE_ACTIVATION)).state).toBe('pending_activation');
  });
  it('E9 a Fullscreen grant does not open the editor, and an edit grant does not open Fullscreen', async () => {
    const { env, sqlite } = setup({ fullscreenPolicy: true, count: 2282 });
    const f = await createRecoveryRequest(env, alice, fullscreen, BEFORE_ACTIVATION);
    await activateRecovery(env, alice, { action: 'activate', attemptId: fullscreen.attemptId, requestId: f.snapshot.request!.id, spaceKey: 'ENG' }, ACTIVATED);
    expect((await snap(env, alice, ACTIVATED)).state).toBe('not_requested');
    await createRecoveryRequest(env, alice, edit(), ACTIVATED);
    expect(sqlite.prepare('SELECT feature FROM FullscreenRecoveryRequest ORDER BY feature').all()).toEqual([{ feature: 'edit' }, { feature: 'fullscreen' }]);
    expect((await recoverySnapshot(env, alice, ACTIVATED, 'ENG')).state).toBe('active');
  });
});

describe('edit gate rules', () => {
  it('refuses a request when the site is not at block_edit', async () => {
    const { env } = setup({ stage: 'watermark' });
    await expect(createRecoveryRequest(env, alice, edit(), BEFORE_ACTIVATION)).rejects.toMatchObject({ code: 'not_enforced' });
  });
  it('a space under the threshold, a licence, or an exemption leaves the gate off', async () => {
    const licence = JSON.stringify({ status: 'active', expiresAt: '2030-01-01T00:00:00Z' });
    expect((await snap(setup({ count: 149 }).env, alice, ACTIVATED)).state).toBe('disabled');
    expect((await snap(setup({ licenses: { [`license:${CLOUD}:ENG`]: licence } }).env, alice, ACTIVATED)).state).toBe('disabled');
    expect((await snap(setup({ licenses: { [`license:${CLOUD}:ENG:alice`]: licence } }).env, alice, ACTIVATED)).state).toBe('disabled');
    expect((await snap(setup({ licenses: { [`license:${CLOUD}:ENG:alice`]: licence } }).env, bob, ACTIVATED)).state).toBe('not_requested');
    expect((await snap(setup({ exemptions: '{"example-tenant":true}' }).env, alice, ACTIVATED)).state).toBe('disabled');
    expect((await snap(setup({ exemptions: null }).env, alice, ACTIVATED)).state).toBe('disabled');
  });
  it('the exemption override flag of the Fullscreen policy never applies to edit', async () => {
    const { env } = setup({ exemptions: '{"example-tenant":true}' });
    expect((await snap(env, alice, ACTIVATED)).state).toBe('disabled');
  });
  it('each feature validates its own scenarios and consent version', () => {
    expect(() => parseRecoveryRequest(edit())).not.toThrow();
    expect(() => parseRecoveryRequest({ ...edit(), scenarios: ['present'] })).toThrow(RecoveryError);
    expect(() => parseRecoveryRequest({ ...edit(), consentVersion: 'fullscreen-contact-v1' })).toThrow(RecoveryError);
    expect(() => parseRecoveryRequest({ ...fullscreen, scenarios: ['fix_or_update'] })).toThrow(RecoveryError);
    expect(() => parseRecoveryRequest({ ...fullscreen, feature: 'nope' })).toThrow(RecoveryError);
  });
  it('the identity-less GET answers in the requested feature', async () => {
    const { env } = setup();
    const res = await onRequestGet({ request: new Request('https://x.test/api/fullscreen-recovery?feature=edit'), env, data: {} } as any);
    expect((await res.json() as any).snapshot.policyVersion).toBe('edit-contact-v1');
  });
});

describe('feature-aware wording for people', () => {
  const base = { requestId: 'r-1', activatedAt: null, expiresAt: null, now: new Date('2026-12-08T00:00:00Z'), timeZone: 'UTC', from: 'ZenUML <s@example.test>', replyTo: 's@example.test' };
  it('first reply: Fullscreen text is unchanged, edit text speaks about editing', () => {
    const f = renderFirstReply({ ...base, scenarios: ['other'] });
    expect(f.subject).toBe('ZenUML Fullscreen support — request r-1');
    expect(f.text).toContain('We understand you want to use Fullscreen for your work.');
    expect(f.text).toContain('Your seven days of Fullscreen access begin when you first open and successfully view a diagram in Fullscreen.');
    const e = renderFirstReply({ ...base, scenarios: ['fix_or_update', 'other'], feature: 'edit' });
    expect(e.subject).toBe('ZenUML editing support — request r-1');
    expect(e.text).toContain('We understand you want to fix or update a diagram, edit diagrams for your work.');
    expect(e.text).toContain('Your seven days of editing access begin when you first save a diagram successfully.');
    expect(e.text).not.toMatch(/Fullscreen/);
  });
  it('request notification names the feature', () => {
    const input = { requestId: '11111111-2222', cloudId: 'c', spaceKey: 'ENG', scenarios: ['fix_or_update'], hasNote: false, createdAt: '2026-12-08T00:00:00Z' };
    expect(renderRequestNotification(input).subject).toBe('Fullscreen recovery request — c / ENG (11111111)');
    const e = renderRequestNotification({ ...input, feature: 'edit' });
    expect(e.subject).toBe('Edit recovery request — c / ENG (11111111)');
    expect(e.text.split('\n')[0]).toBe('An edit recovery request was submitted.');
  });
});
