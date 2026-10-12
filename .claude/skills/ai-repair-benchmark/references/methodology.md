# 方法与命令

## Run manifest

在 `/tmp/ai-repair-benchmark/<run-id>/manifest.json` 保存：

```json
{
  "dslPath": "/absolute/path/input.dsl",
  "errorMessage": "real parser error",
  "diagramType": "mermaid",
  "languageKey": "LANG_MERMAID",
  "subTypeKey": "GENERAL",
  "command": "Please fix the reported error and change nothing else.",
  "models": [
    "openai/gpt-5.6-luna",
    "deepseek/deepseek-v4-flash",
    "google/gemini-2.5-flash"
  ],
  "requiredAnchors": [],
  "temperature": 0.2,
  "maxTokens": 10000,
  "seed": 20260919
}
```

不要把 DSL 内容复制进 manifest。报告使用文件 SHA-256、字符数和行数标识输入。

`temperature`、`maxTokens`、`reasoningDisabled` 都可省略：L1/L2 会继承 Diagramly `.env` 的 `AI_TEMPERATURE`、`AI_MAX_TOKENS`、`AI_DISABLE_REASONING`；L3/L4 不显式覆盖 reasoning。若 manifest 指定 `reasoningDisabled`，四层必须保持相同设置。

## 生成 L2 Prompt

从 Diagramly checkout 运行，并加载与本地服务相同的 `.env`，使 `AI_PROMPT_CACHE` 行为一致：

```bash
pnpm exec dotenv -c -- pnpm exec tsx --tsconfig scripts/tsconfig.json \
  ../conf-app/.claude/skills/ai-repair-benchmark/scripts/build_diagramly_prompt.ts \
  --manifest /tmp/ai-repair-benchmark/<run-id>/manifest.json \
  --output /tmp/ai-repair-benchmark/<run-id>/diagramly-messages.json \
  --diagramly-path "$PWD"
```

输出含 messages、prompt hash、Diagramly commit、Prompt/预处理 hook 源文件 hash和 cache-control 设置。L2 必须使用这个输出；Prompt 生成失败时不允许退回手写近似版本。

## L1/L2 模型矩阵

在 Diagramly checkout 中用 `.env` 注入 OpenRouter 配置，但不要打印变量值：

```bash
pnpm exec dotenv -c -- uv run \
  ../conf-app/.claude/skills/ai-repair-benchmark/scripts/run_openrouter_matrix.py \
  --manifest /tmp/ai-repair-benchmark/<run-id>/manifest.json \
  --mode raw \
  --trials 3 \
  --output-dir /tmp/ai-repair-benchmark/<run-id>/l1

pnpm exec dotenv -c -- uv run \
  ../conf-app/.claude/skills/ai-repair-benchmark/scripts/run_openrouter_matrix.py \
  --manifest /tmp/ai-repair-benchmark/<run-id>/manifest.json \
  --mode diagramly \
  --messages /tmp/ai-repair-benchmark/<run-id>/diagramly-messages.json \
  --trials 3 \
  --output-dir /tmp/ai-repair-benchmark/<run-id>/l2
```

先用 `--dry-run` 检查路径、模型和计划。实际调用会发送完整 DSL 到 OpenRouter。

若只修改了响应提取逻辑，用原命令加 `--reparse-only` 从保存的 `response-*.json` 离线重建候选；不得为解析器修正重复付费调用模型。

runner 中断后用原命令加 `--resume`，按已存在的 record id 跳过完成项并追加剩余计划。中断中的请求需先写成 `INTERRUPTED` 记录，不能悄悄重跑并覆盖。

## 验证候选

L3 完成后一次验证 L1/L2/L3 的全部候选：

```bash
uv run .claude/skills/ai-repair-benchmark/scripts/score_candidates.py \
  --manifest /tmp/ai-repair-benchmark/<run-id>/manifest.json \
  --results /tmp/ai-repair-benchmark/<run-id>/l1/results.jsonl \
  --results /tmp/ai-repair-benchmark/<run-id>/l2/results.jsonl \
  --results /tmp/ai-repair-benchmark/<run-id>/l3/results.jsonl \
  --diagramly-path ../diagramly.ai \
  --output /tmp/ai-repair-benchmark/<run-id>/scored-l123.jsonl
```

## 结果 schema

每次 trial 至少含：

```text
runId, layer, model, trial, status, wallMs, llmMs, pollCount,
promptTokens, completionTokens, reasoningTokens, cachedTokens, totalTokens,
costUsd, costProvenance, generationId, provider,
syntaxValid, renderValid, noOp, identifierRetention, changedLineRatio,
qualityGrade, error, candidatePath, evidencePaths
```

原始模型回复可保存在 run 目录供排查。默认的本地/私有报告必须展示本次输入 DSL 全文，便于确认比较对象；包含客户 DSL 的报告不得进入公开仓库或公开分享。

## 汇总

把 L1/L2/L3 scored JSONL 和按 UI 证据整理的 L4 results.jsonl 一起传入：

```bash
uv run .claude/skills/ai-repair-benchmark/scripts/summarize_benchmark.py \
  --manifest /tmp/ai-repair-benchmark/<run-id>/manifest.json \
  --input /tmp/ai-repair-benchmark/<run-id>/scored-l123.jsonl \
  --input /tmp/ai-repair-benchmark/<run-id>/l4/results.jsonl \
  --html /tmp/ai-repair-benchmark/<run-id>/report.html
```

汇总阶段只交付这个自包含 HTML，不另外生成 Markdown 或 CSV。报告默认从 manifest 的 `dslPath` 读取并嵌入完整 DSL，同时显示类型、真实解析错误、行数、字符数和 SHA-256。只有用户明确要求生成公开/脱敏版本时才加 `--redact-dsl`；不得用脱敏报告替换用户要求的 full-code 报告。

## 可比性规则

- L1 与 L2 固定同一模型参数。`reasoningDisabled` 未指定时，L1/L2 继承 `AI_DISABLE_REASONING`，L3/L4 沿用应用默认；指定时四层使用同一值，并在 L4 证据中确认请求 payload。
- 每个 trial 只允许一次模型请求，不在客户端偷偷重试。网络失败单独记录。
- 模型顺序每轮打乱，避免把时间段抖动固定给同一个模型。
- 缓存 token 和 provider 必须记录。缓存命中是实际系统表现，但在模型原始速度分析中单列。
- Prompt 或代码 commit 不同的 run 不直接合并。
- p95 在样本量小于 5 时仍可显示，但必须同时显示 n，不能据此下稳定性结论。
