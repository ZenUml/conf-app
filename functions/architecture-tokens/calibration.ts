import {
  HttpError,
  authenticateMetricsRequest,
  errorResponse,
  jsonResponse,
  sha256Hex,
  type AuthenticatedMetricsContext,
  type SnapshotEnv,
} from '../metrics-cache/snapshot/common';
import type { ForgeRequestData } from '../utils/authenticate';
import { mixpanelImportServiceEvents } from '../service/mixpanelService';

export const PILOT_TENANT_ALIAS = 'example-tenant';
export const CALIBRATION_SAMPLE_SIZE = 10;
// “Spark” is the Codex-app tier name. The supported server-side API model id
// is gpt-5.3-codex (OpenAI model docs, verified 2026-08-27).
export const EXTRACTOR_MODEL = 'gpt-5.3-codex';
export const EXTRACTOR_PROMPT_VERSION = 'architecture-token-mvp0-v1';

export type CandidateType = 'service' | 'api' | 'external-service';
export type CandidateStatus = 'accepted' | 'rejected' | 'abstained';
export type Confidence = 'high' | 'medium' | 'low';
export type SourceStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'partial';

export interface ArchitectureTokenEnv extends SnapshotEnv {
  ARCHITECTURE_TOKEN_PILOT_CLOUD_ID?: string;
  ARCHITECTURE_TOKEN_PILOT_FORGE_APP_ID?: string;
  ARCHITECTURE_TOKEN_OPENAI_API_KEY?: string;
  ARCHITECTURE_TOKEN_CALIBRATION_EXECUTE_ENABLED?: string;
  ARCHITECTURE_TOKEN_CALIBRATION_WRITE_ENABLED?: string;
  /** Protected D1 scope for the internal OpenRouter pilot only. */
  ARCHITECTURE_TOKEN_PILOT_SPACE_ID?: string;
  /** A second, model-specific gate before customer source is sent to OpenRouter. */
  ARCHITECTURE_TOKEN_OPENROUTER_EXECUTE_ENABLED?: string;
  OPENROUTER_API_KEY?: string;
  /** Protected ten-source human-review manifest; never accepted over HTTP. */
  ARCHITECTURE_TOKEN_OPENROUTER_CALIBRATION_MANIFEST?: string;
}

export interface CalibrationSourceInput {
  sourceId: string;
  sourceRevision: number;
  /** The Confluence `body.raw.value` string, passed only by a backend FIT. */
  rawValue: string;
}

export interface EligibleSource extends CalibrationSourceInput {
  mermaidCode: string;
  sourceHash: string;
}

export interface ExtractedCandidate {
  label: string;
  type: CandidateType;
  observedRole: string;
  evidenceSnippet: string;
  confidence: Confidence;
  status: CandidateStatus;
}

export interface Extractor {
  extract(source: EligibleSource): Promise<unknown>;
}

export interface SourceResult {
  source: EligibleSource;
  status: SourceStatus;
  failureStage: 'extraction' | 'validation' | null;
  candidates: ExtractedCandidate[];
}

export interface CalibrationResult {
  runId: string;
  dryRun: boolean;
  status: SourceStatus;
  extractorModel: string;
  extractorPromptVersion: string;
  sourceResults: SourceResult[];
  acceptedCount: number;
  rejectedCount: number;
  abstainedCount: number;
}

const SOURCE_ID_RE = /^[A-Za-z0-9._:-]{1,200}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CANDIDATE_TYPES = new Set<CandidateType>(['service', 'api', 'external-service']);
const CANDIDATE_STATUSES = new Set<CandidateStatus>(['accepted', 'rejected', 'abstained']);
const CONFIDENCES = new Set<Confidence>(['high', 'medium', 'low']);

export const EXTRACTION_SYSTEM_PROMPT = `You extract conservative Architecture Token candidates from Mermaid sequence diagrams.
Return JSON only: {"candidates":[{"label":"...","type":"service|api|external-service","observedRole":"one sentence","evidenceSnippet":"one source line","confidence":"high|medium|low","status":"accepted|rejected|abstained"}]}.
Emit a candidate only when it is an explicitly declared \`participant\`, not an \`actor\`, and the source explicitly represents it as a Service, API, or external service. Exclude people, actors, clients, UIs, workflow steps, data stores, databases, generic modules, inferred entities, and merges. If uncertain, emit no candidate. Labels must exactly match the declared participant identifier or label. Evidence must be a literal source line. Do not infer.`;

/** Guarded handling of Mermaid %% preamble lines before the first directive. */
export function isMermaidSequenceSource(code: string): boolean {
  let remaining = code.trimStart();
  while (remaining.startsWith('%%')) {
    const newline = remaining.indexOf('\n');
    if (newline < 0) return false;
    // Only skip a complete, leading Mermaid preamble line. Do not search for
    // comments later in the document: that could mask an invalid directive.
    remaining = remaining.slice(newline + 1).trimStart();
  }
  return /^sequenceDiagram(?:\s|$)/.test(remaining);
}

function stringField(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= max ? normalized : null;
}

function parseEligibleSource(value: unknown): Omit<EligibleSource, 'sourceHash'> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'Invalid calibration source');
  }
  const source = value as Record<string, unknown>;
  const sourceId = stringField(source.sourceId, 200);
  const sourceRevision = source.sourceRevision;
  const rawValue = source.rawValue;
  if (!sourceId || !SOURCE_ID_RE.test(sourceId) || !Number.isSafeInteger(sourceRevision) || sourceRevision < 1) {
    throw new HttpError(400, 'Invalid calibration source identity');
  }
  if (typeof rawValue !== 'string' || rawValue.length === 0 || rawValue.length > 250_000) {
    throw new HttpError(400, 'Calibration source body is invalid');
  }
  let diagram: Record<string, unknown>;
  try {
    diagram = JSON.parse(rawValue) as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'Calibration source body is invalid');
  }
  const diagramType = stringField(diagram.diagramType, 40);
  const mermaidCode = typeof diagram.mermaidCode === 'string' ? diagram.mermaidCode : '';
  if (diagramType?.toLowerCase() !== 'mermaid' || !mermaidCode.trim() || !isMermaidSequenceSource(mermaidCode)) {
    throw new HttpError(400, 'Calibration source is not an active Mermaid sequence diagram');
  }
  return { sourceId, sourceRevision, rawValue, mermaidCode };
}

export async function selectCalibrationSources(value: unknown): Promise<EligibleSource[]> {
  if (!Array.isArray(value) || value.length !== CALIBRATION_SAMPLE_SIZE) {
    throw new HttpError(400, `Calibration requires exactly ${CALIBRATION_SAMPLE_SIZE} sources`);
  }
  return selectPilotSources(value);
}

/**
 * Internal-only source normalization for the gated pilot runner. Its caller
 * obtains scope from protected runtime configuration, never from a request.
 */
export async function selectPilotSources(value: unknown): Promise<EligibleSource[]> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpError(400, 'Pilot requires at least one source');
  }
  const ids = new Set<string>();
  const sources: EligibleSource[] = [];
  for (const item of value) {
    const source = parseEligibleSource(item);
    if (ids.has(source.sourceId)) throw new HttpError(400, 'Calibration sources must be distinct');
    ids.add(source.sourceId);
    sources.push({ ...source, sourceHash: await sha256Hex(source.rawValue) });
  }
  return sources.sort((a, b) => a.sourceId.localeCompare(b.sourceId) || a.sourceRevision - b.sourceRevision);
}

function participantLabels(code: string): Set<string> {
  const labels = new Set<string>();
  for (const line of code.split(/\r?\n/)) {
    const match = /^\s*participant\s+([^\s]+)(?:\s+as\s+(.+?))?\s*$/.exec(line);
    if (!match) continue;
    labels.add(match[1].trim().toLocaleLowerCase());
    if (match[2]) labels.add(match[2].replace(/^['"]|['"]$/g, '').trim().toLocaleLowerCase());
  }
  return labels;
}

function evidenceIsLiteral(code: string, evidence: string, label: string): boolean {
  const normalizedEvidence = evidence.replace(/\s+/g, ' ').trim();
  return code.split(/\r?\n/).some((line) => {
    const normalizedLine = line.replace(/\s+/g, ' ').trim();
    return normalizedLine === normalizedEvidence && normalizedLine.toLocaleLowerCase().includes(label.toLocaleLowerCase());
  });
}

function hasExplicitAllowedTypeSignal(candidate: Pick<ExtractedCandidate, 'label' | 'type' | 'evidenceSnippet'>): boolean {
  const context = `${candidate.label} ${candidate.evidenceSnippet}`.toLocaleLowerCase();
  // A model may call a generic participant a service. MVP-0 accepts only the
  // forms where the source itself supplies an allowed architectural role.
  if (/\b(actor|client|ui|user|workflow|step|store|database|\bdb\b|module)\b/.test(context)) return false;
  if (candidate.type === 'service') return /\bservice\b/.test(context);
  if (candidate.type === 'api') return /\bapi\b/.test(context);
  return /\b(external|third[- ]party|vendor|partner)\b/.test(context)
    && /\b(service|api)\b/.test(context);
}

function derivedObservedRole(type: CandidateType): string {
  if (type === 'api') return 'Explicit API participant';
  if (type === 'service') return 'Explicit service participant';
  return 'Explicit external service participant';
}

function parseExtractorOutput(raw: unknown, source: EligibleSource): ExtractedCandidate[] {
  let payload: unknown = raw;
  if (typeof raw === 'string') {
    try { payload = JSON.parse(raw); } catch { return []; }
  }
  const candidates = (payload as { candidates?: unknown } | null)?.candidates;
  if (!Array.isArray(candidates)) return [];
  const participants = participantLabels(source.mermaidCode);
  const valid: ExtractedCandidate[] = [];
  for (const item of candidates) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const candidate = item as Record<string, unknown>;
    const label = stringField(candidate.label, 200);
    const observedRole = stringField(candidate.observedRole, 400);
    const evidenceSnippet = stringField(candidate.evidenceSnippet, 800);
    const type = candidate.type;
    const confidence = candidate.confidence;
    const status = candidate.status;
    if (!label || !observedRole || !evidenceSnippet
      || typeof type !== 'string' || !CANDIDATE_TYPES.has(type as CandidateType)
      || typeof confidence !== 'string' || !CONFIDENCES.has(confidence as Confidence)
      || typeof status !== 'string' || !CANDIDATE_STATUSES.has(status as CandidateStatus)) continue;
    const parsed = { label, observedRole, evidenceSnippet, type: type as CandidateType, confidence: confidence as Confidence, status: status as CandidateStatus };
    if (!participants.has(label.toLocaleLowerCase()) || !evidenceIsLiteral(source.mermaidCode, evidenceSnippet, label)) continue;
    if (!hasExplicitAllowedTypeSignal(parsed)) continue;
    // The literal source line is needed only for in-memory validation. Derived
    // records deliberately retain a bounded, non-source evidence statement
    // rather than Mermaid text or free-form model prose.
    valid.push({
      ...parsed,
      observedRole: derivedObservedRole(parsed.type),
      evidenceSnippet: 'Explicit participant declaration and allowed role verified',
    });
  }
  const deduped = new Map<string, ExtractedCandidate>();
  for (const candidate of valid) {
    const key = `${candidate.type}:${candidate.label.toLocaleLowerCase()}`;
    if (!deduped.has(key)) deduped.set(key, candidate);
  }
  return [...deduped.values()].sort((a, b) => a.type.localeCompare(b.type) || a.label.localeCompare(b.label));
}

function openAiExtractor(env: ArchitectureTokenEnv): Extractor {
  const key = env.ARCHITECTURE_TOKEN_OPENAI_API_KEY;
  if (!key) throw new HttpError(424, 'Architecture Token extractor is not configured');
  return {
    async extract(source) {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: EXTRACTOR_MODEL,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
            { role: 'user', content: source.mermaidCode },
          ],
        }),
      });
      if (!response.ok) throw new Error(`extractor_http_${response.status}`);
      const body = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
      return body.choices?.[0]?.message?.content ?? null;
    },
  };
}

function statusFor(results: SourceResult[]): SourceStatus {
  if (results.some((result) => result.status === 'failed')) return 'failed';
  if (results.some((result) => result.status === 'partial')) return 'partial';
  return 'succeeded';
}

async function persistResult(env: ArchitectureTokenEnv, result: CalibrationResult, retryOf: string | null): Promise<void> {
  const now = new Date().toISOString();
  const statements = [env.DB.prepare(
    `INSERT INTO ArchitectureTokenCalibrationRun
      (runId, tenantScope, mode, status, dryRun, retryOf, extractorModel, extractorPromptVersion,
       sourceCount, acceptedCount, rejectedCount, abstainedCount, createdAt, updatedAt)
     VALUES (?1, ?2, 'calibration', ?3, 0, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)
     ON CONFLICT(runId) DO UPDATE SET
       status = excluded.status, retryOf = excluded.retryOf, extractorModel = excluded.extractorModel,
       extractorPromptVersion = excluded.extractorPromptVersion, sourceCount = excluded.sourceCount,
       acceptedCount = excluded.acceptedCount, rejectedCount = excluded.rejectedCount,
       abstainedCount = excluded.abstainedCount, updatedAt = excluded.updatedAt`,
  ).bind(result.runId, PILOT_TENANT_ALIAS, result.status, retryOf, result.extractorModel, result.extractorPromptVersion,
    result.sourceResults.length, result.acceptedCount, result.rejectedCount, result.abstainedCount, now)];
  for (const sourceResult of result.sourceResults) {
    const { source } = sourceResult;
    statements.push(env.DB.prepare(
      `INSERT INTO ArchitectureTokenSourceRun
        (runId, sourceId, sourceRevision, sourceHash, sourceFamily, status, retryOf, candidateCount, failureStage, createdAt, updatedAt)
       VALUES (?1, ?2, ?3, ?4, 'sequenceDiagram', ?5, ?6, ?7, ?8, ?9, ?9)
       ON CONFLICT(runId, sourceId, sourceRevision) DO UPDATE SET
         sourceHash = excluded.sourceHash, status = excluded.status, retryOf = excluded.retryOf,
         candidateCount = excluded.candidateCount, failureStage = excluded.failureStage,
         updatedAt = excluded.updatedAt`,
    ).bind(result.runId, source.sourceId, source.sourceRevision, source.sourceHash, sourceResult.status, retryOf,
      sourceResult.candidates.length, sourceResult.failureStage, now));
    for (const candidate of sourceResult.candidates) {
      statements.push(env.DB.prepare(
        `INSERT INTO ArchitectureTokenCandidate
          (runId, sourceId, sourceRevision, sourceHash, sourceFamily, candidateLabel, candidateType, candidateRole,
           evidenceSnippet, extractorModel, extractorPromptVersion, confidence, status, retryOf, createdAt, updatedAt)
         VALUES (?1, ?2, ?3, ?4, 'sequenceDiagram', ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)
         ON CONFLICT(runId, sourceId, sourceRevision, candidateType, candidateLabel) DO UPDATE SET
           candidateRole = excluded.candidateRole, evidenceSnippet = excluded.evidenceSnippet,
           confidence = excluded.confidence, status = excluded.status, updatedAt = excluded.updatedAt`,
      ).bind(result.runId, source.sourceId, source.sourceRevision, source.sourceHash, candidate.label, candidate.type,
        candidate.observedRole, candidate.evidenceSnippet, result.extractorModel, result.extractorPromptVersion,
        candidate.confidence, candidate.status, retryOf, now));
    }
  }
  await env.DB.batch(statements);
}

export interface CalibrationRunOptions {
  dryRun: boolean;
  retryOf: string | null;
  runId?: string;
  extractor?: Extractor;
  extractorModel?: string;
  promptVersion?: string;
}

export async function runCalibration(
  env: ArchitectureTokenEnv,
  sources: EligibleSource[],
  options: CalibrationRunOptions = { dryRun: true, retryOf: null },
): Promise<CalibrationResult> {
  if (env.ARCHITECTURE_TOKEN_CALIBRATION_EXECUTE_ENABLED !== 'true') {
    throw new HttpError(403, 'Architecture Token calibration execution is disabled');
  }
  if (!options.dryRun && env.ARCHITECTURE_TOKEN_CALIBRATION_WRITE_ENABLED !== 'true') {
    throw new HttpError(403, 'Architecture Token calibration writes are disabled');
  }
  const extractor = options.extractor ?? openAiExtractor(env);
  const extractorModel = options.extractorModel ?? EXTRACTOR_MODEL;
  const extractorPromptVersion = options.promptVersion ?? EXTRACTOR_PROMPT_VERSION;
  const sourceResults: SourceResult[] = [];
  for (const source of sources) {
    try {
      const candidates = parseExtractorOutput(await extractor.extract(source), source);
      sourceResults.push({ source, candidates, status: 'succeeded', failureStage: null });
    } catch {
      sourceResults.push({ source, candidates: [], status: 'failed', failureStage: 'extraction' });
    }
  }
  const acceptedCount = sourceResults.reduce((sum, item) => sum + item.candidates.filter((candidate) => candidate.status === 'accepted').length, 0);
  const rejectedCount = sourceResults.reduce((sum, item) => sum + item.candidates.filter((candidate) => candidate.status === 'rejected').length, 0);
  const abstainedCount = sourceResults.reduce((sum, item) => sum + (item.candidates.length === 0 ? 1 : item.candidates.filter((candidate) => candidate.status === 'abstained').length), 0);
  const result: CalibrationResult = {
    runId: options.runId ?? crypto.randomUUID(), dryRun: options.dryRun, status: statusFor(sourceResults),
    extractorModel, extractorPromptVersion, sourceResults,
    acceptedCount, rejectedCount, abstainedCount,
  };
  if (!options.dryRun) await persistResult(env, result, options.retryOf);
  return result;
}

function emitResult(
  env: ArchitectureTokenEnv,
  context: AuthenticatedMetricsContext,
  result: CalibrationResult,
  waitUntil?: (promise: Promise<unknown>) => void,
): void {
  if (!env.MIXPANEL_TOKEN) return;
  const event = result.status === 'failed' ? 'architecture_token_calibration_failed' : 'architecture_token_calibration_completed';
  const delivery = mixpanelImportServiceEvents([{
    event,
    distinctId: context.installationId,
    insertId: `${result.runId}:${event}`,
    time: Math.floor(Date.now() / 1000),
    properties: {
      feature_area: 'architecture_tokens', surface: 'scheduled_job', tenant_alias: PILOT_TENANT_ALIAS,
      run_id: result.runId, sample_count: result.sourceResults.length, accepted_count: result.acceptedCount,
      rejected_count: result.rejectedCount, abstained_count: result.abstainedCount, dry_run: result.dryRun,
    },
  }], env.MIXPANEL_TOKEN).catch(() => undefined);
  if (waitUntil) waitUntil(delivery); else void delivery;
}

export async function handleCalibration(
  request: Request,
  env: ArchitectureTokenEnv,
  data: ForgeRequestData,
  waitUntil?: (promise: Promise<unknown>) => void,
): Promise<Response> {
  try {
    if (request.method !== 'POST') throw new HttpError(405, 'Method Not Allowed');
    const body = await request.json().catch(() => null) as { sources?: unknown; dryRun?: unknown; retryOf?: unknown; runId?: unknown } | null;
    const context = await authenticateMetricsRequest(request, env, { backendOnly: true, forgeContext: data.forgeContext });
    if (
      !env.ARCHITECTURE_TOKEN_PILOT_CLOUD_ID
      || !env.ARCHITECTURE_TOKEN_PILOT_FORGE_APP_ID
      || context.cloudId !== env.ARCHITECTURE_TOKEN_PILOT_CLOUD_ID
      || context.appId !== env.ARCHITECTURE_TOKEN_PILOT_FORGE_APP_ID
    ) {
      throw new HttpError(403, 'Architecture Token calibration is not enabled for this tenant');
    }
    if (body?.dryRun != null && typeof body.dryRun !== 'boolean') throw new HttpError(400, 'dryRun must be boolean');
    const retryOf = typeof body?.retryOf === 'string' && UUID_RE.test(body.retryOf) ? body.retryOf : null;
    if (body?.retryOf != null && !retryOf) throw new HttpError(400, 'retryOf must be a UUID');
    const runId = typeof body?.runId === 'string' && UUID_RE.test(body.runId) ? body.runId : undefined;
    if (body?.runId != null && !runId) throw new HttpError(400, 'runId must be a UUID');
    const sources = await selectCalibrationSources(body?.sources);
    const result = await runCalibration(env, sources, { dryRun: body?.dryRun !== false, retryOf, runId });
    emitResult(env, context, result, waitUntil);
    return jsonResponse({
      runId: result.runId, tenantScope: PILOT_TENANT_ALIAS, dryRun: result.dryRun, status: result.status,
      sampleCount: result.sourceResults.length, acceptedCount: result.acceptedCount,
      rejectedCount: result.rejectedCount, abstainedCount: result.abstainedCount,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
