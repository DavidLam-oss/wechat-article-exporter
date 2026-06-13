# 文章抓取页面：日期筛选

## 背景

`pages/dashboard/article.vue` 当前从 IndexedDB 一次性拉取所选公众号的**全部**已缓存文章，没有日期维度的筛选入口。用户若只想看某一时期（例如「最近一个月」、「2025-06-01 之后」）的文章，只能靠 AG Grid 自带的列过滤器手动一条条加条件，操作繁琐且无法影响「已抓取」「仅显示失败」「批量下载」「导出」等下游操作。

目标：在文章抓取页面顶部新增一个独立的「日期筛选」控件，默认显示全部；启用后 grid 内的全部数据（以及基于 grid 派生的「已抓取」「仅显示失败」「批量下载」「导出」）都被限定在所选日期范围内。

## 设计决策

| 维度 | 决策 |
|---|---|
| UI 位置 | 文章抓取页面顶部 `AccountSelectorForArticle` 右侧；独立于现有设置页的 `syncDateRange` |
| 状态归属 | 组件局部 `ref`，**不**写入全局 preferences |
| 筛选字段 | `update_time`（发布时间） |
| 粒度 | 日（年-月-日），不精确到小时 |
| 默认值 | `all`（不筛选） |
| 持久化 | 不持久化。刷新页面 / 切换账号 → 重置为 `all` |
| 过滤时机 | `switchTableData` 加载完缓存后，应用 `hideDeleted` 同一阶段追加日期过滤，再喂给 grid |

## UI 控件

复用 `BaseDatePicker`（`v-calendar`）和 `USelectMenu` 模式，参考 `components/setting/Misc.vue` 已有的「同步时间范围」实现。

**预设选项**（去掉 `24h`，其余 9 项）：

| value | label | 语义 |
|---|---|---|
| `1d` | 最近一天 | 从昨天 00:00 到今天 23:59 |
| `3d` | 最近三天 | 从三天前 00:00 到今天 23:59 |
| `7d` | 最近一周 | 从七天前 00:00 到今天 23:59 |
| `1m` | 最近一个月 | 从一个月前 00:00 到今天 23:59 |
| `3m` | 最近三个月 | 从三个月前 00:00 到今天 23:59 |
| `6m` | 最近半年 | 从半年前 00:00 到今天 23:59 |
| `1y` | 最近一年 | 从一年前 00:00 到今天 23:59 |
| `all` | 全部 | 不过滤 |
| `point` | 自定义时间 | 起始日期由 `BaseDatePicker` 选择，结束日期 = 今天 23:59 |

**主按钮**：`UButton` + 图标 `i-heroicons-calendar-days-20-solid`，label 随状态动态展示：

- `all` → 「全部」
- `1d`/`3d`/`...` → 「最近一天」/「最近三天」/...
- `point` → `YYYY-MM-DD`（例如 `2025-06-01`）

**交互**：按钮外包 `UDropdown`，点击弹出 9 项预设菜单。最后一项「自定义时间...」点击后**关闭 dropdown + 打开一个 `UPopover`**（包住 `BaseDatePicker`），选择日期后立即关闭 popover 并应用。

## 数据流

```
[AccountSelectorForArticle]
        │ fakeid
        ▼
switchTableData(fakeid)
        │
        ├─ await getArticleCache(fakeid, now)        ← 不变，仍取全量
        ├─ for each article: load metadata/comment/html  ← 不变
        │
        └─ filter:
              ├─ hideDeleted  → 丢弃已删除
              └─ dateRange    → 丢弃 update_time 超出 [lower, upper] 的
        │
        ▼
globalRowData → grid + 所有下游（selectOnlyDownloaded / filterFailed / download / export）
```

下游逻辑**完全不动**：

- `selectOnlyDownloaded`：遍历 `globalRowData` 选中 `contentDownload === true` → 自动限定在日期范围
- `isExternalFilterPresent` + `doesExternalFilterPass`：基于 `globalRowData` → 自动限定
- `useDownloader` / `useExporter`：操作 `selectedArticleUrls` → 自动限定

## 核心逻辑

### `getArticleDateRangeBounds()`

```ts
function getBounds() {
  const now = dayjs().endOf('day').unix()
  const r = articleDateRange.value
  switch (r) {
    case 'all':
      return { lower: 0, upper: now }
    case '1d':
      return { lower: dayjs().subtract(1, 'day').startOf('day').unix(), upper: now }
    case '3d':
      return { lower: dayjs().subtract(3, 'day').startOf('day').unix(), upper: now }
    case '7d':
      return { lower: dayjs().subtract(7, 'day').startOf('day').unix(), upper: now }
    case '1m':
      return { lower: dayjs().subtract(1, 'month').startOf('day').unix(), upper: now }
    case '3m':
      return { lower: dayjs().subtract(3, 'month').startOf('day').unix(), upper: now }
    case '6m':
      return { lower: dayjs().subtract(6, 'month').startOf('day').unix(), upper: now }
    case '1y':
      return { lower: dayjs().subtract(1, 'year').startOf('day').unix(), upper: now }
    case 'point':
      return {
        lower: dayjs.unix(articleDatePoint.value).startOf('day').unix(),
        upper: now,
      }
  }
}
```

### `switchTableData` 改造

```ts
globalRowData = articles.filter(article => {
  if (hideDeleted.value && article.is_deleted) return false
  const { lower, upper } = getBounds()
  return article.update_time >= lower && article.update_time <= upper
})
```

### 响应式

```ts
watch([articleDateRange, articleDatePoint], () => {
  if (selectedAccount.value) {
    switchTableData(selectedAccount.value.fakeid).catch(() => {})
  }
})

watch(selectedAccount, () => {
  // 切换账号时重置为全量
  articleDateRange.value = 'all'
  articleDatePoint.value = 0
})
```

## 边界与异常

| 场景 | 行为 |
|---|---|
| 自定义日期点 = 0（未选择） | 与 `all` 等价（lower=0） |
| 自定义日期晚于今天 | lower > upper → 结果集为空，grid 显示空态 |
| 切换公众号 | 重置为 `all` |
| 缓存里没有任何文章 | grid 现有空态，无新逻辑 |

## 测试计划

### 单元（如果项目有 vitest）

1. `getBounds()` 在 mocked `dayjs` 下，9 种 range 输出正确 lower/upper
2. `filter` 逻辑对 `update_time` 在边界内/边界外/边界值的处理

### 手动验证

1. 默认进入页面 → 显示全部文章
2. 选择「最近一周」→ 仅显示过去 7 天（含今天）发布的文章
3. 选择「自定义时间 → 2025-06-01」→ 仅显示 2025-06-01 之后发布的
4. 切换公众号 → 自动回到「全部」
5. 在筛选范围内点击「已抓取」→ 仅选中范围内的已下载
6. 在筛选范围内点击「仅显示失败」→ 仅显示范围内的失败文章
7. 范围内批量下载 / 导出 → 仅作用于范围内的选中行

## 不在范围内（YAGNI）

- IndexedDB 查询层改造（缓存签名兼容性问题，留待未来）
- 日期范围持久化（用户明确要求「默认全量」）
- 「自定义时间」改为 START + END 双日期（用户明确「起始日期」语义）
- 「按发布时间 / 创建时间」切换（用户已选 update_time）
- 范围筛选的列视图持久化（仅 AG Grid 列状态已有，日期范围本身不持久化）