import type { D1Database } from '@cloudflare/workers-types';

import type { ForgeRequestContext, ForgeRequestData } from '../utils/authenticate';
import { getAtlassianInstanceClientDomain } from '../utils/dbUtils';

type FeedbackSurface = 'viewer' | 'editor' | 'fullscreen' | 'png_export' | 'get_started' | 'dashboard';

interface FeedbackContextInput {
  surface: FeedbackSurface;
  hostModule: string;
  diagramType: string;
  diagramTitle: string;
  userAccountId?: string;
  clientDomain?: string;
  spaceName: string;
  macroUuid: string;
  contentId: string;
  customContentId: string;
}

interface FeedbackReportInput {
  submissionId: string;
  description: string;
  context: FeedbackContextInput;
  // Accepted for forward compatibility, but deliberately not stored yet.
  screenshot?: unknown;
}

interface Env {
  DB: D1Database;
}

const FEEDBACK_SURFACES = new Set<FeedbackSurface>(['viewer', 'editor', 'fullscreen', 'png_export', 'get_started', 'dashboard']);
const SUBMISSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function boundedString(value: unknown, max: number, allowEmpty = false): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!allowEmpty && !normalized) return null;
  if (normalized.length > max) return null;
  return normalized;
}

function parseInput(value: unknown): FeedbackReportInput | null {
  if (!value || typeof value !== 'object') return null;
  const body = value as Partial<FeedbackReportInput>;
  const context = body.context;
  if (!context || typeof context !== 'object') return null;
  if (!SUBMISSION_ID_PATTERN.test(body.submissionId ?? '')) return null;
  if (!FEEDBACK_SURFACES.has(context.surface as FeedbackSurface)) return null;

  const description = typeof body.description === 'string'
    && body.description.length <= 10_000
    && body.description.trim().length > 0
    ? body.description
    : null;
  const hostModule = boundedString(context.hostModule, 200);
  const diagramType = boundedString(context.diagramType, 100);
  const diagramTitle = boundedString(context.diagramTitle, 500, true);
  const spaceName = boundedString(context.spaceName, 500);
  const macroUuid = boundedString(context.macroUuid, 200);
  const contentId = boundedString(context.contentId, 200);
  const customContentId = boundedString(context.customContentId, 200);
  if (!description || !hostModule || !diagramType || diagramTitle === null || !spaceName || !macroUuid || !contentId || !customContentId) return null;

  return {
    submissionId: body.submissionId!,
    description,
    context: {
      surface: context.surface as FeedbackSurface,
      hostModule,
      diagramType,
      diagramTitle,
      spaceName,
      macroUuid,
      contentId,
      customContentId,
    },
    screenshot: body.screenshot,
  };
}

function verifiedAccountId(fit: ForgeRequestContext): string | null {
  return typeof fit.accountId === 'string' && fit.accountId.trim() ? fit.accountId.trim() : null;
}

async function reportReferenceFor(fit: ForgeRequestContext, accountId: string, submissionId: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${fit.installationId}:${accountId}:${submissionId}`);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  const chars = Array.from(new Uint8Array(hash).slice(0, 8), (byte) => byte.toString(36).padStart(2, '0'))
    .join('')
    .toUpperCase()
    .slice(0, 12);
  return `FBR-${chars}`;
}

export const onRequestPost: PagesFunction<Env, string, ForgeRequestData> = async ({ request, env, data }) => {
  const fit = data.forgeContext;
  const accountId = fit ? verifiedAccountId(fit) : null;
  if (!fit || !accountId || !fit.cloudId || !fit.forgeAppId || !fit.installationId) {
    return json(401, { ok: false, error: 'unauthorized' });
  }
  if (!env.DB) return json(503, { ok: false, error: 'server_configuration' });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json(400, { ok: false, error: 'invalid_json' });
  }
  const input = parseInput(raw);
  if (!input) return json(400, { ok: false, error: 'invalid_report' });

  const clientDomain = await getAtlassianInstanceClientDomain(env.DB, fit.cloudId);
  const reportReference = await reportReferenceFor(fit, accountId, input.submissionId);

  try {
    await env.DB.prepare(`
      INSERT OR IGNORE INTO FeedbackReport (
        reportReference, submissionId, installationId, cloudId, forgeAppId,
        accountId, clientDomain, description, surface,
        hostModule, diagramType, diagramTitle, spaceName, macroUuid, contentId, customContentId
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
    `).bind(
      reportReference,
      input.submissionId,
      fit.installationId,
      fit.cloudId,
      fit.forgeAppId,
      accountId,
      clientDomain || 'unavailable',
      input.description,
      input.context.surface,
      input.context.hostModule,
      input.context.diagramType,
      input.context.diagramTitle,
      input.context.spaceName,
      input.context.macroUuid,
      input.context.contentId,
      input.context.customContentId,
    ).run();
  } catch (error) {
    // Do not log the report body or upstream database error: both may contain
    // customer content. The caller receives a stable retryable failure.
    return json(503, { ok: false, error: 'storage_unavailable', retryable: true });
  }

  return json(201, {
    ok: true,
    reportReference,
    artifacts: {
      screenshot: 'not_retained',
      diagramSource: 'not_retained',
    },
  });
};
