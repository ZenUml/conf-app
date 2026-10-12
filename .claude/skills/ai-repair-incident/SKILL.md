---
name: ai-repair-incident
description: 分析线上 AI Repair 修复失败并验证改善；先收集线上证据，再严格按 L2 Diagramly Prompt → L3 本地异步 job → L4 真实 Forge UI 排查，每层成功后才进入下一层。模型横向比较使用 ai-repair-benchmark。
---

# AI Repair Incident

用于一份具体的线上失败 DSL，从 Prompt、后端 job 到真实 UI 定位问题并验证修复。先保存已有线上证据，再执行 **L2 → L3 → L4**。本 skill 不是模型横向 benchmark，也不执行 L1；比较模型时使用 `ai-repair-benchmark`。发布后通用冒烟测试仍使用 `pvt-ai-repair`。

## 严格门槛

1. L2 修复 **PASS** 才执行 L3；L2 FAIL 或环境受阻时，停止，先定位、改善并重测 L2。
2. L3 修复 **PASS** 才执行 L4；L3 FAIL 或环境受阻时，停止，先定位、改善并重测 L3。**即使 L3 只是本地数据库未启动，也不得继续 L4 测试。**
3. 每层 PASS 必须有候选非空、非 no-op、适用语言解析/渲染成功，以及必保留锚点满足的证据。若不能完成必要验证，该层不是 PASS。
4. 未进入的层级标为 `SKIPPED`，记录 `blocked_by_L2` 或 `blocked_by_L3` 和具体原因；不得把未测层级写成 FAIL 或推断其线上表现。

这个门槛控制**新执行的测试**；已经发生的线上 L4 失败证据应在开始前读取和保存。修复后从失败层重测，只有它达到 PASS 才继续下一层。每次记录代码/Prompt 版本与配置，版本变化前后的结果分别保存。
若同一方案在某层多次失败，先修正该层的问题；不能用随后偶然的一次成功掩盖先前失败。记录所有试次，并确认当前修复方案能满足该层门槛后再继续。

## 准备

- 收集线上原始 DSL、真实解析错误、图类型、用户所用模型、时间、UI 现象、`fix-diagram` / `job-status` 响应及相关日志。分清已观察到的事实、未知项和待验证假设，不把本地结果当作线上事实。
- 确定本轮需要验证的模型和路径。线上默认先使用 `openai/gpt-5.6-luna`；若失败案例涉及用户点击强模型重试，另对 `anthropic/claude-sonnet-5` 建立同一原始 DSL 的独立记录。每个模型/修复路径独立应用门槛，不把上一模型的输出传给下一模型。
- 检查 conf-app 与 Diagramly 的 HEAD、工作区状态、Prompt hash、模型参数和目标环境。保留已有改动；本 skill 不自动创建分支、提交、部署或发布页面。
- 本轮 manifest、候选和证据保存在 `/tmp/ai-repair-incident/<run-id>/`；复用 benchmark 文档中的命令时，将示例的 `/tmp/ai-repair-benchmark/<run-id>/` 换成此目录。
- 完整 DSL 发给 OpenRouter 前，若来自生产或可能含客户信息，取得用户对“该 DSL → OpenRouter → 所选模型”的明确授权。客户数据和证据只保存在 `/tmp` 或 `private/`，不得写入公开仓库；不保存 token 或授权请求头。

## L2：Prompt 与模型

复用 [benchmark 的 L2 方法](../ai-repair-benchmark/references/methodology.md#生成-l2-prompt)和 `build_diagramly_prompt.ts`、`run_openrouter_matrix.py`、`score_candidates.py`。为本轮模型使用单模型 manifest、`--model <model>` 和 `--trials 1`；从当前 Diagramly checkout 生成实际 messages，不手抄 Prompt。每次调用后立即验证候选，记录原始响应、Prompt hash、模型参数、解析/渲染结果和必保留锚点。`score_candidates.py` 的 PASS 只是初步评分：还须核对 `missingRequiredAnchors` 为空，并取得适用语言的真实渲染证据；Mermaid 用当前 checkout 的 Mermaid 在浏览器中 parse/render。缺少这些证据时 L2 不能放行 L3。需要确认随机波动时可在明确记录 trial 的前提下重复；只要当前修复方案尚未有满足门槛的 L2 PASS，就停在 L2 继续分析，不能提前进行 L3。

## L3：本地异步 job

仅在 L2 PASS 后读取 [L3 操作细节](references/layer3.md)。按 `joint-debug` 准备本地 Diagramly 和 PostgreSQL，使用 [run_job_matrix.py](scripts/run_job_matrix.py) 创建一个本地修复 job 并轮询，用 benchmark 的 `score_candidates.py` 验证结果。对照 L2 的原始 DSL、模型、错误和关键配置；若不一致先说明差异，不能把不同输入的结果当作同一路径通过。记录 jobId、状态、poll 次数、候选及失败原因。环境检查失败也不算 PASS，L4 保持 `SKIPPED (blocked_by_L3)`。

## L4：真实 Forge UI

仅在 L3 PASS 后读取 [L4 操作细节](references/layer4.md)，并遵守 `joint-debug`、`pvt-ai-repair` 的 UI 证据规则。复用用户当前已登录的浏览器标签页，不新建真实账号浏览器；无法操作当前浏览器时按项目指令尝试 Codex 内置浏览器并使用标准桌面视口。每次恢复完全相同的损坏 DSL，验证错误 banner、job 创建与轮询、diff、Apply Code 后错误消失和有效预览。无实际 UI 截图、snapshot 或网络证据时不能标 PASS。

## 结论与交付

逐层列出输入版本、模型、PASS/FAIL/SKIPPED、证据、最早失败环节、修复动作及重测结果。先描述用户看到的失败，再给运行时证据和代码路径。L2/L3 的成功不代表线上已恢复；只有 L4 的实际 UI 证据能证明本轮真实链路通过。未测层级保持 SKIPPED，并说明阻塞门槛。不要用一次成功或失败估算总体模型成功率。
