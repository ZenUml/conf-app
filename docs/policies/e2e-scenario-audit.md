# 原 12 组未配对 E2E 的逐项核实

日期：2026-10-27。按测试实际断言及当前调用链核对；本轮未运行浏览器、Forge 或生产验证。产品关系见根目录 [IMPACT-MAP.md](../../IMPACT-MAP.md)，例外的机器登记见 [test-dispositions.mjs](../../tests/e2e-tests/config/test-dispositions.mjs)。以下“有效”指契约仍与当前源码一致，不代表本轮执行通过。

场景标签表示测试针对的产品契约；执行宿主与证明范围另行注明。local preview 的组件检查可以指向它模拟的 inline-viewer 契约，但不能作为 Confluence iframe／宿主 UI 通过的证据，也不计入当前 Lite PR regression/render 测试组的可运行覆盖。

## 能确认产品契约：5 组

| 原测试组 | 已补的精确场景 | 实际断言与限制 | 当前实现证据 |
| --- | --- | --- | --- |
| `insert/m1-first-seen-ping.spec.ts` · first-seen ping completes | `first-seen-telemetry × page-banner`（新增 F75） | 等待目标 app 的 Forge relay 请求，确认远端响应成功；不是“已展示 onboarding／paywall”的证据。账号、marker、backoff 是独立条件。 | [firstSeenPing.ts:137](../../src/utils/firstSeen/firstSeenPing.ts#L137)；[forgeIndex.ts:221](../../src/forgeIndex.ts#L221) |
| `render/fetch-phase-telemetry.spec.ts` · macro_viewed fetch phase | `render-telemetry × inline-viewer`（新增 F76） | Graph／OpenAPI 上报一次事件，断言 app 身份、duration_ms、fetch_ms 和 custom_content_fetch_ms；没有断言可见图像，故不套用 rendering。 | [trackRenderTime.ts:75](../../src/utils/analytics/trackRenderTime.ts#L75)；[viewerBootstrap.ts:156](../../src/utils/viewerBootstrap.ts#L156)；[OpenApiViewer.vue:87](../../src/components/Viewer/OpenApiViewer.vue#L87) |
| `viewer-preview-graph-aws-icons.spec.ts` · Graph viewer — AWS icon stencils | `rendering × inline-viewer` | `@check:component`、`@execution:preview`：本地 sandbox Graph viewer 的 SVG、基准 ellipse 和 fallback 填充检查。没有直接断言 stencil path，也未验证 Forge CSP／真实页面。 | [ForgeGraphViewer.vue:173](../../src/components/Viewer/ForgeGraphViewer.vue#L173)；[测试断言](../../tests/e2e-tests/tests/viewer-preview-graph-aws-icons.spec.ts) |
| `viewer-preview-overflow-menu.spec.ts` · GenericViewer overflow/debug | `diagnostic-download × inline-viewer` | `@check:component`、`@execution:preview`：本地 GenericViewer 的 More 触发器尺寸、菜单和 JSON blob 字段。内容 slot 为 placeholder，不能证明图表渲染或 Forge 下载集成。 | [GenericViewer.vue:2454](../../src/components/Viewer/GenericViewer.vue#L2454)；[测试断言](../../tests/e2e-tests/tests/viewer-preview-overflow-menu.spec.ts) |
| `viewer-preview-renderer-prefetch.spec.ts` · renderer prefetch — browser mechanics | `renderer-prefetch × inline-viewer`（新增 F77） | `@check:component`、`@execution:preview`：直接以 host=macro 调用真实 helper，检查预取资源返回、Mermaid warm、done key 和二次 no-op。未验证生产 CDN、真实自动调度或 banner none 分支。去掉旧 flag-on 测试命名。 | [rendererPrefetch.ts:93](../../src/utils/prefetch/rendererPrefetch.ts#L93)；[trackRenderTime.ts:104](../../src/utils/analytics/trackRenderTime.ts#L104)；[forgeIndex.ts:244](../../src/forgeIndex.ts#L244) |

F77 的地图另登记 `renderer-prefetch × page-banner`：这是已追踪的生产调用关系，不声称本地 macro-host 测试覆盖了 banner-host 路径。

## 当前仍有效，但不伪装为产品场景：5 组

| 测试组 | 分类标签 | 保留原因与边界 |
| --- | --- | --- |
| `fullscreen/page-actions.spec.ts` · Page-level actions | `@check:host-contract` | 断言 Confluence 页面发布 URL／Forge container、Location／Access 发布对话框和顶层 beforeunload。宏插入是准备步骤，不能据此声称验证了 app 源文发布或可见图像。Full 的 Access 字段个案已有 quarantine，原因未明，仍保留其既有 skip。见 [现有断言](../../tests/e2e-tests/tests/fullscreen/page-actions.spec.ts)。 |
| `fullscreen/regression.spec.ts` · Regression baseline | `@check:orchestration` | `RUN_REGRESSION=true` 时 shell 调用单元测试和 insert suite，再断言退出码；这是测试编排，不是一个额外产品能力。旧注释中的“301 tests”只是历史基线，当前断言并不固定数量。见 [测试编排](../../tests/e2e-tests/tests/fullscreen/regression.spec.ts)。 |
| `insert/editor-page-insert-button.spec.ts` · selects the modal Insert action… | `@check:adapter` | `page.setContent` 构造最小 DOM，验证测试侧 locator 适配器不会点到另一个含 Insert 文案的选项。不是在真实 Confluence 页面插入宏。见 [EditorPage.ts:327](../../tests/e2e-tests/pages/EditorPage.ts#L327)。 |
| `insert/m1-first-seen-ping.spec.ts` · identifies only the target app relay | `@check:adapter` | 对 synthetic payload 验证 `isTargetFirstSeenRelay`，只证明测试捕获器的识别条件。相邻真实 relay 测试才关联 F75。见 [forgeRelay.ts:7](../../tests/e2e-tests/helpers/forgeRelay.ts#L7)。 |
| `viewer-preview-continue-editing.spec.ts` · Editor mounts without a blocking paywall | `@check:negative-regression`、`@execution:preview` | 超限／未超限 mock 下，真实 gate 后的 stub editor 可见，Continue／expired 控件不存在。旧阻断功能已退役；这个“保持不阻断”的负向检查仍有效。改掉 misleading 的 retired-block 组名，保留断言。见 [shouldBlockActions=false](../../src/composables/useCustomerSuccessService.ts#L60)、[editorPreview.ts:43](../../src/editorPreview.ts#L43)。 |

## 已退役交互的保留测试：2 组

| 测试组 | 标记 | 源码证据与处理 |
| --- | --- | --- |
| `agent-link/agent-link-e2e.spec.ts` · Live Agent Link — end to end | `@status:retired` | 要求旧 relay 会话／live rail；[RELAY_SESSIONS_ENABLED=false](../../src/composables/agentLink/connectInstructions.ts#L81)，当前只提供 headless 接入。测试已有 `AGENT_LINK_RELAY` opt-in skip；仅设该环境变量并不能恢复关闭的产品入口。与同文件的当前 Connect MCP 组分别标记，不套用 headless 的场景。 |
| `agent-link/agent-link-multi-page-crosstalk.spec.ts` · Live Agent Link — multi-page cross-talk isolation | `@status:retired` | 同样依赖关闭的 relay UI，保留跨页隔离断言与既有 opt-in skip；没有冒充当前 headless Agent read/write 的覆盖。证据同上。 |

本轮不删除测试，也不改变既有运行／skip 规则。retired 标记不能授权场景覆盖；恢复该能力时必须重核入口、断言和场景登记。

## 后续约束

每个无产品场景的顶层测试组都必须有与 file／title 精确匹配的例外登记、分类标签、理由及源码证据。孤立维度标签或新建无说明例外不能替代精确配对。local preview 组件检查显式标执行宿主，退役测试必须保持无当前产品场景。标签完整性检查负责这些约束；真实 UI、网络和生产行为仍需相应执行证据。

## 默认收集范围的实测修正

2026-10-27 对全部已登记 PR 场景逐一运行真实 Playwright `--list` 与计划生成，发现 `insert/byline-activation.spec.ts` 默认受 `testIgnore` 排除。其场景标签仍有效，但需 `BYLINE_ACTIVATION_LIVE`、准备好的页面和 `BYLINE_PAGE_ID`，不能算作默认 PR 可收集覆盖。已标 `@execution:opt-in`；Playwright 收集和授权登记共用 `test-discovery-policy.mjs`，此场景默认进入 triage。当前默认 PR 可收集场景为 35 个；其余条件与运行时 skip 仍需真实执行验证。
