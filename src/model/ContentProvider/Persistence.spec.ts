import {saveToPlatform} from "@/model/ContentProvider/Persistence";
import {NULL_DIAGRAM, DiagramType} from "@/model/Diagram/Diagram";
import {vi} from "vitest";
import ApWrapper2 from "../ApWrapper2";
import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";
import { syncCustomContent } from "@/services/CustomContent";
import forgeGlobal from "@/model/globals/forgeGlobal";

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
});
