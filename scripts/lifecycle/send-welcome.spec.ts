// CLI-level regression net for ./send-welcome.mjs -- the Node/fs-only half
// of the welcome sender (template loading from disk, the dry-run file-writing
// ESP adapter, and the --live double gate). Core send logic is covered in
// senderCore.spec.ts; this file only covers what's genuinely CLI-specific.
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dryRunAdapter, loadTemplates, resolveEsp } from './send-welcome.mjs';
import { SUBJECTS } from './senderCore.mjs';

describe('loadTemplates', () => {
  it('loads all four per-app templates and each one carries that app\'s own branding', () => {
    const templates = loadTemplates();
    expect(Object.keys(templates).sort()).toEqual(['asyncapi', 'diagramly', 'full', 'lite']);

    expect(templates.lite).toContain('ZenUML for Confluence Lite');
    expect(templates.full).toContain('Your license covers every user on your site');
    expect(templates.full).not.toContain('ZenUML for Confluence Lite');
    expect(templates.diagramly).toContain('>Diagramly<');
    expect(templates.asyncapi).toContain('{{asyncapi_docs_url}}');

    // Every template still carries the two merge tags every app shares --
    // senderCore.mjs's renderTemplate() leaves both untouched today.
    for (const app of Object.keys(templates)) {
      expect(templates[app as keyof typeof templates]).toContain('{{unsubscribe_url}}');
      expect(templates[app as keyof typeof templates]).toContain('{{preferences_url}}');
    }
  });

  it('every app in SUBJECTS has a matching loaded template (no drift between the two maps)', () => {
    const templates = loadTemplates();
    expect(Object.keys(templates).sort()).toEqual(Object.keys(SUBJECTS).sort());
  });
});

describe('dryRunAdapter', () => {
  let outDir: string;

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), 'send-welcome-dryrun-'));
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it('creates outDir if missing, and writes <outDir>/<app>-<n>.html per send with a fake id', async () => {
    const freshOutDir = join(outDir, 'nested', 'does-not-exist-yet');
    const adapter = dryRunAdapter(freshOutDir);
    expect(existsSync(freshOutDir)).toBe(true);

    const first = await adapter.send({ to: 'ada@example.com', subject: 'Welcome', html: '<p>lite-1</p>', app: 'lite' });
    const second = await adapter.send({ to: 'bob@example.com', subject: 'Welcome', html: '<p>lite-2</p>', app: 'lite' });
    const third = await adapter.send({ to: 'eve@example.com', subject: 'Welcome', html: '<p>full-1</p>', app: 'full' });

    expect(first.id).toBe('dry-run-lite-1');
    expect(second.id).toBe('dry-run-lite-2');
    expect(third.id).toBe('dry-run-full-1');

    const files = readdirSync(freshOutDir).sort();
    expect(files).toEqual(['full-1.html', 'lite-1.html', 'lite-2.html']);
    expect(readFileSync(join(freshOutDir, 'lite-1.html'), 'utf8')).toBe('<p>lite-1</p>');
    expect(readFileSync(join(freshOutDir, 'full-1.html'), 'utf8')).toBe('<p>full-1</p>');
  });
});

describe('resolveEsp -- --live double gate', () => {
  it('refuses --live with no RESEND_API_KEY in the environment', () => {
    expect(() => resolveEsp({ live: true, yes: true, db: 'x', dryRunDir: null }, {})).toThrow(
      /RESEND_API_KEY/,
    );
  });

  it('refuses --live with a key but no --yes', () => {
    expect(() =>
      resolveEsp({ live: true, yes: false, db: 'x', dryRunDir: null }, { RESEND_API_KEY: 'k' }),
    ).toThrow(/--yes/);
  });

  it('accepts --live with both RESEND_API_KEY and --yes, returning a send-capable adapter', () => {
    const esp = resolveEsp({ live: true, yes: true, db: 'x', dryRunDir: null }, { RESEND_API_KEY: 'k' });
    expect(typeof esp.send).toBe('function');
  });

  it('refuses when neither --dry-run nor --live is given', () => {
    expect(() => resolveEsp({ live: false, yes: false, db: 'x', dryRunDir: null }, {})).toThrow(
      /--dry-run.*or --live/,
    );
  });

  it('returns a dryRunAdapter for --dry-run <dir>, independent of RESEND_API_KEY', () => {
    const dir = mkdtempSync(join(tmpdir(), 'send-welcome-resolve-'));
    try {
      const esp = resolveEsp({ live: false, yes: false, db: 'x', dryRunDir: dir }, {});
      expect(typeof esp.send).toBe('function');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
