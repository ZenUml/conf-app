本文件仅供中文审阅。英文主文件：[SKILL.md](SKILL.md)。规则、执行和后续修改以英文主文件为准；本译本不作为独立 skill 入口。同步日期：2026-09-28。

技能名称：income-radar

用途：查看 ZenUML 应用在 Atlassian Marketplace 上近期的现金情况：未来几天预计会有多少供应商收入（客户订阅续费），以及过去几天哪些付款客户漏付了款（续费已过期 / 处于宽限期 / 付款方式失效）。当用户询问“我预计会有多少收入”“这周会到账什么”“近期有续费吗”“有人漏付了吗”“谁逾期了”“未来几天的收入预测”，或需要每日付款动态时使用。基于 `marketplace` 引擎构建（许可证 + 按 cloudId 关联的交易），仅付款客户，涵盖所有收入应用。查询累计收入 / 头部付款客户 / 完整的指定时间窗口续费审计时使用 `marketplace`；查询单个租户的付款状态时使用 `tenant`。

# 收入雷达

基于 `marketplace` 引擎的每日近期现金视图：哪些款项即将到账，哪些已经错过。

## 快速开始

```bash
# 在 conf-app 仓库根目录运行（凭据会从 .env.forge.local 自动加载）
S=.claude/skills/marketplace/scripts/mp_report.py

python3 $S radar                 # 默认：以今天为中心的前后 7 天
python3 $S radar --days 14       # 扩大时间窗口
python3 $S radar --asof 2026-07-01 --json
python3 $S radar --local         # 离线，使用上次 `sync` 的快照（快速，无需凭据）
```

使用 `--local` 前需要先有快照（运行 `python3 $S sync`，约 14 秒，在 `marketplace` 目录执行）。

## 报告内容

包含两个部分：

- **INCOMING（即将到账）** — 未来 N 天内到期的续费，合计为预期收入。每一行都带有与 MISSED 相同的付款风险 `flags`；标题还会单独列出预期总额中处于风险卡片/失效卡片上的金额（续费带有 `no-payment-method` 标志，是续费下个周期失败并进入 MISSED 的**领先指标**）。
- **MISSED（已错过）** — 过去 N 天内已过期且没有新付款到账的付款客户续费，合计为风险收入。
- **EVALUATIONS（试用）** — 未来 N 天内即将到期的试用（这是账务观察窗口，不是联系他们的指令），或过去 N 天内已到期的试用。这是生命周期信号，**不是收入**——单独显示，不计入金额合计。每行显示 `converted`（该租户 + 应用是否已有付费交易）。排除 Lite（免费，没有付费转化）。

范围：**所有收入应用**（Full + Diagramly + AsyncAPI；Lite 是免费的 Marketplace 上架应用，因此此处约为 `$0`——其付费层由 Stripe/KV 管理，见 `extend-space-license` / `paywall`）。**仅付款客户**——累计供应商收入 > 0 的客户。过去从未付款的试用或免费安装不会出现在任何一个类别中。

在把这些候选记录报告为已付款 cohort 之前，应在原始交易中核实来源明确报告的 `Paid` / `Fully paid` 状态：当前辅助程序基于金额的汇总不会执行此项检查。仅有 Open 订单能证明购买发生，但结算尚未确认，不能证明收入已到账。历史付款客户较新的 Open 续费，应与缺失续费分开处理；不要称该客户“没有购买”，也不要自动催促他们。重叠发票或尚未解决的退款会使金额总计存在不确定性。

每个订阅按 **(tenant, app)** 显示一行——同时为 Full 和 Diagramly 付款的租户会显示两行（对应两笔真实续费）；有付费 Full 许可证加上一条遗留免费 Lite 上架记录的租户只显示一行（Lite 空类别金额为 `$0`，会被排除——因此收入按 `(cloudId, addonKey)` 汇总，而不只按 cloudId 汇总，避免虚假的 Lite 行重复计算 Full 收入）。排除 ZenUML 自有内部实例（`zenuml`、`zenuml-connect`）。

## 定义

- **`paid_thru`** — 辅助程序给出的最新正金额交易结束日期；将其称为已结算覆盖期之前，应核实原始状态。未来才开始的区间不覆盖今天。它不是供应商收款日期。
- **预期金额** — 该客户最近一笔*已付款*交易的 `vendorAmount`（最可能在下一周期重复的金额）。
- **INCOMING：** `today <= paid_thru <= today + N`。
- **MISSED：** `today - N <= paid_thru < today`——没有更新的已付款交易将覆盖期延长到今天之后。再通过 `inGracePeriod = Yes` 和 `invoiceDunningReason`（`no-payment-method`）标志加强判断；许可证本身已失效时也会显示 `inactive`。

## 输出

**默认（文本）：** 标题之后是四个部分，每部分由标题和对齐表格组成。空部分会打印 `(none)`。在 `--local` 模式下，`[local snapshot @ … (Nh old)]` 行会输出到 **stderr**，保持 stdout 清洁。

```text
=== income radar  asof=YYYY-MM-DD  window=+/-Nd  (all revenue apps, payers only) ===

INCOMING (next Nd): C renewals, ~ $T expected  (at-risk on flagged cards: $R)
  due  app  billing  amount  flags  tier  company  host  entitlement
MISSED (past Nd): C renewals overdue, ~ $T at risk
  paid_thru  days_late  app  billing  amount  flags  company  host  entitlement
note: … (3 lines on renewal-timing-as-proxy)
EVALUATIONS expiring (next Nd): C trials — conversion window (not income)
  expires  app  tier  status  converted  company  host  entitlement
EVALUATIONS expired (past Nd): C trials
  expires  days_ago  app  tier  converted  company  host  entitlement
```

**`--json`：** 一个对象。金额总计只出现在收入部分；按设计，试用部分没有总额（试用金额为 `$0`）。每个 `rows[]` 条目都包含其所在部分列出的字段。

```json
{
  "asof": "YYYY-MM-DD", "days": N,
  "incoming": { "total": <$>, "at_risk": <$>, "count": <n>, "rows": [ { "company","host","entitlement","app","billing","amount","tier","flags","due" } ] },
  "missed":   { "total": <$>, "count": <n>, "rows": [ { …, "paid_thru", "days_late" } ] },
  "evaluations": {
    "expiring": { "count": <n>, "rows": [ { "expires","app","tier","status","converted","company","host","entitlement" } ] },
    "expired":  { "count": <n>, "rows": [ { …, "days_ago" } ] }
  }
}
```

## 注意事项

日期表示客户续费时间，是收入的**代理指标**，不是付款发放计划。Atlassian 按自己的月度周期向供应商付款，不受某个客户的续费日期影响。最近 1–2 天内刚过期的记录可能只是结算延迟，并不是真正漏付——将最新的 MISSED 行视为收入流失前，应查看宽限期 / 无付款方式标志。

## 快速路径（`--local`）

`--local` 会读取共享的 `marketplace` SQLite 快照，而不是访问实时 API。先运行 `python3 $S sync` 来构建/刷新快照。命令会在 stderr 打印快照年龄，并在超过 24 小时时警告——若要回答“今天实际是什么情况”，请改用实时查询（收入雷达对账务很敏感；其他快照查询所依赖的 cloudId↔域名身份关系则不同）。

## 相关内容

- `marketplace` — 共享引擎（`mp_report.py`、`sync`）、累计收入、头部付款客户，以及完整的指定时间窗口续费审计（`renewals --from --to`）。
- `tenant` — 单租户查询（“`<domain>` 是否付款、规模多大、当前状态如何”）。
- `extend-space-license` / `paywall` — Lite Stripe/KV 层；Lite 付费访问不在 Marketplace 交易中，因此不会出现在此雷达中。

## 后续处理边界

这里只提供只读事实和证据缺口。试用截止日期本身不构成紧迫性、自动付款失败，也不授予联系客户的权限。状态变更使用 `customer-lifecycle`；决策使用 `customer-followup`。Marketplace 的 `all` 可能包含本文档之外的供应商产品；报告时应说明实际产品范围。
