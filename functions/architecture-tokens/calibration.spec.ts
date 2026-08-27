import { describe, expect, it, vi } from 'vitest';

vi.mock('../metrics-cache/snapshot/common', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../metrics-cache/snapshot/common')>();
  return {
    ...actual,
    authenticateMetricsRequest: vi.fn(async () => ({
      cloudId: 'pilot-cloud', installationId: 'installation-a', appId: '8ad26115-211f-4216-971b-0540f606303d',
      clientDomain: 'example-tenant', productType: 'lite', environment: 'staging',
    })),
  };
});

import { authenticateMetricsRequest } from '../metrics-cache/snapshot/common';
import {
  handleCalibration,
  isMermaidSequenceSource,
  runCalibration,
  selectCalibrationSources,
} from './calibration';

function raw(code: string) {
  return JSON.stringify({ diagramType: 'mermaid', mermaidCode: code });
}

function calibrationSources(code = 'sequenceDiagram\nparticipant API as "Orders API"\nAPI->>API: process'): unknown[] {
  return Array.from({ length: 10 }, (_, index) => ({
    sourceId: `source-${String(index + 1).padStart(2, '0')}`,
    sourceRevision: index + 1,
    rawValue: raw(code),
  }));
}

describe('MVP-0 Mermaid sequence gate', () => {
  it('accepts a Mermaid sequence source after only leading %% preamble lines', () => {
    expect(isMermaidSequenceSource('  %%{init: {"theme": "base"}}%%\n%% note\nsequenceDiagram\nparticipant API')).toBe(true);
  });

  it('does not mistake a later sequenceDiagram token for the leading directive', () => {
    expect(isMermaidSequenceSource('graph TD\nA --> sequenceDiagram')).toBe(false);
    expect(isMermaidSequenceSource('%% only a preamble')).toBe(false);
  });

  it('requires exactly ten distinct, non-empty Mermaid sequence sources', async () => {
    const sources = calibrationSources();
    await expect(selectCalibrationSources(sources)).resolves.toHaveLength(10);
    await expect(selectCalibrationSources(sources.slice(0, 9))).rejects.toThrow('exactly 10');
    const invalid = calibrationSources();
    invalid[4] = { sourceId: 'source-05', sourceRevision: 5, rawValue: raw('') };
    await expect(selectCalibrationSources(invalid)).rejects.toThrow('not an active Mermaid sequence');
  });
});

describe('MVP-0 conservative candidate extraction', () => {
  it('keeps only declared participants carrying an explicit allowed type, never client/UI participants', async () => {
    const code = [
      'sequenceDiagram',
      'actor User',
      'participant API as "Orders API"',
      'participant Client as "Client UI"',
      'User->>API: create order',
    ].join('\n');
    const sources = await selectCalibrationSources(calibrationSources(code));
    const result = await runCalibration({} as never, sources, {
      dryRun: true,
      retryOf: null,
      extractor: {
        extract: async () => ({ candidates: [
          { label: 'Orders API', type: 'api', observedRole: 'Exposes order operations.', evidenceSnippet: 'participant API as "Orders API"', confidence: 'high', status: 'accepted' },
          { label: 'Client UI', type: 'service', observedRole: 'Starts requests.', evidenceSnippet: 'participant Client as "Client UI"', confidence: 'high', status: 'accepted' },
        ] }),
      },
    });
    expect(result.acceptedCount).toBe(10);
    expect(result.sourceResults.every((source) => source.candidates.length === 1)).toBe(true);
    expect(result.sourceResults[0].candidates).toEqual([expect.objectContaining({ label: 'Orders API', type: 'api' })]);
  });

  it('treats output without literal participant evidence as an abstention', async () => {
    const sources = await selectCalibrationSources(calibrationSources());
    const result = await runCalibration({} as never, sources, {
      dryRun: true,
      retryOf: null,
      extractor: { extract: async () => ({ candidates: [
        { label: 'Orders API', type: 'api', observedRole: 'Inferred service.', evidenceSnippet: 'API->>API: process', confidence: 'high', status: 'accepted' },
      ] }) },
    });
    expect(result.acceptedCount).toBe(0);
    expect(result.abstainedCount).toBe(10);
  });
});

describe('MVP-0 isolation and persistence', () => {
  it('keeps dry runs read-only even when extraction returns candidates', async () => {
    const sources = await selectCalibrationSources(calibrationSources());
    const batch = vi.fn();
    const result = await runCalibration({ DB: { batch } } as never, sources, {
      dryRun: true,
      retryOf: null,
      extractor: { extract: async () => ({ candidates: [
        { label: 'Orders API', type: 'api', observedRole: 'Exposes order operations.', evidenceSnippet: 'participant API as "Orders API"', confidence: 'high', status: 'accepted' },
      ] }) },
    });
    expect(result.dryRun).toBe(true);
    expect(batch).not.toHaveBeenCalled();
  });

  it('rejects a verified caller outside the configured pilot tenant before source selection or any write', async () => {
    vi.mocked(authenticateMetricsRequest).mockResolvedValueOnce({
      cloudId: 'other-cloud', installationId: 'installation-b', appId: '8ad26115-211f-4216-971b-0540f606303d',
      clientDomain: 'other', productType: 'lite', environment: 'staging',
    });
    const batch = vi.fn();
    const response = await handleCalibration(
      new Request('https://example.test/architecture-tokens/calibration', { method: 'POST', body: '{}' }),
      { DB: { batch }, ARCHITECTURE_TOKEN_PILOT_CLOUD_ID: 'pilot-cloud' } as never,
      {} as never,
    );
    expect(response.status).toBe(403);
    expect(batch).not.toHaveBeenCalled();
  });

  it('uses deterministic upserts when an explicit replay reuses a run id', async () => {
    const sources = await selectCalibrationSources(calibrationSources());
    const sql: string[] = [];
    const batch = vi.fn(async () => []);
    const db = {
      prepare: vi.fn((statement: string) => {
        sql.push(statement);
        return { bind: vi.fn(() => ({})) };
      }),
      batch,
    };
    const extractor = { extract: async () => ({ candidates: [
      { label: 'Orders API', type: 'api', observedRole: 'Exposes order operations.', evidenceSnippet: 'participant API as "Orders API"', confidence: 'high', status: 'accepted' },
    ] }) };
    const options = {
      dryRun: false,
      retryOf: null,
      runId: '11111111-1111-4111-8111-111111111111',
      extractor,
    };
    await runCalibration({ DB: db, ARCHITECTURE_TOKEN_CALIBRATION_WRITE_ENABLED: 'true' } as never, sources, options);
    await runCalibration({ DB: db, ARCHITECTURE_TOKEN_CALIBRATION_WRITE_ENABLED: 'true' } as never, sources, options);
    expect(batch).toHaveBeenCalledTimes(2);
    expect(sql.filter((statement) => statement.includes('ArchitectureTokenCandidate'))[0]).toContain('ON CONFLICT(runId, sourceId, sourceRevision, candidateType, candidateLabel)');
  });
});
