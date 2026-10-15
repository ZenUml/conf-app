---
name: ai-chat-improvement
description: 从普通 AI Chat 修改的失败与可疑结果中建立私有案例，修复并完成单例分层验证及历史回归；用于持续改进。只重放既有案例使用 ai-chat-regression。
---

# 普通 AI Chat 持续改进

一次批次的闭环是：发现实际问题 → 固定原图、指令和验收要求 → 修复 → 用 [ai-chat-case-validation](../ai-chat-case-validation/SKILL.md) 逐层验证 → 用 [ai-chat-regression](../ai-chat-regression/SKILL.md) 检查旧案例。模型横向比较不是完成此闭环的前置条件。本 skill 只处理普通 AI Chat 修改；带 `errorMessage` 的 AI Chat 语法修复另行处理，旧 `/fix-diagram` 入口才使用 [AI Repair 流程](../ai-repair-improvement/SKILL.md)。

## 发现与选择案例

先确定用户关心的时间范围、环境与产品变体；没有明确范围时，只询问会影响取数的缺项。按 [线上取数](references/production-intake.md) 先做只读聚合，再按用户选定的案例数量上限取原始记录。只选已验证属于 conf-app 普通聊天修改的 job：版本化图 ID、非空 `command`、空 `errorMessage`；不能仅凭 `Job.type = diagram_modification` 把语法修复或 Diagramly 原生会话算进来。

`FAILED` job 是技术失败候选；`COMPLETED` + `noChange` 是待审查结果，用户要求可能本来已满足；`COMPLETED` + 版本号也只说明后端写入，不证明指令正确或 Confluence 保存成功。结合用户报告、可见预览及必要时的人工语义复核选案例。Mixpanel 事件不带完整 DSL、指令或 jobId，不能凭事件数重建原文或一一对应 job。

在调用模型前明确本轮最多处理的案例数、模型调用次数或费用上限，并核对把所选原图、指令和当前 Prompt 发往实际 AI 服务/模型的授权。把客户原图放进测试 Confluence 宏是独立的数据目的地，执行 UI 复现前确认站点与草稿处理。授权只覆盖说明过的本轮范围；预算用单一台账记录，重试也计数。只读统计和离线整理可以先做，不把它们说成模型验证完成。

## 固化、修复与验收

按 [案例格式](../ai-chat-case-validation/references/case-format.md) 把原始 DSL、完整 `command`、来源 job、模型、时间、输出、用户报告和验收条款保存在 `private/local-data/ai-chat-regression/`。如缺少“应该怎样改、哪些内容不能变”的证据，标 `UNVERIFIED (missing_expectation)`，通过用户报告或人工评审补齐，不凭模型流畅回复自拟成功标准。不要将客户正文、身份、租户信息或密钥写入公开文件、任务标题、PR 或普通消息；不要提交 private 子模块中的案例。

每例调用 `ai-chat-case-validation` 的 L2 → L3 → L4 门槛。至少要观察到 AI Chat 返回结果、job 无 Error；完整 PASS 还要有语法/渲染、指令满足和真实 UI 预览证据。遇到空输出、超时、版本缺失、错误代码、指令未满足或 UI 更新失败，从最早失败层定位并修改，再用同一原图和指令复测。保留所有尝试及代码/Prompt 版本，不能让一次偶然成功抹掉先前失败，也不能放宽验收条款。`noChange` 按案例预期判定。

修复代码若引入新产品行为，先按仓库规则规划并登记 Mixpanel 事件；现有 `ai_chat_change_*` 成功埋点不代表用户主动接受。与其他任务并行时，不改其正在修改的埋点或 Excel 文件。保留工作区既有改动；未经用户同意不创建 worktree，不自动提交或部署。

## 历史回归与交付

本批选中的案例完成 L4 后，用最终代码/Prompt 对用户选定的历史范围做 `ai-chat-regression`。简易回归只到 L2，完全回归走 L2 → L3 → L4；两者的结果不能混称“全链路通过”。回归调用扣同一预算，历史客户数据不在本轮模型/UI 授权范围内时先核对授权。发现退化，保留证据并回到对应案例的最早失败层；预算不足就记录 `BLOCKED`，不能报告全语料通过。

交付私有语料索引、每例源证据和验收条款、失败根因、修复改动、各层状态与真实 UI 预览、历史回归覆盖率和未覆盖项。没有实际执行过的层级保持 `SKIPPED` 或 `BLOCKED`。这个 skill 是一次有上限的人工发起批次；不自行创建定时任务、对外消息、提交、推送、部署或发布页面。
