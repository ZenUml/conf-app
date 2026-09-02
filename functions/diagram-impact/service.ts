import type { ForgeRequestData } from '../utils/authenticate';
import { captureError } from '../utils/sentry';
import {
  classifyViewerRelation,
  type RegistrationResult,
  type ViewerRelation,
} from './domain';
import {
  countAudience,
  isHistoricalContributor,
  registerAudienceView,
  type DiagramAudienceScope,
} from './repository';

export interface DiagramImpactEnv {
  DB?: D1Database;
}

export class DiagramImpactRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
  }
}

interface ConfluenceCustomContent {
  id?: string | number;
  authorId?: unknown;
  version?: { authorId?: unknown };
}

interface ResolvedImpactRequest {
  db: D1Database;
  scope: DiagramAudienceScope;
  accountId: string;
  createdByAccountId?: string;
  updatedByAccountId?: string;
}

function requiredString(value: unknown, status: number, code: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new DiagramImpactRequestError(status, code);
  return value.trim();
}

function validateContentId(value: unknown): string {
  const contentId = requiredString(value, 400, 'invalid_content_id');
  if (contentId.length > 512) throw new DiagramImpactRequestError(400, 'invalid_content_id');
  return contentId;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

async function fetchReadableContent(
  apiBaseUrl: string,
  contentId: string,
  forgeOAuthUser: string,
): Promise<ConfluenceCustomContent> {
  const response = await fetch(
    `${apiBaseUrl}/api/v2/custom-content/${encodeURIComponent(contentId)}?body-format=raw`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${forgeOAuthUser}`,
      },
    },
  );
  if (!response.ok) {
    const status = response.status === 401 || response.status === 403 || response.status === 404
      ? response.status
      : 502;
    throw new DiagramImpactRequestError(status, 'content_unavailable');
  }
  let content: ConfluenceCustomContent;
  try {
    content = await response.json() as ConfluenceCustomContent;
  } catch {
    throw new DiagramImpactRequestError(502, 'content_unavailable');
  }
  if (String(content?.id ?? '') !== contentId) {
    throw new DiagramImpactRequestError(404, 'content_unavailable');
  }
  return content;
}

async function resolveImpactRequest(input: {
  env: DiagramImpactEnv;
  data: ForgeRequestData;
  forgeOAuthUser: string | null | undefined;
  customContentId: unknown;
}): Promise<ResolvedImpactRequest> {
  const { forgeContext } = input.data;
  const cloudId = requiredString(forgeContext?.cloudId, 401, 'missing_principal');
  const forgeAppId = requiredString(forgeContext?.forgeAppId, 401, 'missing_principal');
  const accountId = requiredString(forgeContext?.accountId, 401, 'missing_principal');
  const apiBaseUrl = requiredString(forgeContext?.apiBaseUrl, 401, 'missing_principal');
  const forgeOAuthUser = requiredString(input.forgeOAuthUser, 400, 'missing_user_token');
  const customContentId = validateContentId(input.customContentId);
  if (!input.env.DB) throw new DiagramImpactRequestError(503, 'impact_unavailable');

  const content = await fetchReadableContent(apiBaseUrl, customContentId, forgeOAuthUser);
  return {
    db: input.env.DB,
    scope: { cloudId, forgeAppId, customContentId },
    accountId,
    createdByAccountId: optionalString(content.authorId),
    updatedByAccountId: optionalString(content.version?.authorId),
  };
}

async function relationFor(
  resolved: ResolvedImpactRequest,
): Promise<ViewerRelation> {
  const historical = await isHistoricalContributor(resolved.db, {
    ...resolved.scope,
    accountId: resolved.accountId,
  });
  return classifyViewerRelation({
    accountId: resolved.accountId,
    createdByAccountId: resolved.createdByAccountId,
    updatedByAccountId: resolved.updatedByAccountId,
    isHistoricalContributor: historical,
  });
}

export interface DiagramImpactSummary {
  audienceCount: number;
  viewerRelation: ViewerRelation;
}

export async function getDiagramImpactSummary(input: {
  env: DiagramImpactEnv;
  data: ForgeRequestData;
  forgeOAuthUser: string | null | undefined;
  customContentId: unknown;
}): Promise<DiagramImpactSummary> {
  const resolved = await resolveImpactRequest(input);
  const [audienceCount, viewerRelation] = await Promise.all([
    countAudience(resolved.db, resolved.scope),
    relationFor(resolved),
  ]);
  return { audienceCount, viewerRelation };
}

export interface DiagramImpactRegistration {
  result: RegistrationResult;
  audienceCount: number;
}

export async function registerDiagramImpactView(input: {
  env: DiagramImpactEnv;
  data: ForgeRequestData;
  forgeOAuthUser: string | null | undefined;
  customContentId: unknown;
  now?: Date;
}): Promise<DiagramImpactRegistration> {
  const resolved = await resolveImpactRequest(input);
  const viewerRelation = await relationFor(resolved);
  if (viewerRelation !== 'viewer') {
    return {
      result: 'excluded_contributor',
      audienceCount: await countAudience(resolved.db, resolved.scope),
    };
  }

  // The write is the derived half of this request. A schema drift, a D1
  // outage, or a constraint change must not turn a page view into a 500 — the
  // reader has done nothing wrong and the client can do nothing about it. The
  // count read below is the half the response body is actually for, so that
  // one is left to fail loudly if it fails at all.
  let result: RegistrationResult;
  try {
    result = await registerAudienceView(resolved.db, {
      ...resolved.scope,
      accountId: resolved.accountId,
      now: input.now ?? new Date(),
    });
  } catch (error) {
    captureError(error);
    result = 'write_failed';
  }
  return { result, audienceCount: await countAudience(resolved.db, resolved.scope) };
}
