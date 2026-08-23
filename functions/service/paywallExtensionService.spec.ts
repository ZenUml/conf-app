import { describe, expect, it } from 'vitest';
import {
  createOrReplayPaywallExtension,
  getActivePaywallExtension,
  parsePaywallExtensionInput,
  PAYWALL_EXTENSION_MS,
  PaywallExtensionValidationError,
  type PaywallExtensionInput,
} from './paywallExtensionService';

interface RequestRow {
  requestId: string;
  idempotencyKey: string;
  cloudId: string;
  accountId: string;
  spaceId: string;
  spaceKey: string;
  state: string;
  grantId: string | null;
  questionnaireVersion?: number;
  currentTask?: string | null;
  diagramAudience?: string | null;
  aiTools?: string | null;
  aiDiagramUsage?: string | null;
  aiDiagramUse?: string | null;
  processRequirement?: string | null;
  cloudAiPolicy?: string | null;
}

interface GrantRow {
  grantId: string;
  cloudId: string;
  accountId: string;
  spaceId: string;
  spaceKey: string;
  sourceRequestId: string;
  grantedAt: string;
  expiresAt: string;
  status: 'active';
}

class MemoryD1 {
  requests = new Map<string, RequestRow>();
  grants = new Map<string, GrantRow>();

  private requestKey(cloudId: unknown, accountId: unknown, spaceId: unknown, idempotencyKey: unknown) {
    return [cloudId, accountId, spaceId, idempotencyKey].join('|');
  }

  private grantKey(cloudId: unknown, accountId: unknown, spaceId: unknown) {
    return [cloudId, accountId, spaceId].join('|');
  }

  prepare(sql: string) {
    return {
      bind: (...args: unknown[]) => ({
        run: async () => {
          if (sql.includes('INSERT OR IGNORE INTO PaywallExtensionRequest')) {
            const key = this.requestKey(args[2], args[3], args[4], args[1]);
            if (this.requests.has(key)) return { success: true, meta: { changes: 0 } };
            this.requests.set(key, {
              requestId: String(args[0]),
              idempotencyKey: String(args[1]),
              cloudId: String(args[2]),
              accountId: String(args[3]),
              spaceId: String(args[4]),
              spaceKey: String(args[5]),
              state: 'submitted',
              grantId: null,
              questionnaireVersion: Number(args[7]),
              currentTask: args[8] == null ? null : String(args[8]),
              diagramAudience: args[9] == null ? null : String(args[9]),
              aiTools: args[10] == null ? null : String(args[10]),
              aiDiagramUsage: args[11] == null ? null : String(args[11]),
              aiDiagramUse: args[12] == null ? null : String(args[12]),
              processRequirement: args[13] == null ? null : String(args[13]),
              cloudAiPolicy: args[14] == null ? null : String(args[14]),
            });
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.includes('INSERT OR IGNORE INTO PaywallExtensionGrant')) {
            const key = this.grantKey(args[1], args[2], args[3]);
            if (this.grants.has(key)) return { success: true, meta: { changes: 0 } };
            this.grants.set(key, {
              grantId: String(args[0]),
              cloudId: String(args[1]),
              accountId: String(args[2]),
              spaceId: String(args[3]),
              spaceKey: String(args[4]),
              sourceRequestId: String(args[5]),
              grantedAt: String(args[6]),
              expiresAt: String(args[7]),
              status: 'active',
            });
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.includes('UPDATE PaywallExtensionRequest')) {
            const requestId = String(args[3]);
            for (const request of this.requests.values()) {
              if (request.requestId === requestId) {
                request.state = String(args[0]);
                request.grantId = args[1] == null ? null : String(args[1]);
              }
            }
            return { success: true, meta: { changes: 1 } };
          }
          throw new Error(`Unexpected run SQL: ${sql}`);
        },
        first: async () => {
          if (sql.includes('FROM PaywallExtensionRequest')) {
            return this.requests.get(this.requestKey(args[0], args[1], args[2], args[3])) ?? null;
          }
          if (sql.includes('FROM PaywallExtensionGrant') && sql.includes('spaceId = ?3')) {
            return this.grants.get(this.grantKey(args[0], args[1], args[2])) ?? null;
          }
          if (sql.includes('FROM PaywallExtensionGrant') && sql.includes('spaceKey = ?3')) {
            const now = String(args[3]);
            return [...this.grants.values()].find((grant) => (
              grant.cloudId === args[0]
              && grant.accountId === args[1]
              && grant.spaceKey === args[2]
              && grant.expiresAt > now
            )) ?? null;
          }
          throw new Error(`Unexpected first SQL: ${sql}`);
        },
      }),
    };
  }
}

const input: PaywallExtensionInput = {
  spaceKey: 'ENG',
  macroCount: 123,
  idempotencyKey: 'request-key-00000001',
  questionnaireVersion: 1,
  answers: {
    currentTask: 'architecture_design',
    diagramAudience: 'architect_tech_lead',
    aiAndDiagrams: { tools: ['github_copilot', 'claude_code'], diagramUsage: 'zenuml' },
    workflowConstraints: {
      processRequirement: 'required_template',
      cloudAiPolicy: 'restricted',
    },
    unblockNeed: { scope: 'space', urgency: 'today' },
  },
};

const v2Input = {
  spaceKey: 'ENG',
  macroCount: 123,
  idempotencyKey: 'request-key-00000002',
  questionnaireVersion: 2,
  answers: {
    unblockNeed: { scope: 'not_sure', urgency: 'no_hard_deadline' },
    aiDiagramUse: 'regularly',
  },
} as const;

const identity = {
  cloudId: 'cloud-1',
  accountId: 'user-1',
  spaceId: 'space-1',
  spaceKey: 'ENG',
};

describe('parsePaywallExtensionInput', () => {
  it('accepts the legacy five structured answers for rollout compatibility', () => {
    expect(parsePaywallExtensionInput(input)).toEqual(input);
    expect(Object.keys(input.answers)).toEqual([
      'currentTask',
      'diagramAudience',
      'aiAndDiagrams',
      'workflowConstraints',
      'unblockNeed',
    ]);
  });

  it('accepts the version 2 three-question payload without inventing legacy answers', () => {
    expect(parsePaywallExtensionInput(v2Input)).toEqual(v2Input);
    expect(Object.keys(parsePaywallExtensionInput(v2Input).answers)).toEqual([
      'unblockNeed',
      'aiDiagramUse',
    ]);
  });

  it('accepts a legacy payload without a version marker as version 1', () => {
    const { questionnaireVersion: _version, ...legacyPayload } = input;
    expect(parsePaywallExtensionInput(legacyPayload)).toMatchObject({ questionnaireVersion: 1 });
  });

  it('rejects an incomplete or invalid version 2 answer set', () => {
    expect(() => parsePaywallExtensionInput({
      ...v2Input,
      answers: { aiDiagramUse: 'regularly' },
    })).toThrow('answers.unblockNeed is required');
    expect(() => parsePaywallExtensionInput({
      ...v2Input,
      answers: { ...v2Input.answers, aiDiagramUse: 'chatgpt' },
    })).toThrow('answers.aiDiagramUse is invalid');
    expect(() => parsePaywallExtensionInput({
      ...v2Input,
      questionnaireVersion: 3,
    })).toThrow('questionnaireVersion is invalid');
  });

  it('keeps version-specific scope and urgency values isolated', () => {
    expect(() => parsePaywallExtensionInput({
      ...input,
      answers: {
        ...input.answers,
        unblockNeed: { scope: 'not_sure', urgency: 'today' },
      },
    })).toThrow('answers.unblockNeed.scope is invalid');
    expect(() => parsePaywallExtensionInput({
      ...input,
      answers: {
        ...input.answers,
        unblockNeed: { scope: 'space', urgency: 'no_hard_deadline' },
      },
    })).toThrow('answers.unblockNeed.urgency is invalid');
    expect(() => parsePaywallExtensionInput({
      ...v2Input,
      answers: { unblockNeed: { scope: 'not_sure', urgency: 'planning_ahead' } },
    })).toThrow('answers.unblockNeed.urgency is invalid');
  });

  it('rejects the limit itself, under-limit, free-form, and malformed input', () => {
    expect(() => parsePaywallExtensionInput({ ...input, macroCount: 100 }))
      .toThrow(PaywallExtensionValidationError);
    expect(() => parsePaywallExtensionInput({
      ...input,
      answers: { ...input.answers, currentTask: 'my secret project' },
    })).toThrow('answers.currentTask is invalid');
    expect(() => parsePaywallExtensionInput({ ...input, spaceKey: '../ENG' }))
      .toThrow('spaceKey is invalid');
  });
});

describe('createOrReplayPaywallExtension', () => {
  it('grants exactly seven days and returns the same grant on replay', async () => {
    const db = new MemoryD1();
    const now = new Date('2026-08-23T01:02:03.000Z');
    let sequence = 0;
    const randomUUID = () => `uuid-${++sequence}`;

    const first = await createOrReplayPaywallExtension(db as unknown as D1Database, identity, input, {
      now,
      randomUUID,
    });
    const replay = await createOrReplayPaywallExtension(db as unknown as D1Database, identity, input, {
      now: new Date('2026-08-24T01:02:03.000Z'),
      randomUUID,
    });

    expect(first.status).toBe('granted');
    expect(replay.status).toBe('granted');
    if (first.status !== 'granted' || replay.status !== 'granted') return;
    expect(Date.parse(first.grant.expiresAt) - Date.parse(first.grant.grantedAt)).toBe(PAYWALL_EXTENSION_MS);
    expect(first.grant).toEqual(replay.grant);
    expect(first.isReplay).toBe(false);
    expect(replay.isReplay).toBe(true);
    expect(db.requests).toHaveLength(1);
    expect(db.grants).toHaveLength(1);
  });

  it('stores version 2 answers without fabricating legacy questionnaire values', async () => {
    const db = new MemoryD1();
    await createOrReplayPaywallExtension(db as unknown as D1Database, identity, v2Input, {
      now: new Date('2026-08-23T01:02:03.000Z'),
      randomUUID: () => 'uuid-v2',
    });

    const request = [...db.requests.values()][0];
    expect(request).toMatchObject({
      questionnaireVersion: 2,
      currentTask: null,
      diagramAudience: null,
      aiTools: null,
      aiDiagramUsage: null,
      aiDiagramUse: 'regularly',
      processRequirement: null,
      cloudAiPolicy: null,
    });
  });

  it('persists a repeat request for manual review without extending expiry', async () => {
    const db = new MemoryD1();
    let sequence = 0;
    const randomUUID = () => `uuid-${++sequence}`;
    const first = await createOrReplayPaywallExtension(db as unknown as D1Database, identity, input, {
      now: new Date('2026-08-23T00:00:00.000Z'),
      randomUUID,
    });
    const repeat = await createOrReplayPaywallExtension(db as unknown as D1Database, identity, {
      ...input,
      idempotencyKey: 'request-key-00000002',
    }, {
      now: new Date('2026-09-23T00:00:00.000Z'),
      randomUUID,
    });

    expect(first.status).toBe('granted');
    expect(repeat).toMatchObject({ status: 'manual_review', priorGrantCount: 1, isReplay: false });
    expect(db.requests).toHaveLength(2);
    expect(db.grants).toHaveLength(1);
  });

  it('allows only one automatic winner for concurrent different requests', async () => {
    const db = new MemoryD1();
    let sequence = 0;
    const randomUUID = () => `uuid-${++sequence}`;
    const [one, two] = await Promise.all([
      createOrReplayPaywallExtension(db as unknown as D1Database, identity, input, { randomUUID }),
      createOrReplayPaywallExtension(db as unknown as D1Database, identity, {
        ...input,
        idempotencyKey: 'request-key-00000002',
      }, { randomUUID }),
    ]);

    expect([one.status, two.status].sort()).toEqual(['granted', 'manual_review']);
    expect(db.grants).toHaveLength(1);
    expect(db.requests).toHaveLength(2);
  });

  it('matches only an active user+Space grant and expires at server time', async () => {
    const db = new MemoryD1();
    let sequence = 0;
    await createOrReplayPaywallExtension(db as unknown as D1Database, identity, input, {
      now: new Date('2026-08-23T00:00:00.000Z'),
      randomUUID: () => `uuid-${++sequence}`,
    });

    expect(await getActivePaywallExtension(db as unknown as D1Database, {
      cloudId: identity.cloudId,
      accountId: identity.accountId,
      spaceKey: identity.spaceKey,
    }, new Date('2026-08-29T23:59:59.999Z'))).not.toBeNull();
    expect(await getActivePaywallExtension(db as unknown as D1Database, {
      cloudId: identity.cloudId,
      accountId: 'another-user',
      spaceKey: identity.spaceKey,
    }, new Date('2026-08-24T00:00:00.000Z'))).toBeNull();
    expect(await getActivePaywallExtension(db as unknown as D1Database, {
      cloudId: identity.cloudId,
      accountId: identity.accountId,
      spaceKey: identity.spaceKey,
    }, new Date('2026-08-30T00:00:00.000Z'))).toBeNull();
  });
});
