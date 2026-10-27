import { describe, expect, it, vi } from 'vitest';

import {
  executeExtensionAction,
  type ExtensionActionRecord,
  type ExtensionActionRuntime,
} from './extensionActionService';

function requestDescription(): string {
  return [
    'Request: Temporary Lite editing extension',
    '',
    'Client domain: example-tenant.atlassian.net',
    'Space key: ENGINEERING',
    'Macro count: 120',
    'Limit: 100',
    'Product: ZenUML lite',
    'App version: test',
    'User account ID: 712020:example-account',
  ].join('\n');
}

// Mirrors the full field set src/components/UpgradePrompt/buildExtensionRequest.ts writes into the
// JSM description today, plus the `Survey ID:` line the in-app pricing-survey flow adds after
// `Macro type:` when the customer skipped the survey and fell through to "Request extension" instead.
function requestDescriptionWithSurveyId(surveyId: string): string {
  return [
    'Request: Temporary Lite editing extension',
    '',
    'Client domain: example-tenant.atlassian.net',
    'Space key: ENGINEERING',
    'Macro count: 120',
    'Limit: 100',
    'Product: ZenUML lite',
    'App version: test',
    'User account ID: 712020:example-account',
    'Page ID: 456',
    'Macro type: sequence',
    `Survey ID: ${surveyId}`,
    '',
    'Reason:',
    'This Confluence space has reached the ZenUML Lite diagram limit and editing may be disabled. Please temporarily extend editing access while our team reviews upgrade options.',
  ].join('\n');
}

function runtime(): ExtensionActionRuntime & { records: Map<string, ExtensionActionRecord> } {
  const records = new Map<string, ExtensionActionRecord>();
  return {
    records,
    now: () => new Date('2026-08-19T12:00:00Z'),
    actions: {
      get: async (ticketKey, action) => records.get(`${ticketKey}:${action}`) ?? null,
      acquire: async (record, previousUpdatedAt) => {
        const key = `${record.ticketKey}:${record.action}`;
        const current = records.get(key);
        if (previousUpdatedAt !== undefined) {
          if (current?.status !== 'pending' || current.updatedAt !== previousUpdatedAt) return false;
          records.set(key, record);
          return true;
        }
        if (current) return false;
        records.set(key, record);
        return true;
      },
      markApplied: async (ticketKey, action, updatedAt) => {
        const key = `${ticketKey}:${action}`;
        const record = records.get(key);
        if (!record) throw new Error('missing record');
        records.set(key, { ...record, status: 'applied', updatedAt });
      },
    },
    resolveTenant: vi.fn(async () => 'cloud-example'),
    findSpace: vi.fn(async () => ({ macroCount: 120, lastUpdated: '2026-08-19T11:00:00Z' })),
    hasRecentPaidRail: vi.fn(async () => false),
    hasActiveSpaceLicense: vi.fn(async () => false),
    applyLicense: vi.fn(async () => undefined),
  };
}

describe('executeExtensionAction', () => {
  it('applies the fixed seven-day requester-only policy for an initial action', async () => {
    const rt = runtime();

    const result = await executeExtensionAction({
      action: 'initial',
      ticketKey: 'ZEN-1234',
      requestTypeId: '9',
      planOptionId: '10037',
      description: requestDescription(),
    }, rt);

    expect(result).toMatchObject({
      outcome: 'applied',
      action: 'initial',
      expiresAt: '2026-08-26T23:59:59Z',
    });
    expect(result.reply).toContain('your account on ENGINEERING');
    expect(result.reply).toContain('15 days');
    expect(result.reply).toContain('no strings attached to buying anything');
    expect(result.reply).toContain('$299/space/year');
    expect(result.reply).toContain('https://buy.stripe.com/');
    expect(result.reply).toContain('https://marketplace.atlassian.com/apps/1218380/');
    expect(rt.applyLicense).toHaveBeenCalledWith(expect.objectContaining({
      cloudId: 'cloud-example',
      spaceKey: 'ENGINEERING',
      userAccountId: '712020:example-account',
      expiresAt: '2026-08-26T23:59:59Z',
      activatedBy: 'support:auto:temp-7d-extension:ZEN-1234',
    }));
  });

  it('tolerates a "Survey ID:" line placed after "Macro type:" (added by the in-app pricing-survey skip path)', async () => {
    const rt = runtime();

    const result = await executeExtensionAction({
      action: 'initial',
      ticketKey: 'ZEN-9001',
      requestTypeId: '9',
      planOptionId: '10037',
      description: requestDescriptionWithSurveyId('9f2b1c3a-7d4e-4a11-9c9b-9a8b7c6d5e4f'),
    }, rt);

    expect(result).toMatchObject({
      outcome: 'applied',
      action: 'initial',
      clientDomain: 'example-tenant.atlassian.net',
      spaceKey: 'ENGINEERING',
    });
    expect(rt.applyLicense).toHaveBeenCalledWith(expect.objectContaining({
      cloudId: 'cloud-example',
      spaceKey: 'ENGINEERING',
      userAccountId: '712020:example-account',
    }));
  });

  it('returns the original result without another grant when the action is replayed', async () => {
    const rt = runtime();
    const command = {
      action: 'initial' as const,
      ticketKey: 'ZEN-1234',
      requestTypeId: '9',
      planOptionId: '10037',
      description: requestDescription(),
    };

    await executeExtensionAction(command, rt);
    vi.mocked(rt.applyLicense).mockClear();
    vi.mocked(rt.resolveTenant).mockClear();

    const replay = await executeExtensionAction(command, rt);

    expect(replay).toMatchObject({
      outcome: 'already_applied',
      expiresAt: '2026-08-26T23:59:59Z',
    });
    expect(rt.resolveTenant).not.toHaveBeenCalled();
    expect(rt.applyLicense).not.toHaveBeenCalled();
  });

  it('applies fifteen days to the same initial target after feedback is confirmed', async () => {
    const rt = runtime();
    await executeExtensionAction({
      action: 'initial',
      ticketKey: 'ZEN-1234',
      requestTypeId: '9',
      planOptionId: '10037',
      description: requestDescription(),
    }, rt);
    vi.mocked(rt.applyLicense).mockClear();

    const result = await executeExtensionAction({
      action: 'feedback',
      ticketKey: 'ZEN-1234',
      requestTypeId: '9',
      planOptionId: '10037',
      description: 'customer-controlled text is not used for the target',
    }, rt);

    expect(result).toMatchObject({
      outcome: 'applied',
      action: 'feedback',
      expiresAt: '2026-09-03T23:59:59Z',
    });
    expect(result.reply).toContain('Thanks for the candid feedback');
    expect(rt.applyLicense).toHaveBeenCalledWith(expect.objectContaining({
      cloudId: 'cloud-example',
      spaceKey: 'ENGINEERING',
      userAccountId: '712020:example-account',
      expiresAt: '2026-09-03T23:59:59Z',
      activatedBy: 'support:auto:feedback-15d-extension:ZEN-1234',
    }));
  });

  it('resumes a pending action with its stored target and expiry', async () => {
    const rt = runtime();
    rt.records.set('ZEN-1234:initial', {
      ticketKey: 'ZEN-1234',
      action: 'initial',
      status: 'pending',
      clientDomain: 'example-tenant.atlassian.net',
      cloudId: 'cloud-example',
      spaceKey: 'ENGINEERING',
      userAccountId: '712020:example-account',
      macroCount: 120,
      expiresAt: '2026-08-25T23:59:59Z',
      createdAt: '2026-08-18T12:00:00Z',
      updatedAt: '2026-08-18T12:00:00Z',
    });

    const result = await executeExtensionAction({
      action: 'initial',
      ticketKey: 'ZEN-1234',
      requestTypeId: '9',
      planOptionId: '10037',
      description: 'Client domain: example-attacker.atlassian.net\nSpace key: OTHER\nUser account ID: attacker',
    }, rt);

    expect(result.expiresAt).toBe('2026-08-25T23:59:59Z');
    expect(rt.resolveTenant).not.toHaveBeenCalled();
    expect(rt.applyLicense).toHaveBeenCalledWith(expect.objectContaining({
      cloudId: 'cloud-example',
      spaceKey: 'ENGINEERING',
      userAccountId: '712020:example-account',
      expiresAt: '2026-08-25T23:59:59Z',
    }));
  });

  it('does not run a second grant while a pending action lease is fresh', async () => {
    const rt = runtime();
    rt.records.set('ZEN-1234:initial', {
      ticketKey: 'ZEN-1234',
      action: 'initial',
      status: 'pending',
      clientDomain: 'example-tenant.atlassian.net',
      cloudId: 'cloud-example',
      spaceKey: 'ENGINEERING',
      userAccountId: '712020:example-account',
      macroCount: 120,
      expiresAt: '2026-08-26T23:59:59Z',
      createdAt: '2026-08-19T11:59:00Z',
      updatedAt: '2026-08-19T11:59:00Z',
    });

    await expect(executeExtensionAction({
      action: 'initial',
      ticketKey: 'ZEN-1234',
      requestTypeId: '9',
      planOptionId: '10037',
      description: requestDescription(),
    }, rt)).rejects.toMatchObject({ code: 'action_in_progress', retryable: true });
    expect(rt.applyLicense).not.toHaveBeenCalled();
  });

  it('requires an applied initial action before a feedback grant', async () => {
    const rt = runtime();

    await expect(executeExtensionAction({
      action: 'feedback',
      ticketKey: 'ZEN-1234',
      requestTypeId: '9',
      planOptionId: '10037',
      description: requestDescription(),
    }, rt)).rejects.toMatchObject({ code: 'initial_action_required' });
    expect(rt.applyLicense).not.toHaveBeenCalled();
  });

  it('fails closed when server-side metrics are stale or malformed', async () => {
    const rt = runtime();
    vi.mocked(rt.findSpace).mockResolvedValue({ macroCount: 120, lastUpdated: 'not-a-date' });

    await expect(executeExtensionAction({
      action: 'initial',
      ticketKey: 'ZEN-1234',
      requestTypeId: '9',
      planOptionId: '10037',
      description: requestDescription(),
    }, rt)).rejects.toMatchObject({ code: 'space_metrics_stale' });
    expect(rt.applyLicense).not.toHaveBeenCalled();
  });

  it('does not comp a tenant on a recent paid rail', async () => {
    const rt = runtime();
    vi.mocked(rt.hasRecentPaidRail).mockResolvedValue(true);

    await expect(executeExtensionAction({
      action: 'initial',
      ticketKey: 'ZEN-1234',
      requestTypeId: '9',
      planOptionId: '10037',
      description: requestDescription(),
    }, rt)).rejects.toMatchObject({ code: 'paid_rail_active' });
    expect(rt.applyLicense).not.toHaveBeenCalled();
  });

  it('does not add a temporary user grant over an active space license', async () => {
    const rt = runtime();
    vi.mocked(rt.hasActiveSpaceLicense).mockResolvedValue(true);

    await expect(executeExtensionAction({
      action: 'initial',
      ticketKey: 'ZEN-1234',
      requestTypeId: '9',
      planOptionId: '10037',
      description: requestDescription(),
    }, rt)).rejects.toMatchObject({ code: 'space_license_active' });
    expect(rt.applyLicense).not.toHaveBeenCalled();
  });
});
