本文件仅供中文审阅。英文主文件：[SKILL.md](SKILL.md)。规则、执行和后续修改以英文主文件为准；本译本不作为独立 skill 入口。同步日期：2026-09-28。

技能名称：marketplace

用途：查询 ZenUML 应用在 Atlassian Marketplace 上的实时定价、许可证、交易和收入 cohort。适用于按席位定价、月度/年度报价、平台分成、续费窗口、逾期候选、头部客户和产品组合汇总。区分已记录的购买、来源报告的付款和供应商收款；Open 订单不代表没有发生购买。价格和分成使用 `mp_pricing.py`；批量导出、限定范围的许可证/交易关联和本地快照使用 `mp_report.py`。查询单个租户的状态、资料或试用到期时间时使用 `tenant`，它会复用此引擎；单个租户的价格仍由本 skill 负责。

# Marketplace

通过拉取供应商的 **licenses** 和 **sales transactions** 并在本地关联，回答 ZenUML Marketplace 应用的收入、续费、逾期、套餐等级和**定价**问题。

查询客户状态时，遵循[共享交易证据规则](../customer-data/evidence.md)。购买证据、来源报告的结算状态和供应商收款必须分开处理。有效的非零购买/续费交易加上有效的商业许可证，即构成已记录的商业购买，即使 `paymentStatus=Open` 也是如此；这不属于缺失订单。仅有正值 `vendorAmount` 不能证明已结算。`Paid` 和 `Fully paid` 是来源报告的发票付款状态，并不能证明款项已进入供应商银行账户。

**当前辅助脚本的局限：** `mp_report.py` 仍会根据交易金额计算 `PAID`、`paying`、`lifetime_vendor` 和 `paid_thru`，不会检查付款状态。`client` 也不包含原始付款状态字段。若要得出仅含已付款记录的 cohort 或续费结论，应检查底层 bulk export / SQLite 原始 JSON 并应用共享证据规则；不要把这些汇总标签当作证据。本次 skill 更新不会修改脚本或历史报告值。

两个脚本：`scripts/mp_report.py` 用于许可证和收入，`scripts/mp_pricing.py` 用于查询租户付款金额及我们的净收入。两者都编码了容易出错的规则（见“为什么需要这个脚本”）。不要自行编写 `curl` 分页，也不要凭记忆报价。

## 这个租户要付多少？——`mp_pricing.py`

```bash
S=.claude/skills/marketplace/scripts/mp_pricing.py

python3 $S quote 152        # 152 用户站点的标价，以及我们实际净收入
python3 $S takerate         # Atlassian 的分成，按月从交易中推导
python3 $S validate         # 价格档位表是否仍符合真实续费
python3 $S tiers            # 价格档位表
```

**全年付款和按月付款使用不同的已发布价格结构。** `quote` 和 `tiers` 会读取 Marketplace 实时价格表。年度价格是经核实的席位数所属档位的固定价格；不要把月价乘以十。授权工具会委托给同一实现。如果获取失败或档位覆盖不足，应报告价格未知，不要使用过时的备用值。

配置的单空间参考价为每年 $299；正式商业报价前请核实实际结账金额。是否提及该价格应遵循 `customer-followup` 联系政策：只向站点管理员和全站采购负责人提供 Full。不要硬编码席位盈亏平衡点。

**绝不要把 Atlassian 的分成率写死——必须从数据推导。** 19 个月内它变动过三次：

| period | vendor keeps | cut |
|---|---|---|
| ≤ 2026-03 | 85% | 15% |
| 2026-04 → 2026-07-19 | 80% | 20% |
| 2026-07-20 onward | 100% | **0** |

零分成期被描述为临时安排。每次运行时，`mp_pricing.py quote` 都会从最近 30 天的交易中读取当前分成率，因此不会像本表一样过时。它采用**每笔交易比例中出现次数最多的值**，而不是平均值：切换期间两种费率会并存数周，求平均会算出从未有任何交易按其结算过的费率（2026-08 的 18 笔零分成交易和 2 笔残留的 80% 分成交易，会被平均成虚构的 98.6%）。

**此脚本要防止的两个误区**（均发生于 2026-08-11）：

1. 有回复报价称“Atlassian 抽成 25%，所以每月净收入约 $45.87”。没有任何交易曾按 75% 结算。这个数字毫无依据。
2. 档位表只存在于 `extend-space-license/scripts/grant_extension.py` 中，作为私有函数 `full_plan_arr()` 返回年度金额，因此有人问月价时只能反向推导。`docs/pricing-model.yml` 只涵盖 Lite，并明确声明 Full 定价不在范围内。

`validate` 用于防止档位本身漂移：它会重新对照真实的 Full 月度续费并打印匹配率。2026-08-11 核验结果为 82/102 完全匹配；不匹配项是 1–3 用户站点在周期中途变更档位后按比例结算。如果匹配率下降，说明 Atlassian 修改了价格表，`BANDS` 已过时。

## 快速开始

```bash
# 在 conf-app 仓库根目录运行（凭据会从 .env.forge.local 自动加载）
S=.claude/skills/marketplace/scripts/mp_report.py

python3 $S --app full renewals --from 2026-07-01 --to 2026-07-31   # 本月到期的续费
python3 $S --app full renewals --from 2026-07-01 --to 2026-07-15 --billing annual --paid-only
python3 $S --app full overdue --paid-only                          # 逾期/即将流失的真实付款客户
python3 $S --app full revenue --period annual --top 20             # 年度收入最高的客户
python3 $S --app all client example-tenant-g                       # 单个客户的完整历史
python3 $S --app lite tier example-tenant-a                        # 某租户的档位/许可证
python3 $S whois example-tenant-a                                  # 域名 -> cloudId、用户数、是否付款、累计金额（一张卡片）
# （以上租户 slug 均为占位符——请传入真实 slug；真实名称见 private/ 中的客户资料）
```

任何命令都可加 `--json` 以输出机器可读结果。`--app` 接受别名：`full`、`lite`、`diagramly`、`asyncapi`；也接受 `both`（仅 Full + Lite）、`all`（整个供应商，包括非 ZenUML 应用）、下表中的已知 addon key，或显式的 `com.*` addon key。默认值为 `full`。其他任何值都会产生用法错误（退出码 2，并列出可接受值）——在 2026-09-02 之前，无法识别的值（如 `my-api`）会静默返回所有应用的结果，但标题仍显示 `app=my-api`。

单元检查（不访问网络、不需要凭据）：`python3 .claude/skills/marketplace/scripts/test_mp_report.py`（`python3 -m unittest <path>` 无法导入以 `.claude/` 开头的路径；应改用 `python3 -m unittest discover -s .claude/skills/marketplace/scripts`。）

## 子命令

| command | 回答的问题 |
|---|---|
| `renewals --from D --to D` | `maintenanceEndDate` 落在时间窗口内的许可证，并关联累计收入、计费周期和已付款至日期。可用 `--billing annual\|monthly` 和 `--paid-only` 筛选。这是“谁会在 X 到 Y 之间续费/到期”的查询。 |
| `overdue [--asof D]` | 付费覆盖期已过、仍在宽限期或没有付款方式的客户。`--paid-only` 只保留真实付款客户（累计供应商收入 > 0）。按累计价值排序，让值得联系的客户排在前面。 |
| `client <name>` | 单个租户的完整许可证和交易历史（按公司名/slug 文本搜索）。用于查询“他们以前付过款吗 / 付了多少 / 用什么套餐”。 |
| `revenue [--period] [--top N]` | 按累计供应商收入排序的头部付款客户，并显示计费周期和已付款至日期。`--period annual\|monthly`。 |
| `tier <domain>` | 快速查询租户的档位、许可证类型和状态（决定 Full 套餐价格的数字）。 |
| `whois <domain>` | 跨已安装应用的一张信息卡：身份、用户数、许可证状态和基于交易的汇总。按 cloudId + 产品关联；付款结论前，应从导出数据核实权益、原始状态和来源 ID（见上文的辅助脚本局限）。Lite 会自动检查远程 Stripe/KV；`--no-kv` / `--local` 会明确跳过该层检查。未匹配 slug 时会建议相似主机名；cloudId 可回退到 `_edge/tenant_info`。 |
| `sync` | 将所有应用的许可证和交易快照保存到本地 SQLite DB（`scripts/marketplace.db`，约 1.7k 条许可证 + 约 5k 笔交易，约 14 秒）。之后给任何命令加 `--local`，即可针对快照运行（不到 100 毫秒、离线、无需凭据）。 |

### 本地快照（`sync` + `--local`）——用于批量和跨来源关联

`sync` 会保存每一行的**原始 JSON**，因此加上 `--local` 后，`export()` 层会向每条命令提供完全相同的字典——`whois` / `client` / `revenue` / `overdue --local` 都可直接使用，速度约快 17 倍（0.2 秒对比 3 秒）。它适合**批量**查询（N 个域名）和**跨来源关联**（cloudId 是 Mixpanel `macro_viewed` 与 D1 使用数据的关联键），不适合为了节省一次实时查询的时间。

刷新会写入一个独立数据库，并且只有在所有导出和元数据提交成功后才替换当前快照。刷新失败会保留之前的快照；报告中应分别说明其原始年龄和本次失败尝试。

**需要注意数据新鲜度：** cloudId↔域名身份关系稳定，但**账务（交易、累计金额、档位、状态）会变化**——续费/取消发生后快照就可能过时。`--local` 会在 stderr 打印快照年龄，并在超过 24 小时后警告。若要回答“现在谁在付款”，先执行 `sync`（或直接运行实时查询）。`.db` 文件被 git 忽略（可重新生成，且包含客户敏感数据）。

## 如何理解输出——字段含义

- **`lifetime_vendor`** — 当前辅助脚本对原始带符号交易金额的求和，不按状态筛选已结算款项，也不是银行收款记录。报告已收收入前应检查付款状态和重叠发票。Open 商业订单可以存在而结算尚未确认；无论这种不确定性还是单独的商业许可证，都不能证明没有发生购买。
- **`billing`** — `Annual` / `Monthly`，根据交易中的 `purchaseDetails.billingPeriod` 推导（权威来源）。绝不要根据许可证维护日期的跨度推断计费周期（见上文）；许可证的 `maintenanceStartDate` 反映最新周期，而非周年日期，因此日期跨度会误导。
- **`paid_thru`** — 当前辅助脚本取最新的正金额交易结束日期；尽管名字如此，其中可能包括 Open 订单。称为已付款覆盖期前，应依据原始状态和匹配的订阅/周期重新计算。仅在未来的区间不能覆盖今天。较新的 Open 续费已经记录了一次购买；不要将其标为缺失订单或流失销售。
- **`dunning` / `no-payment-method`** — `invoiceDunningReason = "PAYMENT METHOD IS NOT SET"`。对接近续费日期的活跃客户，这表示**除非客户更新银行卡，否则下一次自动续费会失败**。但这个字段**噪声较大**：从未付款的安装也会出现，因此必须结合 `lifetime_vendor` 阅读。金额为 `$0` 的客户出现无付款方式标志，不代表丢失销售。
- **`grace`** — Atlassian 官方字段 `inGracePeriod = Yes`（付款失败，但目前仍保持活跃）。这是最强的单一“当前逾期”信号，但很少见。
- **`status`** — `active` / `inactive`。访问控制采用**软性执行**，因此年度付款已过期的客户仍可能保持 `active`，并在 `paid_thru` 之后继续使用应用很久——不要把 `active` 理解为“已付款”。

逾期付款候选必须同时具有历史上来源报告的结算记录，以及带日期的覆盖/付款风险信号。较新的订单可能已经完成购买流程，但结算仍未确认。应将这种情况与缺失的续费分开处理；绝不能仅凭 Open 推断缺少购买或付款失败。

### cloudId ≠ 客户——站点迁移造成的假流失陷阱

所有收入关联都以 `cloudId` 为键，但客户迁移 Confluence 站点时会获得新的 `cloudId`：旧许可证变为 `LEGACY_FREE`，看起来像付款客户流失；新站点则看起来像无关的新客户。真实案例（2026-07）：`example-tenant-a.atlassian.net` 曾显示为一个 $5.5k 的过期挽回目标，但该客户实际已迁至 `example-tenant-b.atlassian.net`——状态为 COMMERCIAL、按年续费，已付款至 2027 年（由用户发现，而非工具发现）。示例中的客户标识已匿名化。

**在认定任何付款客户已流失之前，运行迁移双站点检查：** 取出过期许可证的 `contactDetails.technicalContact.email` 域名，并扫描**所有**供应商许可证，查看是否有另一个主机名具有相同联系人域名，且持有活跃的 `COMMERCIAL` 许可证/近期已付款交易。应按技术联系人匹配，而不是账务联系人——账务联系人通常是转售商（例如 `ResellerCo`），会被许多无关客户共用。剩余盲点：如果迁移后的新站点列出的联系人域名不同（例如只列出转售商域名），仍然会漏掉。

## 为什么需要这个脚本（不要绕过它）

朴素的 `curl` 会在三个方面出错，且都已在 `mp_report.py` 中修复：

1. **分页 `?limit=&offset=` 报告端点每页最多返回 50 行**——即使请求 100 行也只返回 50 行。Full 应用交易集约有 4,200 行 → 约 85 次串行请求 ≈ 160 秒，超过 120 秒命令超时。若提前停止，还会静默截断累计收入（曾导致一个 $3,800 客户看起来只有 $337）。**修复方式是使用 bulk export 端点**，它通过一次请求返回整个筛选数据集（约 3–7 秒）：
   `/rest/2/vendors/1215266/reporting/{licenses,sales/transactions}/export?accept=json&addon=…`。
   注意，JSON export 返回的是**裸数组**，不是 `{"transactions": […]}`。
2. **按 `cloudId` 关联许可证 ↔ 交易。** 交易带有 `cloudId` + `customerDetails.company`，但**没有 `cloudSiteHostname`**——用主机名关联会静默地匹配不到任何内容。
3. **计费周期来自交易，而不是许可证日期计算**（见上文）。

认证：`FORGE_EMAIL` / `FORGE_API_TOKEN`（Basic auth），供应商 **1215266**。脚本会在仓库根目录自动发现 `.env.forge.local`；可用 `--env <path>` 覆盖，或导出这两个变量。获取 Marketplace 许可证/交易数据是**只读操作**——但按部署纪律，应将 Marketplace 凭据视为敏感信息，不要回显 token。

## Addon keys

| app | `--app` alias | addonKey | notes |
|---|---|---|---|
| ZenUML **Full** | `full` | `com.zenuml.confluence-addon` | 付费应用；Full 的真实收入来源 |
| ZenUML **Lite** | `lite` | `com.zenuml.confluence-addon-lite` | 免费上架；Lite 付费访问由 Stripe/KV 空间许可证层管理，**不在此处** |
| **Diagramly** | `diagramly` | `gptdock-confluence` | Diagramly 品牌版本；第二个收入应用 |
| **AsyncAPI for Confluence** | `asyncapi` | `my-api` | 第三个收入应用；拥有独立的 Forge 应用身份 |

`sync` 会快照所有四个应用；`--app both` 只包括 Full + Lite。

Lite 是免费的 Marketplace 上架应用，因此按设计，`--app lite` 的 `revenue` / `overdue` 结果几乎为空——Lite 付费访问由独立的 Stripe/KV 空间许可证层执行（见 `extend-space-license` skill 和 `paywall` skill），不属于 Marketplace 交易。

## 示例

**“哪些年度客户会在 7 月续费？其中有人有风险吗？”**
```bash
python3 $S --app full renewals --from 2026-07-01 --to 2026-07-31 --billing annual --paid-only
```

**“哪些客户的付款金额最高？”**
```bash
python3 $S --app full revenue --top 25
```

**“`<tenant>` 实际有向我们付款吗？使用什么套餐？”**
```bash
python3 $S --app all client <tenant-slug>
```

## 相关内容

- `income-radar` — 基于此引擎（`radar` 子命令）的近期现金视图：未来几天到期的续费 + 过去几天错过的付款，并提供金额合计。
- `extend-space-license` — 授予临时 Lite 空间许可证（Stripe/KV 层）。
- `paywall` — Lite 付费墙发布；`metrics` / `macro-count` — 每空间 KV 数据。
- 定价模型：`docs/pricing-model.yml`。双计费层背景见团队记忆。
