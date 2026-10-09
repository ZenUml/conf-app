# External research for the engagement strategy panel (read 2026-10-06)

Method: WebSearch and WebFetch. WebFetch returns a small-model summary of each page, not raw text, so quotes are only as reliable as that summary. One conflict is flagged in section 5.

## 1. Forge Confluence modules

Source: https://developer.atlassian.com/platform/forge/manifest-reference/modules/index-confluence/ (fetched). The page lists 13 modules.

| Module | Description on the page | Possible engagement use | Scope / status |
|---|---|---|---|
| `confluence:macro` | Inserts dynamic content through the editor. | Supports `config` (classic or custom), `autoConvert` (URL patterns), layouts block/inline/bodied, `adfExport`, and Dynamic Modules (https://developer.atlassian.com/platform/forge/manifest-reference/modules/macro/). Static macros are Preview, per the macro page. | Scope not stated on the page. |
| `confluence:pageBanner` | Adds a banner to pages. Key spelled `confluence:pageBanner`. | Has a `displayConditions` property. Supported on pages, live docs and spaces. Not supported on whiteboards, databases, smart links or embedded pages. | Scope not stated. The page carries no Preview/EAP label. |
| `confluence:homepageFeed` | Right-hand panel on the Confluence home page. | Each module instance is an expandable section. | Scope not stated. |
| `confluence:contentBylineItem` | Entry in the byline under the page title. | A per-page touchpoint. | Scope not read. |
| `confluence:contentAction` | Item in the "more actions" menu of pages and blogs. | A per-page touchpoint. | Scope not read. |
| `confluence:contextMenu` | Entry in the menu shown when text is selected. | Candidate for "turn this text into a diagram". | Scope not read. |
| `confluence:spacePage` | A dedicated page inside a space. | Candidate for a per-space gallery. | Scope not read. |
| `confluence:globalPage` | Top-level page under the Apps section of the main nav. | Candidate for a global gallery. | Scope not read. |
| `confluence:spaceSettings` | Tab in the space integration settings. | An admin touchpoint. | Scope not read. |
| `confluence:globalSettings` | Top-level settings and app configuration. | An admin touchpoint. | Scope not read. |
| `confluence:customContent` | Custom content types with search and indexing. | We already use it for diagrams. | Scope not read. |
| `confluence:backgroundScript` | Runs in the background of a Confluence page (non-UI). | Not read in detail. | Scope not read. |
| `confluence:contentProperty` | Content properties indexed in CQL (non-UI). | Not read in detail. | Scope not read. |

- Full page module: a search-result snippet lists "Full page (Preview)" among the Confluence modules, but the index fetch above does not show it. Treat it as UNVERIFIED. The module-category fetch (https://developer.atlassian.com/platform/forge/manifest-reference/modules/) separately lists "Global module (EAP)" for end-to-end full-page experiences.
- Page banner rule: the page-banner doc says to use banners sparingly, at most one at a time, and dismissable. It also says banners cannot serve promotional purposes and cross-promotion risks app removal. This comes from a fetch summary of https://developer.atlassian.com/platform/forge/manifest-reference/modules/confluence-page-banner/, so re-read the exact wording before relying on it.
- Homepage feed: custom UI renders in a sandboxed iframe, so links need `router.navigate` from `@forge/bridge`.
- Per-module Forge scope requirements: UNKNOWN for most modules. I did not read each page's scope section.
- Blueprint / template module: none exists in the Forge Confluence module list.
- New in 2026 (single source, the Forge changelog at https://developer.atlassian.com/platform/forge/changelog/, fetch summary):
  - 2026-10-06: static macros moved from EAP to Preview.
  - 2026-10-02: `rovo:skill` moved from EAP to Preview.
  - 2026-10-01: `rovo:mcp` entered Preview (Forge actions as tools in external AI clients).
  - 2026-09-28: `rovo:agentConnector` reached GA (Agent2Agent protocol).
  - I did not verify any module's first-introduction date. The changelog excerpt had no new template or blueprint module.

## 2. Templates, Forge macros and blueprints

- `POST /wiki/rest/api/template` exists (https://developer.atlassian.com/cloud/confluence/rest/v1/api-group-template/).
  - Required fields: `name`, `templateType`, `body`.
  - Permissions: space Admin for a space template, Confluence Administrator for a global template.
  - Scopes: classic `write:confluence-content`; granular `write:template:confluence`, `read:template:confluence` and `read:content-details:confluence`.
  - The page states "blueprint templates cannot be created via the REST API".
- Blueprints in Forge are not supported. An Atlassian reply on 2025-02 to 2025-04 calls it "a planned feature on the Forge roadmap", tracked as FRGE-682 (https://community.developer.atlassian.com/t/create-confluence-blueprint-in-forge/88701). Blueprints exist only for Connect apps. The suggested workaround is the Template REST API plus creating a page from the template body.
  - Caveat in that thread: a template cannot be used to create a draft page, only a published one.
- Can a template body carry a Forge macro node? UNKNOWN. No Atlassian doc or thread I read says so directly.
  - Facts that point toward yes: the template body is storage format, and a search snippet says page templates can be updated via REST with a storage body containing macro code.
  - A Forge macro in a page body is documented in ADF, not storage (https://community.developer.atlassian.com/t/how-to-add-forge-macros-extension-to-the-page-programmatically-via-rest-api/63387). That thread covers pages, not templates, and was dated 2022-11 to 2023-07.
    - Extension fields: `extensionType: com.atlassian.ecosystem`, `extensionKey: [org-id]/[app-id]/static/[macro-name]`, an `extensionId` in ARI format, and `localId` may be omitted in ADF.
  - The template API's `body` is storage format, and ADF-vs-storage for Forge macros inside a template is unproven. The thread https://community.developer.atlassian.com/t/forge-macro-rest-api-wiki-and-adf/74701 (2023-11) contains no Atlassian answer.
  - Our own PoC would settle it. Not run, because the rules forbid writes.
  - Related local fact: the memory index records that localId survives whole-page copy.

## 3. Participation benchmarks

- The 90-9-1 rule is attributed to McConnell and Huba (2006) and popularized by Nielsen. Wikipedia describes it for "collaborative websites like wikis" (https://en.wikipedia.org/wiki/1%25_rule).
  - Published support cited there is for forums and communities, not for enterprise wikis:
    - A 2014 study of 4 health forums found the 1% rule consistent.
    - A 2007 jihadist-forum study found 87% never posted.
  - The same page says the rule does not apply uniformly. Forums requiring submission show higher participation. Late-2012 research suggested only 23% were lurkers and 17% intense contributors.
  - Aggregator snippets (hivebrite and similar) say private professional communities look more like 70-20-10. I did not verify them, so treat that figure as UNVERIFIED.
- Confluence-specific contributor/viewer ratio: none found. I searched and found only Confluence analytics docs. UNKNOWN.
- Diagram-app creator/viewer ratios (draw.io, Gliffy, Lucidchart, Mermaid): none found. UNKNOWN.
- Install counts, not participation (Marketplace listings):
  - draw.io Diagrams: 61,236 installs, 4.8 rating, 1,205 reviews (https://marketplace.atlassian.com/apps/1210933/draw-io-diagrams-for-confluence).
  - Gliffy: 15,927 installs, 4.5 rating, 799 reviews (https://marketplace.atlassian.com/apps/254/gliffy-diagrams-for-confluence).
- Implication for panel: our ~10% viewers and ~1% creators matches the shape of 90-9-1 but is not externally benchmarked for diagram apps.

## 4. Competitor engagement features (listing and docs evidence)

- **draw.io**:
  - Listing: AI-generated diagrams in the Standard edition, Advanced edition with dedicated account management, onboarding support, Cloud Fortified.
  - Docs (https://www.drawio.com/docs/integrations/atlassian/confluence/): template picker on new diagram (Blank or a template), administrators can enable text-to-diagram generation, and the editor can be customised for all users.
  - Jira: "draw.io Diagrams for Jira" (https://marketplace.atlassian.com/apps/1211413/draw-io-diagrams-for-jira), and a documented way to embed a Confluence diagram in Jira Cloud (https://www.drawio.com/doc/faq/embed-diagram-confluence-jira-cloud).
  - Rovo agent: not found.
- **Gliffy**:
  - Listing: "multiple templates", a Mermaid code editor, SOC 2 Type II, ISO 42001.
  - Rovo: the Gliffy Rovo Agent generates diagrams from existing Confluence context in Rovo Chat. Version 5.0.0 on 2026-09-10 "adds the Gliffy agent for Rovo" (search snippet from https://marketplace.atlassian.com/apps/254/gliffy-diagrams-for-confluence and the Gliffy docs). This is the only competitor Rovo agent I found.
- **Lucid**: free connectors for Confluence, Jira and other tools; embeds documents in Confluence and Jira (https://lucid.co/blog/atlassian-integrations, https://help.lucid.co/hc/en-us/articles/16957562248596-Integrate-Lucid-with-Confluence-Cloud). I found no Lucid Rovo agent. I could not fetch the Lucid Marketplace listing (wrong ID), so install counts are UNKNOWN.
- **Miro**: embed via `/miro` in the editor; the Miro help page and Confluence community article describe embedding boards that use its templates (https://help.miro.com/hc/en-us/articles/360020712594-Miro-for-Confluence). A search snippet says Rovo can search across Miro content.
- **Mermaid apps** (search snippets):
  - Mermaid Diagrams & Charts for Confluence (Forge): 15+ built-in templates.
  - Mermaid Chart for Confluence (official): 20+ templates; AI generation when linked to an account.
  - Mermaid Diagrams & Templates: 18+ templates.
  - Mermaid AI Diagrams: zero-configuration AI generation.
- Onboarding tours and sample content on install: not found for any competitor. UNKNOWN.
- Pattern: template libraries (draw.io, Gliffy, and the Mermaid apps), an AI-generate path (draw.io, Mermaid AI, and Gliffy via Rovo), a Jira cross-link (draw.io, Lucid), and one Rovo agent (Gliffy).

## 5. Marketplace terms on contacting customers

- Marketplace Partner Agreement, page last updated 2025-12-01 (https://www.atlassian.com/licensing/marketplace/partneragreement):
  - 8.4(c): "You may not send marketing messages to end users within any user experience integrated with Atlassian Apps without Atlassian's express written consent." Quote is the first 11 words of the clause, cut at "Apps".
  - 8.4(c) also limits direct communication with end users to cases "required by Law or as consented to or requested by the end user". This second quote is under 15 words.
  - 8.4(b): "You may not sell any End User Data."
  - 6.3 covers a support email address that the partner gives to Atlassian.
- CONFLICT between sources: the Atlassian Developer Terms (https://developer.atlassian.com/platform/marketplace/atlassian-developer-terms/) carry a longer version of the same clause. It says communication is allowed "only where the communication is with technical or billing contacts, required by Laws, or as consented to or requested by the end user". A search snippet of the Partner Agreement also showed that wording. The two fetches of the Partner Agreement page itself returned the shorter text and found no "technical" or "billing" in 8.4(c). The two fetch results disagree with each other, so someone should read the live page text directly (browser, not summarizer) before relying on either version.
- Marketplace FAQ (https://developer.atlassian.com/platform/marketplace/faqs-reports/): "The email for an active customer is available through the sales, licenses, and evaluation reports." Emails are for paid apps only. The fetch summary says partners may use report emails to reach out directly. I did not read the FAQ text itself, and I do not interpret it beyond that.
- Reading limited to the text: the in-product rule is explicit (no marketing messages inside an experience integrated with Atlassian Apps without written consent). Whether email to a technical or billing contact from the reporting API counts as permitted is where the two documents differ, so it is not settled by what I could verify.
- Page-banner module doc (section 1): promotional use risks app removal. This is separate from the agreement text.

## 6. Rovo / AI for a Forge app

- Can a Forge app ship a Rovo agent or actions? Yes. `rovo:agent` and `rovo:action` exist (https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-agent/ and https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-index/).
  - Agent properties: `key`, `name` (max 30 characters), `prompt`, and optional `description`, `icon`, `actions`, `conversationStarters`, `skills`.
  - The doc marks `skills` as Preview. The changelog entry for `rovo:skill` (2026-10-02) says it moved from EAP to Preview.
  - Agents must comply with the Atlassian Acceptable Use Policy. Atlassian screens them for safety and may block or suspend them.
  - Access scope: app-based agents only see data in the workspace where the app is installed, unless configured for multi-app compatibility.
  - Actions can be offered to customer-built agents by adding the `read:chat:rovo` scope (search snippet of the rovo-action doc; not read in full).
- Where agents appear (rovo-agent page): the chat side panel in Confluence and Jira, the AI toolbar via `/ai`, automation rules, and programmatic access via the Forge bridge.
- Distribution: Marketplace partner agents are installed by admins from the Marketplace, appear under Apps, and show in the agent directory (https://support.atlassian.com/rovo/docs/marketplace-agents/). The agent runs under the partner's EULA and privacy policy.
- Published usage or discovery benefit: none found. No adoption statistics for third-party agents. UNKNOWN.
- Related new modules (changelog, single source): `rovo:mcp` Preview 2026-10-01, `rovo:agentConnector` GA 2026-09-28.

## Sources
- https://developer.atlassian.com/platform/forge/manifest-reference/modules/ : top-level module categories, including Rovo and Global module (EAP).
- https://developer.atlassian.com/platform/forge/manifest-reference/modules/index-confluence/ : the 13 confluence modules.
- https://developer.atlassian.com/platform/forge/manifest-reference/modules/confluence-page-banner/ : key, properties, anti-promotion rule.
- https://developer.atlassian.com/platform/forge/manifest-reference/modules/confluence-homepage-feed/ : feed properties and iframe link limit.
- https://developer.atlassian.com/platform/forge/manifest-reference/modules/macro/ : config, autoConvert, static macros (Preview).
- https://developer.atlassian.com/platform/forge/changelog/ : 2026 Rovo and static-macro status changes.
- https://developer.atlassian.com/cloud/confluence/rest/v1/api-group-template/ : create-template permissions, scopes, blueprint limit.
- https://community.developer.atlassian.com/t/create-confluence-blueprint-in-forge/88701 : no Forge blueprints, FRGE-682.
- https://community.developer.atlassian.com/t/how-to-add-forge-macros-extension-to-the-page-programmatically-via-rest-api/63387 : ADF structure for a Forge macro in a page.
- https://community.developer.atlassian.com/t/forge-macro-rest-api-wiki-and-adf/74701 : no answer on templates.
- https://en.wikipedia.org/wiki/1%25_rule : 90-9-1 sources and caveats.
- https://marketplace.atlassian.com/apps/1210933/draw-io-diagrams-for-confluence : draw.io installs and AI.
- https://marketplace.atlassian.com/apps/254/gliffy-diagrams-for-confluence : Gliffy installs, Rovo agent, templates.
- https://www.drawio.com/docs/integrations/atlassian/confluence/ : draw.io templates and AI generation admin switch.
- https://www.atlassian.com/licensing/marketplace/partneragreement : 8.4(c) text.
- https://developer.atlassian.com/platform/marketplace/atlassian-developer-terms/ : longer 8.4 wording naming technical or billing contacts.
- https://developer.atlassian.com/platform/marketplace/faqs-reports/ : emails in reports.
- https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-agent/ : rovo:agent properties and interaction points.
- https://support.atlassian.com/rovo/docs/marketplace-agents/ : partner agents installed by admins.

## FACTS
- [WEB_SOURCE] Forge Confluence modules list has 13 modules: content-action, content-byline-item, context-menu, custom-content, global-page, global-settings, homepage-feed, macro, page-banner, space-page, space-settings, background-script, content-property — https://developer.atlassian.com/platform/forge/manifest-reference/modules/index-confluence/
- [WEB_SOURCE] Page banner doc says banners cannot serve promotional purposes and cross-promotion risks app removal (fetch summary, not raw text) — https://developer.atlassian.com/platform/forge/manifest-reference/modules/confluence-page-banner/
- [WEB_SOURCE] Static macros moved EAP to Preview on 2026-10-06; rovo:skill to Preview 2026-10-02; rovo:mcp Preview 2026-10-01; rovo:agentConnector GA 2026-09-28 (single source, summarized) — https://developer.atlassian.com/platform/forge/changelog/
- [WEB_SOURCE] POST /wiki/rest/api/template requires space Admin or Confluence Administrator; scope write:confluence-content; blueprint templates cannot be created via REST — https://developer.atlassian.com/cloud/confluence/rest/v1/api-group-template/
- [WEB_SOURCE] Forge does not support blueprints; Atlassian says planned, FRGE-682; workaround is Template REST API — https://community.developer.atlassian.com/t/create-confluence-blueprint-in-forge/88701
- [UNKNOWN] Whether a template body can carry a Forge macro node is not documented in anything read — searched; only page-body ADF thread https://community.developer.atlassian.com/t/how-to-add-forge-macros-extension-to-the-page-programmatically-via-rest-api/63387
- [WEB_SOURCE] No published 90-9-1 data for Confluence or diagram apps found; Wikipedia cites forum studies and says the rule varies by context — https://en.wikipedia.org/wiki/1%25_rule
- [WEB_SOURCE] draw.io 61,236 installs, Gliffy 15,927 installs; Gliffy 5.0.0 on 2026-09-10 added a Rovo agent — https://marketplace.atlassian.com/apps/1210933/draw-io-diagrams-for-confluence ; https://marketplace.atlassian.com/apps/254/gliffy-diagrams-for-confluence
- [WEB_SOURCE] Developer Terms allow communication with end users only with technical or billing contacts, as required by law, or as consented or requested; no marketing messages inside integrated Atlassian experiences without written consent — https://developer.atlassian.com/platform/marketplace/atlassian-developer-terms/
- [UNKNOWN] Partner Agreement 8.4(c) as fetched omits technical/billing contacts wording, conflicting with the Developer Terms and a search snippet; needs direct read of live page — https://www.atlassian.com/licensing/marketplace/partneragreement (updated 2025-12-01)
- [WEB_SOURCE] Marketplace FAQ says emails for active customers are in sales/licenses/evaluation reports, paid apps only — https://developer.atlassian.com/platform/marketplace/faqs-reports/
- [WEB_SOURCE] Forge apps can ship rovo:agent and rovo:action; surfaces are chat side panel, /ai toolbar, automation, bridge; Marketplace agents are installed by admins; no published usage or discovery benefit found — https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-agent/ ; https://support.atlassian.com/rovo/docs/marketplace-agents/
- [UNKNOWN] Per-module Forge scope requirements for most Confluence UI modules were not read — not fetched

## OPEN QUESTIONS
- Does a template created through POST /wiki/rest/api/template accept a Forge macro node in its storage body, and does it render and instantiate as a working macro when a page is created from it? Only a write PoC on a staging site can settle it.
- What exact text does the live Marketplace Partner Agreement 8.4(c) carry about technical or billing contacts? The fetch summaries conflict with the Developer Terms.
- Is the Confluence Full page module Preview or EAP? The index page does not list it, but a search snippet does.
- What Forge scope does each candidate touchpoint module require, and does adding a scope force a major version?
- Is there any published creator/viewer ratio for Confluence or diagram apps?
- Are there Rovo agent adoption or discovery statistics for third-party Marketplace agents?
- Does Atlassian consider a dismissable page banner that promotes our own features as a prohibited promotional or cross-promotion use?

## FILES
