import { extractMxGraphModelForViewer } from "@/model/Graph/extractMxGraphModel";

describe("extractMxGraphModelForViewer", () => {
  it("returns empty string for nullish input", () => {
    expect(extractMxGraphModelForViewer(undefined)).toBe("");
    expect(extractMxGraphModelForViewer(null)).toBe("");
    expect(extractMxGraphModelForViewer("")).toBe("");
  });

  it("passes through legacy <mxGraphModel> input unchanged", () => {
    const legacy = `<mxGraphModel dx="100"><root><mxCell id="0"/></root></mxGraphModel>`;
    expect(extractMxGraphModelForViewer(legacy)).toBe(legacy);
  });

  it("tolerates leading whitespace before <mxGraphModel>", () => {
    const legacy = `\n  <mxGraphModel><root/></mxGraphModel>`;
    expect(extractMxGraphModelForViewer(legacy)).toBe(legacy);
  });

  it("extracts the first <mxGraphModel> from a single-page <mxfile>", () => {
    const mxfile = `<mxfile><diagram name="Page-1"><mxGraphModel dx="100"><root><mxCell id="0"/></root></mxGraphModel></diagram></mxfile>`;
    const result = extractMxGraphModelForViewer(mxfile);
    expect(result).toContain('<mxGraphModel');
    expect(result).toContain('dx="100"');
    expect(result).not.toContain("<mxfile");
    expect(result).not.toContain("<diagram");
  });

  it("extracts only Page-1's <mxGraphModel> from a multi-page <mxfile>", () => {
    const mxfile = `<mxfile>
      <diagram name="Page-1"><mxGraphModel><root><mxCell id="page1-cell"/></root></mxGraphModel></diagram>
      <diagram name="Page-2"><mxGraphModel><root><mxCell id="page2-cell"/></root></mxGraphModel></diagram>
    </mxfile>`;
    const result = extractMxGraphModelForViewer(mxfile);
    expect(result).toContain("page1-cell");
    expect(result).not.toContain("page2-cell");
    expect(result).not.toContain("<mxfile");
  });

  it("returns input unchanged when parsing fails or no <mxGraphModel> is found", () => {
    const garbage = "not really xml at all";
    expect(extractMxGraphModelForViewer(garbage)).toBe(garbage);
    const noModel = `<mxfile><diagram name="Page-1"></diagram></mxfile>`;
    expect(extractMxGraphModelForViewer(noModel)).toBe(noModel);
  });
});
