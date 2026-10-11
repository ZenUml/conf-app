# L3：Diagramly 异步 Job

L3 测试本地 Diagramly API 的认证、credits、job 创建、后台处理、确定性校验、数据库状态和 polling。它模拟 conf-app 的请求 payload，但不经过 Forge Worker。

## 前置条件

- 按 `joint-debug` skill 使用本地 PostgreSQL；`DATABASE_URL` 必须指向 localhost/127.0.0.1。
- `GET http://127.0.0.1:3000/api/health?deep=1` 必须返回 `db: "up"`。
- 从 Diagramly `.env` 注入 `DIAGRAMLY_API_KEY`；不得打印。
- `x-external-id` 和 `x-team-id` 默认由输入 hash 派生，保证本地样本相互隔离；manifest 可用 `externalTeamId` 显式覆盖团队 ID。
- 默认后端必须是 `http://127.0.0.1:3000` 或 `http://localhost:3000`。远端运行需要用户单独授权。

## 命令

```bash
pnpm exec dotenv -c -- uv run \
  ../conf-app/.claude/skills/ai-repair-benchmark/scripts/run_job_matrix.py \
  --manifest /tmp/ai-repair-benchmark/<run-id>/manifest.json \
  --output-dir /tmp/ai-repair-benchmark/<run-id>/l3
```

默认每模型一次、1 秒 polling、135 秒 deadline。脚本先做 health check，再逐模型串行创建 job。使用基于输入 hash 的本地 benchmark external id，不输出 key。

## 判断

- 创建响应必须有非空 jobId；
- 至少一次 job-status polling；
- 最终状态必须为 COMPLETED 且有 diagramCode；
- FAILED/CANCELLED/timeout 都保留最后 output 和错误；
- 使用与 L1/L2 相同的候选验证规则；
- wall time、后端 duration、LLM duration、poll count 分开报告。

当前 job schema 不暴露 OpenRouter generation id、tokens 或 cost。不要根据静态价格计算“实付费用”。可展示对应 L2 的费用中位数作为估算，并标为 `estimated_from_l2`。
