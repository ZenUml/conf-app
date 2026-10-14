---
name: ai-repair-case-validation
description: 对具体 AI Repair 失败案例做原因排查、修复后验证和历史案例回归；默认模型严格按 L2 → L3 → L4 执行，强模型重试默认只验证 L2，明确指定时可继续 L3/L4。模型横向比较使用 ai-repair-benchmark。
---

# AI Repair Case Validation

围绕具体失败案例，默认对产品**默认修复模型**执行 **L2 → L3 → L4**，可用于首次定位原因、修复后验证，或回放过去失败的案例。强模型重试默认只在 L2 单独检查；用户明确指定强模型继续测 L3 或 L4 时，允许按同一模型逐层验证。多案例回归时每份 DSL 独立执行和记录门槛结果。本 skill 不执行 L1，也不做模型横向比较；后者使用 `ai-repair-benchmark`。发布后的通用冒烟检查仍使用 `pvt-ai-repair`。

## 严格门槛

1. **待测模型**的 L2 修复 PASS 才执行该模型的 L3；L2 FAIL 或环境受阻时，停止该模型链路，先定位、改善并重测 L2。强模型 L2 PASS **不能**替代默认模型 L2 PASS；只有明确指定强模型 L3 时，才能放行强模型自己的 L3。
2. **待测模型**的 L3 修复 PASS 才执行该模型的 L4；L3 FAIL 或环境受阻时，停止该模型链路，先定位、改善并重测 L3。**即使 L3 只是本地数据库未启动，也不得继续该模型的 L4 测试。**
3. 返回与原始 DSL 相同的内容（忽略首尾空白和换行格式）是 no-op，直接记为修复 `FAIL`；即使 API/job 返回成功或解析器不可用，也不能标为 PASS/SKIPPED。其余 PASS 必须有候选非空、适用语言解析/渲染成功，以及必保留锚点满足的证据。若不能完成必要验证，该层不是 PASS。
4. 未进入的层级标为 `SKIPPED`，记录 `blocked_by_L2` 或 `blocked_by_L3` 和具体原因；不得把未测层级写成 FAIL 或推断其线上表现。

这个门槛对每个待测模型分别生效；已有的线上失败证据应在开始前读取和保存。修复后验证和历史案例回归默认从产品默认模型 L2 重新开始，逐层达到 PASS 才继续。明确指定其他模型时，该模型也从 L2 开始。每次记录代码/Prompt 版本与配置，版本变化前后的结果分别保存。
若同一方案在某层多次失败，先修正该层的问题；不能用随后偶然的一次成功掩盖先前失败。记录所有试次，并确认当前修复方案能满足该层门槛后再继续。

## 失败后的修复循环

测出 `FAIL` 后不要仅交付失败报告：保存原始输入、响应、候选、日志和判定原因，定位最早失败层，修正可控的 Prompt、参数、代码或本地环境，再以**同一原始 DSL、错误和必保留锚点**重测该层。原文返回、空候选、无效语法、丢失锚点、job 失败或 UI 应用失败都要进入这个循环；不得通过改写案例输入、放宽锚点或换模型掩盖失败。环境阻塞先恢复环境并重测，阻塞本身不算模型修复失败。

每次修正单独记录改动、代码/Prompt 版本和重测结果。若改动影响上游层的输入或行为，从**最早受影响层**重新验证；若只是修复当前层的基础设施，则保留仍适用的上游证据。重复失败时继续定位和改善，不用一次偶然成功覆盖之前的失败。完成当前层的门槛后才进入下一层；确实无法修复或缺少必要授权、环境时，报告已尝试的修正和阻塞原因，后续层级保持 `SKIPPED`。本循环不授权自动提交、部署或发布。

## 准备

- 首次排查时，收集线上原始 DSL、真实解析错误、图类型、用户所用模型、时间、UI 现象、`fix-diagram` / `job-status` 响应及相关日志。修复验证或历史案例回归时，读取保存的原始输入、错误、预期保留锚点和上次失败证据。分清已观察到的事实、未知项和待验证假设，不把本地结果当作线上事实。
- 每次运行前读取 [`src/utils/aiModelConfig.ts`](../../../src/utils/aiModelConfig.ts)：默认链路取 `DEFAULT_AI_REPAIR_MODEL`，强模型重试取 `AI_REPAIR_RETRY_MODEL`。若案例记录或 `ai_repair_model` 本地覆盖值表明实际使用了别的模型，记录来源；默认只为其另做 L2 检查，明确指定时可继续 L3/L4。不得把 skill 或脚本中的示例字符串当作产品默认值，也不把上一模型的输出传给下一模型。
- 检查 conf-app 与 Diagramly 的 HEAD、工作区状态、Prompt hash、模型参数和目标环境。保留已有改动；本 skill 不自动创建分支、提交、部署或发布页面。
- 本轮 manifest、候选和证据保存在 `/tmp/ai-repair-case-validation/<run-id>/`；复用 benchmark 文档中的命令时，将示例的 `/tmp/ai-repair-benchmark/<run-id>/` 换成此目录。
- 完整 DSL 发给 OpenRouter 前，若来自生产或可能含客户信息，取得用户对“该 DSL → OpenRouter → 所选模型”的明确授权。客户数据和证据只保存在 `/tmp` 或 `private/`，不得写入公开仓库；不保存 token 或授权请求头。

## L2：Prompt 与模型

复用 [benchmark 的 L2 方法](../ai-repair-benchmark/references/methodology.md#生成-l2-prompt)和 `build_diagramly_prompt.ts`、`run_openrouter_matrix.py`、`score_candidates.py`。先用 `DEFAULT_AI_REPAIR_MODEL` 创建单模型 manifest，传 `--model <default-model>` 与 `--trials 1`。仅当案例涉及强模型重试或需要诊断该重试时，再以**同一原始 DSL**和 `AI_REPAIR_RETRY_MODEL` 创建独立的 L2 记录；此结果默认不启动 L3/L4，明确指定继续时才作为该强模型链路的 L3 门槛。从当前 Diagramly checkout 生成实际 messages，不手抄 Prompt。每次调用后立即验证候选，记录原始响应、Prompt hash、模型参数、解析/渲染结果和必保留锚点。`score_candidates.py` 的 PASS 只是初步评分：还须核对 `missingRequiredAnchors` 为空，并取得适用语言的真实渲染证据；Mermaid 用当前 checkout 的 Mermaid 在浏览器中 parse/render。缺少这些证据时该模型 L2 不能放行 L3。需要确认随机波动时可在明确记录 trial 的前提下重复；该模型尚未满足 L2 门槛时，停在 L2 改善，不能提前进行 L3。

## L3：本地异步 job

仅在**待测模型 L2 PASS** 后读取 [L3 操作细节](references/layer3.md)。默认使用产品默认模型；明确指定其他模型时，通过 `--model` 或单模型 manifest 指定。按 `joint-debug` 准备本地 Diagramly 和 PostgreSQL，使用 [run_job_matrix.py](scripts/run_job_matrix.py) 创建一个本地修复 job 并轮询，用 benchmark 的 `score_candidates.py` 验证结果。对照同一模型 L2 的原始 DSL、模型、错误和关键配置；若不一致先说明差异，不能把不同输入的结果当作同一路径通过。记录 jobId、状态、poll 次数、候选及失败原因。环境检查失败也不算 PASS，该模型 L4 保持 `SKIPPED (blocked_by_L3)`。

## L4：真实 Forge UI

仅在**待测模型 L3 PASS** 后读取 [L4 操作细节](references/layer4.md)，并遵守 `joint-debug`、`pvt-ai-repair` 的 UI 证据规则。默认验证产品默认模型；明确指定其他模型时，验证请求实际使用该模型。复用用户当前已登录的浏览器标签页，不新建真实账号浏览器；无法操作当前浏览器时按项目指令尝试 Codex 内置浏览器并使用标准桌面视口。恢复相同的损坏 DSL，验证错误 banner、job 创建与轮询、diff、Apply Code 后错误消失和有效预览。无实际 UI 截图、snapshot 或网络证据时不能标 PASS。

## 结论与交付

逐层列出每个待测模型的输入版本、PASS/FAIL/SKIPPED、证据、最早失败环节、修复动作及重测结果；强模型重试默认只有 L2 结果，明确指定继续时才列其 L3/L4。首次排查先描述用户看到的失败，再给运行时证据和代码路径；历史案例回归还应对照上次失败点和本次结果。L2/L3 的成功不代表目标环境的 UI 已恢复；只有 L4 的实际 UI 证据能证明该模型本轮修复链路通过。未测层级保持 SKIPPED，并说明阻塞门槛。不要用一次成功或失败估算总体模型成功率。
