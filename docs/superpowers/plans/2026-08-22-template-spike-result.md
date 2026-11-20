# Forge macro in a Confluence space template: GO

Date: 2026-08-22

The internal Lite staging spike passed the complete user lifecycle. Confluence accepted an ADF page template containing a Forge macro, exposed the template in the native template picker, rendered the macro on a page created from that template, and allowed the page editor to create and bind a new custom-content record on the macro's first save.

## Proven extension node

This is the instance-free node submitted to `POST /wiki/rest/api/template`:

```json
{
  "type": "extension",
  "attrs": {
    "layout": "default",
    "extensionType": "com.atlassian.ecosystem",
    "extensionKey": "8ad26115-211f-4216-971b-0540f606303d/5ea0d957-4b7d-47e5-b8cc-7d5fb4fc2338/static/zenuml-sequence-macro-lite",
    "text": "Diagram (Mermaid, PlantUML & ZenUML) Lite (Staging)",
    "parameters": {
      "layout": "extension",
      "forgeEnvironment": "STAGING",
      "extensionId": "ari:cloud:ecosystem::extension/8ad26115-211f-4216-971b-0540f606303d/5ea0d957-4b7d-47e5-b8cc-7d5fb4fc2338/static/zenuml-sequence-macro-lite",
      "extensionTitle": "Diagram (Mermaid, PlantUML & ZenUML) Lite (Staging)",
      "guestParams": {}
    }
  }
}
```

The submitted node deliberately omitted `attrs.localId`, `parameters.localId`, the source macro's `guestParams.customContentId`, and `embeddedMacroContext`. Those values identify the source macro, its page, or its saved diagram and must not be copied into a reusable template.

## Evidence

- Template create: the REST call returned a template id and `editorVersion: v2`.
- Native UI: searching the page editor's Templates panel found the custom template and applying it inserted the heading, intro, and Lite sequence-family macro.
- Published render: the Forge iframe visibly rendered the starter Order Service diagram. Screenshot: [2026-08-22-template-spike.png](assets/2026-08-22-template-spike.png).
- Fresh instance identity: the published page ADF contained a newly stamped `localId` on both the extension and its parameters; its initial `guestParams` had no `customContentId`.
- First-create editor path: page Edit → select macro → macro-toolbar Edit opened the Forge editor with the starter source.
- First save: changing the diagram title and pressing Publish created a version-1 `zenuml-content-sequence` custom-content record owned by the new page. Updating the page persisted that new id in `parameters.guestParams.customContentId`.

The staging build label observed during the UI check was `d52168e`.

## Decision

**GO.** Continue with the one-click space-template offer. The production ADF builder must include `forgeEnvironment` and must generate an empty `guestParams` object; it must never copy source-bound fields.

## Banner visual check

The production Vue component was rendered locally at 1280 px and inspected in all three user-visible states. The idle and success states stay on one row; the failure explanation wraps onto a second row without clipping.

- [Idle offer](assets/2026-08-22-template-offer-idle.png)
- [Template created](assets/2026-08-22-template-offer-created.png)
- [Creation failed](assets/2026-08-22-template-offer-failed.png)
