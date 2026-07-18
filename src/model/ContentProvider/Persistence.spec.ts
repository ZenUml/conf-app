import {saveToPlatform, LegacyLoadBlockedSaveError, InvalidSavedContentIdError} from "@/model/ContentProvider/Persistence";
import {NULL_DIAGRAM, DiagramType} from "@/model/Diagram/Diagram";
import {vi} from "vitest";
import ApWrapper2 from "../ApWrapper2";
import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";
import { syncCustomContent } from "@/services/CustomContent";
import forgeGlobal from "@/model/globals/forgeGlobal";
import macroMetrics from "@/services/MacroMetrics";

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

    it('does NOT call syncCustomContent or fire analytics when legacyLoadBlocked is true', async () => {
      const blocked = {
        ...NULL_DIAGRAM,
        diagramType: DiagramType.Sequence,
        legacyLoadBlocked: true,
      };
      try { await saveToPlatform(blocked as any, mockApWrapper); } catch {}
      expect(syncCustomContent).not.toHaveBeenCalled();
      expect(trackAnalyticsEvent).not.toHaveBeenCalled();
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
      expect(trackAnalyticsEvent).not.toHaveBeenCalled();
      expect(syncCustomContent).not.toHaveBeenCalled();
    });
  });
});
