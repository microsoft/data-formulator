# ISSUE-003: 主表格仅展示 1000 行 + 排序后水平滚动位置重置

> 状态：待修复
> 日期：2026-04-25
> 影响范围：`SelectableDataGrid`（`src/views/SelectableDataGrid.tsx`）、`tableThunks`（`src/app/tableThunks.ts`）

---

## 1. 问题现象

### 1.1 无法浏览全部数据（仅 1000 行）

用户从 Superset 加载一个包含数万行的数据集后，在主界面的数据表格中向下滚动，最多只能看到约 1000 行数据，无法继续往下浏览。

**根因**：`SelectableDataGrid` 的 `fetchVirtualData` 硬编码 `size: 1000`（第 356/361 行），每次只从后端请求 1000 行。`tableThunks.ts` 的 ephemeral 模式也限制 Redux 中仅保留 `sampleSize = Math.min(1000, fullRowCount)` 行（第 316 行）。

```typescript
// SelectableDataGrid.tsx:350-364
const fetchVirtualData = (...) => {
    let message = {
        table: tableId,
        size: 1000,          // ← 硬编码上限
        method: 'head',
        order_by_fields: [...]
    }
    fetchWithIdentity(getUrls().SAMPLE_TABLE, { ... });
};
```

虽然底层用了 `react-virtuoso` 的 `TableVirtuoso`（支持 DOM 虚拟化——只渲染可视行），但数据源本身就只有 1000 行，所以滚到底就没了。

### 1.2 排序后水平滚动位置重置到最左

用户将表格水平滚动到右侧查看某些列，然后点击某列排序。排序触发 `fetchVirtualData` 重新加载数据 → `setRowsToDisplay(data.rows)` 替换整个数组 → `TableVirtuoso` 用新数据重新渲染 → `TableContainer`（Scroller）重置 `scrollLeft = 0`。

用户体验：每次排序后都需要重新拉回到之前查看的列，非常不便。

---

## 2. 现有架构分析

```
┌─ Redux Store ──────────────────────────────┐
│  table.rows = 1000 行（sample）             │
│  table.virtual = { tableId, rowCount: N }  │
└────────────────────────────────────────────┘
         ↓ props
┌─ SelectableDataGrid ──────────────────────┐
│  TableVirtuoso (DOM 虚拟化)                │
│  rowsToDisplay = 1000 行（内存中全部）      │
│  fetchVirtualData → SAMPLE_TABLE API       │
│    - size: 1000, method: head/bottom       │
│    - 无分页/offset 支持                     │
└────────────────────────────────────────────┘
```

- **TableVirtuoso** 已提供 DOM 层虚拟滚动（只渲染可见行），但它需要拿到**全部数据**或通过回调增量加载。
- 后端 `SAMPLE_TABLE` 端点支持 `size` + `method`（head/bottom/random），但不支持 `offset` 分页。
- ephemeral 模式下全量数据在 IndexedDB 中，但 Redux 只保留 1000 行 sample。

---

## 3. 解决方案

### 3.1 无限滚动（Infinite Scroll） — 推荐方案

利用 `TableVirtuoso` 内置的 `endReached` 回调实现增量加载：

**前端改动**（`SelectableDataGrid.tsx`）：

```typescript
const PAGE_SIZE = 1000;
const [allRows, setAllRows] = useState<any[]>(rows);
const [hasMore, setHasMore] = useState(rowCount > rows.length);

const loadMore = useCallback(async () => {
    if (!hasMore || isLoading) return;
    setIsLoading(true);
    const resp = await fetchWithIdentity(getUrls().SAMPLE_TABLE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            table: tableId,
            size: PAGE_SIZE,
            offset: allRows.length,         // 新增参数
            method: 'page',                 // 新增方法
            order_by_fields: orderBy ? [orderBy] : ['#rowId'],
            order_direction: order,
        }),
    });
    const data = await resp.json();
    if (data.status === 'success') {
        setAllRows(prev => [...prev, ...data.rows]);
        setHasMore(data.has_more);
    }
    setIsLoading(false);
}, [allRows.length, hasMore, orderBy, order]);

// TableVirtuoso 配置
<TableVirtuoso
    data={allRows}
    endReached={loadMore}          // 滚动到底部时自动加载
    overscan={200}                 // 预渲染缓冲行数
    // ...
/>
```

**后端改动**（`SAMPLE_TABLE` 端点）：

```python
# 新增 offset 参数和 page 方法
offset = body.get("offset", 0)
method = body.get("method", "head")  # head / bottom / random / page
order_direction = body.get("order_direction", "asc")

if method == "page":
    sql = f"""
        SELECT * FROM '{parquet_path}'
        ORDER BY {order_clause}
        LIMIT {size} OFFSET {offset}
    """
    rows = execute(sql)
    total = get_row_count(table_name)
    return {"status": "success", "rows": rows, "has_more": offset + len(rows) < total}
```

**优点**：
- 用户体验自然：一直往下滚就能看到所有数据
- 内存可控：每次只追加 1000 行，不会一次加载几十万行到浏览器
- `TableVirtuoso` 原生支持此模式，实现简单
- 后端 DuckDB 对 `OFFSET` 分页高效（Parquet 列式存储）

**排序时处理**：排序触发时清空 `allRows`，重新从 offset=0 加载第一页。

### 3.2 水平滚动位置保持

**方案**：在排序前保存 scrollLeft，数据加载完成后恢复。

```typescript
const scrollerRef = useRef<HTMLDivElement>(null);

// 排序时保存位置
const handleSort = (columnId: string) => {
    const scrollLeft = scrollerRef.current?.scrollLeft ?? 0;
    // ... 触发排序 ...
    // 数据更新后恢复
    requestAnimationFrame(() => {
        if (scrollerRef.current) {
            scrollerRef.current.scrollLeft = scrollLeft;
        }
    });
};

// TableVirtuoso Scroller 组件绑定 ref
Scroller: React.forwardRef<HTMLDivElement>((props, ref) => (
    <TableContainer
        {...props}
        ref={(node) => {
            // 同时绑定 virtuoso 的 ref 和我们自己的 ref
            scrollerRef.current = node;
            if (typeof ref === 'function') ref(node);
            else if (ref) (ref as any).current = node;
        }}
    />
)),
```

**优点**：实现简单，完全在前端处理，无需后端配合。

---

## 4. 实施优先级

| 任务 | 优先级 | 复杂度 | 说明 |
|------|--------|--------|------|
| 后端 SAMPLE_TABLE 增加 offset/page 分页 | P0 | 低 | 基础设施，无限滚动的前提 |
| 前端 SelectableDataGrid 接入 endReached 无限滚动 | P0 | 中 | 核心体验改进 |
| 排序后保持水平滚动位置 | P1 | 低 | UX 改善，独立可做 |
| ephemeral 模式下从 IndexedDB 分页读取 | P2 | 中 | 无服务端时的 fallback |

---

## 5. 注意事项

- **排序 + 无限滚动的交互**：排序改变时必须清空已加载数据，从 offset=0 重新分页。排序顺序由后端保证（DuckDB `ORDER BY` + `LIMIT/OFFSET`），前端不再做内存排序。
- **内存上限**：虽然 `TableVirtuoso` 只渲染可见行 DOM，但 `allRows` 数组仍在 JS 堆中。建议设置一个软上限（如 50,000 行），超过时提示用户使用下载 CSV 功能查看全量。
- **ephemeral 模式**：该模式下全量数据在 IndexedDB，需要另写一个本地分页读取逻辑（从 IndexedDB 按 offset 读取），不经过后端 API。
- **竞态条件**：快速连续排序/滚动时需要取消前一次请求或忽略过期响应（检查请求发出时的排序状态是否与当前一致）。
