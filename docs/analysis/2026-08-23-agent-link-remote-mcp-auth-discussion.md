# Agent Link Remote MCP：身份、配对与 V1 边界讨论稿

日期：2026-08-23  
目的：与 OAuth 方案作者对齐当前实现、产品目标和最小可行身份模型。本稿不是最终 ADR。

## 结论摘要

我们认同 Agent Link 应采用 Remote MCP，并删除专用 Local CLI / Daemon。但当前讨论不需要引入显式 `Project`，也没有足够的产品需求证明 V1 需要长期 OAuth User。

建议的 V1 是：

1. Claude Code / Codex 只安装一次固定的 Agent Link Remote MCP endpoint。
2. 用户每次从已打开的 Confluence Macro 获取一个短期、一次性的 linking code。
3. Agent 调用 `connect(code)`，将当前 MCP session 临时绑定到该 Macro。
4. 后续 `read_diagram` / `update_diagram` 通过这次临时绑定执行。
5. 页面关闭、用户断开或 session 过期后，绑定失效；下次重新配对。
6. V1 不创建 Agent Link User、Project、长期 refresh token 或长期 Atlassian credential。

这与当前实现很接近，但并不相同。当前实现把每次生成的 session token 放进 MCP transport 的 `Authorization: Bearer ...` header；建议方案则让 MCP endpoint 永久安装，把一次性凭证移到 `connect(code)` 业务调用中。

## 1. 已对齐的产品目标

典型场景仍然是：

> 用户在 Claude Code / Codex 中要求 Agent 根据当前本地代码更新某个 Confluence 架构图。

这里有两个天然存在的上下文：

- 本地代码上下文由 Claude Code / Codex 当前打开的 repository 提供。
- Confluence 目标由用户当前操作的 Macro 提供。

用户会自然地在多个 repository、页面和 Macro 之间工作，但没有必要要求用户创建、选择或管理一个额外的 Agent Link `Project` 对象。把 repository 映射为 `Project` 会引入新的命名、成员、迁移和生命周期问题，却没有解决 V1 的核心任务。

因此，V1 只需要表达“本次 Agent session 要连接哪个 Macro”，不需要表达“这个 repository 永久属于哪个 Project”。

## 2. 当前本地实现

当前实现的主要链路是：

```text
Claude Code / MCP Client
        ↓ Remote MCP + Bearer session token
Cloudflare MCP endpoint + Durable Object
        ↓ WebSocket relay
已打开的 Confluence Forge Macro
        ↓ Forge bridge
Confluence Custom Content
```

已经实现的部分：

- `/agent-link/mcp` Remote MCP endpoint。
- Macro mint 的短期 session token。
- token 绑定 `{cloudId, pageId, contentId}`。
- 10 分钟 idle TTL、60 分钟 absolute cap。
- Cloudflare Durable Object 与 Macro WebSocket relay。
- `read_page`、`read_diagram`、`update_diagram`、`get_status`、`search_diagrams`、`list_diagrams`。
- 写入范围限制在当前绑定的 diagram；Confluence 仍是 diagram body 的 system of record。
- 不需要 Agent Link 专用 CLI、Daemon、Device Token 或 OTP pairing。

相关实现位于：

- `functions/agent-link/mcp.ts`
- `functions/agent-link/session.ts`
- `functions/agent-link/sessionToken.ts`
- `functions/agent-link/AgentLinkSession.ts`
- `functions/agent-link/mcpTools.ts`
- `src/composables/agentLink/forgeBridge.ts`
- `src/components/AgentLink/ConnectPanel.vue`

当前连接方式是：Macro 生成新 session token，然后 UI 给出类似下面的命令：

```bash
claude mcp add --transport http conf-agent https://<backend>/agent-link/mcp \
  --header "Authorization: Bearer <session-token>"
```

服务端在任何 MCP tool 被调用之前，从 HTTP `Authorization` header 中验证 token，并据此找到对应的 Macro session。

因此，当前实现有一个 UX 和配置生命周期问题：

- 每次 Macro session 都生成新 token。
- token 过期后，MCP 配置里留下失效的 credential。
- 新 session 需要重新执行命令或修改配置。
- 当前没有 `connect(code)` tool。

## 3. 已经验证和尚未验证的内容

在 staging 上已经通过真实 Remote MCP endpoint 验证：

- Bearer session token 可以访问 MCP。
- `read_page` 和 `read_diagram` 可以通过 Cloudflare relay 到达 Macro。
- `update_diagram` 可以更新 Confluence 内容并在 UI 中看到结果。
- disconnect 后 session 会终止。
- invalid token 会被拒绝。

但该 spot check 使用的是 raw HTTP client，不能替代以下客户端实验：

- Claude Code 是否能只安装一次无长期 credential 的 Remote MCP。
- Codex 是否支持相同流程。
- Claude Code / Codex 是否在多次 tool call 中稳定保持 MCP session identity。
- `connect(code)` 后的绑定是否能可靠地用于后续 tool call。
- 重启客户端后，重新配对的 UX 是否清晰。

因此，“Remote MCP relay 能工作”已经有证据；“永久安装 + `connect(code)`”目前仍是待验证设计。

## 4. OAuth 方案解决了什么

原 OAuth 方案把身份和目标建模为：

```text
OAuth User
  ├── Project A
  ├── Project B
  └── Project C
```

它适合以下需求：

- 长期识别同一个 Agent Link 用户。
- 跨客户端和重启保留授权。
- 用户账户、连接历史、审计和撤销。
- 页面关闭后继续运行后台任务。
- 长期资源授权或团队协作。

但长期 OAuth 登录并不是免费的抽象。至少有一方必须持久化：

- user identity；
- authorization grants；
- refresh token 或等价的 refresh state；
- revocation/logout state；
- client registration；
- 与 Confluence installation 或资源的授权关系。

MCP client 也需要在本地保存 access/refresh credential。即使 access token 使用无状态 JWT，refresh 和 revoke 通常仍需要服务端状态。使用外部身份服务只能把这部分存储移到外部，并没有消除它。

如果 V1 不需要长期用户身份、后台运行或永久资源授权，那么 OAuth 会增加一个新的账户与凭证系统，却没有消除页面打开、Macro relay 或 Confluence 写入授权问题。

## 5. OAuth 不等于页面关闭后仍可工作

OAuth 只回答“Agent 用户是谁”。它不会自动提供页面关闭后调用 Confluence 的能力。

当前页面打开模式中，Macro 是实际的 Confluence privileged actor：

```text
Cloudflare → WebSocket → Macro → Forge bridge → Confluence
```

如果页面关闭后仍要完成写入，则需要另一套设计，例如：

```text
Cloudflare → persistent Atlassian credential → Confluence API
```

这会新增：

- 长期 Atlassian credential 的获取、存储、refresh 和 revoke；
- OAuth User、Atlassian installation 与资源的关联；
- 后台重试、队列、审计和版本冲突处理；
- 用户权限变化后的重新授权；
- Cloudflare 数据与 Confluence system of record 之间的一致性处理。

另一个折中是 Cloudflare 暂存更新，等页面再次打开后由 Macro 写入。但这不是真正的后台完成，而且会让 Cloudflare 成为待发布 diagram body 的临时存储。

因此，“是否采用 OAuth”和“页面是否必须打开”应被视为两个独立决策。

## 6. 建议的 V1：永久安装，临时配对

### 首次安装

用户或 Agent 只执行一次：

```bash
claude mcp add --transport http conf-agent https://<backend>/agent-link/mcp
```

Codex 对应的安装方式需要单独验证。此时配置中没有短期 Bearer token。

### 每次连接

1. 用户在 Macro 点击 **Connect Agent**。
2. Macro mint 一个高熵、短期、一次性的 linking code。
3. UI 生成 Prompt：

   ```text
   Connect conf-agent to this diagram using code <code>.
   ```

4. Agent 调用：

   ```text
   connect(code)
   ```

5. 服务端消费 code，并把当前 MCP session 绑定到对应 `{cloudId, pageId, contentId}`。
6. 后续 tool call 不再要求用户传 code。
7. 页面关闭、显式 disconnect、idle timeout 或 absolute timeout 后绑定失效。

### 安全约束

linking code 不是普通资源 ID。因为它可以授予访问权，所以它是短期 capability，至少需要：

- 足够高的随机熵，不可猜测；
- 短 TTL；
- 只能消费一次；
- 明确绑定 cloud/page/content 和 tool scope；
- 配对前禁止 diagram 读写 tool；
- 尝试次数限制和 abuse rate limit；
- 显式 disconnect 和服务端失效机制；
- 不写入长期 MCP config 或日志。

普通 `contentId` 可以不是 secret，但 linking code 必须按 secret 处理。

## 7. `connect(code)` 的关键技术风险

推荐方案成立的前提是：Remote MCP transport 能提供一个稳定、可识别的 client session，使服务端能够在 `connect(code)` 后把后续 tool call 归入同一个临时绑定。

需要重点验证：

- Claude Code 和 Codex 是否支持并保持 Streamable HTTP MCP session ID。
- `initialize`、`tools/list`、`tools/call` 是否属于同一 session。
- 客户端断线重连时 session 是否变化。
- 多个 IDE window 或多个 repository 同时连接时是否会串线。
- server restart / Durable Object migration 后绑定如何恢复或明确失效。

如果客户端不能稳定保持 session identity，可选退路包括：

1. 每个 tool call 显式携带短期 connection handle；实现简单但 UX 和 tool schema 较差。
2. `connect(code)` 返回一个短期 token，由客户端动态更新 Authorization header；需要确认 Claude Code/Codex 是否支持，可能又退回配置问题。
3. 保留当前 Bearer-session 设计；接受每次重新配置，或由客户端提供更好的动态 credential 支持。

在完成客户端实验之前，不应把 `connect(code)` 描述成已经实现或已经证明可靠。

## 8. 三种方案对比

| 维度 | 当前实现 | OAuth + Project 提案 | 建议 V1 |
|---|---|---|---|
| MCP 安装 | 每个 session 带新 Bearer token | 安装一次并 OAuth | 安装一次，无长期 credential |
| 身份 | 短期 session token | 长期 OAuth User | 当前 MCP session |
| 目标 | token 绑定 Macro context | 显式 Project ID | 一次性 code 绑定 Macro context |
| Project 模型 | 无 | 有 | 无 |
| 服务端长期 credential | 无 | 有 | 无 |
| 页面必须打开 | 是 | OAuth 本身不能改变 | 是 |
| Confluence 写入者 | Forge Macro | 尚需明确 | Forge Macro |
| 配对凭证 | Bearer session token | OAuth + Project authorization | 一次性 linking code |
| 重启后 | 新 session / 新 token | 可保持登录 | MCP 保持安装，但重新配对 |
| 主要复杂度 | 配置更新、WebSocket relay | OAuth、账户、授权、refresh | MCP session 绑定、WebSocket relay |

## 9. 建议的实验矩阵

V1 实验应直接验证我们真正依赖的能力，而不是先实现完整 OAuth：

| Capability | Claude Code | Codex |
|---|---|---|
| 安装固定 Remote MCP endpoint | ⬜ | ⬜ |
| Prompt 能指导或完成首次安装 | ⬜ | ⬜ |
| 未配对时可发现 `connect` tool | ⬜ | ⬜ |
| `connect(code)` 成功消费一次性 code | ⬜ | ⬜ |
| 后续 tool call 保持同一绑定 | ⬜ | ⬜ |
| 两个并行 Agent session 不串线 | ⬜ | ⬜ |
| 页面关闭后调用明确失败 | ⬜ | ⬜ |
| timeout/disconnect 后 code 和绑定失效 | ⬜ | ⬜ |
| 重启后 MCP 仍安装，但要求重新配对 | ⬜ | ⬜ |
| 不需要 Agent Link CLI / Daemon | ⬜ | ⬜ |

最小实验工具可以是：

- `connect(code)`
- `get_status`
- `read_diagram`
- `publish_test` 或受控的 `update_diagram`

## 10. 何时重新考虑 OAuth

出现以下经过验证的需求时，再引入 OAuth 会更合理：

- 用户明确需要页面关闭后继续执行。
- 需要长期识别用户、跨设备同步或查看连接历史。
- 需要团队成员、权限委托和审计。
- 需要撤销某个用户对多个长期资源的授权。
- MCP client 的协议或安全策略要求标准 OAuth，无法支持无登录的 pairing endpoint。

即使届时引入 OAuth，也不必同时引入显式 `Project`。可以继续使用 OAuth User 作为长期身份、一次性 linking code 作为目标授权，把 repository context 留在 coding agent 本地。

## 11. 希望与 OAuth 方案作者确认的问题

1. OAuth 要解决的具体用户需求是什么：客户端协议要求、长期身份、后台运行，还是资源授权？
2. 如果不建显式 Project，OAuth 方案是否仍有独立价值？
3. Claude Code/Codex 是否已实测支持 Remote MCP OAuth、refresh 和跨重启持久化？
4. 是否有证据表明用户需要关闭 Confluence 后继续更新？
5. `connect(code)` 能否可靠绑定 Streamable HTTP MCP session？
6. 未配对的 Remote MCP endpoint 暴露 `connect` tool 是否满足客户端和安全要求？
7. 如果未来需要后台写 Confluence，准备采用哪种 Atlassian credential 和授权模型？

## 建议决策

在上述客户端实验完成前：

> 保留 Remote MCP + Forge Macro relay；不引入显式 Project；不引入 V1 OAuth。先验证“固定 endpoint 永久安装 + 一次性 linking code + `connect(code)` 临时配对”。

如果该实验失败，再根据失败原因选择当前 Bearer-session 模型、OAuth transport，或显式 connection handle，而不是预先建设完整账户和 Project 系统。
