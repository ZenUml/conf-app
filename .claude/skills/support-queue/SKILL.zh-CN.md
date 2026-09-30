本文件仅供中文审阅。英文主文件：[SKILL.md](SKILL.md)。规则、执行和后续修改以英文主文件为准；本译本不作为独立 skill 入口。同步日期：2026-09-28。

隐私说明：为符合公共仓库隐私规则，本文中的客户标识、客户姓名和客户域名均使用示例占位符；ZenUML 内部域名、邮箱和工单标识按英文主文件保留。

名称：`support-queue`
描述：
  读取并分流 zenuml.atlassian.net 上的 ZEN 服务台队列——哪些工单仍然开放、谁在等待回复、哪些已授予的扩展即将到期。
  用于任何队列类问题：“有没有新工单”“谁在等我的回复”“这个租户以前提交过工单吗”“从某个日期起收到了什么”“工单”“谁在等回复”“有没有新工单”，以及付款墙／流失分析需要支持工单信号时。
  只读。要完成特定请求（写入 KV 许可证、起草回复），请改用 `extend-space-license`。
  唯一分流规则：问题点名具体工单，或把请求交给你执行时，使用 `extend-space-license`；问题涉及队列、时间范围、“有没有新内容”或谁在等待时，使用本 skill。

# 支持队列（ZEN 服务台）

## 访问 — 使用本地 agent token 的 curl（自 2026-08-16 起）

`.env.forge.local` 现在包含 `JSM_EMAIL`／`JSM_API_TOKEN`——这是由所有者于 2026-08-16 创建的、供 `support@zenuml.com` 使用的 agent 级 API token。**这是默认路径：使用普通 `curl`，无需浏览器，可在无头环境和 cron 中工作。**

```zsh
set -a && . ./.env.forge.local && set +a
curl -s -u "$JSM_EMAIL:$JSM_API_TOKEN" -H "Accept: application/json" \
  "https://zenuml.atlassian.net/rest/api/3/search/jql?jql=project%20%3D%20ZEN%20AND%20statusCategory%20!%3D%20Done&maxResults=50&fields=summary,status,created,reporter,description"
```

已于 2026-08-16 验证（仅验证状态码，从未回显值）：`/rest/api/3/myself`
→ 200，并解析为 `support@zenuml.com`；`/rest/api/3/issue/ZEN-1203` → 200；
`/rest/api/3/search/jql`（`project = ZEN`）→ 200 并返回结果；
`/rest/servicedeskapi/request/ZEN-1203` → 200。

各凭据的用途——两者**不可互换**：

| 凭据 | 在 ZEN 服务台上的权限 | 证据（2026-08-16） |
|---|---|---|
| `JSM_EMAIL` / `JSM_API_TOKEN` | **agent**——读取任意工单、执行 JQL 搜索、发表评论 | 上述四个端点均返回 200 |
| `FORGE_EMAIL` / `FORGE_API_TOKEN` | **customer**——只能看到自己提交的请求 | `/rest/api/3/myself` 返回 200，`servicedeskapi/servicedesk` 返回 200，`request?serviceDeskId=1` 返回 200 但 `size 1`，`issue/ZEN-1203` 返回 **403**，`search/jql` 返回 HTML 登录页 |

不要使用 Forge 凭据读取队列；它返回的 403 会被误读为“没有工单”，而不是权限错误。

**浏览器路径是 agent-browser 加 support@ 持久 profile**，用于 REST API 无法完成的操作，或 token 被拒绝时。先运行预热脚本（`~/.claude/skills/browser-check/scripts/atlassian-warmup.zsh zenuml`；退出码 0 表示已登录），再执行 `agent-browser --session support --profile ~/.agent-browser/profiles/atlassian open https://zenuml.atlassian.net/jira/servicedesk/projects`，用 `eval` 运行查询。Playwright MCP（见下）是最后的备用方案。注意：通过浏览器 JS 工具发起的页面内 `fetch` 写操作可能被 Claude Code 自动模式分类器拒绝（2026-08-16 在 `servicedeskapi` 评论 POST 上观察到）；curl 路径不受此影响。

### 连接最后备用浏览器（Playwright MCP）

```zsh
~/.agents/skills/connect-playwright-profile/scripts/preflight.zsh --runtime claude
```

然后导航到任意 `zenuml.atlassian.net` 页面（`/jira/servicedesk/projects` 即可），并在页面上下文中运行这些查询。

**如果 preflight 输出 `stale extension MCPs: reaped N`，预计下一次导航会无错误地卡住**——Chrome 扩展仍连接到已经失效的 relay。
修复方法：请用户运行 `/mcp` → `playwright` → Reconnect，然后重新运行 preflight（必须出现新的 MCP pid）并再次导航。
agent 无法自行调用 `/mcp`。第一次卡住时就请求处理；不要对失效传输重复尝试导航。

## 编写评论——可见性并不是你以为的默认值

本 skill 是只读的，但分流运行通常会以关闭工单结束，而关闭操作会写入评论。两个端点中，只有一个控制可见性：

| 端点 | 可见性 |
|---|---|
| `POST /rest/api/3/issue/<key>/comment` | **公开。**省略可见性字段并不会使评论变为内部评论。 |
| `POST /rest/servicedeskapi/request/<key>/comment`，使用 `{"public": false}` | 内部。读回 `jsdPublic: false` 以确认。 |

**始终读回评论并断言 `jsdPublic`，然后再继续。**2026-08-11，原本打算设为内部的三条备注——其中提到客户分销商的文字——通过第一个端点发布到了三个线上客户工单，因而公开可见。
这些评论已被删除（`DELETE /rest/api/3/issue/<key>/comment/<id>`，204），并通过第二个端点重新发布，但在此期间客户已经看到了原文字。服务台 API 调用的响应体也会回显 `public`；这个回显不是证据，必须断言读回的值。

## 两个 API 陷阱

1. **`/rest/api/2/search?jql=` 会在本网站静默返回空的 `issues: []`。**只有 `/rest/api/3/search/jql` 有效。不会抛出错误，因此错误端点会被误读为“没有工单”。
2. **评论端点会忽略 `orderBy=-created`，始终按升序返回。**因此较小的 `maxResults` 会得到最早的评论，而不是最后的评论。获取完整列表并取末尾。（2026-08-11 在发现问题前，这曾导致“最后一条评论”的判断错误。）

另外：查询时使用 `statusCategory != Done`，**不要**使用 `resolution = Unresolved`。ZEN 工作流的“Resolve this issue”转换（id `761`）会将工单移至 `Resolved`，**但不会设置 resolution 字段**——2026-08-11 关闭三个工单并读回 `status` 与 `resolution` 后已验证（三个工单均为 `Resolved`／`null`）。因此 `resolution = Unresolved` 会把所有已关闭工单都算作开放工单。
开放 ZEN 工单可用的转换：`781` Respond to support、`761` Resolve this issue、`901` Cancel request、`911` Escalate this issue。

## 步骤 1——读取队列

读取 `.claude/skills/support-queue/scripts/queue.js`，并把其内容传给 `browser_evaluate`。它会返回 `{ generatedAt, counts, tickets }`，每个工单包含 `kind`、解析后的 `ctx`、`lastComment`、`signalA`、`signalB`。

`queue.js` 早于本地 agent token，原本为 `browser_evaluate` 编写。使用 `JSM_EMAIL`／`JSM_API_TOKEN` 时，相同输入来自两个 curl 调用——上面的 JQL 搜索用于工单列表，以及每个工单的 `/rest/api/3/issue/<KEY>/comment` 用于信号 A 和 B。两个路由都有效；curl 路由是无头环境中可用的路径。

### 工单如何映射到租户

这是确定性映射，而不是推断。`src/components/UpgradePrompt/buildExtensionRequest.ts` 会构建预填的服务台深层链接：`summary` = 实例 URL，`description` = 结构化信息块，`customfield_10070` = 方案选项。

```
Client domain: example-tenant     Space key: ENG          Macro count: 1822
Limit: 100                        Product: ZenUML lite    App version: v2026.08.040331-lite
User account ID: 712020:…         Page ID: 1714749490     Macro type: sequence
```

**根据字段是否存在进行分类，绝不要根据 summary 的措辞分类。**以普通 bug 报告提交的付款墙锁定工单（“我们没有更改配置，应该仍在免费方案下”）不包含这些字段。归档中的这类工单有两个，都很重要——其中一个是产品历史上唯一已确认的 Bundle 转化——而按摘要模式分类器会漏掉它们。

因此，`kind: 'other'` 包含三种不同内容：真正的产品／bug 请求、客户措辞的付款墙锁定，以及**我们自己发出的外发工单**（我们主动创建的“X 空间已达到 ZenUML Lite 限额”工单）；后者同样没有结构化 description。

> **生产说明：**服务端工单创建端点（`functions/api/extension-request.ts`）**不在 `main` 上**——它只存在于 `feat/in-app-extension-request` 和 `design/paywall-redesign`。生产环境中的模态框会打开预填的门户表单，由客户提交。假设情况如此之前，请用 `git merge-base --is-ancestor c7b85838 origin/main` 验证。

## 步骤 2——已授予的扩展与开放工单之间的信号 C

`queue.js` 无法计算这一项——它需要 Cloudflare KV，而浏览器无法读取。运行下面的命令，并按工单 key 关联：

```zsh
NS=8969e8528105403bb2d9adca9fc16567   # SPACE_LICENSE_KV (prod)
for k in $(npx wrangler kv key list --namespace-id=$NS --remote \
    | python3 -c "import json,sys;[print(x['name']) for x in json.load(sys.stdin) if x['name'].startswith('license:')]"); do
  npx wrangler kv key get "$k" --namespace-id=$NS --remote \
    | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('spaceKey'),d.get('status'),d.get('activatedBy'),d.get('expiresAt'))"
done
```

`activatedBy` 按约定携带工单 key（`support:temp-7d-extension:ZEN-NNNN`），**但这个约定没有强制执行**——几条记录只有 `support:temp-14d-extension`，没有工单号。没有匹配上的记录并不能证明不存在工单；可以根据工单解析出的 `ctx`，以 `cloudId`+`spaceKey` 作为备用匹配条件。

为什么这个信号不可缺少：唯一已确认的 Bundle 转化发生在一次已授予的扩展到期、客户再次被阻断之后。被忽略的到期是一次错失的对话，而不是安静的成功。

## 步骤 3——关注规则

工单状态携带的信息非常少：大多数开放工单停留在 `Waiting for customer`，因为 ZEN 工作流没有提供离开该状态的转换（见 `extend-space-license`）。有些工单已经停留在那里超过一年。应根据下面三个信号分流：

| 信号 | 含义 | 来源 |
|---|---|---|
| **A** | 最后一条评论的作者是客户——我们需要回复。 | `queue.js` |
| **B** | 最后一条评论是我们自己的内部备注（`jsdPublic: false`）——记录了某件事，但客户从未得到回复。 | `queue.js` |
| **C** | 已授予的扩展**已经到期**，而工单仍然开放。 | 步骤 2 |

> **尚未到期的扩展不是行动项。**到期是设计好的机制，不是未能预防的失败——唯一已确认的 Bundle 转化正是因为一次扩展到期、客户再次被阻断而发生。提前续期会取消这一机制。在“已暂停”下报告仍然有效的扩展及其日期，仅此而已；只有日期过后、且有人再次提出请求时，决策点才到来。
>
> 这个确切错误曾发生在本 skill 的首次运行中（2026-08-11）：ZEN-1198 在扩展到期前三天就被列为需要行动，建议的行动是续期。

其他所有内容都属于**已暂停**：按租户聚合列出（重复请求者是转化信号），但不要放入行动列表。

### 不要联系不活跃的付费租户（所有者规则，2026-08-11）

在提出任何外发消息之前，检查租户的付费状态（`marketplace/scripts/mp_report.py whois <domain> --local --app all`）和近期活动。**如果租户正在付费但不活跃，不要提出任何联系——包括回复、礼貌关闭或状态更新。**给休眠订阅者发未经请求的消息，会促使其重新考虑订阅；工单很旧并不是接受这一风险的理由。

分别读取购买和结算：一笔有效的商业订单配合 Open 结算并不等于免费潜在客户。不要因为 `paying` 未知或最新发票尚未确认结算，就绕过这条不联系政策；保留商业购买上下文和任何既有的已付款证据。

这会覆盖信号 A 和信号 B：“我们需要回复”是分流事实，不是发送指令。将工单报告为**已暂停——不活跃付款方**，列出续期日期，然后停止。

**Resolve 转换并不是静默的。**JSM 会在请求被解决时通知客户，因此关闭操作在本规则下算作联系。除非已检查并证明服务台通知方案关闭，否则保持工单开放。（示例：ZEN-1157——一个付费 Full 租户，14 个席位，每月 $254.52，距离续期还有 15 天，90 天内 0 次保存、0 次新建，问题已 16 个月未回答。正确处理是保持开放并不做操作。）

## 步骤 4——委托补充信息

本 skill 只负责工单侧：key、租户、空间、宏数量、请求的方案、信号、扩展到期时间。除此之外的内容应调用所属 skill，而不要复制其逻辑：

| 问题 | Skill |
|---|---|
| 这个租户是否付费／会支付多少 | `tenant` |
| 这个租户当前是否被阻断、程度如何 | `paywall` |
| 事件级证据 | `mixpanel` |
| 授予扩展并回复 | `extend-space-license` |

步骤 2 中读取 KV 到期时间是唯一例外——它属于信号 C，而不是补充信息。

## 输出

一个表格，行动行在前：

| 工单 | 租户 | 空间 | 宏 | 信号 | 年龄 | 备注 |
|---|---|---|---|---|---|---|

然后按租户聚合列出已暂停部分。真实租户名称**不得**写入公共仓库文件；本 SKILL.md 及其脚本只使用占位符。持久化的队列快照应放在私有 handbook 中，与 `paywall/extension-request-replies.md` 放在一起。

## 定时运行

在 `/loop` 或 cron 下，读取和写入 `private/support/queue-state.json`：

```json
{ "lastRun": "<ISO8601>", "tickets": { "ZEN-NNNN": { "updated": "…", "signals": "AB" } } }
```

只报告自 `lastRun` 以来发生的变化（新工单、新信号、扩展进入到期前 7 天）。每次都完整重新列出，会让一个已暂停 16 个月的工单与 3 天后到期的工单拥有相同权重，报告也就不再有人阅读。首次运行没有基线：报告全部内容一次，并说明这一点。

## 相关

- `extend-space-license`——写入侧：授予许可证、起草并发布回复。
- `connect-playwright-profile`——preflight 与重连流程。
- `tenant`、`paywall`、`marketplace`、`mixpanel`——补充信息负责人。
