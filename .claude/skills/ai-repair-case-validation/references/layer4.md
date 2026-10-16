# L4：conf-app Forge UI E2E

L4 是唯一覆盖真实 conf-app → Forge bridge → Cloudflare Worker → Diagramly job → UI apply/render 的层级。

## 浏览器与环境

- 按 `joint-debug` skill 启动并验证五服务栈；除非用户明确要求，不执行 Forge upgrade。
- 先枚举当前浏览器标签页，再接管用户已经登录并打开的目标页；不要调用 create/open 创建真实账号浏览器、tab 或新 session。
- 使用当前环境中既能接管该 tab、又能进入 Forge OOPIF 的浏览器工具。无法操作当前浏览器时，按项目指令改用 Codex 内置浏览器并切换到标准桌面视口；两者都不可用时标为 `SKIPPED` 并记录 blocker。
- 使用 Diagramly 开发宏，确认 moduleKey、Forge tunnel 和 Vite `PRODUCT_TYPE=diagramly` 一致。

## 模型选择与 UI 流程

1. 在宏编辑器恢复 manifest 指定的完全相同损坏 DSL。
2. 从 `src/utils/aiModelConfig.ts` 读取 `DEFAULT_AI_REPAIR_MODEL` 和 `AI_REPAIR_MODEL_STORAGE_KEY`。保存该 localStorage 键的原值。默认测试时临时移除该键，使首次修复走产品默认模型；明确指定其他模型时，将该键临时设为待测模型。测试结束后按原值恢复。若 localStorage 不可访问，记录情况并通过实际请求确认模型。
3. 等待真实 syntax error banner 和 AI Repair 按钮。
4. 开始网络/console 证据采集，记录点击 AI Repair 的时间。
5. 要求 `/diagramly/fix-diagram` 请求中的模型等于本次待测模型、请求成功并返回 jobId；统计 `/diagramly/job-status` polling 次数和最终状态。
6. 记录 diff 首次可见时间。候选必须通过适用解析器；检查 required anchors。
7. 点击 Apply Code，等待 banner 消失和预览成功；保存截图或 snapshot。
8. 默认流程不点击强模型重试。若用户明确要求验证重试按钮交互，另行记录实际 UI 操作和请求模型；该模型仍须先通过自己的 L2/L3 门槛。无论本轮结果如何，都恢复步骤 2 保存的 localStorage 原值。

默认只保存在宏草稿中，不点击 Confluence 页面级 Publish。若测试必须验证发布态，先确认用户已经授权发布测试页。

## 时间点

- `uiStartToDiffMs`：点击 AI Repair → diff 可见；
- `uiApplyToRenderMs`：点击 Apply → 错误消失且预览有效；
- `uiTotalMs`：点击 AI Repair → 预览有效；
- backend `durationMs` / `llmDurationMs`：从最终 job output 或网络响应读取；
- `proxyOverheadMs = uiStartToDiffMs - backendDurationMs`，仅当两个时钟覆盖同一请求且值非负时计算。

## 证据和失败

本轮至少保留：错误态、diff 态、Apply 后有效预览，以及网络 path/status/timestamp 和实际请求模型。不要保存 authorization headers 或客户 DSL 请求体。

UI 无法驱动、宏不存在或登录态失效时标 `SKIPPED` 并写 blocker。不能用 L3 结果替代 L4 PASS。

## L4 记录

每个明确执行的模型向 `l4/results.jsonl` 写一条记录。PASS 记录至少包含：

```json
{
  "id": "L4-1-selected-model",
  "runId": "<run-id>",
  "layer": "L4",
  "model": "<selected model>",
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
