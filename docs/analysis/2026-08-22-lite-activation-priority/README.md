# Lite 激活触点优先级 — 分群 × 触点 × 动作(2026-08-22)

北极星:每个实验带来的 Lite 新增首次创作者数(`macro_create_succeeded` / `macro_save_succeeded` 的首次成功)。
分数 = 预期新增首次创作者(90 天)/ 工程周。风险与学习价值单列。

数据窗口:2026-07-23 → 2026-08-22(30 天),`product_type = lite`,排除内部站点,排除 `unknown_user_account_id` 与 `$device:` 匿名 id。
查询文件在本目录(JQL 用 `.claude/skills/mixpanel/scripts/mp_query.py --file <q>.js` 重跑;D1 SQL 在 `d1-seed-spaces.md`)。

## 实测锚点(每条带来源)

| # | 量 | 值 | 来源 |
|---|---|---|---|
| A1 | Lite 活跃宏查看者(viewer surface)/30d | 10,125 人;256,528 次 `macro_viewed` | `qe_viewers.js` |
| A1' | 其中自 2026-04-18 起无任何创建/保存成功 | 8,050 人(79%);已创建者 2,075 | `qa.js` |
| A2 | Lite 租户上有登录态页面活动的账号/30d(`app_first_seen`:page banner 每页加载,每浏览器每域 30 天一次,null accountId 不计;事件自 2026-08 才存在,本窗口为首月读数,150,071 事件 / 79,221 账号 ≈ 每账号 1.9 个浏览器) | 79,221 账号 / 741 站点 | `qf.js`, `qf_clouds.js`;`src/utils/firstSeen/firstSeenPing.ts` |
| A3 | 编辑器创建成功率:30d 内 `macro_create_started` 的用户中有 `macro_create_succeeded` 的比例 | 752 / 1,064 = 70.7% | `qg.js` |
| A4 | 自然新增首次创作者/30d | Mixpanel 439(首次成功落在窗口内);D1 923(Lite 新 authorId,含内部站点)。差异原因未查明 | `qg.js`;`d1-seed-spaces.md` Q4 |
| A5 | 宏工具栏按钮点击率锚点:`fullscreen_opened`(entry_point=page_view)用户 / 查看者 | 1,240 / 10,125 = 12.2% | `qe.js` |
| A5' | `entry_point = macro_toolbar` 事件数/30d | 0 — 工具栏目前无创建类动作被追踪 | `qe.js` |
| A5'' | Lite 查看者按宏类型(viewer surface,30d,用户数) | mermaid 7,548 / graph 1,914 / openapi 1,302 / plantuml 716 / sequence 669 | `qh.js` |
| A6 | Byline 条目打开率锚点:`zenuml-byline-aiaide`("Aide",打开 AI Aide 聊天),Diagramly 外部租户,28 天(07-04 → 08-01) | 5 次打开 / 768 次宏查看(0.65%);1 个打开用户 / 31 个月活查看用户(3.2%);全期 3.5 个月 32 次打开。Full 的 39,197 次查看不能作分母:生产 Full 从未发布过 byline 条目(release.yml 曾对非 diagramly 变体全部剥离)。manifest 注释把两者写在一起,先前 README 误算为 0.013% | `docs/superpowers/specs/2026-07-25-lite-byline-activation-design.md` Phase 0 结果 + 更正 |
| A6' | Lite `zenuml-byline-diagrams` 外部事件/30d | 0 — 生产为暗发布,cloudId 允许名单只含自有站点 | `qb3.js`;`src/byline-visibility.ts` |
| A6'' | 内部站点 byline 漏斗(2026-08) | opened 550 → create_clicked 383 → diagram_created 174 | `qb3.js`(内部用户,不能当客户行为) |
| A7 | space admin 探针(10% 抽样下限)/30d | 6,351 人 / 4,702 空间 / 540 站点 | `qd_*.js` |
| A8 | D1 Lite 空间:≥100 宏 / 50–99 宏 / ≥1 宏 | 55 / 98 / 2,282;≥100 空间作者数 median 9(sum 894);50–99 median 5(sum 530) | `d1-seed-spaces.md` Q1–Q2 |
| A9 | 未创建查看者中有页面编辑权的比例 | 未知 — `has_edit_permission` 只在 `viewer_source_*` 上且只出现 true;下表取 50%(估算) | `qe.js` |
| A10 | Page banner 现有触达/30d | editor gate 312 人 / 55 站点(仅 CSS 超限空间);admin gate 0(flag `paywall-admin-banner-enabled` 关) | `qd_users.js`, `qd_domains.js` |
| A11 | homepage feed 外部 Lite 数据(上线 2026-08-21) | 1 天:5 人查看,0 点击 | `qc.js`, `qb3.js` |
| A12 | 模板可行性 | Forge 无 template/blueprint 模块;REST `POST /wiki/rest/api/template` 的 classic scope `write:confluence-content` 已在 `manifest.yml` 第 7 项声明 → 应用可直接创建空间/全局模板,不加 scope,非 major;blueprint 类模板 REST 不能建;调用者需该空间 Admin 权限(全局模板需 Confluence Administrator);模板正文能否带 Forge 宏未验证;Forge 无 optional scope,加任何 scope 均为 major | `forge-template-feasibility.md`(含更正) |
| A13 | Get Started 页面受众 | `confluence:globalSettings` 仅 site admin 可见 | `catalog.ts` origin/main:707 |
| A14 | Agent Link / MCP | flag `agent-link-enabled` 默认 false;生产客户使用 0 | `src/apis/aiTitleFeatureFlag.ts:6`;memory |

## 估算表(90 天,估算值标"估")

| # | 分群 × 触点 × 动作 | 合格可触达/30d | 曝光→动作率 | 首次创建率 | 杠杆 | 90d 新增首次创作者 | 工程周 | 分数/周 | 置信 |
|---|---|---|---|---|---|---|---|---|---|
| T1 | 未创建 × 有编辑权 × Byline × 创建第一张图(放量到全部 Lite) | 10,125 查看者 × 3.2%(A6,1 个用户的样本)≈ 324 打开用户;按每查看 0.65% 则 ≈1,670 次打开 | 创建点击 30–70%(内部漏斗 71%,客户无数据) | 70.7%(A3) | 1 | ≈200–480 | 0.2(改允许名单+监测) | ≈1,000–2,400 | 很低:锚点来自 Diagramly 1 个用户;byline 从未在有意义的用户基数上测过,T1 放量本身就是测量 |
| T8 | 未创建 × 有编辑权 × 宏工具栏 × 创建/编辑 | 8,050 × 50%(A9 估)= 4,025 | 2%(估;A5 全屏按钮 12%) | 70.7% | 1 | ≈170 | 1.5 | ≈113 | 中:两项实测锚点,两项估算 |
| T4 | 未创建 × 有编辑权 × Page banner 新激活变体 × 创建第一张图 | 79,221 × 79% × 50% ≈ 31,000 | 0.3%(估,无锚点) | 70.7% | 1 | ≈200 | 2(新 gate、频控、文案、事件、CSAT 护栏) | ≈100 | 低:三项无锚点因子叠加(79% 未创建比例取自宏查看者、A9 50%、0.3% 点击率);风险:banner 疲劳触及 79K 人 |
| T5 | admin × 50–84 宏空间 × Page banner × 一键建空间模板(路径 b,应用调 REST;scope 已具备) | 74 空间(A8 区间切分);admin 运行时精确定向(复用 Phase 5b 探针,新增 50–84 宏数 gate) | 15% 空间建模板(估)≈ 11 空间 | 模板使用者 | 每空间 90d +1–2 创作者(估:现有作者 median 5 的 20–40%) | ≈15–20 | 2(admin gate + REST 建模板 + 模板正文带宏验证) | ≈8–10 | 低;学习价值高:验证一对多杠杆倍数 |
| T6 | admin × ≥100 宏空间 × Get Started / spaceSettings × 建模板 | 同 T5,受众缩到 site admin(A13);spaceSettings 模块未声明 | — | — | 同 T5 | ≈10 | 1 | ≈10 | 低;并入 T5 作次级载体 |
| T3 | 未创建 × 有编辑权 × Get Started × 创建第一张图 | site admin(A13),无事件可测 | — | 70.7% | 1 | ≤20(估) | 1 | ≤20 | 很低 |
| T2 | 未创建 × 有编辑权 × homepage feed × 创建第一张图 | ≈150 人/30d(A11 外推;卡片默认折叠) | 2%(估) | 70.7% | 1 | ≈6 | 0(已上线) | 不适用 — 只测量 | 低;30 天后读数 |
| T7a | 未创建 × 打开全屏 × Agent Link(已建,flag 关)× agent 编辑已有图 | 全屏用户 1,240/30d × 79% ≈ 980 | 本机装有 MCP agent 并完成配对的比例:未知 | 编辑路径 `forgeBridge.ts:100` 直接调 `ApWrapper2.saveCustomContentV2`,绕过 `Persistence.ts:118`,不发 `macro_save_succeeded`,只发 `agent_link_edit_applied` | 1 | 无锚点;按当前事件口径恒为 0 | 0.1(开 flag)+ 0.1(agent 编辑计入 save) | 不可算 | 无数据;能力限于编辑已绑定的图,不能创建(spec 2026-07-08 决策 4;MCP 工具只有 read_page / read_diagram / update_diagram / get_status) |
| T7b | 使用 AI agent 的 Lite 用户 × 可创建宏的 MCP(未建)× agent 在页面上新建图 | 未知:Lite 用户中使用 AI coding agent 的比例无数据 | — | 需解决 create 不渲染 / 需 ADF 宏插入的问题(spec §3 记录) | 1 | 未知 | 3–4(估) | 不可算 | 无数据;学习价值:验证 agent 渠道能否产生首次创作者 |

自然基线:A4 → 1,300–2,800 新增首次创作者/90d。首批(T1 + T8-A + T5)估算合计 ≈385–670/90d,其中 T1 的 200–480 置信很低;T4 为第二批条件项,不计入。

## 动作轴修正(2026-08-22 第二轮)

Agent Link 是"动作",不是"触点":同一触点可以挂两种动作。动作取值:
- 动作 A:打开编辑器,自己创建第一张图(DSL / 模板库 / 编辑器内 AI 生成)
- 动作 B:连接本机 AI agent,由 agent 编辑页面上已有的图(Agent Link;写入范围 = 已绑定的图,不能创建)
- 动作 C:建空间模板(admin)

动作 B 对未创建者的意义:首次 `macro_save_succeeded`(非作者编辑别人的图)同样计入北极星。前提:agent 写入当前绕过 `Persistence.ts:118`,不发该事件,需先把 `agent_link_edit_applied` 计入口径或改走 `Persistence.ts`(约 0.1 周)。

动作 B 的现状(读代码,`src/components/Viewer/GenericViewer.vue:557-617`):

| 触点 × 动作 B | 代码状态 | 合格可触达/30d | 已知漏斗 | 工程周 |
|---|---|---|---|---|
| 宏工具栏 × 连接 agent | 已建:`ConnectButton` 在小宏工具栏 Fullscreen 按钮旁,flag `agent-link-enabled` 关;仅 sequence / mermaid / plantuml | 8,050 未创建 × 文本 DSL 类型占比(mermaid 7,548 + plantuml 716 + sequence 669 用户,占 10,125 查看者的 ≤88%)≈ 6,400–7,100 | `connect_clicked → session_created → agent_connected → edit_applied`,外部 0 条 | 0.1 开 flag + 0.1 口径 |
| 全屏 × 连接 agent | 已建:Connect rail,同一 flag | 全屏用户 1,240 × 79% ≈ 980 | 同上 | 同上(同一 flag) |
| Byline × 连接 agent | 未建;Byline 本身暗发布 | 取决于 T1 放量后的打开率 | 无 | 1(估)+ T1 放量 |
| 编辑器 × 连接 agent | 未建 | 面向已有作者,属第二目标(复用) | 无 | 不排 |

**生产前提(2026-08-22 查):Agent Link 的后端在生产未就绪。** `wrangler-prod.toml:56-68` 的 `AGENT_LINK` Durable Object 绑定被注释("DISABLED until the companion Worker is actually deployed"),`channel.ts` 在生产返回 501;`.github/workflows/agent-link-worker-deploy.yml` 只有 staging job(`conf-agent-link-stg`),`conf-agent-link-prod` 未部署;`docs/superpowers/plans/2026-08-15-agent-link-connection-experience.md:464` 明确"prod flag stays Default:False until then"。开生产 flag 前需要:companion Worker 生产部署(含 secrets)→ 取消绑定注释 → Pages 重新发布 → 生产 spot check。估 0.5–1 周,且涉及 Cloudflare 资源变更(需单独确认)。

三条触点共用一个未知数:配对率 p = P(点击 Connect 的未创建者完成本机 MCP 配置并让 agent 应用一次编辑)。p 无任何外部数据;一次 flag 实验同时给出工具栏与全屏两条的 p。90 天产出 = 6,400 × 点击率 × p × 1,两项因子都无锚点,不可算分。

## autoConvert(T1 放量的依赖)历史成功率(2026-08-22 查)

T1 的创建路径 = byline 里选类型 → 用户把 `https://confluence.zenuml.com/new/<type>`(或已有图的 `/d/<type>/<cloudId>/<contentId>`)粘贴进页面编辑器 → Confluence `autoConvert` 匹配器把链接转成我们的宏(`manifest.yml` macro `autoConvert.matchers`;`src/utils/newDiagramLink.ts`)。

| 证据类别 | 范围 | 结果 | 来源 |
|---|---|---|---|
| 生产遥测,embed 路径(`/d/<cloudId>/<contentId>` → embed 宏) | 外部 Lite 租户,2026-07 → 08-22 | detected 213 → target_resolved 211(99.1%),failed 0,cross_tenant_rejected 0;14 个用户。渲染时计数(链接持久在 ADF,每次查看重发),非粘贴次数 | `qi.js`, `qk.js` |
| 生产遥测,typed 路径(`/new/<type>`、`/d/<type>/*/*`,即 byline 创建路径) | 外部租户 | 0 条:byline 暗发布;且无专用事件——粘贴生成的宏只发 `macro_create_started{entry_point: page_editor}`(`forgeIndex.ts:991`),与手动插入不可区分。真实用户的粘贴→创建成功率目前不可测 | `qb3.js`;`forgeIndex.ts` |
| 内部站点漏斗 | 3 个内部账号(含 E2E 机器人),07-25 → 08-22 | `byline_create_clicked` 387 → 30 分钟内创建/保存成功 366(95%);`byline_unplaced_scanned`:未放置 192 / 列出 658(29%),E2E 创建不粘贴会抬高此比例 | `qj.js` |
| CI E2E(lite-stg),main 最近 8 次(08-19 → 08-22) | `typed-deeplink-autoconvert.spec.ts` 4 用例(sequence / mermaid / graph / openapi)、`embed-deeplink-autoconvert.spec.ts`、`typed-deeplink-render.spec.ts` | 48 次执行:47 expected,1 flaky(08-22 run 32542433662,sequence 用例首次失败重试通过,110 s),0 unexpected。plantuml 匹配器存在但无 E2E 用例 | GitHub artifacts `playwright-report-lite-stg-shard-*` |
| 本地实跑(lite-stg,2026-08-22) | `--grep deeplink`,含 `byline-create.spec.ts` | 8 passed,2.3 min | `local-run-deeplink-lite-stg-2026-08-22.log` |
| 已知缺陷史 | — | 08-01:`/new/mermaid` 粘贴成 sequence(`!doc` 守卫漏掉 sequence 家族),#477 修复;issue #430(07-31):"输入 + 空格 linkify"对照腿随 Confluence 编辑器 cohort 变化,已移出 CI 进 `pvt-autoconvert`,粘贴腿未受影响;08-16 Diagramly shard 超时为测试侧(Diagramly 不含 typed 匹配器);跨应用匹配器重叠为已接受的已知问题(commit 99d2d425),缓解 = 只有 Lite 发布 typed 匹配器 | `forgeIndex.ts` 注释;`gh issue 430`;git log |

结论:机制在 staging 与 embed 生产路径上通过;typed 路径缺两样东西——真实客户编辑器 cohort 上的观测(0 条)与可区分粘贴来源的遥测。放量前先补遥测(`entry_point: autoconvert` 或带 `autoConvertLink` 属性,以及 create 失败信号),否则放量后仍无法回答"成功率"。

## 决策记录(grill-me,2026-08-22)

| # | 决策 | 结果 |
|---|---|---|
| 1 | 排序对象 | 用户分群 × 触点 × 动作 三元组;动作 ∈ A 自己创建 / B 连接 agent 编辑已有图 / C admin 建模板 |
| 2 | 分群三轴 | 安装状态(只排已安装)/ 当前空间权限(admin > 编辑 > 只读)/ 既往创建(accountId 自 2026-04-18 无 create/save 成功 = 未创建) |
| 3 | 分数 | 预期新增首次创作者(90d)/ 工程周;风险与学习价值单列;每个因子标 实测 / 估算 |
| 4 | 候选 | T1–T8(T7 拆 T7a/T7b),Listing 排除(决策:已安装用户激活) |
| 5 | 首批 | T1 Byline 放量(先补 `entry_point: autoconvert` 遥测 → 10% 两周 → 全量)+ T8-A 工具栏"新建图"(复用 byline 创建路径,与 T1 同一放量开关 `zenuml-byline-lite`,不新增 Forge flag)+ T5 admin 一键建模板(路径 b,REST `POST /template`,scope 已具备;先 0.5 天 spike 验证模板正文带宏) |
| 6 | T5 种子 | **50–84 宏的 74 个空间**(取代 handoff 的 ≥100):Lite 付费墙自 2026-08-09 默认开启(warn 85 / block 100),≥100 空间的模板首次创作者先撞付费墙,与首次创作者目标相反;读数后再扩 |
| 7 | 第二批 | Agent Link(生产后端未就绪:`conf-agent-link-prod` 未部署、`AGENT_LINK` DO 绑定注释;约 1 周含 Cloudflare 变更)在 T8-A 读数后启动;T4 Page banner 激活变体在 T8-A 读数后决定;T2 homepage feed 2026-09-21 读数;T3 / T6 / T7b 不排期 |
| 8 | Agent Link 口径 | 开生产 flag 前,agent 写入改走 `Persistence.ts`(与人工编辑同一 `macro_save_succeeded`) |
| 9 | 读数与停止条件 | 见下表 |
| 10 | 新增事件(实施计划第一个提交,项目规则:事件先于功能) | 工具栏创建点击(新事件,`entry_point: macro_toolbar`);create 系列事件带 `entry_point: autoconvert`(区分粘贴生成);T5 的 `template_offer_shown` / `template_offer_clicked` / `template_created` / `template_create_failed`。下表的读数依赖这些事件 |
| 11 | T1 10% 的选取 | cloudId 确定性哈希取 10%,写入 `ALLOWLIST` 的替代判定;两周后改为全部 Lite 安装 |
| 12 | 阈值换算 | T5 的 ≥5 / <3 个空间原按 55 个种子定,种子改为 74 后按比例换算为 ≥7 / <4 |

### Go / no-go

| 项 | 读数时点 | 指标 | 继续 | 停止 |
|---|---|---|---|---|
| T1 10% 阶段 | 放量后 14 天 | 粘贴生成宏的 `macro_create_failed` / started(`entry_point: autoconvert`);打开用户数 | 失败率 ≤ 10% 且无渲染空白报告 → 全量 | > 10% 或跨应用误匹配 → 回滚 sweep |
| T1 + T8-A 全量 | 全量后 30 天 | 首次 `macro_create_succeeded` 落在 `byline_create_clicked` / 工具栏点击后 30 分钟内,按触点拆分 | 合计 ≥ 100 / 30d → 保留并迭代;决定 T4 | < 30 / 30d → 两触点停止,T4 取消 |
| T5 | 建模板 30 天;杠杆 90 天 | 74 个空间中建模板的空间数;模板空间 90 天新增作者(D1 新 authorId)vs 该空间前 90 天;50–84 以外空间作非随机参照,不设随机对照 | ≥ 7 个空间建模板(≈10%)且新增作者 ≥ 前期 2 倍 → 扩到 85–99 / ≥100(后者需先处理付费墙交互) | < 4 个空间建模板 → 停;建了但无差异 → "模板不是杠杆" |
| T2 | 2026-09-21 | `homepage_feed_viewed` 用户数、`action_clicked` 率、30 分钟内首次创建 | 只读数 | — |

### 付费墙区间(D1,Lite,2026-08-22)

50–84:74 个空间;85–99:24;100–149:23;≥150:32。`PAYWALL_EXEMPTIONS` 17 个租户;`license:*` 31 条(含临时延期与测试)。Forge 行无租户域名,≥100 空间中豁免/已许可的数量未知。

## 限制

1. "未创建"只追溯到 2026-04-18。D1 全部 app 的 pre-2026-04-18 作者 3,998 人,是 8,050 的误判上界;精确剔除需用 accountId 把 D1 `authorId` 与 Mixpanel `distinct_id` 做差集(两者同为 Atlassian accountId),未做。
2. A9 编辑权比例无数据,直接影响 T8/T4 的一半。
3. T4 的 banner 点击率无锚点;T1 的打开率锚点来自另一个 byline 标签。
4. 公开目录里的 JQL 已去掉私有排除名单条目;重跑前按 `private/operations/internal-analytics-domain-exclusions.md` 补回。
5. D1 `CustomContentVersion` 无逐次保存时间与编辑者(子代理抽样 2,000 个多版本 contentId 验证),A4 的 D1 口径只含新作者。

## 下一步(待确认)

见「决策记录」。
