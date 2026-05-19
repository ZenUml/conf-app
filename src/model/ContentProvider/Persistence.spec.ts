import {saveToPlatform} from "@/model/ContentProvider/Persistence";
import {NULL_DIAGRAM, DiagramType} from "@/model/Diagram/Diagram";
import {vi} from "vitest";
import ApWrapper2 from "../ApWrapper2";
import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";

global.fetch = () => Promise.resolve(new Response("mock fetch success"));

const mockSave = vi.fn(() => ({id: "mocked_custom_content_id"}));
const mockSaveMacro = vi.fn();
const mockIsInContentEditOrContentCreate = vi.fn();
const mockGetMacroData = async () => {
  return {
    "uuid": "uuid_from_macro_data"
  }
};

//@ts-ignore
const mockApWrapper: ApWrapper2 = {
  getMacroData: mockGetMacroData,
  saveMacro: mockSaveMacro,
  isInContentEditOrContentCreate: mockIsInContentEditOrContentCreate
};

vi.mock("@/utils/analytics/trackAnalyticsEvent", () => ({
  trackAnalyticsEvent: vi.fn(),
}));

vi.mock("@/model/ContentProvider/CustomContentStorageProvider", () => {
  return {
    CustomContentStorageProvider: class CustomContentStorageProvider {
      save = mockSave
    }
  }
})

vi.mock('@/utils/uuid', () => {
  return {
    default: 'random_uuid'
  }
})

describe('Persistence', function () {

  beforeEach(() => {
    mockSaveMacro.mockClear();
    mockIsInContentEditOrContentCreate.mockClear();
    mockSave.mockClear();
    vi.mocked(trackAnalyticsEvent).mockClear();
  });

  it('should save the diagram in content edit mode', async () => {
    mockIsInContentEditOrContentCreate.mockReturnValue(true);
    await saveToPlatform(NULL_DIAGRAM, mockApWrapper);
    expect(mockSave).toBeCalledWith(NULL_DIAGRAM);
    expect(mockSaveMacro).toBeCalledWith(expect.objectContaining({
      "uuid": "uuid_from_macro_data",
      "customContentId": "mocked_custom_content_id"
    }), '')
  })

  it('should not save macro in content view mode', async () => {
    mockIsInContentEditOrContentCreate.mockReturnValue(false);
    await saveToPlatform(NULL_DIAGRAM, mockApWrapper);
    expect(mockSave).toBeCalledWith(NULL_DIAGRAM);
    expect(mockSaveMacro.mock.calls.length).toBe(0);
  })

  it('should fire macro_create_succeeded for a new diagram', async () => {
    mockIsInContentEditOrContentCreate.mockReturnValue(false);
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
    mockIsInContentEditOrContentCreate.mockReturnValue(false);
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
    mockIsInContentEditOrContentCreate.mockReturnValue(false);
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
    mockIsInContentEditOrContentCreate.mockReturnValue(false);
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
    mockIsInContentEditOrContentCreate.mockReturnValue(false);
    await saveToPlatform({ ...NULL_DIAGRAM, diagramType: DiagramType.Embed }, mockApWrapper);
    expect(trackAnalyticsEvent).not.toHaveBeenCalled();
  })
});
