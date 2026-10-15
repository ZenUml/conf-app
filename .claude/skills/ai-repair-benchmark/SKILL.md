---
name: ai-repair-benchmark
description: 比较不同 OpenRouter 模型修复同一组损坏 DSL 的效果；只执行 L1 原始模型与 L2 Diagramly Prompt，统计修复质量、延迟、token 和实付费用。具体案例的排查与回归使用 ai-repair-case-validation。
---

# AI Repair Benchmark

本 skill **只运行 L1 与 L2**，用于比较模型及 Diagramly Prompt 对修复结果的影响。具体 AI Repair 失败案例的排查、修复后验证与回归由 `ai-repair-case-validation` 负责。

| 层级 | 调用 | 衡量内容 |
|---|---|---|
| L1 Raw model | OpenRouter 模型 + 最小中立修复指令 + 原始 DSL + 真实错误 | 模型基础修复能力 |
| L2 Diagramly prompt | 同一模型 + 当前 checkout 的 Diagramly modify prompt、repair hints 和错误上下文 | 产品 Prompt 下的修复效果 |

## 输入与授权

确定 DSL 文件、语言、Diagramly `diagramType` / `languageKey` / `subTypeKey`、解析器的真实错误和可选的必保留锚点。模型列表由用户指定；未指定时沿用 manifest 中的模型。**直接比较模型时，每个待比较模型必须处理同一份原始 DSL、错误和层级**，不能把上一模型的输出作为下一模型的输入。

本流程会把完整 DSL 发给 OpenRouter。若 DSL 来自生产或可能含客户信息，先取得用户对“该 DSL → OpenRouter → 所选模型”的明确授权。产物默认写入 `/tmp/ai-repair-benchmark/<run-id>/`；客户数据不得写入公开仓库。需要长期保存时写入 `private/` 子模块，并先检查隐私规则。

开始前检查 conf-app 与 Diagramly 两个仓库的 HEAD、工作区状态；不覆盖已有改动。skill 本身不创建分支、不提交、不部署。

## 执行

先读 [methodology.md](references/methodology.md)，创建 run manifest。用 `scripts/build_diagramly_prompt.ts` 从当前 Diagramly checkout 生成实际 L2 messages 和 prompt hash，不手抄 Prompt。`reasoningDisabled` 是 AI Repair 与 AI Chat 的跨层配置；L1 与 L2 的同一比较组保持 temperature、max tokens、reasoning 设置一致，并记录生效值、provider 和缓存信息。用于产品回归时，它还须与同一路径的 L3/L4 一致。

用 `uv run scripts/run_openrouter_matrix.py` 分别运行 raw 和 diagramly 模式。每次模型调用后立即用 `uv run scripts/score_candidates.py` 验证候选，再进行后续调用；不得先批量调用后验证。默认每份 DSL、每个模型、每层一次；只有用户要求评估随机波动时才增加重复试验，并分开报告。单次结果是一次观察，不能称为模型成功率。若要比较普遍修复效果，使用有代表性的多份 DSL。

候选硬门槛：非空、非 no-op、适用语言的解析与渲染成功。再报告 identifier retention、changed line ratio、required anchors 和质量档。现有 `score_candidates.py` 的 PASS 只覆盖其语法检查，**不单独证明真实渲染成功**；Mermaid 还须用当前 checkout 的 Mermaid 在浏览器中实际 parse/render。无适用验证器或渲染证据时标 `UNVERIFIED`，不能判完整 PASS。语法有效不自动证明业务语义保留；用 required anchors 或人工复核。

按 model × layer 报告通过情况、质量档、p50/p95 延迟、token、cache、provider、实付 USD 与失败原因。实付费用优先采用响应或 generation API 的 `total_cost`，不得用静态价目表冒充。用 `uv run scripts/summarize_benchmark.py` 生成自包含 HTML；默认的本地/私有报告包含输入 DSL 全文、类型、真实错误、行数、字符数和 SHA-256。只有用户明确要求公开/脱敏版本时使用 `--redact-dsl`。注明样本量；少量试验不推断稳定成功率或 SLA。

## 完成条件

- 每个计划中的模型在 L1/L2 各有 PASS、FAIL 或带原因的 SKIPPED；
- 每个候选经过适用的解析/渲染检查；
- 报告包含输入身份、配置、样本量、逐次记录、聚合统计和费用来源；
- 不泄露 API key、Forge token 或真实租户信息。
