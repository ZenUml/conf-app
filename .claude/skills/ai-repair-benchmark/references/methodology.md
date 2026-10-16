# L1/L2 方法与命令

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
  "models": ["openai/gpt-5.6-luna", "anthropic/claude-sonnet-5"],
  "requiredAnchors": [],
  "temperature": 0.2,
  "maxTokens": 10000,
  "seed": 20260919
}
```

不要把 DSL 内容复制进 manifest。记录两个仓库的 HEAD、工作区状态、Prompt hash、模型参数、trial 数和 seed；不同 Prompt 或代码版本的结果不直接合并。`temperature`、`maxTokens`、`reasoningDisabled` 可省略，L1/L2 继承 Diagramly `.env` 的 `AI_TEMPERATURE`、`AI_MAX_TOKENS`、`AI_DISABLE_REASONING`。同一比较组固定有效参数。

## 生成 L2 Prompt

从 Diagramly checkout 运行，加载与本地服务相同的 `.env`：

```bash
pnpm exec dotenv -c -- pnpm exec tsx --tsconfig scripts/tsconfig.json \
  ../conf-app/.claude/skills/ai-repair-benchmark/scripts/build_diagramly_prompt.ts \
  --manifest /tmp/ai-repair-benchmark/<run-id>/manifest.json \
  --output /tmp/ai-repair-benchmark/<run-id>/diagramly-messages.json \
  --diagramly-path "$PWD"
```

输出包含实际 messages、prompt hash、Diagramly commit、Prompt/预处理 hook 源文件 hash 和 cache-control 设置。生成失败时不得退回手写近似 Prompt。

## 单模型、单层调用

先用相同命令加 `--dry-run` 检查计划。以下在 Diagramly checkout 中运行，示例只调用 Luna 一次；更换 `--model` 和独立输出目录测试其他模型。每次调用后先评分，再进行下一次模型请求。真实调用会发送完整 DSL 到 OpenRouter，不打印 key。

```bash
pnpm exec dotenv -c -- uv run \
  ../conf-app/.claude/skills/ai-repair-benchmark/scripts/run_openrouter_matrix.py \
  --manifest /tmp/ai-repair-benchmark/<run-id>/manifest.json \
  --mode raw --model openai/gpt-5.6-luna --trials 1 \
  --output-dir /tmp/ai-repair-benchmark/<run-id>/l1-luna

pnpm exec dotenv -c -- uv run \
  ../conf-app/.claude/skills/ai-repair-benchmark/scripts/run_openrouter_matrix.py \
  --manifest /tmp/ai-repair-benchmark/<run-id>/manifest.json \
  --mode diagramly \
  --messages /tmp/ai-repair-benchmark/<run-id>/diagramly-messages.json \
  --model openai/gpt-5.6-luna --trials 1 \
  --output-dir /tmp/ai-repair-benchmark/<run-id>/l2-luna
```

每条命令后立即用下述评分命令，把 `--results` 和 `--output` 指向该次调用的目录：

```bash
uv run .claude/skills/ai-repair-benchmark/scripts/score_candidates.py \
  --manifest /tmp/ai-repair-benchmark/<run-id>/manifest.json \
  --results /tmp/ai-repair-benchmark/<run-id>/l1-luna/results.jsonl \
  --diagramly-path ../diagramly.ai \
  --output /tmp/ai-repair-benchmark/<run-id>/l1-luna/scored.jsonl
```

评分脚本的 `repairStatus: PASS` 只表示其确定性语法检查通过。汇总前还要为适用语言检查实际渲染，并核对 `missingRequiredAnchors`；Mermaid 的 Node 确定性 parser 结果不能替代浏览器中的 Mermaid parse/render。将已观察到的渲染结果写入逐次记录的 `renderValid`，并在 `evidencePaths` 留证；缺少该字段时汇总器会标为 `UNVERIFIED/SKIPPED`，不能称为完整修复通过。

每个 trial 只允许一次模型请求，网络失败单独记录，不在客户端悄悄重试。若仅修复响应提取逻辑，使用 `--reparse-only` 从保存的 response JSON 离线重建候选，不重复付费调用。中断后使用 `--resume`，保留中断记录，不覆盖既有结果。记录实际 provider、generation id、prompt/completion/reasoning/cache tokens 和费用来源；缓存命中在原始速度分析中单列。

## 汇总

把实际执行的 L1/L2 scored JSONL 分别传入；不要传入 L3/L4：

```bash
uv run .claude/skills/ai-repair-benchmark/scripts/summarize_benchmark.py \
  --manifest /tmp/ai-repair-benchmark/<run-id>/manifest.json \
  --input /tmp/ai-repair-benchmark/<run-id>/l1-luna/scored.jsonl \
  --input /tmp/ai-repair-benchmark/<run-id>/l2-luna/scored.jsonl \
  --html /tmp/ai-repair-benchmark/<run-id>/report.html
```

其余模型的 scored 文件也逐个添加 `--input`。本地/私有报告默认展示输入 DSL 全文、图类型、真实错误、行数、字符数和 SHA-256；只有用户明确要求公开/脱敏时才加 `--redact-dsl`。报告注明每组 n；n 很小时 p95 不能说明稳定性能。
