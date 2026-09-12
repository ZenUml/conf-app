import {saveToPlatform, LegacyLoadBlockedSaveError, InvalidSavedContentIdError} from "@/model/ContentProvider/Persistence";
import {NULL_DIAGRAM, DiagramType} from "@/model/Diagram/Diagram";
import {vi} from "vitest";
import ApWrapper2 from "../ApWrapper2";
import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";
import { syncCustomContent } from "@/services/CustomContent";
import forgeGlobal from "@/model/globals/forgeGlobal";
import macroMetrics from "@/services/MacroMetrics";
import { EditorState, Transaction } from '@codemirror/state';
import {
  recordEditorTransaction,
  resetEditorMutationSession,
  startEditorMutationSession,
} from '@/utils/analytics/editorMutationTelemetry';

global.fetch = () => Promise.resolve(new Response("mock fetch success"));

const mockSave = vi.fn(() => ({id: "mocked_custom_content_id"}));
const mockGetMacroData = async () => {
  return {
    "uuid": "uuid_from_macro_data"
  }
};

//@ts-ignore
const mockApWrapper: ApWrapper2 = {
  getMacroData: mockGetMacroData,
};

vi.mock("@/utils/analytics/trackAnalyticsEvent", () => ({
  trackAnalyticsEvent: vi.fn(),
}));

vi.mock("@/services/CustomContent", () => ({
  syncCustomContent: vi.fn(),
}));

vi.mock("@/services/MacroMetrics", () => ({
  default: {
    reportMacroMetrics: vi.fn(() => Promise.resolve()),
    getMacroMetrics: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock("@/model/ContentProvider/CustomContentStorageProvider", () => {
  return {
    CustomContentStorageProvider: class CustomContentStorageProvider {
      save = mockSave
    }
  }
})

describe('Persistence', function () {

  beforeEach(() => {
    mockSave.mockClear();
    vi.mocked(trackAnalyticsEvent).mockClear();
    vi.mocked(syncCustomContent).mockClear();
    // Reset Forge context so each test starts from a known baseline.
    (forgeGlobal as any).forgeContext = undefined;
    resetEditorMutationSession();
  });

  it('does NOT report macro metrics on save — the editor iframe is torn down on submit/close, which would kill a long enumeration; reporting is moved to editor-open', async () => {
    vi.mocked(macroMetrics.reportMacroMetrics).mockClear();
    await saveToPlatform({ ...NULL_DIAGRAM, diagramType: DiagramType.Sequence }, mockApWrapper);
    expect(macroMetrics.reportMacroMetrics).not.toHaveBeenCalled();
  })

  it('forwards forgeContext.localId to syncCustomContent as the macroUuid', async () => {
    (forgeGlobal as any).forgeContext = { localId: 'forge-local-id' };
    await saveToPlatform({ ...NULL_DIAGRAM, diagramType: DiagramType.Sequence }, mockApWrapper);
    expect(syncCustomContent).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'mocked_custom_content_id' }),
      DiagramType.Sequence,
      'forge-local-id',
    );
  })

  it('falls back to legacy guestParams.uuid when forge localId is absent', async () => {
    (forgeGlobal as any).forgeContext = { localId: undefined };
    await saveToPlatform({ ...NULL_DIAGRAM, diagramType: DiagramType.Sequence }, mockApWrapper);
    expect(syncCustomContent).toHaveBeenCalledWith(
      expect.anything(),
      DiagramType.Sequence,
      'uuid_from_macro_data',
    );
  })

  it('falls back to empty string when neither localId nor legacy uuid is set', async () => {
    (forgeGlobal as any).forgeContext = { localId: undefined };
    const wrapperWithoutLegacyUuid = {
      ...mockApWrapper,
      getMacroData: async () => ({}),
    } as ApWrapper2;
    await saveToPlatform({ ...NULL_DIAGRAM, diagramType: DiagramType.Sequence }, wrapperWithoutLegacyUuid);
    expect(syncCustomContent).toHaveBeenCalledWith(
      expect.anything(),
      DiagramType.Sequence,
      '',
    );
  })

  it('should fire macro_create_succeeded for a new diagram', async () => {
    // NULL_DIAGRAM has id: '' so isNew = true
    await saveToPlatform({ ...NULL_DIAGRAM, diagramType: DiagramType.Sequence }, mockApWrapper);
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      "macro_create_succeeded",
      expect.objectContaining({
        macro_type: expect.any(String),
        operation_mode: "create",
      })
    );
  })

  it('macro_create_succeeded carries content_id, custom_content_id, attachment_name from the freshly saved customContent', async () => {
    await saveToPlatform({ ...NULL_DIAGRAM, diagramType: DiagramType.Sequence }, mockApWrapper);
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      "macro_create_succeeded",
      expect.objectContaining({
        content_id: "mocked_custom_content_id",
        custom_content_id: "mocked_custom_content_id",
        attachment_name: "zenuml-mocked_custom_content_id.png",
      })
    );
  })

  it('macro_create_succeeded carries a numeric save_duration_ms (publish latency)', async () => {
    await saveToPlatform({ ...NULL_DIAGRAM, diagramType: DiagramType.Sequence }, mockApWrapper);
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      "macro_create_succeeded",
      expect.objectContaining({
        save_duration_ms: expect.any(Number),
      })
    );
    const [, props] = vi.mocked(trackAnalyticsEvent).mock.calls[0];
    expect((props as any).save_duration_ms).toBeGreaterThanOrEqual(0);
  })

  it('macro_save_succeeded carries a numeric save_duration_ms (publish latency)', async () => {
    await saveToPlatform({ ...NULL_DIAGRAM, id: 'existing-id', diagramType: DiagramType.Sequence }, mockApWrapper);
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      "macro_save_succeeded",
      expect.objectContaining({
        save_duration_ms: expect.any(Number),
      })
    );
  })

  it('should fire macro_save_succeeded for an existing diagram', async () => {
    await saveToPlatform({ ...NULL_DIAGRAM, id: 'existing-id', diagramType: DiagramType.Sequence }, mockApWrapper);
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      "macro_save_succeeded",
      expect.objectContaining({
        macro_type: expect.any(String),
        operation_mode: "edit",
      })
    );
  })

  it('macro_save_succeeded carries the text editor replacement-session summary', async () => {
    const oldDoc = 'A -> B: hello';
    startEditorMutationSession({
      initialCode: oldDoc,
      macroType: 'sequence',
      operationMode: 'edit',
      customContentId: 'existing-id',
      journeyId: 'journey-1',
      sessionId: 'session-1',
      openedAt: 1_000,
    }, {
      now: () => 1_500,
      readAttribution: () => null,
    });
    const transaction = EditorState.create({ doc: oldDoc }).update({
      changes: { from: 0, to: oldDoc.length, insert: 'A -> B: goodbye' },
      annotations: Transaction.userEvent.of('input.paste'),
    });
    recordEditorTransaction(transaction);
    vi.mocked(trackAnalyticsEvent).mockClear();

    await saveToPlatform({ ...NULL_DIAGRAM, id: 'existing-id', diagramType: DiagramType.Sequence }, mockApWrapper);

    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'macro_save_succeeded',
      expect.objectContaining({
        journey_id: 'journey-1',
        session_id: 'session-1',
        had_global_replace: true,
        global_replace_count: 1,
        post_replace_local_edit_count: 0,
        net_delta_from_open_bucket: 'medium',
        delta_from_last_replace_bucket: 'none',
      }),
    );
  })

  // Copies enter the macro_save_succeeded branch because diagram.id is set to
  // the SOURCE customContentId, but CustomContentStorageProvider.save() creates
  // a brand new record with a DIFFERENT id. Analytics must tag the new id, not
  // the source id from context. Without the explicit override, central
  // enrichment would join the event to the wrong customContent.
  it('macro_save_succeeded for a copied diagram tags the freshly saved id, not the source id', async () => {
    await saveToPlatform(
      { ...NULL_DIAGRAM, id: 'source-id', isCopy: true, diagramType: DiagramType.Sequence } as any,
      mockApWrapper
    );
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      "macro_save_succeeded",
      expect.objectContaining({
        content_id: "mocked_custom_content_id",
        custom_content_id: "mocked_custom_content_id",
        attachment_name: "zenuml-mocked_custom_content_id.png",
      })
    );
  })

  it('should NOT fire analytics for Embed diagram type', async () => {
    await saveToPlatform({ ...NULL_DIAGRAM, diagramType: DiagramType.Embed }, mockApWrapper);
    expect(trackAnalyticsEvent).not.toHaveBeenCalled();
  })

  // ZEN-1170 Defect 1
  describe('legacyLoadBlocked sentinel', () => {
    it('refuses save with LegacyLoadBlockedSaveError when legacyLoadBlocked is true', async () => {
      const blocked = {
        ...NULL_DIAGRAM,
        diagramType: DiagramType.Sequence,
        legacyLoadBlocked: true,
      };
      await expect(saveToPlatform(blocked as any, mockApWrapper)).rejects.toBeInstanceOf(LegacyLoadBlockedSaveError);
    });

    it('does NOT call storage save when legacyLoadBlocked is true', async () => {
      const blocked = {
        ...NULL_DIAGRAM,
        diagramType: DiagramType.Sequence,
        legacyLoadBlocked: true,
      };
      try { await saveToPlatform(blocked as any, mockApWrapper); } catch {}
      expect(mockSave).not.toHaveBeenCalled();
    });

    it('reports a blocked publish without success or sync when legacyLoadBlocked is true', async () => {
      const blocked = {
        ...NULL_DIAGRAM,
        diagramType: DiagramType.Sequence,
        legacyLoadBlocked: true,
      };
      try { await saveToPlatform(blocked as any, mockApWrapper); } catch {}
      expect(syncCustomContent).not.toHaveBeenCalled();
      expect(trackAnalyticsEvent).toHaveBeenCalledWith('macro_publish_blocked', expect.objectContaining({ publish_block_reason: 'legacy_load_blocked' }));
      expect(trackAnalyticsEvent).not.toHaveBeenCalledWith('macro_create_succeeded', expect.anything());
    });

    it('still saves normally when legacyLoadBlocked is undefined or false', async () => {
      await saveToPlatform({ ...NULL_DIAGRAM, diagramType: DiagramType.Sequence, legacyLoadBlocked: false } as any, mockApWrapper);
      expect(mockSave).toHaveBeenCalledTimes(1);
    });

    // ZEN-1170 Defect 1 regression: when a sequence editor encounters a stale
    // customContentId AND a legacy storageUuid AND the content-property read
    // returns 403/5xx/parse-error/unexpected-shape, the editor constructs a
    // placeholder doc that MUST carry legacyLoadBlocked=true. Persistence
    // guard refuses save regardless of doc shape (NULL_DIAGRAM-shaped, empty
    // code, etc).
    it('regression: mixed-state placeholder doc (NULL_DIAGRAM shape + legacyLoadBlocked) is refused', async () => {
      const mixedStatePlaceholder = {
        ...NULL_DIAGRAM,
        diagramType: DiagramType.Sequence,
        code: '',
        mermaidCode: '',
        plantUmlCode: '',
        isNew: false,
        legacyLoadBlocked: true,
      };
      await expect(saveToPlatform(mixedStatePlaceholder as any, mockApWrapper))
        .rejects.toBeInstanceOf(LegacyLoadBlockedSaveError);
      expect(mockSave).not.toHaveBeenCalled();
      expect(syncCustomContent).not.toHaveBeenCalled();
    });
  });

  describe('canonical persistence failures', () => {
    it.each([DiagramType.Sequence, DiagramType.Graph, DiagramType.OpenApi, DiagramType.AsyncApi])('reports a failed create for %s without leaking the API error body', async (diagramType) => {
      const error = Object.assign(new Error('customer title and diagram content'), { status: 403, code: 'FORBIDDEN' });
      mockSave.mockImplementationOnce(() => { throw error; });
      await expect(saveToPlatform({ ...NULL_DIAGRAM, diagramType }, mockApWrapper)).rejects.toBe(error);
      const failures = vi.mocked(trackAnalyticsEvent).mock.calls.filter(([event]) => event === 'macro_save_failed');
      expect(failures).toHaveLength(1);
      expect(failures[0][1]).toMatchObject({ operation_mode: 'create', failure_stage: 'persistence', failure_reason: 'http_error', http_status: 403, error_code: 'FORBIDDEN' });
      expect(JSON.stringify(failures)).not.toContain('customer title');
      expect(trackAnalyticsEvent).not.toHaveBeenCalledWith('macro_create_succeeded', expect.anything());
    });

    it('omits arbitrary error codes and invalid status values', async () => {
      const error = Object.assign(new Error('customer source'), { status: 'customer title', code: 'customer identity' });
      mockSave.mockImplementationOnce(() => { throw error; });
      await expect(saveToPlatform({ ...NULL_DIAGRAM, diagramType: DiagramType.Sequence }, mockApWrapper)).rejects.toBe(error);
      const [, payload] = vi.mocked(trackAnalyticsEvent).mock.calls.find(([name]) => name === 'macro_save_failed')!;
      expect(payload).not.toHaveProperty('error_code');
      expect(payload).not.toHaveProperty('http_status');
      expect(JSON.stringify(payload)).not.toContain('customer');
    });

    it('keeps an edit failure in edit mode and does not call it a creation failure', async () => {
      mockSave.mockImplementationOnce(() => { throw new Error('offline'); });
      await expect(saveToPlatform({ ...NULL_DIAGRAM, id: 'existing', diagramType: DiagramType.Sequence }, mockApWrapper)).rejects.toThrow('offline');
      expect(trackAnalyticsEvent).toHaveBeenCalledWith('macro_save_failed', expect.objectContaining({ operation_mode: 'edit', failure_reason: 'request_failed' }));
    });

    it('does not report telemetry sync failure as a failed Confluence save', async () => {
      vi.mocked(syncCustomContent).mockRejectedValueOnce(new Error('telemetry unavailable'));
      await expect(saveToPlatform({ ...NULL_DIAGRAM, diagramType: DiagramType.Sequence }, mockApWrapper)).rejects.toThrow('telemetry unavailable');
      expect(trackAnalyticsEvent).toHaveBeenCalledWith('macro_create_succeeded', expect.anything());
      expect(trackAnalyticsEvent).not.toHaveBeenCalledWith('macro_save_failed', expect.anything());
    });
  });

  // conf-app#320: a save whose persistence returned no usable id must NOT be
  // treated as success. Previously String(undefined) === "undefined" leaked into
  // macro_create_succeeded AND back into the macro config (permanent orphan).
  describe('invalid saved id (conf-app#320)', () => {
    for (const badId of [undefined, null, 'undefined', ''] as const) {
      it(`throws InvalidSavedContentIdError when the saved customContent id is ${JSON.stringify(badId)}`, async () => {
        mockSave.mockReturnValueOnce({ id: badId } as any);
        await expect(saveToPlatform({ ...NULL_DIAGRAM, diagramType: DiagramType.Sequence }, mockApWrapper))
          .rejects.toBeInstanceOf(InvalidSavedContentIdError);
      });
    }

    it('does NOT fire macro_create_succeeded or syncCustomContent when the saved id is invalid', async () => {
      mockSave.mockReturnValueOnce({ id: undefined } as any);
      try { await saveToPlatform({ ...NULL_DIAGRAM, diagramType: DiagramType.Sequence }, mockApWrapper); } catch {}
      expect(trackAnalyticsEvent).not.toHaveBeenCalledWith('macro_create_succeeded', expect.anything());
      expect(trackAnalyticsEvent).toHaveBeenCalledWith('macro_save_failed', expect.objectContaining({ failure_reason: 'invalid_saved_content_id' }));
      expect(syncCustomContent).not.toHaveBeenCalled();
    });
  });
});
