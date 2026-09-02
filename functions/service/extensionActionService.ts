export type ExtensionAction = 'initial' | 'feedback';

export interface ExtensionCommand {
  action: ExtensionAction;
  ticketKey: string;
  requestTypeId: string;
  planOptionId: string;
  description: string;
}

export interface ExtensionActionRecord {
  ticketKey: string;
  action: ExtensionAction;
  status: 'pending' | 'applied';
  clientDomain: string;
  cloudId: string;
  spaceKey: string;
  userAccountId: string;
  macroCount: number;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExtensionActionStore {
  get(ticketKey: string, action: ExtensionAction): Promise<ExtensionActionRecord | null>;
  acquire(record: ExtensionActionRecord, previousUpdatedAt?: string): Promise<boolean>;
  markApplied(ticketKey: string, action: ExtensionAction, updatedAt: string): Promise<void>;
}

export interface LicenseGrant {
  cloudId: string;
  spaceKey: string;
  userAccountId: string;
  expiresAt: string;
  activatedBy: string;
}

export interface ExtensionActionRuntime {
  now(): Date;
  actions: ExtensionActionStore;
  resolveTenant(clientDomain: string): Promise<string>;
  findSpace(clientDomain: string, spaceKey: string): Promise<{
    macroCount: number;
    lastUpdated?: string;
  } | null>;
  hasRecentPaidRail(cloudId: string): Promise<boolean>;
  hasActiveSpaceLicense(cloudId: string, spaceKey: string): Promise<boolean>;
  applyLicense(grant: LicenseGrant): Promise<void>;
}

export interface ExtensionActionResult {
  outcome: 'applied' | 'already_applied';
  action: ExtensionAction;
  expiresAt: string;
  reply: string;
  macroCount: number;
  clientDomain: string;
  spaceKey: string;
}

export type ExtensionFailureStage =
  | 'request_validation'
  | 'tenant_resolution'
  | 'space_validation'
  | 'paid_status'
  | 'idempotency'
  | 'license_write'
  | 'license_verify';

export class ExtensionActionError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly stage: ExtensionFailureStage,
    public readonly retryable = false,
  ) {
    super(code);
    this.name = 'ExtensionActionError';
  }
}

interface ParsedRequest {
  clientDomain: string;
  spaceKey: string;
  userAccountId: string;
}

const REQUEST_TYPE_ID = '9';
const FREE_EXTENSION_PLAN_ID = '10037';
const METRICS_FRESHNESS_MS = 24 * 60 * 60 * 1000;
const PENDING_LEASE_MS = 2 * 60 * 1000;

function singleLabel(description: string, label: string): string {
  const prefix = `${label}:`;
  const matches = description
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length).trim());
  if (matches.length !== 1 || !matches[0]) {
    throw new ExtensionActionError(400, `invalid_${label.toLowerCase().replaceAll(' ', '_')}`, 'request_validation');
  }
  return matches[0];
}

function normalizeDomain(value: string): string {
  const normalized = value.toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
  const bare = normalized.endsWith('.atlassian.net')
    ? normalized.slice(0, -'.atlassian.net'.length)
    : normalized;
  if (!bare || bare.length > 180 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(bare)) {
    throw new ExtensionActionError(400, 'invalid_client_domain', 'request_validation');
  }
  return `${bare}.atlassian.net`;
}

function parseInitialRequest(description: string): ParsedRequest {
  if (!description || description.length > 20_000) {
    throw new ExtensionActionError(400, 'invalid_description', 'request_validation');
  }
  const clientDomain = normalizeDomain(singleLabel(description, 'Client domain'));
  const spaceKey = singleLabel(description, 'Space key');
  const userAccountId = singleLabel(description, 'User account ID');
  if (spaceKey.startsWith('unknown_') || spaceKey.length > 255 || !/^[A-Za-z0-9_-]+$/.test(spaceKey)) {
    throw new ExtensionActionError(400, 'invalid_space_key', 'request_validation');
  }
  if (
    userAccountId.startsWith('unknown_')
    || userAccountId.length > 255
    || !/^[A-Za-z0-9:_-]+$/.test(userAccountId)
  ) {
    throw new ExtensionActionError(400, 'invalid_user_account_id', 'request_validation');
  }
  return { clientDomain, spaceKey, userAccountId };
}

function validateCommand(command: ExtensionCommand): void {
  if (!/^ZEN-[1-9][0-9]*$/.test(command.ticketKey)) {
    throw new ExtensionActionError(400, 'invalid_ticket_key', 'request_validation');
  }
  if (command.requestTypeId !== REQUEST_TYPE_ID) {
    throw new ExtensionActionError(400, 'invalid_request_type', 'request_validation');
  }
  if (command.planOptionId !== FREE_EXTENSION_PLAN_ID) {
    throw new ExtensionActionError(400, 'invalid_plan_option', 'request_validation');
  }
}

function expiryFrom(now: Date, days: 7 | 15): string {
  const expiry = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days));
  return `${expiry.toISOString().slice(0, 10)}T23:59:59Z`;
}

function throughDate(expiresAt: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(expiresAt));
}

function initialReply(record: ExtensionActionRecord): string {
  return [
    'Hey,',
    '',
    'Thanks for reaching out — glad to see your team getting so much use out of ZenUML.',
    '',
    `To get you unblocked, we've enabled a temporary extension for your account on ${record.spaceKey} for the next 7 days (through ${throughDate(record.expiresAt)}). You can create and edit diagrams there as normal during this window. Just refresh the page if you already have an editor open; it can take a few minutes to apply.`,
    '',
    `This extension covers your account only — teammates in ${record.spaceKey} may still see the limit.`,
    '',
    'We are deciding what to build next, and candid input from a team using ZenUML this heavily is valuable to us. If you reply with answers to these four questions, we will extend your access to 15 days instead of 7:',
    '',
    `1. Which describes you: you administer ${record.spaceKey}, you create or edit diagrams there, you administer Confluence apps for your whole site, or something else?`,
    '',
    `2. If unlocking ${record.spaceKey} for a year were priced in USD per year, at what price would it be too cheap to trust, a bargain, getting expensive, and too expensive to consider (four numbers)?`,
    '',
    '3. Which way of paying fits your team best and which fits worst: per space per year, per Confluence user per month, per active diagram author, or per number of diagrams?',
    '',
    "4. If your team wanted to lift the limit permanently, what's the hard part internally: budget, admin approval, procurement, nobody owns it, or something else?",
    '',
    'Blunt answers are the useful ones — we will not take it badly.',
    '',
    'For a lasting fix, there are two routes:',
    '',
    `Per-space (Enterprise Bundle) — $299/space/year for unlimited macros and users in ${record.spaceKey}. It does not require a Confluence admin. Purchase here: https://buy.stripe.com/cNifZifkN7hzavK12H7IY05`,
    '',
    'Org-wide (Full plan) — removes the limit across all spaces and users. A Confluence app admin can upgrade here: https://marketplace.atlassian.com/apps/1218380/zenuml-sequence-diagram',
    '',
    'Either way, the 15 days is yours for the feedback — no strings attached to buying anything.',
    '',
    'Best Regards,',
    '',
    'Peng',
  ].join('\n');
}

function replyFor(record: ExtensionActionRecord): string {
  if (record.action === 'initial') return initialReply(record);
  return [
    'Hey,',
    '',
    `Thanks for the candid feedback. We have extended your account on ${record.spaceKey} through ${throughDate(record.expiresAt)}. Just refresh the page if you already have an editor open; it can take a few minutes to apply.`,
    '',
    'Best Regards,',
    '',
    'Peng',
  ].join('\n');
}

function resultFor(record: ExtensionActionRecord, outcome: ExtensionActionResult['outcome']): ExtensionActionResult {
  return {
    outcome,
    action: record.action,
    expiresAt: record.expiresAt,
    reply: replyFor(record),
    macroCount: record.macroCount,
    clientDomain: record.clientDomain,
    spaceKey: record.spaceKey,
  };
}

export async function executeExtensionAction(
  command: ExtensionCommand,
  runtime: ExtensionActionRuntime,
): Promise<ExtensionActionResult> {
  validateCommand(command);
  const existing = await runtime.actions.get(command.ticketKey, command.action);
  if (existing?.status === 'applied') {
    return resultFor(existing, 'already_applied');
  }
  const now = runtime.now();
  if (
    existing?.status === 'pending'
    && now.getTime() - new Date(existing.updatedAt).getTime() < PENDING_LEASE_MS
  ) {
    throw new ExtensionActionError(409, 'action_in_progress', 'idempotency', true);
  }
  const nowIso = now.toISOString();
  let record: ExtensionActionRecord;

  if (existing?.status === 'pending') {
    record = { ...existing, updatedAt: nowIso };
  } else if (command.action === 'feedback') {
    const initial = await runtime.actions.get(command.ticketKey, 'initial');
    if (initial?.status !== 'applied') {
      throw new ExtensionActionError(409, 'initial_action_required', 'idempotency');
    }
    record = {
      ...initial,
      action: 'feedback',
      status: 'pending',
      expiresAt: expiryFrom(now, 15),
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  } else {
    const parsed = parseInitialRequest(command.description);
    const cloudId = await runtime.resolveTenant(parsed.clientDomain);
    const metrics = await runtime.findSpace(parsed.clientDomain, parsed.spaceKey);
    if (!metrics || metrics.macroCount < 100) {
      throw new ExtensionActionError(409, 'space_not_over_limit', 'space_validation');
    }
    const metricsUpdatedAt = metrics.lastUpdated ? new Date(metrics.lastUpdated).getTime() : Number.NaN;
    if (
      !Number.isFinite(metricsUpdatedAt)
      || runtime.now().getTime() - metricsUpdatedAt > METRICS_FRESHNESS_MS
    ) {
      throw new ExtensionActionError(409, 'space_metrics_stale', 'space_validation');
    }
    if (await runtime.hasRecentPaidRail(cloudId)) {
      throw new ExtensionActionError(409, 'paid_rail_active', 'paid_status');
    }
    if (await runtime.hasActiveSpaceLicense(cloudId, parsed.spaceKey)) {
      throw new ExtensionActionError(409, 'space_license_active', 'paid_status');
    }
    record = {
      ticketKey: command.ticketKey,
      action: command.action,
      status: 'pending',
      clientDomain: parsed.clientDomain,
      cloudId,
      spaceKey: parsed.spaceKey,
      userAccountId: parsed.userAccountId,
      macroCount: metrics.macroCount,
      expiresAt: expiryFrom(now, 7),
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  }
  const acquired = await runtime.actions.acquire(record, existing?.updatedAt);
  if (!acquired) {
    const raced = await runtime.actions.get(command.ticketKey, command.action);
    if (raced?.status === 'applied') return resultFor(raced, 'already_applied');
    throw new ExtensionActionError(409, 'action_in_progress', 'idempotency', true);
  }
  await runtime.applyLicense({
    cloudId: record.cloudId,
    spaceKey: record.spaceKey,
    userAccountId: record.userAccountId,
    expiresAt: record.expiresAt,
    activatedBy: record.action === 'initial'
      ? `support:auto:temp-7d-extension:${record.ticketKey}`
      : `support:auto:feedback-15d-extension:${record.ticketKey}`,
  });
  await runtime.actions.markApplied(record.ticketKey, record.action, runtime.now().toISOString());
  return resultFor({ ...record, status: 'applied' }, 'applied');
}
