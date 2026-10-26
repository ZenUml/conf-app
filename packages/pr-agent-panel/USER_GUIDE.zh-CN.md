# ZenUML PR Agent Panel 使用指南

这是用于 GitHub PR 决策的一轮式 Chrome 扩展。你在 Claude Code 或 Codex 中明确提出“准备本轮 PR 评审”后，Agent 筛选有限数量的 PR、核实证据，并把本轮清单交给本机 Hub。只有本轮成员 PR 显示左栏；左栏每行只有决策标题和当前 CI。详细证据位于对应 PR 正文顶部的标记区，原正文保留。

Claude Desktop 的聊天列表不会显示 Codex 或 Claude Code 会话。本插件也不在不同聊天客户端之间同步完整对话。

## 安装与连接

需要 Chrome 116+、Node.js 22+、pnpm 和本机已登录的 `gh` CLI。当前没有 Chrome Web Store 或 npm 发布包，使用源码构建：

```bash
pnpm install
pnpm --filter @zenuml/pr-panel-hub build
pnpm --filter @zenuml/pr-panel-extension build
```

在 `chrome://extensions` 开启开发者模式，选择“加载已解压的扩展程序”，指向 `packages/pr-agent-panel/extension/.output/chrome-mv3`。打开扩展设置，点击 **Enable MCP access**，批准 `http://127.0.0.1/*`。权限默认关闭；关闭时扩展不会探测本机 Hub。

Claude Code 从仓库根目录注册并启动：

```bash
claude mcp add --scope local pr-panel -- node "$PWD/packages/pr-agent-panel/hub/dist/cli.mjs"
claude --plugin-dir "$PWD/packages/pr-agent-panel/agent-plugin"
```

Codex 从仓库根目录注册，并在新聊天中使用：

```bash
codex mcp add pr-panel -- node "$PWD/packages/pr-agent-panel/hub/dist/cli.mjs"
codex mcp get pr-panel
```

首次 Agent 连接会按需启动 Hub。扩展设置页显示连接状态；扩展图标弹窗显示当前产品、本轮剩余数量，以及 **Continue this round**。

## 发起和处理一轮

1. 在 Agent 聊天中说明产品、关注点和需要的 PR 数量。Agent 调用 `start_review_group`，筛选并核实当前 head、diff、CI 和测试证据。
2. Agent 为选中的 PR 准备问题与价值、Before/After、已验证命令和结果、未验证部分、风险及建议决策，再调用 `publish_review_group`。Hub 只写这些选中 PR 的标记材料，并在全部准备完成后替换左栏。允许少于请求数量；零结果会清空旧侧栏。
3. 新一轮准备期间仍显示上一轮，并注明准备状态。失败时保留上一轮且显示原因。只有最新请求可以发布，旧请求的迟到结果会被拒绝。
4. 打开本轮第一项后，在原生 GitHub PR 页面阅读证据和操作。切换到其他成员 PR，左栏会高亮当前项；非成员 PR 没有侧栏。
5. 原生合并或关闭经 Hub 查询 GitHub 确认后，当前操作标签页显示 **Next / Stay**。三秒后自动进入下一项；任何页面交互或选择 Stay 会取消计时。外部操作只更新状态，不移动浏览器标签。AI 操作也必须先锁定本轮、仓库、PR 和 head，并在 GitHub 确认成功后才移除项目；该锁定不构成合并授权。

问题、单项操作和单项证据刷新保留本轮顺序与进度。明确重新准备、改变产品、筛选条件或关注点才创建新一轮。完成后不会自动补充新 PR。

PR head 改变时，正文材料上方显示过期提示；读不到当前 head 时显示“未确认”，不会视为最新。只变动 CI 时，Hub 更新行内 CI，不重写材料。Agent 可在核实新 head 后调用 `refresh_review_material` 更新单项。

关闭聊天、刷新或关闭标签后，打开扩展图标弹窗，点击 **Continue this round**。若原评审标签仍在本轮 PR 上，将继续使用该标签；否则打开新标签。离线时已保存的本轮可读，恢复连接后再刷新远端事实。

## 边界

- `publish_review_group` 和 `refresh_review_material` 会修改所选 GitHub PR 的正文；只有明确要求准备或刷新材料时才应调用。单纯提问不触发写入。
- 扩展不启动模型，不自动授权合并或关闭。Agent 使用其已有 `gh` 登录；Hub 使用其进程可访问的本机 `gh` 登录查询远端结果与更新材料。
- 本轮状态存于 `~/.zenuml-pr-panel/store/review-group.json`，扩展同时缓存一份供离线阅读。旧 `ReviewStore` 仍保留兼容历史，但不再驱动左侧清单。
- Chrome 扩展只运行于 `github.com` 的 PR 页面。重新加载扩展后，刷新已打开的 PR 页面以重新注入内容脚本。
- 本地统计仅在 Hub 配置 Mixpanel token 时发送白名单计数和结果，不发送仓库名、PR 标题、diff、正文或 SHA。
