# IMPACT MAP

产品能力 × 交互面的代码地图。用于产品设计、变更影响判断、实现定位和测试覆盖分析。每个格子是一对明确的 `(feature, interface)`。

本轮基线：`47e2c375`，审阅日期：2026-10-27。盘点第一方入口、组件、关键依赖、Forge 模块、变体生成路径、后端产品能力、外部 MCP 和运维页面；当前登记 **74 个 Feature、44 个 Interface**。

这里的“接入”指该版本代码中存在可追踪的入口/调用链。它不证明某个生产租户已启用开关，也不替代实际 UI 或端到端验证。第三方 DrawIO/Studio 的内部菜单不逐项展开；记录其第一方宿主、模式、读写和边界。

## 与术语表的关系

`GLOSSARY.md` 定义共享概念及具体交互面的含义与区别，并引用其稳定 ID；本文维护 Feature/Interface ID 的登记、Interface 短码、矩阵关系、适用条件、源码证据和测试覆盖定位。术语表可以解释全部交互面，但不复制能力矩阵、短码或证据清单；本文不把候选源码基线的接线写成生产已启用或验证通过。

- **Macro（宏）**是跨类型操作的统称；**Diagram（图表）**只指图形内容。OpenAPI/AsyncAPI 是 API 规范，Markdown 是文本文档；宏实例、内容文档与引用关系分别描述。通用操作写“编辑宏”或“编辑宏内容”，具体操作再写“编辑图表源码”“编辑 API 规范”或“更换引用”。现有 ID、代码符号和产品 UI 名称中的 diagram 保留，不据此把所有宏归类为图表。
- **Feature（产品能力）**是行轴，**Interface（交互面）**是列轴；图种、产品变体、身份和状态是适用条件。
- **Impact scenario（影响场景）**是一对明确的 `(feature, interface)`；**Impact scope（影响范围）**是这些明确场景的集合。单对按 AND 匹配，多对按 OR 匹配；维度标签不能代替配对记录，也不生成笛卡尔积。
- **Surface** 是埋点与 UI 组织的分类，不是 Interface ID。两者不要求一一对应，不能按字符串替换或父子界面关系自动推导；具体事件按其分类契约记录。例如 `page-banner` 是 Interface ID，而 `page_banner` 是 Surface 值；它们名称接近不构成通用转换规则。
- `paywall` 指非阻断的用量提示与付费引导；`fullscreen-access-recovery` 是独立的访问恢复能力。准确的已登记示例为 `(editing, editor)` 与 `(paywall, page-banner)`，不从示例补出未登记关系。
- 两个轴各自保留命名空间；如 `feature:document-export` 与 `interface:document-export` 是不同身份。短码只帮助阅读，不代替稳定 ID。

## 阅读方式

- 同一张矩阵按界面家族分成五个视图。行始终是 Feature，列始终是 Interface；每个视图省略全空行。
- `●`：该交互面直接提供实现；`↗`：入口/交接，实际操作转到另一个交互面；`G`：有明确开关、身份、类型、状态或生成路径条件；`A`：该交互面的自动流程；`B`：独立构建/静态运维入口，产品导航或部署授权另述。
- `·`：本轮在该交互面未找到直接实现关系。它不等于产品承诺“永不支持”，也不表示“缺测试”。保留/关闭/未挂载的代码单列，不填成当前能力。
- 非空格子表示至少一个适用图种/变体的实现；具体支持范围、排除条件和证据见该行链接的 Feature 契约。
- UI 的物理位置和来源都重要：原生宏配置与独立全屏编辑器可能都铺满屏幕，但回写权限不同；源码面板、AI 侧栏和嵌套编辑器拥有各自接口 ID。
- `external-agent` 是机器交互面，`document-export` 是交付输出面；运维三列单独显示。产品变体、图种、用户身份和临时状态是适用条件，不增加矩阵轴。

## Interface 目录

两个轴允许使用相同 slug：`document-export`、`diagram-locations`、`request-full`、`space-license-admin`。身份由 `feature:`／`interface:` 命名空间决定，不能丢弃前缀后混用；全局唯一要求适用于 Interface 短码。

短码只用于让矩阵可读；稳定标签使用下面的 `interface:<id>`。三词 Interface ID 优先取三段首字母；发生冲突时使用能区分的额外字母；所有短码全局唯一。嵌套界面保留显式关系，选择父界面不会自动扩大成所有子界面。

| 短码 | Interface ID | 交互面与边界 | 入口证据 |
| --- | --- | --- | --- |
| IV | `inline-viewer` — 页面内查看器 | Confluence 已发布页面中的宏；各格式有独立查看器。 | [src/forgeIndex.ts:1083](src/forgeIndex.ts#L1083) |
| PE | `page-editor` — Confluence 页面编辑器 | 宿主的宏插入、粘贴 autoConvert 与 Live Docs 编辑流程；与宏内预览分开。 | [manifest.yml:216](manifest.yml#L216) |
| PEP | `page-editor-preview` — 页面编辑态预览 | Confluence 页面正在编辑，但尚未打开宏配置；不等于 Workspace。 | [src/utils/stalenessHint/core.ts:15](src/utils/stalenessHint/core.ts#L15) |
| ED | `editor` — 原生宏编辑器 | Confluence insert/configuring 宏配置；可保存并回写宏配置。 | [src/model/globals/forgeGlobal.ts:227](src/model/globals/forgeGlobal.ts#L227) |
| FV | `fullscreen-viewer` — 全屏查看器 | macroMode=fullscreen；通用查看器与 AsyncAPI 的能力不同。 | [src/forgeIndex.ts:1643](src/forgeIndex.ts#L1643) |
| FE | `fullscreen-editor` — 独立全屏编辑器 | macroMode=editor；从查看器、byline 或列表进入；不拥有原生配置的全部回写能力。 | [src/forgeIndex.ts:1279](src/forgeIndex.ts#L1279) |
| GE | `graph-editor` — DrawIO 编辑器 | ED/FE 内的嵌套 iframe；Diagram/Board 是其工作模式。 | [src/components/DrawIoExtension/ForgeGraphEditor.vue:167](src/components/DrawIoExtension/ForgeGraphEditor.vue#L167) |
| OE | `openapi-editor` — OpenAPI / Swagger 编辑器 | 独立 React 工具栏、Swagger 编辑区及可选 AI 侧栏。 | [src/components/react/SwaggerEditor.tsx:15](src/components/react/SwaggerEditor.tsx#L15) |
| AE | `asyncapi-editor` — AsyncAPI Studio | 独立嵌套 Studio，宿主负责加载、保存和刷新缓冲。 | [src/components/Editor/AsyncApiEditor/AsyncApiStudioEditor.tsx:49](src/components/Editor/AsyncApiEditor/AsyncApiStudioEditor.tsx#L49) |
| ADV | `api-document-viewer` — API 文档查看模态框 | My API Documents 的 View，按 AsyncAPI/OpenAPI 分发；AsyncAPI 可 in-place Edit，OpenAPI 的 viewer 模式隐藏通用工具栏。 | [src/forge-asyncapi-viewer.ts:92](src/forge-asyncapi-viewer.ts#L92) |
| EV | `embedded-viewer` — 嵌入引用查看器 | 通用 Embed 引用源内容并选择其渲染器；AsyncAPI 有专用分支。 | [src/components/Viewer/ForgeEmbedViewer.vue:68](src/components/Viewer/ForgeEmbedViewer.vue#L68) |
| EP | `embed-picker` — 通用 Embed 选择器 | 原生 Embed 宏配置中的已有文档选择；通用 EV Edit modal 也路由到此选择器，提交／重绑定结果待 UI 验证。 | [src/components/DocumentList/DocumentList.vue:1](src/components/DocumentList/DocumentList.vue#L1) |
| AEP | `asyncapi-embed-picker` — AsyncAPI 引用选择器 | AsyncAPI 专用 embed 宏的文档选择；仅 AsyncAPI 变体。 | [src/forge-asyncapi-embed-editor.ts:21](src/forge-asyncapi-embed-editor.ts#L21) |
| TG | `template-gallery` — Starter templates | 文字编辑器内的模板选择覆盖层。 | [src/components/TemplateGallery/TemplateGallery.vue:18](src/components/TemplateGallery/TemplateGallery.vue#L18) |
| SP | `source-panel` — 只读源码面板 | 通用查看器的独立源码面板；与可编辑源代码区分开。 | [src/components/Viewer/ViewSourcePanel.vue:1](src/components/Viewer/ViewSourcePanel.vue#L1) |
| SEP | `syntax-error-panel` — 语法诊断面板 | 错误展示、修复入口与异种 DSL 提示所在区域。 | [src/components/SyntaxErrorBox.vue:29](src/components/SyntaxErrorBox.vue#L29) |
| ACP | `ai-chat-panel` — AI Chat 侧栏 | Vue/React 两个宿主实现；与 Diagramly Aide 分开。 | [src/components/AIChat/AIChatPanel.vue:243](src/components/AIChat/AIChatPanel.vue#L243) |
| ARD | `ai-repair-dialog` — AI Repair 审阅框 | 旧修复流的差异、逐行选择、修改和应用界面。 | [src/components/AIRepair.vue:56](src/components/AIRepair.vue#L56) |
| EX | `export-workspace` — PNG 导出工作区 | 预览、背景、标注、水印、下载与剪贴板。 | [src/components/ExportModal/ExportWorkspace.vue:2](src/components/ExportModal/ExportWorkspace.vue#L2) |
| CMD | `connect-mcp-dialog` — Connect MCP 设置框 | 复制 MCP 接入命令、URL 和带上下文的 prompt。 | [src/components/AgentLink/ConnectMcpDialog.vue:1](src/components/AgentLink/ConnectMcpDialog.vue#L1) |
| RC | `fullscreen-recovery` — Fullscreen 恢复申请界面 | 申请、开启临时访问、剩余期限与后续请求；嵌套于 FV 的 RecoveryHost 或 PU 的 fullscreen_request 视图，Lite 独立策略。 | [src/components/FullscreenRecovery/FullscreenRecoveryGate.vue:1](src/components/FullscreenRecovery/FullscreenRecoveryGate.vue#L1) |
| FD | `feedback-dialog` — 反馈报告框 | 文字、可选图片、上下文披露、提交结果与支持入口。 | [src/features/feedback/FeedbackDialog.vue:1](src/features/feedback/FeedbackDialog.vue#L1) |
| OS | `oauth-consent` — 外部授权页面 | Atlassian 登录、客户端同意、拒绝、账户切换。 | [functions/agent-link/oauth/consent.ts:43](functions/agent-link/oauth/consent.ts#L43) |
| MAV | `mcp-app-view` — MCP Apps 图表视图 | ChatGPT 等 MCP 宿主 iframe 内的工具结果图表。 | [src/mcp-app-view.ts:201](src/mcp-app-view.ts#L201) |
| ESP | `external-share-preview` — 分享链接预览页 | 签名票据的临时 PNG/HTML 预览和 Confluence 回链。 | [functions/d/[[path]].ts:23](functions/d/[[path]].ts#L23) |
| AM | `external-agent` — 外部 Agent / MCP | 用户授权的 MCP 客户端读写入口；它是机器交互面。 | [functions/agent-link/oauth/headlessTools.ts:128](functions/agent-link/oauth/headlessTools.ts#L128) |
| DE | `document-export` — Confluence PDF / Word 输出 | Forge adfExport 消费图像附件或 API 规范；它是输出面。 | [src/export.js:373](src/export.js#L373) |
| DB | `dashboard` — ZenUML Dashboard | Lite/Full 全局应用页；实际挂载 GetStarted 教程，不是文档库。 | [src/forgeIndex.ts:125](src/forgeIndex.ts#L125) |
| GS | `get-started` — Admin Get Started | Lite/Full 全局设置入口，与 Dashboard 共用教程组件。 | [src/forgeIndex.ts:115](src/forgeIndex.ts#L115) |
| AD | `api-dashboard` — My API Documents | AsyncAPI 变体的空间页，管理 AsyncAPI 与 OpenAPI 文档。 | [src/components/AsyncApiDashboard/AsyncApiDashboard.vue:35](src/components/AsyncApiDashboard/AsyncApiDashboard.vue#L35) |
| PU | `plan-usage` — Plan and usage | Lite 的全站及空间用量、升级与 Fullscreen 状态入口。 | [src/components/PlanUsage/PlanUsage.vue:7](src/components/PlanUsage/PlanUsage.vue#L7) |
| DL | `diagram-locations` — Diagram locations | Plan and usage 内的图表拥有页面清单。 | [src/components/PlanUsage/DiagramLocations.vue:13](src/components/PlanUsage/DiagramLocations.vue#L13) |
| RF | `request-full` — Request Full 引导页 | Plan and usage 内的理由复制和 Atlassian 请求引导。 | [src/components/PlanUsage/PlanUsage.vue:114](src/components/PlanUsage/PlanUsage.vue#L114) |
| HF | `home-feed` — Confluence Home 卡片 | 最近图表、类型示例、快速入门与 MCP 接入说明。 | [src/components/HomepageFeed/HomepageFeedCard.vue:73](src/components/HomepageFeed/HomepageFeedCard.vue#L73) |
| BD | `byline-diagrams` — Diagrams / API Docs 弹窗 | 页面 byline 打开的图表清单、创建与放置操作。 | [src/components/Byline/BylineDiagrams.vue:122](src/components/Byline/BylineDiagrams.vue#L122) |
| BA | `byline-activation` — View as diagram 弹窗 | 读取预制图表、接受、再编辑与分享。 | [src/components/Byline/BylineActivationDialog.vue:74](src/components/Byline/BylineActivationDialog.vue#L74) |
| AA | `aide` — Diagramly Aide | byline 的独立问答聊天窗口。 | [src/routes/aiAide.ts:8](src/routes/aiAide.ts#L8) |
| PB | `page-banner` — 共享 Page banner | Paywall、CSAT、未放置提醒、What’s new 与定向调查的优先级宿主。 | [src/routes/pageBanner.ts:61](src/routes/pageBanner.ts#L61) |
| UB | `unplaced-banner` — 未放置图表 Banner | 独立的 Forge banner 模块，由页面属性触发。 | [manifest.yml:492](manifest.yml#L492) |
| DA | `admin-demo` — Diagramly Admin | 空间演示页 enrollment；CI 与本地 wizard 存在生成差异。 | [src/components/Admin/CreateDemoPage.vue:3](src/components/Admin/CreateDemoPage.vue#L3) |
| CG | `create-guide` — Create 引导模态框 | Lite 内联查看器的 Create 入口打开的插入说明。 | [src/features/createGuide/CreateGuideModal.vue:1](src/features/createGuide/CreateGuideModal.vue#L1) |
| OA | `analytics-console` — 运维 Analytics 页面 | 构建出的 analytics.html；未找到 Forge 菜单接入，部署访问权限待另验。 | [src/components/Analytics/AnalyticsDashboard.vue:20](src/components/Analytics/AnalyticsDashboard.vue#L20) |
| SLA | `space-license-admin` — 运维 Space License Admin | 独立 /admin/ 页面，以运维凭证操作空间许可证。 | [public/admin/index.html:70](public/admin/index.html#L70) |
| OM | `metrics-inspector` — 运维 Metrics Inspector | 独立 /admin/metrics.html 的缓存和诊断查看。 | [public/admin/metrics.html:100](public/admin/metrics.html#L100) |

## 矩阵 A · 创作、配置与编辑子界面

| Feature | PE • page-editor | PEP • page-editor-preview | ED • editor | FE • fullscreen-editor | GE • graph-editor | OE • openapi-editor | AE • asyncapi-editor | EP • embed-picker | AEP • asyncapi-embed-picker | TG • template-gallery | SEP • syntax-error-panel | ACP • ai-chat-panel | ARD • ai-repair-dialog |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [F01 创建宏内容](#f01) | ↗ | · | ● | ● | ● | ● | ● | · | · | · | · | · | · |
| [F02 编辑宏内容](#f02) | · | G | ● | ● | ● | ● | ● | · | · | · | · | · | · |
| [F03 保存与发布](#f03) | · | · | ● | ● | ● | ● | ● | ● | ● | · | · | · | · |
| [F04 复制后的独立性](#f04) | · | · | G | G | · | · | · | · | · | · | · | · | · |
| [F05 文字图表类型切换](#f05) | · | · | ● | ● | · | · | · | · | · | · | · | · | · |
| [F06 源码编辑体验](#f06) | · | · | ● | ● | · | · | · | · | · | · | · | · | · |
| [F07 编辑预览布局](#f07) | · | · | ● | ● | · | · | · | · | · | · | · | · | · |
| [F08 Starter templates](#f08) | · | · | ↗ | ↗ | · | · | · | · | · | ● | · | · | · |
| [F09 标题与自动标题](#f09) | · | · | G | G | G | G | · | · | · | · | · | · | · |
| [F10 查看器内重命名](#f10) | · | G | · | · | · | · | · | · | · | · | · | · | · |
| [F11 未发布草稿保存](#f11) | · | · | A | A | A | A | · | A | · | · | · | · | · |
| [F12 恢复未发布草稿](#f12) | · | · | G | G | G | G | · | · | · | · | · | · | · |
| [F13 关闭保护与刷盘](#f13) | · | · | A | A | G | A | · | G | · | · | · | · | · |
| [F14 语法诊断](#f14) | · | · | ● | ● | · | ● | · | · | · | · | ● | · | · |
| [F15 异种 DSL 纠正](#f15) | · | · | G | G | · | · | · | · | · | · | G | · | · |
| [F16 AI 语法修复](#f16) | · | · | G | G | · | G | · | · | · | · | ↗ | G | ● |
| [F17 AI 修改宏内容](#f17) | · | · | G | G | · | G | · | · | · | · | · | ● | · |
| [F18 AI 变更审阅与撤销](#f18) | · | · | G | G | · | G | · | · | · | · | · | ● | · |
| [F19 API 规范编辑](#f19) | · | · | · | · | · | ● | ● | · | · | · | · | · | · |
| [F20 Graph / Board 工作模式](#f20) | · | · | · | · | ● | · | · | · | · | · | · | · | · |
| [F21 Graph 多页文档](#f21) | · | · | · | · | ● | · | · | · | · | · | · | · | · |
| [F22 宏内容渲染](#f22) | · | ● | ● | ● | ● | ● | ● | ● | ● | · | · | · | · |
| [F23 缩放、适配与平移](#f23) | · | G | G | G | ● | · | · | · | · | · | · | · | · |
| [F24 ZenUML 图上交互](#f24) | · | G | G | G | · | · | · | · | · | · | · | · | · |
| [F25 Markdown 文档](#f25) | · | G | ● | ● | · | · | · | · | · | · | · | · | · |
| [F26 Mermaid 关系高亮](#f26) | · | G | · | · | · | · | · | · | · | · | · | · | · |
| [F27 Mermaid Refined 布局](#f27) | · | G | · | · | · | · | · | · | · | · | · | · | · |
| [F28 查看与复制源码](#f28) | · | G | · | · | · | · | · | · | · | · | · | · | · |
| [F29 复制给外部 AI](#f29) | · | G | · | · | · | · | · | · | · | · | · | · | · |
| [F30 宏内容、页面与放置链接](#f30) | · | G | · | · | · | · | · | · | · | · | · | · | · |
| [F31 引用已有内容](#f31) | · | · | ↗ | · | · | · | · | ● | ● | · | · | · | · |
| [F32 粘贴创建与引用宏](#f32) | ● | · | · | · | · | · | · | · | · | · | · | · | · |
| [F34 PNG 导出](#f34) | · | G | · | · | · | · | · | · | · | · | · | · | · |
| [F39 Confluence PDF / Word 导出](#f39) | · | A | A | A | · | · | · | · | · | · | · | · | · |
| [F40 源文快照与附件后备](#f40) | · | A | A | A | · | · | · | · | · | · | · | · | · |
| [F41 加载与内容恢复](#f41) | · | G | G | G | · | · | · | · | · | · | · | · | · |
| [F42 加载失败与重试](#f42) | · | G | · | · | · | · | ● | · | · | · | · | · | · |
| [F43 页面编辑态过时提示](#f43) | · | G | · | · | · | · | · | · | · | · | · | · | · |
| [F44 作者与可选浏览信息](#f44) | · | G | · | · | · | · | · | · | · | · | · | · | · |
| [F46 Create 插入引导](#f46) | · | G | · | · | · | · | · | · | · | · | · | · | · |
| [F47 宏内容清单、搜索与打开](#f47) | · | · | · | · | · | · | · | ● | ● | · | · | · | · |
| [F59 反馈报告](#f59) | · | ↗ | ↗ | ↗ | ↗ | ↗ | ↗ | · | · | · | · | · | · |
| [F64 外部 MCP 接入设置](#f64) | · | G | · | · | · | · | · | · | · | · | · | · | · |
| [F70 下载诊断信息](#f70) | · | G | · | · | · | · | · | · | · | · | · | · | · |
| [F71 宏内容独立查看与全屏导航](#f71) | · | G | · | · | · | · | · | · | · | · | · | · | · |

## 矩阵 B · 查看、引用与输出

| Feature | IV • inline-viewer | FV • fullscreen-viewer | ADV • api-document-viewer | EV • embedded-viewer | SP • source-panel | MAV • mcp-app-view | ESP • external-share-preview | DE • document-export |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [F02 编辑宏内容](#f02) | ↗ | · | G | · | · | · | · | · |
| [F04 复制后的独立性](#f04) | G | · | · | · | · | · | · | · |
| [F10 查看器内重命名](#f10) | G | · | · | · | · | · | · | · |
| [F19 API 规范编辑](#f19) | · | · | G | · | · | · | · | · |
| [F20 Graph / Board 工作模式](#f20) | G | G | · | G | · | · | · | · |
| [F21 Graph 多页文档](#f21) | G | G | · | G | · | · | · | · |
| [F22 宏内容渲染](#f22) | ● | ● | ● | ● | · | ● | · | · |
| [F23 缩放、适配与平移](#f23) | G | G | · | G | · | · | · | · |
| [F24 ZenUML 图上交互](#f24) | G | G | · | G | · | · | · | · |
| [F25 Markdown 文档](#f25) | ● | ● | · | ● | · | · | · | · |
| [F26 Mermaid 关系高亮](#f26) | G | G | · | G | · | · | · | · |
| [F27 Mermaid Refined 布局](#f27) | G | G | · | · | · | · | · | · |
| [F28 查看与复制源码](#f28) | ↗ | ↗ | · | G | ● | · | · | · |
| [F29 复制给外部 AI](#f29) | G | G | · | G | · | · | · | · |
| [F30 宏内容、页面与放置链接](#f30) | G | G | · | G | · | · | · | · |
| [F31 引用已有内容](#f31) | · | · | · | ● | · | · | · | · |
| [F32 粘贴创建与引用宏](#f32) | · | · | · | G | · | · | · | · |
| [F33 临时富分享预览](#f33) | · | · | · | · | · | · | ● | · |
| [F34 PNG 导出](#f34) | ↗ | ↗ | · | G | · | · | · | · |
| [F39 Confluence PDF / Word 导出](#f39) | A | · | · | A | · | · | · | ● |
| [F40 源文快照与附件后备](#f40) | A | A | · | · | · | · | · | · |
| [F41 加载与内容恢复](#f41) | G | · | · | G | · | · | · | · |
| [F42 加载失败与重试](#f42) | ● | ● | · | ● | · | · | · | · |
| [F44 作者与可选浏览信息](#f44) | G | G | · | G | · | · | · | · |
| [F45 相关图表与参与者关系](#f45) | G | G | · | · | · | · | · | · |
| [F46 Create 插入引导](#f46) | G | · | · | G | · | · | · | · |
| [F57 Fullscreen 访问恢复](#f57) | · | G | · | · | · | · | · | · |
| [F59 反馈报告](#f59) | ↗ | ↗ | G | ↗ | · | · | · | · |
| [F64 外部 MCP 接入设置](#f64) | G | G | · | G | · | · | · | · |
| [F68 MCP Apps 工具结果预览](#f68) | · | · | · | · | · | ● | · | · |
| [F70 下载诊断信息](#f70) | ● | ● | · | G | · | · | · | · |
| [F71 宏内容独立查看与全屏导航](#f71) | ↗ | ● | ● | G | · | · | · | · |

## 矩阵 C · Dashboard、Get Started、页面与管理入口

| Feature | DB • dashboard | GS • get-started | AD • api-dashboard | PU • plan-usage | DL • diagram-locations | RF • request-full | HF • home-feed | BD • byline-diagrams | BA • byline-activation | AA • aide | PB • page-banner | UB • unplaced-banner | DA • admin-demo | CG • create-guide |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [F01 创建宏内容](#f01) | · | · | ↗ | · | · | · | · | ↗ | ● | · | · | · | · | · |
| [F02 编辑宏内容](#f02) | · | · | ↗ | · | · | · | · | · | ↗ | · | · | · | · | · |
| [F19 API 规范编辑](#f19) | · | · | ↗ | · | · | · | · | · | · | · | · | · | · | · |
| [F22 宏内容渲染](#f22) | · | · | · | · | · | · | · | · | ● | · | · | · | · | · |
| [F28 查看与复制源码](#f28) | · | · | · | · | · | · | · | G | · | · | · | · | · | · |
| [F30 宏内容、页面与放置链接](#f30) | · | · | ↗ | · | ↗ | · | ↗ | ● | G | · | G | G | · | · |
| [F32 粘贴创建与引用宏](#f32) | · | · | · | · | · | · | · | ↗ | ↗ | · | ↗ | ↗ | · | · |
| [F33 临时富分享预览](#f33) | · | · | · | · | · | · | · | · | G | · | · | · | · | · |
| [F42 加载失败与重试](#f42) | · | · | ● | · | ● | · | · | ● | · | · | · | · | · | · |
| [F46 Create 插入引导](#f46) | · | · | · | · | · | · | · | · | · | · | · | · | · | ● |
| [F47 宏内容清单、搜索与打开](#f47) | · | · | ● | · | ● | · | ● | ● | · | · | · | · | · | · |
| [F48 归档 API 文档](#f48) | · | · | ● | · | · | · | · | · | · | · | · | · | · | · |
| [F49 已保存但未放置的宏内容](#f49) | · | · | · | · | · | · | · | G | · | · | G | G | · | · |
| [F50 接受预制图表](#f50) | · | · | · | · | · | · | · | · | ● | · | · | · | · | · |
| [F51 入门教程与资源](#f51) | ● | ● | · | · | · | · | ● | · | · | · | · | · | · | ● |
| [F52 站点与空间用量](#f52) | · | · | · | ● | · | · | · | · | · | · | ↗ | · | · | · |
| [F53 宏内容所在页面盘点](#f53) | · | · | · | ↗ | ● | · | · | · | · | · | · | · | · | · |
| [F54 用量提示与付费引导](#f54) | · | · | · | ● | · | · | · | · | · | · | G | · | · | · |
| [F55 Full 升级入口](#f55) | · | · | · | ↗ | · | ↗ | · | · | · | · | ↗ | · | · | · |
| [F56 向管理员请求 Full](#f56) | · | · | · | ↗ | · | ● | · | · | · | · | · | · | · | · |
| [F57 Fullscreen 访问恢复](#f57) | · | · | · | G | · | G | · | · | · | · | · | · | · | · |
| [F58 空间 Bundle 购买](#f58) | · | · | · | · | · | · | · | · | · | · | G | · | · | · |
| [F59 反馈报告](#f59) | ↗ | ↗ | ↗ | ↗ | · | · | · | · | · | · | · | · | G | · |
| [F60 满意度调查](#f60) | · | · | · | · | · | · | · | · | · | · | G | · | · | · |
| [F61 定向调查](#f61) | · | · | · | · | · | · | · | · | · | · | G | · | · | · |
| [F62 产品更新发现](#f62) | · | · | · | · | · | · | · | · | · | · | G | · | · | · |
| [F63 Diagramly Aide 问答](#f63) | · | · | · | · | · | · | · | · | · | ● | · | · | · | · |
| [F64 外部 MCP 接入设置](#f64) | · | · | · | · | · | · | G | · | · | · | · | · | · | · |
| [F69 空间演示页 enrollment](#f69) | · | · | · | · | · | · | · | · | · | · | · | · | G | · |
| [F71 宏内容独立查看与全屏导航](#f71) | · | · | ↗ | · | · | · | · | ↗ | · | · | · | · | · | · |

## 矩阵 D · 专用工作区、反馈与 Agent

| Feature | EX • export-workspace | CMD • connect-mcp-dialog | RC • fullscreen-recovery | FD • feedback-dialog | OS • oauth-consent | AM • external-agent |
| --- | --- | --- | --- | --- | --- | --- |
| [F01 创建宏内容](#f01) | · | · | · | · | · | G |
| [F02 编辑宏内容](#f02) | · | · | · | · | · | G |
| [F03 保存与发布](#f03) | · | · | · | · | · | G |
| [F10 查看器内重命名](#f10) | · | · | · | · | · | G |
| [F14 语法诊断](#f14) | · | · | · | · | · | G |
| [F34 PNG 导出](#f34) | ● | · | · | · | · | · |
| [F35 导出标注](#f35) | ● | · | · | · | · | · |
| [F36 导出水印](#f36) | ● | · | · | · | · | · |
| [F37 导出背景与预览](#f37) | ● | · | · | · | · | · |
| [F38 复制 PNG 到剪贴板](#f38) | ● | · | · | · | · | · |
| [F57 Fullscreen 访问恢复](#f57) | · | · | ● | · | · | · |
| [F59 反馈报告](#f59) | ↗ | · | · | ● | · | · |
| [F64 外部 MCP 接入设置](#f64) | · | ● | · | · | · | · |
| [F65 Agent 用户授权](#f65) | · | · | · | · | ● | G |
| [F66 Agent 发现与读取](#f66) | · | · | · | · | · | G |
| [F67 Agent 创建、更新和页面写入](#f67) | · | · | · | · | · | G |
| [F68 MCP Apps 工具结果预览](#f68) | · | · | · | · | · | ↗ |

## 矩阵 E · 运维入口

| Feature | OA • analytics-console | SLA • space-license-admin | OM • metrics-inspector |
| --- | --- | --- | --- |
| [F72 运维分析与报表](#f72) | B | · | · |
| [F73 运维空间许可证操作](#f73) | · | B | · |
| [F74 运维缓存诊断](#f74) | · | · | B |

## Feature 契约与代码证据

每个 Feature ID 用于 `feature:<id>`，测试元数据使用相同 ID。以下是矩阵非空关系的能力定义、边界与源码入口；不会依据类名或测试名推断产品支持。

<a id="f01"></a>
### F01 · 创建宏内容 — `create-diagram`

**能力**：创建新 custom content，并区分编辑器保存与把宏放到页面。

**交互面**：`page-editor` ↗；`editor` ●；`fullscreen-editor` ●；`graph-editor` ●；`openapi-editor` ●；`asyncapi-editor` ●；`api-dashboard` ↗；`byline-diagrams` ↗；`byline-activation` ●；`external-agent` G。

**契约与边界**：原生插入/配置能够回写宏的 content ID；byline 和 Dashboard 先打开真实编辑器。Dashboard/Get Started 的教程卡片本身没有已绑定的创建动作；Aide 也不会直接创建宏内容。MCP 创建须解析安装变体与对应宏能力。

**代码证据**：[src/model/ContentProvider/CustomContentStorageProvider.ts:34](src/model/ContentProvider/CustomContentStorageProvider.ts#L34)；[src/components/AsyncApiDashboard/AsyncApiDashboard.vue:557](src/components/AsyncApiDashboard/AsyncApiDashboard.vue#L557)；[src/components/Byline/BylineDiagrams.vue:1062](src/components/Byline/BylineDiagrams.vue#L1062)；[src/components/Byline/BylineActivationDialog.vue:158](src/components/Byline/BylineActivationDialog.vue#L158)；[functions/agent-link/oauth/headlessTools.ts:900](functions/agent-link/oauth/headlessTools.ts#L900)。

<a id="f02"></a>
### F02 · 编辑宏内容 — `editing`

**能力**：编辑已有宏的源内容，包含适用的图表、API 规范或其他文档；也包括从列表/查看器进入该编辑流程。

**交互面**：`inline-viewer` ↗；`editor` ●；`fullscreen-editor` ●；`graph-editor` ●；`openapi-editor` ●；`asyncapi-editor` ●；`api-document-viewer` G；`api-dashboard` ↗；`byline-activation` ↗；`external-agent` G；`page-editor-preview` G。

**契约与边界**：普通内联查看器 Edit 打开 macroMode=editor。通用全屏查看器没有普通 Edit 按钮；AsyncAPI Dashboard 的 View 模态框有自己的 in-place Edit，AsyncAPI fullscreen 则没有它。引用重定向属于 embedding；源内容编辑属于本功能。 page-editor-preview 的仅 isEditing 分支也可能保留内联 Edit 接线；这属于源码条件关系，宿主预览中的真实交互还需 UI 验证。通用 Embed 的 Edit 接到引用选择器，见 F31；不将这个入口登记为已实现的源正文编辑。

**代码证据**：[src/forgeIndex.ts:1279](src/forgeIndex.ts#L1279)；[src/components/Viewer/GenericViewer.vue:339](src/components/Viewer/GenericViewer.vue#L339)；[src/forge-asyncapi-viewer.ts:117](src/forge-asyncapi-viewer.ts#L117)；[src/components/AsyncApiDashboard/AsyncApiDashboard.vue:621](src/components/AsyncApiDashboard/AsyncApiDashboard.vue#L621)；[functions/agent-link/oauth/headlessTools.ts:226](functions/agent-link/oauth/headlessTools.ts#L226)。

<a id="f03"></a>
### F03 · 保存与发布 — `publishing`

**能力**：将源内容写入 Confluence，再按入口完成宏配置/宿主关闭。

**交互面**：`editor` ●；`fullscreen-editor` ●；`graph-editor` ●；`openapi-editor` ●；`asyncapi-editor` ●；`embed-picker` ●；`asyncapi-embed-picker` ●；`external-agent` G。

**契约与边界**：custom content 是持久化正文；原生宏配置可以绑定新 ID，从查看器进入的模态框通常只更新正文并关闭。成功写正文、成功回写配置、成功放置到页面是不同完成条件。AsyncAPI Publish 要刷新 Monaco 的待处理变更。

**代码证据**：[src/model/ContentProvider/CustomContentStorageProvider.ts:34](src/model/ContentProvider/CustomContentStorageProvider.ts#L34)；[src/forgeIndex.ts:1483](src/forgeIndex.ts#L1483)；[src/components/Editor/AsyncApiEditor/AsyncApiStudioEditor.tsx:83](src/components/Editor/AsyncApiEditor/AsyncApiStudioEditor.tsx#L83)；[src/components/DocumentList/DocumentList.vue:278](src/components/DocumentList/DocumentList.vue#L278)；[src/forge-asyncapi-embed-editor.ts:36](src/forge-asyncapi-embed-editor.ts#L36)。

<a id="f04"></a>
### F04 · 复制后的独立性 — `copy-independence`

**能力**：区分真正的原文编辑与复制宏后需要 fork/rebind 的编辑。

**交互面**：`inline-viewer` G；`editor` G；`fullscreen-editor` G。

**契约与边界**：原生配置可创建独立内容并回写 ID；查看器 Edit 模态框不能持久化重绑，因此同页复制等危险状态会拒绝该路径。跨页副本、孤儿和快照恢复态另有只读限制。

**代码证据**：[src/forgeIndex.ts:920](src/forgeIndex.ts#L920)；[src/forgeIndex.ts:1291](src/forgeIndex.ts#L1291)；[src/components/Viewer/GenericViewer.vue:979](src/components/Viewer/GenericViewer.vue#L979)。

<a id="f05"></a>
### F05 · 文字图表类型切换 — `diagram-type-switching`

**能力**：ZenUML、Mermaid、PlantUML、Markdown 的标签和独立源缓冲。

**交互面**：`editor` ●；`fullscreen-editor` ●。

**契约与边界**：保留每种类型的源缓冲及类型偏好；显式请求类型优先。Graph、OpenAPI 和 AsyncAPI 使用独立编辑壳，不是这组标签的同义项。

**代码证据**：[src/model/Diagram/DiagramTypeConfig.ts:115](src/model/Diagram/DiagramTypeConfig.ts#L115)；[src/components/Header/Header.vue:145](src/components/Header/Header.vue#L145)；[src/components/Header/Header.vue:370](src/components/Header/Header.vue#L370)。

<a id="f06"></a>
### F06 · 源码编辑体验 — `code-authoring`

**能力**：CodeMirror 的撤销、折叠、缩进、换行、补全和类型特定输入规则。

**交互面**：`editor` ●；`fullscreen-editor` ●。

**契约与边界**：ZenUML completion、Mermaid language/linter/comment shortcut、PlantUML scaffold/paste normalization 有不同代码入口。Swagger/DrawIO/Studio 的原生编辑行为由各自壳和依赖提供，不能从 CodeMirror 的能力继承。

**代码证据**：[src/components/Editor/extensions.ts:126](src/components/Editor/extensions.ts#L126)；[src/components/Editor/extensions.ts:190](src/components/Editor/extensions.ts#L190)；[src/components/Editor/extensions.ts:237](src/components/Editor/extensions.ts#L237)；[src/components/Editor/extensions.ts:334](src/components/Editor/extensions.ts#L334)。

<a id="f07"></a>
### F07 · 编辑预览布局 — `preview-layout`

**能力**：源码与预览分栏、拖拽宽度、收起/恢复代码和 AI 侧栏。

**交互面**：`editor` ●；`fullscreen-editor` ●。

**契约与边界**：Workspace 同时组织 Editor 和 DiagramPortal；AI Chat 打开后调整代码可见性。布局状态影响编辑体验，不改变持久化图表正文。

**代码证据**：[src/components/Workspace.vue:35](src/components/Workspace.vue#L35)；[src/components/Workspace.vue:101](src/components/Workspace.vue#L101)；[src/components/Workspace.vue:168](src/components/Workspace.vue#L168)；[src/components/Workspace.vue:215](src/components/Workspace.vue#L215)。

<a id="f08"></a>
### F08 · Starter templates — `starter-templates`

**能力**：按当前文字类型选择模板替换当前源码。

**交互面**：`editor` ↗；`fullscreen-editor` ↗；`template-gallery` ●。

**契约与边界**：ZenUML/Mermaid/PlantUML 有模板；Markdown 不显示模板入口。新建、空白或未修改样例可按 cloud+type 自动展示一次；模板替换可由编辑器撤销。

**代码证据**：[src/components/Header/Header.vue:29](src/components/Header/Header.vue#L29)；[src/components/Header/Header.vue:289](src/components/Header/Header.vue#L289)；[src/components/Header/Header.vue:401](src/components/Header/Header.vue#L401)；[src/components/TemplateGallery/TemplateGallery.vue:18](src/components/TemplateGallery/TemplateGallery.vue#L18)；[src/model/Diagram/EditorTemplates.ts:3](src/model/Diagram/EditorTemplates.ts#L3)。

<a id="f09"></a>
### F09 · 标题与自动标题 — `titles`

**能力**：手工标题、清空、建议生成、关闭建议及保存约束。

**交互面**：`editor` G；`fullscreen-editor` G；`graph-editor` G；`openapi-editor` G。

**契约与边界**：文字/Graph 使用的 useAutoTitle 将 available 固定为 true，不靠远端开关；自动请求仍受内容、手动编辑和请求状态约束。文字保存有标题要求，Graph 发布会等待 ensureTitle；OpenAPI 的标题与规范 info.title 同步。并非所有格式都使用同一标题输入组件。

**代码证据**：[src/composables/useAutoTitle.ts:13](src/composables/useAutoTitle.ts#L13)；[src/components/Header/DiagramTitleInput.vue:1](src/components/Header/DiagramTitleInput.vue#L1)；[src/components/Header/DiagramTitleInput.vue:103](src/components/Header/DiagramTitleInput.vue#L103)；[src/components/Header/Header.vue:183](src/components/Header/Header.vue#L183)；[src/components/DrawIoExtension/DrawIoExtension.vue:120](src/components/DrawIoExtension/DrawIoExtension.vue#L120)；[src/components/react/Header.tsx:198](src/components/react/Header.tsx#L198)；[src/components/react/OpenApiTitleInput.tsx:49](src/components/react/OpenApiTitleInput.tsx#L49)。

<a id="f10"></a>
### F10 · 查看器内重命名 — `inline-rename`

**能力**：在原页面内直接修改已保存图表标题。

**交互面**：`inline-viewer` G；`external-agent` G；`page-editor-preview` G。

**契约与边界**：UI 只针对已认证、真实可编辑的 ZenUML/Mermaid custom content；嵌入、复制、恢复、缓存、加载失败和 fullscreen 不提供该 UI。Enter/blur 保存、Escape 取消。外部 Agent 的 title 更新走独立写工具权限。 PEP 仅 isEditing、无 configuring/inserting 的分支不会被 isDisplayMode 排除；记录该条件接线，不把它等同于已验证宿主可交互。

**代码证据**：[src/components/Viewer/GenericViewer.vue:58](src/components/Viewer/GenericViewer.vue#L58)；[src/components/Viewer/GenericViewer.vue:1009](src/components/Viewer/GenericViewer.vue#L1009)；[functions/agent-link/oauth/headlessTools.ts:226](functions/agent-link/oauth/headlessTools.ts#L226)。

<a id="f11"></a>
### F11 · 未发布草稿保存 — `unsaved-drafts`

**能力**：保存编辑中的本地正文、标题和模式缓冲。

**交互面**：`editor` A；`fullscreen-editor` A；`graph-editor` A；`openapi-editor` A；`embed-picker` A。

**契约与边界**：文字/Graph/OpenAPI 使用按 cloud 等身份限定、30 天过期的 draftStore；发布成功后清除。Graph 的 Diagram/Board 分别保存。通用 Embed 只看到关闭时保存选中 ID；AsyncAPI 单一 localStorage document 缓冲不属于这套草稿恢复契约。

**代码证据**：[src/utils/draftStore.ts:17](src/utils/draftStore.ts#L17)；[src/utils/draftStore.ts:65](src/utils/draftStore.ts#L65)；[src/components/Header/Header.vue:425](src/components/Header/Header.vue#L425)；[src/components/react/Header.tsx:79](src/components/react/Header.tsx#L79)；[src/components/DrawIoExtension/ForgeGraphEditor.vue:113](src/components/DrawIoExtension/ForgeGraphEditor.vue#L113)；[src/components/DocumentList/DocumentList.vue:226](src/components/DocumentList/DocumentList.vue#L226)。

<a id="f12"></a>
### F12 · 恢复未发布草稿 — `draft-recovery`

**能力**：重新打开后选择 Restore、Discard 或 Not now。

**交互面**：`editor` G；`fullscreen-editor` G；`graph-editor` G；`openapi-editor` G。

**契约与边界**：恢复提示保留 Not now 的草稿；Graph 要将模式对应草稿恢复到 iframe。不能把 Embed 的一次本地保存或 Studio 的共享缓冲记为完整重开恢复。

**代码证据**：[src/utils/restoreDraftBanner.ts:76](src/utils/restoreDraftBanner.ts#L76)；[src/components/Header/Header.vue:425](src/components/Header/Header.vue#L425)；[src/components/react/Header.tsx:79](src/components/react/Header.tsx#L79)；[src/components/DrawIoExtension/ForgeGraphEditor.vue:373](src/components/DrawIoExtension/ForgeGraphEditor.vue#L373)。

<a id="f13"></a>
### F13 · 关闭保护与刷盘 — `close-protection`

**能力**：关闭编辑壳时处理未发布变更和草稿。

**交互面**：`editor` A；`fullscreen-editor` A；`graph-editor` G；`openapi-editor` A；`embed-picker` G。

**契约与边界**：文字/Swagger 在宿主关闭链路刷盘并记录结果。文字 Header 当前没有可见 Exit 按钮，保留的显式 Exit 对话处理器不能证明该按钮存在。Graph/Embed 的关闭保护按各自 bridge 流程判断。

**代码证据**：[src/components/Header/Header.vue:1](src/components/Header/Header.vue#L1)；[src/components/Header/Header.vue:465](src/components/Header/Header.vue#L465)；[src/forgeIndex.ts:1584](src/forgeIndex.ts#L1584)；[src/components/react/Header.tsx:79](src/components/react/Header.tsx#L79)；[src/components/DocumentList/DocumentList.vue:219](src/components/DocumentList/DocumentList.vue#L219)。

<a id="f14"></a>
### F14 · 语法诊断 — `syntax-validation`

**能力**：检查当前源版本并展示对应错误，避免旧诊断覆盖新输入。

**交互面**：`editor` ●；`fullscreen-editor` ●；`openapi-editor` ●；`syntax-error-panel` ●；`external-agent` G。

**契约与边界**：ZenUML/Mermaid/PlantUML 有防抖验证；Markdown 跳过整篇语法错误判定。OpenAPI 使用规范检查。外部 MCP 的检查深度因格式不同，Graph/AsyncAPI 等 pass-through 不是完整语义验证。

**代码证据**：[src/components/Editor/Editor.vue:50](src/components/Editor/Editor.vue#L50)；[src/forge-swagger-editor.ts:81](src/forge-swagger-editor.ts#L81)；[src/components/SyntaxErrorBox.vue:40](src/components/SyntaxErrorBox.vue#L40)；[functions/agent-link/parseDsl.ts:13](functions/agent-link/parseDsl.ts#L13)；[functions/agent-link/parseDsl.ts:69](functions/agent-link/parseDsl.ts#L69)。

<a id="f15"></a>
### F15 · 异种 DSL 纠正 — `dialect-detection`

**能力**：粘贴 Mermaid/PlantUML 到 ZenUML 时提供准确的类型切换。

**交互面**：`editor` G；`fullscreen-editor` G；`syntax-error-panel` G。

**契约与边界**：迁移原文到匹配标签并清除旧错误；关闭提示只针对当前精确源文本。它不是任意格式的自动语义转换。

**代码证据**：[src/components/ForeignDialectHint.vue:76](src/components/ForeignDialectHint.vue#L76)；[src/components/ForeignDialectHint.vue:122](src/components/ForeignDialectHint.vue#L122)；[src/components/Workspace.vue:73](src/components/Workspace.vue#L73)。

<a id="f16"></a>
### F16 · AI 语法修复 — `ai-repair`

**能力**：持续语法错误触发 AI 修复，并让用户审阅和应用结果。

**交互面**：`editor` G；`fullscreen-editor` G；`openapi-editor` G；`syntax-error-panel` ↗；`ai-chat-panel` G；`ai-repair-dialog` ●。

**契约与边界**：支持 ZenUML/Mermaid/PlantUML/OpenAPI。ai-chat-enabled 与 ai-chat-repair-enabled 决定是否转入 Chat；否则 ai-repair-enabled 可走旧 Repair。旧框支持逐行接受、手改、加强修复和应用。Graph、Markdown、AsyncAPI Studio 没有这条接线。

**代码证据**：[src/components/SyntaxErrorBox.vue:101](src/components/SyntaxErrorBox.vue#L101)；[src/components/SyntaxErrorBox.vue:141](src/components/SyntaxErrorBox.vue#L141)；[src/components/AIRepair.vue:56](src/components/AIRepair.vue#L56)；[src/components/AIRepair.vue:407](src/components/AIRepair.vue#L407)；[src/forge-swagger-editor.ts:447](src/forge-swagger-editor.ts#L447)。

<a id="f17"></a>
### F17 · AI 修改宏内容 — `ai-chat`

**能力**：给当前宏的适用源内容（图表源码或 OpenAPI 规范）和指令，接收修改并应用到编辑器。

**交互面**：`editor` G；`fullscreen-editor` G；`openapi-editor` G；`ai-chat-panel` ●。

**契约与边界**：Vue 文字编辑器和 React OpenAPI 编辑器分别接线；支持 ZenUML/Mermaid/PlantUML/OpenAPI。绑定远端 Diagramly 文档、轮询、取消、超时和错误处理，与普通 Publish 分开；开关代码存在不代表某租户已开启。

**代码证据**：[src/components/Header/Header.vue:230](src/components/Header/Header.vue#L230)；[src/components/Workspace.vue:168](src/components/Workspace.vue#L168)；[src/components/react/SwaggerEditor.tsx:22](src/components/react/SwaggerEditor.tsx#L22)；[src/services/GenerateService.ts:103](src/services/GenerateService.ts#L103)；[src/services/AIChatSessionService.ts:177](src/services/AIChatSessionService.ts#L177)。

<a id="f18"></a>
### F18 · AI 变更审阅与撤销 — `ai-change-history`

**能力**：审阅 AI 差异、撤销应用、查看/恢复 AI 侧版本。

**交互面**：`editor` G；`fullscreen-editor` G；`ai-chat-panel` ●；`openapi-editor` G。

**契约与边界**：Chat 自动应用结果后提供差异和 undo/restore；它使用远端 AI 版本存储，不是 Confluence 全部版本历史。通用查看器菜单的 History 只打印控制台，不是本界面。

**代码证据**：[src/components/AIChat/AIChatPanel.vue:243](src/components/AIChat/AIChatPanel.vue#L243)；[src/components/AIChat/AIChatPanel.vue:912](src/components/AIChat/AIChatPanel.vue#L912)；[src/components/AIChat/AIChatPanel.vue:1001](src/components/AIChat/AIChatPanel.vue#L1001)；[src/components/react/SwaggerEditor.tsx:122](src/components/react/SwaggerEditor.tsx#L122)。

<a id="f19"></a>
### F19 · API 规范编辑 — `api-spec-authoring`

**能力**：Swagger 与 AsyncAPI Studio 的专门加载、编辑和保存。

**交互面**：`openapi-editor` ●；`asyncapi-editor` ●；`api-document-viewer` G；`api-dashboard` ↗。

**契约与边界**：Swagger 支持当前规范校验和 AI 宿主；Studio 通过共享 document 缓冲与轮询衔接 Monaco，并在保存前刷新待处理改动。已有文档加载失败时拒绝把占位内容当成可保存的原文。

**代码证据**：[src/forge-swagger-editor.ts:81](src/forge-swagger-editor.ts#L81)；[src/components/react/SwaggerEditor.tsx:107](src/components/react/SwaggerEditor.tsx#L107)；[src/components/Editor/AsyncApiEditor/AsyncApiStudioEditor.tsx:49](src/components/Editor/AsyncApiEditor/AsyncApiStudioEditor.tsx#L49)；[src/components/Editor/AsyncApiEditor/AsyncApiStudioEditor.tsx:83](src/components/Editor/AsyncApiEditor/AsyncApiStudioEditor.tsx#L83)；[src/forge-asyncapi-editor.ts:126](src/forge-asyncapi-editor.ts#L126)；[src/forge-asyncapi-viewer.ts:117](src/forge-asyncapi-viewer.ts#L117)。

<a id="f20"></a>
### F20 · Graph / Board 工作模式 — `graph-board-mode`

**能力**：分别保留 Diagram 与 Board 文档，并保存发布模式。

**交互面**：`graph-editor` ●；`inline-viewer` G；`fullscreen-viewer` G；`embedded-viewer` G。

**契约与边界**：切换模式前刷盘并恢复目标草稿；Board 使用 sketch UI。普通 Graph 查看器按发布 mode 选择 XML，空/损坏 Board 不借用 Diagram 内容。嵌入路径先传 effectiveDoc.graphXml，renderer 又优先取 graphXml prop；它可以绕过 published-mode resolver，所以不能把普通查看器的模式隔离保证直接沿用到 Embed。此源码不一致需要专门覆盖。

**代码证据**：[src/components/DrawIoExtension/ForgeGraphEditor.vue:167](src/components/DrawIoExtension/ForgeGraphEditor.vue#L167)；[src/forge-graph-editor.ts:63](src/forge-graph-editor.ts#L63)；[src/utils/graph/graphEditorMode.ts:34](src/utils/graph/graphEditorMode.ts#L34)；[src/utils/graph/boardDocument.ts:68](src/utils/graph/boardDocument.ts#L68)；[src/components/Viewer/ForgeGraphViewer.vue:97](src/components/Viewer/ForgeGraphViewer.vue#L97)；[src/components/Viewer/ForgeEmbedViewer.vue:15](src/components/Viewer/ForgeEmbedViewer.vue#L15)；[src/components/Viewer/ForgeGraphViewerEmbed.vue:73](src/components/Viewer/ForgeGraphViewerEmbed.vue#L73)。

<a id="f21"></a>
### F21 · Graph 多页文档 — `graph-multipage`

**能力**：保存完整 mxfile，并在查看器中切换图页。

**交互面**：`graph-editor` ●；`inline-viewer` G；`fullscreen-viewer` G；`embedded-viewer` G。

**契约与边界**：多页保存保留全部 pages；pageCount>1 时展示图页导航，通用 Graph 和 embedded Graph 各有独立渲染路径。

**代码证据**：[src/components/DrawIoExtension/ForgeGraphEditor.vue:322](src/components/DrawIoExtension/ForgeGraphEditor.vue#L322)；[src/components/Viewer/ForgeGraphViewer.vue:25](src/components/Viewer/ForgeGraphViewer.vue#L25)；[src/components/Viewer/ForgeGraphViewerEmbed.vue:11](src/components/Viewer/ForgeGraphViewerEmbed.vue#L11)。

<a id="f22"></a>
### F22 · 宏内容渲染 — `rendering`

**能力**：呈现宏的已存或当前编辑内容；依类型显示图表、API 规范、Markdown 文档或引用内容。

**交互面**：`inline-viewer` ●；`page-editor-preview` ●；`editor` ●；`fullscreen-editor` ●；`fullscreen-viewer` ●；`graph-editor` ●；`openapi-editor` ●；`asyncapi-editor` ●；`api-document-viewer` ●；`embedded-viewer` ●；`embed-picker` ●；`asyncapi-embed-picker` ●；`mcp-app-view` ●；`byline-activation` ●。

**契约与边界**：DiagramPortal 分发 ZenUML/Mermaid/PlantUML/Markdown，Graph、OpenAPI、AsyncAPI 和 Embed 有独立宿主。不同宿主的工具栏、交互和支持格式不相同；MCP Apps 不支持 AsyncAPI/Markdown/Embed。PlantUML 可走浏览器或公共服务，并有回退。

**代码证据**：[src/components/DiagramPortal.vue:1](src/components/DiagramPortal.vue#L1)；[src/components/Workspace.vue:45](src/components/Workspace.vue#L45)；[src/forgeIndex.ts:1083](src/forgeIndex.ts#L1083)；[src/model/Diagram/DiagramTypeConfig.ts:121](src/model/Diagram/DiagramTypeConfig.ts#L121)；[src/utils/plantuml/renderer.ts:3](src/utils/plantuml/renderer.ts#L3)；[src/mcp-app-view.ts:252](src/mcp-app-view.ts#L252)。

<a id="f23"></a>
### F23 · 缩放、适配与平移 — `viewport-controls`

**能力**：按渲染器控制画布尺寸和浏览方式。

**交互面**：`inline-viewer` G；`page-editor-preview` G；`editor` G；`fullscreen-editor` G；`fullscreen-viewer` G；`graph-editor` ●；`embedded-viewer` G。

**契约与边界**：SVG/transform/mxGraph 使用不同实现；普通滚轮滚动页面，Ctrl/Cmd-wheel 缩放；支持适配宽/高与拖动。导出采集可禁用交互。embedded Graph 有图页导航，但没有普通 Graph 的同等自定义 viewport 控件。

**代码证据**：[src/components/Viewer/DiagramViewport.vue:1](src/components/Viewer/DiagramViewport.vue#L1)；[src/components/Viewer/DiagramViewport.vue:95](src/components/Viewer/DiagramViewport.vue#L95)；[src/components/Viewer/DiagramTransformViewport.vue:1](src/components/Viewer/DiagramTransformViewport.vue#L1)；[src/components/Viewer/ForgeGraphViewer.vue:234](src/components/Viewer/ForgeGraphViewer.vue#L234)；[src/components/Viewer/ForgeGraphViewerEmbed.vue:1](src/components/Viewer/ForgeGraphViewerEmbed.vue#L1)；[src/components/Viewer/ForgeEmbedViewer.vue:12](src/components/Viewer/ForgeEmbedViewer.vue#L12)；[src/components/Viewer/GenericViewer.vue:12](src/components/Viewer/GenericViewer.vue#L12)。

<a id="f24"></a>
### F24 · ZenUML 图上交互 — `zenuml-inline-interaction`

**能力**：主题与参与者文字的图上编辑/变更回传。

**交互面**：`inline-viewer` G；`page-editor-preview` G；`editor` G；`fullscreen-editor` G；`fullscreen-viewer` G；`embedded-viewer` G。

**契约与边界**：主题按浏览器或内容保存偏好；参与者变更通过 onContentChange 更新内容。readOnly 分支移除变更回调，因此预制只读预览不具备同一编辑契约。 通用文字 Embed 没有统一传 readOnly，仍可保留 onContentChange 接线；这不是已经验证跨引用写回安全的保证。

**代码证据**：[src/components/Sequence.vue:53](src/components/Sequence.vue#L53)；[src/components/Sequence.vue:135](src/components/Sequence.vue#L135)；[src/components/Sequence.vue:191](src/components/Sequence.vue#L191)；[src/components/Viewer/ForgeEmbedViewer.vue:12](src/components/Viewer/ForgeEmbedViewer.vue#L12)；[src/components/Viewer/GenericViewer.vue:12](src/components/Viewer/GenericViewer.vue#L12)。

<a id="f25"></a>
### F25 · Markdown 文档 — `markdown-documents`

**能力**：GFM 文档、Mermaid fenced blocks、链接与局部渲染错误。

**交互面**：`editor` ●；`fullscreen-editor` ●；`inline-viewer` ●；`fullscreen-viewer` ●；`embedded-viewer` ●；`page-editor-preview` G。

**契约与边界**：HTML 经过安全处理，链接新窗口打开；单个图块失败保留源文及其他文档内容。Markdown 不继承整篇 AI Chat、Starter templates 或 AI Repair。

**代码证据**：[src/utils/markdown/renderMarkdown.tsx:24](src/utils/markdown/renderMarkdown.tsx#L24)；[src/components/Markdown.vue:1](src/components/Markdown.vue#L1)；[src/model/Diagram/DiagramTypeConfig.ts:115](src/model/Diagram/DiagramTypeConfig.ts#L115)。

<a id="f26"></a>
### F26 · Mermaid 关系高亮 — `mermaid-highlights`

**能力**：hover/click 关系高亮、开关、首次提示与反馈。

**交互面**：`inline-viewer` G；`fullscreen-viewer` G；`embedded-viewer` G；`page-editor-preview` G。

**契约与边界**：支持相应的 Mermaid flowchart 模型；Workspace 的 hideHeader/readOnly 预览不接高亮 wrapper，但 page-editor-preview 仅 isEditing 的分支和通用文字 Embed 没有统一设置这些属性，仍可保留 wrapper。关闭或不支持的模型走普通渲染；采集期间禁用交互高亮。

**代码证据**：[src/components/DiagramPortal.vue:2](src/components/DiagramPortal.vue#L2)；[src/components/Viewer/MermaidHighlightViewer.vue:1](src/components/Viewer/MermaidHighlightViewer.vue#L1)；[src/components/Mermaid.vue:154](src/components/Mermaid.vue#L154)；[src/utils/mermaid/renderMermaid.ts:42](src/utils/mermaid/renderMermaid.ts#L42)；[src/components/Viewer/ForgeEmbedViewer.vue:12](src/components/Viewer/ForgeEmbedViewer.vue#L12)；[src/components/Viewer/GenericViewer.vue:12](src/components/Viewer/GenericViewer.vue#L12)。

<a id="f27"></a>
### F27 · Mermaid Refined 布局 — `refined-layout`

**能力**：在已准备的安全布局产物与原始图之间切换并反馈偏好。

**交互面**：`inline-viewer` G；`fullscreen-viewer` G；`page-editor-preview` G。

**契约与边界**：读取并校验已存 artifact，不由查看器发起新模型生成。缺失/过期时可请求 writeback；guest/anonymous、复制、孤儿或 Workspace 内 hideHeader/非 display 预览等有排除条件。失败保留原始图。 Confluence page-editor-preview 只带 isEditing 的分支不等于 Workspace 预览，需按实际 display/header 条件评估。

**代码证据**：[src/components/Viewer/GenericViewer.vue:127](src/components/Viewer/GenericViewer.vue#L127)；[src/components/Viewer/GenericViewer.vue:1603](src/components/Viewer/GenericViewer.vue#L1603)；[src/components/Viewer/GenericViewer.vue:1657](src/components/Viewer/GenericViewer.vue#L1657)；[src/components/Viewer/GenericViewer.vue:1878](src/components/Viewer/GenericViewer.vue#L1878)；[functions/magic-writeback.ts:53](functions/magic-writeback.ts#L53)。

<a id="f28"></a>
### F28 · 查看与复制源码 — `view-source`

**能力**：对已渲染内容打开只读源文面板并复制。

**交互面**：`inline-viewer` ↗；`fullscreen-viewer` ↗；`source-panel` ●；`byline-diagrams` G；`embedded-viewer` G；`page-editor-preview` G。

**契约与边界**：查看器面板支持 ZenUML/Mermaid/PlantUML/Markdown，独立于编辑权限；byline 的 Copy source 还受行状态与更高优先级放置动作影响。

**代码证据**：[src/components/Viewer/GenericViewer.vue:1035](src/components/Viewer/GenericViewer.vue#L1035)；[src/components/Viewer/ViewSourcePanel.vue:1](src/components/Viewer/ViewSourcePanel.vue#L1)；[src/components/Byline/BylineDiagrams.vue:213](src/components/Byline/BylineDiagrams.vue#L213)；[src/components/Byline/BylineDiagrams.vue:985](src/components/Byline/BylineDiagrams.vue#L985)；[src/components/Viewer/ForgeEmbedViewer.vue:12](src/components/Viewer/ForgeEmbedViewer.vue#L12)；[src/components/Viewer/GenericViewer.vue:12](src/components/Viewer/GenericViewer.vue#L12)。

<a id="f29"></a>
### F29 · 复制给外部 AI — `copy-for-ai`

**能力**：复制源文与尽力获取的页面上下文，并选择任务 prompt。

**交互面**：`inline-viewer` G；`fullscreen-viewer` G；`embedded-viewer` G；`page-editor-preview` G。

**契约与边界**：提供 generic/explain/update/implement/audit/tests；只向剪贴板传输，不在这里调用模型。页面上下文失败可退化为图表上下文；Connect MCP 开启时可占据其主按钮位置。

**代码证据**：[src/components/Viewer/CopyForAiMenu.vue:60](src/components/Viewer/CopyForAiMenu.vue#L60)；[src/components/Viewer/GenericViewer.vue:1056](src/components/Viewer/GenericViewer.vue#L1056)；[src/components/Viewer/GenericViewer.vue:2616](src/components/Viewer/GenericViewer.vue#L2616)；[src/utils/copyForAi/buildCopyForAiPrompt.ts:73](src/utils/copyForAi/buildCopyForAiPrompt.ts#L73)；[src/components/Viewer/ForgeEmbedViewer.vue:12](src/components/Viewer/ForgeEmbedViewer.vue#L12)；[src/components/Viewer/GenericViewer.vue:12](src/components/Viewer/GenericViewer.vue#L12)。

<a id="f30"></a>
### F30 · 宏内容、页面与放置链接 — `diagram-links`

**能力**：复制源页面 URL、图表 deeplink 或可放置的类型化链接。

**交互面**：`inline-viewer` G；`fullscreen-viewer` G；`byline-diagrams` ●；`unplaced-banner` G；`home-feed` ↗；`api-dashboard` ↗；`diagram-locations` ↗；`embedded-viewer` G；`page-editor-preview` G；`page-banner` G；`byline-activation` G。

**契约与边界**：普通 Copy diagram link 不会铸造临时 PNG 分享票据。类型化四段链接与三段 Embed 引用链接用途不同；Owning page 导航不等于打开图表模态框。产品 host 和已存 content ID 也影响按钮可用性。PB 的 unplaced 分支与 UB 共用链接组件。BA 完成链接使用三段 buildEmbedDeeplink；富预览票据失败也回落到这种链接，区别于 byline／banner 的四段 typed link。三段路由表示引用，不表示所有 Embed 分支都已强制隐藏 Edit，见 F31。

**代码证据**：[src/components/Viewer/GenericViewer.vue:2257](src/components/Viewer/GenericViewer.vue#L2257)；[src/components/Viewer/GenericViewer.vue:2522](src/components/Viewer/GenericViewer.vue#L2522)；[src/components/Byline/BylineDiagrams.vue:1013](src/components/Byline/BylineDiagrams.vue#L1013)；[src/components/Byline/UnplacedDiagramsBanner.vue:523](src/components/Byline/UnplacedDiagramsBanner.vue#L523)；[src/utils/embedDeeplink.ts:85](src/utils/embedDeeplink.ts#L85)；[src/components/Viewer/ForgeEmbedViewer.vue:12](src/components/Viewer/ForgeEmbedViewer.vue#L12)；[src/components/Viewer/GenericViewer.vue:12](src/components/Viewer/GenericViewer.vue#L12)。[src/routes/pageBanner.ts:109](src/routes/pageBanner.ts#L109)；[src/components/Byline/BylineActivationDialog.vue:243](src/components/Byline/BylineActivationDialog.vue#L243)。

<a id="f31"></a>
### F31 · 引用已有内容 — `embedding`

**能力**：搜索、预览、选择、发布或重定向对源内容的引用。

**交互面**：`embed-picker` ●；`asyncapi-embed-picker` ●；`embedded-viewer` ●；`editor` ↗。

**契约与边界**：通用选择器含类型、标题/内容/页面搜索、页面分组和引用发布；其 registry 不含 AsyncAPI，后者用专用宏/选择器。选择目标缺失时保持编辑器并报错；Viewer Edit 与原生引用重配置能力不同。EV 格的 ● 表示引用渲染；另有 Edit → 选择器的交接：适用 GenericViewer 分支未排除 isEmbedded，点击不携带源编辑参数，沿 Embed 模块进入选择器。这不证明能够修改源正文。forgeIndex 与 Embed 入口均追加 edit 监听，一次事件可调用两次 openModal；选择器保存依赖 view.submit。**待 UI 验证**：宿主如何处理两次打开、modal 内提交是否失败、引用是否正确重绑定。原生宏配置的引用发布不能作为此 modal 路径通过的证据。

**代码证据**：[src/components/DocumentList/DocumentList.vue:6](src/components/DocumentList/DocumentList.vue#L6)；[src/components/DocumentList/DocumentList.vue:148](src/components/DocumentList/DocumentList.vue#L148)；[src/model/Diagram/DiagramTypeConfig.ts:121](src/model/Diagram/DiagramTypeConfig.ts#L121)；[src/forge-embed-editor.ts:64](src/forge-embed-editor.ts#L64)；[src/components/Editor/AsyncApiEmbedEditor/AsyncApiEmbedEditor.tsx:63](src/components/Editor/AsyncApiEmbedEditor/AsyncApiEmbedEditor.tsx#L63)；[src/forgeIndex.ts:1115](src/forgeIndex.ts#L1115)。[src/components/Viewer/GenericViewer.vue:961](src/components/Viewer/GenericViewer.vue#L961)；[src/forgeIndex.ts:1279](src/forgeIndex.ts#L1279)；[src/forge-embed-viewer.ts:210](src/forge-embed-viewer.ts#L210)；[src/forge-embed-editor.ts:136](src/forge-embed-editor.ts#L136)；[src/EventBus.ts:5](src/EventBus.ts#L5)。

<a id="f32"></a>
### F32 · 粘贴创建与引用宏 — `paste-insertion`

**能力**：在 Confluence 页面编辑器/Live Docs 中将 deeplink 转为正确宏。

**交互面**：`page-editor` ●；`embedded-viewer` G；`byline-diagrams` ↗；`unplaced-banner` ↗；`page-banner` ↗；`byline-activation` ↗。

**契约与边界**：/new/type 触发对应新宏；四段 typed link 放入可编辑真实宏；三段 bare link 是 Embed 引用。按变体 host 避免多应用 matcher 冲突；跨 tenant 引用会被拒绝。页面宿主的粘贴与宏内 page-editor-preview 是两个不同界面。PB 和 UB 的复制动作交给宿主粘贴处理；BA 完成链接粘贴后匹配 Embed 引用，而非直接放置可编辑的类型化源宏。链接生成与 matcher 已由代码确认，实际粘贴及后续编辑结果**待 UI 验证**。

**代码证据**：[manifest.yml:216](manifest.yml#L216)；[manifest.yml:279](manifest.yml#L279)；[src/utils/embedDeeplink.ts:47](src/utils/embedDeeplink.ts#L47)；[src/utils/embedDeeplink.ts:85](src/utils/embedDeeplink.ts#L85)；[src/forge-embed-viewer.ts:29](src/forge-embed-viewer.ts#L29)；[src/components/Byline/BylineDiagrams.vue:1252](src/components/Byline/BylineDiagrams.vue#L1252)。[src/components/Byline/UnplacedDiagramsBanner.vue:518](src/components/Byline/UnplacedDiagramsBanner.vue#L518)；[src/components/Byline/BylineActivationDialog.vue:243](src/components/Byline/BylineActivationDialog.vue#L243)。

<a id="f33"></a>
### F33 · 临时富分享预览 — `rich-share`

**能力**：生成带 PNG 的短期外部链接及原页面回链。

**交互面**：`byline-activation` G；`external-share-preview` ●。

**契约与边界**：预制图接受后可采图并铸造签名票据；PNG TTL 为 600 秒。无效/缺失票据给说明页，过期给失效页；采图或铸造失败可保留普通链接。GenericViewer 的普通 Copy link 不具有此生命周期。

**代码证据**：[src/components/Byline/BylineActivationDialog.vue:225](src/components/Byline/BylineActivationDialog.vue#L225)；[functions/deeplink-ticket.ts:140](functions/deeplink-ticket.ts#L140)；[functions/d/[[path]].ts:23](functions/d/[[path]].ts#L23)；[functions/utils/deeplink.ts:17](functions/utils/deeplink.ts#L17)。

<a id="f34"></a>
### F34 · PNG 导出 — `export-image`

**能力**：从查看器进入工作区，下载图像或处理导出状态。

**交互面**：`inline-viewer` ↗；`fullscreen-viewer` ↗；`export-workspace` ●；`embedded-viewer` G；`page-editor-preview` G。

**契约与边界**：内联入口通过更大 Forge modal 承载，已有全屏查看器原位打开；关闭临时 export host 会关闭该宿主。普通格式不能向 AsyncAPI raw fullscreen 自动继承同一导出动作。AsyncAPI 内联 Export 仍交到 fullscreen modal，但 raw AsyncApiViewer 不消费 openExport，也没有 ExportWorkspace；规范仍可渲染。**待 UI 验证**：该按钮交接后的画面及导出结果。

**代码证据**：[src/components/Viewer/GenericViewer.vue:2370](src/components/Viewer/GenericViewer.vue#L2370)；[src/forgeIndex.ts:1643](src/forgeIndex.ts#L1643)；[src/components/ExportModal/ExportWorkspace.vue:2](src/components/ExportModal/ExportWorkspace.vue#L2)；[src/components/ExportModal/useExportEngine.ts:17](src/components/ExportModal/useExportEngine.ts#L17)；[src/forge-asyncapi-viewer.ts:92](src/forge-asyncapi-viewer.ts#L92)；[src/components/Viewer/ForgeEmbedViewer.vue:12](src/components/Viewer/ForgeEmbedViewer.vue#L12)；[src/components/Viewer/GenericViewer.vue:12](src/components/Viewer/GenericViewer.vue#L12)。[src/forge-asyncapi-viewer.ts:92](src/forge-asyncapi-viewer.ts#L92)；[src/forge-asyncapi-viewer.ts:155](src/forge-asyncapi-viewer.ts#L155)；[src/forge-asyncapi-viewer.ts:171](src/forge-asyncapi-viewer.ts#L171)；[src/forgeIndex.ts:1643](src/forgeIndex.ts#L1643)。

<a id="f35"></a>
### F35 · 导出标注 — `export-annotations`

**能力**：为导出图像增加可选择、移动、调整和删除的标注。

**交互面**：`export-workspace` ●。

**契约与边界**：文字、箭头、callout、矩形可多实例；只影响导出图像。当前页面访问内关闭/重开及跨导出宿主 handoff 保留会话；刷新后不作为文档草稿恢复。

**代码证据**：[src/components/ExportModal/ExportWorkspace.vue:2](src/components/ExportModal/ExportWorkspace.vue#L2)；[src/components/ExportModal/useAnnotations.ts:1](src/components/ExportModal/useAnnotations.ts#L1)；[src/components/ExportModal/ExportModal.vue:81](src/components/ExportModal/ExportModal.vue#L81)；[src/components/ExportModal/exportSessionHandoff.ts:1](src/components/ExportModal/exportSessionHandoff.ts#L1)。

<a id="f36"></a>
### F36 · 导出水印 — `export-watermark`

**能力**：为 PNG 设置一个文字水印。

**交互面**：`export-workspace` ●。

**契约与边界**：同一导出图只有一个水印；其设置属于当前导出会话，不写回图表正文。它与可重复实例的 annotations 分开。

**代码证据**：[src/components/ExportModal/ExportSidebar.vue:1](src/components/ExportModal/ExportSidebar.vue#L1)；[src/components/ExportModal/ExportModal.vue:81](src/components/ExportModal/ExportModal.vue#L81)；[src/components/ExportModal/useExportEngine.ts:17](src/components/ExportModal/useExportEngine.ts#L17)。

<a id="f37"></a>
### F37 · 导出背景与预览 — `export-background`

**能力**：选择预设/自定义背景、刷新预览并保留错误状态。

**交互面**：`export-workspace` ●。

**契约与边界**：导出预览、背景和生成失败属于工作区会话；固定输出 PNG，不是多格式选择器。

**代码证据**：[src/components/ExportModal/ExportWorkspace.vue:2](src/components/ExportModal/ExportWorkspace.vue#L2)；[src/components/ExportModal/ExportPreview.vue:1](src/components/ExportModal/ExportPreview.vue#L1)；[src/components/ExportModal/useExportEngine.ts:17](src/components/ExportModal/useExportEngine.ts#L17)。

<a id="f38"></a>
### F38 · 复制 PNG 到剪贴板 — `export-clipboard`

**能力**：生成图像后复制，提供拒绝和生成失败的反馈。

**交互面**：`export-workspace` ●。

**契约与边界**：图像剪贴板与 DSL/URL 文本复制是不同契约；权限拒绝不会改变原始图表。

**代码证据**：[src/components/ExportModal/ExportWorkspace.vue:2](src/components/ExportModal/ExportWorkspace.vue#L2)；[src/components/ExportModal/useExportEngine.ts:17](src/components/ExportModal/useExportEngine.ts#L17)；[src/components/ExportModal/ExportModal.vue:191](src/components/ExportModal/ExportModal.vue#L191)。

<a id="f39"></a>
### F39 · Confluence PDF / Word 导出 — `document-export`

**能力**：在宿主导出的文档中输出图像或 API 规范。

**交互面**：`document-export` ●；`inline-viewer` A；`editor` A；`fullscreen-editor` A；`embedded-viewer` A；`page-editor-preview` A。

**契约与边界**：普通 Diagram/Graph/OpenAPI/Embed 的 adfExport 使用 Confluence PNG 附件作为 native media；缺图、未发布、生成/权限失败用占位状态。AsyncAPI 分支导出规范内容。图像附件由渲染/保存路径维护；不等于用户下载的标注 PNG。PEP 在仅 extension.isEditing、无 configuring/inserting 的条件下仍是 display 模式，可触发 PNG 维护；EV 也有独立 afterLoad PNG 路径。两者均受模式、正文、权限及附件上传结果限制，存在调用不等于附件生成成功。MCP 创建／更新不直接维护这些附件，见 F67。

**代码证据**：[manifest.yml:211](manifest.yml#L211)；[manifest.yml:332](manifest.yml#L332)；[src/export.js:373](src/export.js#L373)；[src/export.js:585](src/export.js#L585)；[src/asyncapi-export.js:30](src/asyncapi-export.js#L30)；[src/model/Attachment.ts:425](src/model/Attachment.ts#L425)；[src/forge-embed-viewer.ts:145](src/forge-embed-viewer.ts#L145)。[src/model/ApWrapper2.ts:1508](src/model/ApWrapper2.ts#L1508)；[src/forgeIndex.ts:1232](src/forgeIndex.ts#L1232)。

<a id="f40"></a>
### F40 · 源文快照与附件后备 — `source-snapshots`

**能力**：给适用文字图表保留 Confluence 源文附件，并在读取失败时回退。

**交互面**：`inline-viewer` A；`fullscreen-viewer` A；`editor` A；`fullscreen-editor` A；`page-editor-preview` A。

**契约与边界**：ZenUML/Mermaid/PlantUML/Markdown 的 zenuml-ID.json 与 PNG 附件有不同用途。快照失败软降级；Graph/OpenAPI/AsyncAPI 不属于这条文字快照管线。D1/Cloudflare 镜像不是用户图表正文的必需存储。PEP 的上述 display 模式会单独进入 forgeIndex 的 maybeBackfillSnapshot；该函数检查源版本、适用格式与已知拒绝状态，非 display 分支仅补跨页引用。EV 的 PNG 路径没有对应 JSON 快照调用，故不新增 EV 快照关系。MCP 写入后的 JSON 更新依赖适用读取／保存路径再触发，并非任意一次渲染都保证补齐。

**代码证据**：[src/model/SnapshotAttachment.ts:32](src/model/SnapshotAttachment.ts#L32)；[src/model/SnapshotAttachment.ts:115](src/model/SnapshotAttachment.ts#L115)；[src/model/ContentProvider/Persistence.ts:151](src/model/ContentProvider/Persistence.ts#L151)；[src/forgeIndex.ts:519](src/forgeIndex.ts#L519)；[src/forgeIndex.ts:638](src/forgeIndex.ts#L638)。[src/forgeIndex.ts:638](src/forgeIndex.ts#L638)；[src/model/SnapshotAttachment.ts:299](src/model/SnapshotAttachment.ts#L299)。

<a id="f41"></a>
### F41 · 加载与内容恢复 — `content-recovery`

**能力**：缓存读取、后台校验、孤儿/旧内容/快照恢复以及只读提示。

**交互面**：`inline-viewer` G；`page-editor-preview` G；`editor` G；`fullscreen-editor` G；`embedded-viewer` G。

**契约与边界**：缓存/恢复所得内容与可编辑实时正文不同；复制、孤儿和未验证旧源状态会限制编辑。原生页面编辑器负责部分重绑定修复；Persistence 拒绝把未验证的 legacy-loaded 源直接保存。

**代码证据**：[src/forgeIndex.ts:460](src/forgeIndex.ts#L460)；[src/forgeIndex.ts:680](src/forgeIndex.ts#L680)；[src/components/Viewer/GenericViewer.vue:46](src/components/Viewer/GenericViewer.vue#L46)；[src/components/Viewer/GenericViewer.vue:979](src/components/Viewer/GenericViewer.vue#L979)；[src/model/ContentProvider/Persistence.ts:40](src/model/ContentProvider/Persistence.ts#L40)；[src/forge-embed-viewer.ts:86](src/forge-embed-viewer.ts#L86)。

<a id="f42"></a>
### F42 · 加载失败与重试 — `load-retry`

**能力**：结束加载状态、显示原因并在安全情况下重新读取。

**交互面**：`inline-viewer` ●；`fullscreen-viewer` ●；`embedded-viewer` ●；`asyncapi-editor` ●；`api-dashboard` ●；`diagram-locations` ●；`byline-diagrams` ●；`page-editor-preview` G。

**契约与边界**：有源失败可 Retry；无源显示解释。Embed 缺失/不支持进入终态；其 Retry 仅适用于已挂载 GenericViewer 且满足 hasRetryableFailure 的分支，并非所有失败都有重试按钮；Studio 有自己的准备/加载错误和 Retry，失败的旧文档不能用占位内容覆盖保存。各列表也有独立 retry/resume。PEP 复用 GenericViewer 的加载错误／Retry 区块；G 表示源码条件关系，**待 UI 验证**其在 Confluence 编辑态中的可见性和可操作性。

**代码证据**：[src/components/Viewer/GenericViewer.vue:419](src/components/Viewer/GenericViewer.vue#L419)；[src/components/Viewer/ForgeEmbedViewer.vue:68](src/components/Viewer/ForgeEmbedViewer.vue#L68)；[src/components/Editor/AsyncApiEditor/AsyncApiStudioEditor.tsx:217](src/components/Editor/AsyncApiEditor/AsyncApiStudioEditor.tsx#L217)；[src/forge-asyncapi-editor.ts:126](src/forge-asyncapi-editor.ts#L126)；[src/components/PlanUsage/DiagramLocations.vue:153](src/components/PlanUsage/DiagramLocations.vue#L153)。

<a id="f43"></a>
### F43 · 页面编辑态过时提示 — `staleness-hint`

**能力**：提示页面编辑预览中的内容已陈旧，并提供编辑入口。

**交互面**：`page-editor-preview` G。

**契约与边界**：限定 ZenUML/Mermaid/PlantUML/Graph、开关、漂移阈值和未关闭提示；只在 Confluence page editor 的宏预览触发，不把原生配置或所有 fullscreen 统称 editor。

**代码证据**：[src/utils/stalenessHint/core.ts:15](src/utils/stalenessHint/core.ts#L15)；[src/utils/stalenessHint/maybeShowStalenessHint.ts:6](src/utils/stalenessHint/maybeShowStalenessHint.ts#L6)；[src/forgeIndex.ts:650](src/forgeIndex.ts#L650)。

<a id="f44"></a>
### F44 · 作者与可选浏览信息 — `attribution`

**能力**：展示创建/更新者与可选浏览数。

**交互面**：`inline-viewer` G；`fullscreen-viewer` G；`page-editor-preview` G；`embedded-viewer` G。

**契约与边界**：归属信息和计数需实际解析成功；计数是可选后端增强，不应成为图表正文加载或渲染的前置条件。PEP 与适用文字 EV 复用 GenericViewer 页脚；EV 的 viewerBootstrap 也发布 attribution。需数据成功解析且显示条件满足，**待 UI 验证**具体宿主中的呈现。

**代码证据**：[src/components/Viewer/GenericViewer.vue:485](src/components/Viewer/GenericViewer.vue#L485)；[src/components/Viewer/DiagramAttributionFooter.vue:1](src/components/Viewer/DiagramAttributionFooter.vue#L1)；[src/components/Viewer/DiagramAttributionFooter.vue:47](src/components/Viewer/DiagramAttributionFooter.vue#L47)。[src/utils/viewerBootstrap.ts:176](src/utils/viewerBootstrap.ts#L176)；[src/utils/viewerBootstrap.ts:222](src/utils/viewerBootstrap.ts#L222)。

<a id="f45"></a>
### F45 · 相关图表与参与者关系 — `related-diagrams`

**能力**：显示参与者计数、相关位置与其他页面的导航。

**交互面**：`inline-viewer` G；`fullscreen-viewer` G。

**契约与边界**：有已存 ID 的 ZenUML 或 Mermaid sequence diagram，且相关功能开关开启。依赖 architecture token/related 后端，不能由该组件存在推断 guest 或任意图种都可用。

**代码证据**：[src/components/Viewer/GenericViewer.vue:907](src/components/Viewer/GenericViewer.vue#L907)；[src/components/Viewer/GenericViewer.vue:1443](src/components/Viewer/GenericViewer.vue#L1443)；[src/components/Viewer/RelatedDiagramsFooter.vue:25](src/components/Viewer/RelatedDiagramsFooter.vue#L25)；[functions/api/architecture-tokens/related.ts:1](functions/api/architecture-tokens/related.ts#L1)。

<a id="f46"></a>
### F46 · Create 插入引导 — `creation-guidance`

**能力**：说明如何从 Confluence 插入适用图表。

**交互面**：`inline-viewer` G；`create-guide` ●；`page-editor-preview` G；`embedded-viewer` G。

**契约与边界**：Lite、开关、支持类型、非 fullscreen 且正常操作行满足条件才有 Create 入口；打开指导模态框，不是直接在当前位置创建 custom content。showCreateGuide 未统一排除 isEmbedded；满足相同 Lite／类型／模式条件的 PEP 和文字 EV 也有接线。**待 UI 验证**入口在这两个宿主中是否可见，以及是否成功打开引导。

**代码证据**：[src/components/Viewer/GenericViewer.vue:1138](src/components/Viewer/GenericViewer.vue#L1138)；[src/forgeIndex.ts:107](src/forgeIndex.ts#L107)；[src/features/createGuide/CreateGuideModal.vue:1](src/features/createGuide/CreateGuideModal.vue#L1)。[src/components/Viewer/GenericViewer.vue:1145](src/components/Viewer/GenericViewer.vue#L1145)。

<a id="f47"></a>
### F47 · 宏内容清单、搜索与打开 — `diagram-discovery`

**能力**：按所在界面列出可访问图表，筛选并导航到图表或拥有页面。

**交互面**：`home-feed` ●；`byline-diagrams` ●；`api-dashboard` ●；`diagram-locations` ●；`embed-picker` ●；`asyncapi-embed-picker` ●。

**契约与边界**：Home 卡片最多三个 recent 且要求拥有页面/空间；byline 是当前页面清单；My API Documents 包含格式、状态、排序和搜索；Embed 是选引用；Diagram locations 是部分全站拥有页面清单。DB/GS 没有通用文档库。

**代码证据**：[src/components/HomepageFeed/HomepageFeedCard.vue:304](src/components/HomepageFeed/HomepageFeedCard.vue#L304)；[src/components/Byline/BylineDiagrams.vue:684](src/components/Byline/BylineDiagrams.vue#L684)；[src/components/AsyncApiDashboard/AsyncApiDashboard.vue:52](src/components/AsyncApiDashboard/AsyncApiDashboard.vue#L52)；[src/components/AsyncApiDashboard/AsyncApiDashboard.vue:510](src/components/AsyncApiDashboard/AsyncApiDashboard.vue#L510)；[src/components/PlanUsage/DiagramLocations.vue:13](src/components/PlanUsage/DiagramLocations.vue#L13)；[src/components/DocumentList/DocumentList.vue:148](src/components/DocumentList/DocumentList.vue#L148)。

<a id="f48"></a>
### F48 · 归档 API 文档 — `archive-api-documents`

**能力**：在 API 文档清单确认并归档已有文档。

**交互面**：`api-dashboard` ●。

**契约与边界**：PUT 将正文状态更新为 trashed，修改标题后缀并递增版本；当前模板未发现 Restore 操作，不能按确认文案承诺可在此恢复。kebab 状态变量也不代表已有更多可见动作。

**代码证据**：[src/components/AsyncApiDashboard/AsyncApiDashboard.vue:667](src/components/AsyncApiDashboard/AsyncApiDashboard.vue#L667)。

<a id="f49"></a>
### F49 · 已保存但未放置的宏内容 — `placement-recovery`

**能力**：识别未放置内容，添加到页面或提供可复制的放置链接。

**交互面**：`byline-diagrams` G；`page-banner` G；`unplaced-banner` G。

**契约与边界**：检查 marker/property 与实时页面；成功放置会更新记录。写入不被允许时撤下动作、保留复制方案；被截断的属性清单可引导用户到 byline。未放置记录不等于丢失正文。共享 PB 的 unplaced 分支使用 marker 来源，独立 UB 使用页面 property 来源，两者挂载同一 UnplacedDiagramsBanner；展示还分别受路由优先级和触发条件限制。MCP 创建失败可能留下未被页面引用的正文；是否出现在此清单、是否可从此修复，**待 UI 验证**，不保证自动发现所有孤儿。

**代码证据**：[src/components/Byline/BylineDiagrams.vue:194](src/components/Byline/BylineDiagrams.vue#L194)；[src/components/Byline/BylineDiagrams.vue:952](src/components/Byline/BylineDiagrams.vue#L952)；[src/components/Byline/UnplacedDiagramsBanner.vue:236](src/components/Byline/UnplacedDiagramsBanner.vue#L236)；[src/components/Byline/UnplacedDiagramsBanner.vue:478](src/components/Byline/UnplacedDiagramsBanner.vue#L478)；[src/routes/pageBanner.ts:109](src/routes/pageBanner.ts#L109)。

<a id="f50"></a>
### F50 · 接受预制图表 — `prepared-diagram-activation`

**能力**：预览预制内容，接受保存、再编辑并取得完成链接。

**交互面**：`byline-activation` ●。

**契约与边界**：支持 ZenUML/Mermaid/PlantUML；其他格式显式报错。只读预览不允许图上编辑。Edit prepared 会先保存再打开编辑器；代码本身注明嵌套 modal 行为尚待 UI 验证。接受成功不等于已向页面插入类型化宏。完成链接及票据的 bare fallback 均使用三段 Embed 链接，粘贴匹配引用宏；源宏放置、引用重定向与源正文编辑分别判断。mintDeeplink 对 AsyncAPI 返回 undefined，不能扩展此处支持格式。

**代码证据**：[src/components/Byline/BylineActivationDialog.vue:74](src/components/Byline/BylineActivationDialog.vue#L74)；[src/components/Byline/BylineActivationDialog.vue:108](src/components/Byline/BylineActivationDialog.vue#L108)；[src/components/Byline/BylineActivationDialog.vue:158](src/components/Byline/BylineActivationDialog.vue#L158)；[src/components/Byline/BylineActivationDialog.vue:187](src/components/Byline/BylineActivationDialog.vue#L187)。[src/components/Byline/BylineActivationDialog.vue:243](src/components/Byline/BylineActivationDialog.vue#L243)；[src/utils/embedDeeplink.ts:28](src/utils/embedDeeplink.ts#L28)；[src/utils/embedDeeplink.ts:85](src/utils/embedDeeplink.ts#L85)。

<a id="f51"></a>
### F51 · 入门教程与资源 — `onboarding-guides`

**能力**：介绍类型、插入/创建/保存步骤，提供文档、视频和支持链接。

**交互面**：`dashboard` ●；`get-started` ●；`home-feed` ●；`create-guide` ●。

**契约与边界**：Dashboard 与 Admin Get Started 是两个入口、同一个 GetStarted 教程组件。其 createFirstDiagram 等方法没有可见模板绑定。Home 的 Flowchart/Graph/Sequence/OpenAPI 样例 accordion 提供截图与操作说明，Quick start 打开文档。

**代码证据**：[src/forgeIndex.ts:115](src/forgeIndex.ts#L115)；[src/forgeIndex.ts:125](src/forgeIndex.ts#L125)；[src/components/GetStarted/GetStarted.vue:15](src/components/GetStarted/GetStarted.vue#L15)；[src/components/GetStarted/GetStarted.vue:98](src/components/GetStarted/GetStarted.vue#L98)；[src/components/GetStarted/GetStarted.vue:161](src/components/GetStarted/GetStarted.vue#L161)；[src/components/HomepageFeed/HomepageFeedCard.vue:192](src/components/HomepageFeed/HomepageFeedCard.vue#L192)。

<a id="f52"></a>
### F52 · 站点与空间用量 — `site-usage`

**能力**：展示站点总量、超限空间和空间级计数。

**交互面**：`plan-usage` ●；`page-banner` ↗。

**契约与边界**：Plan and usage 接收后端统计，显示估算/陈旧提示；Page banner 的 View plan and usage 跳转到此入口。统计数值不是某页面的图表内容清单。

**代码证据**：[src/components/PlanUsage/PlanUsage.vue:32](src/components/PlanUsage/PlanUsage.vue#L32)；[src/components/PlanUsage/PlanUsage.vue:59](src/components/PlanUsage/PlanUsage.vue#L59)；[src/components/PlanUsage/PlanUsage.vue:266](src/components/PlanUsage/PlanUsage.vue#L266)；[src/components/UpgradePrompt/PaywallWarningBanner.vue:184](src/components/UpgradePrompt/PaywallWarningBanner.vue#L184)。

<a id="f53"></a>
### F53 · 宏内容所在页面盘点 — `diagram-locations`

**能力**：从 Plan and usage 展示空间、图表与拥有页面的定位结果。

**交互面**：`plan-usage` ↗；`diagram-locations` ●。

**契约与边界**：由查看者身份读 Confluence；清单明确为部分结果，只计拥有页面而非全部复用位置。增量读取、retry/resume、单轮 500 条预算、空间/类型/文字过滤、10/25/50 分页。

**代码证据**：[src/components/PlanUsage/PlanUsage.vue:39](src/components/PlanUsage/PlanUsage.vue#L39)；[src/components/PlanUsage/PlanUsage.vue:97](src/components/PlanUsage/PlanUsage.vue#L97)；[src/components/PlanUsage/DiagramLocations.vue:13](src/components/PlanUsage/DiagramLocations.vue#L13)；[src/components/PlanUsage/DiagramLocations.vue:19](src/components/PlanUsage/DiagramLocations.vue#L19)；[src/components/PlanUsage/DiagramLocations.vue:202](src/components/PlanUsage/DiagramLocations.vue#L202)；[src/components/PlanUsage/DiagramLocations.vue:256](src/components/PlanUsage/DiagramLocations.vue#L256)。

<a id="f54"></a>
### F54 · 用量提示与付费引导 — `paywall`

**能力**：以当前用量、付款状态、豁免和受众决定非阻断提示。

**交互面**：`page-banner` G；`plan-usage` ●。

**契约与边界**：当前 shouldBlockActions 恒 false，旧 create/edit 阻断不接入常规流程。>=85 的 actionRequired 计算仍保留，但当前 Header/React Header 没有对应消费 UI；page banner 使用严格 >100 的 unpaid Lite 条件。Page banner 面向 recent author/space admin；当前组件没有 Dismiss 控件，也不按旧 impression taper 控制可见性。Fullscreen 独立访问策略见 fullscreen-access-recovery。

**代码证据**：[src/composables/useCustomerSuccessService.ts:46](src/composables/useCustomerSuccessService.ts#L46)；[src/composables/useCustomerSuccessService.ts:60](src/composables/useCustomerSuccessService.ts#L60)；[src/utils/paywall/warningBanner.ts:247](src/utils/paywall/warningBanner.ts#L247)；[src/components/UpgradePrompt/PaywallWarningBanner.vue:13](src/components/UpgradePrompt/PaywallWarningBanner.vue#L13)；[src/components/Header/Header.vue:1](src/components/Header/Header.vue#L1)。

<a id="f55"></a>
### F55 · Full 升级入口 — `marketplace-upgrade`

**能力**：将用户带到 Atlassian Marketplace 的 Full 安装/购买流程。

**交互面**：`plan-usage` ↗；`request-full` ↗；`page-banner` ↗。

**契约与边界**：付款发生在外部 Marketplace。当前直接入口、Request Full 理由引导和仅限 space admin 的 Bundle checkout 是三条不同路径；旧 UpgradePrompt 的按钮存在不表示旧模态框仍会正常打开。

**代码证据**：[src/components/PlanUsage/PlanUsage.vue:76](src/components/PlanUsage/PlanUsage.vue#L76)；[src/components/PlanUsage/PlanUsage.vue:310](src/components/PlanUsage/PlanUsage.vue#L310)；[src/components/PlanUsage/PlanUsage.vue:349](src/components/PlanUsage/PlanUsage.vue#L349)；[src/components/UpgradePrompt/PaywallWarningBanner.vue:184](src/components/UpgradePrompt/PaywallWarningBanner.vue#L184)。

<a id="f56"></a>
### F56 · 向管理员请求 Full — `request-full`

**能力**：组织/复制使用理由并进入 Atlassian 请求/安装流程。

**交互面**：`plan-usage` ↗；`request-full` ●。

**契约与边界**：Plan and usage 内的 reason copy 和 Atlassian handoff；此处 app 不接收 Request Full 文本。它与 Fullscreen recovery 收集邮箱、同意并存储请求的后端流程分开。

**代码证据**：[src/components/PlanUsage/PlanUsage.vue:114](src/components/PlanUsage/PlanUsage.vue#L114)；[src/components/PlanUsage/PlanUsage.vue:123](src/components/PlanUsage/PlanUsage.vue#L123)；[src/components/PlanUsage/PlanUsage.vue:204](src/components/PlanUsage/PlanUsage.vue#L204)；[src/components/PlanUsage/PlanUsage.vue:340](src/components/PlanUsage/PlanUsage.vue#L340)。

<a id="f57"></a>
### F57 · Fullscreen 访问恢复 — `fullscreen-access-recovery`

**能力**：为符合 Lite 试点策略的空间申请、激活和查看临时全屏访问。

**交互面**：`fullscreen-viewer` G；`fullscreen-recovery` ●；`plan-usage` G；`request-full` G。

**契约与边界**：已知 unpaid、有效计数 >=100、空间及后端策略满足条件才进入；请求选择场景、邮箱与同意，首次成功渲染后激活 7 天。请求保存、pending_activation、active、expired 是不同状态。已打开页面到期不强制关闭；不可用/策略关闭有 fail-open/正常路径。既有豁免需 reviewed override。AsyncAPI 的 tryFullscreenViewerPaywall 调用位于非 modal 分支，未覆盖 raw fullscreen 分支，不能计作已接入 RC；源码已确认接线缺口，实际访问恢复表现**待 UI 验证**，见下方边界表。RC 有两个宿主：FullscreenRecoveryHost，以及 PU 的 fullscreen_request 视图（surface=dashboard），后者也能承载申请。RF 的 G 仅表示保留 Fullscreen 场景的文案／理由及 Marketplace 引导；RF 不提交临时访问申请，也不等于 RC 表单。导航 URL 虽带 request 参数，fullscreenSource 解析器只读取来源、场景和页面／空间字段；实际 request 来自后端 snapshot，不能写成按 URL request ID 直接载入申请。跨宿主导航、参数保留和实际申请结果**待 UI 验证**。

**代码证据**：[src/utils/paywall/fullscreenRecoveryEligibility.ts:4](src/utils/paywall/fullscreenRecoveryEligibility.ts#L4)；[src/utils/paywall/fullscreenRecoveryGate.ts:13](src/utils/paywall/fullscreenRecoveryGate.ts#L13)；[src/components/FullscreenRecovery/FullscreenRecoveryGate.vue:1](src/components/FullscreenRecovery/FullscreenRecoveryGate.vue#L1)；[src/components/FullscreenRecoveryHost.vue:61](src/components/FullscreenRecoveryHost.vue#L61)；[src/components/FullscreenRecoveryHost.vue:110](src/components/FullscreenRecoveryHost.vue#L110)；[src/components/PlanUsage/PlanUsage.vue:7](src/components/PlanUsage/PlanUsage.vue#L7)。[src/forge-asyncapi-viewer.ts:92](src/forge-asyncapi-viewer.ts#L92)；[src/forge-asyncapi-viewer.ts:155](src/forge-asyncapi-viewer.ts#L155)；[src/forge-asyncapi-viewer.ts:171](src/forge-asyncapi-viewer.ts#L171)；[src/forgeIndex.ts:1643](src/forgeIndex.ts#L1643)。[src/components/PlanUsage/fullscreenSource.ts:11](src/components/PlanUsage/fullscreenSource.ts#L11)；[src/components/PlanUsage/PlanUsage.vue:233](src/components/PlanUsage/PlanUsage.vue#L233)；[src/components/PlanUsage/PlanUsage.vue:104](src/components/PlanUsage/PlanUsage.vue#L104)；[src/components/PlanUsage/PlanUsage.vue:123](src/components/PlanUsage/PlanUsage.vue#L123)；[src/utils/paywall/fullscreenRecoveryGate.ts:32](src/utils/paywall/fullscreenRecoveryGate.ts#L32)。

<a id="f58"></a>
### F58 · 空间 Bundle 购买 — `space-checkout`

**能力**：为符合条件的空间管理员打开空间级 checkout。

**交互面**：`page-banner` G。

**契约与边界**：Page banner 的空间管理员路径带 tenant/space 归因。它不是站点管理员购买 Marketplace Full，也不代表普通成员有空间购买操作。旧 UpgradePrompt 中的同类按钮另列为保留实现。

**代码证据**：[src/components/UpgradePrompt/PaywallWarningBanner.vue:204](src/components/UpgradePrompt/PaywallWarningBanner.vue#L204)；[src/composables/useCustomerSuccessService.ts:80](src/composables/useCustomerSuccessService.ts#L80)。

<a id="f59"></a>
### F59 · 反馈报告 — `feedback-report`

**能力**：描述问题、可选截图/上传、披露上下文、保存引用和支持接续。

**交互面**：`inline-viewer` ↗；`editor` ↗；`fullscreen-editor` ↗；`fullscreen-viewer` ↗；`openapi-editor` ↗；`graph-editor` ↗；`asyncapi-editor` ↗；`export-workspace` ↗；`dashboard` ↗；`get-started` ↗；`api-dashboard` ↗；`plan-usage` ↗；`feedback-dialog` ●；`api-document-viewer` G；`page-editor-preview` ↗；`embedded-viewer` ↗；`admin-demo` G。

**契约与边界**：真实安装由 feedbackSurfaceForContext 判定；排除 contentBylineItem/pageBanner/Home feed，因此保留父 byline 类型的 modal 也可能被排除。图片只能一张，可预览/重拍/替换/删除；current-view capture 限当前 ZenUML 视图。支持 handoff 与失败重试。 API Dashboard 的 viewer modal 若仍带 spacePage 上下文，也会按 dashboard 分类。宏 moduleKey 判定涵盖 PEP／EV；Diagramly Admin 在保留 globalSettings 的生成包中也安装反馈宿主，并归为 get_started。DA 的 G 保留 CI／本地 wizard 差异。此处确认分类和安装接线，新增宿主中的按钮、截图与提交交互**待 UI 验证**。

**代码证据**：[src/forgeIndex.ts:1204](src/forgeIndex.ts#L1204)；[src/features/feedback/feedbackContext.ts:11](src/features/feedback/feedbackContext.ts#L11)；[src/features/feedback/mountFeedback.ts:1](src/features/feedback/mountFeedback.ts#L1)；[src/features/feedback/FeedbackDialog.vue:34](src/features/feedback/FeedbackDialog.vue#L34)；[src/features/feedback/FeedbackDialog.vue:58](src/features/feedback/FeedbackDialog.vue#L58)；[src/features/feedback/FeedbackDialog.vue:192](src/features/feedback/FeedbackDialog.vue#L192)。

<a id="f60"></a>
### F60 · 满意度调查 — `csat`

**能力**：Page banner 中的五档评分、可选评论、发送、关闭和撤销。

**交互面**：`page-banner` G。

**契约与边界**：需新鲜 pending-save marker 与用户状态符合条件，并遵循独立 suppression。尽管部分事件上报 surface=editor，实际 UI 在 Page banner。

**代码证据**：[src/components/CSAT/CsatBanner.vue:22](src/components/CSAT/CsatBanner.vue#L22)；[src/components/CSAT/CsatBanner.vue:100](src/components/CSAT/CsatBanner.vue#L100)；[src/components/CSAT/CsatBanner.vue:161](src/components/CSAT/CsatBanner.vue#L161)；[src/utils/csat.ts:1](src/utils/csat.ts#L1)。

<a id="f61"></a>
### F61 · 定向调查 — `targeted-survey`

**能力**：在其他 banner 不展示时获取符合条件的服务端调查。

**交互面**：`page-banner` G。

**契约与边界**：Lite/Full 已认证用户；调查须未过期，支持邀请、多选、可选详情、发送/重试/关闭及跨 origin claim/terminal 协调。不把有调查定义等同于每次页面访问都会展示。

**代码证据**：[src/routes/pageBanner.ts:153](src/routes/pageBanner.ts#L153)；[src/features/targetedSurvey/survey.ts:48](src/features/targetedSurvey/survey.ts#L48)；[src/components/TargetedSurvey/TargetedSurveyBanner.vue:3](src/components/TargetedSurvey/TargetedSurveyBanner.vue#L3)；[src/components/TargetedSurvey/TargetedSurveyBanner.vue:159](src/components/TargetedSurvey/TargetedSurveyBanner.vue#L159)。

<a id="f62"></a>
### F62 · 产品更新发现 — `whats-new`

**能力**：在 Page banner 展开更新，并进入每项说明。

**交互面**：`page-banner` G。

**契约与边界**：由 audience、release window、impression 和 dismissal 条件决定，与 paywall banner 的当前可见性规则不同。

**代码证据**：[src/utils/whatsNew/state.ts:138](src/utils/whatsNew/state.ts#L138)；[src/components/WhatsNew/WhatsNewBanner.vue:8](src/components/WhatsNew/WhatsNewBanner.vue#L8)；[src/components/WhatsNew/WhatsNewBanner.vue:129](src/components/WhatsNew/WhatsNewBanner.vue#L129)。

<a id="f63"></a>
### F63 · Diagramly Aide 问答 — `ai-aide`

**能力**：独立 byline 聊天中的 prompt、历史对话、回答和错误。

**交互面**：`aide` ●。

**契约与边界**：通过 /diagramly/chat 发问并显示回答；未发现把答案直接应用到当前图表的绑定，不把它当 editor AI Chat。

**代码证据**：[src/routes/aiAide.ts:8](src/routes/aiAide.ts#L8)；[src/components/react/AiAide.jsx:68](src/components/react/AiAide.jsx#L68)；[src/components/react/AiAide.jsx:146](src/components/react/AiAide.jsx#L146)；[src/components/react/AiAide.jsx:154](src/components/react/AiAide.jsx#L154)。

<a id="f64"></a>
### F64 · 外部 MCP 接入设置 — `connect-mcp`

**能力**：显示接入命令、服务 URL 和上下文 prompt，供外部 Agent 使用。

**交互面**：`inline-viewer` G；`fullscreen-viewer` G；`home-feed` G；`connect-mcp-dialog` ●；`embedded-viewer` G；`page-editor-preview` G。

**契约与边界**：查看器按图表 ID 生成 prompt，Home 按站点生成 recent-diagrams prompt；文字图种和 agent-link-enabled 等条件决定入口。当前 RELAY_SESSIONS_ENABLED=false，所以实际设置流是 headless OAuth，不是 CL-token/live rail。

**代码证据**：[src/components/Viewer/GenericViewer.vue:1030](src/components/Viewer/GenericViewer.vue#L1030)；[src/components/Viewer/GenericViewer.vue:2303](src/components/Viewer/GenericViewer.vue#L2303)；[src/composables/agentLink/connectInstructions.ts:65](src/composables/agentLink/connectInstructions.ts#L65)；[src/composables/agentLink/connectInstructions.ts:81](src/composables/agentLink/connectInstructions.ts#L81)；[src/components/HomepageFeed/HomepageFeedCard.vue:327](src/components/HomepageFeed/HomepageFeedCard.vue#L327)；[src/components/Viewer/ForgeEmbedViewer.vue:12](src/components/Viewer/ForgeEmbedViewer.vue#L12)；[src/components/Viewer/GenericViewer.vue:12](src/components/Viewer/GenericViewer.vue#L12)。

<a id="f65"></a>
### F65 · Agent 用户授权 — `agent-authorization`

**能力**：登录 Atlassian、按客户端允许/拒绝、返回账户与切换账户。

**交互面**：`oauth-consent` ●；`external-agent` G。

**契约与边界**：浏览器绑定同意；read/write scopes 分离，访问范围是同意用户可访问的 site/page。令牌刷新、客户端身份和 grant 检查是写入前置，不是 app-wide 越权访问。

**代码证据**：[functions/agent-link/oauth/consent.ts:43](functions/agent-link/oauth/consent.ts#L43)；[functions/agent-link/oauth/authServer.ts:374](functions/agent-link/oauth/authServer.ts#L374)；[functions/agent-link/oauth/authorize.ts:1](functions/agent-link/oauth/authorize.ts#L1)；[functions/agent-link/oauth/headlessMcp.ts:589](functions/agent-link/oauth/headlessMcp.ts#L589)。

<a id="f66"></a>
### F66 · Agent 发现与读取 — `agent-read`

**能力**：list_sites/list_diagrams/read_diagram/read_page/get_status。

**交互面**：`external-agent` G。

**契约与边界**：按用户授权资源检查站点成员和页面访问；读取的图表类型与 MCP Apps 能呈现的类型不同。缺 grant、受限页面、未知站点和刷新失败是独立失败情况。

**代码证据**：[functions/agent-link/oauth/headlessTools.ts:128](functions/agent-link/oauth/headlessTools.ts#L128)；[functions/agent-link/oauth/headlessTools.ts:218](functions/agent-link/oauth/headlessTools.ts#L218)；[functions/agent-link/oauth/headlessTools.ts:287](functions/agent-link/oauth/headlessTools.ts#L287)。

<a id="f67"></a>
### F67 · Agent 创建、更新和页面写入 — `agent-write`

**能力**：创建/更新图表与标题，创建/替换 Confluence 页面正文。

**交互面**：`external-agent` G。

**契约与边界**：图表创建同时存正文并追加宏；需要匹配真实安装的宏身份。写工具需要 diagram.write，处理版本冲突、重复和数据丢失保护。canonical type 包含 Markdown/AsyncAPI，但执行还受变体能力限制；工具描述文本较窄，不作为执行能力的唯一依据。create_diagram 先 POST custom content，再 PUT 页面，两个步骤不具备原子性。页面更新被拒绝、冲突或失败时尝试 DELETE 回滚；回滚失败会报告 contentId／orphaned，可能留下已保存但未放置的正文。当前代码注释记录删除权限范围不足，不能承诺每次回滚成功。创建／更新没有同步 PNG 或 JSON 附件调用，导出图像和快照可能缺失或滞后，需适用的后续渲染／保存路径维护。依赖 F49 的放置恢复、F39 的附件导出和 F40 的快照后备；这些依赖不代表 AM 直接提供对应 UI。**待 UI 验证**：遗留正文是否进入 byline 未放置清单，以及后续附件补齐和文档导出结果。

**代码证据**：[functions/agent-link/oauth/headlessTools.ts:179](functions/agent-link/oauth/headlessTools.ts#L179)；[functions/agent-link/oauth/headlessTools.ts:226](functions/agent-link/oauth/headlessTools.ts#L226)；[functions/agent-link/oauth/headlessTools.ts:461](functions/agent-link/oauth/headlessTools.ts#L461)；[functions/agent-link/oauth/headlessTools.ts:900](functions/agent-link/oauth/headlessTools.ts#L900)；[functions/agent-link/oauth/headlessTools.ts:1168](functions/agent-link/oauth/headlessTools.ts#L1168)；[functions/agent-link/updateDiagramGuard.ts:1](functions/agent-link/updateDiagramGuard.ts#L1)。[functions/agent-link/oauth/headlessTools.ts:800](functions/agent-link/oauth/headlessTools.ts#L800)；[functions/agent-link/oauth/headlessTools.ts:985](functions/agent-link/oauth/headlessTools.ts#L985)；[functions/agent-link/oauth/headlessTools.ts:1021](functions/agent-link/oauth/headlessTools.ts#L1021)；[src/forgeIndex.ts:1232](src/forgeIndex.ts#L1232)；[src/forgeIndex.ts:638](src/forgeIndex.ts#L638)。

<a id="f68"></a>
### F68 · MCP Apps 工具结果预览 — `mcp-app-preview`

**能力**：在外部 MCP 宿主 iframe 中呈现读/写工具返回的图表。

**交互面**：`external-agent` ↗；`mcp-app-view` ●。

**契约与边界**：支持 ZenUML/Mermaid/PlantUML/Graph/OpenAPI；AsyncAPI/Markdown/Embed 有明确 unsupported 状态。宿主握手、加载、CSP 和渲染失败单独处理；不直接接 Forge 编辑器或正文持久化。OpenAPI 禁止 Try it out 和外部 validator。

**代码证据**：[functions/agent-link/oauth/mcpApps.ts:77](functions/agent-link/oauth/mcpApps.ts#L77)；[src/mcp-app-view.ts:201](src/mcp-app-view.ts#L201)；[src/mcp-app-view.ts:229](src/mcp-app-view.ts#L229)；[src/mcp-app-view.ts:252](src/mcp-app-view.ts#L252)。

<a id="f69"></a>
### F69 · 空间演示页 enrollment — `demo-enrollment`

**能力**：Diagramly 管理员提交空间，触发演示页创建流程并查看状态。

**交互面**：`admin-demo` G。

**契约与边界**：显示 success/already-existing/in-progress/error；当前 CI 生成 Diagramly admin 模块，而 local forge-wizard 删除整个 globalSettings，存在入口生成漂移。本地图标/源码存在不足以判定某次生成包有该入口。

**代码证据**：[src/components/Admin/CreateDemoPage.vue:3](src/components/Admin/CreateDemoPage.vue#L3)；[src/components/Admin/CreateDemoPage.vue:67](src/components/Admin/CreateDemoPage.vue#L67)；[manifest.yml:458](manifest.yml#L458)；[.github/workflows/staging-deploy.yml:432](.github/workflows/staging-deploy.yml#L432)；[.github/workflows/release.yml:212](.github/workflows/release.yml#L212)；[scripts/forge-wizard.mjs:210](scripts/forge-wizard.mjs#L210)。

<a id="f70"></a>
### F70 · 下载诊断信息 — `diagnostic-download`

**能力**：通过查看器 More 菜单取得调试包。

**交互面**：`inline-viewer` ●；`fullscreen-viewer` ●；`embedded-viewer` G；`page-editor-preview` G。

**契约与边界**：与面向用户的版本浏览/恢复分开；History 菜单当前只打印版本到控制台并提示 toast。专用 AsyncAPI raw fullscreen 没有通用 More 菜单的自动继承。AsyncAPI raw fullscreen 不挂载通用 More／诊断下载；内联 Fullscreen 交接不会自动补齐这些能力。**待 UI 验证**：此路径的菜单和诊断入口表现。

**代码证据**：[src/utils/viewerHeaderLayout.ts:163](src/utils/viewerHeaderLayout.ts#L163)；[src/components/Viewer/GenericViewer.vue:2029](src/components/Viewer/GenericViewer.vue#L2029)；[src/components/Viewer/GenericViewer.vue:2454](src/components/Viewer/GenericViewer.vue#L2454)；[src/components/Viewer/ForgeEmbedViewer.vue:12](src/components/Viewer/ForgeEmbedViewer.vue#L12)；[src/components/Viewer/GenericViewer.vue:12](src/components/Viewer/GenericViewer.vue#L12)。[src/forge-asyncapi-viewer.ts:92](src/forge-asyncapi-viewer.ts#L92)；[src/forge-asyncapi-viewer.ts:155](src/forge-asyncapi-viewer.ts#L155)；[src/forge-asyncapi-viewer.ts:171](src/forge-asyncapi-viewer.ts#L171)；[src/forgeIndex.ts:1643](src/forgeIndex.ts#L1643)。

<a id="f71"></a>
### F71 · 宏内容独立查看与全屏导航 — `fullscreen-navigation`

**能力**：从宏或列表打开独立图表查看模态框，并返回原宿主。

**交互面**：`inline-viewer` ↗；`page-editor-preview` G；`embedded-viewer` G；`byline-diagrams` ↗；`api-dashboard` ↗；`fullscreen-viewer` ●；`api-document-viewer` ●。

**契约与边界**：GenericViewer 的 Fullscreen 入口、byline 的 fullscreen 模式、API Dashboard 的 viewer 模式是三条明确路径。API Dashboard 虽使用 fullscreen 尺寸，但 macroMode=viewer 不等于 fullscreen-viewer；AsyncAPI 与 OpenAPI 的内部操作仍由各自模式决定。AsyncAPI 内联 Fullscreen 进入 raw React modal 并渲染规范；它不具备通用 Viewer 的 ExportWorkspace／More，恢复 gate 也未覆盖此分支。**待 UI 验证**：真实交接画面、操作入口及访问限制，分别见 F34／F57／F70。

**代码证据**：[src/components/Viewer/GenericViewer.vue:345](src/components/Viewer/GenericViewer.vue#L345)；[src/forgeIndex.ts:1643](src/forgeIndex.ts#L1643)；[src/components/Byline/BylineDiagrams.vue:923](src/components/Byline/BylineDiagrams.vue#L923)；[src/components/AsyncApiDashboard/AsyncApiDashboard.vue:592](src/components/AsyncApiDashboard/AsyncApiDashboard.vue#L592)；[src/model/ApWrapper2.ts:1508](src/model/ApWrapper2.ts#L1508)。[src/forge-asyncapi-viewer.ts:92](src/forge-asyncapi-viewer.ts#L92)；[src/forge-asyncapi-viewer.ts:155](src/forge-asyncapi-viewer.ts#L155)；[src/forge-asyncapi-viewer.ts:171](src/forge-asyncapi-viewer.ts#L171)；[src/forgeIndex.ts:1643](src/forgeIndex.ts#L1643)。

<a id="f72"></a>
### F72 · 运维分析与报表 — `analytics-exploration`

**能力**：报表、筛选、事件明细、保存视图 CRUD 和 CSV 导出。

**交互面**：`analytics-console` B。

**契约与边界**：analytics.html 被 Vite 构建，但未找到 Forge 模块或产品菜单链接；部署的访问控制未在本次代码检查中验证。它不是 customer Dashboard 或 Plan and usage。

**代码证据**：[analytics.html:10](analytics.html#L10)；[src/analytics-page.ts:5](src/analytics-page.ts#L5)；[vite.config.mjs:64](vite.config.mjs#L64)；[src/components/Analytics/AnalyticsDashboard.vue:20](src/components/Analytics/AnalyticsDashboard.vue#L20)；[src/components/Analytics/AnalyticsDashboard.vue:193](src/components/Analytics/AnalyticsDashboard.vue#L193)；[src/components/Analytics/AnalyticsDashboard.vue:420](src/components/Analytics/AnalyticsDashboard.vue#L420)。

<a id="f73"></a>
### F73 · 运维空间许可证操作 — `space-license-admin`

**能力**：激活、列出、过滤、停用、重新激活空间许可证。

**交互面**：`space-license-admin` B。

**契约与边界**：/admin/ 使用运维凭证，不等于 Confluence space-admin UI；具体权限取后端认证，禁止在本文记录真实客户、凭证或操作记录。

**代码证据**：[public/admin/index.html:70](public/admin/index.html#L70)；[public/admin/index.html:149](public/admin/index.html#L149)；[public/admin/index.html:213](public/admin/index.html#L213)；[public/admin/index.html:256](public/admin/index.html#L256)；[public/admin/index.html:279](public/admin/index.html#L279)；[functions/api/space-license.ts:1](functions/api/space-license.ts#L1)。

<a id="f74"></a>
### F74 · 运维缓存诊断 — `metrics-inspection`

**能力**：按目标和可选空间查看指标缓存与诊断。

**交互面**：`metrics-inspector` B。

**契约与边界**：独立 metrics-inspect 入口；与产品内的站点用量/图表清单功能区分。本文只记录接口与契约，不保存任何实际租户查询结果。

**代码证据**：[public/admin/metrics.html:100](public/admin/metrics.html#L100)；[public/admin/metrics.html:140](public/admin/metrics.html#L140)；[functions/admin/metrics-inspect/index.ts:1](functions/admin/metrics-inspect/index.ts#L1)。

## 跨 Feature 的共同边界

| 边界 | 对矩阵判断的影响 | 代码证据 |
| --- | --- | --- |
| 正文与存储 | Confluence custom content 是宏内容文档的系统记录；Cloudflare/D1、统计和 AI 副本是可选支撑，不作为正常渲染/编辑的必需正文存储。 | [src/model/ContentProvider/CustomContentStorageProvider.ts:34](src/model/ContentProvider/CustomContentStorageProvider.ts#L34)；[src/model/ContentProvider/Persistence.ts:40](src/model/ContentProvider/Persistence.ts#L40) |
| 身份与权限 | UI 的 canUserEdit 当前恒 true，不能当作已执行 ACL；以实际 Confluence/后端授权为准。Guest/anonymous 的普通渲染与需要 user token 的远端能力分开。 | [src/model/ApWrapper2.ts:1573](src/model/ApWrapper2.ts#L1573)；[functions/utils/forgeUserToken.ts:1](functions/utils/forgeUserToken.ts#L1) |
| 配置与正文回写 | Native insert/config 与 viewer/byline 启动的 modal 不具备相同 rebind 能力；复制宏和嵌入重定向必须单独判断。 | [src/forgeIndex.ts:1291](src/forgeIndex.ts#L1291)；[src/forgeIndex.ts:1483](src/forgeIndex.ts#L1483) |
| 异步结果与源版本 | AI 取消、最新语法诊断、Refined source hash、内容缓存、附件采集各自有版本/状态边界，不能因共享 renderer 就统一为一个成功状态。 | [src/services/AIChatSessionService.ts:177](src/services/AIChatSessionService.ts#L177)；[src/components/Editor/Editor.vue:50](src/components/Editor/Editor.vue#L50)；[functions/magic-writeback.ts:70](functions/magic-writeback.ts#L70) |
| 宏与应用可用性 | 模块注册、构建裁剪、编辑入口和实际图种支持共同决定可达性；基于泛化模板或旧文档列出的变体不能覆盖实际判断。 | [manifest.yml:309](manifest.yml#L309)；[scripts/forge-wizard.mjs:40](scripts/forge-wizard.mjs#L40)；[src/forgeIndex.ts:1098](src/forgeIndex.ts#L1098) |
| 后端路由 | 外部 Agent、OAuth、分享、writeback、附件等必须在 Pages allowlist 中；有函数文件不等于入口可路由。 | [public/_routes.json:1](public/_routes.json#L1) |
| 查看器的实际模式门槛 | PEP 仅 isEditing 且无 configuring/inserting 可仍是 display 模式；Workspace hideHeader 预览另算。ADV 的 macroMode=viewer 即使承载 OpenAPI GenericViewer 也不显示通用工具栏。 | [src/model/ApWrapper2.ts:1508](src/model/ApWrapper2.ts#L1508)；[src/model/globals/forgeGlobal.ts:227](src/model/globals/forgeGlobal.ts#L227)；[src/components/Viewer/GenericViewer.vue:12](src/components/Viewer/GenericViewer.vue#L12) |
| 数据与页面一致性 | 正文保存、PNG/JSON 附件、页面放置、索引、计数、后端镜像是不同完成条件；列表可能给出延迟/部分数据。 | [src/model/Attachment.ts:425](src/model/Attachment.ts#L425)；[src/components/PlanUsage/DiagramLocations.vue:202](src/components/PlanUsage/DiagramLocations.vue#L202)；[src/components/AsyncApiDashboard/AsyncApiDashboard.vue:557](src/components/AsyncApiDashboard/AsyncApiDashboard.vue#L557) |
| 后台运行面 | 安装/卸载、page capture、macro count、Full presence、Lite→Full conversion、architecture indexing、邮件/webhook 都是前述能力的后端依赖，不伪装成客户 UI 列。 | [manifest.yml:726](manifest.yml#L726)；[src/full-presence.ts:1](src/full-presence.ts#L1)；[src/lite-full-conversion.ts:1](src/lite-full-conversion.ts#L1)；[functions/architecture-tokens/indexOnSave.ts:1](functions/architecture-tokens/indexOnSave.ts#L1) |

## 保留实现、源文漂移与尚未验证的边界

| 项目 | 本轮源码结论 | 证据 |
| --- | --- | --- |
| 旧 UpgradePrompt / Continue editing 阻断 | 模态框、延长表单、advocacy copy、计次等仍有实现；正常 create/edit 判定 shouldBlockActions 恒 false，不能计作当前常规阻断 UI。 | [src/composables/useCustomerSuccessService.ts:60](src/composables/useCustomerSuccessService.ts#L60)；[src/components/UpgradePrompt/UpgradePrompt.vue:30](src/components/UpgradePrompt/UpgradePrompt.vue#L30) |
| 旧编辑侧 >=85 提示 | actionRequired 仍定义/导出，但当前文字与 React Header 没有对应提示消费，不能从阈值常量推断活跃 UI。 | [src/composables/useCustomerSuccessService.ts:46](src/composables/useCustomerSuccessService.ts#L46)；[src/components/Header/Header.vue:1](src/components/Header/Header.vue#L1) |
| 旧 paywall 关闭与频控描述 | 旧术语表中的“7 天 snooze / impression taper”不能直接作为当前 PaywallWarningBanner 契约；当前模板没有 Dismiss，展示判定也不靠旧 impression 历史。 | [src/components/UpgradePrompt/PaywallWarningBanner.vue:13](src/components/UpgradePrompt/PaywallWarningBanner.vue#L13)；[src/utils/paywall/warningBanner.ts:247](src/utils/paywall/warningBanner.ts#L247) |
| Live relay rail / CL token | RELAY_SESSIONS_ENABLED=false；Connect MCP 当前展示 headless OAuth 设置。live status/rail/reconnect 代码保留，当前矩阵不把它当已接通的会话 UI。 | [src/composables/agentLink/connectInstructions.ts:81](src/composables/agentLink/connectInstructions.ts#L81)；[src/components/Viewer/GenericViewer.vue:1157](src/components/Viewer/GenericViewer.vue#L1157) |
| Second diagram prompt | Vite 构建常量 false；组件与创作者匹配逻辑存在，不能计作默认可达的 onboarding 动作；“恰好一个宏”条件也未实现。 | [vite.config.mjs:115](vite.config.mjs#L115)；[src/components/Viewer/SecondDiagramPrompt.vue:31](src/components/Viewer/SecondDiagramPrompt.vue#L31) |
| Dashboard/Get Started 创建方法 | createFirstDiagram 等方法未绑定到当前可见教程模板；不等于 Dashboard 可以直接创建文档。 | [src/components/GetStarted/GetStarted.vue:161](src/components/GetStarted/GetStarted.vue#L161) |
| Viewer History | 菜单打印版本到 console 并 toast；不属于可浏览/回滚的用户版本 UI。AI Chat 的历史与恢复另有实现。 | [src/components/Viewer/GenericViewer.vue:2454](src/components/Viewer/GenericViewer.vue#L2454) |
| Header Exit | 显式 Exit handler 保留，但当前文字 Header 没有 Exit 按钮；正常宿主关闭仍有草稿刷盘。 | [src/components/Header/Header.vue:1](src/components/Header/Header.vue#L1)；[src/components/Header/Header.vue:465](src/components/Header/Header.vue#L465) |
| AsyncAPI 适用变体 | 当前 manifest、forgeIndex、Vite 和 wizard 已把 page macro/运行时接到 Lite 与 AsyncAPI；专用 AsyncAPI Embed 仍仅 AsyncAPI。旧 CLAUDE/术语表文字曾存在差异；本文记录该源码基线，不宣称生产租户版本。 | [manifest.yml:309](manifest.yml#L309)；[manifest.yml:356](manifest.yml#L356)；[src/forgeIndex.ts:1098](src/forgeIndex.ts#L1098)；[vite.config.mjs:21](vite.config.mjs#L21) |
| Diagramly Admin 生成路径 | CI 保留 Diagramly admin，local wizard 删除 globalSettings，不能只看 base manifest 推断任意包的入口。 | [.github/workflows/staging-deploy.yml:432](.github/workflows/staging-deploy.yml#L432)；[.github/workflows/release.yml:212](.github/workflows/release.yml#L212)；[scripts/forge-wizard.mjs:210](scripts/forge-wizard.mjs#L210) |
| AsyncAPI modal 与通用 Viewer | raw React modal 仍渲染规范；Dashboard View 有条件提供 Edit，fullscreen 无此 Edit。内联 Fullscreen／Export 交到该路径，但它不消费 openExport、不挂载 EX／通用 More；paywall gate 调用落在非 modal 分支，未覆盖该 fullscreen 路径。入口实际表现待 UI 验证（F34／F57／F70／F71）。 | [src/forge-asyncapi-viewer.ts:92](src/forge-asyncapi-viewer.ts#L92) |
| 草稿能力不齐 | 通用 Embed 只确认了 save-on-close，没有同等 load/restore；Studio 单一 document 缓冲不是按身份隔离的恢复系统。 | [src/components/DocumentList/DocumentList.vue:226](src/components/DocumentList/DocumentList.vue#L226)；[src/components/Editor/AsyncApiEditor/AsyncApiStudioEditor.tsx:49](src/components/Editor/AsyncApiEditor/AsyncApiStudioEditor.tsx#L49) |
| Embed 能力继承与 Graph 模式 | 文本 Embed 没有统一传 hideHeader/readOnly，因此保留部分 source/AI-copy/viewport/highlight/export/debug/MCP 接线；Graph Embed 的 graphXml prop 优先级可能绕过 Board published-mode 选择。UI 接线与跨引用写回安全分别验证。 | [src/components/Viewer/ForgeEmbedViewer.vue:12](src/components/Viewer/ForgeEmbedViewer.vue#L12)；[src/components/Viewer/ForgeGraphViewerEmbed.vue:73](src/components/Viewer/ForgeGraphViewerEmbed.vue#L73)；[src/components/Sequence.vue:149](src/components/Sequence.vue#L149) |
| 嵌入的 Edit 语义 | 通用 Embed 不能统一写成“隐藏 Edit”：部分 renderer 未传 hideEdit；AsyncAPI Embed 显式传了 hideEdit。通用路径的两个 edit 监听可各调用 openModal；选择器依赖 view.submit。双打开表现、modal 提交及引用重绑定均待 UI 验证（F31）。 | [src/components/Viewer/GenericViewer.vue:961](src/components/Viewer/GenericViewer.vue#L961)；[src/forge-asyncapi-viewer.ts:186](src/forge-asyncapi-viewer.ts#L186) |
| 预览与运维入口 | Storybook、sandbox、editor/viewer-preview 是开发面；analytics/admin 页面另列运维面。本轮未验证其线上授权和实时开关。 | [vite.config.mjs:53](vite.config.mjs#L53)；[src/editorPreview.ts:1](src/editorPreview.ts#L1)；[src/viewerPreview.ts:1](src/viewerPreview.ts#L1) |

## Opus 意见逐项复核（2026-10-27）

以下结论来自源码核对；本轮只修订文档，未执行真实宿主交互或浏览器端到端测试。“待 UI 验证”不是通过状态。

| 意见 | 核实与文档处理 | 尚未验证 |
| --- | --- | --- |
| 1 · AsyncAPI 全屏／导出交接 | 确认 raw modal 与通用 Viewer 能力不同；补 F34／F57／F70／F71 的导出及 RC 接线缺口，保留规范渲染能力。 | 内联按钮交接画面、导出和访问恢复行为。 |
| 2 · PEP／EV 共享能力漏标 | 补 Retry、归属页脚、Create 引导，以及 PEP 的 PNG／JSON 自动路径。收窄建议：EV 只确认 PNG，未找到 JSON 快照接线，F40 不补 EV。 | PEP 可交互性、条件 UI 呈现及附件实际生成结果。 |
| 3 · Embed Edit | F31 保留 EV 的引用渲染关系并补 Edit → picker；确认两个追加监听及 view.submit 调用。F02 不将引用选择器算作源正文编辑。 | 两次 openModal 的宿主表现、提交错误及重绑定结果。 |
| 4 · 反馈宿主 | 补 F59 的 PEP／EV／条件 DA，保留上下文分类和生成路径差异。 | 新增宿主中的反馈按钮、截图与提交。 |
| 5 · PB／UB | 补 F30／F32 的 PB；F49 说明共用组件及 marker／property、路由优先级差异。 | 两个入口下的放置、复制及粘贴结果。 |
| 6 · BA 完成链接 | 补 F30／F32 的 BA；F50 明确三段 Embed 引用及票据 fallback。未采用“永远只读”的绝对表述，见 F31 的 Edit 边界。 | 实际粘贴和后续编辑。 |
| 7 · RC 宿主及 RF | 补 RC 双宿主定义；F57 的 RF 仅表示场景上下文与升级引导，不代表 RF 提交临时访问请求。 | 跨宿主导航、参数保留和申请结果。 |
| 8 · MCP 写入依赖 | F67 补非原子写入、尽力回滚及附件不随写入同步刷新的边界；关联 F49／F39／F40。 | 孤儿的 byline 可发现性、后续附件补齐及导出结果。 |
| 9 · 跨轴同名 ID | 确认四组同名，但命名空间无冲突；保留 ID，要求标签保留前缀、场景元数据保留 feature／interface 字段。Interface 短码仍全局唯一。 | 无需 UI 验证；当前 CI 尚未实现完整两轴投影，见下节。 |

另已将 `RELAY_SESSIONS_ENABLED` 的两处引用更正到定义行 81。源码链接存在及行号范围有效仅是文档检查，不代表每个链接所述交互均已验证。

## 标签、精确场景与测试投影

1. PR 展示两维业务标签，例如 `feature:editing` 与 `interface:editor`；测试使用对应 `@feature:editing`、`@interface:editor`。`test:triage`、`test:selected`、`test:all-approved` 继续表达流程状态。
2. 决定记录与测试元数据保存带轴名的具体场景对，例如 `{feature: "document-export", interface: "document-export"}`；解析器必须保留两个字段，禁止用无类型 slug 集合代替。同一对是 Feature **AND** Interface；多个明确场景是 **OR**。`(editing, editor)` 与 `(paywall, page-banner)` 是已登记的配对示例；其他配对是否存在必须另看矩阵，不能因为维度标签同时存在而新增产品能力。
3. 一个测试可关联多对场景；与 PR 的场景集合有交集就选入一次。标签列表只展示维度，不能据此生成全部笛卡尔积；父/子界面也不自动扩大。
4. 场景选择叠加已约定的 smoke、直接修改且仍存在的 specs、已知依赖最低覆盖。未知映射、代码不可达、身份/变体/状态边界无法判断时进入 triage；全量决定仍由手动 triage 对当前 commit 作出。
5. `pr-triage` 沉淀可复用的**产品契约与依赖**、更新证据；`pr-labeling` 先读对应 Feature/Interface。产品支持和测试覆盖分栏记录：支持但无测试、已有测试但入口已退役是不同状态。
6. 当前选择器仍使用 [flat category catalog](tests/e2e-tests/config/categories.mjs) 和 [路径影响投影](tests/e2e-tests/config/impact-map.mjs)。现有 [descriptive tags](tests/e2e-tests/config/tags.ts) 还没有按本文完整迁移；本文重写不声称已经改变 CI 执行逻辑。

## 测试证据的定位

以下是可复查的测试入口，不把“存在 spec”当作通过或线上可用证明。本轮是源码审计与文档检查，没有运行浏览器端到端测试。

| 契约族 | 现有测试位置 |
| --- | --- |
| 创建、编辑、配置回写、按格式保存 | `tests/e2e-tests/tests/insert/`、`tests/e2e-tests/tests/fullscreen/`；`tests/e2e-tests/tests/asyncapi/` |
| 渲染、模式、图种与嵌入 | `tests/e2e-tests/tests/render/`；`src/components/Viewer/*.spec.ts`；`src/utils/graph/*.spec.ts` |
| AI / 语法 / 草稿 | `src/components/AIRepair.spec.ts`；`tests/e2e-tests/tests/syntax-validation/`；`src/utils/draftStore.spec.ts`；`src/services/*.spec.ts` |
| 导出与反馈 | `tests/export-modal/`；`src/components/ExportModal/*.spec.ts`；`src/features/feedback/*.spec.ts` |
| Byline / Banner / Plan and usage / Locations | `src/components/Byline/*.spec.ts`；`src/routes/pageBanner.spec.ts`；`src/components/PlanUsage/*.spec.ts`；`tests/e2e-tests/tests/insert/paywall-page-banner.spec.ts` |
| Fullscreen recovery | `src/components/FullscreenRecovery/*.spec.ts`；`src/utils/paywall/fullscreenRecovery*.spec.ts`；`functions/service/fullscreenRecovery*.spec.ts` |
| 外部 Agent / OAuth / MCP Apps | `tests/e2e-tests/tests/agent-link/`；`functions/agent-link/**/*.spec.ts`；`tests/unit/` 的 MCP/view/tool 相关契约 |

## 本轮源码审阅范围

- 逐类盘点第一方 `src/` 的非 spec/story 源文件、`functions/` 产品入口及服务目录；重点追踪所有 9 个 `src/routes` handler、`forgeIndex` 分支、各格式宿主、Vue/React 编辑与查看组件。
- 对照 `manifest.yml`、`scripts/forge-wizard.mjs`、CI staging/release 的生成/裁剪逻辑、`vite.config.mjs` 和 `public/_routes.json`，区分声明、构建、挂载、条件可达与保留实现。
- 审阅外部 OAuth/MCP、MCP Apps、分享与导出、附件/快照、反馈/调查、用量/许可和独立 admin 页面。CI/agent tooling、内部 Handbook、第三方依赖内部与生产开关状态不伪装成客户界面能力。
- 验证本文稳定 ID 唯一、非空关系只引用已登记 Interface，源码链接存在且行号有效。源码矛盾与可达性限制保留在上表，后续以生成产物和实际 UI 证据进一步收敛。

## 维护规则

新增或调整共享概念时先对齐 `GLOSSARY.md` 的定义，再明确用户行为与可达入口，补 Feature/Interface 和精确场景关系；稳定 ID 的分配、短码和关系清单在本文维护，术语表引用同一个 ID 并解释概念区别。修改某个格子时同步更新它的契约、源代码证据、适用条件和测试覆盖；只改变文案/布局也要检查共享宿主的关联能力。移除入口时保留简短退役说明，避免未来从残留组件重新推断“支持”。
