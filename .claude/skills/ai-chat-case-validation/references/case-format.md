# 普通 AI Chat 案例格式

每轮从不变的案例 manifest 派生运行 manifest，写入本轮默认模型和布尔型 `reasoningDisabled`；L1（若执行）、L2、L3、L4 共用该生效值，不能把它当作只属于 AI Repair 的配置。

一个案例固定 `原图代码 + 用户指令 + 预期结果`，不能只按 DSL 去重。同一张图的两条不同指令是两个案例。客户数据只存在本机私有目录：`private/local-data/ai-chat-regression/cases/<opaque-id>/`；临时诊断可放 `/tmp/ai-chat-case-validation/<run-id>/`。不要把目录加入 public repo 或提交 private 子模块。

```text
cases/<opaque-id>/
  input.mmd                 原始 DSL，保留原字节
  manifest.json             运行参数和人工验收要求
  source.json               来源 job、时间、状态、模型及字段缺口
  attempts/                 每次响应、候选、评分和代码版本，只追加
  l4/                       UI 与网络证据
```

`manifest.json` 示例只使用合成内容，实际客户指令可能包含敏感信息，不得复制到公开文档：

```json
{
  "dslPath": "input.mmd",
  "diagramType": "mermaid",
  "languageKey": "LANG_MERMAID",
  "subTypeKey": "FLOWCHART",
  "command": "Add a retry path after validation fails.",
  "expectedOutcome": "change",
  "requiredEffects": ["A failed validation reaches Retry"],
  "requiredAnchors": ["Validate", "Success"],
  "forbiddenEffects": ["The success path is removed"]
}
```

- `command` 必须是用户实际提交的完整指令；`errorMessage` 必须缺失或为空。语法错误驱动的 AI Chat 请求需另建流程，不当作普通修改案例；旧 `/fix-diagram` 入口才使用 AI Repair 案例。
- `expectedOutcome` 通常为 `change`；只有证据表明原图已经满足指令时才用 `no_change`。`requiredEffects` 和 `forbiddenEffects` 是人工语义判定条款，不得把字符串搜索冒充语义检查；`requiredAnchors` 是可机械检查的最低保留项。
- L2 runner 使用前，从当前 `DEFAULT_AI_CHAT_MODEL` 读取默认值并把真实模型写入私有 manifest 的 `models`；示例刻意省略它，避免把示例模型当作产品默认。L3 runner 则直接从产品配置读取默认值。
- `source.json` 记录来源环境、job ID、UTC 时间、原始状态、输入/指令 SHA-256、模型来源及是否观察到用户报错或撤销。job ID 只留在私有证据中；不要放进 Mixpanel 或公开输出。原始输入、指令和预期条款确定后只追加修订记录，不用模型输出覆盖原文。
- `corpus.json` 保存案例 ID、路径、输入与指令哈希、状态、最近观察时间和下一步。相同输入但不同指令、期望或失败原因不能互相覆盖。每次运行另建 `runs/<run-id>/run.json`，记录范围、预算、授权、代码/Prompt 版本、逐层结果与证据路径。
