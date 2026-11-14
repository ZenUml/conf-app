# Mixpanel 查询配方

从仓库根目录工作。事件与属性先按 SKILL.md 核对，查询 schema 以当前连接器的 Get-Query-Schema 为准。下例是 2026-11-14 实际使用的查询形状，工具名称通过当前工具清单发现。

## 固定公共参数

从当前项目日期计算绝对日期。默认 7 天且包含今天时，`from = projectToday - 6 days`，`to = projectToday`。项目时区与用户时区分开记录。示例日期仅用于重现历史，正常执行时替换。

```javascript
const projectId = 3373228;
const customerFilters = [
  { type: "string", propertyName: "is_internal_client_domain",
    propertyType: "string", resource: "event", operator: "equals", value: "false" },
  { type: "string", propertyName: "client_domain", resource: "event", operator: "is set" },
  { type: "string", propertyName: "client_domain", resource: "event", operator: "does not equal", value: "" },
  { type: "string", propertyName: "client_domain", resource: "event", operator: "does not equal", value: "unknown_atlassian_domain" }
];
const base = {
  chartType: "bar",
  dateRange: { type: "absolute", from: "2026-11-08", to: "2026-11-14" },
  filters: [
    ...customerFilters,
    { type: "string", propertyName: "environment_type",
      propertyType: "string", resource: "event", operator: "equals", value: "PRODUCTION" }
  ]
};
const events = [
  "ai_chat_button_shown", "ai_chat_opened", "ai_chat_prompt_submitted",
  "ai_chat_change_applied", "ai_chat_no_change", "ai_chat_prompt_failed",
  "ai_chat_prompt_cancelled", "ai_repair_button_shown", "ai_repair_requested",
  "ai_repair_succeeded", "ai_repair_failed", "ai_repair_applied", "ai_repair_dismissed"
];
const total = eventName => ({ eventName, measurement: { type: "basic", math: "total" } });
const distinct = (eventName, propertyName) => ({
  eventName, measurement: { type: "aggregate-property", math: "unique_values", propertyName }
});
const breakdown = propertyName => ({ metric: { type: "property", propertyName, resource: "event" } });
const knownAccountFilters = [
  ...base.filters,
  { type: "string", propertyName: "user_account_id", resource: "event", operator: "is set" },
  { type: "string", propertyName: "user_account_id", resource: "event", operator: "does not equal", value: "" },
  { type: "string", propertyName: "user_account_id", resource: "event", operator: "does not contain", value: "unknown" },
  { type: "string", propertyName: "user_account_id", resource: "event", operator: "does not contain", value: "anonymous" }
];
```

布尔型内部标记使用字符串形式 `equals "false"`，使共享链接保留正确过滤器。`environment_type` 使用实际值 `PRODUCTION`，先查询值域确认。初次只有排除内部站点、未加环境过滤的数字不是最终线上数字；本次案例 Chat 曝光因此从 279 调整为 275（当时查询的是 11 月 7—13 日）。

## 四组报告

将以下报告对象分别传给 Run-Query：`{ project_id: projectId, report_type: "insights", report }`。保留返回的 `report_url` / `query_id`，不创建或改写共享看板。

```javascript
const counts = {
  ...base, name: "AI production usage", metrics: events.map(total)
};
const coverageEvents = [
  "ai_chat_button_shown", "ai_chat_prompt_submitted",
  "ai_repair_button_shown", "ai_repair_requested", "ai_repair_applied"
];
const reachAccounts = {
  ...base, name: "AI known account reach", filters: knownAccountFilters,
  metrics: coverageEvents.map(eventName => distinct(eventName, "user_account_id"))
};
const reachTenants = {
  ...base, name: "AI customer tenant reach",
  metrics: coverageEvents.map(eventName => distinct(eventName, "client_domain"))
};
const outcomes = [
  "ai_chat_prompt_submitted", "ai_chat_change_applied", "ai_chat_no_change",
  "ai_chat_prompt_failed", "ai_chat_prompt_cancelled",
  "ai_repair_requested", "ai_repair_succeeded", "ai_repair_failed",
  "ai_repair_applied", "ai_repair_dismissed"
];
const tenants = {
  ...base, name: "AI outcomes by tenant",
  metrics: outcomes.map(total), breakdowns: [breakdown("client_domain")]
};
const deployment = {
  ...base, name: "AI request build coverage",
  metrics: ["ai_chat_prompt_submitted", "ai_repair_requested"].map(total),
  breakdowns: ["product_type", "macro_type", "app_version"].map(breakdown)
};
const environmentCoverage = {
  ...base, name: "AI customer environment coverage", filters: customerFilters,
  metrics: events.map(total), breakdowns: [breakdown("environment_type")]
};
```

`basic.unique` 是 Mixpanel 身份去重，用作交叉核对；有效账号口径使用 `user_account_id` 的 distinct count。上面的账号报告总是附加有效身份过滤，租户报告独立计数，保留有效租户中匿名访问的覆盖。账号可能跨租户，跨功能总人数也需要真正求并集，不能相加两个功能的人数。结合实际属性值补全其他占位值的排除项。

账号筛选只用于人数，不自动改变生命周期事件总量。`environmentCoverage` 是诊断查询，特意不加生产环境过滤；据此报告环境缺失 / 非生产的数量与占比，主表仍仅使用 `base` 人群。若 breakdown 未给出缺失桶，用相同客户人群下全部事件数与各个已设置环境值之和核对，或查询未设置环境的事件。无法核对就明确未核验，不能默认为零。

## 事件明细与耗时

用 Get-Property-Values 的 `result_mode: "expanded"` 读取精简事件明细。请求 / 结果 / 应用 / 失败 / 取消分开请求，每次只取相关字段：

```json
{
  "project_id": 3373228,
  "event": "ai_repair_succeeded",
  "resource_type": "Event",
  "properties": [
    "client_domain", "user_account_id", "environment_type", "product_type",
    "app_version", "macro_type", "duration_ms"
  ],
  "result_mode": "expanded",
  "from_date": "2026-11-08",
  "to_date": "2026-11-14",
  "limit": 100
}
```

这个接口没有上述报告的全局过滤器。用报告返回的合格租户 / 版本及同样的环境、身份、时间边界筛选明细，再计算耗时或求并集。**先核对明细时间的时区含义**，不要把无偏移的字符串自行视为项目时间；用已知事件与按日报告交叉验证。为核验边界扩大明细窗口时，把区间外事件与统计样本分开。

检查返回的截断说明与行数上限。超过上限时按日期或租户拆分请求；不能用前 100 行报告整个窗口的用户并集、中位数或结果缺口。高流量时优先通过带过滤器的 Run-Query 聚合 `duration_ms`（`median` / `min` / `max`），独立查询有效耗时样本数。

Chat 修改结果读取 `ai_chat_change_applied`，无修改结果读取 `ai_chat_no_change`；Repair 读取 `ai_repair_succeeded`。`duration_ms` 是前端等待时长，区别于 `backend_duration_ms` 和 `backend_llm_duration_ms`。Repair 应用方式属性名是 **`result`**，不是 `repair_result`。

## 缺失与零值

- Run-Query 有时省略零值系列。仅在请求成功、schema / 事件存在、过滤器已核验且无治理过滤的情况下，将已请求但省略的系列视作零；查询错误、事件未识别和权限过滤都记“未核验”。
- 用同一租户、账号、上下文和时间邻近事件检查生成终态缺口。`requested - succeeded - failed`（Repair）只是待核验差额；`applied` / `dismissed` 是结果之后的动作，不能再从生成终态扣除。
- 截止时仍在进行、跨窗口返回、关闭页面或丢失埋点都可能造成差额。没有公共请求 ID 时标明归因可信度，不强行逐次配对。
- Chat `no_change` 是成功响应；Chat `cancelled` 独立于失败；Repair `dismissed` 只说明成功后放弃结果，不代表全部取消行为都被记录。

## 不可用时

本次 Business Context 连续返回服务错误，但 Get-Query-Schema 与 Run-Query 正常。遇到同类情况，可重试一次，记录上下文读取失败，继续用已读项目 mixpanel skill 和代码核验查询；不要因一个元数据接口失败就放弃可用的数据接口。

若数据接口也不可用，按 mixpanel skill 的 JQL 方案查证。JQL 不支持这里的计算属性，必须读取它要求的私有排除清单并结合公共基线；清单缺失时只能输出带限制的初步结果，不能声称排除了全部内部租户。仍不可用就保留查询方案并明确未取得实时数字。

## 需要环比时

显式查询上一可比周期，复用事件集和过滤器；API 不一定返回 `timeComparison` 的差值。含今天的窗口应对齐上一周期相同截止时刻，或改用双方完整日；小样本优先报原始计数。参考案例未把“1 次到 9 次”写成已验证的增长结论。
