import { normalizeClientDomain } from '../metrics-cache/snapshot/common';
import { getAtlassianInstanceClientDomain, getForgeInstallationClientDomain } from '../utils/dbUtils';
import { validEmail, validSender } from './fullscreenRecoveryMail';

/**
 * Internal "a request arrived" email for the support mailbox. It carries no requester email and no note
 * text: both are stored encrypted on purpose and are read only through the support CLI.
 */
export interface RequestNotification {
  requestId: string;
  cloudId: string;
  spaceKey: string;
  scenarios: readonly string[];
  hasNote: boolean;
  createdAt: string;
  /** Verified FIT app id; with `cloudId` it keys the server-side site name lookup. Never from the request body. */
  forgeAppId?: string;
  /** Client domain of the site, e.g. `example-site`. Set by the sender, not by callers. */
  siteName?: string | null;
}

export interface NotifyEnv {
  DB?: D1Database;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  RESEND_REPLY_TO?: string;
  FULLSCREEN_RECOVERY_NOTIFY_TO?: string;
}

export const SUPPORT_LIST_COMMAND = 'node scripts/fullscreen-recovery-support.mjs list';

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function utc(iso: string): string {
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? `${date.toISOString().slice(0, 19).replace('T', ' ')} UTC` : 'unknown';
}

export function renderRequestNotification(input: RequestNotification): { subject: string; text: string; html: string } {
  // Only named fields are read, so an unexpected extra property can never reach the mail.
  const lines = [
    'A Fullscreen recovery request was submitted.',
    ...(input.siteName ? [`Site: ${input.siteName}`] : []),
    `Site (cloudId): ${input.cloudId}`,
    `Space key: ${input.spaceKey}`,
    `Request id: ${input.requestId}`,
    `Scenarios: ${input.scenarios.join(', ')}`,
    `Note: ${input.hasNote ? 'yes' : 'no'}`,
    `Created: ${utc(input.createdAt)}`,
    `Read the contact and note in the support workspace: ${SUPPORT_LIST_COMMAND}`,
  ];
  return {
    subject: `Fullscreen recovery request — ${input.siteName || input.cloudId} / ${input.spaceKey} (${input.requestId.slice(0, 8)})`,
    text: lines.join('\n'),
    html: `<!doctype html><html lang="en"><body>${lines.map(line => `<p>${escapeHtml(line)}</p>`).join('')}</body></html>`,
  };
}

const SITE_NAME = /^[a-z0-9][a-z0-9-]{0,126}$/;

/**
 * Best-effort, trusted lookup: the same chain the Fullscreen eligibility check uses to turn the verified
 * FIT cloudId into the client domain (AtlassianInstance, then ForgeInstallation). A missing binding or row
 * gives null silently; a thrown query gives null and one warning with a reason code only.
 */
async function lookupSiteName(env: NotifyEnv, input: RequestNotification): Promise<string | null> {
  if (!env.DB) return null;
  try {
    const raw = await getAtlassianInstanceClientDomain(env.DB, input.cloudId)
      || (input.forgeAppId
        ? await getForgeInstallationClientDomain(env.DB, `ari:cloud:ecosystem::app/${input.forgeAppId}`, input.cloudId)
          || await getForgeInstallationClientDomain(env.DB, input.forgeAppId, input.cloudId)
        : null);
    const name = raw ? normalizeClientDomain(raw) : '';
    return SITE_NAME.test(name) ? name : null;
  } catch {
    console.warn('[fullscreen-recovery] request notification site lookup failed', { reason: 'site_lookup_failed' });
    return null;
  }
}

/**
 * Never throws. A mail failure must not change the customer's response; each failure logs one
 * warning with a reason code only.
 */
export async function notifyFullscreenRecoveryRequest(
  env: NotifyEnv, input: RequestNotification, fetchImpl: typeof fetch = fetch,
): Promise<void> {
  try {
    const recipient = env.FULLSCREEN_RECOVERY_NOTIFY_TO || env.RESEND_REPLY_TO;
    if (!env.RESEND_API_KEY || !validSender(env.RESEND_FROM) || !validEmail(recipient)) {
      console.warn('[fullscreen-recovery] request notification skipped', { reason: 'mail_configuration_missing' });
      return;
    }
    const mail = renderRequestNotification({ ...input, siteName: await lookupSiteName(env, input) });
    const response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json',
        // A retry of the same request id inside Resend's 24-hour window cannot send a second mail.
        'Idempotency-Key': `fullscreen-recovery-notify:${input.requestId}`,
      },
      body: JSON.stringify({ from: env.RESEND_FROM, to: [recipient], subject: mail.subject, text: mail.text, html: mail.html }),
    });
    if (!response.ok) {
      console.warn('[fullscreen-recovery] request notification failed', { reason: `resend_http_${response.status}` });
    }
  } catch {
    console.warn('[fullscreen-recovery] request notification failed', { reason: 'resend_network_error' });
  }
}
