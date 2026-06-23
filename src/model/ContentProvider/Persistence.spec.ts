import {saveToPlatform, LegacyLoadBlockedSaveError, maybeAttachMermaidSvg, maybeAttachGraphSvg, maybeAttachSequenceSvg, maybeAttachPlantUmlSvg, withSaveTimeout} from "@/model/ContentProvider/Persistence";
import {NULL_DIAGRAM, DiagramType} from "@/model/Diagram/Diagram";
import { renderMermaidToSvg } from "@/utils/mermaid/renderMermaidToSvg";
import { renderGraphToSvg } from "@/utils/drawio/renderGraphToSvg";
import { renderSequenceToSvg } from "@/utils/sequence/renderSequenceToSvg";
import { validatePlantUmlSyntax } from "@/utils/plantuml/validate";
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

vi.mock("@/utils/mermaid/renderMermaidToSvg", () => ({
  renderMermaidToSvg: vi.fn(),
}));

vi.mock("@/utils/drawio/renderGraphToSvg", () => ({
  renderGraphToSvg: vi.fn(),
}));

vi.mock("@/utils/sequence/renderSequenceToSvg", () => ({
  renderSequenceToSvg: vi.fn(),
}));

vi.mock("@/utils/plantuml/validate", () => ({
  validatePlantUmlSyntax: vi.fn(),
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

  describe('maybeAttachMermaidSvg (Lever D render cache)', () => {
    beforeEach(() => vi.mocked(renderMermaidToSvg).mockReset());

    it('renders and attaches mermaidSvg for a Mermaid diagram with code', async () => {
      vi.mocked(renderMermaidToSvg).mockResolvedValue('<svg>cached</svg>');
      const d: any = { ...NULL_DIAGRAM, diagramType: DiagramType.Mermaid, mermaidCode: 'graph TD;A-->B' };
      await maybeAttachMermaidSvg(d);
      expect(renderMermaidToSvg).toHaveBeenCalledWith('graph TD;A-->B');
      expect(d.mermaidSvg).toBe('<svg>cached</svg>');
    });

    it('skips non-Mermaid diagrams (no render, no field set)', async () => {
      const d: any = { ...NULL_DIAGRAM, diagramType: DiagramType.Sequence, code: 'A.method()' };
      await maybeAttachMermaidSvg(d);
      expect(renderMermaidToSvg).not.toHaveBeenCalled();
      expect(d.mermaidSvg).toBeUndefined();
    });

    it('clears a stale SVG when re-render fails — no SVG outlives its code (atomicity)', async () => {
      vi.mocked(renderMermaidToSvg).mockResolvedValue(undefined);
      const d: any = { ...NULL_DIAGRAM, diagramType: DiagramType.Mermaid, mermaidCode: 'edited', mermaidSvg: '<svg>STALE</svg>' };
      await maybeAttachMermaidSvg(d);
      expect(d.mermaidSvg).toBeUndefined();
    });

    it('does not cache an oversized SVG (clears instead of bloating the body)', async () => {
      vi.mocked(renderMermaidToSvg).mockResolvedValue('<svg>' + 'x'.repeat(300 * 1024) + '</svg>');
      const d: any = { ...NULL_DIAGRAM, diagramType: DiagramType.Mermaid, mermaidCode: 'big', mermaidSvg: '<svg>STALE</svg>' };
      await maybeAttachMermaidSvg(d);
      expect(d.mermaidSvg).toBeUndefined();
    });
  });

  describe('maybeAttachGraphSvg (Lever D render cache, graph)', () => {
    beforeEach(() => vi.mocked(renderGraphToSvg).mockReset());

    it('Option B: keeps a valid editor-supplied graphSvg WITHOUT the offscreen reload', async () => {
      const d: any = { ...NULL_DIAGRAM, diagramType: DiagramType.Graph, graphXml: '<mxGraphModel/>', graphSvg: '<svg id="from-editor">ok</svg>' };
      await maybeAttachGraphSvg(d);
      expect(renderGraphToSvg).not.toHaveBeenCalled(); // the whole point of Option B
      expect(d.graphSvg).toBe('<svg id="from-editor">ok</svg>');
    });

    it('Option A fallback: no editor SVG → offscreen render attaches graphSvg', async () => {
      vi.mocked(renderGraphToSvg).mockResolvedValue('<svg>graph</svg>');
      const d: any = { ...NULL_DIAGRAM, diagramType: DiagramType.Graph, graphXml: '<mxGraphModel/>' };
      await maybeAttachGraphSvg(d);
      expect(renderGraphToSvg).toHaveBeenCalledWith('<mxGraphModel/>');
      expect(d.graphSvg).toBe('<svg>graph</svg>');
    });

    it('Option A fallback: an oversized editor SVG is not trusted → re-renders', async () => {
      vi.mocked(renderGraphToSvg).mockResolvedValue('<svg>fallback</svg>');
      const huge = '<svg>' + 'x'.repeat(600 * 1024) + '</svg>';
      const d: any = { ...NULL_DIAGRAM, diagramType: DiagramType.Graph, graphXml: '<mxGraphModel/>', graphSvg: huge };
      await maybeAttachGraphSvg(d);
      expect(renderGraphToSvg).toHaveBeenCalled();
      expect(d.graphSvg).toBe('<svg>fallback</svg>');
    });

    it('skips non-Graph diagrams (no render, no field set)', async () => {
      const d: any = { ...NULL_DIAGRAM, diagramType: DiagramType.Mermaid, mermaidCode: 'x' };
      await maybeAttachGraphSvg(d);
      expect(renderGraphToSvg).not.toHaveBeenCalled();
      expect(d.graphSvg).toBeUndefined();
    });

    it('clears graphSvg when no editor SVG and the offscreen render fails (atomicity)', async () => {
      vi.mocked(renderGraphToSvg).mockResolvedValue(undefined);
      const d: any = { ...NULL_DIAGRAM, diagramType: DiagramType.Graph, graphXml: '<edited/>', graphSvg: undefined };
      await maybeAttachGraphSvg(d);
      expect(d.graphSvg).toBeUndefined();
    });
  });

  describe('maybeAttachSequenceSvg (Lever D render cache, sequence)', () => {
    beforeEach(() => vi.mocked(renderSequenceToSvg).mockReset());

    it('renders and attaches sequenceSvg for a Sequence diagram with code', async () => {
      vi.mocked(renderSequenceToSvg).mockResolvedValue('<svg>seq</svg>');
      const d: any = { ...NULL_DIAGRAM, diagramType: DiagramType.Sequence, code: 'A.b()' };
      await maybeAttachSequenceSvg(d);
      expect(renderSequenceToSvg).toHaveBeenCalledWith('A.b()');
      expect(d.sequenceSvg).toBe('<svg>seq</svg>');
    });

    it('skips non-Sequence diagrams (no render, no field set)', async () => {
      const d: any = { ...NULL_DIAGRAM, diagramType: DiagramType.Mermaid, mermaidCode: 'x' };
      await maybeAttachSequenceSvg(d);
      expect(renderSequenceToSvg).not.toHaveBeenCalled();
      expect(d.sequenceSvg).toBeUndefined();
    });

    it('clears a stale sequenceSvg when render fails — no SVG outlives its code (atomicity)', async () => {
      vi.mocked(renderSequenceToSvg).mockResolvedValue(undefined);
      const d: any = { ...NULL_DIAGRAM, diagramType: DiagramType.Sequence, code: 'A.edited()', sequenceSvg: '<svg>STALE</svg>' };
      await maybeAttachSequenceSvg(d);
      expect(d.sequenceSvg).toBeUndefined();
    });

    it('skips caching when the rendered SVG exceeds the size cap', async () => {
      vi.mocked(renderSequenceToSvg).mockResolvedValue('<svg>' + 'x'.repeat(300 * 1024) + '</svg>');
      const d: any = { ...NULL_DIAGRAM, diagramType: DiagramType.Sequence, code: 'A.b()' };
      await maybeAttachSequenceSvg(d);
      expect(d.sequenceSvg).toBeUndefined();
    });
  });

  describe('maybeAttachPlantUmlSvg (Lever D render cache, plantuml — cross-user)', () => {
    beforeEach(() => vi.mocked(validatePlantUmlSyntax).mockReset());

    it('attaches plantUmlSvg from the validator SVG for a valid PlantUml diagram', async () => {
      vi.mocked(validatePlantUmlSyntax).mockResolvedValue({ valid: true, error: null, svg: '<svg>puml</svg>' });
      const d: any = { ...NULL_DIAGRAM, diagramType: DiagramType.PlantUml, plantUmlCode: '@startuml\nA->B\n@enduml' };
      await maybeAttachPlantUmlSvg(d);
      expect(validatePlantUmlSyntax).toHaveBeenCalledWith('@startuml\nA->B\n@enduml');
      expect(d.plantUmlSvg).toBe('<svg>puml</svg>');
    });

    it('skips non-PlantUml diagrams (no validate, no field set)', async () => {
      const d: any = { ...NULL_DIAGRAM, diagramType: DiagramType.Mermaid, mermaidCode: 'x' };
      await maybeAttachPlantUmlSvg(d);
      expect(validatePlantUmlSyntax).not.toHaveBeenCalled();
      expect(d.plantUmlSvg).toBeUndefined();
    });

    it('clears a stale plantUmlSvg when validation fails (atomicity)', async () => {
      vi.mocked(validatePlantUmlSyntax).mockResolvedValue({ valid: false, error: 'syntax error' });
      const d: any = { ...NULL_DIAGRAM, diagramType: DiagramType.PlantUml, plantUmlCode: '@bad', plantUmlSvg: '<svg>STALE</svg>' };
      await maybeAttachPlantUmlSvg(d);
      expect(d.plantUmlSvg).toBeUndefined();
    });
  });

  describe('withSaveTimeout (Lever D save guard — a renderer must never hold the save open)', () => {
    it('resolves when the render finishes before the cap', async () => {
      await expect(withSaveTimeout(Promise.resolve(), 1000)).resolves.toBeUndefined();
    });

    it('resolves (does not hang) when the render never settles — save proceeds uncached', async () => {
      const never = new Promise<void>(() => {}); // models a stalled DrawIO viewer load
      await expect(withSaveTimeout(never, 20)).resolves.toBeUndefined();
    });

    it('resolves (swallows the error) when the render rejects', async () => {
      await expect(withSaveTimeout(Promise.reject(new Error('boom')), 1000)).resolves.toBeUndefined();
    });
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
});
