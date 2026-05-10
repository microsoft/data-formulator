# ISSUE-008: MAX_IMPORT_ROWS 可配置化 + 基类强制行限制兜底

> 状态：待修复
> 日期：2026-05-11
> 影响范围：`py-src/data_formulator/data_loader/external_data_loader.py`（基类）、所有 DataLoader 子类
> 关联规范：`dev-guides/13-unified-row-limits.md`

---

## 1. 问题总述

当前 `MAX_IMPORT_ROWS = 2_000_000` 是硬编码在源码中的常量，管理员无法根据自身服务器
资源调整上限。同时，行限制的执行完全依赖每个 DataLoader 子类**自觉**在 `fetch_data_as_arrow()`
中写 `min(size, MAX_IMPORT_ROWS)`。已发现 SupersetLoader 和 LocalFolderLoader 未遵循此规范，
且未来新增 Loader 时同样容易遗漏。

---

## 2. 现状分析

### 2.1 各 DataLoader 的行限制实现情况

| DataLoader | 导入 MAX_IMPORT_ROWS | 使用 `min()` 兜底 | 默认值 | 是否合规 |
|------------|:---:|:---:|---|:---:|
| PostgreSQL | ✓ | ✓ | MAX_IMPORT_ROWS | ✓ |
| MySQL | ✓ | ✓ | MAX_IMPORT_ROWS | ✓ |
| MSSQL | ✓ | ✓ | MAX_IMPORT_ROWS | ✓ |
| MongoDB | ✓ | ✓ | MAX_IMPORT_ROWS | ✓ |
| BigQuery | ✓ | ✓ | MAX_IMPORT_ROWS | ✓ |
| CosmosDB | ✓ | ✓ | MAX_IMPORT_ROWS | ✓ |
| Athena | ✓ | ✓ | MAX_IMPORT_ROWS | ✓ |
| Kusto | ✓ | ✓ | MAX_IMPORT_ROWS | ✓ |
| S3 | ✓ | ✓ | MAX_IMPORT_ROWS | ✓ |
| Azure Blob | ✓ | ✓ | MAX_IMPORT_ROWS | ✓ |
| **Superset** | ✗ | ✗ | **100,000** | **✗** |
| **LocalFolder** | ✗ | ✗ | **1,000,000** | **✗** |

### 2.2 `MAX_IMPORT_ROWS` 硬编码

```python
# external_data_loader.py
MAX_IMPORT_ROWS = 2_000_000
```

管理员无法通过环境变量调整。不同部署场景（8GB 内存 vs 64GB 内存）需要不同的上限。

### 2.3 `fetch_data_as_arrow` 是 @abstractmethod，基类无法介入

```python
@abstractmethod
def fetch_data_as_arrow(self, source_table, import_options=None) -> pa.Table:
    pass
```

子类直接覆盖此方法，基类没有任何机会做统一的 size 归一化或结果截断。行限制完全依赖
子类开发者的自觉性，属于"约定"而非"约束"。

---

## 3. 解决方案

### 3.1 `MAX_IMPORT_ROWS` 可配置化

从环境变量读取，硬编码值作为兜底默认：

```python
import os

MAX_IMPORT_ROWS = int(os.environ.get("MAX_IMPORT_ROWS", 2_000_000))
```

管理员在 `.env` 中设置即可生效：

```env
# 后端单次数据导入的最大行数（默认 2000000）
MAX_IMPORT_ROWS=5000000
```

需同步更新：
- `.env.template`：添加 `MAX_IMPORT_ROWS` 说明
- `dev-guides/13-unified-row-limits.md`：更新"限制常量一览"表格，标注可配置
- 前端 Settings 对话框的输入范围上限：当前硬编码 `[100, 2_000_000]`，应从
  `serverConfig` 动态读取后端实际 `MAX_IMPORT_ROWS` 值

### 3.2 基类模板方法强制行限制

使用 **模板方法模式（Template Method Pattern）** 将行限制逻辑收归基类：

**改造前**（当前架构）：

```
外部调用 → fetch_data_as_arrow() [子类实现，靠自觉做 min()]
```

**改造后**：

```
外部调用 → fetch_data_as_arrow() [基类实现，统一做 size 归一化 + 结果截断]
                  ↓
              _fetch_data_impl() [子类实现，只管拉数据]
```

基类代码：

```python
import os
import pyarrow as pa

MAX_IMPORT_ROWS = int(os.environ.get("MAX_IMPORT_ROWS", 2_000_000))


class ExternalDataLoader(ABC):

    def fetch_data_as_arrow(
        self,
        source_table: str,
        import_options: dict[str, Any] | None = None,
    ) -> pa.Table:
        """Public entry point — normalizes size, delegates to subclass, then enforces cap."""
        opts = dict(import_options or {})
        opts["size"] = min(opts.get("size", MAX_IMPORT_ROWS), MAX_IMPORT_ROWS)

        table = self._fetch_data_impl(source_table, opts)

        # Double-guard: even if subclass ignored size, truncate the result
        if table.num_rows > opts["size"]:
            table = table.slice(0, opts["size"])
        return table

    @abstractmethod
    def _fetch_data_impl(
        self,
        source_table: str,
        import_options: dict[str, Any],
    ) -> pa.Table:
        """Subclass implementation: fetch data and return Arrow Table.

        ``import_options["size"]`` is guaranteed to be a valid int
        capped by MAX_IMPORT_ROWS. Subclasses should use it in their
        query (e.g. SQL LIMIT), but even if they don't, the base class
        will truncate the result.
        """
        pass
```

这样**任何子类即使完全不写 size 处理逻辑**，基类也会兜住：

| 场景 | 子类写了 `LIMIT size` | 子类没写 |
|------|:---:|:---:|
| 查询就只返回 size 行 | ✓ 正常 | ✗ 拉回全量 |
| 基类 `table.slice(0, size)` 截断 | 不触发（行数 ≤ size） | **触发，兜住** |

### 3.3 子类迁移

所有子类需要将方法名从 `fetch_data_as_arrow` 改为 `_fetch_data_impl`。
子类中已有的 `min(size, MAX_IMPORT_ROWS)` 代码可以保留（双重保险，无副作用），
也可以简化删除。

涉及文件：

| 文件 | 改动 |
|------|------|
| `external_data_loader.py` | 基类新增模板方法 + `MAX_IMPORT_ROWS` 可配置 |
| `superset_data_loader.py` | 方法改名，删除不规范的 `100_000` 默认值 |
| `local_folder_data_loader.py` | 方法改名，删除不规范的 `1_000_000` 默认值 |
| `postgresql_data_loader.py` | 方法改名（已有 min 可保留） |
| `mysql_data_loader.py` | 同上 |
| `mssql_data_loader.py` | 同上 |
| `mongodb_data_loader.py` | 同上 |
| `bigquery_data_loader.py` | 同上 |
| `cosmosdb_data_loader.py` | 同上 |
| `athena_data_loader.py` | 同上 |
| `kusto_data_loader.py` | 同上 |
| `s3_data_loader.py` | 同上 |
| `azure_blob_data_loader.py` | 同上 |
| `.env.template` | 添加 `MAX_IMPORT_ROWS` 条目 |
| `dev-guides/13-unified-row-limits.md` | 更新文档 |

### 3.4 SupersetLoader 额外修复

除方法改名外，SupersetLoader 还应在 `fetch_data_as_arrow`（改名后为 `_fetch_data_impl`）
返回时检查实际行数是否达到请求的 `row_limit`，在日志中记录 warning。这有助于诊断
Superset 服务端 `SQL_MAX_ROW` 截断问题：

```python
if len(rows) >= size:
    logger.warning(
        "Superset returned %d rows (= requested row_limit %d), "
        "data may be truncated by Superset server SQL_MAX_ROW setting",
        len(rows), size,
    )
```

---

## 4. 影响评估

| 改动 | 影响范围 | 回归风险 |
|------|---------|---------|
| `MAX_IMPORT_ROWS` 可配置 | 低（只改常量来源） | 无（默认值不变） |
| 基类模板方法 | 高（所有 DataLoader 子类改名） | 低（行为不变，只是方法名变化） |
| SupersetLoader 规范化 | 低（单文件） | 无 |
| LocalFolderLoader 规范化 | 低（单文件） | 无 |

---

## 5. 测试要点

### 可配置化
- [ ] 不设环境变量时，`MAX_IMPORT_ROWS` = 2,000,000（默认值不变）
- [ ] 设 `MAX_IMPORT_ROWS=500000` 后，导入超过 50 万行的数据被截断到 50 万
- [ ] 设无效值（如 `MAX_IMPORT_ROWS=abc`）时启动报错或回退到默认值

### 基类模板方法
- [ ] 子类正常实现 `_fetch_data_impl` + 内部 LIMIT → 返回行数 ≤ size
- [ ] 子类故意不做 LIMIT（模拟开发者遗漏）→ 基类 `slice()` 截断生效
- [ ] 外部传 `size=999999999` → 被基类归一化为 `MAX_IMPORT_ROWS`
- [ ] 外部不传 `size` → 默认使用 `MAX_IMPORT_ROWS`
- [ ] `ingest_to_workspace` 路径正常工作（它调用 `fetch_data_as_arrow`）
- [ ] `fetch_data_as_dataframe` 路径正常工作（它也调用 `fetch_data_as_arrow`）

### SupersetLoader
- [ ] 导入 Superset 数据时 size 使用 `MAX_IMPORT_ROWS`（不再默认 100,000）
- [ ] Superset 服务端 `SQL_MAX_ROW` 低于请求值时，日志中有 warning
