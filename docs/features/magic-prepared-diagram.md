# Magic prepared diagram artifact

Magic is a Fullscreen Mermaid view of an SVG prepared ahead of time from the same Mermaid input. Clicking Magic never requests generation. The original `mermaidCode` remains the editable source and is shown again by Original. Confluence custom content is the storage location for both source and optional artifact; the viewer does not need the Cloudflare backend to display either.

The optional top-level `magic` field in the diagram body is:

```json
{
  "sourceHash": "lowercase SHA-256 hex of exact UTF-8 mermaidCode",
  "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" ...>...</svg>",
  "rulesVersion": "magic-v1",
  "outcome": "validated",
  "generatedAt": "2026-10-01T00:00:00.000Z"
}
```

`generatedAt` is optional. `outcome: "validated"` records a completed producer review, including visual comparison to the source and checking that the SVG has the intended meaning. The viewer **does not trust this flag as a security check**: it recalculates the source hash and rebuilds the SVG from an allowlist. Script, foreignObject, event handlers, external resources, and unsafe CSS make the artifact unavailable. The allowlist supports local `url(#id)` marker references and a limited CSS subset: element, class, ID, and descendant selectors; comma-separated selector lists; and presentation declarations for paint, stroke, opacity, markers, and font. It converts those declarations to presentation attributes and removes the stylesheet. For overlapping rules, CSS specificity and source order apply; inline style wins over stylesheet rules, and stylesheet rules win over presentation attributes. Unsupported CSS (including `!important` and variables) makes the artifact unavailable so visual meaning is not silently lost. SVGs needing other selectors or layout rules should be converted to presentation attributes by the producer before review.

To prepare a local draft, use a copy of a synthetic or authorized diagram body in a private working directory. Read `mermaidCode` from that JSON file, generate the improved SVG separately, then calculate its hash over the exact stored string. This command shows the hash and a draft artifact without editing or contacting Confluence:

```bash
node - body.json prepared.svg <<'NODE'
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const body = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (body.diagramType !== 'mermaid' || typeof body.mermaidCode !== 'string') throw Error('Expected Mermaid body');
const svg = fs.readFileSync(process.argv[3], 'utf8');
const sourceHash = createHash('sha256').update(body.mermaidCode, 'utf8').digest('hex');
console.log(JSON.stringify({ sourceHash, svg, rulesVersion: 'magic-v1', outcome: 'needs_review' }, null, 2));
NODE
```

After the SVG passes visual and security review, set `outcome` to `validated` and attach it as `body.magic` in a local copy. The writer should compare the stored `mermaidCode` immediately before publishing and abandon the update if it changed. The local draft process does not perform a remote write. The source hash does not normalize Mermaid whitespace; even a trailing newline change makes an artifact stale. A subsequent edit can leave the old artifact in storage, but the viewer will keep showing Original until a new artifact matches.

For a test fixture, use invented labels and IDs. Never commit a real tenant body, SVG, content ID, or hash to the public repository.
