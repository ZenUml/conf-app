
# Forge Dev Console - 产品需求文档

> 版本: 1.1  
> 日期: 2025-01-22  
> 作者: Engineering Team

---

## 1. 产品概述

### 1.1 背景

我们的 Confluence 插件项目包含多个 App 变体（ZenUML Lite、ZenUML Full、Diagramly），它们共享同一个代码库和 manifest 文件。

**当前面临的痛点：**

1. **命令爆炸** - `package.json` 中已累积 40+ 个 npm scripts，且还在增长。每个命令都包含复杂的环境变量组合，难以记忆和维护。

2. **上下文丢失** - 本地开发时，开发者经常需要回答以下问题，但没有统一的地方可以查看：
   - 我现在开发的是哪个 App？
   - 我的 Tunnel 连接的是哪个 Confluence 实例？
   - 当前使用的环境变量是什么？
   - 这个 App 部署到哪些环境了？版本是多少？

3. **Tunnel 管理混乱** - `forge tunnel` 是本地开发的核心工具，但目前：
   - 不清楚 tunnel 使用的是哪套环境变量
   - 不清楚连接的是哪个 App 和 Confluence 实例
   - 切换 App 或环境时需要手动停止重启

### 1.2 目标

创建一个**本地开发控制台**，作为日常开发的信息中心：

1. **消除命令记忆负担** - 通过 UI 替代复杂的命令行操作
2. **提供开发上下文感知** - 随时知道"我在开发什么，连着哪里"
3. **简化 Tunnel 管理** - 一目了然的 tunnel 状态和配置

### 1.3 设计原则

1. **稳定优先** - 不追求花哨的动画或视觉效果，功能可靠最重要
2. **简单直接** - 能用静态展示的就不用动态加载
3. **不改变现有流程** - 本地开发使用全量 manifest，不做裁剪（裁剪只在 CI/CD 中进行）

### 1.4 目标用户

- 内部开发人员（主要用户）
- QA 测试人员
- 新加入的团队成员（降低上手门槛）

### 1.5 非目标

- 这不是一个通用的 Forge 管理工具
- 不负责 staging/production 的部署（那是 CI/CD 的职责）
- 不需要 manifest 裁剪功能（本地开发用全量 manifest）
- 不需要复杂的动画和加载效果

---

## 2. 数据模型

### 2.1 概述

**核心机制**：manifest.yml 中定义了变量（带默认值），执行 `forge deploy` 或 `forge tunnel` 时通过**命令行环境变量**覆盖这些默认值。

```yaml
# manifest.yml 中的变量定义
environment:
  variables:
    - key: APP_ID
      default: 8ad26115-211f-4216-971b-0540f606303d
    - key: CONNECT_KEY
      default: com.zenuml.confluence-addon-lite

# manifest.yml 中引用变量
app:
  id: ari:cloud:ecosystem::app/${APP_ID}
  connect:
    key: ${CONNECT_KEY}
```

```bash
# 执行时通过命令行环境变量覆盖
CONNECT_KEY=gptdock-confluence APP_ID=xxx forge deploy -e staging
```

### 2.2 Manifest 变量 vs Forge Variables（重要区别）

| 特性 | Manifest 变量 | Forge Variables |
|------|--------------|-----------------|
| **用途** | 替换 manifest.yml 中的 `${VAR}` | App 代码中通过 `process.env` 访问 |
| **设置方式** | 命令行 `VAR=xxx forge deploy` | `forge variables set VAR xxx` |
| **可用时机** | **部署时**（manifest 解析阶段） | **运行时**（App 执行时） |
| **存储位置** | 本地配置 (config.json) | Forge 云端 |

**我们使用的是 Manifest 变量**，因为需要在部署时确定：
- `app.id` - App 的唯一标识
- `connect.key` - Connect app key
- `macro.key` - Macro 的 key
- `remotes.baseUrl` - 远程服务地址

这些定义了 App 的结构，**必须在部署时确定**，无法在运行时改变。

**Forge Variables 无法实现这个需求**，因为 manifest 解析发生在部署时，而 Forge Variables 只在运行时可用。

### 2.2 数据分类

| 分类 | 存储位置 | 说明 |
|------|---------|------|
| **App 配置** | 本地 `config.json` | 我们管理的 App 定义和 EnvVars |
| **Manifest 变量** | `manifest.yml` | 变量定义和默认值 |
| **Forge 平台数据** | Forge 云端 | Deployment、Installation（只读查询） |
| **运行时状态** | 内存 | Tunnel 状态 |

### 2.3 实体关系图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DATA MODEL                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─ 本地配置 (config.json) ───────────────────────────────────────────────┐ │
│  │                                                                        │ │
│  │   App (我们定义的应用变体)                                              │ │
│  │    │                                                                   │ │
│  │    ├── id: "zenuml-lite"                                              │ │
│  │    ├── appId: "8ad26115-..."  (Forge App ID)                          │ │
│  │    │                                                                   │ │
│  │    └── envVars (覆盖 manifest 默认值)                                  │ │
│  │         ├── common: { CONNECT_KEY, LITE_KEY_SUFFIX, ... }             │ │
│  │         ├── development: { BASE_URL: "https://localhost:8080" }       │ │
│  │         ├── staging: { BASE_URL: "https://conf-stg-lite..." }         │ │
│  │         └── production: { BASE_URL: "https://conf-lite..." }          │ │
│  │                                                                        │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│                    ↓ 合并 common + 环境特定，注入到命令                       │
│                                                                             │
│  ┌─ manifest.yml ─────────────────────────────────────────────────────────┐ │
│  │                                                                        │ │
│  │   environment.variables (定义变量和默认值)                              │ │
│  │    ├── APP_ID (default: 8ad26115-...)                                 │ │
│  │    ├── BASE_URL (default: https://conf-stg-lite...)                   │ │
│  │    ├── CONNECT_KEY (default: com.zenuml.confluence-addon-lite)        │ │
│  │    └── ...                                                            │ │
│  │                                                                        │ │
│  │   引用: ${APP_ID}, ${CONNECT_KEY}, ${BASE_URL}                        │ │
│  │                                                                        │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│                    ↓ forge deploy / forge tunnel                            │
│                                                                             │
│  ┌─ Forge 平台 (只读查询) ────────────────────────────────────────────────┐ │
│  │                                                                        │ │
│  │   Forge Environment                                                    │ │
│  │    ├── development (canTunnel: ✅)                                    │ │
│  │    ├── staging (canTunnel: ❌)                                        │ │
│  │    ├── production (canTunnel: ❌)                                     │ │
│  │    └── custom: peng-dev, yanhui (canTunnel: ✅)                       │ │
│  │                                                                        │ │
│  │   Deployment (per Environment)                                         │ │
│  │    └── version, deployedAt                                            │ │
│  │                                                                        │ │
│  │   Installation (per Deployment)                                        │ │
│  │    └── site, product                                                  │ │
│  │                                                                        │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ┌─ 运行时状态 ───────────────────────────────────────────────────────────┐ │
│  │                                                                        │ │
│  │   Tunnel (全局单例)                                                    │ │
│  │    ├── status: running | stopped | error                              │ │
│  │    ├── app: "zenuml-lite"                                             │ │
│  │    ├── environment: "development"                                     │ │
│  │    └── activeEnvVars: { 合并后的变量 }                                 │ │
│  │                                                                        │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.4 实体定义

#### App（本地配置）

| 字段 | 类型 | 说明 | 示例 |
|------|------|------|------|
| id | string | 本地标识符 | `zenuml-lite`, `diagramly` |
| name | string | 显示名称 | `ZenUML Lite` |
| appId | string | Forge App ID | `8ad26115-211f-4216-971b-0540f606303d` |
| envVars | object | 环境变量配置 | 见下方 |

#### EnvVars（本地配置，属于 App）

用于**覆盖 manifest.yml 中的默认值**。

```json
{
  "common": {
    "APP_ID": "8ad26115-211f-4216-971b-0540f606303d",
    "CONNECT_KEY": "com.zenuml.confluence-addon-lite",
    "LITE_KEY_SUFFIX": "-lite",
    "LITE_TITLE_SUFFIX": " Lite"
  },
  "development": {
    "BASE_URL": "https://localhost:8080"
  },
  "staging": {
    "BASE_URL": "https://conf-stg-lite.zenuml.com"
  },
  "production": {
    "BASE_URL": "https://conf-lite.zenuml.com"
  }
}
```

**合并规则**：`common` + 特定环境的变量 → 注入到命令

#### Forge Environment（Forge 平台概念）

| 名称 | canTunnel | 说明 |
|------|-----------|------|
| development | ✅ | 默认开发环境 |
| staging | ❌ | 预发布环境 |
| production | ❌ | 生产环境 |
| custom (peng-dev, yanhui...) | ✅ | 自定义开发环境 |

#### Deployment（Forge 平台，只读）

| 字段 | 说明 | 数据来源 |
|------|------|---------|
| environment | Forge Environment | `forge deploy list --json` |
| version | 版本号 (v1, v2...) | |
| deployedAt | 部署时间 | |

#### Installation（Forge 平台，只读）

| 字段 | 说明 | 数据来源 |
|------|------|---------|
| site | Confluence 站点 | `forge install:list` |
| product | 产品类型 | |
| environment | 对应的 Forge Environment | |

#### Tunnel（运行时状态）

| 字段 | 说明 |
|------|------|
| status | `stopped` \| `running` \| `error` |
| app | 当前 App ID |
| environment | 当前 Forge Environment |
| activeEnvVars | 当前注入的环境变量（合并后） |
| logs | 日志输出 |

### 2.5 数据流

```
1. 用户选择 App: "zenuml-lite"
                ↓
2. 用户选择 Forge Environment: "development"
                ↓
3. 从 config.json 加载 EnvVars:
   common:      { APP_ID: "8ad26115-...", CONNECT_KEY: "...", LITE_KEY_SUFFIX: "-lite" }
   development: { BASE_URL: "https://localhost:8080" }
                ↓
4. 合并: { APP_ID, CONNECT_KEY, LITE_KEY_SUFFIX, BASE_URL }
                ↓
5. 执行命令:
   APP_ID=8ad26115-... CONNECT_KEY=... BASE_URL=... forge tunnel -e development
                ↓
6. Forge CLI 用这些环境变量替换 manifest.yml 中的 ${VAR_NAME}
```

### 2.6 约束总结

| 约束 | 说明 |
|------|------|
| Manifest 变量替换 | EnvVars 用于覆盖 manifest.yml 中的默认值，与 `forge variables` 无关 |
| 单 Tunnel | 同一时间只能有一个 Tunnel 运行 |
| Tunnel 环境限制 | 只有 development 和 custom 环境支持 tunnel |
| 平台数据只读 | Deployment 和 Installation 通过 CLI 查询，本工具不修改 |

---

## 3. 核心功能

### 3.1 功能概览

| 功能模块 | 优先级 | 说明 |
|---------|--------|------|
| **Tunnel 管理** | P0 | 启动/停止 tunnel，显示状态和环境变量 |
| App/环境切换 | P0 | 选择要开发的 App 和环境 |
| 登录状态 | P0 | 显示 Forge CLI 是否已登录 |
| 部署状态（只读） | P1 | 显示各环境的部署版本，仅供参考 |
| 安装状态（只读） | P1 | 显示 App 安装在哪些实例 |
| 环境变量查看 | P1 | 显示当前配置的环境变量 |

**说明**：staging/production 的部署和升级操作由 CI/CD 负责，本工具只提供只读展示。

---

## 4. 详细功能设计

### 4.1 登录状态模块

**功能描述**  
显示当前 Forge CLI 的登录状态，如未登录则提供引导。

**数据来源**  
```bash
forge whoami
```

**状态展示**

| 状态 | 显示内容 |
|------|---------|
| 已登录 | 显示邮箱地址（如 `peng@zenuml.com`） |
| 未登录 | 显示"未登录"，提示运行 `forge login` |

**交互说明**
- 页面加载时自动检查登录状态
- 未登录时显示警告

---

### 4.2 Tunnel 管理模块 ⭐ 核心功能

**功能描述**  
Tunnel 是本地开发的核心。开发者需要随时知道：
- Tunnel 是否在运行？
- 连接的是哪个 App 和 Environment？
- 使用的是哪套环境变量？

**重要约束**（来自 Atlassian 官方文档）：
- Tunnel **只能用于 development 或自定义开发环境**
- staging 和 production 环境**不支持** tunnel
- 同一时间**只能有一个** tunnel 运行

#### 4.2.1 Tunnel 状态显示

**状态**

| 状态 | 显示 |
|------|------|
| 未运行 | 灰色，显示"Tunnel 未启动" |
| 运行中 | 绿色，显示连接信息 |
| 错误 | 红色，显示错误信息 |

**运行中显示的信息**

```
┌─ 🟢 Tunnel Running ────────────────────────────────────────────┐
│                                                                │
│  App:          ZenUML Lite                                     │
│  Environment:  development                                     │
│  Local URL:    http://localhost:8080                          │
│                                                       [Stop]   │
│                                                                │
│  Environment Variables:                                        │
│  ─────────────────────────────────────────────────────────────│
│  APP_ID         8ad26115-211f-4216-971b-0540f606303d          │
│  BASE_URL       https://conf-stg-lite.zenuml.com              │
│  CONNECT_KEY    com.zenuml.confluence-addon-lite              │
│  LITE_KEY_SUFFIX -lite                                        │
│  ... (可展开查看全部)                                          │
│                                                                │
│  Log:                                                          │
│  ─────────────────────────────────────────────────────────────│
│  [14:32:01] Listening on http://localhost:8080                │
│  [14:32:05] Tunnel connected                                  │
│  [14:35:12] Request: GET /descriptor                          │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

**未运行状态**

```
┌─ ⚫ Tunnel Stopped ────────────────────────────────────────────┐
│                                                                │
│            Tunnel 未运行                                       │
│                                                                │
│            [Start Tunnel]                                      │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

#### 4.2.2 启动 Tunnel

点击 "Start Tunnel" 后，显示配置确认：

```
┌─────────────────────────────────────────────┐
│  启动 Tunnel                                │
├─────────────────────────────────────────────┤
│                                             │
│  App:         [ZenUML Lite ▼]               │
│  Environment: [development ▼]  ← 只显示支持  │
│               tunnel 的环境                  │
│                                             │
│  将使用以下环境变量：                         │
│  ┌────────────────────────────────────────┐ │
│  │ APP_ID: 8ad26115-211f-4216-971b-...    │ │
│  │ BASE_URL: https://conf-stg-lite...     │ │
│  │ CONNECT_KEY: com.zenuml.confluence...  │ │
│  │ ...                                    │ │
│  └────────────────────────────────────────┘ │
│                                             │
│  [取消]                    [启动]           │
└─────────────────────────────────────────────┘
```

**注意**：Environment 下拉框只显示支持 tunnel 的环境（development 和 custom），不显示 staging 和 production。

**执行的命令**
```bash
APP_ID=xxx BASE_URL=yyy CONNECT_KEY=zzz forge tunnel -e development
```

#### 4.2.3 Tunnel 日志

- 显示 tunnel 的标准输出
- 可折叠/展开
- 错误信息用红色标记

#### 4.2.4 切换 App/环境时的行为

**场景**: 用户在 tunnel 运行时切换 App 或环境

**交互流程**:
1. 显示提示："切换将停止当前 Tunnel，是否继续？"
2. 用户确认后：
   - 停止当前 tunnel
   - 更新 App/环境上下文
   - 提示用户手动启动新 tunnel

---

### 4.3 App/Environment 切换模块

**功能描述**  
选择当前要开发的 App 和 Environment。这决定了 Tunnel 使用的环境变量。

**App 列表**

| App 标识 | 显示名称 | 类型 | App ID |
|----------|---------|------|--------|
| `zenuml-lite` | ZenUML Lite | Forge | `8ad26115-211f-4216-971b-0540f606303d` |
| `zenuml-full` | ZenUML Full | Connect | `d9e4002b-120b-426b-834b-402a4a5adce7` |
| `diagramly` | Diagramly | Forge | `01ede8b1-4e88-451a-b9ef-89eeef93afaf` |

**Environment 列表（per App）**

| Environment | Type | canTunnel |
|-------------|------|-----------|
| development | development | ✅ |
| yanhui | custom | ✅ |
| peng-dev | custom | ✅ |
| staging | staging | ❌ |
| production | production | ❌ |

**交互说明**
- App 和 Environment 使用两个独立的下拉选择器
- 切换后自动刷新部署和安装信息
- 记住用户上次选择（localStorage）
- 如果 Tunnel 正在运行，切换时提示需要先停止 Tunnel

---

### 4.4 部署状态模块（只读）

**功能描述**  
显示当前 App 在各环境的部署版本，仅供参考。实际部署由 CI/CD 负责。

**数据来源**
```bash
forge deploy list --json
```

**表格字段**

| 字段 | 描述 | 示例 |
|------|------|------|
| 环境名称 | Forge 环境标识 | `development`, `staging`, `production` |
| 版本号 | Major version | `v3` |
| 部署时间 | 最后部署时间 | `2025-01-22 14:30` |

**环境列表（按顺序显示）**
1. `development` - 开发环境
2. `staging` - 预发布环境  
3. `production` - 生产环境
4. 其他自定义环境（如 `yanhui`, `peng-dev`）

**注意**：本工具不提供部署操作按钮。staging/production 部署通过 GitHub Actions 完成。

---

### 4.5 安装状态模块（只读）

**功能描述**  
显示当前 App 的各 Deployment 被安装到哪些 Confluence 站点。

**数据来源**
```bash
forge install:list
```

**表格字段**

| 字段 | 描述 | 示例 |
|------|------|------|
| 站点 | Confluence 站点 URL | `zenuml-stg.atlassian.net` |
| 产品 | Atlassian 产品 | `Confluence` |
| 环境 | 对应的 Forge 环境 | `staging` |

**注意**：本工具不提供升级操作按钮。升级通过 CI/CD 或手动命令完成。

---

### 4.6 环境变量查看模块

**功能描述**  
显示当前选择的 App + Environment 对应的环境变量配置（只读）。

**展示内容**

| 变量名 | 值 |
|--------|-----|
| `APP_ID` | `8ad26115-211f-4216-971b-0540f606303d` |
| `CONNECT_KEY` | `com.zenuml.confluence-addon-lite` |
| `BASE_URL` | `https://conf-stg-lite.zenuml.com` |
| `LITE_KEY_SUFFIX` | `-lite` |
| ... | ... |

**说明**：环境变量配置存储在 `.forge-console/config.json` 中，如需修改可直接编辑该文件。

---

## 5. 界面布局

### 5.1 整体布局

**设计理念**：
- Tunnel 状态放在最显眼的位置，它是本地开发的核心
- 简洁直接，不需要动画或复杂的加载效果
- 部署和安装信息只读，供参考

```
┌──────────────────────────────────────────────────────────────────┐
│  Forge Dev Console                                               │
│  ✅ peng@zenuml.com                                    [刷新]    │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  App: [ZenUML Lite ▼]    Environment: [development ▼]            │
│                                                                  │
│  ┌─ 🟢 Tunnel ──────────────────────────────────────────────────┐│
│  │                                                              ││
│  │  Site:    zenuml-stg.atlassian.net                          ││
│  │  Local:   http://localhost:8080                             ││
│  │  Uptime:  2h 15m                                    [Stop]  ││
│  │                                                              ││
│  │  Environment Variables:                                      ││
│  │  APP_ID=8ad26115-211f-4216-971b-0540f606303d                ││
│  │  BASE_URL=https://conf-stg-lite.zenuml.com                  ││
│  │  CONNECT_KEY=com.zenuml.confluence-addon-lite               ││
│  │  [查看全部...]                                               ││
│  │                                                              ││
│  │  Log:                                                        ││
│  │  [14:35:12] GET /descriptor - 200                           ││
│  │  [14:35:13] GET /installed - 200                            ││
│  └──────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ┌─ Deployments (只读) ─────────────────────────────────────────┐│
│  │  Environment    Version    Last Deploy                       ││
│  │  development    v5         2025-01-22 14:30                  ││
│  │  staging        v4         2025-01-20 10:15                  ││
│  │  production     v3         2025-01-15 09:00                  ││
│  └──────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ┌─ Installations (只读) ───────────────────────────────────────┐│
│  │  Site                        Environment                     ││
│  │  zenuml-stg.atlassian.net    staging                        ││
│  │  peng-dev.atlassian.net      development                    ││
│  └──────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────┘
```

### 5.2 Tunnel 未运行时

```
┌──────────────────────────────────────────────────────────────────┐
│  Forge Dev Console                                               │
│  ✅ peng@zenuml.com                                    [刷新]    │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  App: [ZenUML Lite ▼]    Environment: [development ▼]            │
│                                                                  │
│  ┌─ ⚫ Tunnel ──────────────────────────────────────────────────┐│
│  │                                                              ││
│  │  Tunnel 未运行                                               ││
│  │                                                              ││
│  │  [Start Tunnel]                                              ││
│  │                                                              ││
│  │  将使用以下配置启动:                                          ││
│  │  APP_ID=8ad26115-211f-4216-971b-0540f606303d                ││
│  │  BASE_URL=https://conf-stg-lite.zenuml.com                  ││
│  │  ...                                                        ││
│  └──────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ┌─ Deployments (只读) ─────────────────────────────────────────┐│
│  │  ...                                                         ││
└──────────────────────────────────────────────────────────────────┘
```

---

## 6. 技术约束

### 6.1 运行环境
- 本地 Web 服务器（默认端口 `3456`）
- 浏览器访问 `http://localhost:3456`
- 需要 Node.js 20+ 环境
- 需要 Forge CLI 已安装并登录

### 6.2 数据存储
- 配置文件：`.forge-console/config.json`

### 6.3 依赖的外部命令
- `forge whoami` - 检查登录状态
- `forge tunnel` - 启动本地开发隧道
- `forge deploy list --json` - 获取部署历史（只读展示）
- `forge install:list` - 获取安装列表（只读展示）

---

## 7. 配置文件结构

### 7.1 config.json 示例

```json
{
  "version": "1.0",
  "defaultApp": "zenuml-lite",
  "apps": {
    "zenuml-lite": {
      "name": "ZenUML Lite",
      "type": "forge",
      "appId": "8ad26115-211f-4216-971b-0540f606303d",
      "variables": {
        "CONNECT_KEY": "com.zenuml.confluence-addon-lite",
        "SEQUENCE_MACRO_KEY": "zenuml-sequence-macro-lite",
        "CUSTOM_CONTENT_KEY": "zenuml-content-sequence",
        "LITE_KEY_SUFFIX": "-lite",
        "LITE_TITLE_SUFFIX": " Lite"
      },
      "environments": {
        "development": {
          "BASE_URL": "https://localhost:8080"
        },
        "staging": {
          "BASE_URL": "https://conf-stg-lite.zenuml.com"
        },
        "production": {
          "BASE_URL": "https://conf-lite.zenuml.com"
        }
      }
    },
    "diagramly": {
      "name": "Diagramly",
      "type": "forge",
      "appId": "01ede8b1-4e88-451a-b9ef-89eeef93afaf",
      "variables": {
        "CONNECT_KEY": "gptdock-confluence",
        "SEQUENCE_MACRO_KEY": "gpt-diagram-macro",
        "CUSTOM_CONTENT_KEY": "gpt-custom-content-key",
        "LITE_KEY_SUFFIX": "",
        "LITE_TITLE_SUFFIX": ""
      },
      "environments": {
        "development": {
          "BASE_URL": "https://localhost:8080",
          "DIAGRAMLY_BASE_URL": "https://staging.diagramly.ai"
        },
        "staging": {
          "BASE_URL": "https://conf-stg-lite.zenuml.com",
          "DIAGRAMLY_BASE_URL": "https://staging.diagramly.ai"
        },
        "production": {
          "BASE_URL": "https://conf-lite.zenuml.com",
          "DIAGRAMLY_BASE_URL": "https://diagramly.ai"
        }
      }
    },
    "zenuml-full": {
      "name": "ZenUML Full",
      "type": "connect",
      "note": "Connect app - 不在此控制台管理"
    }
  }
}
```

**说明**：
- `manifestTransforms` 和 `preDeploy` 等部署相关配置不在本地开发工具中使用
- 本地开发使用全量 manifest，不做裁剪

---

## 8. 错误处理

### 8.1 常见错误场景

| 错误类型 | 触发条件 | 用户提示 |
|---------|---------|---------|
| 未登录 | `forge whoami` 返回未登录 | "请先运行 `forge login`" |
| Tunnel 启动失败 | `forge tunnel` 返回错误 | 显示错误信息和日志 |
| 配置缺失 | config.json 不存在 | "配置文件未找到，请创建 `.forge-console/config.json`" |

### 8.2 错误提示原则
- 显示具体错误信息
- 提供可操作的解决建议
- 不需要复杂的错误弹窗，直接在界面上显示即可

---

## 9. 未来扩展（P2/P3）

以下功能不在初期版本范围内：

1. **多项目支持** - 支持管理多个不同的 Forge 项目
2. **环境创建** - 支持创建新的 Forge 环境
3. **部署操作** - 从 UI 执行部署（目前由 CI/CD 负责）
4. **升级操作** - 从 UI 执行安装升级

---

## 10. 设计参考

### 10.1 类似产品参考
- ngrok Dashboard - Tunnel 状态展示
- Docker Desktop - 本地开发工具 UI

### 10.2 设计原则
1. **稳定优先** - 功能可靠比视觉好看更重要
2. **上下文感知** - 开发者应随时知道"我在开发什么 App，连着哪个实例"
3. **简洁直接** - 不需要动画、进度条等花哨效果
4. **只做必要的事** - Tunnel 管理是核心，其他只是辅助信息

---

## 11. 验收标准

### 11.1 MVP 功能清单

**Tunnel 管理（核心）**
- [ ] 显示 Tunnel 运行状态（运行中/已停止）
- [ ] 启动 Tunnel（基于当前选择的 App + 环境）
- [ ] 停止 Tunnel
- [ ] 显示当前 Tunnel 使用的环境变量
- [ ] 显示 Tunnel 日志

**基础功能**
- [ ] 显示 Forge 登录状态
- [ ] App 切换下拉框
- [ ] 环境切换下拉框
- [ ] 切换 App/环境时自动停止 Tunnel 并提示重新启动

**只读信息展示**
- [ ] 显示部署历史列表（只读）
- [ ] 显示安装列表（只读）

**其他**
- [ ] 基本错误处理（命令执行失败时显示错误信息）
- [ ] 配置持久化（记住上次选择的 App 和环境）

### 11.2 非功能需求

- 功能稳定可靠，不追求视觉效果
- 支持 Chrome 最新版本（其他浏览器为 nice-to-have）

---

## 附录 A: 术语表

| 术语 | 解释 |
|------|------|
| Forge | Atlassian 的云应用开发平台 |
| Connect | Atlassian 的传统云应用开发框架 |
| Tunnel | Forge 的本地开发隧道，将本地代码连接到 Confluence 实例 |
| Environment | Forge 部署环境（development/staging/production） |
| Manifest | Forge 应用的配置文件（manifest.yml） |

---

## 附录 B: 相关命令参考

本工具封装以下 Forge CLI 命令：

```bash
# 检查登录状态
forge whoami

# 启动本地开发隧道（核心功能）
APP_ID=xxx BASE_URL=yyy CONNECT_KEY=zzz forge tunnel -e development

# 获取部署历史（只读展示）
forge deploy list --json

# 获取安装列表（只读展示）
forge install:list
```
