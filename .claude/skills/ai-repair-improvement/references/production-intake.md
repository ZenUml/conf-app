# 线上取数与私有入库

## 证据来源

- conf-app 的 src/utils/analytics/catalog.ts / types.ts：ai_repair_requested、succeeded、failed、applied 只提供生命周期、模型、失败阶段等封闭属性；不含 DSL、原始错误或 jobId。Mixpanel 项目和查询方法见 .claude/skills/mixpanel/SKILL.md 与 docs/analytics/reference.md。用它确定时间窗口、产品变体和失败范围，不能从事件数推断一一对应的后端 job。
- Diagramly 的 packages/database/prisma/schema.prisma：Job.type = diagram_modification 是修复路径。input 的已观察字段有 diagramCode、errorMessage、diagramType、languageKey、subTypeKey、model；output 可含 diagramCode、repairAttempts 等。以运行时 schema 与记录为准，字段缺失要显式标注。
- diagramly.ai/scripts/db-access.md 和 scripts/db.sh：生产是 Neon main 分支。优先只读账号；在只读事务中设置超时，限定 UTC 时间窗口和分页大小。只允许 SELECT，不运行 Prisma 写入、迁移、Studio 更改或 db push。不要打印连接串或将原始查询结果写到终端日志。
- 已有私有样例：private/local-data/ai-repair-2026-10-10/ 和 private/local-data/ai-repair-regression/。前者的 production-jobs.json、failure-index.json、mixpanel-evidence.json 说明过一次取数、分类与核对；这些是历史快照，不证明今天的生产状态。

## 先统计数量

用户指定起止时间和时区后，换算为 UTC 的左闭右开窗口。若没有时间范围，先只问时间；若生产只读连接失败，报告 BLOCKED 和原因，不从旧快照或 Mixpanel 猜当前 DSL 数。先运行仅返回聚合数字的查询，**再问处理上限和授权**。确认当前连接确实指向生产、事务为只读；不导出 input / output。

~~~sql
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '60s';
WITH scoped AS (
  SELECT j.status::text AS status,
         COALESCE(j.input->>'languageKey',
                  j.input->>'diagramType', 'unknown') AS language,
         j.input->>'diagramCode' AS dsl,
         j.output->>'diagramCode' AS candidate
  FROM "Job" AS j
  WHERE j.type = 'diagram_modification'
    AND j."createdAt" >= TIMESTAMPTZ '<window-start-utc>'
    AND j."createdAt" < TIMESTAMPTZ '<window-end-utc>'
    AND NULLIF(j.input->>'diagramCode', '') IS NOT NULL
    AND j.status IN ('FAILED', 'COMPLETED')
), classified AS (
  SELECT *,
         status = 'FAILED' AS failed,
         status = 'COMPLETED'
           AND (
             NULLIF(BTRIM(candidate), '') IS NULL
             OR BTRIM(REPLACE(candidate, E'\r\n', E'\n'))
                = BTRIM(REPLACE(dsl, E'\r\n', E'\n'))
           ) AS completed_empty_or_noop
  FROM scoped
)
SELECT COUNT(*) FILTER (WHERE failed) AS failed_jobs,
       COUNT(DISTINCT (language, dsl)) FILTER (WHERE failed)
         AS distinct_failed_dsls,
       COUNT(*) FILTER (WHERE completed_empty_or_noop)
         AS completed_empty_or_noop_jobs,
       COUNT(DISTINCT (language, dsl))
         FILTER (WHERE failed OR completed_empty_or_noop)
         AS distinct_known_failure_dsls
FROM classified;
COMMIT;
~~~

运行时可用 Diagramly 的 scripts/db.sh psql main 将以上 SQL 输入 psql；只把聚合值展示给用户，并同时写明窗口、时区、全部租户或已验证的特定范围、查询时刻。这里的“份数”按语言 + 原始 DSL 去重，job 次数另报。缺少 errorMessage 的失败 job 仍计入，但后续案例标记错误证据缺失，不补造错误。COMPLETED 但输出为其他无效语法的案例要在后续解析/渲染中发现，所以初始数字是已识别失败数，不保证覆盖所有假成功。若查询口径与后续入库筛选不同，分别报告而不要混成一个数字。

## 查询与筛选

先检查当前数据库表结构、目标环境身份和只读状态。以下是从 Diagramly 仓库执行的 psql 模板。先建立仅本机可读的目标目录，将绝对输出路径和 UTC 时间窗口替换为本轮值；psql 的输出文件只接收 JSONL 查询结果，终端只显示非敏感的事务状态。不要调用会把连接串或原始行打印到终端的 url/q 子命令。

~~~text
scripts/db.sh psql main <<'SQL'
\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '60s';
SELECT current_database(), current_user,
       current_setting('transaction_read_only');
\pset format unaligned
\pset tuples_only on
\o /absolute/private/local-data/ai-repair-regression/import/jobs-page.jsonl
SELECT row_to_json(r)::text FROM (
  SELECT j.id, j."createdAt", j.status, j.input, j.output,
         j.error, j.message
  FROM "Job" AS j
  WHERE j.type = 'diagram_modification'
    AND j."createdAt" >= TIMESTAMPTZ '<window-start-utc>'
    AND j."createdAt" < TIMESTAMPTZ '<window-end-utc>'
    AND NULLIF(j.input->>'diagramCode', '') IS NOT NULL
    AND j.status IN ('FAILED', 'COMPLETED')
  ORDER BY j."createdAt" DESC, j.id DESC
  LIMIT <bounded-page-size>
) AS r;
\o
COMMIT;
SQL
~~~

如果环境需要使用只读账号或当前 neonctl 会话指向错误项目，先按 scripts/db-access.md 修正目标；不能把不明数据库当作生产。查询文件可能含客户完整 DSL，处理时只输出计数、hash、字段名和匿名案例 ID。检查退出码、JSONL 每行可解析和查询窗口；失败或半截文件不可入库。按 (createdAt, id) 游标翻页，直到得到用户允许的案例数或窗口穷尽；不要只用 LIMIT N 就声称得到了 N 份不同 DSL。

确认为生产后，依据已验证的内部测试账号/租户名单排除内部数据；不能凭域名外观或 Mixpanel 缺失事件推定客户身份。必要时在私有落盘查询中增加 User / Team 关联字段，别把身份字段打印出来。保留 FAILED 的原始输入，也检查 COMPLETED 的 output.diagramCode 是否空、去首尾空白/规范换行后与输入相同，或在当前解析器/浏览器中仍失败。后两类记录为“疑似假成功”，保留验证证据，不凭 SQL 文本比较断言语义正确。客户端 ai_repair_failed 却无对应 Job 时记为取数缺口，不能凭 Session Replay 重建 DSL。

## 入库约定

默认根目录：<conf-app>/private/local-data/ai-repair-regression/。先确认该路径不会被 Git 纳入提交；不要初始化或提交 private 子模块来保存客户图内容。每个案例目录至少有：

~~~text
cases/<opaque-case-id>/
  input.<dsl-extension>       原始 DSL，完整且不可改写
  errors.json                 一个或多个真实错误及其来源尝试
  source.json                 来源 job、UTC 时间、状态、模型、语言、输入 SHA-256
  manifest.json               供 ai-repair-case-validation 使用的相对路径
  attempts/                   各次候选、响应、评分和版本；只追加
  l4/                         UI 证据与最终预览
~~~

opaque-case-id 用语言、输入哈希和错误哈希导出，避免客户名称；同一 DSL 多次失败时合并来源列表，但不同错误不能丢失。corpus.json 记录案例路径、状态、来源摘要、首次/最近观察时间和下一步；更新时保留已有条目。不要在公有文件、任务标题、PR 或聊天正文粘贴完整客户 DSL、租户名、账号 ID、请求头或密钥。原始输入与最终修复分别保存，永远不把最终修复覆盖为新的“原始”回归输入。
