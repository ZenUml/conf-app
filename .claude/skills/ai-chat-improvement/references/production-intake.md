# 普通 AI Chat 线上取数

先读 Diagramly `scripts/db-access.md`，核对当前连接确实指向预期生产库、只读账号或只读事务、UTC 时间窗口和查询超时。以下 SQL 是按当前版本化 job 结构的候选筛选，运行前仍须核对实时 schema。`Job.input`/`output` 存储 JSON，可能含客户图和完整指令；初次只返回聚合数字。

```sql
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '60s';
WITH scoped AS (
  SELECT j.status::text AS status,
         j.input->>'languageKey' AS language,
         j.input->>'diagramCode' AS dsl,
         j.input->>'command' AS command,
         j.output->>'noChange' AS no_change
  FROM "Job" AS j
  WHERE j.type = 'diagram_modification'
    AND j."createdAt" >= TIMESTAMPTZ '<start-utc>'
    AND j."createdAt" < TIMESTAMPTZ '<end-utc>'
    AND NULLIF(BTRIM(j.input->>'diagramId'), '') IS NOT NULL
    AND NULLIF(BTRIM(j.input->>'diagramCode'), '') IS NOT NULL
    AND NULLIF(BTRIM(j.input->>'command'), '') IS NOT NULL
    AND NULLIF(BTRIM(COALESCE(j.input->>'errorMessage', '')), '') IS NULL
)
SELECT COUNT(*) FILTER (WHERE status = 'FAILED') AS failed_jobs,
       COUNT(DISTINCT (language, dsl, command)) FILTER (WHERE status = 'FAILED')
         AS distinct_failed_requests,
       COUNT(*) FILTER (WHERE status = 'COMPLETED' AND no_change = 'true')
         AS no_change_review_candidates
FROM scoped;
COMMIT;
```

这只是 **版本化普通修改候选**：Diagramly 原生页面也可能调用同一路由。只有核对可信的外部 team/user 映射后，才能称为 conf-app 流量；`Job.source = api` 不是充分证明。内部测试与客户记录也须用已验证的身份清单区分，不能凭域名外观猜测。计数同时注明窗口、时区、查询时间、过滤条件和身份核对结果；`no_change_review_candidates` 不等于失败数。

用户选定上限后，在私有目录分页导出所需 job 的 `id/createdAt/status/input/output/error`，用 `(createdAt,id)` 游标限量，不把原始行打印到终端。检查导出完整性和 JSON 可解析性；记录检索条件、筛选数量和未覆盖量。来源若只有前端错误事件、没有对应 job，记录为链路证据缺口，不能推测其 DSL 或指令。

优先收录有明确用户报告的错误结果和 `FAILED` job；对 `COMPLETED`、版本已创建、但用户撤销或报告改错的案例，必须先核实指令语义和原图/输出。`ai_chat_change_*` 事件的触发点随实现可能更名，取数前读取当前 catalog 与面板代码；成功事件只反映其定义的客户端状态，不是用户满意、接受或 Confluence 持久化证明。
