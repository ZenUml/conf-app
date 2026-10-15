# L3：本地版本化 AI Chat job

本层覆盖 Diagramly 的图绑定、team/credits、版本化异步 job、确定性语法校验和轮询；不经过 conf-app 的 Forge bridge。普通修改请求必须传非空 `command`，**不传 `errorMessage`**。脚本按 conf-app `functions/service/diagramlyService.js` 的类型映射把客户端 `mermaid` 转为后端 `flow`、`OpenAPI` 转为 `openapi`；变更映射时先同步脚本。真实路径见 Diagramly 的 `apps/web/app/api/chat/{ensure-diagram,modify-version-async,job-status}`。

准备：用 `joint-debug` skill 启动本地 Diagramly 与 PostgreSQL，确认 `DATABASE_URL` 指向 localhost，`GET /api/health?deep=1` 返回数据库 `up`。从 Diagramly 本地 `.env` 注入 `DIAGRAMLY_API_KEY`，不要打印。先用 `--dry-run` 核对输入 hash、模型和 URL；脚本默认拒绝非本地主机。

```bash
pnpm exec dotenv -c -- uv run \
  ../conf-app/.claude/skills/ai-chat-case-validation/scripts/run_versioned_job.py \
  --manifest /absolute/private/local-data/ai-chat-regression/cases/<id>/manifest.json \
  --output-dir /absolute/private/local-data/ai-chat-regression/runs/<run-id>/l3 \
  --dry-run
```

移除 `--dry-run` 才实际创建本地图和 job、调用模型。默认模型从 conf-app `DEFAULT_AI_CHAT_MODEL` 读取；若 manifest 指定其他模型，应在结果中明确标注。脚本将完整响应写到私有输出目录，终端仅显示状态、hash 与路径。每例默认一次调用；重试需单独占用预算并保留旧试次。

脚本的 `technicalStatus: PASS` 只覆盖返回、无 job Error、候选非空，以及预期修改时的版本与非 no-op。还要检查适用语言的解析和真实渲染、指令满足与保留条款，才能判本层完整 PASS。`noChange: true` 只按案例的明确预期判定。`FAILED`、`CANCELLED`、超时、缺少输出或版本都是本层失败或环境阻塞，不能用模型原始响应替代 job 结果。保留 jobId、轮询次数、wall time、backend duration 与错误，但不向公开输出泄露原文。
