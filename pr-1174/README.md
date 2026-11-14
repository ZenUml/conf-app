# PR #1174 evidence: list diagrams embedded on a page

- BEFORE: `a0413d4fc7c17257b596c8ff21164c94562d0a67` (merge-base with `main`)
- AFTER: `1750d1685fb4ba7d35169bb26e0cb0862d721209` (PR head)
- Data: live lite-stg (our staging site), three pages, each holding one embed macro in a different stored form.
- Probe: [`probe.spec.ts`](probe.spec.ts) calls the real `callHeadlessTool('list_diagrams', { cloudId, pageId })`. Only the transport is swapped: OAuth URLs are rewritten to the site's REST API with basic auth.

| Page | Embed macro form | BEFORE `diagrams` | AFTER `diagrams` |
|---|---|---|---|
| 277872821 | Forge, `guestParams.customContentId` | `[]` | `12124224` sequence, stored on page 12222500, `embedded: true` |
| 181436418 | Forge, pasted `autoConvertLink` | `[]` | `180224050` graph, stored on page 181141506, `embedded: true` |
| 92766232 | Connect-era, `macroParams.customContentId` | `92536843` sequence (stored on this page) | unchanged: the target is stored on this page, so it is listed once and not marked embedded |

Raw outputs: [`list_diagrams-before.json`](list_diagrams-before.json), [`list_diagrams-after.json`](list_diagrams-after.json).

Limitations: this exercises the tool code against real Confluence data, not the deployed MCP endpoint or claude.ai. No embed of an AsyncAPI-app macro was available on lite-stg; that key is covered by a unit test only.
