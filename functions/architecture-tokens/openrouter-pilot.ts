import {
  EXTRACTION_SYSTEM_PROMPT,
  runCalibration,
  selectPilotSources,
  type ArchitectureTokenEnv,
  type EligibleSource,
  type Extractor,
} from './calibration';

export const OPENROUTER_PRIMARY_MODEL = 'z-ai/glm-5.2:free';
export const OPENROUTER_FALLBACK_MODEL = 'nvidia/nemotron-3-super-120b-a12b:free';

export interface OpenRouterModelCatalogEntry {
  id?: unknown;
  pricing?: { prompt?: unknown; completion?: unknown };
  architecture?: { input_modalities?: unknown };
  supported_parameters?: unknown;
}

function isFreeStructuredTextModel(entry: OpenRouterModelCatalogEntry, expectedId: string): boolean {
  if (entry.id !== expectedId || expectedId === 'openrouter/free') return false;
  if (entry.pricing?.prompt !== '0' || entry.pricing?.completion !== '0') return false;
  if (!Array.isArray(entry.architecture?.input_modalities) || !entry.architecture.input_modalities.includes('text')) return false;
  if (!Array.isArray(entry.supported_parameters)) return false;
  return entry.supported_parameters.includes('response_format') && entry.supported_parameters.includes('structured_outputs');
}

export function selectVerifiedOpenRouterModels(models: OpenRouterModelCatalogEntry[]): { primary: string; fallback: string } {
  if (!models.some((model) => isFreeStructuredTextModel(model, OPENROUTER_PRIMARY_MODEL))) {
    throw new Error('OpenRouter primary free structured-output model is unavailable');
  }
  if (!models.some((model) => isFreeStructuredTextModel(model, OPENROUTER_FALLBACK_MODEL))) {
    throw new Error('OpenRouter fallback free structured-output model is unavailable');
  }
  return { primary: OPENROUTER_PRIMARY_MODEL, fallback: OPENROUTER_FALLBACK_MODEL };
}

export interface ExpectedOccurrence {
  sourceId: string;
  candidates: Array<{ label: string; type: string }>;
}

export interface ObservedOccurrence {
  sourceId: string;
  candidates: Array<{ label: string; type: string }>;
}

export interface CalibrationQuality {
  truePositiveCount: number;
  falsePositiveCount: number;
  falseNegativeCount: number;
  forbiddenFalsePositiveCount: number;
  precision: number;
  recall: number;
  explicitFormRate: number;
  passed: boolean;
}

function occurrenceKey(sourceId: string, label: string, type: string): string {
  return `${sourceId}\u0000${type.trim().toLocaleLowerCase()}\u0000${label.trim().toLocaleLowerCase()}`;
}

export function evaluateCalibrationGate(input: {
  expected: ExpectedOccurrence[];
  actual: ObservedOccurrence[];
  forbiddenFalsePositiveCount: number;
}): CalibrationQuality {
  const expected = new Set(input.expected.flatMap((source) => source.candidates.map((candidate) =>
    occurrenceKey(source.sourceId, candidate.label, candidate.type))));
  const actual = new Set(input.actual.flatMap((source) => source.candidates.map((candidate) =>
    occurrenceKey(source.sourceId, candidate.label, candidate.type))));
  const truePositiveCount = [...actual].filter((candidate) => expected.has(candidate)).length;
  const falsePositiveCount = actual.size - truePositiveCount;
  const falseNegativeCount = [...expected].filter((candidate) => !actual.has(candidate)).length;
  const precision = actual.size === 0 ? 0 : truePositiveCount / actual.size;
  const recall = expected.size === 0 ? 0 : truePositiveCount / expected.size;
  const allowed = new Set(['service', 'api', 'external-service']);
  const explicitFormRate = actual.size === 0 ? 0 : [...actual].filter((key) => allowed.has(key.split('\u0000')[1])).length / actual.size;
  return {
    truePositiveCount,
    falsePositiveCount,
    falseNegativeCount,
    forbiddenFalsePositiveCount: input.forbiddenFalsePositiveCount,
    precision,
    recall,
    explicitFormRate,
    passed: precision >= 0.9 && input.forbiddenFalsePositiveCount === 0 && explicitFormRate >= 0.8,
  };
}

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_PROMPT_VERSION = 'architecture-token-openrouter-v1';
const EXPECTED_PILOT_SEQUENCE_COUNT = 117;
const FORBIDDEN_CATEGORY_RE = /\b(actor|client|ui|user|workflow|step|store|database|db|module)\b/i;
const SOURCE_ID_RE = /^[A-Za-z0-9._:-]{1,200}$/;
const RUN_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface CurrentSourceRow {
  sourceId: unknown;
  sourceRevision: unknown;
  rawValue: unknown;
}

interface CalibrationManifest {
  sources: ExpectedOccurrence[];
}

interface OpenRouterCompletion {
  model?: unknown;
  choices?: Array<{ message?: { content?: unknown } }>;
}

export interface OpenRouterPilotOptions {
  /** Runs the ten-source quality test without persisting or starting the full corpus. */
  dryRun?: boolean;
  /** Optional stable identifiers permit idempotent retry of derived output. */
  calibrationRunId?: string;
  fullRunId?: string;
  retryOf?: string | null;
  /** Injectable only for tests and a trusted worker runtime. Never supplied by HTTP. */
  fetch?: typeof fetch;
}

export interface OpenRouterPilotReport {
  dryRun: boolean;
  corpusSourceCount: number;
  calibration: Array<{
    model: string;
    runId: string;
    status: string;
    quality: CalibrationQuality;
  }>;
  selectedModel: string | null;
  fullRun: null | {
    runId: string;
    status: string;
    processedSourceCount: number;
    acceptedCount: number;
    rejectedCount: number;
    abstainedCount: number;
  };
}

function protectedExecutionEnabled(env: ArchitectureTokenEnv): boolean {
  return env.ARCHITECTURE_TOKEN_OPENROUTER_EXECUTE_ENABLED === 'true'
    && env.ARCHITECTURE_TOKEN_CALIBRATION_EXECUTE_ENABLED === 'true'
    && env.ARCHITECTURE_TOKEN_CALIBRATION_WRITE_ENABLED === 'true';
}

function assertTrustedExecution(env: ArchitectureTokenEnv): asserts env is ArchitectureTokenEnv & {
  OPENROUTER_API_KEY: string;
  ARCHITECTURE_TOKEN_PILOT_SPACE_ID: string;
  ARCHITECTURE_TOKEN_OPENROUTER_CALIBRATION_MANIFEST: string;
} {
  // This boundary intentionally runs before D1 access. There is no HTTP route
  // for this module: the scope and all enablement originate in worker secrets.
  if (!protectedExecutionEnabled(env)) throw new Error('OpenRouter pilot execution is not enabled');
  if (!env.OPENROUTER_API_KEY || !env.ARCHITECTURE_TOKEN_PILOT_SPACE_ID || !env.ARCHITECTURE_TOKEN_OPENROUTER_CALIBRATION_MANIFEST) {
    throw new Error('OpenRouter pilot protected runtime configuration is incomplete');
  }
}

function parseManifest(value: string): CalibrationManifest {
  let payload: unknown;
  try { payload = JSON.parse(value); } catch { throw new Error('OpenRouter calibration manifest is invalid'); }
  const sources = (payload as { sources?: unknown } | null)?.sources;
  if (!Array.isArray(sources) || sources.length !== 10) throw new Error('OpenRouter calibration manifest is invalid');
  const seen = new Set<string>();
  const parsed: ExpectedOccurrence[] = sources.map((source) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('OpenRouter calibration manifest is invalid');
    const record = source as Record<string, unknown>;
    const sourceId = typeof record.sourceId === 'string' && SOURCE_ID_RE.test(record.sourceId) ? record.sourceId : null;
    const candidates = record.candidates;
    if (!sourceId || !Array.isArray(candidates) || seen.has(sourceId)) throw new Error('OpenRouter calibration manifest is invalid');
    seen.add(sourceId);
    const validCandidates = candidates.map((candidate) => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('OpenRouter calibration manifest is invalid');
      const item = candidate as Record<string, unknown>;
      const label = typeof item.label === 'string' ? item.label.trim() : '';
      const type = typeof item.type === 'string' ? item.type.trim() : '';
      if (!label || !['service', 'api', 'external-service'].includes(type)) throw new Error('OpenRouter calibration manifest is invalid');
      return { label, type };
    });
    return { sourceId, candidates: validCandidates };
  });
  return { sources: parsed };
}

function isCurrentGuardedSequence(row: CurrentSourceRow): row is CurrentSourceRow & { sourceId: string; sourceRevision: number; rawValue: string } {
  if (typeof row.sourceId !== 'string' || !SOURCE_ID_RE.test(row.sourceId)
    || !Number.isSafeInteger(row.sourceRevision) || (row.sourceRevision as number) < 1
    || typeof row.rawValue !== 'string') return false;
  try {
    const raw = JSON.parse(row.rawValue) as { diagramType?: unknown; mermaidCode?: unknown };
    if (typeof raw.diagramType !== 'string' || raw.diagramType.toLowerCase() !== 'mermaid' || typeof raw.mermaidCode !== 'string') return false;
    let remaining = raw.mermaidCode.trimStart();
    while (remaining.startsWith('%%')) {
      const newline = remaining.indexOf('\n');
      if (newline < 0) return false;
      remaining = remaining.slice(newline + 1).trimStart();
    }
    return /^sequenceDiagram(?:\s|$)/.test(remaining);
  } catch {
    return false;
  }
}

async function loadCurrentPilotSources(env: ArchitectureTokenEnv & { ARCHITECTURE_TOKEN_PILOT_SPACE_ID: string }): Promise<EligibleSource[]> {
  const response = await env.DB.prepare(
    `SELECT contentId AS sourceId, latestVersionNumber AS sourceRevision, json_extract(body, '$.raw.value') AS rawValue
       FROM CustomContent
      WHERE spaceId = ?1
        AND status = 'current'
        AND json_extract(json_extract(body, '$.raw.value'), '$.diagramType') = 'mermaid'`,
  ).bind(env.ARCHITECTURE_TOKEN_PILOT_SPACE_ID).all<CurrentSourceRow>();
  const eligibleRows = (response.results ?? []).filter(isCurrentGuardedSequence);
  return selectPilotSources(eligibleRows);
}

function rawCandidates(value: unknown): Array<Record<string, unknown>> {
  let payload = value;
  if (typeof value === 'string') {
    try { payload = JSON.parse(value); } catch { return []; }
  }
  const candidates = (payload as { candidates?: unknown } | null)?.candidates;
  return Array.isArray(candidates)
    ? candidates.filter((candidate): candidate is Record<string, unknown> => !!candidate && typeof candidate === 'object' && !Array.isArray(candidate))
    : [];
}

function forbiddenAcceptedCandidateCount(value: unknown): number {
  return rawCandidates(value).filter((candidate) => {
    if (candidate.status !== 'accepted') return false;
    return FORBIDDEN_CATEGORY_RE.test([
      candidate.label, candidate.type, candidate.observedRole, candidate.evidenceSnippet,
    ].filter((item): item is string => typeof item === 'string').join(' '));
  }).length;
}

function retryAfterMilliseconds(response: Response, attempt: number): number {
  const retryAfter = response.headers.get('retry-after');
  const seconds = retryAfter ? Number(retryAfter) : Number.NaN;
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000);
  return Math.min(500 * (2 ** attempt), 30_000);
}

async function requestJsonWithRetry(fetchImpl: typeof fetch, request: RequestInfo | URL, init: RequestInit): Promise<unknown> {
  let lastFailure: Error | null = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let response: Response;
    try {
      response = await fetchImpl(request, init);
    } catch (error) {
      lastFailure = error instanceof Error ? error : new Error('OpenRouter request did not complete');
      if (attempt < 3) await new Promise<void>((resolve) => setTimeout(resolve, Math.min(500 * (2 ** attempt), 30_000)));
      continue;
    }
    if (response.ok) {
      try { return await response.json(); } catch { throw new Error('OpenRouter response was not valid JSON'); }
    }
    if (response.status !== 429 && response.status < 500) throw new Error('OpenRouter request was rejected');
    lastFailure = new Error('OpenRouter request did not complete');
    if (attempt < 3) await new Promise<void>((resolve) => setTimeout(resolve, retryAfterMilliseconds(response, attempt)));
  }
  throw lastFailure ?? new Error('OpenRouter request did not complete');
}

async function fetchVerifiedModels(fetchImpl: typeof fetch): Promise<{ primary: string; fallback: string }> {
  const catalog = await requestJsonWithRetry(fetchImpl, `${OPENROUTER_API_URL}/models`, { headers: { Accept: 'application/json' } });
  const models = (catalog as { data?: unknown } | null)?.data;
  if (!Array.isArray(models)) throw new Error('OpenRouter model catalogue is unavailable');
  return selectVerifiedOpenRouterModels(models as OpenRouterModelCatalogEntry[]);
}

function openRouterExtractor(
  fetchImpl: typeof fetch,
  apiKey: string,
  model: string,
  onOutput: (output: unknown) => void,
): Extractor {
  return {
    async extract(source) {
      const body = await requestJsonWithRetry(fetchImpl, `${OPENROUTER_API_URL}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature: 0,
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'architecture_token_occurrences',
              strict: true,
              schema: {
                type: 'object', additionalProperties: false,
                properties: {
                  candidates: {
                    type: 'array',
                    items: {
                      type: 'object', additionalProperties: false,
                      required: ['label', 'type', 'observedRole', 'evidenceSnippet', 'confidence', 'status'],
                      properties: {
                        label: { type: 'string' }, type: { enum: ['service', 'api', 'external-service'] },
                        observedRole: { type: 'string' }, evidenceSnippet: { type: 'string' },
                        confidence: { enum: ['high', 'medium', 'low'] }, status: { enum: ['accepted', 'rejected', 'abstained'] },
                      },
                    },
                  },
                },
                required: ['candidates'],
              },
            },
          },
          messages: [
            { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
            { role: 'user', content: source.mermaidCode },
          ],
        }),
      }) as OpenRouterCompletion;
      // The named :free variant is recorded only if OpenRouter confirms it;
      // a random router result would make quality evidence non-reproducible.
      if (body.model !== model) throw new Error('OpenRouter model identity was not confirmed');
      const output = body.choices?.[0]?.message?.content ?? null;
      onOutput(output);
      return output;
    },
  };
}

function calibrationActual(result: Awaited<ReturnType<typeof runCalibration>>): ObservedOccurrence[] {
  return result.sourceResults.map((sourceResult) => ({
    sourceId: sourceResult.source.sourceId,
    candidates: sourceResult.candidates
      .filter((candidate) => candidate.status === 'accepted')
      .map((candidate) => ({ label: candidate.label, type: candidate.type })),
  }));
}

async function runModelCalibration(
  env: ArchitectureTokenEnv,
  sources: EligibleSource[],
  expected: ExpectedOccurrence[],
  model: string,
  options: Required<Pick<OpenRouterPilotOptions, 'dryRun'>> & Pick<OpenRouterPilotOptions, 'calibrationRunId' | 'retryOf' | 'fetch'>,
): Promise<OpenRouterPilotReport['calibration'][number]> {
  let forbiddenFalsePositiveCount = 0;
  const fetchImpl = options.fetch ?? fetch;
  const result = await runCalibration(env, sources, {
    dryRun: options.dryRun,
    retryOf: options.retryOf ?? null,
    runId: options.calibrationRunId,
    extractorModel: model,
    promptVersion: OPENROUTER_PROMPT_VERSION,
    extractor: openRouterExtractor(fetchImpl, env.OPENROUTER_API_KEY!, model, (output) => {
      forbiddenFalsePositiveCount += forbiddenAcceptedCandidateCount(output);
    }),
  });
  return {
    model,
    runId: result.runId,
    status: result.status,
    quality: evaluateCalibrationGate({ expected, actual: calibrationActual(result), forbiddenFalsePositiveCount }),
  };
}

function exactCalibrationSources(manifest: CalibrationManifest, sources: EligibleSource[]): EligibleSource[] {
  const byId = new Map(sources.map((source) => [source.sourceId, source]));
  const selected = manifest.sources.map((expected) => byId.get(expected.sourceId)).filter((source): source is EligibleSource => !!source);
  if (selected.length !== manifest.sources.length) throw new Error('OpenRouter calibration sample is no longer current');
  return selected;
}

function validatedRunId(value: string | undefined, name: string): string | undefined {
  if (value != null && !RUN_ID_RE.test(value)) throw new Error(`${name} must be a UUID`);
  return value;
}

/**
 * Internal-only trusted-executor entry point. This module intentionally has no
 * Pages function / browser route, and never accepts a tenant or source body.
 */
export async function runOpenRouterPilot(env: ArchitectureTokenEnv, options: OpenRouterPilotOptions = {}): Promise<OpenRouterPilotReport> {
  assertTrustedExecution(env);
  const manifest = parseManifest(env.ARCHITECTURE_TOKEN_OPENROUTER_CALIBRATION_MANIFEST);
  const allSources = await loadCurrentPilotSources(env);
  if (allSources.length !== EXPECTED_PILOT_SEQUENCE_COUNT) throw new Error('OpenRouter pilot corpus does not match the approved sequence source count');
  const calibrationSources = exactCalibrationSources(manifest, allSources);
  const models = await fetchVerifiedModels(options.fetch ?? fetch);
  const dryRun = options.dryRun === true;
  const retryOf = options.retryOf ?? null;
  if (retryOf && !RUN_ID_RE.test(retryOf)) throw new Error('retryOf must be a UUID');
  const calibrationRunId = validatedRunId(options.calibrationRunId, 'calibrationRunId');
  const primary = await runModelCalibration(env, calibrationSources, manifest.sources, models.primary, {
    dryRun, calibrationRunId, retryOf, fetch: options.fetch,
  });
  const calibration = [primary];
  const selected = primary.status === 'succeeded' && primary.quality.passed ? primary.model : null;
  if (!selected) {
    const fallback = await runModelCalibration(env, calibrationSources, manifest.sources, models.fallback, {
      dryRun, retryOf, fetch: options.fetch,
    });
    calibration.push(fallback);
  }
  const selectedModel = calibration.find((attempt) => attempt.status === 'succeeded' && attempt.quality.passed)?.model ?? null;
  if (!selectedModel || dryRun) {
    return { dryRun, corpusSourceCount: allSources.length, calibration, selectedModel, fullRun: null };
  }
  const fullRunId = validatedRunId(options.fullRunId, 'fullRunId');
  const fullResult = await runCalibration(env, allSources, {
    dryRun: false,
    retryOf,
    runId: fullRunId,
    extractorModel: selectedModel,
    promptVersion: OPENROUTER_PROMPT_VERSION,
    extractor: openRouterExtractor(options.fetch ?? fetch, env.OPENROUTER_API_KEY, selectedModel, () => undefined),
  });
  return {
    dryRun, corpusSourceCount: allSources.length, calibration, selectedModel,
    fullRun: {
      runId: fullResult.runId, status: fullResult.status, processedSourceCount: fullResult.sourceResults.length,
      acceptedCount: fullResult.acceptedCount, rejectedCount: fullResult.rejectedCount, abstainedCount: fullResult.abstainedCount,
    },
  };
}
