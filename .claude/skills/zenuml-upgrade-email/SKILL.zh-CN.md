> 本文件仅供中文审阅。英文主文件：[SKILL.md](SKILL.md)。执行规则与后续修改以英文主文件为准；本译本不是独立 skill 入口。以下英文邮件模板保留原文，方便直接审阅最终话术。

# ZenUML Lite 升级邮件

本 skill 负责**实际邮件文案和 Gmail 草稿**，不负责筛选客户。`customer-followup` 决定联系谁、推什么方案；[customer-tracker](../customer-tracker/SKILL.md)记录经核实的草稿／发送状态。先阅读[客户证据规则](../customer-data/evidence.md)和[联系人政策](../customer-followup/references/contact-policy.md)。真实客户姓名、邮箱和用量不能写进公开 skill。

## 1. 写信前填好事实卡

从当前原始来源取得以下字段。缺失就是**未知**，不是零，也不能猜。

| 字段 | 查证来源 | 邮件里如何使用 |
|---|---|---|
| 收件人、已核实名字、职责、代理商 | 原邮件、Marketplace／租户记录、转介信息 | “技术联系人”不等于站点管理员。 |
| 上次沟通和未解决问题 | Gmail 草稿／邮件线程、工单 | 接住客户问过、拒绝过或我们承诺过的事。 |
| 至少一个该客户特有的理由 | Mixpanel 使用、macro-count 存量、客户请求／反馈 | 只用一两个事实，并注明产品、完整统计窗口和上报日期。 |
| 许可、席位、方案 | Marketplace／租户记录、当前定价实现 | 站点管理员／采购负责人推 Full；单空间方案只给已核实的空间用户和需求。 |
| 当前额度／访问状态 | 产品规则；声称已阻断时还要查租户 paywall／豁免 | 上报超过 100 个宏，**不等于**目前编辑被阻断。 |
| 链接 | 已核实的该租户 Plan and usage URL、当前 Full Marketplace 页面 | 解释各链接的用途；不能猜租户深链。 |

如果没有已核实的客户专属理由，建议不要主动推升级。支持问题未解决时，先处理问题，不要越过问题推销。用户仍明确要求草稿时，写低压力版本，不编数字或紧迫感。关键论断缺证据时，只按需查 `marketplace`／`tenant`、`mixpanel`、`macro-count`、Gmail 或原工单，不重新跑客户排序。

区分**已知账号去重人数**、**图表查看次数**、**新建／更新次数**和**上报的当前宏存量**；Mixpanel 新建次数不是当前存量。选择公平的完整 7／30／90 天窗口，写明日期及产品范围。比较增长时，两段窗口长度、事件口径、账号口径一致；基数有意义才写百分比。Marketplace 点击、试用到期、免费许可或“技术联系人”标签不能证明购买意向或决策权。

## 2. 选一个起稿模板

替换所有占位符，删除没有证据的可选句，再按真实邮件线程调整。如果模板的必填用量取不到，就换成另一个已核实的客户专属事实，或换模板。这些是**起稿文案**，不授权断言示例事实。整封邮件只保留一个主要回复请求。回复既有线程时，沿用其自然称呼和上下文。

### A. 首次联系：已核实的站点管理员／全站许可负责人

只推 Full，**不提** $299 单空间方案。

> **Subject:** ZenUML Full for [ORGANISATION]'s Confluence site
>
> Hi [FIRST NAME],
>
> I'm [SENDER NAME] from ZenUML, the diagramming app your team uses in Confluence. During [COMPLETE WINDOW], [VERIFIED ACCOUNTS] accounts viewed ZenUML diagrams across your site. [OPTIONAL SECOND FACT: dated space inventory or customer request.]
>
> ZenUML Full is the site-wide option for teams using ZenUML across Confluence. [IF THE 100-MACRO ALLOWANCE IS RELEVANT, REPLACE THIS SENTENCE WITH THE ALLOWANCE BLOCK BELOW.]
>
> [INSERT THE VERIFIED PRICE/RESELLER BLOCK IF USEFUL.] [INSERT THE TWO-LINK BLOCK IF BOTH URLS ARE VERIFIED.]
>
> Would it help if I sent you a Full quote?
>
> Best regards,<br>[SENDER NAME]

### B. 联系原申请人／技术联系人：其权限未知

用已知请求或关系开场，不称其为管理员；请其温和地转给负责同事。客户通过代理商采购时，使用下方代理商价格句。

> **Subject:** ZenUML Full for [ORGANISATION]'s Confluence site
>
> Hi [FIRST NAME],
>
> I'm [SENDER NAME] from ZenUML. [KNOWN COLLEAGUE/YOU] previously contacted us about [SPECIFIC SPACE OR REQUEST], so I wanted to share why ZenUML Full may now be relevant to your Confluence site.
>
> During [COMPLETE WINDOW], [VERIFIED ACCOUNTS] accounts viewed ZenUML diagrams across the site. The latest report for **[SPACE]** shows [VERIFIED MACRO STOCK] diagram macros, reported on [DATE]. ZenUML Full would cover the whole Confluence site. [IF THE 100-MACRO ALLOWANCE IS RELEVANT, REPLACE THIS SENTENCE WITH THE ALLOWANCE BLOCK BELOW.]
>
> [INSERT THE VERIFIED PRICE/RESELLER BLOCK IF USEFUL.] [INSERT THE TWO-LINK BLOCK IF BOTH URLS ARE VERIFIED.]
>
> If another colleague handles Confluence app licensing, could you please forward this note to them or introduce us? We can coordinate through your existing reseller if that is easier.
>
> Best regards,<br>[SENDER NAME]

### C. 已有沟通后的跟进

先查最新回复和上次承诺；优先写**上次沟通后的变化**，不再发一封泛泛的推销邮件。比较口径不成立时，删掉增长句。

> **Subject:** [EXISTING SUBJECT]
>
> Hi [FIRST NAME],
>
> Following up on [SPECIFIC PRIOR QUESTION OR REQUEST]. Since our last exchange on [DATE], [METRIC] changed from [BASELINE] to [LATEST] over comparable [WINDOW]-day periods ([PERCENT]% increase). [OPTIONAL: one dated space-inventory fact.]
>
> Full would be the site-wide upgrade. [IF THE 100-MACRO ALLOWANCE IS RELEVANT, REPLACE THIS SENTENCE WITH THE ALLOWANCE BLOCK BELOW.] [INSERT THE TWO-LINK BLOCK IF THE LINKS HELP THIS DECISION.]
>
> Would it help if I [ONE SPECIFIC NEXT STEP: sent a Full quote / clarified the upgrade path / answered a product question]?
>
> Best regards,<br>[SENDER NAME]

### D. 已核实的空间用户：确有单空间需求

必须确认此人确实使用／负责该空间，并核实单空间方案的当前范围和价格。**站点管理员和全站采购负责人不用此模板。**

> **Subject:** ZenUML options for [SPACE] in Confluence
>
> Hi [FIRST NAME],
>
> Following up on your [SPECIFIC REQUEST] for **[SPACE]**. The latest report for that space shows [VERIFIED MACRO STOCK] diagram macros as of [DATE], so I wanted to check what would work best for your team.
>
> A single-space plan would cover **[SPACE]** at [VERIFIED CURRENT PRICE AND PERIOD]. If your team also needs other spaces covered, ZenUML Full is the site-wide option. [ADD A PLAN-AND-USAGE LINK ONLY IF VERIFIED AND HELPFUL.]
>
> Would a quote for **[SPACE]** help you decide?
>
> Best regards,<br>[SENDER NAME]

## 3. 只插入有依据的句块

**额度句块：只有已核实空间达到／接近 100 个宏，或扩容使额度相关时才用。**

> ZenUML Lite has a standard allowance of 100 diagram macros per Confluence space. The latest report for **[SPACE]** shows [COUNT] as of [DATE]. This may not affect your team today, but we may enforce the allowance in the future. Full removes this per-space limit across the site.

使用前核实当前产品规则。如果要说客户**已被阻断**，还必须通过 [paywall](../paywall/SKILL.md) 核实该租户的开关与豁免状态。不能编造执行日期或威胁；模板里已经写过 Full 解除限制时不要重复。

**双链接句块：Full 升级，且两个目的地都已核实时使用。**

> Your licensing team can review the current allowance on your site's [Plan and usage]([VERIFIED_TENANT_PLAN_URL]) page. If they prefer to install Full directly, they can do so from the [ZenUML Full listing on Atlassian Marketplace](https://marketplace.atlassian.com/apps/1218380/zenuml-diagrams-for-confluence).

第一个 URL 必须属于该客户的 Confluence 站点和 Lite 生产应用，核实 app／environment／route。Marketplace 链接是**直接安装 Full 的入口**，不是仅供阅读；使用前核实页面仍有效。无法确认站内深链时，删掉该半句，不能猜。若客户通过现有代理商采购，不要把直接安装写成唯一途径。

**价格／代理商句块：当前席位和价格均已核实时才用。**

> At your current [SEATS] seats, the public annual list price for ZenUML Full is [CURRENCY/AMOUNT]; your existing reseller can confirm the final quote.

以当前 Marketplace 定价实现为准，区分公开标价与代理商最终报价。不承诺未经批准的折扣，不写死席位盈亏平衡点，也不把月价乘十当成年价。无代理商时删掉代理商从句。单空间价格只是内部参考，须核实当前结账／报价后才能对外说。

## 4. 保存并核验草稿

1. 看原邮件线程、当前草稿、真实 To/Cc、主题和任何已定时版本；不创建重复草稿。草稿与发送／定时是不同动作。
2. 以不了解 CRM 的收件人视角通读：须交代 ZenUML **for Confluence**、为何联系他们、所提方案，以及**一个**容易回复的问题。删掉内部缩写、无依据的排名、过时数据和重复请求。
3. 核对每个数字的来源、产品版本、完整窗口和来源时间戳；核对职责、价格、额度说法、代理商措辞和链接目的地。首次联系或间隔较久时，附上已核实的 Confluence 应用名称及 Marketplace 产品链接。已核实名字才用名字；否则用中性称呼。发件人名字和落款要与实际发送账户一致。
4. HTML 每段一个 `<p>`，**段内不硬换行**；另建纯文本版本。HTML 里的空间 key 用**大写加粗**（`<strong>SPACE</strong>`），纯文本大写；链接和源记录中区分大小写的 key 不改。
5. 用户要求写／修改时，对 CLI 已支持的 Gmail 操作使用已认证 `gws`；只要求意见或评审时，先给评审，不暗中修改草稿。CLI 更新前关掉撰写窗口，避免浏览器自动保存覆盖。保留原收件人和线程，写后读回 MIME；必要时用 UI 核验渲染。CLI 认证／权限失败时，报告具体错误并停止该写入，不悄悄改用 UI。
6. 只在用户实际授权范围内发送／定时。执行前复核最终草稿、最新回复、收件人和既有定时消息；定时要核对收件人时区及日期。核验 Gmail 最终状态。用户要求或流程要求更新记录时，将已核实状态、证据日期和消息链接交给 [customer-tracker](../customer-tracker/SKILL.md)。准确报告是**草稿／已定时／已发送**。
7. 创建或修改草稿后，主动建议发送时间。建议必须依据已核实的收件人时区，以及收件人当地的星期几和时间。明确写出收件人当地的具体日期和时间，以及对应的 Australia/Melbourne 具体日期和时间。收件人所在地或时区不确定时，明确标注这一假设，并将换算视为暂定。建议仅供参考，不构成发送或定时授权。
