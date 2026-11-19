---
name: ai-usage
description: >
  统计 conf-app 的 AI Chat 和 AI Repair 线上使用情况，汇报入口曝光、请求次数、
  去重用户和租户、返回与应用结果、失败及结果缺失、耗时和租户分布。
  用于“近7天 AI 使用情况”、AI Chat/Repair 周报或指定日期的使用统计；
  模型评测、单次修复诊断和 AI 标题生成使用各自流程。
---

# AI Chat / AI Repair 使用统计

在 conf-app 仓库内执行只读统计，用中文交付可核验的使用报告。默认同时统计两个功能；用户指定其中一个时只统计该功能。

## 1. 固定窗口与人群

- 默认“近 N 天”是 **包含今天的 N 个项目日历日，截至查询时刻**，N 默认 7。明确写出起止日期、项目时区和北京时间截止时刻。今天是未结束的统计日。
- 用户指定“最近 N 个完整日”时排除今天；指定滚动 168 小时、北京时间自然日或日期区间时按其要求处理。精确小时窗口使用支持时间戳边界的查询方式，不能用日期区间冒充。
- 用客户端时间上下文确定北京时间。项目时区从实时配置或仓库 `docs/analytics/reference.md` 核对，并标明来源；本次参考案例的项目日历为 UTC+7，不能当作北京时间。
- 默认统计真实客户的生产环境：`is_internal_client_domain = "false"` **且** `environment_type = "PRODUCTION"`，租户域需为有效值。另查环境值域及缺失量；不能取得时标明该覆盖项未核验，缺失事件不并入已验证的生产数字。
- 产品用 `product_type`，图表用 `macro_type`；依据查询结果说明覆盖哪些变体和图表类型。

窗口和过滤器确定后，所有总量、人数、租户、耗时及明细查询复用同一口径。调整窗口后重跑相关查询再汇总。

## 2. 校验埋点并连接数据

先读项目 [mixpanel skill](../mixpanel/SKILL.md)，沿用它的项目选择、内部站点过滤、身份和采样规则。使用 Mixpanel 连接器时先按其要求获取 Business Context，再获取当前 Insights 查询 schema；工具名通过当前工具清单发现。

从仓库根目录运行：

```bash
uv run .claude/skills/mixpanel/scripts/mp_schema.py doctor
uv run .claude/skills/mixpanel/scripts/mp_schema.py events ai_chat
uv run .claude/skills/mixpanel/scripts/mp_schema.py events ai_repair
uv run .claude/skills/mixpanel/scripts/mp_schema.py event ai_chat_prompt_submitted
uv run .claude/skills/mixpanel/scripts/mp_schema.py event ai_repair_succeeded
```

若工作树的分析源文件与 `origin/main` 不同，给命令添加 `--ref origin/main`，记录使用的 ref/commit。`origin/main` 是词汇参考，部署版本仍由事件中的 `app_version` / `app_commit` 核验。其余拟查询属性同样用 `event` / `check` 核对。

下表固定业务口径。执行时用当前 catalog 和 emit site 验证名称及语义；发生变化就解释变化，不能把过期事件查询出的零当作零使用。

| 指标 | AI Chat | AI Repair |
|---|---|---|
| 入口曝光次数 | `ai_chat_button_shown` | `ai_repair_button_shown` |
| 打开入口 | `ai_chat_opened` | 无独立打开指标，以请求事件计尝试 |
| 实际请求 | `ai_chat_prompt_submitted` | `ai_repair_requested` |
| 返回修改结果 | `ai_chat_change_applied` | `ai_repair_succeeded` |
| 成功但无修改 | `ai_chat_no_change`，单列 | 当前无对应指标 |
| 应用结果 | `ai_chat_change_applied`：自动写入编辑器 | `ai_repair_applied`：用户点击应用 |
| 显式失败 | `ai_chat_prompt_failed` | `ai_repair_failed` |
| 取消 / 放弃结果 | `ai_chat_prompt_cancelled` | `ai_repair_dismissed`：成功后关闭且未应用 |
| 耗时 | 修改结果 / 无修改结果的 `duration_ms`，分别统计 | 成功返回的 `duration_ms` |

Chat 的“Fix syntax”还会产生 `ai_chat_syntax_repair_requested`，其后进入提交路径；请求总量只计 `ai_chat_prompt_submitted`，避免重复。AI 标题自动生成不属于本报告。

## 3. 查询与核验

按 [query-recipes.md](references/query-recipes.md) 生成并执行四组查询：生命周期次数、有效账号与租户分别去重、租户分布、环境及版本 / 类型覆盖。独立查询可并行；使用 `bar` 获取整个窗口的去重人数，不累加每日 unique。

再对请求、结果、应用、失败与取消读取精简事件明细，确认：

- 用户是有效 `user_account_id`，排除缺失、占位和匿名身份。跨功能总人数 / 租户数按集合并集去重。
- 仅用所选人群与窗口内的明细计算耗时，报告样本数、中位数、范围；小样本可直接列耗时。失败 / 取消耗时与成功耗时分开。
- 显式失败、主动取消、成功无修改、成功后放弃分别计数；失败为零只能表述为“未观察到显式失败事件”。
- 请求缺少终态时，检查相同用户、租户、图表上下文和时间邻近事件。默认仅追查到能确认缺口，深挖根因由用户另行要求。

**结果缺失是观测状态。** 当前两个流程没有可用于完整串联的公共请求 ID，事件差额只能提示缺口。Chat 的终态候选是修改已应用、无修改、失败、取消；Repair 的生成终态是成功、失败，`dismissed` 是成功之后的动作。不能把 `requested - applied` 当作失败或生成缺失，也不能把窗口差额包装成精确请求级成功率。必要时少量查看窗口外邻近事件解释边界，单独标注，不计入窗口内总量。

Chat 自动应用与 Repair 主动应用应在表格里写明；它们都不等于最终保存到 Confluence。Repair 成功返回也不证明输出已通过语法验证。引用 `result`（如 `applied_as_is` / `applied_modified`）拆分应用方式时，先核对 emit site。

检查当前 `eventSampling.ts` 及明细 `sample_rate`。参考案例中的 AI 事件为全量；未来若采样变化，按 mixpanel skill 的规则处理，不能用采样到的用户集合外推全量用户数。

## 4. 中文汇报

先给一句主要发现，再给时间 / 人群口径和对照表：

| 指标 | AI Chat | AI Repair |
|---|---:|---:|
| 入口曝光 | 次数 / 人数 | 次数 / 人数 |
| 实际请求 | 次数 | 次数 |
| 发起用户 / 租户 | 人数 / 租户数 | 人数 / 租户数 |
| 返回结果 | 修改次数；无修改另列 | 成功返回次数 |
| 应用结果 | 次数，自动写入编辑器 | 次数，用户点击应用 |
| 显式失败事件 | 次数 | 次数 |
| 终态事件差额 | 差额及核验状态 | 差额及核验状态 |

有非零取消、无修改、放弃时加行。Repair 的通用主动取消在当前埋点中不可量化，与成功后放弃分开说明。接着用短段落补充租户分布、耗时（含样本数）、数据支持的使用信号，以及影响结论的缺口。附上本次查询返回的 Mixpanel 报告链接，至少覆盖次数、人群、租户分布。

曝光事件可能重复；“看到按钮的用户数”和“发起请求的用户数”可并列描述，只有验证同一用户的先后顺序才称为漏斗转化。涉及环比时使用可比时长和相同过滤器；含今天的未完整窗口不能直接与上一完整周期宣称增幅。

完整写法见 [2026-11-14 汇报样例](references/2026-11-14-example.md)。其中数字是历史快照，每次执行需重新查询。

## 完成条件

窗口 / 时区 / 截止时间、人群过滤、事件语义、有效账号去重和版本覆盖均有依据；表格数字能回指本次查询；失败与缺失分开，应用与保存分开。查询失败或明细被截断时写“未核验”及原因，保留已完成结果。

聊天可按授权汇报租户明细；写入公共仓库的例子只用租户代号。真实客户运营材料按 [客户隐私策略](../../../docs/policies/client-privacy.md) 放入 `private/operations/`，不保存用户 prompt、图表正文或模型输出。
