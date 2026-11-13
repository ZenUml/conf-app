# ZenUML for Confluence

The Confluence Cloud add-on (Forge app) whose macros present diagrams, API specifications, Markdown documents, and references inside Confluence pages.

## Language

**Macro（宏）**:
A Confluence page element that presents or references content and has its own configuration. Use “macro” for operations spanning macro types, such as insert, view, edit, and configure; an OpenAPI or AsyncAPI macro is not a diagram.
_Avoid_: using “diagram” as the collective name for all macros.

**Diagram（图表）**:
Graphical content such as a ZenUML sequence diagram, a Mermaid diagram, a PlantUML diagram, or a DrawIO graph. A diagram is content presented by a macro, rather than a synonym for the macro instance, an API specification, or a Markdown document.

**Content document（内容文档）**:
The document containing a macro's source content, such as a diagram, API specification, or Markdown text. A saved content document and the macro instance that presents or references it are separate objects.

**API specification（API 规范）**:
An OpenAPI or AsyncAPI description presented through its respective macro. It remains an API specification when viewed or edited; a graphical presentation does not make the entire specification a diagram.

**Editing a macro（编辑宏）**:
The general operation of changing a macro's content or configuration. Name the precise object when relevant: edit diagram source, edit an API specification, or change an Embed reference.
_Avoid_: “edit a diagram” when the operation spans macro types.

**Diagram macro**:
The Confluence macro that renders ZenUML, Mermaid, and PlantUML diagrams. Title shown in the macro browser is "Diagram (Mermaid, PlantUML & ZenUML)".
_Avoid_: Sequence macro (legacy internal key), bare "Diagram" (ambiguous with Confluence's native whiteboard).

**Graph macro**:
The Confluence macro that renders DrawIO-powered graph diagrams. Title is "Graph (DrawIO)".

**OpenAPI macro**:
The Confluence macro that renders OpenAPI / Swagger API specifications.

**Embed macro**:
A Confluence macro that embeds an existing Diagram, Graph, or OpenAPI rendering from elsewhere.

**DiagramType**:
The existing code-level content discriminator: ZenUML (`Sequence`), Mermaid, Markdown, PlantUML, Graph, OpenAPI, AsyncAPI, or Embed. The name also covers API specifications, Markdown, and references; it does not classify all supported content as diagrams.
_Avoid_: treating a macro name, Feature, or Variant as a DiagramType.

**Variant**:
A product edition of the add-on: Lite, Full, Diagramly, or AsyncAPI. Variant is an applicability condition for a capability, rather than a Feature or Interface.

**Over-limit space**:
A Confluence space whose macro count exceeds the applicable usage threshold. Eligibility for a Paywall banner and for Fullscreen access recovery are separate policies; their exact thresholds belong to the relevant contracts in `IMPACT-MAP.md`.
_Avoid_: saturated space, paywalled space (a usage condition does not itself say which actions are blocked).

**Paywall banner**:
The non-blocking Lite page notice that explains a space's usage limit and offers plan or purchase guidance to eligible viewers. It is one part of the `paywall` Feature, distinct from Fullscreen access recovery.
_Avoid_: using “paywall” to mean every access restriction or upgrade interface.

**Fullscreen access recovery**:
The conditional request and temporary-access journey for Fullscreen in eligible Lite spaces. Its Feature ID is `fullscreen-access-recovery`, distinct from non-blocking usage guidance (`paywall`) and from the `fullscreen-recovery` Interface that presents the journey.

**Recent author**:
A user who created or edited a macro in a given space within the last 30 days, as recorded in that browser's localStorage. The original [[Paywall banner]] audience; in the 30 days to 2026-09-07 it excluded ~93% of the people viewing over-limit spaces.

**Space admin**:
A Confluence *space* administrator of the current space, resolved by a 30-day-throttled REST probe. Can buy the per-space Enterprise Bundle alone; is **not** a site admin and cannot buy the Marketplace Full plan.
_Avoid_: admin (ambiguous with site/org admin).

**Paywall exemption**:
A tenant policy that exempts the tenant from the normal Lite paywall guidance. The exemption's scope is distinct from any separately reviewed Fullscreen access policy.
_Avoid_: assuming one exemption authorises every restricted capability.

**Surface**:
The category used for analytics and UI organisation, such as `viewer`, `editor`, `dashboard`, or `page_banner`; analytics also has categories for non-UI activity. A Surface is not an Interface ID: its value follows the event's classification and does not identify an exact impact scenario.
_Avoid_: using Surface and Interface interchangeably, or deriving Interface IDs from analytics values.

**Cross-surface component**:
A component whose surface is decided by its caller, not by where it lives — `UpgradePrompt` (its surface comes from `surfaceForActionType()`: `editor`, `viewer`, or `byline`), `PublishButton`, `TabSwitcher`, `DocumentList`. These have no single home in a surface-organised tree and are grouped under `Shared`.

**Export annotation（导出标注）**:
A text label, arrow, callout, or rectangle added to an image in the export workspace.

**Export watermark（导出水印）**:
A single text watermark applied to an image in the export workspace.

### Change impact

**Feature（产品能力）**:
A distinct product capability, such as editing existing macro content (`editing`) or non-blocking usage guidance (`paywall`). It is the row axis of `IMPACT-MAP.md`, independent of where the capability is offered.
_Avoid_: component name, test category, Interface.

**Interface（交互面）**:
A specific place or channel where a capability is offered, such as the native macro editor (`editor`), independent fullscreen editor (`fullscreen-editor`), or external agent (`external-agent`). It is the column axis of `IMPACT-MAP.md` and can be a UI, machine interaction, or delivered output.
_Avoid_: Surface, Variant, DiagramType, or a temporary UI state used as a synonym for Interface.

**Impact scenario（影响场景）**:
One explicit pair of a Feature and an Interface, such as `(editing, editor)` or `(paywall, page-banner)`. Both members identify the scenario; a parent's scenarios do not automatically include its nested interfaces.
_Avoid_: a flat collection of feature and interface names with no pairing.

**Impact scope（影响范围）**:
The set of explicit impact scenarios affected by a change. `(editing, editor)` plus `(paywall, page-banner)` contains those two pairs, not every combination of their two Features and two Interfaces.
_Avoid_: a Cartesian product inferred from independent label lists.

**Impact map（影响地图）**:
The product capability map in `IMPACT-MAP.md`, which owns ID allocation, interface shortcodes, relationships, applicability conditions, and source evidence. `GLOSSARY.md` defines shared meanings, including named Interfaces and their referenced IDs; capability claims remain limited by the map's code baseline.
_Avoid_: test inventory, proof of production enablement or successful validation.

**PR triage（PR 影响研判）**:
The review that resolves uncertainty about a PR's impact scope and required end-to-end coverage. Its reusable product findings refine the impact map; selecting full coverage does not by itself resolve an unknown product relationship.
_Avoid_: treating triage as a synonym for running all tests.

### Macro content lifecycle Features

These entries cover Features whose meaning or boundary needs a shared definition. General operations use “macro”; “diagram” is reserved for graphical content, a specific product name, or an existing identifier. They reference the IDs registered in `IMPACT-MAP.md`; straightforward actions remain described in the map.

**Creating macro content（创建宏内容，`feature:create-diagram`）**:
Creating a new content document for a macro. Saving that document and placing a macro that displays it on a Confluence page are separate outcomes.
_Avoid_: using “create” to imply successful page placement.

**Editing macro content（编辑宏内容，`feature:editing`）**:
Changing a macro's existing source content, whether a diagram, API specification, or other supported document. Selecting a different document for an Embed reference is a change to the reference, not an edit of the referenced source.

**Publishing macro content（保存与发布宏内容，`feature:publishing`）**:
Committing macro content or its selected reference through the current authoring flow. Saved content, an updated macro binding, and a macro placed on a page are distinct completion conditions.
_Avoid_: confusing macro Publish with publishing the Confluence page or a software release.

**Copy independence（复制后的独立性，`feature:copy-independence`）**:
The separation of a copied macro's editable content from its original. Copying a macro does not by itself establish an independent source document.

**Unpublished draft（未发布草稿，`feature:unsaved-drafts`）**:
An editor's retained working changes that have not been committed to the saved content document. A draft is distinct from a saved document that has not been placed on a page.
_Avoid_: using “unsaved” to mean that no recoverable working copy exists.

**Draft recovery（恢复未发布草稿，`feature:draft-recovery`）**:
Restoring retained working changes when an authoring session is reopened. It is distinct from recovering a previously saved document whose normal loading path has failed.

**Source snapshot（源文快照，`feature:source-snapshots`）**:
A fallback copy of applicable saved macro source content kept as a Confluence attachment. It is distinct from an editor draft, an exported PNG, and the primary saved document.

**Content recovery（加载与内容恢复，`feature:content-recovery`）**:
Obtaining previously saved macro content through an available recovery path when its normal reference or source cannot be used. Recovered content does not by itself establish that the live document can safely be edited or rebound.

**Embedding（引用已有内容，`feature:embedding`）**:
Displaying an existing document through a reference, including choosing or redirecting that reference. It does not create an independent copy of the source document.

**Placement recovery（已保存宏内容的放置恢复，`feature:placement-recovery`）**:
Helping a user place a macro for an already saved but unplaced content document onto a Confluence page. It is distinct from draft recovery and does not imply discovery of every unreferenced document.

**Prepared diagram activation（接受预制图表，`feature:prepared-diagram-activation`）**:
Accepting a prepared diagram as a saved document that the user can continue to work with. Acceptance and placement on a page are distinct outcomes.

### AI, validation, and presentation Features

**Syntax validation（语法诊断，`feature:syntax-validation`）**:
Checking the current macro content against the applicable format's syntax or specification rules. A successful syntax check is distinct from confirming that the content expresses the user's intent.

**Dialect correction（异种 DSL 纠正，`feature:dialect-detection`）**:
Recognising source written in another supported diagram language and offering the matching type. It is distinct from translating the diagram into a different language.

**AI Repair（AI 语法修复，`feature:ai-repair`）**:
An AI-assisted correction of source that has a syntax problem, with a result the user can review and apply. Its purpose remains repair even when the interaction is presented through AI Chat.

**AI Chat（AI 修改宏内容，`feature:ai-chat`）**:
An instruction-driven change to the current macro content, such as diagram source or an OpenAPI specification. It is distinct from general diagram questions in Diagramly Aide and from committing the result to Confluence.

**AI change history（AI 变更审阅与撤销，`feature:ai-change-history`）**:
Reviewing, undoing, or restoring changes within the AI-assisted content editing workflow. It is distinct from the complete Confluence document version history.

**Diagramly Aide conversation（Diagramly Aide 问答，`feature:ai-aide`）**:
A standalone question-and-answer conversation reached through Diagramly. Receiving an answer is distinct from applying a change to macro content in an editor.

**Copy for AI（复制给外部 AI，`feature:copy-for-ai`）**:
Preparing supported macro source content, available context, and a task prompt for copying into another AI tool. Copying the material does not itself call a model or grant access to Confluence.

**Refined layout（Mermaid Refined 布局，`feature:refined-layout`）**:
An alternative prepared layout of a Mermaid diagram that can be viewed alongside its original rendering. Selecting that layout is distinct from editing the diagram source or requesting a new AI generation.

**Graph / Board modes（Graph / Board 工作模式，`feature:graph-board-mode`）**:
The distinct Diagram and Board working modes of a Graph document, with their respective content and a selected published mode. They are modes within the Graph editor, not separate Interface IDs.

### Linking and commercial Features

**Macro content links（宏内容、页面与放置链接，`feature:diagram-links`）**:
Links that identify a content document, its owning page, or a way to place a macro reference. A source-macro placement link, an Embed reference link, and a temporary share preview have different meanings.

**Rich share（临时富分享预览，`feature:rich-share`）**:
A temporary share preview containing a diagram image and a route back to Confluence. It is distinct from the ordinary diagram link and from a persistent Embed reference.

**Paywall guidance（用量提示与付费引导，`feature:paywall`）**:
Non-blocking guidance based on usage and payment eligibility. It is distinct from the separate Fullscreen access recovery Feature and does not itself mean that editing is blocked.

**Marketplace upgrade（Full 升级入口，`feature:marketplace-upgrade`）**:
The handoff to the Atlassian Marketplace flow for obtaining Full. It is distinct from asking an administrator to obtain Full and from buying a space-level Bundle.

**Request Full（向管理员请求 Full，`feature:request-full`）**:
Preparing a rationale and guiding the user into the Atlassian request or installation flow for Full. It is distinct from an application to obtain temporary Fullscreen access.

**Space Bundle checkout（空间 Bundle 购买，`feature:space-checkout`）**:
The eligible space administrator's purchase path for a space-level Bundle. It is distinct from a site-level Marketplace Full purchase and from a temporary-access grant.

### External agent Features

**Agent authorisation（Agent 用户授权，`feature:agent-authorization`）**:
A user's consent for an external client to access permitted Confluence resources within the granted scope. Connection instructions alone do not establish authorisation, and consent does not grant access beyond the user's permissions.

**Agent reading（Agent 发现与读取，`feature:agent-read`）**:
An authorised external client's discovery and reading of sites, pages, and macro content documents. Successfully reading a document and being able to display it in an MCP Apps view are distinct capabilities.

**Agent writing（Agent 创建、更新和页面写入，`feature:agent-write`）**:
An authorised external client's changes to macro content documents or Confluence pages. Saving content, updating a page to contain its macro, and maintaining export attachments are separate outcomes.

### Viewing and authoring interfaces

These terms name the Interfaces catalogued in `IMPACT-MAP.md`; their IDs refer to that registry. A definition identifies an interface, while availability and supported Features depend on the map's recorded baseline and applicability conditions.

**Inline viewer（页面内查看器，`inline-viewer`）**:
The macro view inside a published Confluence page. It is distinct from the macro preview while the page is being edited and from a separately opened fullscreen viewer.
_Avoid_: using “viewer” alone when the distinction matters.

**Page editor（Confluence 页面编辑器，`page-editor`）**:
The Confluence host in which a user edits a page and inserts or configures macros. It is distinct from the macro's own editor.

**Page editor preview（页面编辑态预览，`page-editor-preview`）**:
The macro view shown while its Confluence page is being edited, before the macro's configuration is opened. It is distinct from the preview inside a macro editor.

**Native macro editor（原生宏编辑器，`editor`）**:
The macro authoring interface opened through Confluence's macro insertion or configuration flow. It has a different relationship to the containing macro's configuration from the independent fullscreen editor.
_Avoid_: treating the Confluence page editor and the macro editor as the same interface.

**Fullscreen viewer（全屏查看器，`fullscreen-viewer`）**:
A separately opened view of supported macro content in fullscreen viewing mode. A large window alone does not make the API document viewer or fullscreen editor this interface.

**Fullscreen editor（独立全屏编辑器，`fullscreen-editor`）**:
The independent macro authoring interface reached from a viewer, byline, or document list. It is distinct from native macro configuration, even when both appear in similarly sized windows.

**Graph editor（DrawIO 编辑器，`graph-editor`）**:
The DrawIO authoring interface hosted within a diagram editor. Diagram and Board are working modes of this interface, rather than separate Interfaces.

**OpenAPI editor（OpenAPI / Swagger 编辑器，`openapi-editor`）**:
The specialised authoring interface for an OpenAPI specification. It is distinct from the rendered API document viewer and from AsyncAPI Studio.

**AsyncAPI editor（AsyncAPI Studio，`asyncapi-editor`）**:
The specialised Studio authoring interface for an AsyncAPI specification. It is distinct from the OpenAPI editor and the AsyncAPI reference picker.

**API document viewer（API 文档查看模态框，`api-document-viewer`）**:
The document view opened by View in My API Documents, for an AsyncAPI or OpenAPI document. Its window size does not make it the fullscreen-viewer Interface.

**Embedded viewer（嵌入引用查看器，`embedded-viewer`）**:
The view of an existing document referenced by an Embed macro. The reference and the source document are distinct; an Edit action does not by itself establish that the source body can be edited.

**Embed picker（通用 Embed 选择器，`embed-picker`）**:
The selection interface for an existing document to reference through a general Embed macro. It is distinct from the resulting embedded viewer.

**AsyncAPI embed picker（AsyncAPI 引用选择器，`asyncapi-embed-picker`）**:
The selection interface for the dedicated AsyncAPI reference macro. It is distinct from the general Embed picker and from authoring an AsyncAPI document.

### Editing, review, and assistance interfaces

**Template gallery（Starter templates，`template-gallery`）**:
The template selection overlay inside the text diagram editor. It is distinct from the Dashboard and Get Started tutorials.

**Source panel（只读源码面板，`source-panel`）**:
The viewer's panel for inspecting supported macro source content. It is distinct from the editable source area in the macro editor.

**Syntax error panel（语法诊断面板，`syntax-error-panel`）**:
The area that presents syntax problems in supported macro content and applicable correction or repair entry points. It is distinct from the review of a proposed AI repair.

**AI Chat panel（AI Chat 侧栏，`ai-chat-panel`）**:
The editor-side conversation for requesting changes to the current macro content. It is distinct from the separate Diagramly Aide conversation.

**AI Repair dialog（AI Repair 审阅框，`ai-repair-dialog`）**:
The review interface for a proposed syntax repair, including choosing or adjusting the changes to apply. It is distinct from the error panel that offers repair and from AI Chat.

**Export workspace（PNG 导出工作区，`export-workspace`）**:
The workspace for preparing a PNG image, including its preview, background, annotations, and watermark. It is distinct from Confluence's PDF or Word document export.

**Connect MCP dialog（Connect MCP 设置框，`connect-mcp-dialog`）**:
The setup interface that provides connection instructions and context for an external MCP client. It is distinct from the client's authorisation page and subsequent machine interactions.

**Fullscreen recovery interface（Fullscreen 恢复申请界面，`fullscreen-recovery`）**:
The request and status interface for Fullscreen access recovery. The Interface ID names the interaction place; `fullscreen-access-recovery` names the Feature offered there.

**Feedback dialog（反馈报告框，`feedback-dialog`）**:
The interface for submitting a report with text, optional imagery, and disclosed context. It is distinct from satisfaction and targeted surveys presented through a banner.

### External and output interfaces

**OAuth consent（外部授权页面，`oauth-consent`）**:
The page where a user grants or refuses an external client's access using their Atlassian identity. It is distinct from MCP setup instructions and the authorised client's later requests.

**MCP Apps view（MCP Apps 图表视图，`mcp-app-view`）**:
The rendered view of supported content, including diagrams or API specifications, returned as a tool result within an MCP host. It is distinct from a Confluence macro viewer and from the external agent making the tool call.

**External share preview（分享链接预览页，`external-share-preview`）**:
The temporary view reached through a share link, containing a diagram preview and a link back to Confluence. It is distinct from a persistent Embed reference inside a Confluence page.

**External agent（外部 Agent / MCP，`external-agent`）**:
The user-authorised machine interaction channel through which an external MCP client accesses macro content documents and pages. It is an Interface even though it is not a first-party UI screen.

**Document export interface（Confluence PDF / Word 输出，`document-export`）**:
The delivered macro content within a Confluence PDF or Word export. The Interface names the output channel; the Feature with the same ID names the capability of supplying that output.

### Navigation, onboarding, and usage interfaces

**Dashboard（ZenUML Dashboard，`dashboard`）**:
The global ZenUML application page containing getting-started material. It is distinct from My API Documents and is not a diagram library.

**Get Started（Admin Get Started，`get-started`）**:
The getting-started interface reached through global administration settings. Sharing tutorial content with Dashboard does not make their entry points identical.

**API dashboard（My API Documents，`api-dashboard`）**:
The space-level document management page for AsyncAPI and OpenAPI documents in the AsyncAPI edition. It is distinct from the general ZenUML Dashboard tutorial.

**Plan and usage（用量与方案，`plan-usage`）**:
The Lite application area for site and space usage, upgrade guidance, and Fullscreen status. Diagram locations and Request Full are separately identified interfaces within that area.

**Diagram locations interface（宏内容所在页面清单，`diagram-locations`）**:
The page-ownership listing within Plan and usage that identifies the owning pages of macro content documents. It names the listing interface, distinct from the Feature of discovering those locations.

**Request Full interface（向管理员请求 Full 引导页，`request-full`）**:
The guidance area for preparing a request that an administrator obtain Full. It is distinct from submitting a temporary Fullscreen access request.

**Home feed（Confluence Home 卡片，`home-feed`）**:
The ZenUML card in Confluence Home, with recent diagrams and introductory resources. It is distinct from the app's Dashboard and administration settings.

**Byline diagrams（Diagrams / API Docs 弹窗，`byline-diagrams`）**:
The diagram or API document listing opened from a Confluence page's byline. It is distinct from the byline's prepared-diagram activation flow.

**Byline activation（View as diagram 弹窗，`byline-activation`）**:
The byline interface for reviewing and accepting a prepared diagram. Acceptance and placing the diagram onto a page are distinct concepts.

**Diagramly Aide（`aide`）**:
The standalone question-and-answer conversation reached from the Diagramly byline. It is distinct from AI Chat in the diagram editor.

**Page banner（共享页面横幅，`page-banner`）**:
The shared page-level interface for eligible notices, including usage guidance, satisfaction surveys, and product updates. The Paywall banner is one kind of notice within it, not the whole interface.

**Unplaced banner（未放置宏内容横幅，`unplaced-banner`）**:
The dedicated banner for saved macro content that has not been placed on the page. It is distinct from an unplaced-content notice offered through the shared Page banner.

**Diagramly Admin（空间演示页管理，`admin-demo`）**:
The administration interface for enrolling a space in Diagramly demo-page creation. It is distinct from the customer getting-started tutorials.

**Create guide（Create 插入引导，`create-guide`）**:
The insertion instructions opened through the Lite inline viewer's Create entry point. It is guidance for inserting a macro, rather than a macro authoring interface.

### Operations interfaces

**Analytics console（运维分析页，`analytics-console`）**:
The separately built analytics and reporting interface for operational investigation. It is distinct from customer-facing Dashboard and usage pages.

**Space license admin（运维空间许可证管理，`space-license-admin`）**:
The operational interface for administering space licences. It is distinct from a customer's plan guidance and purchase interfaces.

**Metrics inspector（运维缓存诊断，`metrics-inspector`）**:
The operational interface for inspecting metrics caches and related diagnostics. It is distinct from the analytics reporting console.

### Release pipeline

**Main build**:
The `Build, Test and Draft Release` run that a merge to `main` triggers: deploys every variant to staging, runs the staging E2E suites, and cuts one draft release per variant. Its end is the earliest a release can be published.
_Avoid_: "CI" (ambiguous with the PR run and the release run).

**Draft**:
The per-variant GitHub draft release the main build cuts, pinned to the commit it tested. Publishing a draft is the release; nothing else deploys to production.

**Release run**:
The `Release` workflow a published draft triggers: production Cloudflare publish, Forge production deploy, then the release smoke. Its *deploy job* going green is the deploy gate — the moment the new version is live and PVT may start.

**Smoke tier**:
The E2E tests tagged `@smoke`: one insert-and-render per macro type, one edit, one embed paste. The smallest set a release must not ship without.

**Release smoke**:
The production E2E the release run executes after the deploy job — the smoke tier only (ADR-0006). Nothing waits on it except the release report.
_Avoid_: "prod smoke" without saying which — the nightly is also a prod smoke.

**Nightly smoke**:
The scheduled `Smoke Test in Production` run: the whole insert suite, on every variant's production site, once a day. Where the coverage the release smoke leaves out is still exercised on production.

**Auth bootstrap**:
The single Atlassian login per site that produces the Playwright storage state every E2E shard reuses. Runs at the start of the main build, before any deploy has finished.

## Relationships

- A **macro** presents content or a reference; its content may be a **Diagram**, an **API specification**, or a Markdown document.
- A **content document** may be presented by a source macro and referenced by Embed macros; those instances are distinct from the underlying document.
- **Diagram macro** is a specific macro name; **DiagramType** is an existing code identifier that also includes non-diagram content.
- An exported image may contain multiple **Export annotations**, including multiple annotations of the same type; each can be selected, moved, and deleted independently.
- An exported image has at most one **Export watermark**.
- The export workspace downloads PNG or copies a PNG image to the clipboard; PNG is a fixed format label, not a format selector.
- **Export annotations** and the **Export watermark** affect only the exported image, never the source content.
- Export annotations and watermark settings belong to the current macro's page visit: closing and reopening export preserves them, including reopening its fullscreen window; refreshing or leaving the page discards them. They are not saved annotation drafts.

## Error taxonomy

Errors are grouped by the phase of the macro lifecycle where they occur. All emit Mixpanel events via `trackEvent(label, action, category)`.

| Group | Mixpanel event(s) | Phase | Health signal |
|---|---|---|---|
| **Save errors** | `save_failed`, `update_custom_content_error`, `save_existence_check_failed` | User hit Save → content not persisted | Any spike is a red flag |
| **Load errors** | `load_macro`, `load_custom_content` | Macro opening → content not readable | Any spike means macros fail to open |
| **Render errors** | `render_failed` (`event_category` = diagram type) | Content loaded → macro content not displayed | Any spike is a red flag |
| **Orphan errors** | `customcontent_orphan_observed`, `load_custom_content_v2_missing` | Load: CC ID no longer resolves | Track orphan total, `recovery_used=false`, and `v2_missing` separately; `v2_missing` spike without matching orphan spike = gap in orphan detection |
| **Export errors** | `attachment_upload_failed` | Export/PNG write | Any spike means export broken |

_Avoid_: calling all `*_failed` events "errors" without grouping — they have different severities and owners. AI generation failures (`ai_title_generation_failed`) and feature-flag fetch failures (`feature_flags_fetch_failed`) are soft degradations, not core errors.

## Flagged ambiguities

- `Sequence` (DiagramType enum value) and "ZenUML" (user-facing brand) refer to the same rendering engine — resolved: prefer "ZenUML" in user-facing text; keep `Sequence` only in code that references the enum.
