import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openDocument } from './openDocument';
import type { TargetSpec } from './types';
import { Diagram, NULL_DIAGRAM } from '@/model/Diagram/Diagram';

vi.mock('@/model/globals', () => ({
  default: {
    apWrapper: {
      loadCustomContentWithOrphanRecovery: vi.fn(),
    },
  },
}));

vi.mock('@/utils/orphanTelemetry', () => ({
  reportOrphanObserved: vi.fn(),
}));

import globals from '@/model/globals';
import { reportOrphanObserved } from '@/utils/orphanTelemetry';

function baseTarget(overrides: Partial<TargetSpec> = {}): TargetSpec {
  return {
    resolveId: () => ({ contentId: 'cc-1', source: 'config' }),
    legacyFallbacks: [],
    onMiss: 'fail',
    macroType: 'openapi',
    ...overrides,
  };
}

describe('openDocument (Slice 1 core pipeline)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('no id, onMiss=fail: returns failed without calling loadCustomContentWithOrphanRecovery', async () => {
    const target = baseTarget({ resolveId: () => undefined });
    const outcome = await openDocument({ policy: 'read', context: {}, target });
    expect(outcome).toEqual({ kind: 'failed', error: { kind: 'not_found', indeterminate: false } });
    expect(globals.apWrapper.loadCustomContentWithOrphanRecovery).not.toHaveBeenCalled();
  });

  it('no id, onMiss=default-doc: opens defaultDoc() with recoveredFromOrphan=false', async () => {
    const target = baseTarget({
      resolveId: () => undefined,
      onMiss: 'default-doc',
      defaultDoc: () => ({ ...NULL_DIAGRAM }),
    });
    const outcome = await openDocument({ policy: 'write', context: {}, target });
    expect(outcome).toEqual({
      kind: 'opened',
      document: { doc: NULL_DIAGRAM, origin: { recoveredFromOrphan: false } },
    });
  });

  it('direct fetch hit: opens with origin.originalCustomContentId set and recoveredFromOrphan=false', async () => {
    const doc = { ...NULL_DIAGRAM, code: 'openapi: 3.0.0' } as Diagram;
    vi.mocked(globals.apWrapper.loadCustomContentWithOrphanRecovery).mockResolvedValue({
      customContent: { id: 'cc-1', value: doc } as any,
    });
    const outcome = await openDocument({ policy: 'read', context: {}, pageId: 'page-1', target: baseTarget() });
    expect(outcome).toEqual({
      kind: 'opened',
      document: {
        doc,
        origin: {
          contentId: 'cc-1',
          source: 'config',
          recoveredFromOrphan: false,
          originalCustomContentId: 'cc-1',
          recoveryPageId: 'page-1',
        },
      },
    });
    expect(reportOrphanObserved).not.toHaveBeenCalled();
  });

  it('policy=read passes copyCheckMode cross-page-only; policy=write passes full', async () => {
    vi.mocked(globals.apWrapper.loadCustomContentWithOrphanRecovery).mockResolvedValue({
      customContent: { id: 'cc-1', value: { ...NULL_DIAGRAM } } as any,
    });
    await openDocument({ policy: 'read', context: {}, target: baseTarget() });
    expect(globals.apWrapper.loadCustomContentWithOrphanRecovery).toHaveBeenCalledWith(
      undefined, 'cc-1', { copyCheckMode: 'cross-page-only' },
    );
    await openDocument({ policy: 'write', context: {}, target: baseTarget() });
    expect(globals.apWrapper.loadCustomContentWithOrphanRecovery).toHaveBeenCalledWith(
      undefined, 'cc-1', { copyCheckMode: 'full' },
    );
  });

  it('orphan-sibling recovery hit: stamps doc, reports recoveryUsed=true, origin.recoveredFromOrphan=true', async () => {
    const doc = { ...NULL_DIAGRAM, code: 'recovered' } as Diagram;
    const probeResult = { recoverable: true } as any;
    vi.mocked(globals.apWrapper.loadCustomContentWithOrphanRecovery).mockResolvedValue({
      customContent: { id: 'cc-2', value: doc } as any,
      recoveredFromOrphanId: 'cc-1',
      probeResult,
    });
    const outcome = await openDocument({ policy: 'read', context: {}, pageId: 'page-1', target: baseTarget() });
    expect(outcome.kind).toBe('opened');
    if (outcome.kind !== 'opened') throw new Error('unreachable');
    expect(outcome.document.doc.recoveredFromOrphan).toBe(true);
    expect(outcome.document.doc.recoveredFromOrphanId).toBe('cc-1');
    expect(outcome.document.origin.recoveredFromOrphan).toBe(true);
    expect(reportOrphanObserved).toHaveBeenCalledWith('page-1', 'cc-1', 'openapi', probeResult, {
      recoveryUsed: true,
      recoveredId: 'cc-2',
    });
  });

  it('direct + orphan both miss: reports recoveryUsed=false, then tries legacyFallbacks in order', async () => {
    const probeResult = { recoverable: false } as any;
    vi.mocked(globals.apWrapper.loadCustomContentWithOrphanRecovery).mockResolvedValue({
      customContent: undefined,
      probeResult,
    });
    const firstFallback = vi.fn(async () => undefined);
    const recovered = { ...NULL_DIAGRAM, code: 'from uuid' } as Diagram;
    const secondFallback = vi.fn(async (ctx: any) => {
      expect(ctx.pageId).toBe('page-1');
      return recovered;
    });
    const outcome = await openDocument({
      policy: 'read', context: { some: 'ctx' }, pageId: 'page-1',
      target: baseTarget({ legacyFallbacks: [firstFallback, secondFallback] }),
    });
    expect(firstFallback).toHaveBeenCalledTimes(1);
    expect(secondFallback).toHaveBeenCalledTimes(1);
    expect(reportOrphanObserved).toHaveBeenCalledWith('page-1', 'cc-1', 'openapi', probeResult, {
      recoveryUsed: false,
    });
    expect(outcome).toEqual({
      kind: 'opened',
      document: {
        doc: recovered,
        origin: {
          contentId: 'cc-1',
          source: 'config',
          recoveredFromOrphan: true,
          originalCustomContentId: 'cc-1',
          recoveryPageId: 'page-1',
        },
      },
    });
  });

  it('id resolved but every fallback exhausted: returns failed with the customContentId', async () => {
    vi.mocked(globals.apWrapper.loadCustomContentWithOrphanRecovery).mockResolvedValue({
      customContent: undefined,
      probeResult: { recoverable: false } as any,
    });
    const outcome = await openDocument({
      policy: 'write', context: {}, target: baseTarget({ legacyFallbacks: [vi.fn(async () => undefined)] }),
    });
    expect(outcome).toEqual({
      kind: 'failed',
      error: { kind: 'not_found', customContentId: 'cc-1', indeterminate: false },
    });
  });

  it('a clean not-found direct-fetch status is NOT indeterminate', async () => {
    vi.mocked(globals.apWrapper.loadCustomContentWithOrphanRecovery).mockResolvedValue({
      customContent: undefined,
      directFetchStatus: 'not_found',
      probeResult: { recoverable: false } as any,
    });
    const outcome = await openDocument({ policy: 'write', context: {}, target: baseTarget() });
    expect(outcome).toEqual({
      kind: 'failed',
      error: { kind: 'not_found', customContentId: 'cc-1', indeterminate: false },
    });
  });

  it('an other_error direct-fetch status IS indeterminate', async () => {
    vi.mocked(globals.apWrapper.loadCustomContentWithOrphanRecovery).mockResolvedValue({
      customContent: undefined,
      directFetchStatus: 'other_error',
      probeResult: undefined,
    });
    const outcome = await openDocument({ policy: 'write', context: {}, target: baseTarget() });
    expect(outcome).toEqual({
      kind: 'failed',
      error: { kind: 'not_found', customContentId: 'cc-1', indeterminate: true },
    });
  });

  it('no id at all, but a legacy fallback recovers a doc: opens even when onMiss=fail (the uuid-recovery regression)', async () => {
    const recovered = { ...NULL_DIAGRAM, code: 'from uuid, no customContentId ever existed' } as Diagram;
    const fallback = vi.fn(async (ctx: any) => {
      expect(ctx.pageId).toBe('page-1');
      return recovered;
    });
    const outcome = await openDocument({
      policy: 'read', context: {}, pageId: 'page-1',
      target: baseTarget({ resolveId: () => undefined, onMiss: 'fail', legacyFallbacks: [fallback] }),
    });
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(globals.apWrapper.loadCustomContentWithOrphanRecovery).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      kind: 'opened',
      document: {
        doc: recovered,
        origin: {
          contentId: undefined,
          source: undefined,
          recoveredFromOrphan: true,
          originalCustomContentId: undefined,
          recoveryPageId: 'page-1',
        },
      },
    });
  });
});
