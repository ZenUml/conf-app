# 用户 Engagement 系统性提升策略（2026-10-06）

问题（原话）：「目前大部分客户只有 10% 的用户使用我们的 App，而创作者大约 1%。可以考虑的方向包括但不限于：增加功能、增加接触点、提供技术支持、提供模板。」

本文分三层：**事实层**（§1–§3，全部实测，查询文件在 `queries/`，五份原始证据在 `evidence/`）、**判定层**（§4–§6，模型、五个方向逐一给结论、分群覆盖）、**行动层**（§7–§9，排序与停止清单、90 天计划、待决事项）。所有数字只来自 Mixpanel 项目 3373228 外部租户（排除内部/测试站点）、代码与仓库文档；估算值一律标「估」。公开目录，不含任何租户名。

数据窗口：当前 30 天 = 2026-09-06 → 10-05（UTC）；上一 30 天 = 2026-08-07 → 09-05。

---

## 0. 一页结论

```
            租户内 engagement = 触达(reach) × 激活(activation) × 留存(retention)
                                   │              │                 │
  现状(Lite, 实测)      中位租户 4.5% 的人    76% 查看者从未创作;   上月作者本月仍是
                        看到过宏;中位图    byline 每月带来 51 个  作者的只有 36.6%;
                        只有 2 个读者       首次创作者            首次创作者 30 天内
                                                                   再创作/保存 ~52%
```

1. **「10% / 1%」是合计数，不是「大部分客户」的样子。** 合计口径成立（Lite 9.0% 查看 / 0.82% 作者；Full 11.5% / 1.26%），但按租户看，≥10 个活跃账号的 489 个 Lite 租户中，**中位租户只有 4.5% 的人看过宏、作者数为 0**；66%（322/489）的租户在普查窗口内一个作者都没有。合计 10% 是少数大租户撑起来的（最大 Lite 租户占 9.8% 账号，最大 Full 租户占 32.2%）。
2. **已发布的激活赌注都没有按自己定的门槛读过数；读完的结果是：一个在灰色地带，其余接近零。** Byline「Diagrams」每月带来 51 个首次创作者（门槛 ≥100 继续 / <30 停，落在未定义区间）；首页 feed 卡片每月约 1 个；编辑器模板库只占 0.7% 的创建且不提高成功率；Get Started 约 0；Create 引导视频 0 条外部事件（flag 状态未知）；What's new 刚上线。`private/growth/` 里 0 份 growth contract。
3. **最大的结构性杠杆不在「让更多读者变作者」，而在每租户的触达、作者留存与作者广度。** 作者 ÷ 查看者在有 ≥10 查看者的租户里稳定在 ~11%，所以合计 1% ≈ 触达 × 11%；缺口首先是触达。 本月 1,121 个 Lite 作者里 760 个是新面孔，而上月作者只有 36.6% 回来；首次创作者 30 天内再创作/保存的只有 ~52%。读者侧：50% 的图在 30 天内只有 1 个读者（很可能是作者自己），中位图 2 个读者。
4. **四个方向的判定（详见 §5）**：功能＝只做堵住实测漏点的功能；接触点＝收缩而不是增加，先把 byline 读数做完、把一个真正「写作时刻」的接触点做出来；技术支持＝产品内自助与错误恢复，不做外联（Partner Agreement 8.4(c) 实测原文见 §3.4）；模板＝编辑器模板库降级，空间级页面模板（PR #539，spike 已 GO）在门槛下合并。
5. **先修测量，否则任何门槛都读不出来**：页面活跃分母（`app_first_seen`）在 Mixpanel 里自 08-26 起被采样到 0（commit e572eb7b：五个事件占了 Mixpanel 一半流量），但 **D1 `AnalyticsEventFact` 每周照常收到它**（Lite 1.6–4.6 万账号/周），分母要从 D1 读；`macro_authoring_ended` 10-05 才上线且文本编辑器路径缺 `macro_type`；start 事件无 `journey_id`；byline → 创建只能靠时间 join。

（排序表与停止清单见 §7，90 天计划见 §8，待决事项见 §9。）

---

## 1. 前提复测：按租户看，而不是按合计看

### 1.1 分母问题（先说明）

`app_first_seen`（page banner 每浏览器每域 30 天一次的「页面活跃」ping）在 **Mixpanel** 里自 2026-08-26 起几乎无外部事件（Full 约 09-09 起），原因是 commit e572eb7b（2026-08-26，「sample the five events carrying half the Mixpanel volume」）把它的客户端采样率设为 0（`queries/premise_a0_firstseen_split.js`）。后端的 kill switch `FIRST_SEEN_DISABLED`（`functions/forge-user-behavior.ts:45`）**没有生效**：D1 `AnalyticsEventFact` 每周照常收到它（2026-10-07 直接查 D1，粗排除内部域）：

| ISO 周 | Lite 事件 / 账号 / 域 | Full 事件 / 账号 / 域 |
|---|---|---|
| 2026-W34 | 45,286 / 18,508 / 644 | 12,112 / 7,374 / 88 |
| 2026-W36 | 77,561 / 45,724 / 666 | 4,601 / 2,238 / 80 |
| 2026-W38 | 49,001 / 24,492 / 662 | 9,452 / 6,617 / 82 |
| 2026-W39 | 52,749 / 21,980 / 646 | 8,291 / 4,452 / 82 |

当前 30 天（2026-09-06→10-05）D1 分母：**Lite 97,523 账号 / 759 域；Full 12,762 / 96**；Diagramly 1,017 / 33；AsyncAPI 884 / 17。

§1.2 仍用 Mixpanel 的「匹配普查窗口」（分子分母取同一段 Mixpanel 还有 ping 的日子：Lite 18 天 08-09→08-26，Full 20 天 08-21→09-09），以便与 08-22 的锚点同口径比较；§1.4 补 D1 口径的当前值。

### 1.2 合计口径（`queries/premise_a1_tenant_user_flags.js`）

| 变体 | 有页面活跃的租户 | 页面活跃账号 | 宏查看者 | 创建者 | 编辑者 | 作者(并集) | 查看者/账号 | 作者/账号 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Lite | 754 | 84,531 | 7,613 | 579 | 526 | 695 | **9.0%** | **0.82%** |
| Full | 95 | 11,706 | 1,350 | 128 | 115 | 147 | **11.5%** | **1.26%** |
| Diagramly | 28 | 904 | 26 | 1 | 0 | 1 | 2.9% | 0.1% |
| AsyncAPI | 12 | 313 | 1 | 1 | 1 | 1 | ~0 | ~0 |

合计口径与「10% / 1%」一致。Diagramly 与 AsyncAPI 外部量低到任何单元格都不可读，下文默认只谈 Lite 与 Full。

### 1.3 按租户分布（≥10 个页面活跃账号的租户）

| 变体 | 租户数 | 查看者占比 p25 / 中位 / p75 | 作者占比 p25 / 中位 / p75 | 作者数 0 / 1 / 2–3 / 4+ | 查看占比 <5% / 5–15% / 15–30% / >30% |
|---|---:|---|---|---|---|
| Lite | 489 | 0% / **4.5%** / 11.1% | 0 / **0** / 0.7% | **322** / 77 / 44 / 46 | 257 / 145 / 59 / 28 |
| Full | 62 | 0% / 5.6% / 14.9% | 0 / 0 / 1.5% | 35 / 10 / 10 / 7 | 28 / 18 / 11 / 5 |

- 按租户规模（Lite，页面活跃账号）：10–49 → 255 个租户，其中 133 个查看者为 0；50–199 → 159 个，中位 4.9% 查看 / 0 作者；200–999 → 58 个，中位 9.5% / 0.58%；≥1000 → 17 个，中位 6.6% / 0.63%。
- 只看至少有 1 个查看者的 Lite 租户（n=327）：中位查看占比 8.3%，中位作者占比 0.22%。
- 作者 ÷ 查看者（有作者的租户中位数）：Lite 12.3%，Full 14.3%。合计口径 Lite 9.1%（普查窗）/ 11.6%（当前 30 天）。

**读法**：问题不是「每个客户都是 10%/1%」，而是**三种租户**：(a) 322 个有人、没人看也没人画的租户（触达问题）；(b) 77 个单作者租户（脆弱，作者一走就归零）；(c) 46 个 4+ 作者租户（它们贡献了合计数）。三种租户需要的杠杆不同。

### 1.4 当前 30 天分子（无分母）

Lite：查看者 9,640（viewer surface 9,518），创建者 968，编辑者 846，作者 1,121；查看者中自 2026-04-18 起从未创建/保存的 **7,238 / 9,516 = 76.1%**（08-22 锚点 79%）。Full：1,710 / 1,699 / 165 / 164 / 193；从未创作 78.5%。
≥10 查看者的租户：Lite 142 个（作者 0 / 1 / 2–3 / 4+ = 9 / 28 / 42 / 63），Full 23 个。

以 D1 当前 30 天分母计算（§1.1）：Lite 查看者 9,640 / 97,523 = **9.9%**，作者 1,121 / 97,523 = **1.15%**；Full 1,710 / 12,762 = 13.4%，作者 193 / 12,762 = 1.5%。与普查窗口口径一致。按租户的中位数需要 D1 × Mixpanel 的域名 join，I-2 第一次跑时补。

### 1.5 C-tier（读者多、作者少）现状（`queries/premise_b1_ctier.js`）

定义沿用 `private/research/2026-08-03`：60 天内 ≥10 个独立读者、≤3 个创建者且 ≤3 个保存者。

| 训练窗 | 有信号租户 | ≥10 读者 | C0 | C1 | C2 | 合计 |
|---|---:|---:|---:|---:|---:|---:|
| 8 月研究复现（05-05→07-03） | 456 | 180 | 14 | 22 | 49 | **85**（原研究 84） |
| 现在（08-07→10-05） | 472 | 185 | 16 | 28 | 52 | **96** |

8 月的 85 个租户现在：40 个仍是 C-tier，17 个向上退出，28 个读者跌破 10。**本月达到 ≥4 作者的：9/85 = 10.6%**（8 月研究前向 30 天为 3/84 = 3.6%）。差异是否来自 byline（08-23 全量）无法归因（无对照）。

---

## 2. 创作漏斗、留存与读者广度

### 2.1 开始 → 成功（同用户 1 小时内，当前 30 天，`queries/premise_c5_start_to_success_1h_op.js`）

| 变体 | 创建用户 | 转化 | 率 | 编辑用户 | 转化 | 率 |
|---|---:|---:|---:|---:|---:|---:|
| Lite | 1,284 | 958 | **74.6%** | 1,039 | 826 | **79.5%** |
| Full | 193 | 160 | 82.9% | 184 | 160 | 87.0% |

按类型（用户×类型实例，任意类型成功计入）：Lite 创建 mermaid 62%、graph 60%、openapi 52%、asyncapi 21%；Lite 编辑 mermaid 84%、graph 67%、openapi 64%。Graph/OpenAPI 是最差的两条。注意 `macro_create_started.macro_type` 对 sequence 家族默认写 `sequence`（`src/forgeIndex.ts:1003`），start 类型不能预测保存类型。

### 2.2 终止事件 `macro_authoring_ended`（10-05 才上线，样本 2 天）

Lite 创建：436 个可归因的终止，370 保存（85%），65 关窗，1 取消；**文本编辑器上有输入记录的未保存 50 个里 42 个已经打过字**（打了字又放弃）。Lite 编辑：782 个终止，331 保存（42%），161 关窗，290 取消。
仪表缺口（本身就是发现）：文本编辑器路径从不调用 `setEditJourneyMeta`，580 个事件里 521 个无 `macro_type`/`operation_mode`；start 事件无 `journey_id`；`had_input` 在所有 cancelled 上缺失；`macro_authoring_ended{cancelled}`（mermaid 编辑 2 天 221）与 `macro_edit_cancelled`（23 天 22）相差约 100 倍，未解释。

### 2.3 作者留存（`queries/premise_d1_author_days.js`）

| 首次创建队列 | n | +1..30 天再创作/保存 | +1..60 天 | 第 2 周后回来 |
|---|---:|---:|---:|---:|
| 2026-06 | 652 | **51.2%** | 57.1% | 33.0% |
| 2026-07 | 591 | **54.5%** | 60.9% | 34.7% |
| 2026-08 | 518 | 50.6% | （截断） | 32.6% |

月度作者 → 下月作者：Lite 361/985 = **36.6%**，Full 75/180 = 41.7%。当前 Lite 1,121 个作者中 **760 个上月不是作者**。

### 2.4 读者广度（`queries/premise_e1_reader_breadth.js`，viewer surface，当前 30 天）

| 变体 | 被看过的图 | 独立读者 p25 / 中位 / p75 / p90 | 1 / 2–4 / 5–9 / 10–49 / 50+ 读者 | ≥10 读者的图贡献的浏览 |
|---|---:|---|---|---:|
| Lite | 22,134 | 1 / **2** / 3 / 6 | **11,055** / 7,728 / 2,552 / 799 / 0 | 29.0% |
| Full | 2,764 | 1 / 2 / 4 / 9 | 1,198 / 986 / 348 / 231 / 1 | 47.8% |

含作者自己的浏览。在能识别作者的图上（Lite 12,400 张），**46.8% 的浏览、75.9% 的读者实例来自非作者**。

---

## 3. 已发布的赌注 vs 它们自己的门槛（`evidence/readout.md`）

| # | 赌注 | 上线 | 变体 | 当初门槛 | 当前 30 天实测 | 判定 |
|---|---|---|---|---|---|---|
| 1 | Byline「Diagrams」（T1） | 2026-08-23 全量（跳过 10% 阶段） | Lite（装了 Full 的站隐藏） | 首次创建（点击后 30 分钟内）≥100/30d 继续，<30 停 | 打开 1,030 人/254 租户；点创建 284 人（253 人此前从未创作）；**首次创作者 51 人**，任意创建 71 人；308 张图，失败 1.9% | **30–99 未定义区间**；T8-A 工具栏创建从未上线，所以 T1+T8-A 的合并门槛永远读不出 |
| 2 | 工具栏「新建图」（T8-A） | 未上线 | — | 同上 | 0 | 未上线 |
| 3 | 首页 feed 卡片（T2） | 2026-08-21 | Lite/Full/Diagramly | 只读数（09-21） | Lite 308 人看到/104 租户（单租户占 54%）；动作点击 19 人（6.2%）；**30 分钟内首次创建 1 人** | 触达是估算的 2 倍、点击率 3 倍，但产出约 1 人/月；09-21 读数从未写下 |
| 4 | 空间管理员一键页面模板（T5） | **未合并**：PR #539 自 08-22 开放，1,527 行；spike **GO**（Forge 宏节点经 `POST /wiki/rest/api/template` 存活、在原生模板选择器可见、渲染、首次保存绑定 custom content） | — | ≥7/74 空间建模板且新作者 ≥2× 扩展；<4 停 | 0 | 「做了没发」的典型 |
| 5 | 编辑器模板库（#334） | 08-17 Lite；08-26 起空白新宏自动弹出 | 全部 | 同会话成功率高于 63.5%；租户随机化 8–12 周 | 打开 958 人（自动弹出 1,354 次）；应用 88 人/56 租户；**模板只占 0.7% 的创建**（Full 1.1%）；自动弹出的空白新宏里：用模板 44.1% 成功 vs 不用 64.1%；gantt / onboarding-journey 模板 0 次成功 | 随机化从未建；描述性结论：模板不提高成功率、触达 <1% |
| 6 | View Source（#333） | 2026-07-12 | Lite/Full | 14 天创建 vs 对照租户 | Lite 打开者 392 人 = 文本宏查看者的 5.05%；35% 复制；从未创作者中，打开者 14 天首次创建 **20.5%** vs 未打开 1.76% | 相关非因果；`has_edit_permission` 在 100% 事件上为 true → 打开者是编辑者不是读者 |
| 7 | Viewer「Create」引导视频 | 2026-10-05 Lite；flag `create-guide-enabled` | Lite | 无 | **0 条外部事件**；开发者控制台 2026-10-07 读取：Lite 生产**没有** `create-guide-enabled` 这个 flag（现有 9 个，上限 10），代码要求它为 true，所以 Lite 上不可能显示 | 暗：flag 不存在 |
| 8 | What's new 页面横幅 | 2026-10-06 发布 | Lite/Diagramly/AsyncAPI | 无 | 半天：66 人看到，0 展开 | 太早 |
| 9 | Copy for AI / Fullscreen / Magic | — | Lite/Full | Copy for AI ≥2% | Copy for AI **1.77%**（08-30 判定 PASS 时 2.15%）；Fullscreen 13.9% 查看者；Magic 外部 0 次查看 | — |
| 10 | CSAT / 反馈报告（支持面） | 09-10 | Lite/Full | 无 | CSAT 展示 686 人 → **提交 6 人（0.9%）**；反馈报告打开 95 → 提交 4 | — |
| 11 | 付费墙硬拦截 | 09-06 退役 | Lite | — | blocked_create 0、blocked_edit 1；非阻断横幅展示 981 人/87 租户，关闭 295，Bundle CTA 5，Marketplace CTA 0 | **拦截门已死**（CONTEXT.md 的疑问已解） |
| 12 | Growth contracts | — | — | — | `private/growth/*.yml` 为 **0 份** | 没有一个赌注有合同 |

### 3.1 接触点库存（`evidence/inventory.md`）

- **Lite 比付费的 Full/Diagramly 多出一整层激活面**：byline Diagrams、未放置图横幅、Create 引导、Plan & usage、粘贴自动转换，全部 Lite-only；Diagramly 连 Get Started/dashboard 都没有。三者共有：首页 feed、页面横幅宿主（CSAT、What's new）、模板库、View Source、Copy for AI、导出、反馈边条。
- **未使用的 Forge Confluence 模块**：`contextMenu`（选中文本 → 动作）、`contentAction`、`spaceSettings`、`spacePage`（仅 AsyncAPI 用）、`backgroundScript`、`contentProperty`；无 `rovo:agent/action/skill/mcp`；无 `jira:*`。
- 代码读 10 个 Forge flag，全部默认 false。开发者控制台 2026-10-07 读取：Lite 生产有 **9 个** flag（`ai-repair-enabled`、`paywall-admin-banner-enabled`、`ai-chat-repair-enabled`、`architecture-tokens-enabled`、`ai-chat-enabled`、`agent-link-enabled`、`editor-staleness-hint-enabled`、`session-replay-full`、`session-replay`），列表状态全为 ENABLED（flag 对象启用，不等于对所有人生效；每个 flag 的 Everyone 规则按环境挂接）；`create-guide-enabled` **不存在**；剩 1 个槽位。`editor-staleness-hint-enabled` 详情：Everyone 规则 Pass 100%，Default False，production 芯片的渲染状态与 development/staging 不同，加上外部 0 事件，读作**生产未挂接**（未点击任何芯片）。暗的：第二张图提示（构建常量）、staleness hint（生产）、Agent Link（生产客户使用 0）、AI chat。

### 3.2 读者在 viewer 里能做的事（工具栏顺序）

Highlight（mermaid）、Source、Copy for AI、Connect（flag）、Fullscreen、缩放、复制图链接、导出 PNG、版本、复制页链接、反馈边条。Edit 与 Create 仅编辑者。

### 3.3 既有决策记录（`evidence/prior-decisions.md`）

已否决、无新证据不重提：按用户的 `dynamicProperties` byline 动画、「从未创建」作为 gate、demo-page 移植、Agent Link 用户自备 API token、「多注册租户」修横幅触达、diagram hub 原型。
记录在案的冲突：07-26 nudge 设计说编辑器模板是 1–2% 的市场，08-03 研究却排 P0——读数站在前者（0.7%）；Viewer Create CTA 先被判死后又以引导视频形式发布（10-02）；08-28 的欢迎邮件草稿从未发送（也不该发，见 §3.4）。

### 3.4 外部约束（`evidence/external.md` + 本次直接读取原文）

- **Marketplace Partner Agreement 8.4(c)**（2026-10-06 在浏览器中直接读取 https://www.atlassian.com/licensing/marketplace/partneragreement ，页面标注更新于 2025-12-01）：「You may use End User Data to communicate directly with end users only where required by Law or as consented to or requested by the end user.」以及「You may not send marketing messages to end users within any user experience integrated with Atlassian Apps without Atlassian's express written consent.」8.4(b) 另要求通过 Atlassian API 取得的终端用户联系信息只能用于用户授权或提供 App 功能所必需的处理。`evidence/external.md` 另记录 Atlassian Developer Terms 页面的措辞不同（提到技术/账务联系人）。两份文件哪份优先、是否互相覆盖，本文未核实，需要有资格的人裁定；**在裁定前按较严的 Partner Agreement 读法执行：不用 license 报表里的联系人邮箱做 adoption/营销外联；产品内的接触点必须是功能，不能是推广。**
- Forge 没有 blueprint/模板模块（FRGE-682）；REST 建空间模板需要调用者是空间管理员，`write:confluence-content` 已声明，不升 major；page-banner 模块文档：推广用途有被下架风险。
- Rovo：`rovo:agent` / `rovo:action` 可用，`rovo:mcp` 2026-10-01 进入 Preview，`rovo:skill` 10-02 进入 Preview；Gliffy 2026-09-10 发布了 Rovo agent。
- 没有任何已发表的 Confluence 或图表类 App 的创作者/读者比例基准；90-9-1 来自论坛研究。竞品共同模式：模板库 + AI 生成 + Jira 交叉链接。

---

## 4. Engagement 模型与运营指标

```
   每租户 engagement  =  触达 Reach  ×  激活 Activation  ×  留存 Retention
                          │              │                   │
   定义               宏查看者 ÷        作者 ÷ 查看者       上月作者本月仍为作者
                      页面活跃账号                           的比例
   Lite 实测          中位 4.5%         中位 10.9%           36.6%
                      (p75 11.1%)       (p25 7.7%, p75 15.6%) (Full 41.7%)
   Full 实测          中位 5.6%         中位 11.4%           41.7%
```

**关键读法：合计 ~1% 作者 ≈ ~9–11% 触达 × ~11% 激活。** 激活率在有 ≥10 查看者的租户里相当稳定（中位 10.9%，四分位 7.7%–15.6%），**缺口主要在每租户的触达，不在「把读者变成作者」**。合计的 10% / 1% 是普查数，不是运营指标。

运营指标（每月 1 日跑前 30 天；外部租户；每项都报「含/不含最大租户」，最大租户占 Lite 30% 的创建；2026-10-06 之后的窗口先重新验证 `okUser`，因为匿名查看已上线）：

| # | 指标 | 定义 | 基线（2026-09-06→10-05） |
|---|---|---|---|
| M0 触达 | 宏查看者 ÷ 页面活跃账号；分母取 D1 `AnalyticsEventFact` 的 `app_first_seen`（30 天窗口），按租户 join 域名 | Lite 9.9%，Full 13.4%（当前 30 天，合计口径，§1.4）；按租户中位数待 I-2 首跑 |
| **M1 租户作者广度（北极星）** | ≥10 个查看者的租户，按作者数分桶 0 / 1 / 2–3 / 4+ | 作者 = 窗口内有 `macro_create_succeeded` 或 `macro_save_succeeded` 的账号 | Lite 142 = 9 / 28 / 42 / 63，**≥2 作者 105 个**；Full 23 = 1 / 3 / 9 / 10。第二行：1–9 查看者且 0 作者的租户数（可由 `premise_a1` 直接算出，R-0 补） |
| M2 新增首次创作者 | 自 2026-04-18 起首次 `macro_create_succeeded` 落在窗口内的账号；I-1 后按 `entry_point` 拆 | 2026-08 队列 518；自然率 439/30d（Mixpanel）vs 923（D1） |
| M3 作者留存 | (a) 上月作者本月仍为作者；(b) 首次创作者 +1..30 天再创作/保存 | (a) Lite 36.6%，Full 41.7%；(b) 6 月 51.2%，7 月 54.5% |
| M4 创建完成率 | `macro_create_started` 用户 1 小时内 `macro_create_succeeded` | Lite 74.6%，Full 82.9%；I-1 后另开一条按 `journey_id` 的序列 |
| M5 读者广度 | 每张图的非作者独立读者中位数；≥2 个非作者读者的图占比 | Lite 中位 2（含作者）；22,134 张里 11,055 张只有 1 个读者 |

不是运营指标：合计查看者/账号、合计作者/账号、任何点击或打开数（信号不是结果）。
M1 目标值在 I-2 第一次回算上一窗口、知道月度噪声带之后再定（C-tier 两个窗口间从 85 变 96 没有任何干预）；C-tier 自然毕业率 10.6%/30d 作为对照线。

---

## 5. 五个方向的判定

### 5.1 增加功能 → **收窄：先把已经做好、关着的代码打开，再写新代码**

- 创建成功率已经 74.6%（编辑 79.5%）。就算编辑器转化做到 100%，每月最多多 326 个创作者（+34%），而且这 326 个人落在哪种租户是 **UNKNOWN**（没有按租户作者桶拆过）。
- 已建成、暗着的：**staleness hint**（PR #351，2026-07-18，flag `editor-staleness-hint-enabled`，0 事件）、**第二张图提示**（构建常量 false）。两者各 0.25 周。
- AI 文本生成只做 **spike**（0.5 周，不暴露用户）：`chat-modify` 拒绝空源（`functions/diagramly/chat-modify.ts:41-46`）；AI Repair 第一次真实曝光就撞上 50 秒预算；免费 Lite 的 token 成本谁付未定。
- 冻结：Rovo agent（无触达/需求数据）、Magic（外部 0 次查看）、Agent Link 实时中继与 headless MCP（生产客户使用 0）。Copy for AI 自己的 2% 规则已经不过（1.77%），不再作为「AI 交接有需求」的证据。

### 5.2 增加接触点 → **保留页面内入口，停掉目的地与横幅**

- **Byline 是唯一有实测首次创作者产出的接触点**：1,030 打开 / 284 点创建 / 51 个首次创作者每月。它的 30–99 区间没有规则，本文给出规则（§7 停止清单）。
- 把它**扩到 Full**（B-2）：Full 今天没有创建 byline；链条里每个行为因子都在 Lite 上实测过（10.8% 打开 × 27.6% 点创建 × 18.0% 30 分钟内首次创建），打 0.5 折后约 14 人/90 天，1.25 周。
- `contextMenu`（选中文本 → 画图）只做半天 spike：它是唯一能触达「页面上没有图」的入口，也就是 0 作者租户所在的地方；但 `canUserEdit()` 是个永远返回 true 的 stub（`src/model/ApWrapper2.ts:1549-1551`），做任何「仅编辑者」入口前要先修（I-3）。
- 停：T4 页面横幅激活变体（触发条件已不存在；page-banner 文档禁推广用途；横幅疲劳曾达每人中位 16 次曝光）；首页 feed（1 人/月，冻结不再投入）；Get Started（C-tier 每月 4 次访问）；Create 引导视频继续暗着（0 事件，且与已记录的否决冲突；因 stub，读者也会看到）。What's new 10-20 复读，展开+点击 <1% 则不再加条目。

### 5.3 提供技术支持 → **作为杠杆停掉；只保留流程内的自动诊断**

- 被动支持面几乎没人用：CSAT 686 展示 → 6 提交；反馈报告 95 打开 → 4 提交；应用内帮助每月 140–617 次点击。它们都触达不到 0 作者租户。
- 保留并做好的是**流程内诊断**：I-1 加 `exit_path` / `has_syntax_error` / `had_input`；R-0 用现有 `error_shape=bare_not_found` 量化「权限伪装成 404」的保存失败。任何救援 UI 要等 11-04 读数，且必须放在人真正离开的地方（Lite 创建未保存 66 个里 65 个是直接关窗，不是放弃对话框）。
- JSM 人工支持在本证据里未测（UNKNOWN）。外联邮件排除（§3.4 原文）。
- 建议退役 CSAT 横幅（可逆的代码改动）：它在横幅宿主里优先级高于未放置图横幅与 What's new。

### 5.4 提供模板 → **停止扩张，把两个悬案结掉**

- 编辑器模板只占 Lite 0.7%、Full 1.1% 的创建；自动弹出的空白新宏里，用模板 44.1% vs 不用 64.1%（有自选择混淆，方向 UNKNOWN）。目录已有约 23 个模板（`src/model/Diagram/EditorTemplates.ts`），竞品 15–20 个。**不做 Template Atlas。**
- **B-4**：删掉 0 成功的 `mmd-project-gantt`、`mmd-user-onboarding-journey`；把自动弹出改成 accountId 哈希 50/50 对照（两臂都打 `editor_auto_open_eligible` 哨兵事件）；11-19 读数决定自动弹出去留。这同时了结 07-26 vs 08-03 的分歧。
- **空间页面模板（PR #539）**：spike 已 GO，机制与编辑器模板不同（Confluence 原生模板选择器 → 新页面自带一个宏）。但 PR 自 08-22 CONFLICTING，种子空间（50–84 个宏）本来就有作者，且落在付费墙 85 警告线正下方。**10-13 二选一：≤2 天能 rebase 且 page-banner 推广措辞允许功能性自荐 → 合并上线；否则关 PR 保留分支，spike 结果以 docs-only 提交到 main。** 默认关。

### 5.5 留存与测量（第五个方向）→ **保留，而且先做**

- 5 个百分点的 Lite 作者月留存 ≈ 49 个作者/月（985 × 5%），比整个功能组合（打折后 13–29 个首次作者/90 天）都大。但本计划里没有一个杠杆能被证明动得了它——留存赌注（B-1、B-3）都小。
- 这个方向交付的是**可读的门槛**：I-1 修掉无类型事件（521/580）、byline 归因、恒为 true 的 `has_edit_permission`；I-2 给出 M1–M5 月度记分板、对照臂助手、growth contract（现在 0 份）。
- **不要**在 Mixpanel 里把 `app_first_seen` 的采样率调回来：当初采样到 0 是因为它和另外四个事件占了 Mixpanel 一半流量（commit e572eb7b，2026-08-26）。分母从 D1 读（M0，I-2 负责）。

---

## 6. 分群覆盖：谁被照顾到了，谁没有

| 分群 | 规模（实测） | 本季度杠杆 | 没有杠杆的原因 |
|---|---|---|---|
| **0 作者租户（多数）** | Lite 322/489、Full 35/62（普查窗）；其中约 133 个小租户连查看者都为 0 | B-1（页面编辑者碰到过期图）、B-2（Full）能**部分**触达有查看者的 0 作者租户；S-2 contextMenu spike 是唯一能到「无图页面」的候选 | **没有已实测的杠杆**。所有 viewer 侧面都到不了没图的页面。门槛：B-1/B-2 的保存/创建者里来自「上月 0 作者租户」的占比 |
| **1 作者租户（脆弱）** | 当前 Lite 28、普查 77 | 无专门杠杆；S4「邀请合著者」卡片已被否决（预测 4/月低于自己的 5/月继续线，且最接近推广用途） | 记入 M1 的 0/1 → 2+ 迁移数，只监测 |
| 2–3 作者 | Lite 42 | B-3 第二张图提示、B-1 | — |
| 4+ 作者（撑起合计数） | Lite 63 | 健康检查与事故响应（运营模型已有）；B-2 对 Full | 它们的风险是流失，不是激活 |
| C-tier（读者多、作者少） | 96 | 无专门项目 | 自然毕业率 10.6%/30d 作为 M1 对照线 |
| Full | 23 个 ≥10 查看者租户 | B-2 byline、B-1 延后 7 天 | Full 比 Lite 少一整层激活面（§3.1） |
| Diagramly / AsyncAPI | 外部查看者 22 / ~0 | **本季度不处理** | 外部量接近 0，任何读数都不可读；Diagramly 还缺 byline/Get Started/dashboard |
| 无编辑权的读者 / 匿名 | 未测（`has_edit_permission` 恒 true） | I-1 加 `is_anonymous` 与 `can_create_diagram`；匿名查看的触达指标 = `macro_viewed{is_anonymous=true}` 的租户数与页面数 | 读者侧创建 CTA 已否决；读者的工作是理解，不是画图 |

**坦白的尺度**：存活的组合（打 0.5 折）约 **13–29 个首次作者 + 8–20 个留存作者 / 90 天**；自然首次创作者 439/30d（Mixpanel）。本季度的价值在于：把指标换成按租户看、把测量修好、把唯一有效的渠道延伸到 Full、停掉已证明无效的投入。它**不会**明显移动合计的 10% / 1%。

---

## 7. 排序表与停止清单

### 7.1 排序（单位：预期新增首次作者/90 天 ÷ 工程周；留存类按留存作者增量；全部已打 0.5 规划折扣）

| 名次 | ID | 项目 | 方向 | 分群 | 首次作者/90d | 留存作者/90d | 周 | 分/周 | 置信 | 门槛（读数日 → 继续 / 停） |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **B-1** | 打开已建成的 staleness hint（Lite 生产：把现有 flag 的 Everyone 规则挂到 production） | 功能/留存 | 编辑含过期图页面的编辑者（含从未创作者与流失作者） | ~9（估：1,644 编辑者/28d × 25% 过期 × 10% 点击 × 79.5% 保存 × 50% 非作者 × 60% 首次 × 0.5） | ~8 | 0.25 | ~36 | 低 | 11-19：`staleness_hint_clicked` 后 1h 内同 `custom_content_id` 保存 ≥15/30d 且关闭率 <50% 继续；<6 或关闭 ≥60% 停并关 flag；展示 <150 人则把 DRIFT_THRESHOLD 5→3 一次再读（01-05）。**无对照时只报机制计数** |
| 2 | **B-2** | Full 变体上线「Diagrams」byline | 接触点 | Full 查看者/编辑者（78.5% 从未创作） | ~14（全链实测 × 0.5） | — | 1.25 | ~11 | 中 | 12-03：`byline_diagram_created{full}` 关联首次创建 ≥6/30d 且 ≥2 租户继续；<3 停（剥离模块，minor）；3–5 保留 01-05 再读 |
| 3 | **I-1** | 创作归因与权限真值（一个仪表 PR） | 测量 | 全部创作旅程 | — | — | 1.0 | — | 高 | 10-28：≥95% Lite `macro_authoring_ended` 带 `macro_type`/`journey_id`/`exit_path`；byline start 与点击 ±15%；`can_create_diagram` 不是 100%。低于 80% 先修再读任何依赖门槛 |
| 4 | **I-2** | 月度记分板 M0–M5（M0 分母来自 D1）+ 对照臂助手 + growth contracts | 测量 | 全部租户 | — | — | 0.5 | — | 高 | 11-04 首跑复现 Lite 142 = 9/28/42/63（±10%）；12-03 前没有决策引用则停 |
| 5 | **R-0** | 零代码读数批（10-13） | 测量 | 现有事件 | — | — | 0.3 | — | 高 | 10-13 每项一句判定；含 okUser 复验、草稿恢复漏斗、byline 284→74 拆分、bare_not_found 规模、byline 周方差、AI Repair 成功率/延迟、补写 T1/T2/#334 读数 |
| 6 | **B-4** | 模板库修剪 + 自动弹出对照 | 模板 | 打开空白新宏的人 | 方向 UNKNOWN | — | 0.5 | — | 中 | 11-19：两臂 1h 创建成功率；B ≥ A−3pt 全员去掉自动弹出；A ≥ B+6pt 保留；中间 12-03 再读，默认去掉。曝光单元是 cloudId+type 的浏览器标记，哈希单元是 accountId，存在跨臂污染，读数时注明 |
| 7 | **B-3** | 第二张图提示（构建常量翻转 + 关闭按钮 + 2 次曝光上限） | 留存 | 看自己图的创作者 | — | ~5（估） | 0.25 | — | 低 | 12-03：点击/展示 ≥3% 且 30 分钟内创建 ≥5/30d 继续；<1% 改回 false |
| 8 | **B-5** | PR #539 空间页面模板：10-13 合并或关闭，默认关闭 | 模板 | 50–84 宏空间的空间管理员 | ~1–2（估） | — | 0.75（合并）/ 0.1（关闭） | ~2 | 低 | 合并则 12-03：74 个冻结种子空间里建模板 ≥7 继续，<4 停；护栏：种子空间的 `paywall_banner_shown`；种子名单只存 git-ignored `private/local-data/` |
| 9 | **S-1** | AI「描述你的图」从空生成：可行性与成本 spike，不暴露用户 | 功能 | 打开空白新宏的人 | UNKNOWN | — | 0.5 | — | 低 | 11-04 kill：有效 DSL ≥80%、p90 <15 s、且业主接受每个首次创作者的成本，才进入建设计划 |
| 10 | **S-2** | contextMenu 半天 spike（个人开发环境） | 接触点 | 无图页面 | UNKNOWN | — | 0.1 | — | 低 | 11-04：渲染模式、`selectedText` 是否可得、`forge deploy` 报 minor 还是 major；major 则停 |
| 条件 1 | I-3 | 用真实权限读替换 `canUserEdit()` stub | 测量 | 所有 viewer 渲染 | — | — | 0.25 | — | 中 | 11-04 看到 `can_create_diagram` 有分布后做；12-03：`viewer_load_failed` 不升；kill 12-03 |
| 条件 2 | B-7 | Byline 标题改成动作优先（静态标题，minor） | 接触点 | 全部 Lite 页面 | UNKNOWN | — | 0.25 | — | 低 | 仅当 R-0 显示 byline 周方差 ≤30%；11-19 读绝对周用户数，增益超过最大周波动且创建点击占比 ≥22% 才保留；kill 11-19 |
| 条件 3 | B-8 | 草稿恢复横幅扩到任何新宏 | 功能 | 打了字没保存的人（326/月） | UNKNOWN | — | 0.25 | — | 低 | 仅当 R-0 显示恢复→保存 ≥40%；12-03 ≥8 次跨类型恢复后保存继续，否则回退；kill 12-03 |
| 条件 4 | B-6 | View Source「打开为新图」（仅对能创建的人） | 功能 | 从未创作的 Source 打开者 | 0–40（增量 UNKNOWN） | — | 1.0 | — | 低 | 仅当 11-04 ≥60 个/30d 从未创作且 `can_create_diagram=true` 的打开者且 I-3 已上线；01-05 机制读数；kill 01-05 |
| 条件 5 | D-1 | 读者广度诊断：单读者的图是没人打开页面，还是打开了没看到 | 测量 | 22,134 张图抽样 2% | — | — | 0.5 | — | 中 | 11-19 后有空档才做；01-05 硬停。≥50% 单读者图在 ≥3 读者的页面上 → 下季度做 viewer 侧；≤20% → 广度取决于页面流量，不做内容赌注 |

已否决（本轮）：View Source「从这张图开始」走 byline 路径（stub 使「仅编辑者」失效，且会在被读页面追加重复图）；Rovo agent spike（无触达/需求代理；`read:chat:rovo` 升 major）；viewer「在本页新建图」按钮（重提已否决的读者 CTA）；把 PR #539 当作接触点无限期 rebase；用 CSAT 槽位换「邀请合著者」卡片；在「不保存关闭？」对话框里做救援 UI（它只触达 66 个未保存里的 1 个）；byline 首图教练视频；现在就用 AI 描述框替换模板库；模板里预置 `starterTemplateId`。

### 7.2 停止清单

| 对象 | 动作 | 证据 |
|---|---|---|
| T4 页面横幅激活变体 | **取消** | 触发条件（T1+T8-A 合并读数）不可能发生；page-banner 文档禁推广；疲劳曾达中位 16 次/人 |
| T8-A 工具栏新建 | **放弃** | 从未上线、无 PR；byline 渠道由 B-2 延伸 |
| T1 byline 30–99 区间 | **定规则**：保留上线；除 B-2、B-7 外不再在 byline 上加东西；11-19 改在作者侧复读（T1 来源创作者的 +30 天回访 vs 51–55% 队列基线；0–1 → 2+ 作者的租户数）；连续两个 30 天窗口 <30 才停 | 51 首次创作者/30d |
| PR #539 | 10-13 **合并或关闭**，默认关闭，分支保留，spike 结果 docs-only 进 main | OPEN 45 天、CONFLICTING、0 事件 |
| Viewer Create 引导 | **保持暗**；不创建 `create-guide-enabled`（它会占掉 Lite 最后一个 flag 槽位） | 0 外部事件；flag 不存在；与已记录否决冲突；stub 使读者可见 |
| 模板目录（Template Atlas） | **停止扩张**；删 2 个 0 成功模板 | 0.7% / 1.1% 的创建 |
| 模板库自动弹出 | **改成 B-4 对照** | 1,354/1,499 打开是自动的；44.1% vs 64.1% |
| 首页 feed | **冻结**（保留上线，不再投入、不再读数） | 308 看到 / 19 点击 / 1 首次创建；单租户占 54% |
| Get Started / dashboard | **冻结**（只做卫生） | C-tier 每月 4 次访问；Create 按钮只弹 toast |
| CSAT 横幅 | **建议退役**（业主决定，可逆） | 6/686 提交；Full 0/128 |
| 反馈报告边条、文档/帮助链接 | 保留，**不再当 engagement 渠道** | 4/95 提交；帮助 140–617 点击/月 |
| What's new | 10-20 **复读**：展开+点击 <1% 则不加新条目，直到业主亲自读过 page-banner 措辞 | 66 展示 / 0 展开 |
| Copy for AI | **复判**：按钮保留；不再作为 AI 交接需求的证据 | 1.77% < 2% |
| Magic、Agent Link（中继与 headless MCP）、Rovo | **冻结**，直到有外部使用信号 | Magic 0 外部查看；Agent Link 生产客户 0 |
| 「View as diagram」预备图管线 | **搁置** | 属性写入方在仓库外，触达 UNKNOWN；Aide 基线 6 次/30d |
| `app_first_seen` | Mixpanel 侧保持采样 0；分母改读 D1 | e572eb7b：五个事件占一半流量；D1 每周仍收 1.6–4.6 万 Lite 账号 |
| 「Lite 编辑 42% 保存 / 290 取消」 | **撤回**此发现，直到 I-1 修掉 opener 侧 onClose 的 `endEditJourney('cancelled')` | `src/forgeIndex.ts:1294` |
| Fullscreen（13.9% 查看者）、未放置图横幅、AI Repair（Lite 已开）、粘贴自动转换（byline 回退，36 次）、Aide byline、Plan & usage、归属行浏览数、复制链接/导出/版本 | **保留现状**；未放置图横幅与 Aide 无读数，列入 I-2 记分板附录 | §3 / `evidence/inventory.md` |
| 付费墙横幅购买 CTA | **移交定价复盘**，本计划不动 | 981 展示 → Bundle 5、Marketplace 0 |
| Marketplace listing（2024Q2 评估量断崖） | **本季度不入 engagement 范围** | 55 → 25/季，原因未知 |
| 三份缺失读数（T1、T2、#334） | 10-13 以 docs-only 补写 | 0 份 growth contract |

---

## 8. 90 天计划（2026-10-07 → 2027-01-05，13 周）

**容量**：Feature ≈35% + Tooling ≈15% ≈ **6.5 工程周**。承诺项 4.75 周（I-1 1.0、I-2 0.5、R-0 0.3、B-4 0.5、B-1 0.25、B-2 1.25、B-3 0.25、B-5 0.1、S-1 0.5、S-2 0.1）+ 读数/发布开销约 0.75 周（6 个读数日、3 次记分板、Full 发布、B-1 迭代发布各 ~0.1）= **5.5 周**，缓冲 **1.0 周**。条件项按优先级 I-3 (0.25) > B-7 (0.25) > B-8 (0.25) > B-6 (1.0) > D-1 (0.5) 填入缓冲，**只做放得下的**；B-6 与 D-1 只有在某项提前被杀才可能进入。事故 lane 另算（≤25%）。同时最多 3 条 lane，每条每天一项。

**发布顺序**：Diagramly 金丝雀（仅当崩溃检查，外部 22 个查看者）→ Lite 同 SHA → Full 不早于 7 天后。staging 只由 CI 部署；生产 flag 需业主明确同意；每个功能第一个 commit 先注册事件。

```
周   1     2     3     4     5     6     7     8     9    10    11    12    13
     10-07 10-14 10-21 10-28 11-04 11-11 11-18 11-25 12-02 12-09 12-16 12-23 12-30
A 测量 [R-0][== I-1 ===]      [I-2 合同]  ●11-04记分板         ●12-03记分板      ●01-05
                                       [I-3?]
B 功能        [B-4 随 I-1]   [B-1 flag]  [=== B-2 ===]→Full≥11-10  [B-3]        [B-6?]
C 决策  ●10-13 #539 二选一        [S-1][S-2]  ●11-19 读数(B-1,B-4,B-7,T1)  ●12-03
```

| Lane | 项 | 时间 | 「上线且完成」判据 | Kill 日 |
|---|---|---|---|---|
| A 测量 | R-0 零代码读数 | 10-07..10-13 | 每项一句判定写进 `readouts/` | 10-13 |
| A | I-1 归因 PR | 建 10-07..10-20；Diagramly+Lite 10-21；Full ≥10-28 | 7 天读数 ≥95% 覆盖 | 10-28 |
| A | I-2 记分板 + 合同 | 合同 10-24；首跑 11-04，再 12-03、01-05 | 11-04 复现基线 ±10% | 12-03（无决策引用则停） |
| A | I-3 真实权限读（条件） | 11-04 看到分布后；Lite 11-11 | `has_edit_permission` 与 `can_create_diagram` ±5pt | 12-03 |
| A | D-1 广度诊断（条件） | 11-19 后有空档 | 覆盖率报告 | 01-05 硬停 |
| B 功能 | B-4 模板修剪 + 对照 | 随 I-1 同一发布 10-21 | 两臂都有 `editor_auto_open_eligible` | 12-03 |
| B | B-1 staleness hint flag | 业主 2026-10-09 批准分三步：① 自家站定向（installContext = zenuml 站的 ARI，production），② 1–3 个客户 install + `session-replay-full` 定向，③ Everyone Pass 10–20%（按 install）。① 的验证页已就绪（ZS 空间，页面版本 8，图保存于版本 2，drift 6）；① **已完成 2026-10-09**：控制台 Rule 2（`installContext` is equal to 本站 ARI，Pass 100%，仅 production；Everyone 规则未动；Activity 记录「'Rule 2' has been created」）；页面编辑器实测提示条出现（「This page has changed 7 times since this diagram was last updated…」+ Update diagram + ✕），截图在会话 scratchpad。② **已完成 2026-10-09 04:00 UTC**：Rule 2 改为 `is any of`（本站 + 3 个客户 install，仍仅 production）；`session-replay-full` 的 Everyone 规则追加同一批 3 个 install（100% 录像，读数后移除）；两处均经 Activity 与重新加载确认。候选名单与 cloudId 不入库。读数查询 `queries/staleness_readout.js`，读数日 **2026-10-23**（两周），之后决定 ③ Everyone Pass 10–20% | ① 自家站页面编辑器出现提示条且 Mixpanel 收到 `staleness_hint_shown{client_domain=zenuml}`；③ 后 72h 内有外部 `staleness_hint_shown` | 01-05 |
| B | B-2 Full byline | 建 10-22..11-03；Diagramly+Lite 11-04（对它们是 no-op）；Full ≥11-11 | `byline_opened{product_type=full}` 有外部用户 | 01-05 |
| B | B-3 第二张图提示（+B-8 若 R-0 通过） | Lite 11-18 | `macro_second_diagram_prompt_shown` 有外部用户 | 12-03 |
| B | B-6 View Source 复用（条件） | 建 11-24..12-05；Lite 12-08 | `viewer_source_reuse_clicked` 外部触发 | 01-05 |
| C 决策 | PR #539 二选一 | 10-13 | 合并则 Lite ≤10-27；否则 10-27 关闭 | 10-27 |
| C | B-7 byline 标题（条件） | 随 B-2 的 Lite 发布 11-04 | 周用户数增益超最大周波动 | 11-19 |
| C | S-1 AI spike | 10-28..10-31 | 三项判据 | 11-04 |
| C | S-2 contextMenu spike | 11-03 | 三项判据 | 11-04 |
| C | T1 作者侧复读 | 11-19 | 见 §7.2 | — |

**读数日历**：10-13（R-0、#539、B-7/B-8/S-1 go/no-go）→ 10-28（I-1）→ 11-04（首次记分板；`can_create_diagram` 分布决定 I-3/B-6；S-1/S-2）→ 11-19（B-1、B-4、B-7、T1 作者侧）→ 12-03（B-2、B-3、B-8、#539 读数 A、第二次记分板、I-3）→ 01-05（M1–M4 对基线的 90 天复盘；B-6、D-1；B-1/B-2 中间带复读）。

**I-1 通过前读不出的门槛**：B-3 的 `entry_point` 归因（时间 join 仍可用）、B-6、B-8 第一阶段、S-1 任何建设门槛、任何编辑失败/取消率结论、按 journey 的 M4。
**不依赖 I-1 的门槛**：B-1（`is_diagram_author` 已在事件上）、B-2（`custom_content_id` join）、B-4（§2.1 的用户 join + 自带哨兵）、B-5、M1–M3、R-0。
**先等 okUser 复验的门槛**：任何 10-06 之后的独立查看者计数（B-7、D-1、M1、M5）。

**硬约束**：无邮件/外联；仓库里无租户标识（合同只引用 cohort）；不新增 Forge scope（每次模块改动看 `forge deploy` 输出确认 minor）；不新增 Forge flag（Lite 9/10，留 1 个槽位；B-1 复用现有 flag）；无按页面浏览计费的 Forge Function；Confluence 仍是唯一存储。

---

## 9. 只有业主能做的决定

1. 接受「≥10 查看者的 Lite 租户中 ≥2 作者的数量」（今天 105）作为北极星，取代合计 10% / 1%？
2. 接受本计划不会明显移动合计比例（打折后 13–29 首次作者/90 天），按 M1–M4 评价？
3. 10-29 把 Lite 生产的 `editor-staleness-hint-enabled` Everyone 规则挂到 production（flag 已存在，Pass 100%，Default False；控制台已读）？
4. 把「Diagrams」byline 发到 Full（manifest 改动，预期 minor；Full 发布不早于 Lite 后 7 天）？
5. 10-13 前亲自在浏览器里读一遍 Atlassian page-banner 模块关于推广用途的原文？
6. PR #539 10-13 默认关闭（分支保留），除非 ≤2 天能 rebase 且上述措辞允许功能性自荐？
7. 接受页面活跃分母从 D1 `AnalyticsEventFact` 读取、Mixpanel 侧保持采样 0？
8. Create 引导本季度保持暗（不创建 `create-guide-enabled`，保留最后一个 Lite flag 槽位）？
9. 退役 CSAT 横幅？
10. 批准 0.5 周 AI 从空生成 spike（不暴露用户，含每次生成的 token 成本估算）？
11. 批准半天 contextMenu spike（个人开发环境）？
12. 11-18 的 Lite 发布把 `VITE_SECOND_DIAGRAM_PROMPT_ENABLED` 设为 true（带关闭按钮与 2 次曝光上限）？
13. Agent Link（中继与 headless MCP）与 Magic 冻结到出现外部使用信号为止？
14. 11-04 看到权限分布后，用真实权限读替换 `canUserEdit()`（会对不能编辑的读者隐藏 Edit 按钮）？

---

## 附录

- `evidence/readout.md` — 已发布赌注逐项读数（查询 `queries/bets_*.js`，离线 join `queries/bets_join_*.py`）
- `evidence/funnel.md` — 前提复测、漏斗、留存、读者广度（`queries/premise_*.js`）
- `evidence/inventory.md` — 接触点、模块、flag、支持面库存（纯代码阅读）
- `evidence/prior-decisions.md` — 既有决策与约束（27 条记录 + 14 条约束）
- `evidence/external.md` — Forge 模块、REST 模板、基准、竞品、条款（含 URL）
- 方法：五个证据代理 → 五个视角提案（功能 / 接触点与分发 / 支持与赋能 / 模板与内容 / 留存与测量）→ 每个视角一个对抗性反驳者 → 综合 → 完整性批评。所有代理跑在 Opus/Sonnet 上。综合与批评的原始 JSON 在会话 scratchpad，不入库。
- 重跑 JQL 前，把 `private/operations/internal-analytics-domain-exclusions.md` 的条目补回 `INTERNAL` 列表。

