本文件仅供中文审阅。英文主文件：[SKILL.md](SKILL.md)。规则、执行和后续修改以英文主文件为准；本译本不作为独立 skill 入口。同步日期：2026-09-28。

技能名称：tenant

用途：查询某个 Confluence 站点经核实的产品、许可证、付款、联系人和定价事实。适用于租户资料、付款状态、站点规模、试用和潜在年度价值。复用 Marketplace 导出和独立的 Lite KV 层；采取行动的判断由 `customer-followup` 负责。

# 租户查询

根据 Atlassian Marketplace 许可证/交易数据**以及**Lite Stripe/KV 空间许可证层，回答单个租户的问题。它是 `marketplace` 引擎（`mp_report.py`）上的单租户基础查询——认证方式、cloudId 关联和 SQLite 快照均相同，因此不存在另一套会发生漂移的代码。（脚本实际位于 `marketplace/scripts/` 下；本 skill 按路径引用它，和 `macro-count` 引用 `mixpanel` 脚本的方式相同。）

## 你需要的那条命令

```bash
S=.claude/skills/marketplace/scripts/mp_report.py
python3 $S whois <domain>          # 信息卡：cloudId、用户数、各应用 STATE、累计金额，以及 Lite Layer-B KV
python3 $S whois <domain> --json   # 机器可读（--local 模式会注明数据时间）
```

**对租户的付款状态作任何结论前，都先读取 `whois`**——Marketplace 上天真的 `$0` 是这里最常见的错误答案。

## 信息卡包含的内容（内置的误区）

- **购买和结算是独立的。** 将原始交易与许可证一起检查。当前 `whois` 辅助程序可能把正金额交易标记为 `PAID`，而不检查 `paymentStatus`；其 `PAID`、`paying` 和累计金额都不能独立确认付款。应在 Marketplace 导出/快照中核实原始 `Paid` / `Fully paid` / `Open` 状态、来源 ID 和服务周期。有效的商业订单即使状态为 Open，也能证明发生了购买，但结算仍未确认。不要称该客户未付款或没有订单。
- **Lite → 自动检查 Layer B。** Lite 在 Marketplace 上免费（按设计为 `$0`）；真正的 Lite 付费状态位于 **Stripe/KV 空间许可证**层。`whois` 会调用 `wrangler kv … --remote`（其中已包含 `--remote`——没有它时 wrangler v4 会读取本地状态并错误地返回空结果），并打印 `[Layer B: none / N space-licenses]`。`--no-kv` 会跳过检查（约 2 秒）。
- **cloudId 是关联键。** 交易包含 `cloudId` + 公司名，但没有主机名，因此按主机名进行文本搜索会找到许可证，却漏掉每一笔交易 → 错误的 `$0`。`whois` 按 cloudId 关联；不要自行编写文本搜索。
- **Slug 拼写错误 → 建议项。** 未匹配时会打印相似主机名（`example-tenant-agile` → `example-tenants-agile`）。此示例中的租户标识已匿名化。

## 深入查询（同一脚本）

```bash
python3 $S client <name>   # 单个租户的完整许可证 + 交易历史（“他们以前付过款吗、付了多少、用什么套餐”）
python3 $S tier <domain>   # 快速查询档位 / 许可证类型 / 状态
```

## 确定性 / 离线模式（可选）

`python3 $S sync` 会构建本地 SQLite 快照；之后给任意命令加 `--local`，即可进行逐字节确定、离线且不到 100 毫秒的查询。账务数据可能过时（命令会打印快照年龄，并在超过 24 小时时警告）；`--local` 模式会跳过 Lite Layer-B，并说明这一点。用 `--local` 生成批量/可复现报告；要回答“X 现在有付款吗”，请用实时查询。`sync` 详情见 `marketplace`。

## 报告结构

提供公司/站点、购买证据、经核实的产品/许可证事实、来源报告的付款状态、联系人角色和证据缺口。保留交易/行 ID、销售日期、金额和覆盖期，不要只引用累计总额。若 Lite 未检查，辅助程序的 `paying_any_layer` 可能是未知；但即使为 true，在声称已付款前仍须核实原始 Marketplace/Stripe 数据。应分别检查交易周期/退款和重叠发票；只有 Open 订单时，不得描述为“未找到交易”。

对于购买/续费机会，即使结算状态为 Open，也应把已匹配的有效非零订单加上有效商业许可证作为商业成交，交给 `customer-followup`。排除退款、已取消/作废订单以及纯免费行。暂停中的支持或技术沟通与这一商业事实是两回事。

如需作决策，把事实交给 `customer-followup`。本查询不会授予产品变更、免费延期、外联或安排日程的权限。仅凭“技术联系人”标签不能确定联系人角色。Full 试用到期本身不是催促采购的理由。

潜在定价来自 `marketplace/scripts/mp_pricing.py quote <seats>`，并使用当前已核实档位；报告币种、来源日期，以及该金额是公开标价、报价还是实际交易金额。详细证据和客户身份应保存在 `private/` 中。

相关 skill：`customer-lifecycle`、`customer-feedback`、`customer-followup`、`marketplace`、`macro-count`。
