import { describe, expect, it, vi } from 'vitest';
import { runCalibration, selectPilotSources } from './calibration';
import { evaluateCalibrationGate, runOpenRouterPilot, selectVerifiedOpenRouterModels } from './openrouter-pilot';

describe('OpenRouter pilot model selection', () => {
  it('uses only explicitly selected free text models that support structured outputs', () => {
    const models = [
      {
        id: 'z-ai/glm-5.2:free',
        pricing: { prompt: '0', completion: '0' },
        architecture: { input_modalities: ['text'] },
        supported_parameters: ['response_format', 'structured_outputs'],
      },
      {
        id: 'nvidia/nemotron-3-super-120b-a12b:free',
        pricing: { prompt: '0', completion: '0' },
        architecture: { input_modalities: ['text'] },
        supported_parameters: ['response_format', 'structured_outputs'],
      },
      {
        id: 'openrouter/free',
        pricing: { prompt: '0', completion: '0' },
        architecture: { input_modalities: ['text'] },
        supported_parameters: ['response_format', 'structured_outputs'],
      },
      {
        id: 'not-free',
        pricing: { prompt: '0.01', completion: '0.01' },
        architecture: { input_modalities: ['text'] },
        supported_parameters: ['response_format', 'structured_outputs'],
      },
    ];

    expect(selectVerifiedOpenRouterModels(models)).toEqual({
      primary: 'z-ai/glm-5.2:free',
      fallback: 'nvidia/nemotron-3-super-120b-a12b:free',
    });
  });
});

describe('OpenRouter pilot source normalization', () => {
  it('accepts a non-public arbitrary-size set of current guarded sequence sources for a gated full run', async () => {
    const source = await selectPilotSources([{
      sourceId: 'current-source',
      sourceRevision: 3,
      rawValue: JSON.stringify({
        diagramType: 'mermaid',
        mermaidCode: '%% pilot preamble\nsequenceDiagram\nparticipant API as "Orders API"\nAPI->>API: process',
      }),
    }]);

    expect(source).toHaveLength(1);
    expect(source[0]).toMatchObject({ sourceId: 'current-source', sourceRevision: 3 });
  });
});

describe('OpenRouter pilot execution boundary', () => {
  it('refuses before reading D1 or calling a model unless all protected execution gates are enabled', async () => {
    const db = { prepare: () => { throw new Error('D1 must not be queried'); } };
    const request = vi.fn();

    await expect(runOpenRouterPilot({ DB: db } as never, { fetch: request })).rejects.toThrow(
      'OpenRouter pilot execution is not enabled',
    );
    expect(request).not.toHaveBeenCalled();
  });
});

describe('OpenRouter pilot provenance', () => {
  it('returns the exact requested extractor model and prompt version with the derived run', async () => {
    const sources = await selectPilotSources([{
      sourceId: 'current-source',
      sourceRevision: 3,
      rawValue: JSON.stringify({
        diagramType: 'mermaid',
        mermaidCode: 'sequenceDiagram\nparticipant API as "Orders API"\nAPI->>API: process',
      }),
    }]);
    const result = await runCalibration({ ARCHITECTURE_TOKEN_CALIBRATION_EXECUTE_ENABLED: 'true' } as never, sources, {
      dryRun: true,
      retryOf: null,
      extractorModel: 'z-ai/glm-5.2:free',
      promptVersion: 'architecture-token-openrouter-v1',
      extractor: { extract: async () => ({ candidates: [] }) },
    });

    expect(result).toMatchObject({
      extractorModel: 'z-ai/glm-5.2:free',
      extractorPromptVersion: 'architecture-token-openrouter-v1',
    });
  });
});

describe('OpenRouter pilot quality gate', () => {
  it('blocks a full pilot when an accepted output belongs to a forbidden category', () => {
    const quality = evaluateCalibrationGate({
      expected: [{ sourceId: 'one', candidates: [{ label: 'Orders API', type: 'api' }] }],
      actual: [{ sourceId: 'one', candidates: [{ label: 'Orders API', type: 'api' }] }],
      forbiddenFalsePositiveCount: 1,
    });

    expect(quality).toMatchObject({ precision: 1, recall: 1, forbiddenFalsePositiveCount: 1, passed: false });
  });

  it('passes only when precision and explicit-form thresholds are both met', () => {
    const quality = evaluateCalibrationGate({
      expected: [{ sourceId: 'one', candidates: [{ label: 'Orders API', type: 'api' }] }],
      actual: [{ sourceId: 'one', candidates: [{ label: 'Orders API', type: 'api' }] }],
      forbiddenFalsePositiveCount: 0,
    });

    expect(quality).toMatchObject({ precision: 1, recall: 1, forbiddenFalsePositiveCount: 0, explicitFormRate: 1, passed: true });
  });
});
