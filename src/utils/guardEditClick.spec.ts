import { describe, it, expect, vi, beforeEach } from 'vitest';
import { guardEditClick, __resetEditGateCache } from '@/utils/guardEditClick';
import { NULL_DIAGRAM } from '@/model/Diagram/Diagram';
import store from '@/model/store2';
import globals from '@/model/globals';
import { toast } from '@/utils/toast';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';

vi.mock('@/model/globals', () => ({
  default: { apWrapper: { countMacrosReferencing: vi.fn() } },
}));
vi.mock('@/utils/toast', () => ({ toast: vi.fn() }));
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }));

const scan = globals.apWrapper.countMacrosReferencing as unknown as ReturnType<typeof vi.fn>;

// The gate's runtime half. The load-bearing property beyond the pure decision
// (editDupGate.spec.ts) is that ONE Edit click costs ONE page-ADF scan and
// produces ONE set of side effects, even though two listeners consult it —
// forgeIndex.ts's shared-entry listener plus the type's own (verified on
// lite-dev: a graph Edit click reaches both).

describe('guardEditClick', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetEditGateCache();
    store.state.diagram = { ...NULL_DIAGRAM };
  });

  it('opens without scanning when the macro has no customContentId', async () => {
    expect(await guardEditClick({ customContentId: undefined, macroType: 'graph' })).toBe(true);
    expect(scan).not.toHaveBeenCalled();
  });

  it('opens for a unique reference', async () => {
    scan.mockResolvedValue(1);
    expect(await guardEditClick({ customContentId: '123', macroType: 'graph' })).toBe(true);
    expect(store.state.diagram.isCopy).toBeFalsy();
    expect(toast).not.toHaveBeenCalled();
  });

  it('refuses a same-page duplicate and flips the viewer into the disabled-Edit state', async () => {
    scan.mockResolvedValue(2);
    expect(await guardEditClick({ customContentId: '123', macroType: 'openapi' })).toBe(false);
    expect(store.state.diagram.isCopy).toBe(true);
    expect(store.state.diagram.copyReason).toBe('same-page-duplicate');
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('pays ONE scan and fires ONE set of side effects when both listeners consult it', async () => {
    scan.mockResolvedValue(3);
    const [a, b] = await Promise.all([
      guardEditClick({ customContentId: '123', macroType: 'graph' }),
      guardEditClick({ customContentId: '123', macroType: 'graph' }),
    ]);
    expect([a, b]).toEqual([false, false]);
    expect(scan).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(trackAnalyticsEvent).toHaveBeenCalledTimes(1);
  });

  it('re-scans for a different customContentId rather than reusing the verdict', async () => {
    scan.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    expect(await guardEditClick({ customContentId: 'aaa', macroType: 'graph' })).toBe(false);
    expect(await guardEditClick({ customContentId: 'bbb', macroType: 'graph' })).toBe(true);
    expect(scan).toHaveBeenCalledTimes(2);
  });

  // The real-world failure shape. AtlasPage swallows every page-ADF fetch
  // error, so countMacrosReferencing signals failure by returning undefined
  // rather than throwing — it must NOT be read as "scanned, found none",
  // which would wave a shared-id macro straight into the editor.
  it('treats an unreadable page ADF (undefined) as scan_failed, not as zero duplicates', async () => {
    scan.mockResolvedValue(undefined);
    expect(await guardEditClick({ customContentId: '123', macroType: 'graph' })).toBe(true);
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'edit_dup_gate_evaluated',
      expect.objectContaining({ edit_dup_gate_outcome: 'scan_failed' }),
    );
    // No count property: we do not know one.
    expect(trackAnalyticsEvent).not.toHaveBeenCalledWith(
      'edit_dup_gate_evaluated',
      expect.objectContaining({ same_page_macro_count: 0 }),
    );
  });

  it('fails OPEN when the scan throws — a network blip must not lock Edit', async () => {
    scan.mockRejectedValue(new Error('403'));
    expect(await guardEditClick({ customContentId: '123', macroType: 'graph' })).toBe(true);
    expect(toast).not.toHaveBeenCalled();
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'edit_dup_gate_evaluated',
      expect.objectContaining({ edit_dup_gate_outcome: 'scan_failed' }),
    );
  });

  it('reports the macro type of the caller that triggered the evaluation', async () => {
    scan.mockResolvedValue(2);
    await guardEditClick({ customContentId: '123', macroType: 'asyncapi' });
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'edit_dup_gate_evaluated',
      expect.objectContaining({ macro_type: 'asyncapi', same_page_macro_count: 2 }),
    );
  });
});
