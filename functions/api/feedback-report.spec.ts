import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { onRequestPost } from './feedback-report';

const VERIFIED_CONTEXT = {
  cloudId: 'cloud-example',
  forgeAppId: 'app-example',
  installationId: 'installation-example',
  accountId: 'account-example',
};

const BASE_PAYLOAD = {
  submissionId: '1dc9c2a9-e064-4fa1-bfe5-a58f1af9cf13',
  description: 'The diagram does not fit the available area.',
  context: {
    surface: 'viewer',
    hostModule: 'zenuml-macro',
    diagramType: 'mermaid',
    diagramTitle: 'Architecture overview',
    userAccountId: 'untrusted-client-account',
    clientDomain: 'untrusted.example.atlassian.net',
    spaceName: 'Example space',
    macroUuid: 'macro-example',
    contentId: 'content-example',
    customContentId: 'custom-content-example',
  },
};

function request(body = BASE_PAYLOAD) {
  return new Request('https://backend.example/api/feedback-report', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function dbWithDomain(domain = 'verified-example') {
  const insertRun = vi.fn(async () => ({ success: true }));
  const insertBind = vi.fn(() => ({ run: insertRun }));
  const domainFirst = vi.fn(async () => ({ clientDomain: domain }));
  const domainBind = vi.fn(() => ({ first: domainFirst }));
  return {
    prepare: vi.fn((sql: string) => sql.includes('FeedbackReport')
      ? { bind: insertBind }
      : { bind: domainBind }),
    insertBind,
    insertRun,
  };
}

function context(overrides: Record<string, unknown> = {}) {
  return {
    request: request(),
    data: { forgeContext: VERIFIED_CONTEXT },
    env: {
      DB: dbWithDomain(),
      ...overrides,
    },
  } as any;
}

describe('feedback-report', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('requires middleware-verified Forge identity and never writes without it', async () => {
    const result = await onRequestPost({
      ...context(),
      data: {},
    } as any);

    expect(result.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('durably saves one internal report and replaces client-supplied identity with verified identity', async () => {
    const db = dbWithDomain();
    const result = await onRequestPost(context({ DB: db }));
    const body = await result.json() as any;

    expect(result.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.reportReference).toMatch(/^FBR-[A-Z0-9]{12}$/);
    expect(body.artifacts).toEqual({ screenshot: 'not_provided' });
    expect(db.insertBind).toHaveBeenCalledOnce();
    const values = db.insertBind.mock.calls[0];
    expect(values).toContain('account-example');
    expect(values).toContain('verified-example');
    expect(values).not.toContain('untrusted-client-account');
    expect(values).not.toContain('untrusted.example.atlassian.net');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects invalid reports before contacting JSM', async () => {
    const result = await onRequestPost({
      ...context(),
      request: request({ ...BASE_PAYLOAD, description: '   ' }),
    } as any);

    expect(result.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('stores an explicitly attached screenshot in the same D1 report row', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-10T00:00:00.000Z'));
    const db = dbWithDomain();
    const result = await onRequestPost({
      ...context({ DB: db }),
      request: request({
        ...BASE_PAYLOAD,
        screenshot: { dataUrl: 'data:image/png;base64,iVBORw0KGgo=', name: 'capture.png', method: 'current_view' },
      } as any),
    } as any);

    expect(result.status).toBe(201);
    const body = await result.json() as any;
    expect(body.artifacts.screenshot).toBe('retained_30_days');
    const values = db.insertBind.mock.calls[0];
    const screenshotData = values.find((value: unknown) => value instanceof ArrayBuffer) as ArrayBuffer;
    expect(Array.from(new Uint8Array(screenshotData))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(values).toContain('image/png');
    expect(values).toContain('2026-10-10T00:00:00.000Z');
  });

  it('rejects screenshots larger than the D1-safe 1 MB limit', async () => {
    const bytes = new Uint8Array(1024 * 1024 + 1);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const result = await onRequestPost({
      ...context(),
      request: request({
        ...BASE_PAYLOAD,
        screenshot: { dataUrl: `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`, name: 'capture.png', method: 'current_view' },
      } as any),
    } as any);

    expect(result.status).toBe(400);
    expect((await result.json() as any).error).toBe('invalid_screenshot');
  });

  it('rejects invalid image data before writing any customer content', async () => {
    const db = dbWithDomain();
    const result = await onRequestPost({
      ...context({ DB: db }),
      request: request({
        ...BASE_PAYLOAD,
        screenshot: { dataUrl: 'data:text/html;base64,PGgxPk5vPC9oMT4=', name: 'capture.html', method: 'upload' },
      } as any),
    } as any);

    expect(result.status).toBe(400);
    expect(db.insertBind).not.toHaveBeenCalled();
  });

  it('preserves multiline plain text and Markdown-style characters verbatim', async () => {
    const db = dbWithDomain();
    const description = '  First line\n- bullet\n`literal`\n  last line  ';
    const result = await onRequestPost({
      ...context({ DB: db }),
      request: request({ ...BASE_PAYLOAD, description }),
    } as any);

    expect(result.status).toBe(201);
    expect(db.insertBind.mock.calls[0]).toContain(description);
  });

  it('accepts PNG Export as an explicit feedback surface', async () => {
    const db = dbWithDomain();
    const result = await onRequestPost({
      ...context({ DB: db }),
      request: request({
        ...BASE_PAYLOAD,
        context: { ...BASE_PAYLOAD.context, surface: 'png_export' },
      } as any),
    } as any);

    expect(result.status).toBe(201);
    expect(db.insertBind.mock.calls[0]).toContain('png_export');
  });
});
