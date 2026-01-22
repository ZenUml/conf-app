# Forge Dev Console - 数据模型

> 版本: 1.0  
> 日期: 2025-01-22  
> 用途: 供设计师理解数据结构和关系，设计 UI/UX

---

## 1. 背景

我们有一个 Confluence 插件项目，包含多个 App 变体（ZenUML Lite、ZenUML Full、Diagramly），它们**共享同一个代码库和 manifest.yml**。

通过在执行 `forge deploy` 或 `forge tunnel` 时注入不同的环境变量，同一份代码可以部署为不同的 App。

---

## 2. 数据分类

```
┌────────────────────────────────────────────────────────────────┐
│                         数据来源                                │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│   ┌─ 本地配置 ─────────────────────────────────────────────┐   │
│   │  存储: .forge-console/config.json                      │   │
│   │  内容: App 定义、环境变量配置                           │   │
│   │  权限: 可读写                                          │   │
│   └────────────────────────────────────────────────────────┘   │
│                                                                │
│   ┌─ Forge 平台 ───────────────────────────────────────────┐   │
│   │  来源: Forge CLI 查询                                  │   │
│   │  内容: 部署记录、安装记录                               │   │
│   │  权限: 只读                                            │   │
│   └────────────────────────────────────────────────────────┘   │
│                                                                │
│   ┌─ 运行时状态 ───────────────────────────────────────────┐   │
│   │  存储: 内存                                            │   │
│   │  内容: Tunnel 运行状态                                 │   │
│   │  权限: 可读写                                          │   │
│   └────────────────────────────────────────────────────────┘   │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

---

## 3. 实体关系图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            ENTITY RELATIONSHIP                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│                                                                             │
│   ┌─────────┐                                                               │
│   │   App   │  ← 我们定义的应用变体 (ZenUML Lite, Diagramly, ...)           │
│   └────┬────┘                                                               │
│        │                                                                    │
│        │ 1:N                                                                │
│        ▼                                                                    │
│   ┌─────────────────┐                                                       │
│   │ EnvVarsConfig   │  ← 按 Forge Environment 组织的环境变量                 │
│   │ (per Forge Env) │                                                       │
│   └────────┬────────┘                                                       │
│            │                                                                │
│            │ 注入到命令                                                      │
│            ▼                                                                │
│   ┌─────────────────────┐                                                   │
│   │  Forge Environment  │  ← Forge 平台的环境概念                            │
│   │  (dev/stg/prod)     │                                                   │
│   └────────┬────────────┘                                                   │
│            │                                                                │
│            │ 1:N                                                            │
│            ▼                                                                │
│   ┌─────────────┐        1:N        ┌──────────────┐                        │
│   │ Deployment  │ ───────────────── │ Installation │                        │
│   │ (版本记录)   │                   │ (安装到站点)  │                        │
│   └─────────────┘                   └──────────────┘                        │
│                                                                             │
│                                                                             │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │                                                                      │  │
│   │   ┌──────────┐                                                       │  │
│   │   │  Tunnel  │  ← 全局单例，运行时状态                                 │  │
│   │   └──────────┘                                                       │  │
│   │        │                                                             │  │
│   │        ├── 关联一个 App                                               │  │
│   │        ├── 关联一个 Forge Environment (只能是 dev/custom)             │  │
│   │        └── 持有当前注入的 EnvVars                                     │  │
│   │                                                                      │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. 实体详细定义

### 4.1 App（应用）

**来源**: 本地配置  
**说明**: 我们定义的应用变体，共享同一份代码但使用不同的环境变量

| 字段 | 类型 | 说明 | 示例 |
|------|------|------|------|
| id | string | 本地唯一标识 | `zenuml-lite` |
| name | string | 显示名称 | `ZenUML Lite` |
| appId | string | Forge App ID | `8ad26115-211f-4216-971b-0540f606303d` |

**App 列表**:

| id | name | appId |
|----|------|-------|
| `zenuml-lite` | ZenUML Lite | `8ad26115-211f-4216-971b-0540f606303d` |
| `zenuml-full` | ZenUML Full | `d9e4002b-120b-426b-834b-402a4a5adce7` |
| `diagramly` | Diagramly | `01ede8b1-4e88-451a-b9ef-89eeef93afaf` |

---

### 4.2 EnvVarsConfig（环境变量配置）

**来源**: 本地配置  
**归属**: 属于 App，按 Forge Environment 组织  
**用途**: 执行命令时注入，覆盖 manifest.yml 中的默认值

**结构示例** (ZenUML Lite):

```
EnvVarsConfig
├── common (所有环境共用)
│   ├── APP_ID: "8ad26115-211f-4216-971b-0540f606303d"
│   ├── CONNECT_KEY: "com.zenuml.confluence-addon-lite"
│   ├── SEQUENCE_MACRO_KEY: "zenuml-sequence-macro-lite"
│   ├── LITE_KEY_SUFFIX: "-lite"
│   └── LITE_TITLE_SUFFIX: " Lite"
│
├── development
│   └── BASE_URL: "https://localhost:8080"
│
├── staging
│   └── BASE_URL: "https://conf-stg-lite.zenuml.com"
│
└── production
    └── BASE_URL: "https://conf-lite.zenuml.com"
```

**合并规则**: `common` + 特定环境变量 → 最终注入的变量

---

### 4.3 Forge Environment（Forge 环境）

**来源**: Forge 平台  
**说明**: Forge 定义的部署环境

| 名称 | 类型 | canTunnel | 说明 |
|------|------|-----------|------|
| development | development | ✅ | 默认开发环境 |
| staging | staging | ❌ | 预发布环境 |
| production | production | ❌ | 生产环境 |
| peng-dev | custom | ✅ | 自定义开发环境 |
| yanhui | custom | ✅ | 自定义开发环境 |

**重要约束**:
- **staging 和 production 不支持 tunnel**
- 只有 development 和 custom 类型支持 tunnel

---

### 4.4 Deployment（部署记录）

**来源**: Forge 平台（只读）  
**数据来源**: `forge deploy list --json`

| 字段 | 类型 | 说明 | 示例 |
|------|------|------|------|
| environment | string | Forge Environment | `staging` |
| version | string | 版本号 | `v5` |
| deployedAt | datetime | 部署时间 | `2025-01-22 14:30` |

---

### 4.5 Installation（安装记录）

**来源**: Forge 平台（只读）  
**数据来源**: `forge install:list`

| 字段 | 类型 | 说明 | 示例 |
|------|------|------|------|
| site | string | Confluence 站点 | `zenuml-stg.atlassian.net` |
| product | string | 产品类型 | `Confluence` |
| environment | string | 对应的 Forge Environment | `staging` |

---

### 4.6 Tunnel（隧道）

**来源**: 运行时状态  
**说明**: 全局单例，本地开发的核心

| 字段 | 类型 | 说明 | 示例 |
|------|------|------|------|
| status | enum | 运行状态 | `stopped` / `running` / `error` |
| app | string | 当前 App | `zenuml-lite` |
| environment | string | 当前 Forge Environment | `development` |
| activeEnvVars | object | 当前注入的环境变量 | `{APP_ID: "...", ...}` |
| localUrl | string | 本地服务地址 | `http://localhost:8080` |
| logs | string[] | 实时日志 | - |

---

## 5. 核心约束

| 约束 | 说明 | UI 影响 |
|------|------|--------|
| **单 Tunnel** | 同一时间只能有一个 Tunnel 运行 | 全局只显示一个 Tunnel 状态 |
| **Tunnel 环境限制** | 只有 development/custom 环境支持 tunnel | 启动 tunnel 时，环境下拉框过滤掉 staging/production |
| **切换需停止** | 切换 App 或 Environment 前必须停止 Tunnel | 切换时弹出确认提示 |
| **平台数据只读** | Deployment 和 Installation 不可修改 | 这些区域不显示操作按钮 |

---

## 6. 数据流

### 6.1 启动 Tunnel 流程

```
┌─────────────────────────────────────────────────────────────────┐
│                      启动 Tunnel 数据流                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. 用户选择                                                     │
│     ┌─────────────────┐    ┌─────────────────┐                  │
│     │ App: ZenUML Lite│    │ Env: development│                  │
│     └────────┬────────┘    └────────┬────────┘                  │
│              │                      │                           │
│              └──────────┬───────────┘                           │
│                         ▼                                       │
│  2. 加载 EnvVars                                                │
│     ┌─────────────────────────────────────────┐                 │
│     │ common: {APP_ID, CONNECT_KEY, ...}      │                 │
│     │ development: {BASE_URL: "localhost..."}  │                 │
│     └────────────────────┬────────────────────┘                 │
│                          ▼                                      │
│  3. 合并变量                                                     │
│     ┌─────────────────────────────────────────┐                 │
│     │ {                                       │                 │
│     │   APP_ID: "8ad26115-...",               │                 │
│     │   CONNECT_KEY: "com.zenuml...",         │                 │
│     │   BASE_URL: "https://localhost:8080"    │                 │
│     │ }                                       │                 │
│     └────────────────────┬────────────────────┘                 │
│                          ▼                                      │
│  4. 用户点击 [Start Tunnel]                                      │
│                          ▼                                      │
│  5. 执行命令                                                     │
│     ┌─────────────────────────────────────────┐                 │
│     │ APP_ID=... CONNECT_KEY=... BASE_URL=... │                 │
│     │ forge tunnel -e development             │                 │
│     └────────────────────┬────────────────────┘                 │
│                          ▼                                      │
│  6. 更新 Tunnel 状态                                             │
│     ┌─────────────────────────────────────────┐                 │
│     │ status: running                         │                 │
│     │ app: zenuml-lite                        │                 │
│     │ environment: development                │                 │
│     │ activeEnvVars: {...}                    │                 │
│     │ localUrl: http://localhost:8080         │                 │
│     └─────────────────────────────────────────┘                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 切换 App/Environment 流程

```
┌─────────────────────────────────────────────────────────────────┐
│                  切换 App/Environment 数据流                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  当前状态: Tunnel 运行中 (ZenUML Lite + development)             │
│                                                                 │
│  1. 用户选择新的 App 或 Environment                              │
│                         ▼                                       │
│  2. 检查 Tunnel 状态                                             │
│     ┌─────────────────────────────────────────┐                 │
│     │ Tunnel 正在运行？                        │                 │
│     │   ├── 是 → 显示确认弹窗                  │                 │
│     │   └── 否 → 直接切换                      │                 │
│     └────────────────────┬────────────────────┘                 │
│                          ▼                                      │
│  3. 确认弹窗                                                     │
│     ┌─────────────────────────────────────────┐                 │
│     │ "切换将停止当前 Tunnel，是否继续？"       │                 │
│     │                                         │                 │
│     │        [取消]    [确认切换]              │                 │
│     └────────────────────┬────────────────────┘                 │
│                          ▼                                      │
│  4. 用户确认                                                     │
│     ┌─────────────────────────────────────────┐                 │
│     │ a. 停止当前 Tunnel                       │                 │
│     │ b. 更新当前 App/Environment 选择         │                 │
│     │ c. 刷新 Deployment/Installation 数据     │                 │
│     │ d. 显示新的 EnvVars 预览                 │                 │
│     └─────────────────────────────────────────┘                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 7. UI 状态映射

### 7.1 Tunnel 状态 → UI 显示

| Tunnel 状态 | 颜色 | 显示内容 | 可用操作 |
|-------------|------|---------|---------|
| `stopped` | 灰色 | "Tunnel 未运行" + EnvVars 预览 | [Start Tunnel] |
| `running` | 绿色 | App + Env + LocalURL + EnvVars + Logs | [Stop] |
| `error` | 红色 | 错误信息 + Logs | [Retry] |

### 7.2 Environment → UI 可选性

| Environment 类型 | 在 Tunnel 环境选择器中 | 在 Deployment 列表中 |
|-----------------|---------------------|-------------------|
| development | ✅ 可选 | ✅ 显示 |
| custom | ✅ 可选 | ✅ 显示 |
| staging | ❌ 禁用/不显示 | ✅ 显示 |
| production | ❌ 禁用/不显示 | ✅ 显示 |

---

## 8. 示例数据

### 8.1 当前选择: ZenUML Lite + development

```
┌─ 当前上下文 ────────────────────────────────────────────────────┐
│                                                                │
│  App:         ZenUML Lite                                      │
│  Environment: development                                      │
│                                                                │
│  合并后的 EnvVars:                                              │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ APP_ID           8ad26115-211f-4216-971b-0540f606303d  │    │
│  │ CONNECT_KEY      com.zenuml.confluence-addon-lite      │    │
│  │ SEQUENCE_MACRO_KEY zenuml-sequence-macro-lite          │    │
│  │ LITE_KEY_SUFFIX  -lite                                 │    │
│  │ LITE_TITLE_SUFFIX " Lite"                              │    │
│  │ BASE_URL         https://localhost:8080                │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### 8.2 当前选择: Diagramly + staging

```
┌─ 当前上下文 ────────────────────────────────────────────────────┐
│                                                                │
│  App:         Diagramly                                        │
│  Environment: staging                                          │
│                                                                │
│  合并后的 EnvVars:                                              │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ APP_ID           01ede8b1-4e88-451a-b9ef-89eeef93afaf  │    │
│  │ CONNECT_KEY      gptdock-confluence                    │    │
│  │ SEQUENCE_MACRO_KEY gpt-diagram-macro                   │    │
│  │ LITE_KEY_SUFFIX  (空)                                  │    │
│  │ LITE_TITLE_SUFFIX (空)                                 │    │
│  │ BASE_URL         https://conf-stg-lite.zenuml.com      │    │
│  │ DIAGRAMLY_BASE_URL https://staging.diagramly.ai        │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                │
│  ⚠️ staging 环境不支持 Tunnel，只能查看 Deployment 信息          │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

---

## 9. 设计要点总结

1. **Tunnel 是核心** - 放在最显眼的位置，状态一目了然

2. **App + Environment 决定 EnvVars** - 两个选择器联动，选择后立即显示对应的环境变量

3. **环境变量透明** - 始终显示当前/将要使用的环境变量，让开发者清楚"我在用什么配置"

4. **Tunnel 环境限制可视化** - staging/production 在 tunnel 环境选择器中禁用或不显示

5. **切换有代价** - 切换 App/Environment 时如果 Tunnel 在运行，需要确认

6. **只读数据标记** - Deployment 和 Installation 区域明确标注"只读"

7. **稳定优先** - 不需要花哨的动画，状态切换直接、清晰
