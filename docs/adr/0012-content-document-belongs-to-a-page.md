# ADR-0012 内容文档的归属：custom content、页面、space 与 macro 实例

**状态：** 已接受（2026-11-14，负责人确认 D1–D4；Q4 待定）
**范围：** 所有把内容存为 Confluence custom content 的 macro（Diagram、Graph、OpenAPI、AsyncAPI、Embed）。图表评论、导出附件、D1 镜像等功能都以本 ADR 为前提，本 ADR 不依附于任何单个功能。

## 1. 为什么需要这份决定

内容文档（GLOSSARY：Content document）存成 custom content（下称 CC）。CC 必须有且只有一个父级：页面、blogpost 或 space（`manifest.yml` 的 `supportedContainerTypes`）。macro 实例只在配置里存 CC 的 id。三者的关系一直写在代码里，没有成文；新功能（图表评论）需要回答"一张图属于哪里"，答案必须先定下来。

## 2. 现状（as-built，均有代码出处）

```
Space
 └─ Page P（父级）
     ├─ CC  (type = <variant>:<macro type>, body = 内容文档 JSON)
     └─ macro 实例 M（ADF 节点，localId；config.customContentId = CC.id）
Page Q
 └─ macro 实例 M'（复制或 Embed，config.customContentId 也 = CC.id）  ← 非归属引用
```

| # | 事实 | 出处 |
|---|---|---|
| A1 | 新建 CC 的父级是**当前页面**；页面 id 不可用（草稿页 id 为 `"0"`、space dashboard 没有页面）时退回到 **space** | `src/model/ApWrapper2.ts:330-343`，`src/utils/pageId.ts:6-10` |
| A2 | 生产数据：2026-08-01 后新建的 CC，27,366 个以页面为父级，2 个以 space 为父级 | prod D1 `CustomContent.pageId`（2026-11-14 查询）；该列来自 Confluence 返回的 CC `pageId`，见 A9 |
| A3 | macro 配置只存 `customContentId`、`updatedAt`，旧数据还有 `uuid`；`localId` 不写入配置 | `src/forgeIndex.ts:1571-1575`，`src/model/ContentProvider/Persistence.ts:73-80` |
| A4 | 加载顺序：按 id 读取 → 404 时在**宿主页面**的 CC 子项里找孤儿 → 旧 content property → 按 uuid 的 CQL 搜索 → 页面快照附件 | `src/forgeIndex.ts:606-821`，`ApWrapper2.ts:770-829, 992-1037` |
| A5 | 复制：宿主页面 ≠ CC 父级页面时判定为跨页复制；同页多个 macro 引用同一 id 时判定为同页重复。被判定为复制的文档保存时**新建** CC（父级为当前页面），原 CC 不动 | `ApWrapper2.ts:685-693, 748-757, 1429-1476`；`CustomContentStorageProvider.ts:34-40` |
| A6 | 更新时把已有父级原样写回，**代码从不改变 CC 的父级** | `ApWrapper2.ts:510`；`AsyncApiDashboard.vue:729-730` |
| A7 | Embed 只存被选 CC 的 id，选择器不按页面或 space 过滤，可以指向别的页面上的 CC；父页面已删除的 CC 不出现在选择器里 | `src/forge-embed-editor.ts:43-50, 135`；`ApWrapper2.ts:1105-1177` |
| A8 | 查看历史页面版本时，按时间取 CC 版本（取早于该页面版本时间的最新 CC 版本），两者之间没有显式的版本对应关系 | `ApWrapper2.ts:1047-1070` |
| A9 | D1 `CustomContent.pageId` 是 CC 的父级页面（以 space 为父级时为空），只在插入时写入，之后不再更新 | `functions/forge-custom-content.ts:139-148` |
| A10 | 新建 CC 需要 space 的"添加附件"权限；更新已有的 CC 只需要"添加页面"（代码注释，2026-08-30 lite-stg 验证） | `src/model/saveFailureDiagnosis.ts:5-16` |

## 3. 决定（提请确认）

**D1. 一个内容文档归属于一个页面。** CC 的父级就是它的归属页面。以 space 为父级只是没有页面时（草稿、space dashboard）的兜底，不是一种独立的归属方式。

**D2. 一个页面上的一个 macro 实例才是"这张图"的家。** 归属页面上引用该 CC 的 macro 实例是归属引用；其他引用都是非归属引用：
- 跨页复制：可以查看；编辑时分叉成归属于新页面的新 CC（保持 A5 现状）。
- 同页重复：编辑前拦截（保持现状，`editDupGate.ts`）。
- Embed：只读引用另一页面的内容文档，不拥有它。

**D3. 挂在"一张图"上的功能，以 (页面, CC) 为单位，不以 CC 单独为单位。** 同一个 CC 在两个页面出现时，是两个上下文。后续功能（评论、导出附件、用量统计）都按这个单位设计；需要跨页面聚合时，必须在功能设计里单独说明理由。

**D4. 不移动 CC 的父级。** 保持 A6：不在发布、复制、编辑时改父级。以 space 为父级的 CC 的处理见第 5 节问题 Q1。

## 4. 对功能的影响

| 功能 | 依据本 ADR 的结论 |
|---|---|
| 图表评论（#1047） | 评论写成**读者所在页面**的页面底部评论，用 `zenumlDiagram=<CC id>` 关联（D3）。Embed 和复制出来的引用在自己的页面上各自讨论 |
| D1 镜像 | `pageId` 即归属页面（A9），可以直接用于按页面统计 |
| 孤儿恢复 | 只在宿主页面的子项里找，和 D1 一致；以 space 为父级的 CC 找不到（A4） |

## 5. 平台行为验证（2026-11-14，lite-stg）与未解决问题

测试对象都在 space SD：测试页面 402752063 和 403013633，测试 CC 通过 Forge bridge 创建（与产品代码的创建路径相同）。

| # | 问题 | 观察结果 | 结论 |
|---|---|---|---|
| Q1 | 以 space 为父级的 CC，保存时会不会分叉？ | 以 space 为父级的 CC（402915942），v2 的 POST 和 GET 响应里**完全没有 `pageId` 字段**。`saveCustomContentV2` 中 `samePage = !pageId \|\| pageId === existing.pageId`，在任何页面上都为 false，所以会新建 CC。prod D1 中 2026-08-01 后以 space 为父级的只有 2 条，都是 AsyncAPI dashboard 文档（保存时用 `pinToId` 固定 id），**图表 CC 为 0** | 代码路径会分叉（由字段和代码推断，没有跑草稿→发布的端到端流程）；生产中草稿兜底实际没有触发。风险低，记为已知缺口 |
| Q2a | 复制页面会不会带上子 CC？ | REST copy（`copyCustomContents:true`）和界面上的"Make a copy"都会给新页面**新建一份 CC**（新 id、同样的标题，界面复制时新页面还是草稿就已经建好）；原 CC 不变 | 复制页面时，平台会把子 CC 复制到新页面。新页面上 macro 的配置是否仍指向原 id，这次没有测（测试页面上没有 macro）；代码按"仍指向原 id"处理（A5 的跨页复制判定、A4 的孤儿恢复） |
| Q2b | 移动页面 | 同一 space 内：CC 是页面的子项，随页面移动（没有单独测）。移到别的 space：robot 账号得到 403，**没有测成** | 跨 space 移动仍未知 |
| Q2c | 删除页面 | 页面移入回收站后，子 CC 的 GET 返回 404（加上 `status=trashed` 也一样）；从回收站恢复页面后，CC 回到 200 / current | CC 随页面进出回收站 |
| Q3 | 页面限制是否作用于子 CC？ | 把页面 402752063 的查看权限限制为只有 robot 后，另一个账号读该页面和它的子 CC（402784905）**都得到 404**；限制之前都是 200。测试后已移除限制 | 子 CC 继承页面的查看限制 |
| Q4 | Embed 上的评论应该挂在宿主页面，还是被 Embed 的 CC 的归属页面？ | 第 4 节暂定为宿主页面 | 负责人决定 |

这些结果支持 D1–D4：在复制、删除、权限上，平台本身就把 CC 当作页面的子内容对待。

## 6. 后果

- 好处：归属单一，权限跟随页面，评论、附件、通知都有明确的上下文。
- 代价：同一张图在多个页面使用时，数据和讨论分散在各页面；跨页面聚合需要额外设计。
- 以 space 为父级的 CC 是已知的例外，数量很少（A2），但 Q1 可能造成静默分叉，需要优先验证。
