import type { D1Database, R2Bucket } from '@cloudflare/workers-types';

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
  FEEDBACK_ATTACHMENT_BUCKET?: R2Bucket;
}

const FEEDBACK_SURFACES = new Set<FeedbackSurface>(['viewer', 'editor', 'fullscreen', 'png_export', 'get_started', 'dashboard']);
const SUBMISSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SCREENSHOT_PATTERN = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/;
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const SCREENSHOT_RETENTION_DAYS = 30;

interface ParsedScreenshot {
  bytes: Uint8Array;
  contentType: string;
}

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

function parseScreenshot(value: unknown): ParsedScreenshot | null {
  if (!value || typeof value !== 'object') return null;
  const screenshot = value as { dataUrl?: unknown; method?: unknown };
  if (screenshot.method !== 'current_view' && screenshot.method !== 'upload') return null;
  if (typeof screenshot.dataUrl !== 'string') return null;
  const match = screenshot.dataUrl.match(SCREENSHOT_PATTERN);
  if (!match) return null;
  try {
    const binary = atob(match[2]);
    if (!binary.length || binary.length > MAX_SCREENSHOT_BYTES) return null;
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const contentType = match[1];
    const isPng = contentType === 'image/png'
      && bytes.length >= 8
      && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte);
    const isJpeg = contentType === 'image/jpeg'
      && bytes.length >= 3
      && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const isWebp = contentType === 'image/webp'
      && bytes.length >= 12
      && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
      && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
    if (!isPng && !isJpeg && !isWebp) return null;
    return { bytes, contentType };
  } catch {
    return null;
  }
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

  const screenshot = input.screenshot === undefined ? undefined : parseScreenshot(input.screenshot);
  if (input.screenshot !== undefined && !screenshot) {
    return json(400, { ok: false, error: 'invalid_screenshot' });
  }
  if (screenshot && !env.FEEDBACK_ATTACHMENT_BUCKET) {
    return json(503, { ok: false, error: 'attachment_storage_unavailable', retryable: true });
  }

  const clientDomain = await getAtlassianInstanceClientDomain(env.DB, fit.cloudId);
  const reportReference = await reportReferenceFor(fit, accountId, input.submissionId);
  const screenshotObjectKey = screenshot ? `feedback/${reportReference}/image` : null;
  const screenshotExpiresAt = screenshot
    ? new Date(Date.now() + SCREENSHOT_RETENTION_DAYS * 86_400_000).toISOString()
    : null;

  try {
    if (screenshot && screenshotObjectKey && screenshotExpiresAt) {
      await env.FEEDBACK_ATTACHMENT_BUCKET!.put(screenshotObjectKey, screenshot.bytes, {
        httpMetadata: { contentType: screenshot.contentType },
        customMetadata: {
          reportReference,
          expiresAt: screenshotExpiresAt,
        },
      });
    }
    await env.DB.prepare(`
      INSERT OR IGNORE INTO FeedbackReport (
        reportReference, submissionId, installationId, cloudId, forgeAppId,
        accountId, clientDomain, description, surface,
        hostModule, diagramType, diagramTitle, spaceName, macroUuid, contentId, customContentId,
        screenshotObjectKey, screenshotContentType, screenshotExpiresAt
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)
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
      screenshotObjectKey,
      screenshot?.contentType ?? null,
      screenshotExpiresAt,
    ).run();
  } catch (error) {
    // Do not log the report body or upstream database error: both may contain
    // customer content. The caller receives a stable retryable failure.
    if (screenshotObjectKey && env.FEEDBACK_ATTACHMENT_BUCKET) {
      try { await env.FEEDBACK_ATTACHMENT_BUCKET.delete(screenshotObjectKey); } catch { /* expiry remains a safety net */ }
    }
    return json(503, { ok: false, error: 'storage_unavailable', retryable: true });
  }

  return json(201, {
    ok: true,
    reportReference,
    artifacts: {
      screenshot: screenshot ? 'retained_30_days' : 'not_provided',
    },
  });
};
