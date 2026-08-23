export const PAYWALL_EXTENSION_DAYS = 7;
export const PAYWALL_EXTENSION_MS = PAYWALL_EXTENSION_DAYS * 24 * 60 * 60 * 1000;

export const CURRENT_TASK_VALUES = [
  'architecture_design',
  'design_review',
  'technical_documentation',
  'incident_review',
  'understand_existing_system',
  'team_communication',
  'other',
] as const;

export const DIAGRAM_AUDIENCE_VALUES = [
  'self',
  'development_team',
  'architect_tech_lead',
  'manager_engineering_lead',
  'another_team',
  'security_platform_governance',
  'documentation_readers',
] as const;

export const AI_DIAGRAM_USAGE_VALUES = [
  'none',
  'ai_without_diagrams',
  'mermaid',
  'zenuml',
  'other_diagram_as_code',
  'not_sure',
] as const;

export const AI_TOOL_VALUES = [
  'none',
  'github_copilot',
  'cursor',
  'claude_code',
  'chatgpt',
  'windsurf',
  'other',
  'not_sure',
] as const;

export const PROCESS_REQUIREMENT_VALUES = [
  'required_template',
  'required_without_template',
  'not_required',
  'not_sure',
] as const;

export const CLOUD_AI_POLICY_VALUES = [
  'allowed',
  'restricted',
  'not_allowed',
  'not_sure',
] as const;

export const LEGACY_EXTENSION_SCOPE_VALUES = ['self', 'space', 'site'] as const;
export const LEGACY_EXTENSION_URGENCY_VALUES = ['today', 'this_week', 'planning_ahead'] as const;
export const EXTENSION_SCOPE_VALUES = ['self', 'space', 'site', 'not_sure'] as const;
export const EXTENSION_URGENCY_VALUES = ['today', 'this_week', 'no_hard_deadline'] as const;
export const AI_DIAGRAM_USE_VALUES = ['regularly', 'occasionally', 'interested', 'no'] as const;

type ValueOf<T extends readonly string[]> = T[number];

interface PaywallExtensionInputBase {
  spaceKey: string;
  macroCount: number;
  idempotencyKey: string;
}

export interface LegacyPaywallExtensionInput extends PaywallExtensionInputBase {
  questionnaireVersion: 1;
  answers: {
    currentTask: ValueOf<typeof CURRENT_TASK_VALUES>;
    diagramAudience: ValueOf<typeof DIAGRAM_AUDIENCE_VALUES>;
    aiAndDiagrams: {
      tools: Array<ValueOf<typeof AI_TOOL_VALUES>>;
      diagramUsage: ValueOf<typeof AI_DIAGRAM_USAGE_VALUES>;
    };
    workflowConstraints: {
      processRequirement: ValueOf<typeof PROCESS_REQUIREMENT_VALUES>;
      cloudAiPolicy: ValueOf<typeof CLOUD_AI_POLICY_VALUES>;
    };
    unblockNeed: {
      scope: ValueOf<typeof LEGACY_EXTENSION_SCOPE_VALUES>;
      urgency: ValueOf<typeof LEGACY_EXTENSION_URGENCY_VALUES>;
    };
  };
}

export interface PaywallExtensionQuestionnaireV2Input extends PaywallExtensionInputBase {
  questionnaireVersion: 2;
  answers: {
    unblockNeed: {
      scope: ValueOf<typeof EXTENSION_SCOPE_VALUES>;
      urgency: ValueOf<typeof EXTENSION_URGENCY_VALUES>;
    };
    aiDiagramUse?: ValueOf<typeof AI_DIAGRAM_USE_VALUES>;
  };
}

export type PaywallExtensionInput =
  | LegacyPaywallExtensionInput
  | PaywallExtensionQuestionnaireV2Input;

export interface ExtensionIdentity {
  cloudId: string;
  accountId: string;
  spaceId: string;
  spaceKey: string;
}

interface ExtensionRequestRow {
  requestId: string;
  idempotencyKey: string;
  state: 'submitted' | 'auto_granted' | 'manual_review';
  grantId: string | null;
}

export interface ExtensionGrantRow {
  grantId: string;
  sourceRequestId: string;
  grantedAt: string;
  expiresAt: string;
  status: 'active';
}

export type ExtensionResult =
  | {
      status: 'granted';
      requestId: string;
      isReplay: boolean;
      grant: {
        grantId: string;
        grantedAt: string;
        expiresAt: string;
        extensionDays: typeof PAYWALL_EXTENSION_DAYS;
      };
    }
  | {
      status: 'manual_review';
      requestId: string;
      isReplay: boolean;
      priorGrantCount: 1;
      message: string;
    };

export class PaywallExtensionValidationError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function enumValue<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  field: string,
): ValueOf<T> {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new PaywallExtensionValidationError(`${field} is invalid`);
  }
  return value as ValueOf<T>;
}

function aiTools(value: unknown): Array<ValueOf<typeof AI_TOOL_VALUES>> {
  if (!Array.isArray(value) || value.length < 1 || value.length > 5) {
    throw new PaywallExtensionValidationError('answers.aiAndDiagrams.tools is invalid');
  }
  const tools = [...new Set(value.map((tool) => (
    enumValue(tool, AI_TOOL_VALUES, 'answers.aiAndDiagrams.tools')
  )))];
  if (tools.length !== value.length) {
    throw new PaywallExtensionValidationError('answers.aiAndDiagrams.tools contains duplicates');
  }
  if (tools.length > 1 && (tools.includes('none') || tools.includes('not_sure'))) {
    throw new PaywallExtensionValidationError('none/not_sure cannot be combined with another AI tool');
  }
  return tools;
}

const SPACE_KEY_RE = /^[A-Za-z0-9_.~-]{1,255}$/;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{16,128}$/;

export function parsePaywallExtensionInput(value: unknown): PaywallExtensionInput {
  if (!isRecord(value)) throw new PaywallExtensionValidationError('JSON body must be an object');
  if (typeof value.spaceKey !== 'string' || !SPACE_KEY_RE.test(value.spaceKey)) {
    throw new PaywallExtensionValidationError('spaceKey is invalid');
  }
  if (!Number.isInteger(value.macroCount) || (value.macroCount as number) < 101 || (value.macroCount as number) > 1_000_000) {
    throw new PaywallExtensionValidationError('macroCount must be an integer between 101 and 1000000');
  }
  if (typeof value.idempotencyKey !== 'string' || !IDEMPOTENCY_KEY_RE.test(value.idempotencyKey)) {
    throw new PaywallExtensionValidationError('idempotencyKey is invalid');
  }
  if (!isRecord(value.answers)) throw new PaywallExtensionValidationError('answers is required');
  const answers = value.answers;
  if (!isRecord(answers.unblockNeed)) {
    throw new PaywallExtensionValidationError('answers.unblockNeed is required');
  }

  const questionnaireVersion = value.questionnaireVersion === undefined
    ? 1
    : value.questionnaireVersion;
  if (questionnaireVersion !== 1 && questionnaireVersion !== 2) {
    throw new PaywallExtensionValidationError('questionnaireVersion is invalid');
  }

  if (questionnaireVersion === 2) {
    const parsedV2: PaywallExtensionQuestionnaireV2Input = {
      spaceKey: value.spaceKey,
      macroCount: value.macroCount as number,
      idempotencyKey: value.idempotencyKey,
      questionnaireVersion: 2,
      answers: {
        unblockNeed: {
          scope: enumValue(answers.unblockNeed.scope, EXTENSION_SCOPE_VALUES, 'answers.unblockNeed.scope'),
          urgency: enumValue(answers.unblockNeed.urgency, EXTENSION_URGENCY_VALUES, 'answers.unblockNeed.urgency'),
        },
        ...(answers.aiDiagramUse === undefined ? {} : {
          aiDiagramUse: enumValue(answers.aiDiagramUse, AI_DIAGRAM_USE_VALUES, 'answers.aiDiagramUse'),
        }),
      },
    };
    return parsedV2;
  }

  if (!isRecord(answers.workflowConstraints)) {
    throw new PaywallExtensionValidationError('answers.workflowConstraints is required');
  }
  if (!isRecord(answers.aiAndDiagrams)) {
    throw new PaywallExtensionValidationError('answers.aiAndDiagrams is required');
  }

  return {
    spaceKey: value.spaceKey,
    macroCount: value.macroCount as number,
    idempotencyKey: value.idempotencyKey,
    questionnaireVersion: 1,
    answers: {
      currentTask: enumValue(answers.currentTask, CURRENT_TASK_VALUES, 'answers.currentTask'),
      diagramAudience: enumValue(answers.diagramAudience, DIAGRAM_AUDIENCE_VALUES, 'answers.diagramAudience'),
      aiAndDiagrams: {
        tools: aiTools(answers.aiAndDiagrams.tools),
        diagramUsage: enumValue(
          answers.aiAndDiagrams.diagramUsage,
          AI_DIAGRAM_USAGE_VALUES,
          'answers.aiAndDiagrams.diagramUsage',
        ),
      },
      workflowConstraints: {
        processRequirement: enumValue(
          answers.workflowConstraints.processRequirement,
          PROCESS_REQUIREMENT_VALUES,
          'answers.workflowConstraints.processRequirement',
        ),
        cloudAiPolicy: enumValue(
          answers.workflowConstraints.cloudAiPolicy,
          CLOUD_AI_POLICY_VALUES,
          'answers.workflowConstraints.cloudAiPolicy',
        ),
      },
      unblockNeed: {
        scope: enumValue(answers.unblockNeed.scope, LEGACY_EXTENSION_SCOPE_VALUES, 'answers.unblockNeed.scope'),
        urgency: enumValue(answers.unblockNeed.urgency, LEGACY_EXTENSION_URGENCY_VALUES, 'answers.unblockNeed.urgency'),
      },
    },
  };
}

function changedRows(result: D1Result<unknown>): number {
  const changes = result.meta?.changes;
  return typeof changes === 'number' ? changes : 0;
}

async function requestByIdempotency(
  db: D1Database,
  identity: ExtensionIdentity,
  idempotencyKey: string,
): Promise<ExtensionRequestRow> {
  const row = await db.prepare(
    `SELECT requestId, idempotencyKey, state, grantId
       FROM PaywallExtensionRequest
      WHERE cloudId = ?1 AND accountId = ?2 AND spaceId = ?3 AND idempotencyKey = ?4`,
  ).bind(identity.cloudId, identity.accountId, identity.spaceId, idempotencyKey).first<ExtensionRequestRow>();
  if (!row) throw new Error('Persisted extension request could not be read');
  return row;
}

async function grantForIdentity(
  db: D1Database,
  identity: ExtensionIdentity,
): Promise<ExtensionGrantRow | null> {
  return db.prepare(
    `SELECT grantId, sourceRequestId, grantedAt, expiresAt, status
       FROM PaywallExtensionGrant
      WHERE cloudId = ?1 AND accountId = ?2 AND spaceId = ?3
      LIMIT 1`,
  ).bind(identity.cloudId, identity.accountId, identity.spaceId).first<ExtensionGrantRow>();
}

async function markRequest(
  db: D1Database,
  requestId: string,
  state: 'auto_granted' | 'manual_review',
  grantId: string | null,
  updatedAt: string,
): Promise<void> {
  await db.prepare(
    `UPDATE PaywallExtensionRequest
        SET state = ?1, grantId = ?2, updatedAt = ?3
      WHERE requestId = ?4`,
  ).bind(state, grantId, updatedAt, requestId).run();
}

function grantedResult(requestId: string, grant: ExtensionGrantRow, isReplay: boolean): ExtensionResult {
  return {
    status: 'granted',
    requestId,
    isReplay,
    grant: {
      grantId: grant.grantId,
      grantedAt: grant.grantedAt,
      expiresAt: grant.expiresAt,
      extensionDays: PAYWALL_EXTENSION_DAYS,
    },
  };
}

/**
 * Persist a request and atomically compete for the once-only automatic grant.
 * SQLite's two UNIQUE constraints are the concurrency authority: identical
 * idempotency keys converge on one request, while different concurrent keys
 * can create requests but only one can insert the user+Space grant.
 */
export async function createOrReplayPaywallExtension(
  db: D1Database,
  identity: ExtensionIdentity,
  input: PaywallExtensionInput,
  options: { now?: Date; randomUUID?: () => string } = {},
): Promise<ExtensionResult> {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const randomUUID = options.randomUUID ?? (() => crypto.randomUUID());
  const proposedRequestId = randomUUID();
  const legacyAnswers = input.questionnaireVersion === 1 ? input.answers : null;

  const insertRequest = await db.prepare(
    `INSERT OR IGNORE INTO PaywallExtensionRequest (
       requestId, idempotencyKey, cloudId, accountId, spaceId, spaceKey,
       macroCount, questionnaireVersion, currentTask, diagramAudience, aiTools, aiDiagramUsage,
       aiDiagramUse, processRequirement, cloudAiPolicy, requestedScope, urgency,
       state, grantId, createdAt, updatedAt
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, 'submitted', NULL, ?18, ?18)`,
  ).bind(
    proposedRequestId,
    input.idempotencyKey,
    identity.cloudId,
    identity.accountId,
    identity.spaceId,
    identity.spaceKey,
    input.macroCount,
    input.questionnaireVersion,
    legacyAnswers?.currentTask ?? null,
    legacyAnswers?.diagramAudience ?? null,
    legacyAnswers ? JSON.stringify(legacyAnswers.aiAndDiagrams.tools) : null,
    legacyAnswers?.aiAndDiagrams.diagramUsage ?? null,
    input.questionnaireVersion === 2 ? input.answers.aiDiagramUse ?? null : null,
    legacyAnswers?.workflowConstraints.processRequirement ?? null,
    legacyAnswers?.workflowConstraints.cloudAiPolicy ?? null,
    input.answers.unblockNeed.scope,
    input.answers.unblockNeed.urgency,
    nowIso,
  ).run();

  const insertedRequest = changedRows(insertRequest) > 0;
  const request = await requestByIdempotency(db, identity, input.idempotencyKey);
  let grant = await grantForIdentity(db, identity);

  if (!grant) {
    const grantId = randomUUID();
    const expiresAt = new Date(now.getTime() + PAYWALL_EXTENSION_MS).toISOString();
    await db.prepare(
      `INSERT OR IGNORE INTO PaywallExtensionGrant (
         grantId, cloudId, accountId, spaceId, spaceKey, sourceRequestId,
         reason, status, grantedAt, expiresAt, createdAt, updatedAt
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'first_automatic_extension', 'active', ?7, ?8, ?7, ?7)`,
    ).bind(
      grantId,
      identity.cloudId,
      identity.accountId,
      identity.spaceId,
      identity.spaceKey,
      request.requestId,
      nowIso,
      expiresAt,
    ).run();
    grant = await grantForIdentity(db, identity);
  }

  if (!grant) throw new Error('Automatic extension grant could not be read');

  if (grant.sourceRequestId === request.requestId) {
    await markRequest(db, request.requestId, 'auto_granted', grant.grantId, nowIso);
    return grantedResult(request.requestId, grant, !insertedRequest);
  }

  await markRequest(db, request.requestId, 'manual_review', null, nowIso);
  return {
    status: 'manual_review',
    requestId: request.requestId,
    isReplay: !insertedRequest,
    priorGrantCount: 1,
    message: 'Your request was received for manual review. No additional extension has been granted.',
  };
}

export async function getActivePaywallExtension(
  db: D1Database,
  identity: Pick<ExtensionIdentity, 'cloudId' | 'accountId'> & { spaceKey: string },
  now: Date = new Date(),
): Promise<{ expiresAt: string } | null> {
  const row = await db.prepare(
    `SELECT expiresAt
       FROM PaywallExtensionGrant
      WHERE cloudId = ?1 AND accountId = ?2 AND spaceKey = ?3
        AND status = 'active' AND expiresAt > ?4
      ORDER BY expiresAt DESC
      LIMIT 1`,
  ).bind(identity.cloudId, identity.accountId, identity.spaceKey, now.toISOString()).first<{ expiresAt: string }>();
  return row ?? null;
}
