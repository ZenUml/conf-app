---
name: ai-repair-regression
description: 用私有语料中已保存的 AI Repair 原始 error DSL 回归当前 Prompt。简易回归只做 L2；完全回归按 L2→L3→L4 验证。用于“AI Repair 简易/完全回归测试”或修复批次结束后的历史案例回放；不采集新的线上失败 Job，也不做模型横向比较。
---

# AI Repair 历史语料回归

本 skill 只重放已保存的原始失败 DSL，检查当前代码、Prompt 和默认模型是否让旧问题复发。用户单独说“AI Repair 简易回归测试”时直接使用本 skill；不要求线上统计的起止时间，不查询生产 Job/Mixpanel，不导入新案例，也不要求历史案例先前已获 L4 PASS。发现新线上失败并修复用 [ai-repair-improvement](../ai-repair-improvement/SKILL.md)；单案例诊断用 [ai-repair-case-validation](../ai-repair-case-validation/SKILL.md)；模型横向比较用 [ai-repair-benchmark](../ai-repair-benchmark/SKILL.md)。

## 确定范围与授权

1. 定位 conf-app 与 diagramly.ai 两个 checkout，核对远端、项目指令、HEAD 和工作区状态。读取 `private/local-data/ai-repair-regression/corpus.json`、每例 manifest、原始 DSL、真实错误与历史结果。核对输入 SHA-256 和先前 PASS/FAIL/未验证状态；缺少原始文件时报告阻塞，不从公开文件或报告重建客户 DSL。未指定案例范围时，使用**全部已保存案例**，先向用户说明数量；指定数量上限时按最早失败、不同 DSL 类型和最近退化覆盖取样，并列出未覆盖案例。
2. “简易回归”确定为**仅 L2**；“完全回归”确定为 **L2 → L3 → L4**。用户只说“回归”且模式不明时才询问。默认每例一次模型调用；调用前核对本轮最大调用次数或 token/费用预算，以及是否已获覆盖所选案例、实际 AI 服务、路径和模型的数据发送授权。说明完整原始 DSL、真实错误及当前 Prompt 将经本地 Diagramly 发送到哪里。若当前会话没有覆盖本轮的明确授权，先询问；旧 run 文件中的授权记录不自动授权新调用。预算不足时缩小范围须经用户确认，不自行突破上限或重试。
3. 完全回归的 L4 会把客户 DSL 放进测试 Confluence 宏，属于另一个数据目的地；执行前单独确认具体站点与是否留下草稿。AI 服务授权不覆盖这一步。没有授权时 L4 记 `BLOCKED (no_ui_data_authorization)`。

## 执行与证据

在私有 `private/local-data/ai-repair-regression/runs/<run-id>/run.json` 新建本轮记录，写入所选案例、模式、授权范围、预算台账、模型与目的地、两个仓库版本、逐例状态和证据路径。生产时间窗口与聚合数量记为 `not_applicable`；不覆盖语料根目录的旧 `run.json` 或历史结果。原始 DSL、候选、响应与截图只保存在本机私有目录，不写入公开仓库、PR、任务标题或普通消息。

从 `src/utils/aiModelConfig.ts` 读取当前 `DEFAULT_AI_REPAIR_MODEL`。按 [L2 方法](../ai-repair-benchmark/references/methodology.md#生成-l2-prompt) 从当前 Diagramly checkout 生成真实 Prompt，逐例记录 Prompt hash、有效参数与原始输入 hash；不得手抄 Prompt、改写错误 DSL 或把 `reference-fixed.*` 传给模型。每次调用前预约预算，调用后立即保存原始响应、候选、token/费用来源并验证该例，不因失败自动追加调用。

L2 的 PASS 必须同时满足：候选非空且非原文返回、`missingRequiredAnchors` 为空、适用语言的语法检查通过，并有**实际本地渲染**证据。Mermaid 用当前 Diagramly 安装的 Mermaid 在浏览器中 parse/render；PlantUML 使用离线本地验证器检查并渲染，不把客户 DSL 发往额外的在线验证服务。验证器不可用时记 `UNVERIFIED`，不能用模型响应成功或 `score_candidates.py` 的初步评分代替渲染。保留每例的候选、检查结果、可见预览和失败证据；无可见预览不得标 L2 PASS。

简易回归到 L2 为止，将每例 L3/L4 记 `SKIPPED (simple_regression)`。完全回归沿用 [ai-repair-case-validation](../ai-repair-case-validation/SKILL.md) 的逐层门槛：同一模型 L2 PASS 才做 L3，L3 PASS 才做 L4；L4 必须有 Forge UI 实际错误态、diff、Apply 后预览及网络证据，并按项目规则复用当前已登录浏览器。任何层失败或受阻时停止该例后续层，保留原因和证据，不能借历史 PASS 越过门槛。

逐例对比历史状态与本轮结果。发现退化或失败时保留原始输出并报告最早失败层；回归任务本身不自动修改 Prompt/代码或追加模型调用。若用户要求修复，再转入相应案例验证或持续改进流程，并取得所需预算。

## 交付

报告覆盖与未覆盖案例、每例本轮 PASS/FAIL/UNVERIFIED/BLOCKED、历史对照、模型与 Prompt/输入版本、调用次数、费用及私有证据路径。简易回归通过只说明当前 Prompt 的**本轮 L2** 结果；历史 L4 预览不能充作本轮 L4 证据，一次成功也不证明多次采样稳定。只报告实际观察，不从少量样本推断总体成功率。未经另行明确要求，不提交、推送、部署、发布页面或设置周期运行。
