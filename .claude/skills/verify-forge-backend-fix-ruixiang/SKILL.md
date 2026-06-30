---
name: verify-forge-backend-fix-ruixiang
description: 当 backend functions 修复（Cloudflare Pages Functions）需要多环境联合验证时使用此 skill。覆盖：理解改动 → spec/单元测试 → wrangler pages dev runtime → forge deploy + tunnel → joint debug 启用 → 真实 UI 流 ngrok 抓包验证。
---

# 验证 Forge Backend Functions 修复（多环境联合验证）

## 何时使用

适用于"backend functions 修复 + 需要真实 UI 流验证"的场景：

- Cloudflare Pages Functions 路径修复（`_middleware.ts`、auth、context 注入）
- 客户端代码同时需要 cloudId / 用户上下文 / 新增字段
- 需要在真实 Confluence 浏览器中验证（不能仅靠单元测试或 spec）
- 修复涉及 env 副作用、跨请求污染、context 注入等需要 runtime 验证的属性

**不适用于**：

- 仅前端 UI 改动（用 `/spot-check` 或 `/pvt-*`）
- 仅 Forge runtime 改动（用 `/forge-tunnel`）
- 不需要真实 UI 流验证的后端改动（spec/单元测试足够）

## 前置

1. 知道要验证的 git 分支与文件改动
2. 用户的 Atlassian 站点（fengruixiang: `danshuitaihejie.atlassian.net`）
3. 用户能手动触发浏览器操作（登录 + 编辑 + Publish）
4. `diagramly.ai` 本地路径（如果要验证 AI repair 链路；否则跳过）
5. wrangler.toml 中已有 `NGROK_AUTHTOKEN` 和 `NGROK_DOMAIN` 配置

## 标准流程

### Step 1：理解改动

```bash
git log main..HEAD           # 先看是否真的已提交
git diff HEAD --stat         # 工作树改动
```

读所有改动文件，重点：

- `_middleware.ts`：auth 路径
- `authenticate.ts`：context 注入、token 验证
- `functions/<handler>.ts`：每个 API handler 的 context 读取路径
- 客户端 services：发出的请求 body 字段

识别核心问题（如 `env.FORGE_CONTEXT` 全局副作用、跨请求污染）。

### Step 2：单元测试 + spec 等价覆盖

```bash
pnpm test:unit
```

读取所有新增/修改的 spec 文件，**逐项映射 spot check 检查项 → spec 断言**。理想情况下所有 spec 都过 + 每个修复点都有 spec 直接断言。

如果 spec 覆盖完整，可以直接出 spot check 报告；否则进入 Step 3 runtime 验证。

### Step 3：wrangler pages dev runtime 验证（无需 tunnel）

```bash
# 1. build
pnpm build:full

# 2. 启动本地 Cloudflare Pages 模拟器（带真实 D1 + ALLOWED_FORGE_APP_IDS）
pnpm exec wrangler pages dev dist --port 8788
```

```bash
# 验证 _middleware 真的命中
curl -i http://localhost:8788/forge-custom-content          # 401
curl -i http://localhost:8788/forge-upload-attachment      # 401
curl -i -X POST -d '{}' http://localhost:8788/diagramly/chat  # 401
```

wrangler console log 应显示：
- `Function request url: ...`（来自 `_middleware.ts`）
- 调用栈 `at authMiddleware (functions/_middleware.ts:28)`
- `ALLOWED_FORGE_APP_IDS: ...`（来自 `authenticate.ts`）
- 错误 Bearer token → 401 `JWT validation failed`

**为什么需要 wrangler pages dev**：`forge tunnel` 只代理 Forge runtime（manifest.yml 中 `function:` 字段），**不代理** Cloudflare Pages Functions（`/functions/` 目录）。backend functions 的真实运行时验证必须用 wrangler pages dev。

### Step 4：forge deploy + tunnel

仅当需要"真实 Forge UI 流"时才做这步。完整流程参考 `/forge-deploy-ruixiang` skill。

```bash
pnpm build:full
rm -fr dist/drawio                     # 必须！drawio ~170MB 触发 size 限制
forge deploy -e env_ruixiang --no-verify   # --no-verify 跳过 pre-existing manifest lint
forge install -p Confluence -s danshuitaihejie.atlassian.net --confirm-scopes --upgrade
forge tunnel -e env_ruixiang          # listening on http://localhost:57743
```

如果 lite-dev.atlassian.net 升级报 `Principal has insufficient permissions`，**直接切到 env_ruixiang + danshuitaihejie.atlassian.net**（fengruixiang 自己的 dev env）。

### Step 5：Joint debug 启用（关键）

参考 `/joint-debug` skill。joint debug 把 frontend 的 `callRemote` 路由到本地 backend，实现"前端不动（用 env_ruixiang 部署的 Custom UI）+ backend 走本地（ngrok → wrangler pages dev）"的链路。

修改 3 个文件（全部用 `[JOINT-DEBUG-START/END]` 标记）：

1. `src/model/globals/forgeGlobal.ts`：DEVELOPMENT_LITE/FULL → ngrok domain
2. `functions/_middleware.ts`：注释 `/diagramly`（让 vite frontend 直接调 diagramly AI，不走 cloudflare auth）
3. `src/components/SyntaxErrorBox.vue`：强制 `isAiRepairEnabled = true`

`wrangler.toml` 中 `DIAGRAMLY_BACKEND_API_BASE_URL` 应已配置为 `http://localhost:3000`。

### Step 6：启动 5 个 Terminal.app

```bash
./.claude/skills/joint-debug/launch-debug-services.sh \
  "2piBMy4QpL09UzthlR6iYtCgqd8_7JKwDUqPKkjyL9FbkiHfB" \
  "special-lemming-radically.ngrok-free.app" \
  "/Users/fengruixiang/Documents/projects/diagramly.ai"
```

5 个 Terminal：

| # | 服务 | 端口 | 用途 |
|---|------|------|------|
| 1 | diagramly | 3000 | AI backend |
| 2 | wrangler pages dev | 8789 | 本地 functions runtime |
| 3 | ngrok | 4040 (UI) + 443 | 暴露 8789 到公网 |
| 4 | `pnpm start:sit` | 8000 | frontend dev server |
| 5 | forge tunnel | 57743 | Forge runtime 代理 |

验证服务起来：

```bash
curl -o /dev/null -w "%{http_code}\n" http://localhost:3000   # 200
curl -o /dev/null -w "%{http_code}\n" http://localhost:8789   # 200
curl -o /dev/null -w "%{http_code}\n" http://localhost:8000   # 200
curl -H "ngrok-skip-browser-warning: true" -o /dev/null -w "%{http_code}\n" \
  https://special-lemming-radically.ngrok-free.app/forge-custom-content  # 401
```

### Step 7：用户触发真实 UI 流

请用户：

1. 登录 danshuitaihejie.atlassian.net
2. 打开任意带 zenuml macro 的页面（或新建页面插入 macro）
3. 触发任一操作：
   - **Macro edit + Publish**（触发 `/forge-custom-content`）
   - **AI Repair**（如果启用了 — 触发 `/diagramly/fix-diagram`，需要 diagramly AI running）

### Step 8：ngrok API 抓取 Forge 请求

ngrok 自带 inspect API（`http://localhost:4040`）和 web UI。

```python
import json, base64, gzip, urllib.request
d = json.loads(urllib.request.urlopen('http://localhost:4040/api/requests/http').read())
for r in d.get('requests', []):
    req = r.get('request', {})
    headers = req.get('headers', {})
    ua = headers.get('User-Agent', [''])[0]
    if 'Forge' not in ua:
        continue
    if req.get('method') != 'POST':
        continue
    raw = base64.b64decode(req.get('raw', ''))
    body = raw.split(b'\r\n\r\n', 1)[1] if b'\r\n\r\n' in raw else b''
    print(f"{req.get('uri')}: {body[:500].decode('utf-8', errors='replace')}")
```

**关键证据**：

- `POST /forge-custom-content` UA=Forge → 200 OK
- `POST /diagramly/fix-diagram` UA=Forge body 含 `cloudId` 字段
- `POST /diagramly/job-status` UA=Forge → 200 OK

如果 `/diagramly/fix-diagram` 返回 `{"error":"Network connection lost."}` → diagramly AI (3000) 没启动，启动 Terminal 1 重试。

如果返回 `{"error":"Missing cloudId in Diagramly request context"}` → backend 修复有问题（cloudId 没注入），需要重新检查。

## 关键决策点

| 现象 | 原因 | 处理 |
|------|------|------|
| `git log main..HEAD` 空但 `git diff HEAD` 有改动 | 分支未提交 | 报告并询问：tunnel 验证 vs 提交后再验证 |
| `forge upgrade lite-dev` 报权限不足 | 当前用户不是站点管理员 | 切换到 env_ruixiang + danshuitaihejie.atlassian.net |
| `forge deploy` 报 manifest lint 错误 | pre-existing manifest 问题 | `forge deploy --no-verify`（确认不影响 functions） |
| `wrangler: command not found` | CLI 不在 PATH | 用 `pnpm exec wrangler` |
| `forge tunnel` 直接 curl 返回 404 | tunnel 只代理 Forge runtime，不代理 Cloudflare Functions | 用 `wrangler pages dev` 单独跑 backend functions |
| `/diagramly/*` 500 `Network connection lost` | diagramly AI (3000) 没启动 | 启动 diagramly AI（Terminal 1）再重试 |
| `/diagramly/*` 500 `Missing cloudId in Diagramly request context` | backend 修复有问题 | 回查 `data.forgeContext` 注入逻辑 |
| `wrangler pages dev` 不打印调用栈 | `console.log` 没启用 / 进程是 detached | 直接读 wrangler task output |

## 回滚

joint debug 启用后留下的标记（保留可下次再用）：

- `src/model/globals/forgeGlobal.ts`：删除 `[JOINT-DEBUG-START]`/`[END]` 块，恢复 `[JOINT-DEBUG-ORIGINAL]` 行
- `functions/_middleware.ts`：取消 `// '/diagramly'` 行注释
- `src/components/SyntaxErrorBox.vue`：删除 `[JOINT-DEBUG-START]`/`[END]` 块

`forge tunnel` + 5 个 Terminal.app 窗口：用户在各自 Terminal 按 Ctrl+C 停止。`wrangler pages dev` (8788)：从 TaskStop 停止。

清理 `.env.forge` / `.env.forge.local`（gitignored 的 deploy 配置）。

## 证据清单（spot check 报告模板）

1. **Spec 等价**：6+ spec 文件覆盖每个修复点
2. **Unit tests**：`pnpm test:unit` 全部 PASS（记录测试数）
3. **Wrangler runtime**：6 个 AUTHENTICATED_PATHS → 401，调用栈命中 `_middleware.ts:28 → authenticate.ts:108`
4. **真实 UI 流**：
   - `POST /forge-custom-content` UA=Forge → 200
   - `POST /diagramly/fix-diagram` UA=Forge body 含 `cloudId` 字段
   - `POST /diagramly/job-status` UA=Forge → 200

## 与其他 skill 的关系

- `/spot-check`：标准的轻量级验证，不涉及多环境部署。本 skill 是 spot check 的"重型"版本
- `/joint-debug`：Step 5 中 joint debug 启用步骤完全来自该 skill
- `/forge-deploy-ruixiang`：Step 4 中 deploy 步骤来自该 skill
- `/forge-tunnel`：Step 4 中 tunnel 启动来自该 skill
- `/pvt-ai-repair`：如果修复涉及 AI repair 流程，可在 PVT 时用