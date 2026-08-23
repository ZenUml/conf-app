export const PAYWALL_ADMIN_TEMPLATE_VERSION = 'active-adoption-v1';
export const PAYWALL_ADMIN_NOTIFICATION_MAX_ATTEMPTS = 3;

export type NotificationRoutingOutcome = 'automatic' | 'manual' | 'suppressed';
export type PaywallAdminNotificationState =
  | 'queued'
  | 'sending'
  | 'sent'
  | 'retry_pending'
  | 'delivered'
  | 'clicked'
  | 'failed'
  | 'manual'
  | 'suppressed';

export interface PaywallAdminNotificationRow {
  notificationId: string;
  requestId: string;
  grantId: string;
  cloudId: string;
  templateVersion: string;
  routingOutcome: NotificationRoutingOutcome;
  routingReasonCodes: string;
  state: PaywallAdminNotificationState;
  providerMessageId: string | null;
  attemptCount: number;
  maxAttempts: number;
  lastErrorCode: string | null;
  nextAttemptAt: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  clickedAt: string | null;
  failedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaywallAdminEmailContent {
  spaceKey: string;
  macroCount: number;
  requestedScope: 'self' | 'space' | 'site';
  urgency: 'today' | 'this_week' | 'planning_ahead';
  grantedAt: string;
  expiresAt: string;
  upgradeUrl: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function displayDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Paywall extension date is invalid');
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(date);
}

function displayScope(scope: PaywallAdminEmailContent['requestedScope']): string {
  return scope === 'self' ? 'the requester' : scope === 'space' ? 'this Space' : 'this site';
}

function displayUrgency(urgency: PaywallAdminEmailContent['urgency']): string {
  return urgency === 'today' ? 'today' : urgency === 'this_week' ? 'this week' : 'for upcoming work';
}

/**
 * Transactional copy deliberately contains only the operational need. It does
 * not accept the audience, AI, policy, template, or other research answers, so
 * callers cannot accidentally expose them in an administrator notification.
 */
export function renderPaywallAdminAdoptionEmail(content: PaywallAdminEmailContent): RenderedEmail {
  if (!Number.isInteger(content.macroCount) || content.macroCount <= 100) {
    throw new Error('Paywall notification macro count is invalid');
  }
  const upgradeUrl = new URL(content.upgradeUrl);
  if (upgradeUrl.protocol !== 'https:') throw new Error('Paywall notification upgrade URL must use HTTPS');
  const space = escapeHtml(content.spaceKey);
  const scope = displayScope(content.requestedScope);
  const urgency = displayUrgency(content.urgency);
  const granted = displayDate(content.grantedAt);
  const expires = displayDate(content.expiresAt);
  const subject = `ZenUML adoption in Space ${content.spaceKey}`;
  const text = [
    `Your team is actively using ZenUML in Space ${content.spaceKey}.`,
    '',
    `The Space now contains approximately ${content.macroCount} ZenUML macros. A team member needed to continue editing ${urgency} and requested access for ${scope}.`,
    `We granted a 7-day temporary extension from ${granted} to ${expires}, so their work can continue while your organisation evaluates the next step.`,
    '',
    'The ZenUML Enterprise Bundle is USD 299/year/Space.',
    `Review the upgrade path: ${content.upgradeUrl}`,
    '',
    'Reply to this email if you would like help assessing the right scope.',
  ].join('\n');
  const html = `<!doctype html>
<html lang="en"><body style="margin:0;background:#f4f5f7;color:#172b4d;font-family:Arial,sans-serif">
  <div style="max-width:640px;margin:0 auto;padding:32px 20px">
    <div style="background:#ffffff;border-radius:12px;padding:32px;border:1px solid #dfe1e6">
      <p style="margin:0 0 8px;color:#0052cc;font-weight:700">ZenUML for Confluence</p>
      <h1 style="font-size:24px;line-height:1.3;margin:0 0 20px">Your team is actively using ZenUML</h1>
      <p>Space <strong>${space}</strong> now contains approximately <strong>${content.macroCount} ZenUML macros</strong>.</p>
      <p>A team member needed to continue editing ${escapeHtml(urgency)} and requested access for ${escapeHtml(scope)}.</p>
      <div style="margin:24px 0;padding:16px;border-left:4px solid #36b37e;background:#e3fcef">
        We granted a <strong>7-day temporary extension</strong> from ${granted} to ${expires}, so work can continue while your organisation evaluates the next step.
      </div>
      <p>The ZenUML Enterprise Bundle is <strong>USD 299/year/Space</strong>.</p>
      <p style="margin:24px 0"><a href="${escapeHtml(upgradeUrl.toString())}" style="display:inline-block;background:#0052cc;color:#fff;text-decoration:none;padding:12px 18px;border-radius:6px;font-weight:700">Review the upgrade path</a></p>
      <p style="color:#5e6c84;font-size:14px">Reply to this email if you would like help assessing the right scope.</p>
    </div>
  </div>
</body></html>`;
  return { subject, html, text };
}

export class ResendDispatchError extends Error {
  constructor(public readonly code: string, public readonly retryable: boolean) {
    super(code);
    this.name = 'ResendDispatchError';
  }
}

interface SendResendEmailOptions {
  apiKey: string;
  from: string;
  replyTo: string;
  recipient: string;
  notificationId: string;
  email: RenderedEmail;
  fetchImpl?: typeof fetch;
}

function requiredEmailConfiguration(value: string): boolean {
  return value.trim().length > 0 && value.includes('@');
}

export async function sendResendEmail(options: SendResendEmailOptions): Promise<{ providerMessageId: string }> {
  if (
    !options.apiKey.trim()
    || !requiredEmailConfiguration(options.from)
    || !requiredEmailConfiguration(options.replyTo)
    || !requiredEmailConfiguration(options.recipient)
    || !options.notificationId.trim()
  ) {
    throw new ResendDispatchError('resend_configuration_missing', false);
  }
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': options.notificationId,
      },
      body: JSON.stringify({
        from: options.from,
        to: [options.recipient],
        reply_to: options.replyTo,
        subject: options.email.subject,
        html: options.email.html,
        text: options.email.text,
      }),
    });
  } catch {
    throw new ResendDispatchError('resend_network_error', true);
  }
  if (!response.ok) {
    throw new ResendDispatchError(`resend_http_${response.status}`, response.status === 429 || response.status >= 500);
  }
  let providerMessageId: unknown;
  try {
    providerMessageId = (await response.json() as { id?: unknown }).id;
  } catch {
    throw new ResendDispatchError('resend_response_invalid', true);
  }
  if (typeof providerMessageId !== 'string' || !providerMessageId.trim()) {
    throw new ResendDispatchError('resend_response_invalid', true);
  }
  return { providerMessageId };
}

interface CreateNotificationInput {
  requestId: string;
  grantId: string;
  cloudId: string;
  route: { routingOutcome: NotificationRoutingOutcome; reasonCodes: string[] };
}

interface CreateNotificationDependencies {
  now?: Date;
  randomUUID?: () => string;
}

function initialState(route: NotificationRoutingOutcome): PaywallAdminNotificationState {
  return route === 'automatic' ? 'queued' : route === 'manual' ? 'manual' : 'suppressed';
}

async function getNotification(db: D1Database, notificationId: string): Promise<PaywallAdminNotificationRow> {
  const row = await db.prepare(
    'SELECT * FROM PaywallAdminNotification WHERE notificationId = ?1 LIMIT 1',
  ).bind(notificationId).first<PaywallAdminNotificationRow>();
  if (!row) throw new Error('Paywall administrator notification was not persisted');
  return row;
}

export async function createPaywallAdminNotification(
  db: D1Database,
  input: CreateNotificationInput,
  dependencies: CreateNotificationDependencies = {},
): Promise<PaywallAdminNotificationRow> {
  const now = (dependencies.now ?? new Date()).toISOString();
  const notificationId = (dependencies.randomUUID ?? (() => crypto.randomUUID()))();
  await db.prepare(
    `INSERT OR IGNORE INTO PaywallAdminNotification (
       notificationId, requestId, grantId, cloudId, templateVersion,
       routingOutcome, routingReasonCodes, state, maxAttempts, createdAt, updatedAt
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)`,
  ).bind(
    notificationId, input.requestId, input.grantId, input.cloudId,
    PAYWALL_ADMIN_TEMPLATE_VERSION, input.route.routingOutcome,
    JSON.stringify(input.route.reasonCodes), initialState(input.route.routingOutcome),
    PAYWALL_ADMIN_NOTIFICATION_MAX_ATTEMPTS, now,
  ).run();
  const row = await db.prepare(
    'SELECT * FROM PaywallAdminNotification WHERE grantId = ?1 AND templateVersion = ?2 LIMIT 1',
  ).bind(input.grantId, PAYWALL_ADMIN_TEMPLATE_VERSION).first<PaywallAdminNotificationRow>();
  if (!row) throw new Error('Paywall administrator notification was not persisted');
  return row;
}

interface DispatchOptions {
  apiKey: string;
  from: string;
  replyTo: string;
  recipient: string;
  content: PaywallAdminEmailContent;
  fetchImpl?: typeof fetch;
  now?: Date;
}

const RETRY_DELAYS_MS = [5 * 60 * 1000, 30 * 60 * 1000];

export async function dispatchPaywallAdminNotification(
  db: D1Database,
  notification: PaywallAdminNotificationRow,
  options: DispatchOptions,
): Promise<PaywallAdminNotificationRow> {
  if (notification.routingOutcome !== 'automatic' || !['queued', 'retry_pending'].includes(notification.state)) {
    return notification;
  }
  const now = options.now ?? new Date();
  const claimResult = await db.prepare(
    `UPDATE PaywallAdminNotification
        SET state = 'sending', attemptCount = attemptCount + 1, updatedAt = ?1
      WHERE notificationId = ?2
        AND state IN ('queued', 'retry_pending')
        AND attemptCount < maxAttempts
        AND (nextAttemptAt IS NULL OR nextAttemptAt <= ?1)`,
  ).bind(now.toISOString(), notification.notificationId).run();
  if ((claimResult.meta?.changes ?? 0) === 0) {
    return getNotification(db, notification.notificationId);
  }
  const claimed = await getNotification(db, notification.notificationId);
  if (claimed.state !== 'sending') return claimed;

  try {
    const result = await sendResendEmail({
      apiKey: options.apiKey,
      from: options.from,
      replyTo: options.replyTo,
      recipient: options.recipient,
      notificationId: claimed.notificationId,
      email: renderPaywallAdminAdoptionEmail(options.content),
      fetchImpl: options.fetchImpl,
    });
    await db.prepare(
      `UPDATE PaywallAdminNotification
          SET state = 'sent', providerMessageId = ?1, sentAt = ?2,
              lastErrorCode = NULL, nextAttemptAt = NULL, updatedAt = ?2
        WHERE notificationId = ?3 AND state = 'sending'`,
    ).bind(result.providerMessageId, now.toISOString(), claimed.notificationId).run();
  } catch (error) {
    const dispatchError = error instanceof ResendDispatchError
      ? error
      : new ResendDispatchError('resend_unknown_error', true);
    const canRetry = dispatchError.retryable && claimed.attemptCount < claimed.maxAttempts;
    const state: PaywallAdminNotificationState = canRetry ? 'retry_pending' : 'failed';
    const delay = RETRY_DELAYS_MS[Math.min(Math.max(claimed.attemptCount - 1, 0), RETRY_DELAYS_MS.length - 1)];
    const nextAttemptAt = canRetry ? new Date(now.getTime() + delay).toISOString() : null;
    await db.prepare(
      `UPDATE PaywallAdminNotification
          SET state = ?1, lastErrorCode = ?2, nextAttemptAt = ?3,
              failedAt = ?4, updatedAt = ?5
        WHERE notificationId = ?6 AND state = 'sending'`,
    ).bind(
      state, dispatchError.code, nextAttemptAt, canRetry ? null : now.toISOString(),
      now.toISOString(), claimed.notificationId,
    ).run();
  }
  return getNotification(db, notification.notificationId);
}
