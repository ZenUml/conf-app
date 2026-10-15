---
name: ai-chat-regression
description: 用私有语料中已保存的普通 AI Chat 原图与修改指令回归当前模型和 Prompt；支持仅模型层的简易回归及含本地 job、真实 UI 的完全回归。不采集新的生产案例。
---

# 普通 AI Chat 历史回归

本 skill 只重放 `private/local-data/ai-chat-regression/` 中已固定的普通修改案例。发现和修复新线上问题使用 [ai-chat-improvement](../ai-chat-improvement/SKILL.md)；单例诊断使用 [ai-chat-case-validation](../ai-chat-case-validation/SKILL.md)。语法错误驱动的修复语料不得混进普通修改回归。

## 范围与门槛

读取 corpus 索引及每例的原始 DSL、完整 `command`、期望变化和保留条款；校验哈希，区分缺失文件与已验证案例。未指定范围时先告知总案例数，以全量为默认候选；用户指定上限时说明选取依据和未覆盖项。用户只说“回归”但未选模式时询问：**简易**仅 L2；**完全**按 L2 → L3 → L4。当前没有历史案例时报告语料为空，不伪造回归通过。

模型调用前确定本轮服务、默认模型、最大调用次数或费用，以及完整原图和指令发送授权；旧批次授权不自动适用。完全回归 L4 若会把客户内容放入测试 Confluence 宏，另行确认具体站点与是否留下草稿。授权或预算不足的案例标 `BLOCKED`，不能擅自缩小范围后声称全量通过。

## 执行

`reasoningDisabled` 适用于 AI Repair 和 AI Chat 的 L1–L4。本 skill 默认从 L2 开始；若另做 L1，也要沿用同一生效值。普通 AI Chat 当前由 Diagramly `ai-config.ts` 按 `AI_DISABLE_REASONING !== "false"` 决定 provider 默认值；Fix syntax 还经 `resolveRepairAIOptions`（默认 `true`）。在本轮派生 manifest 显式写入布尔值，核对 L2 模型记录、L3 请求与 job 输出、L4 UI 请求及目标环境。参数不同或无法证明时不得判跨层完整 PASS。

在私有 `runs/<run-id>/run.json` 新建记录，保存所选案例、模式、预算台账、授权、conf-app 与 diagramly.ai 版本、Prompt hash、输入/指令 hash、模型和逐层证据路径。每例从**不变的原图和指令**开始，按 `ai-chat-case-validation` 的同一模型逐层门槛执行；不能把旧候选作为新输入，也不能拿历史 L4 成功替代本轮 UI 证据。简易模式将 L3/L4 记 `SKIPPED (simple_regression)`。

每层至少检查请求返回与无 Error；完整 PASS 还需真实解析/渲染、指令要求和保留条款满足。`noChange` 只能按案例预期判定。L3 必须走版本化异步 job；L4 必须观察 Forge UI 中请求、终态、编辑器代码和有效预览，检查本次相关页面/网络/控制台错误。UI 不可操作时记 `BLOCKED` 或 `SKIPPED` 并给出原因，不以单元测试替代。

逐例对比历史状态和本轮结果。发现退化，保存原始输出与最早失败层；回归本身不自动改 Prompt、增加试次或把模型切换成更强者。用户要求修复时再进入案例验证或持续改进，沿用明确的预算边界。

## 交付

报告覆盖和未覆盖案例、每例 `PASS/FAIL/UNVERIFIED/BLOCKED/SKIPPED`、指令满足情况、实际 UI 与网络证据、模型/Prompt 版本、调用次数和费用来源。简易回归通过只证明本轮 L2；完全回归通过只覆盖本轮实际测试的案例和环境。代码自动写入编辑器不等于用户接受或 Confluence 保存。未经另行明确要求，不提交、推送、部署、发布页面或设置周期运行。
