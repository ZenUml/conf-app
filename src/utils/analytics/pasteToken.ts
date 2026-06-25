// EAG-98: consumer side of the Phase-1 paste-in bridge.
//
// The conf-agent-mcp `prepare_diagram` tool (EAG-97) exports DSL with a LEADING
// paste-token comment so a human can paste it into the Confluence editor. When a
// pasted diagram still carries that comment, we stamp the token onto the
// macro_create_succeeded analytics event for best-effort attribution.
//
// Attribution is best-effort: most users strip the comment, so absence is the
// normal case and MUST NOT be treated as an error. We are deliberately strict —
// only a token comment on the FIRST non-empty line counts, and the token charset
// is bounded — so a stray token-shaped string deeper in the DSL never matches.

// Producer comment formats (must match EAG-97 exactly):
//   // zenuml-paste-token: <tok>        ZenUML/Sequence + PlantUml (line comment)
//   %% zenuml-paste-token: <tok>        Mermaid (line comment)
//   <!-- zenuml-paste-token: <tok> -->  Graph/DrawIO XML (HTML comment)
// where <tok> is [a-z0-9]{1,16}.
const TOKEN = "[a-z0-9]{1,16}";
const LEADING_PASTE_TOKEN = new RegExp(
  `^(?:` +
    `(?://|%%)\\s*zenuml-paste-token:\\s*(${TOKEN})` + // // or %% line comment
    `|` +
    `<!--\\s*zenuml-paste-token:\\s*(${TOKEN})\\s*-->` + // <!-- ... --> HTML comment
  `)\\s*$`,
);

/**
 * Extract the paste token from a LEADING token comment (the first non-empty
 * line) of pasted DSL, in any of the three producer formats. Returns the token,
 * or undefined when there is no leading token comment (the normal case).
 */
export function extractPasteToken(dsl: string): string | undefined {
  if (!dsl) return undefined;

  // First non-empty line only. A token comment anywhere below the first content
  // line is NOT a producer handoff — ignore it.
  const firstNonEmpty = dsl
    .split(/\r?\n/)
    .find((line) => line.trim().length > 0);
  if (!firstNonEmpty) return undefined;

  const match = LEADING_PASTE_TOKEN.exec(firstNonEmpty.trim());
  if (!match) return undefined;

  // One of the two capture groups (line-comment vs HTML-comment) holds the token.
  return match[1] ?? match[2];
}
