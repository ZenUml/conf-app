# 执行经验复盘 · conf-app（截至 2026-05）

> 本文档通过分析 77 个 Claude 对话记录（~350MB）提炼而来。
> 目标：让未来的 AI 实例在第一次就做对，不重蹈覆辙。

---

## 一、执行反模式 & 正确做法

### 1. 冗余确认（最高频问题）

**错误做法**：每完成一个子任务就问"Want me to proceed?""Shall I merge this?"  
**触发器**：项目配置了 `no-redundant-confirmations.sh` hook，自动拦截此类行为  
**正确做法**：Plan 获批、或方向明确后，直接执行下一步，结束后一次性汇报  
**判断标准**：这一步是否是整个任务链的自然延续？是 → 直接做；需要用户决策 → 才问

---

### 2. 假设而非证据（第二高频问题）

| 场景 | 错误行为 | 正确行为 |
|------|---------|---------|
| Mixpanel 事件数量下降 | "可能是数据滞后" | 先查每个客户的数据分布，再下结论 |
| V1 代码是否有某功能 | 直接断言"没有" | 读代码（或 git blame），出示引用行号 |
| 视觉 Bug（蓝色背景） | 从理论推断原因 | 先在受控环境复现，再解释 |

**原则**：Never theorize without evidence. Query data, read the code, run the command. Say "I don't know" instead of guessing.

---

### 3. 指标错用

| 错误用法 | 原因 | 正确替代 |
|---------|------|---------|
| D1 `page_viewed` 估计宏使用量 | 该事件在任何 Confluence 页面访问时都触发，与宏无关 | Mixpanel `macro_viewed` |
| Mixpanel 30d 窗口计算转化率 | 事件采集从 2026-04-18 才开始 | 先查最早事件日期，再按实际覆盖窗口年化 |

---

### 4. 分支上下文错误

**触发场景**：直接在当前 worktree 实现，没有确认分支是否正确  
**后果**："this is a wrong branch for that change"  
**检查点**：`git branch --show-current` → 对照任务 → 不对就新建 worktree

**多会话冲突规则**（已入 CLAUDE.md）：  
如果 `git status` 显示非自己产生的未提交改动，**禁止** checkout/reset/restore/stash，改为：
```bash
git worktree add ../conf-app-<feature> -b <feature-branch> main
```

---

### 5. 部署纪律

| 目标环境 | 正确路径 | 禁止路径 |
|---------|---------|---------|
| Development | `pnpm forge:deploy:dev` 本地可运行 | — |
| Staging | **只能通过 CI/CD**（推分支触发） | 本地 `wrangler pages deploy` 或 `forge deploy --env staging` |
| Production | `forge deploy --environment production` + 明确授权 | 任何未经用户 go-ahead 的执行 |

已删除过一个允许本地部署到 staging 的 skill，不要复原。

---

### 6. 重复任务未提炼为 Skill

**规律**：当同一个多步操作执行第 3 次时，它就应该是一个 Skill。  
**历史案例**：
- Iframe 链路遍历 + 解码 `_ctx_` payload + 查 custom content：手动做了多次 → 最终提炼为 `/find-macros-on-page`
- 下载 attachment：多次手动 → 提炼为 `/download-attachment`

**触发词**："do it for the other macros too" / "run this for every variant" / "now repeat for X"

---

### 7. Codex Review 必须显式指定 Scope

```bash
# 错误：依赖 default working-tree
/codex:review

# 正确
/codex:review --base main
/codex:adversarial-review --base main
```

---

### 8. Spot Check 不能报告部分完成

如果知道如何继续，就继续。声明 blocked 前必须已穷尽所有路径。

---

### 9. Merge 策略不能默认 Squash

除非用户明确说要 squash，否则用 repo 默认值（regular merge）或直接问。

---

## 二、Investigation 方法论

视觉 Bug（渲染问题）的正确流程：
```
1. 获取原始 Custom Content 数据
2. 在受控环境（lite-dev）精确复现
3. 复现后才开始诊断
4. 有证据才得出结论
```

指标异常调查流程：
```
1. 用 Mixpanel 查 per-client 分布（不是总量）
2. 查最早事件日期，排除数据采集覆盖问题
3. 对比同一时间段历史基线（同比，不是环比）
4. 确认是否有近期部署
```

---

## 三、知识索引

| 主题 | 记忆文件 |
|------|---------|
| D1 page_viewed scope | `feedback_d1_page_viewed_scope.md` |
| Forge iframe 自动化 | `reference_forge_iframe_automation.md` |
| 部署纪律 | `feedback_deployment_discipline.md` / `feedback_no_local_staging_deploy.md` |
| 无冗余确认 | `feedback_no_redundant_confirmations.md` |
| 指标起始日期 | MEMORY.md § Mixpanel Data Availability |
| D1 appId split (Connect vs Forge) | `reference_d1_forge_appid_split.md` |
