# L4：conf-app Forge UI E2E

L4 是唯一覆盖真实 conf-app → Forge bridge → Cloudflare Worker → Diagramly job → UI apply/render 的层级。

## 浏览器与环境

- 按 `joint-debug` skill 启动并验证五服务栈；除非用户明确要求，不执行 Forge upgrade。
- 先枚举当前浏览器标签页，再接管用户已经登录并打开的目标页；不要调用 create/open 创建真实账号浏览器、tab 或新 session。
- 使用当前环境中既能接管该 tab、又能进入 Forge OOPIF 的浏览器工具。若唯一可用方案会新建浏览器 session，L4 标为 `SKIPPED` 并记录 blocker，不得绕过用户的当前浏览器约束。
- 使用 Diagramly 开发宏，确认 moduleKey、Forge tunnel 和 Vite `PRODUCT_TYPE=diagramly` 一致。

## 每个模型的流程

1. 在宏编辑器恢复 manifest 指定的完全相同损坏 DSL。
2. 在宏 iframe 中设置 `localStorage.ai_repair_model` 为当前模型；记录设置后的值。测试完成后恢复原值。
3. 等待真实 syntax error banner 和 AI Repair 按钮。
4. 开始网络/console 证据采集，记录点击 AI Repair 的时间。
5. 要求 `/diagramly/fix-diagram` 成功并返回 jobId；统计 `/diagramly/job-status` polling 次数和最终状态。
6. 记录 diff 首次可见时间。候选必须通过适用解析器；检查 required anchors。
7. 点击 Apply Code，等待 banner 消失和预览成功；保存截图或 snapshot。
8. 下一模型前重新写入原始损坏 DSL。不要让上一模型输出成为下一模型输入。

默认只保存在宏草稿中，不点击 Confluence 页面级 Publish。若测试必须验证发布态，先确认用户已经授权发布测试页。

## 时间点

- `uiStartToDiffMs`：点击 AI Repair → diff 可见；
- `uiApplyToRenderMs`：点击 Apply → 错误消失且预览有效；
- `uiTotalMs`：点击 AI Repair → 预览有效；
- backend `durationMs` / `llmDurationMs`：从最终 job output 或网络响应读取；
- `proxyOverheadMs = uiStartToDiffMs - backendDurationMs`，仅当两个时钟覆盖同一请求且值非负时计算。

## 证据和失败

每模型至少保留：错误态、diff 态、Apply 后有效预览，以及网络 path/status/timestamp。不要保存 authorization headers 或客户 DSL 请求体。

UI 无法驱动、宏不存在或登录态失效时标 `SKIPPED` 并写 blocker。不能用 L3 结果替代 L4 PASS。

## L4 记录

每个模型向 `l4/results.jsonl` 写一条记录。PASS 记录至少包含：

```json
{
  "id": "L4-1-google_gemini-2.5-flash",
  "runId": "<run-id>",
  "layer": "L4",
  "model": "google/gemini-2.5-flash",
  "trial": 1,
  "status": "COMPLETED",
  "repairStatus": "PASS",
  "qualityGrade": "A",
  "syntaxValid": true,
  "renderValid": true,
  "identifierRetention": 1.0,
  "changedLineRatio": 0.02,
  "wallMs": 12345,
  "uiStartToDiffMs": 10000,
  "uiApplyToRenderMs": 2345,
  "backendDurationMs": 9000,
  "llmMs": 8000,
  "pollCount": 9,
  "promptTokens": null,
  "completionTokens": null,
  "reasoningTokens": null,
  "cachedTokens": null,
  "costUsd": null,
  "costProvenance": "unavailable_job_output",
  "evidencePaths": ["/absolute/path/error.png", "/absolute/path/final.png"]
}
```

`SKIPPED` 记录保留计划中的 model/trial，设置 `repairStatus: "SKIPPED"`、`qualityGrade: "UNVERIFIED"`，并在 `error` 写明 blocker。报告将 coverage 与成功率分开，环境阻塞不会冒充模型修复失败。
