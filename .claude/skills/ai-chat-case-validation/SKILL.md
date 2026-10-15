---
name: ai-chat-case-validation
description: 验证一条普通 AI Chat 图表修改指令，逐层检查模型输出、本地版本化 job 与 Confluence 编辑器 UI；用于失败诊断及修复后复测。语法错误驱动的修复使用 ai-repair-case-validation。
---

# AI Chat 单例验证

本 skill 处理 **普通修改**：用户给出非空 `command`，没有 `errorMessage`。AI Chat 的语法错误修复入口不在本轮范围；旧 AI Repair 的 `/fix-diagram` 入口另有 [ai-repair-case-validation](../ai-repair-case-validation/SKILL.md)，两条路径不能混用。一次案例固定原始 DSL、指令和验收要求；不能通过改写输入或放宽要求来制造 PASS。读取 [案例格式](references/case-format.md) 后再运行。

## 分层门槛

1. **L2 模型与 Prompt**：从当前 Diagramly checkout 生成产品实际 Prompt，用产品默认 AI Chat 模型运行单次修改。候选必须有返回、无调用错误，经过适用语言的解析及真实渲染；逐项核对指令要求和必须保留的内容。解析成功只是技术通过，不代表指令完成。L2 FAIL 或 UNVERIFIED 时不进入 L3。
2. **L3 本地版本化 job**：用本地 Diagramly API 走 `ensure-diagram` → `modify-version-async` → `job-status`。必须收到 jobId、终态 `COMPLETED`，且没有 job/API Error；预期修改时还必须有非空 `diagramCode` 与 `versionId`。重做 L2 的渲染和语义检查。L3 FAIL 或受阻时不进入 L4。
3. **L4 真实 Forge UI**：用同一原始 DSL 和指令，在 Confluence 编辑器里实际提交普通 AI Chat 请求。确认请求返回、job 完成、编辑器获得修改后的代码、预览可见，且本次流程没有相关页面错误、解析错误、网络失败或控制台 Error。保存 UI snapshot/截图与关键网络状态。L4 的 UI 证据不能由单元测试或 L3 结果代替。

每层记录 `PASS`、`FAIL`、`UNVERIFIED` 或 `BLOCKED`；未进入的后续层记 `SKIPPED (blocked_by_L2/L3)`。预期 `no_change` 只在案例已明确说明原图满足指令、且人工核验后才可能通过；不能把所有 no-op 自动算失败或成功。一次成功不证明模型稳定性。

## 准备与调用

`reasoningDisabled` 在 AI Chat 和 AI Repair 的 L1–L4 都是生效参数；本 skill 从 L2 开始。普通 AI Chat 读取 Diagramly `ai-config.ts` 的 provider 默认值（当前仅 `AI_DISABLE_REASONING=false` 会启用 reasoning），Fix syntax 还要读取 `resolveRepairAIOptions`。本轮派生 manifest 显式写入布尔值，L2 核对模型调用记录，L3 核对请求与 job 输出，L4 核对 UI 请求和目标后端配置。UI 省略字段时按后端默认值判定，不能把字段缺失等同于 `false`；不同生效值的结果不得串成一条 PASS 链路。

- 核对 conf-app 与 diagramly.ai 的当前代码、Prompt、模型配置及工作区状态；默认模型从 [`src/utils/aiModelConfig.ts`](../../../src/utils/aiModelConfig.ts) 的 `DEFAULT_AI_CHAT_MODEL` 读取，不能沿用 AI Repair 的模型键。记录 DSL 和指令的 SHA-256、代码/Prompt 版本、有效参数及目标环境。现有 `ai_chat_model` 本地覆盖值若影响实际 UI 请求，也要记录。
- 原始 DSL、指令、模型响应、候选和截图只放在 `/tmp/ai-chat-case-validation/<run-id>/` 或 `private/local-data/ai-chat-regression/`。不得把客户内容放进公开仓库、PR、任务标题或普通消息。向外部模型发送前，核对用户对本轮案例、服务、模型和调用预算的授权；把客户 DSL 放进测试 Confluence 宏则需单独确认站点与草稿处理方式。
- L2 按 [产品 Prompt 操作](references/prompt-layer.md) 复用 AI Repair benchmark 的构建器与单模型 runner，但 manifest **必须提供真实普通修改 `command`、不得提供 `errorMessage`，且只用 `--mode diagramly`**。现有构建器的末尾 user turn 虽写着 “repair instructions”，它与当前 Diagramly `buildModifyMessages` 一致；每次运行前核对该源实现，若已变化先更新构建方式，不手写近似 Prompt。`score_candidates.py` 的 PASS 只是初步语法评分，不能代替渲染及语义验收。
- L3 按 [本地 job 操作](references/local-job.md) 使用 `scripts/run_versioned_job.py`。它会在本地数据库创建测试 Diagramly 图与版本；不要把生产服务 URL 作为本地测试地址。L4 遵守项目浏览器规则，优先接管当前已登录的 Chrome；无法接管时用 Codex 内置浏览器并切到标准桌面视口。每个案例串行操作浏览器，不用现有 AI Repair 的 `/diagramly/fix-diagram` 路径替代 `/diagramly/chat-modify`。

## 失败后的循环与交付

发现失败，先保存最早失败层的原始响应、错误、候选及证据，再修正可控的 Prompt、代码、参数或本地环境；按最早受影响层用**同一输入和指令**重测。每次模型调用先核对剩余额度。若缺少语义验收要求，标 `UNVERIFIED (missing_expectation)` 并请用户或案例证据提供要求，不能凭“有返回且无 Error”宣布案例成功。

报告每层状态、指令满足情况、无错误与渲染证据、版本、调用次数和费用来源，以及实际的 UI 预览路径。当前产品在生成结果后自动更新编辑器；这不表示用户主动接受，更不表示已保存到 Confluence。只有用户要求验证持久化时才另行执行保存检查，并明确区分“编辑器已更新”与“Confluence 已保存”。本 skill 不授权自动提交、推送、部署或发布页面。
