---
name: ai-repair-benchmark
description: 对指定 DSL 分四层测试 AI Repair，比较 OpenRouter 模型、Diagramly Prompt、异步 job 轮询和真实 conf-app UI 全链路的成功率、质量、延迟、token 与费用。用户说“对这份 DSL 进行修复测试统计”、要求比较 AI Repair 模型或复现分层修复性能时使用。
---

# AI Repair Benchmark

对同一份损坏 DSL 使用固定输入和模型矩阵，分层定位模型能力、Prompt 收益、后端开销和 UI 开销。默认模型：

- `openai/gpt-5.6-luna`
- `deepseek/deepseek-v4-flash`
- `google/gemini-2.5-flash`

默认运行完整矩阵：L1、L2 每模型 3 次，L3、L4 每模型 1 次。用户明确说 quick/smoke 时每层每模型 1 次。模型顺序按 trial 随机化并记录 seed；同一比较组保持 temperature、max tokens 和 reasoning 设置一致。manifest 未指定这些参数时继承本地 Diagramly `.env`，并把生效值写入逐次记录。

## 输入与授权

确定 DSL 文件、语言、Diagramly `diagramType` / `languageKey` / `subTypeKey`、解析错误和可选的必保留锚点。优先使用解析器的真实错误，不用笼统的 “syntax error”。

本流程会把完整 DSL 发给 OpenRouter。若 DSL 来自生产或可能含客户信息，先取得用户对“该 DSL → OpenRouter → 上述模型”的明确授权。默认把运行产物写入 `/tmp/ai-repair-benchmark/<run-id>/`；客户数据不得写入公开仓库。需要长期保存时写入 `private/` 子模块，并先检查隐私规则。

开始前检查两个仓库的 `git status`，不覆盖、不清理、不暂存已有改动。skill 本身不创建分支、不提交、不部署。

## 四层定义

| 层级 | 测试内容 | 隔离出的变量 |
|---|---|---|
| L1 Raw model | OpenRouter 模型 + 最小中立修复指令 + DSL + 真实错误 | 模型基础修复能力 |
| L2 Diagramly prompt | 同一模型 + 当前 checkout 的 Diagramly modify prompt、repair hints 和错误上下文；只调用一次 LLM | Prompt 带来的收益，不含 job/轮询 |
| L3 Async job | 本地 Diagramly `/api/chat/modify-async` + `/api/chat/job-status`，单次候选、校验、数据库 job 与轮询 | 后端、认证、队列、持久化与轮询开销 |
| L4 conf-app E2E | 当前已登录浏览器中的真实 Forge 宏，从错误 banner 点击 AI Repair，到 diff、Apply Code、错误消失和预览成功 | conf-app、Forge、Worker、ngrok、Diagramly 和 UI 的总体验 |

L3 直接调用 Diagramly API，模拟 conf-app 发出的 payload，但不经过 Forge Worker。不要把它描述为完整 conf-app 链路；完整链路只由 L4 证明。

## 执行

先读 [methodology.md](references/methodology.md)，创建 run manifest，并记录两个仓库的 HEAD、工作区状态、模型列表、reasoning、temperature、trial 数和 seed。

### L1 与 L2

1. 用 `scripts/build_diagramly_prompt.ts` 从当前 Diagramly checkout 生成 L2 的实际 messages 和 prompt hash。不要手抄 Prompt。
2. 用 `uv run scripts/run_openrouter_matrix.py` 分别运行 `raw` 和 `diagramly` 模式。请求必须包含 OpenRouter usage；保存 generation id、实际 provider、token、cache token 和实付 USD。费用优先采用响应或 generation API 的 `total_cost`，不得用静态价目表冒充实付费用。
3. 用 `uv run scripts/score_candidates.py` 做 no-op、语法、标识符保留率和改动比例检查。PlantUML 优先使用本机 `plantuml`，否则使用已存在的 `yuzutech/kroki` 镜像并断网校验；没有验证器时标为 `SKIPPED`，不能判 PASS。

脚本命令和 manifest 字段见 [methodology.md](references/methodology.md)。

### L3

读 [layer3.md](references/layer3.md)，按 `joint-debug` skill 启动或复用本地 Diagramly 与 PostgreSQL。运行 `uv run scripts/run_job_matrix.py`。脚本拒绝非 localhost 后端，除非用户另行明确授权远端测试。

job 输出当前提供 `durationMs`、`llmDurationMs`、attempts 和 model，但不提供 token/cost。将 L3/L4 的费用记为 `unavailable`；可以附上同模型 L2 中位费用作为 `estimated_from_l2`，必须明确标注估算，不能算入实付总额。

### L4

读 [layer4.md](references/layer4.md)，并遵循 `joint-debug` 与 `pvt-ai-repair` 的 UI 证据规则。必须复用用户当前浏览器中的登录标签页，不新开真实账号浏览器。逐模型设置 `localStorage.ai_repair_model`，每次恢复完全相同的损坏 DSL。

至少保存以下证据：错误 banner、请求开始时间、`fix-diagram` jobId、poll 次数与最终状态、diff 出现时间、Apply 后代码、错误消失、有效预览截图或 snapshot。没有 UI 证据时 L4 标为 `SKIPPED` 或 `FAIL`，单元测试和后端成功不能替代。

## 质量与统计

质量先过硬门槛：候选非空、非 no-op、语言解析/渲染成功。然后报告：

- identifier retention：原始标识符保留率；
- changed line ratio：修改行比例，只作范围指标，不直接惩罚必须批量修复的图；
- required anchors：用户提供的业务锚点是否全部保留；
- UI render：L4 的真实预览是否成功。

质量档：硬门槛失败=`FAIL`；通过且 retention ≥95%=`A`；≥80%=`B`；更低=`C / manual review`。若语言验证被跳过，质量为 `UNVERIFIED`。

汇总时按 model × layer 输出 success rate、p50/p95 wall time、p50 LLM time、prompt/completion/reasoning/cache tokens、实付费用、质量档分布和失败原因。排序顺序固定为：成功率 → 质量档 → p50 延迟 → 实付费用。不要生成隐藏权重的单一总分。

用 `uv run scripts/summarize_benchmark.py` 只生成一个自包含 HTML，并传入 run manifest。HTML 不引用外部脚本或资源，可直接交付和归档。默认的本地/私有报告必须显示本次输入 DSL 全文、类型、真实解析错误、行数、字符数和 SHA-256，让读者能确认修复对象；只有用户明确要求公开/脱敏版本时才使用 `--redact-dsl`。报告还必须区分 `measured`、`estimated_from_l2` 和 `unavailable` 费用，并注明样本量；单次结果不能描述为性能 SLA。

## 完成条件

- 四层每个计划中的模型都有 PASS、FAIL 或带原因的 SKIPPED；
- 每个候选都经过适用的解析/渲染检查；
- L4 有 UI 证据，或明确记录阻塞；
- 本地/私有报告包含输入 DSL 全文与身份信息（类型、错误、行数、字符数、SHA-256）、配置、样本量、逐次原始记录、聚合统计和费用来源；
- 不泄露 API key、Forge token 或真实租户信息；含客户 DSL 全文的报告只留在 `/tmp` 或 `private/`，不得写入公开仓库或公开分享。
