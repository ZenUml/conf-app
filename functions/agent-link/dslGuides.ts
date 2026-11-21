// Per-dialect DSL-guide registry + selection for the agent-link relay.
//
// The relay serves the RIGHT guide for the session's bound diagram type on
// three surfaces (mcp.ts): `initialize.instructions`, the `update_diagram` tool
// description hint (mcpTools.ts), and the resources (resources/list +
// resources/read). This module is the single place that maps a macro
// `diagramType` → the guide to serve.
//
// IMPORTANT design reality (verified against AgentLinkSession.ts): the bound
// diagramType is known to the relay only AFTER the agent's first read_diagram
// — the macro's channel-connect carries {cloudId,pageId,contentId} but NOT the
// diagram type, and the DO caches diagramType into `lastDiagram` from
// read_diagram / update_diagram. So:
//   • At `initialize` (before any read) the type is unknown → we serve the
//     COMBINED cross-dialect disambiguation guide, which is exactly the right
//     thing when the agent doesn't yet know the dialect either (cross-DSL
//     blending is THE #1 failure across all three dialects).
//   • On per-request surfaces (tools/list, resources) AFTER a read_diagram, the
//     type is known → we sharpen to that single dialect's guide/hint.
//   • A known type with no guide (Graph/AsyncApi/Embed) → NO guide is served
//     (generic behavior); we never push sequence-DSL guidance onto them.
//   • OpenAPI has its own minimal guide (it's a spec, not a diagram DSL — see
//     openApiDslGuide.ts) — a budget-permitting tier added once the mined
//     corpus showed its failures are 100% YAML-structural (§4).
//
// Guides are DATA-DRIVEN from real, sanitized failure signatures — see the
// per-dialect files and evidence/B-signature-mining.md.
//
// MINIMAL-EDIT CONTRACT (in COMBINED_DSL_GUIDE below): ported from the offline
// eval (diagramly.ai-agent-link-eval, Track E1) where it was the single
// biggest validated win for mermaid/plantuml (+60pp class improvement — see
// that repo's reports/E1-nonclean-attribution.md +
// reports/E1-ROUND23-SYNTHESIS.md). Applied here cross-dialect on the same
// "repair, don't redesign" reasoning; this combined guide's own copy was NOT
// individually A/B-tested.

import { normalizeDialect } from './parseDsl';
import {
  ZENUML_DSL_GUIDE,
  ZENUML_DSL_TOOL_HINT,
  ZENUML_DSL_GUIDE_URI,
} from './zenumlDslGuide';
import {
  MERMAID_DSL_GUIDE,
  MERMAID_DSL_TOOL_HINT,
  MERMAID_DSL_GUIDE_URI,
} from './mermaidDslGuide';
import {
  PLANTUML_DSL_GUIDE,
  PLANTUML_DSL_TOOL_HINT,
  PLANTUML_DSL_GUIDE_URI,
} from './plantumlDslGuide';
import {
  OPENAPI_DSL_GUIDE,
  OPENAPI_DSL_TOOL_HINT,
  OPENAPI_DSL_GUIDE_URI,
} from './openApiDslGuide';

/** The dialects we have an authored guide for (three diagram DSLs + the OpenAPI spec format). */
export type GuideDialect = 'zenuml' | 'mermaid' | 'plantuml' | 'openapi';

/** Resolution of a macro diagramType to what should be served. */
export type GuideSelection = GuideDialect | 'combined' | 'none';

interface GuideEntry {
  dialect: GuideDialect;
  guide: string;
  hint: string;
  uri: string;
  resourceName: string;
  resourceDescription: string;
}

const GUIDES: Record<GuideDialect, GuideEntry> = {
  zenuml: {
    dialect: 'zenuml',
    guide: ZENUML_DSL_GUIDE,
    hint: ZENUML_DSL_TOOL_HINT,
    uri: ZENUML_DSL_GUIDE_URI,
    resourceName: 'ZenUML DSL syntax guide',
    resourceDescription:
      'How to write ZenUML sequence DSL for update_diagram — messages, control flow (if/while/opt/par/try-catch), and the constructs LLMs wrongly blend from Mermaid/PlantUML.',
  },
  mermaid: {
    dialect: 'mermaid',
    guide: MERMAID_DSL_GUIDE,
    hint: MERMAID_DSL_TOOL_HINT,
    uri: MERMAID_DSL_GUIDE_URI,
    resourceName: 'Mermaid DSL syntax guide',
    resourceDescription:
      'How to write Mermaid DSL for update_diagram — quoting special characters in labels, no fence leakage, flowchart-vs-sequence syntax.',
  },
  plantuml: {
    dialect: 'plantuml',
    guide: PLANTUML_DSL_GUIDE,
    hint: PLANTUML_DSL_TOOL_HINT,
    uri: PLANTUML_DSL_GUIDE_URI,
    resourceName: 'PlantUML DSL syntax guide',
    resourceDescription:
      'How to write PlantUML DSL for update_diagram — one @startuml/@enduml pair, no sub-type mixing, !define usage, no Mermaid/ZenUML syntax leakage.',
  },
  openapi: {
    dialect: 'openapi',
    guide: OPENAPI_DSL_GUIDE,
    hint: OPENAPI_DSL_TOOL_HINT,
    uri: OPENAPI_DSL_GUIDE_URI,
    resourceName: 'OpenAPI/Swagger spec guide',
    resourceDescription:
      'How to write the OpenAPI/Swagger YAML or JSON document for update_diagram — it is a spec, not a diagram DSL: consistent mapping indentation, no duplicate keys.',
  },
};

/**
 * Combined cross-dialect guide, served when the bound dialect is not yet known
 * (i.e. at `initialize`, before the agent's first read_diagram). Leads with the
 * three-way disambiguation because cross-DSL syntax blending is THE #1 failure
 * mode across all three dialects (see the mining evidence). It is advisory
 * text, never a gate — a Graph/OpenApi/AsyncApi session that happens to see it
 * at connect is explicitly told it does not apply.
 */
export const COMBINED_DSL_GUIDE = `# Writing diagram DSL for update_diagram

This link is bound to ONE diagram of ONE type. Call read_diagram first to see
its \`diagramType\`, then send the FULL replacement \`dsl\` in that type's DSL.
\`rendered:true\` means it PARSED, not that it says what you meant.

## Minimal-edit contract (read FIRST — the single biggest quality lever)
You are REPAIRING the bound diagram, not redesigning it. Change ONLY what
makes the reported error go away; preserve everything else byte-for-byte
(labels, order, style, comments); add nothing the error did not require. A
no-op is a failure, not a safe default — if the DSL already parses and you
can't find the problem, don't return it unchanged; make one small, safe
cosmetic touch instead. The dialect-specific guide (below) has the full
contract and worked examples.

## Pick the right dialect and DO NOT blend them (the #1 real failure)

The most common way agents break these diagrams is mixing one DSL's syntax into
another. Match the bound \`diagramType\` to its dialect and stay inside it:

| diagramType | Dialect | Starts with | Conditionals / structure |
|---|---|---|---|
| \`sequence\` | **ZenUML** | messages directly (no header) | \`if (c) { } else { }\`, \`while (c) { }\` — NO \`alt\`, no \`@startuml\` |
| \`mermaid\` | **Mermaid** | the diagram type (\`flowchart TD\`, \`sequenceDiagram\`) | flowchart edges, or \`sequenceDiagram\` \`alt\`/\`loop\`/\`end\` |
| \`plantuml\` | **PlantUML** | \`@startuml\` … \`@enduml\` | sub-type inferred from body keywords |

Constructs that get wrongly blended — keep each in its own column:
- \`sequenceDiagram\` / \`stateDiagram-v2\` / \`flowchart\` headers → Mermaid only.
- \`@startuml\` / \`@enduml\` → PlantUML only.
- \`alt … else … end\` → Mermaid/PlantUML; ZenUML uses \`if (c) { } else { }\`.
- \`@Actor\` / \`@Database\` annotations → ZenUML only; PlantUML uses bare
  \`actor "X" as Y\`.
- \`A->>B:\` / \`A-->>B:\` async arrows → Mermaid sequence; ZenUML uses \`A->B:\`.

## The one rule that spans all three
Quote any label/alias containing punctuation — \`(\`, \`)\`, \`#\`, commas, spaces
in a name — and always use straight ASCII quotes (\`"\`), never curly/smart
quotes. Unquoted special characters are the single largest parse-failure family
in Mermaid and a recurring one in ZenUML and PlantUML.

## Get the dialect-specific guide
After read_diagram tells you the type, read the matching resource for the full,
failure-ranked rules and worked examples:
\`zenuml://dsl-guide\`, \`mermaid://dsl-guide\`, or \`plantuml://dsl-guide\`.

If the bound diagramType is Graph, OpenApi, AsyncApi, or Embed, none of the
above applies — use that tool's own native format (DrawIO XML, OpenAPI/AsyncAPI
YAML) unchanged.`;

/**
 * One-liner hint for the update_diagram description when the dialect is not yet
 * known (served at connect, before read_diagram) — nudges the agent to match
 * the bound diagram type and read the right resource.
 */
export const COMBINED_DSL_TOOL_HINT =
  'The `dsl` must match the bound diagram type: "sequence" → ZenUML, "mermaid" ' +
  '→ Mermaid, "plantuml" → PlantUML — do NOT blend their syntaxes. Call ' +
  'read_diagram to see the type, then read the matching `zenuml://` / ' +
  '`mermaid://` / `plantuml://dsl-guide` resource.';

/**
 * Resolve a macro `diagramType` to what should be served:
 *   • undefined/blank (type not yet known, e.g. at `initialize`) → 'combined'
 *   • a dialect we have a guide for (zenuml/mermaid/plantuml/openapi) → that dialect
 *   • a known type with no guide (Graph/AsyncApi/Embed/…) → 'none'
 */
export function resolveGuideSelection(diagramType: string | undefined | null): GuideSelection {
  if (diagramType == null || String(diagramType).trim() === '') return 'combined';
  const d = normalizeDialect(diagramType);
  if (d === 'zenuml' || d === 'mermaid' || d === 'plantuml' || d === 'openapi') return d;
  return 'none';
}

/**
 * Instructions to surface on `initialize` for a bound `diagramType`.
 * Returns undefined for a known non-DSL type (serve no guide — generic
 * behavior). Combined when the type is not yet known.
 */
export function selectInstructions(diagramType: string | undefined | null): string | undefined {
  const sel = resolveGuideSelection(diagramType);
  if (sel === 'none') return undefined;
  if (sel === 'combined') return COMBINED_DSL_GUIDE;
  return GUIDES[sel].guide;
}

/**
 * Hint to append to the update_diagram tool description for a bound
 * `diagramType`. Undefined for a known non-DSL type (base description, no
 * dialect hint). Combined when the type is not yet known.
 */
export function selectToolHint(diagramType: string | undefined | null): string | undefined {
  const sel = resolveGuideSelection(diagramType);
  if (sel === 'none') return undefined;
  if (sel === 'combined') return COMBINED_DSL_TOOL_HINT;
  return GUIDES[sel].hint;
}

/**
 * Which server serves the guide:
 *   • 'edit'   — the Confluence relay (mcp.ts): read_diagram + update_diagram on
 *                one bound diagram. The guides are written for this.
 *   • 'render' — the render servers (renderMcp.ts at zenuml.com/mcp and the
 *                local @zenuml/render-mcp package): one tool, render_diagram,
 *                no bound diagram. Those servers have no read_diagram or
 *                update_diagram, so the edit-loop wording would send the agent
 *                to tools that do not exist ("Unknown tool: update_diagram").
 */
export type GuideSurface = 'edit' | 'render';

interface Rewrite {
  from: string;
  to: string;
}

// Render-surface rewrites. Only the sentences that name the edit loop change;
// the failure-ranked rules, examples and minimal-edit contract stay byte-for-byte
// the eval-tested text. Every `from` must match: dslGuides.spec.ts fails when a
// guide edit leaves one unmatched, so the render text can't silently fall back
// to update_diagram wording.
const RENDER_INTRO_COMMON: Rewrite[] = [
  {
    from: 'You are REPAIRING, not redesigning. Change ONLY what makes it parse, then STOP.',
    to:
      'This applies when render_diagram reported errors for a source you are fixing:\n' +
      'you are REPAIRING, not redesigning. Change ONLY what makes it parse, then STOP.',
  },
];

const RENDER_REWRITES: Record<GuideDialect, Rewrite[]> = {
  zenuml: [
    { from: '# Writing ZenUML sequence DSL for update_diagram', to: '# Writing ZenUML sequence DSL for render_diagram' },
    {
      from:
        'The bound diagram type is "sequence" → the `dsl` you pass to update_diagram\n' +
        'must be **ZenUML** sequence DSL. Call read_diagram first, then send the FULL\n' +
        'replacement DSL. `rendered:true` means the DSL PARSED, not that it says what\n' +
        'you meant — for a complex diagram, read it back and confirm the nesting.',
      to:
        'With diagramType "sequence", the `source` you pass to render_diagram must be\n' +
        '**ZenUML** sequence DSL. Send the complete source on every call. A result that\n' +
        'says the source parsed means it PARSED, not that it says what you meant — for a\n' +
        'complex diagram, check the nesting.',
    },
    {
      from: '- If the bound diagram type is actually "mermaid" or "plantuml", ignore all of\n  the above',
      to: '- If the diagram is actually Mermaid or PlantUML, ignore all of\n  the above',
    },
  ],
  mermaid: [
    { from: '# Writing Mermaid DSL for update_diagram', to: '# Writing Mermaid DSL for render_diagram' },
    {
      from:
        'The bound diagram type is "mermaid" → the `dsl` you pass to update_diagram must\n' +
        'be **Mermaid** DSL. Call read_diagram first, then send the FULL replacement DSL.',
      to:
        'With diagramType "mermaid", the `source` you pass to render_diagram must be\n' +
        '**Mermaid** DSL. Send the complete source on every call.',
    },
    {
      from: '- If the bound diagram type is actually "sequence" (ZenUML) or "plantuml",\n  ignore all of the above',
      to: '- If the diagram is actually ZenUML (diagramType "sequence") or PlantUML,\n  ignore all of the above',
    },
  ],
  plantuml: [
    { from: '# Writing PlantUML DSL for update_diagram', to: '# Writing PlantUML DSL for render_diagram' },
    {
      from:
        'The bound diagram type is "plantuml" → the `dsl` you pass to update_diagram\n' +
        'must be **PlantUML** DSL. Call read_diagram first, then send the FULL\n' +
        'replacement DSL.',
      to:
        'With diagramType "plantuml", the `source` you pass to render_diagram must be\n' +
        '**PlantUML** DSL. Send the complete source on every call.',
    },
    {
      from: '- If the bound diagram type is actually "sequence" (ZenUML) or "mermaid",\n  ignore all of the above',
      to: '- If the diagram is actually ZenUML (diagramType "sequence") or Mermaid,\n  ignore all of the above',
    },
  ],
  openapi: [
    { from: '# Writing OpenAPI/Swagger specs for update_diagram', to: '# Writing OpenAPI/Swagger specs for render_diagram' },
    {
      from:
        'The bound diagram type is "openapi" → the `dsl` you pass to update_diagram is\n' +
        'the FULL OpenAPI 3.x (or Swagger 2.0) document',
      to:
        'With diagramType "openapi", the `source` you pass to render_diagram is\n' +
        'the FULL OpenAPI 3.x (or Swagger 2.0) document',
    },
    {
      from: 'Call read_diagram first, then send the\nFULL replacement document.',
      to: 'Send the complete\ndocument on every call.',
    },
    {
      from: '- If the bound diagram type is actually "sequence"/"mermaid"/"plantuml", ignore\n  all of the above',
      to: '- If the diagram is actually ZenUML, Mermaid or PlantUML, ignore\n  all of the above',
    },
  ],
};

/** Apply a dialect's render rewrites. `missed` lists any `from` not found (a test asserts it is empty). */
export function renderGuideText(dialect: GuideDialect): { text: string; missed: string[] } {
  let text = GUIDES[dialect].guide;
  const missed: string[] = [];
  for (const { from, to } of [...RENDER_REWRITES[dialect], ...RENDER_INTRO_COMMON]) {
    if (!text.includes(from)) {
      missed.push(from);
      continue;
    }
    text = text.split(from).join(to);
  }
  return { text, missed };
}

const renderCache = new Map<GuideDialect, string>();
function guideFor(dialect: GuideDialect, surface: GuideSurface): string {
  if (surface === 'edit') return GUIDES[dialect].guide;
  let text = renderCache.get(dialect);
  if (text === undefined) {
    text = renderGuideText(dialect).text;
    renderCache.set(dialect, text);
  }
  return text;
}

function descriptionFor(dialect: GuideDialect, surface: GuideSurface): string {
  const d = GUIDES[dialect].resourceDescription;
  return surface === 'edit' ? d : d.replace(' for update_diagram', ' for render_diagram');
}

/** All dialect guides advertised on resources/list (always all of them, so the agent can pull whichever matches). */
export function listGuideResources(
  surface: GuideSurface = 'edit',
): Array<{ uri: string; name: string; mimeType: string; description: string }> {
  return (Object.keys(GUIDES) as GuideDialect[]).map((k) => ({
    uri: GUIDES[k].uri,
    name: GUIDES[k].resourceName,
    mimeType: 'text/markdown',
    description: descriptionFor(k, surface),
  }));
}

/** Resolve a resource URI (resources/read) to its guide text, or undefined if unknown. */
export function getGuideByUri(uri: string, surface: GuideSurface = 'edit'): { uri: string; text: string } | undefined {
  for (const k of Object.keys(GUIDES) as GuideDialect[]) {
    if (GUIDES[k].uri === uri) return { uri, text: guideFor(k, surface) };
  }
  return undefined;
}

/**
 * Plain guide text by dialect key — the single-source accessor the offline eval
 * (Track E1) and the guides/*.md mirror generator use. 'combined' returns the
 * cross-dialect fallback guide.
 */
export function getGuideText(dialect: GuideDialect | 'combined'): string {
  if (dialect === 'combined') return COMBINED_DSL_GUIDE;
  return GUIDES[dialect].guide;
}

/** The dialect keys that have a plain-text guide + a guides/<key>.md mirror. */
export const GUIDE_KEYS: ReadonlyArray<GuideDialect | 'combined'> = [
  'zenuml',
  'mermaid',
  'plantuml',
  'openapi',
  'combined',
];
