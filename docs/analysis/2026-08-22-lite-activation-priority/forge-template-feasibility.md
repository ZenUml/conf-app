> **更正 2026-08-22(本文件第 2 节与路径 (b) 的 scope 缺口结论作废)**:`POST /wiki/rest/api/template` 的 classic scope 是 `write:confluence-content`(Atlassian REST v1 template API 文档原文:Classic (RECOMMENDED): "write:confluence-content"),该 scope 已在 `manifest.yml` `permissions.scopes` 第 7 项声明。granular `write:template:confluence` 只是另一条等价路径。结论:应用今天就能调用模板创建接口,不加 scope,不触发 major 版本。另外 Forge 无 optional scope:manifest permissions 参考中 scopes 为静态必选列表;Forge versions 文档原文 "Modifying scope permissions. This includes: Adding a scope." 归为 major,无例外。

# Can a Forge app pre-insert a ZenUML macro into a Confluence page template?

## 1. Forge manifest module for templates/blueprints — NOT FOUND
Checked https://developer.atlassian.com/platform/forge/manifest-reference/modules/ and
https://developer.atlassian.com/platform/forge/modules/. Both list Confluence module
families (macro, contentBylineItem, globalPage, customContent, pageBanner,
homepageFeed — same families used in this repo's `manifest.yml`). Neither page, nor a
web search for `Forge manifest "blueprint" module confluence`, surfaces a module named
or described as template/blueprint. Connect had a `blueprints` module; Forge's manifest
reference has no equivalent today. This is an absence-of-evidence finding across the
two canonical module-list pages — no page states outright "there is no template module."

## 2. Confluence REST API — v1 `template` group exists; scope gap in this app today
`POST`/`PUT /wiki/rest/api/template` (create/update): classic scope
`write:confluence-content`; granular scopes `read:template:confluence`,
`read:content-details:confluence`, `write:template:confluence`. Doc note: **"blueprint
templates cannot be created via the REST API"** — only plain content templates. `GET`
(by id, and `/template/page` list) needs only the read scopes. Source:
https://developer.atlassian.com/cloud/confluence/rest/v1/api-group-template/. **No v2
group for templates** — v2's group list (Attachment, Blog Post, Content, Custom
Content, Database, Folder, Label, Page, Space, etc.) has no Template group. Body
representations accepted: `storage`, `atlas_doc_format` (ADF), `wiki`, `view`.
**Scope check against this repo**: `manifest.yml:145` declares
`read:template:confluence` only; `write:template:confluence` is absent from
`permissions.scopes` (`manifest.yml:73-152`, grep confirmed zero hits). The app can
read templates today but cannot create/update one.

**Macro-in-template-body**: not confirmed by any doc found. The one relevant Atlassian
Community thread
(https://community.developer.atlassian.com/t/how-to-add-forge-macros-extension-to-the-page-programmatically-via-rest-api/63387)
covers **page** content, not templates: storage-format `<ac:adf-extension>` failed with
"Error loading the extension!"; the fix was posting the **page** via v2 API with
`representation: atlas_doc_format`. The template-create endpoint also accepts
`atlas_doc_format`, so the same technique is plausible for templates, but no doc or
community answer confirms it for the template endpoint specifically.

## 3. Who can create templates in the UI
Space templates: **space admin only**. "Only space administrators can create or edit
templates in Confluence Cloud... you won't be able to create templates" without space
Admin permission. Source: https://support.atlassian.com/confluence-cloud/docs/create-a-template/.
Global templates: doc treats "Create a global template" as a separate admin function —
implies higher (site-admin) access, but the fetched excerpt gave no exact permission
name, so no direct quote for that specific role. **Using** a template to create a
page: no restriction found beyond normal page-create permission — the quoted
restriction applies only to *creating* templates.

## 4. Repo grep — no existing template/blueprint integration code
`grep -rni 'blueprint' src/ functions/ manifest.yml` → zero hits. `grep -rn
'wiki/rest/api/template\|write:template:confluence' src/ functions/` → zero hits. The
only "template" hits in src/ are Vue/Storybook `template:` render blocks (unrelated
framework syntax) and `src/components/TemplateGallery/` — the macro **editor's**
starter-diagram-body picker (`getTemplatesForType`, `src/model/Diagram/EditorTemplates`):
a gallery of Mermaid/PlantUML/ZenUML starter text, not a Confluence page template.

## Three paths
**(a) Forge module auto-provides the template — NOT POSSIBLE.** No manifest module for
templates/blueprints exists (finding 1); no effort estimate applies — nothing to build.

**(b) App creates the template via REST on an admin's behalf — POSSIBLE, blocked by a
scope gap today.** `POST /wiki/rest/api/template` exists and needs
`write:template:confluence` (finding 2), absent from `manifest.yml`. Adding a scope is
a **major** version bump requiring admin re-consent (per this repo's own `CLAUDE.md`
"Forge app versions" section — scope adds always force major). Work: add the scope,
write a function POSTing the template body (storage or ADF) with the macro extension
node, wire it to an admin-triggered UI action (Forge can't write this unprompted on
install). **Estimate (mine): 3-5 engineering days** for REST call + admin trigger UI +
testing; add 2-3 days if the unverified ADF-in-template-body technique fails and
storage-format `ac:adf-extension` (which failed for pages, per the Community thread)
has to be debugged instead.

**(c) Zero-code: admin manually creates the template; app gives instructions +
copy-paste macro — ALWAYS POSSIBLE.** Confirmed by finding 3: any space admin can
create a space template via Space Settings > Look and Feel > Templates today,
independent of any app capability. App's job: a short in-product instructional
surface ("insert the diagram macro, then Space Settings > Templates > Create Template
from this page"). **Estimate (mine): 0.5-1 engineering day** for a static instructional
page/modal using existing `confluence:globalSettings` or `contentBylineItem` module
patterns already in `manifest.yml` — no new scopes, no new Forge modules, no REST
write calls.
