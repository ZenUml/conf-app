# L2：普通修改指令与产品 Prompt

案例 manifest 使用 [案例格式](case-format.md)，`command` 为真实用户指令，`errorMessage` 缺失。运行前读取 conf-app `DEFAULT_AI_CHAT_MODEL`，把该模型写入私有 manifest 的 `models` 数组；强制只选该模型、一次 trial。若测试本地覆盖模型，单独记录来源，不拿覆盖模型结果替代默认模型。先记录两个 checkout 的 HEAD/脏状态。

从 Diagramly checkout 运行，使用当前服务相同的本地 `.env`。以下路径示例仅是私有目录占位，运行时换成现存绝对路径：

```bash
pnpm exec dotenv -c -- pnpm exec tsx --tsconfig scripts/tsconfig.json \
  ../conf-app/.claude/skills/ai-repair-benchmark/scripts/build_diagramly_prompt.ts \
  --manifest /absolute/private/local-data/ai-chat-regression/cases/<id>/manifest.json \
  --output /absolute/private/local-data/ai-chat-regression/runs/<run-id>/messages.json \
  --diagramly-path "$PWD"

pnpm exec dotenv -c -- uv run \
  ../conf-app/.claude/skills/ai-repair-benchmark/scripts/run_openrouter_matrix.py \
  --manifest /absolute/private/local-data/ai-chat-regression/cases/<id>/manifest.json \
  --mode diagramly \
  --messages /absolute/private/local-data/ai-chat-regression/runs/<run-id>/messages.json \
  --model <current-default-ai-chat-model> --trials 1 \
  --output-dir /absolute/private/local-data/ai-chat-regression/runs/<run-id>/l2
```

先为模型调用命令加 `--dry-run` 核对输入 hash、模型、参数和 Prompt hash。正式调用前核对本轮外部服务、数据发送和预算授权。runner 当前使用 OpenRouter；它不是 Diagramly 服务内部的 provider fallback 和质量重试，因此 L2 只回答“当前 Prompt 下单次模型输出是否合格”，L3 再验证产品 job。若产品 Prompt 或消息拼装实现变更，核对构建器和 Diagramly `packages/core/ai/services/ai-diagram-service.ts`、`packages/core/ai/prompts/builder.ts` 一致；不一致就先修构建器。

用既有 `score_candidates.py` 检查候选非空、语法和 `requiredAnchors`，再做适用语言的**实际渲染**与 `requiredEffects`/`forbiddenEffects` 人工核对。`score_candidates.py` 的 `repairStatus` 名称仅来自复用脚本，不能直接当 AI Chat 语义结论。预期 `change` 时，原文返回是 FAIL；预期 `no_change` 时，只有已标注的指令本来满足、输出无 Error 且保持图表有效才可通过，不沿用脚本的 no-op FAIL 判定。保存响应、候选、验证结果和 Prompt hash，不把客户正文打印到终端。
