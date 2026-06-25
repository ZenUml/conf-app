import { describe, it, expect } from "vitest";
import { extractPasteToken } from "./pasteToken";

// EAG-98: consumer side of the Phase-1 paste-in bridge. The producer (EAG-97
// `prepare_diagram`) prepends a leading paste-token comment to exported DSL in
// one of three formats. extractPasteToken recovers that token, strictly, from
// the first non-empty line — or returns undefined (the normal case).
describe("extractPasteToken (EAG-98)", () => {
  describe("extracts a leading token in each producer format", () => {
    it("// line comment (ZenUML/Sequence + PlantUml)", () => {
      const dsl = "// zenuml-paste-token: abc123\nA.method() {\n  B.call()\n}";
      expect(extractPasteToken(dsl)).toBe("abc123");
    });

    it("%% line comment (Mermaid)", () => {
      const dsl = "%% zenuml-paste-token: m3rm41d\nsequenceDiagram\n  A->>B: hi";
      expect(extractPasteToken(dsl)).toBe("m3rm41d");
    });

    it("<!-- --> HTML comment (Graph/DrawIO XML)", () => {
      const dsl = "<!-- zenuml-paste-token: gr4ph -->\n<mxGraphModel>...</mxGraphModel>";
      expect(extractPasteToken(dsl)).toBe("gr4ph");
    });
  });

  it("tolerates leading blank lines before the token comment", () => {
    const dsl = "\n\n   \n// zenuml-paste-token: t0ken\nA.b()";
    expect(extractPasteToken(dsl)).toBe("t0ken");
  });

  it("accepts a token of the full 16-char length", () => {
    const tok = "abcdefghij012345"; // 16 chars
    expect(extractPasteToken(`// zenuml-paste-token: ${tok}`)).toBe(tok);
  });

  describe("requires the token comment to be LEADING (first non-empty line)", () => {
    it("returns undefined when the token comment is not the first content line", () => {
      const dsl = "A.method() {\n// zenuml-paste-token: abc123\n}";
      expect(extractPasteToken(dsl)).toBeUndefined();
    });

    it("returns undefined when real content precedes the token comment", () => {
      const dsl = "sequenceDiagram\n%% zenuml-paste-token: abc123";
      expect(extractPasteToken(dsl)).toBeUndefined();
    });
  });

  describe("returns undefined when there is no token comment", () => {
    it("plain DSL with no comment", () => {
      expect(extractPasteToken("A.method() {\n  B.call()\n}")).toBeUndefined();
    });

    it("a non-token leading comment", () => {
      expect(extractPasteToken("// just a normal comment\nA.b()")).toBeUndefined();
    });

    it("empty string", () => {
      expect(extractPasteToken("")).toBeUndefined();
    });

    it("whitespace-only", () => {
      expect(extractPasteToken("   \n\n  ")).toBeUndefined();
    });
  });

  describe("is strict about the token charset and surrounding shape", () => {
    it("rejects an over-length (>16 char) token", () => {
      expect(extractPasteToken("// zenuml-paste-token: abcdefghij0123456")).toBeUndefined();
    });

    it("rejects uppercase / out-of-charset tokens", () => {
      expect(extractPasteToken("// zenuml-paste-token: ABC123")).toBeUndefined();
      expect(extractPasteToken("// zenuml-paste-token: a_b-c")).toBeUndefined();
    });

    it("rejects an HTML comment missing its closing -->", () => {
      expect(extractPasteToken("<!-- zenuml-paste-token: abc123")).toBeUndefined();
    });

    it("rejects trailing junk after the token on a line comment", () => {
      expect(extractPasteToken("// zenuml-paste-token: abc123 extra")).toBeUndefined();
    });
  });
});
