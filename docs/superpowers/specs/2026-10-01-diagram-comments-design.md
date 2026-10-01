# 图表评论设计

**状态：** 已在 2026-10-01 产品讨论中批准，等待实现前的书面审阅  
**范围：** 在图表旁提供公开讨论；保留独立的 ZenUML 支持入口；迁移六条已确认的历史实质反馈。  
**系统记录：** 评论正文、作者、回复关系和权限由 Confluence Custom Content 评论保存；D1 或 Mixpanel 不保存评论正文。

## 1. 已确定的产品行为

### 1.1 入口与范围

- 图表工具栏显示「评论 · N」。N 表示该图表的主评论线程数。
- 点击后在图表旁展开线程面板；窄屏时面板位于图表下方。
- 每张图表按 `customContentId` 拥有独立讨论。同一 Custom Content 被嵌入多个页面时，评论归属仍由其真实容器决定，不能假定权限跟随每个嵌入页面。第一版仅在确认其容器为当前页面时开放评论；无法确认或跨页面引用时隐藏入口。复制产生新的 ID 后从空讨论开始，复制后仍引用旧 ID 时也必须经过上述容器校验。
- 评论可见范围跟随 Confluence 对 Custom Content 及其容器的权限；这是 Confluence 内的公开讨论，不表示对互联网公开。
- 每条主评论显示头像、姓名、时间、回复；回复嵌套在主评论下。
- 输入支持文字、链接和 `@` 同事。第一版不提供截图、图内标注、点赞、「已解决」或历史图表预览。
- 用户可以编辑、删除自己的评论，但只有在平台实际返回相应能力时才显示操作；删除需要确认。
- 图表更新后继续保留讨论。每条评论显示其发表时的图表版本（例如“发表于图表 v3”）；这里的版本是图表版本，不是评论自身的版本。
- 图表没有可用 `customContentId` 时不显示评论按钮。

原来的反馈入口改为 Bug 图标和「联系 ZenUML 支持」。它仍走支持反馈流程，内容不会自动公开。历史数据只迁移已批准的六条实质反馈，不迁移内部或测试性质的记录。

### 1.2 通知预期

- 新主评论计划通知图表最后修改者及被 `@` 的人。
- 回复计划通知被回复的人及被 `@` 的人。
- 同一接收人去重，不通知评论者本人；只把仍有页面访问权限的用户列入计划。
- 发布前显示计划通知对象。平台没有实际送达证据时，界面不得把“评论已保存”写成“通知已送达”。
- 最后修改者无法解析时仍可发表评论，并可通过 `@` 指定接收人。
- 历史迁移不主动 `@` 或额外通知最后修改者；必须实测并记录 Confluence 原生 watcher 是否产生副作用。

上述通知是产品目标，不是已验证的平台承诺。通知验证失败时，通知相关能力是发布闸门，需回到产品评审调整，不得静默降级后宣称已完成。

## 2. 架构边界与数据流

### 2.1 组件职责

1. **Comment service adapter**：以当前 Forge 用户身份调用 Confluence 评论接口，封装列表、创建主评论、创建回复、编辑和删除，并返回权限与错误类别。它接收 `customContentId` 和当前图表版本，不拥有评论数据库。
2. **Diagram comment panel**：负责响应式布局、线程渲染、输入草稿、@ 选择、通知对象预览、加载/空/只读/失败状态。它不直接拼接 Confluence REST 请求。
3. **Notification planner**：从当前 Custom Content 的 `version.authorId` 和用户选择的提及生成去重后的计划；实际通知由经验证的 Confluence 机制完成。它不伪造通知状态。
4. **Migration runner**：执行一次受控的历史反馈转换，读取私有 allowlist，解析目标 Custom Content，复用评论数据映射，在验证过的迁移身份下调用 API，并写入私有幂等账本。应用身份无法使用时停止该条迁移并报告，不借用原提交者身份。
5. **Analytics adapter**：只发送交互和结果的闭合枚举及计数，不发送评论正文、图表源码、客户名称、页面标题或提及用户 ID。

Confluence 是唯一的评论恢复来源；评论列表或发送不能依赖 Cloudflare 后端可用。评论版本标记若需要额外存储，也必须使用客户 Confluence 支持的表示；不能以 D1 作为评论恢复的必要条件。

### 2.2 正常交互

1. Viewer 已取得 `customContentId` 和当前 Custom Content 版本后，面板以当前用户身份读取评论。
2. 读取成功显示线程；读权限存在而写权限不存在时显示只读状态和原因，仍允许阅读。
3. 发布主评论或回复时，adapter 携带 `customContentId`、父评论 ID（回复时）和用户开始编写时看到的图表版本（回复只传平台要求的父评论关联，不假设允许同时传两个容器字段）；Confluence 返回的评论 ID 成为客户端确认依据。
4. 编辑或删除先检查平台能力和当前用户身份；服务器拒绝时保留原内容并显示可理解的权限错误。
5. 保存结果不确定（超时、连接断开）时先重新读取并做结果核对，禁止盲目重试造成重复评论。无法可靠核对时保留草稿并要求用户选择。

评论正文可用 Confluence 支持的 ADF 结构承载；应用拥有的版本/迁移元数据必须使用经验证的稳定表示，并且不能冒充系统评论版本。若平台不能保存图表版本标记，版本标记功能在解决表示方式前不能发布。

## 3. 权限、版本与迁移

### 3.1 权限

- 正常用户交互的所有读写都以当前 Forge 用户调用；不建立应用自有 ACL，也不以 D1 判断页面权限。
- 读评论要求用户能查看 Custom Content 及其容器；创建/回复/编辑/删除分别以 Confluence 返回的能力为准。
- 当前 `manifest.yml` 已有 `read:comment:confluence` 和 `write:comment:confluence`。现有检查未发现 `delete:comment:confluence`，因此实现前必须完成 scope/API 审计；在审计通过前不得承诺删除可用。
- 页面限制变化、用户失去访问权或评论被删除时，UI 以当前 API 结果为准，不缓存绕过权限的副本。

### 3.2 历史反馈迁移

迁移输入只来自 git-ignored 的 [migration-selection.json](../../../private/local-data/diagram-comments/migration-selection.json)，其中保存已批准的六条记录选择，不把真实租户、页面、Cloud ID、正文或来源 ID写入本公共仓库。该文件当前状态是 `design-only-not-executed`；本设计不执行迁移。

迁移是一次受控上线操作：

- 对每条 allowlisted 记录解析唯一目标 `customContentId`；无法准确定位的条目跳过并报告，不猜测目标。
- 原文必须完整保留；原提交日期和来源标记作为迁移说明保存。只有 Confluence 自己能赋予的真实作者身份才可使用；否则以应用身份发布，并清楚标明迁移来源和原提交日期，绝不冒充原作者，也不伪造系统创建时间。
- 私有幂等账本至少记录源反馈 ID、目标 Custom Content ID、目标评论 ID、状态、尝试时间和错误类别。重复运行按源 ID + 目标 ID 去重，已确认成功的记录不再发布。
- 迁移不主动 @，不向最后修改者发送应用额外通知；原生 watcher 的行为必须在演练中观察、记录并在正式迁移前接受。
- 迁移采用单执行器串行执行，发布前写入 pending 状态；源 ID 对应的去重标记必须能从目标 Confluence 评论或属性中查询。网络结果不确定时先按标记核对，无法可靠匹配则停留在待核对状态，禁止重发。完成后重新读取每个目标的评论，与账本逐项对账；部分失败、权限变化和重复候选都单独报告。

真实反馈正文和客户信息只能留在私有运行数据中，不能复制进本设计、测试 fixture、公开日志或 Mixpanel。

## 4. Analytics 契约

实现前的第一笔 feature commit 必须先更新 `src/utils/analytics/catalog.ts` 和 `src/utils/analytics/types.ts`。建议事件如下；公共属性仍按现有 catalog 自动补全。

| 事件 | 触发 | 额外属性 |
|---|---|---|
| `diagram_comment_panel_opened` | 用户展开面板 | `feature_area: "diagram_comments"`, `surface: "viewer"` |
| `diagram_comment_load_completed` | 评论读取结束 | `outcome: "succeeded" 或 "failed"`, `failure_reason` |
| `diagram_comment_submit_requested` | 用户点击发布主评论或回复 | `thread_action: "root" \| "reply"`, `mention_count` |
| `diagram_comment_submit_succeeded` | Confluence 返回已保存的评论 ID | `thread_action`, `mention_count`, `planned_notification_recipient_count`, `comment_id`, `root_comment_id` |
| `diagram_comment_submit_failed` | 发布明确失败 | `thread_action`, `failure_reason`（闭合枚举） |
| `diagram_comment_edit_completed` / `diagram_comment_delete_completed` | 编辑或删除操作结束 | `outcome`, `failure_reason` |
| `diagram_comment_dismissed` | 用户关闭有草稿的面板 | `had_draft` |
| `diagram_support_link_clicked` | 用户点击 Bug 图标/支持入口 | `feature_area: "feedback"`, `surface: "viewer"` |

`root_comment_id` 用于把新主评论与后续回复关联；只使用 Confluence 生成的评论 ID，不发送正文或身份字段。按固定观察窗统计新主评论中获得至少一次他人回复的比例，同时单列自回复；成功事件加入 `is_self_reply` 布尔字段。历史迁移不进入新讨论分母。

如需单独分析回复，沿用 `thread_action`，不再复制一套回复事件。事件不含正文、正文 hash、截图、源码、提及 account ID、客户名、页面标题或迁移源 ID；`mention_count` 只表示数量。迁移结果写私有运维账本，不以 Mixpanel 记录客户内容。

## 5. 验证与发布闸门

### 已有证据

- 当前 `manifest.yml` 的 Custom Content 模块声明支持 `comment` 子类型，并已有读写评论 scope（见文件约第 705、99、122 行）。
- Confluence REST v2 评论接口文档描述了以 `customContentId` 关联评论及以 `parentCommentId` 创建回复：<https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-comment/>。
- `src/model/DiagramAttribution.ts` 已把 Custom Content `version.authorId` 映射为 `lastUpdatedByAccountId`，可作为最后修改者计划的输入。
- Atlassian Design System 有 Comment 组件和嵌套评论示例，可作为面板视觉和键盘交互参考：<https://atlassian.design/components/comment/>。

### 发布前必须取得的证据

1. 在通用测试内容上真实验证列表、主评论、回复、当前用户权限、页面限制和复制/嵌入隔离；必须观察 UI 或网络结果，单元测试不能替代 UI 断言。
2. 验证 `@` 的身份解析、通知最后修改者和回复对象、去重/排除自己，以及 API 创建评论是否触发与原生 UI 相同的通知。只能在平台证据存在时显示“已通知”。
3. 验证图表版本标记能跨图表更新稳定保存，并确认使用的是图表版本而非评论版本；验证失败则阻止带版本标签的发布。
4. 审计编辑/删除端点和 Forge scope；缺少删除能力时隐藏删除操作并重新评审承诺。
5. 对超时后的读后核对、双击发布、分页/并发回复和迁移重复运行做测试；确认不存在重复评论或错误覆盖。
6. 用截图、snapshot 或网络 intercept 记录 UI 结果；若 iframe 无法驱动，标记该断言为 `SKIPPED` 并记录 blocker，不以测试通过代替 UI 证据。

成功标准是：有权限的读者能在图表旁阅读、发表评论和回复；没有写权限的读者仍能阅读；通知行为与 UI 显示一致（原生平台可能额外通知关注者，实测后在界面说明；不声称能控制所有平台通知）；图表更新不丢失讨论；六条 allowlist 记录可逐条对账且重复运行幂等；“讨论获得回复”的比例可由事件衡量，而不是只看面板打开量。

## 6. 明确不做的事

- 不把评论正文或权限镜像进 D1，不把后台可用性作为图表渲染/编辑/评论恢复的前提。
- 不把旧反馈全量公开，不迁移未列入六条 allowlist 的记录。
- 不伪造历史作者或系统时间，不主动向历史评论对象发送新通知。
- 不在第一版加入图内锚点、附件、点赞、解决状态或历史版本查看器。
