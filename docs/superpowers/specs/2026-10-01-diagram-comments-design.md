# 图表评论设计

**状态：** 2026-10-01 产品讨论中批准；**2026-11-04 修订：评论改存为页面底部评论，加一个回到图表的链接**（见第 0 节）。第一个 PR 的范围见 [issue #1047](https://github.com/ZenUml/conf-app/issues/1047)。  
**范围：** 读者对一张图表向作者发言；保留独立的 ZenUML 支持入口；历史反馈迁移和编辑、删除留到后续 PR。  
**系统记录：** 评论正文、作者、回复关系和权限由 Confluence 页面底部评论保存；D1 或 Mixpanel 不保存评论正文。

## 0. 2026-11-04 修订

### 0.1 决定

评论不再绑定在图表的 Custom Content 上，改为**发在图表所在页面的底部评论**，评论里带一个链接，点开后页面滚到该图表并高亮：

```
?zenumlDiagram=<customContentId>&zenumlLocal=<macro localId>&dv=<发表时的图表版本>
```

| 用途 | 参数 | 说明 |
|---|---|---|
| 这条评论属于哪张图表 | `zenumlDiagram` | 面板读取本页评论后，按它过滤；同一页同一张图表嵌几次，都显示同一个讨论 |
| 点开链接后滚到哪个实例 | `zenumlLocal` | macro 的 `forgeContext.localId`，每个嵌入实例唯一 |
| 发表于图表 vN | `dv` | 取发表时图表 Custom Content 的版本，面板据此显示"发表于图表 v3" |

### 0.2 为什么改（2026-11-04，lite-stg 观察，日志见 [#1043](https://github.com/ZenUml/conf-app/issues/1043)）

| 检查 | 结果 |
|---|---|
| 带 @ 提及的页面底部评论 | 被提及的人 18 到 30 秒内收到通知，2 次中 2 次 |
| 带 @ 提及的图表（Custom Content）评论 | 约 3 到 4 分钟内没有通知，2 次中 0 次；这类评论也不显示在页面评论区 |
| 评论里的带参数链接 | 读回后完整保留；页面打开时参数保留 |
| 按链接参数过滤本页评论 | 可行，2 条评论里只命中 1 条 |
| macro 能否读到页面地址和查询串 | 能：`forgeContext.extension.location`（`ApWrapper2.ts` 里的 `currentPageUrl`）；`view.getContext()` 官方文档没有列这个字段，Forge SDK 升级时要复查 |
| 滚动并高亮图表 | 复用 Byline 一键放置已有的 `revealThisMacro()`（在 iframe 内聚焦 1px 元素，浏览器滚动 Confluence 的滚动容器） |
| 同一张图表在一页出现两次 | 两个 macro 的 `localId` 不同，只有与参数一致的那个响应 |
| 刷新是否重复触发 | iframe 里的 `sessionStorage` 刷新后保留，且同页所有 macro 共用，所以防重复的键要带 `localId` 和参数 |

被放弃的方案：评论存在 Custom Content 上。原因：通知不到达，评论也不显示在页面上，且 Atlassian 文档没有说明它的通知行为。

### 0.3 读者想评论的位置

D1 `FeedbackReport`，2026-09-01 到 11-04：22 条真实反馈里 16 条是对图表内容的评论，**全部来自 `viewer` 界面**（页面里看图），编辑器、全屏、PNG 导出都是 0 条。所以入口放在 inline 查看界面，面板在全屏里打开（Figma 画面 01 的 1280px 宽度；Export PNG 同样的模式，PR #638）。

## 1. 已确定的产品行为

### 1.1 入口与范围

- inline 图表工具栏显示「评论 · N」。N 表示该图表在本页的主评论线程数；懒加载，失败不影响图表渲染。
- 点击后打开全屏，右侧显示线程面板（Figma 画面 01）。窄屏布局不在范围内（画面 02 与桌面优先规则冲突，见 #1043）。
- 讨论的范围是"一个页面上的一张图表"：同一张图表被嵌在另一个页面时，那里是独立的讨论。
- 评论可见范围跟随 Confluence 对该页面的权限；这是 Confluence 内的公开讨论，不表示对互联网公开。
- 每条主评论显示头像、姓名、时间、回复；回复嵌套在主评论下。
- 输入支持文字和链接。第一版不提供截图、图内标注、点赞、「已解决」、历史图表预览，也不提供 `@` 选人。
- 匿名访客和访客账号（guest）没有 Forge 用户令牌，不显示评论入口。
- 图表更新后继续保留讨论；每条评论显示"发表于图表 vN"（取自链接里的 `dv`，不是评论自身的版本）。
- 图表没有可用 `customContentId` 时不显示评论入口。

原来的反馈入口仍保留（第一版不改）。把它改为 Bug 图标「联系 ZenUML 支持」留到后续 PR。

### 1.2 通知预期

- 每条主评论自动 `@` 图表的最后修改者（来自 `DiagramAttribution.lastUpdatedByAccountId`）；回复自动 `@` 被回复的人。
- 同一接收人去重，不通知评论者本人。
- 发布前显示将通知的对象。平台没有送达证据时，界面不得把"评论已保存"写成"通知已送达"。
- 最后修改者无法解析时仍可发表评论，只是不带 `@`。
- 上述通知是产品目标，不是已验证的平台承诺（第 5 节闸门 1）。

## 2. 架构边界与数据流

### 2.1 组件职责

1. **评论 adapter**：以当前 Forge 用户身份通过 `requestConfluence` 读写页面底部评论：按页读取并分页、创建主评论、创建回复（`parentCommentId`）。它构造并解析链接参数，不拥有评论数据库。
2. **图表评论面板**：线程渲染、输入草稿、通知对象预览、加载、空、只读、失败状态。它不拼接 Confluence REST 请求。
3. **定位**：macro 加载后读自己的页面地址，参数 `zenumlLocal` 等于自己的 `localId` 时调用 `revealThisMacro()`，用 `sessionStorage` 里带 `localId` 和参数的键保证每个标签页只触发一次。只在查看模式、页面高度稳定后触发。
4. **Analytics adapter**：只发送闭合枚举和计数，见第 4 节。

Confluence 是唯一的评论恢复来源；评论读写不依赖 Cloudflare 后端。

### 2.2 正常交互

1. 页面加载时不取评论。用户点击「评论」或页面需要数字时，才读取本页底部评论（共享的按页缓存，一页多个图表只取一次），按 `zenumlDiagram` 过滤。
2. 读取成功显示线程；失败显示可理解的错误，图表本身不受影响。
3. 发布时 adapter 创建带链接的页面底部评论，以 Confluence 返回的评论 ID 作为确认依据。
4. 保存结果不确定（超时、连接断开）时先重新读取并核对，禁止盲目重试造成重复评论。无法核对时保留草稿并让用户选择。
5. 429 或限流时退避并显示"稍后再试"，不阻塞图表渲染。

## 3. 权限与后续范围

### 3.1 权限

- 所有读写以当前 Forge 用户调用；不建立应用自有 ACL，也不以 D1 判断页面权限。
- `manifest.yml` 已有 `read:comment:confluence` 和 `write:comment:confluence`，各变体的清单裁剪脚本没有去掉它们。没有 `delete:comment:confluence`；新增 scope 是主版本升级，需要管理员同意，所以删除放到后续 PR。
- 页面限制变化、用户失去访问权时，UI 以当前 API 结果为准，不缓存绕过权限的副本。

### 3.2 后续 PR

- `@` 选人（已有 `read:user:confluence`、`search:confluence`，尚未端到端核对）。
- 编辑和删除（需要删除所需的 scope 评审，也缺 Figma 里的删除确认画面，见 #1043）。
- 六条已批准的历史反馈迁移：输入仍只来自 git 忽略的私有选择文件，不把真实租户、页面、正文写入公共仓库；迁移采用单执行器、幂等账本、不冒充原作者、不主动 `@`。设计不变，实现推迟。
- 原反馈入口改成「联系 ZenUML 支持」，inline 面板。

## 4. Analytics 契约

第一笔 feature commit 已在 `src/utils/analytics/catalog.ts` 和 `types.ts` 登记（feature_area `diagram_comments`）。所有事件保持全量，不采样：它们是用户操作，不是渲染。

| 事件 | 触发 | 额外属性 |
|---|---|---|
| `diagram_comment_entry_clicked` | 用户点击 inline 的「评论」 | `surface: "viewer"` |
| `diagram_comment_panel_opened` | 全屏面板打开 | `surface: "fullscreen"` |
| `diagram_comment_load_completed` | 本页评论读取结束 | `comment_load_outcome`, `comment_count`, `comment_failure_reason` |
| `diagram_comment_submit_requested` | 用户点发布 | `comment_thread_action: "root" \| "reply"`, `comment_mention_count` |
| `diagram_comment_submit_succeeded` | Confluence 返回已保存的评论 ID | `comment_thread_action`, `comment_mention_count`, `comment_planned_recipient_count` |
| `diagram_comment_submit_failed` | 发布明确失败 | `comment_thread_action`, `comment_failure_reason`（闭合枚举） |
| `diagram_comment_dismissed` | 用户关闭面板 | `comment_had_draft` |
| `diagram_comment_link_revealed` | macro 因评论链接完成滚动 | `surface: "viewer"` |

事件不含正文、作者、account ID、页面标题、被提及的人。`planned_recipient_count` 是我们请求 Confluence 通知的人数，不是送达数。要看的比例：每次面板打开有多少次成功发布；每次成功发布有多少次 `link_revealed`（评论是否把读者带回图表）。

## 5. 验证与发布闸门

### 5.1 已有证据（2026-11-04，lite-stg，人类 API 令牌，每项 1 到 2 次）

见第 0.2 节的表。证据日志：[#1043](https://github.com/ZenUml/conf-app/issues/1043)。

### 5.2 发布前必须取得的证据

1. **以 Forge 用户身份通过桥发的评论，会通知被提及的人。** 之前的试验都用人类 API 令牌，这一项没验证。验证失败时，通知相关能力是发布闸门，需回到产品评审，不得静默降级后宣称已完成。
2. **产品代码里的定位**在一页两个 macro 的情况下只让匹配的那个滚动，刷新不重复，新标签页打开链接时会触发。
3. 编辑模式、Live Docs、全屏、无写权限的读者上的行为（不会误触发，也不会破坏渲染）。
4. 页面评论很多时的分页和 429 行为；一页多个图表只取一次评论。
5. 双击发布、超时后核对的测试，确认不会产生重复评论。
6. **UI 证据按顺序：Storybook，然后 Forge Tunnel，然后 CI 部署的 staging**，每阶段记录被测版本和截图；跳过或被阻塞的断言标为 SKIPPED 而不是通过。

成功标准：有权限的读者能在 inline 图表旁进入评论、阅读、发表评论和回复；匿名访客和访客账号看不到入口且图表不受影响；通知行为与界面显示一致；评论里的链接把读者带回那张图表；图表更新不丢失讨论。

## 6. 明确不做的事

- 不把评论正文或权限镜像进 D1，不把后台可用性作为图表渲染、编辑或评论的前提。
- 不使用 Custom Content 评论（见 0.2）。
- 不伪造历史作者或系统时间，不主动向历史评论对象发送新通知。
- 第一版不加图内锚点、附件、点赞、解决状态、历史版本查看器、`@` 选人、编辑、删除。
