# ISSUE-005: Data Loader 排序能力不一致与列名拼接安全性

> 状态：待修复
> 日期：2026-05-03
> 影响范围：`py-src/data_formulator/data_loader/` 下的外部数据源 Loader
> 开发者文档：`dev-guides/3-data-loader-development.md`

---

## 1. 问题现象

前端表格预览和连接器预览会通过 `import_options` 向 Loader 传入排序参数：

```python
{
    "size": 1000,
    "sort_columns": ["some_column"],
    "sort_order": "asc"  # or "desc"
}
```

`ExternalDataLoader.fetch_data_as_arrow()` 的契约要求 Loader 在返回数据前按 `sort_columns`
排序，并且排序应发生在 `size` 截断之前。否则用户在预览里点击列排序时，会看到以下不一致行为：

- 部分远端表能正确按源端结果排序。
- 部分文件型 Loader 会读完整文件到内存后本地排序，再截断。
- `local_folder` 完全忽略排序参数，只读取文件后 `slice(0, size)`。
- 部分数据库型 Loader 支持排序，但列名、表名或嵌套字段的拼接方式不够稳，遇到特殊字符列名时可能失败，严重时会扩大查询注入风险面。

当前这个 issue 追踪的是 Superset 之外的 Loader 排序一致性和标识符安全性收敛。

---

## 2. 当前审计结论

| Loader | 当前排序状态 | 主要问题 | 优先级 |
|--------|--------------|----------|--------|
| `local_folder_data_loader.py` | ❌ 未支持 | 忽略 `sort_columns` / `sort_order`，直接按原始文件顺序截断 | P0 |
| `cosmosdb_data_loader.py` | ⚠️ 有支持但高风险 | 注释说 client-side，实际拼 `ORDER BY c.col`；列名未校验或引用 | P1 |
| `kusto_data_loader.py` | ⚠️ 有支持但不稳 | KQL 表名和列名直接拼接，特殊字符和安全性不足 | P1 |
| `bigquery_data_loader.py` | ⚠️ 有支持但不稳 | 直接用 `` `col` ``；未转义反引号；嵌套字段展开后的输出别名可能与排序字段不一致 | P1 |
| `mssql_data_loader.py` | ⚠️ 有支持但不稳 | 使用 `[col]` 包列名，但未转义 `]`；表名/schema 拼接也应统一转义 | P1 |
| `s3_data_loader.py` | ✅ 有支持 | 读完整文件到 Arrow/Pandas 后本地排序再截断，大文件成本高 | P2 |
| `azure_blob_data_loader.py` | ✅ 有支持 | 读完整文件到 Arrow/Pandas 后本地排序再截断，大文件成本高 | P2 |
| `mongodb_data_loader.py` | ✅ 有支持 | 使用 `cursor.sort()`，属于服务端排序；仍可补列名路径校验 | P3 |
| `mysql_data_loader.py` | ✅ 较稳 | `ORDER BY` 走 `_esc_id()`，排序列引用相对安全 | 已可接受 |
| `postgresql_data_loader.py` | ✅ 较稳 | `ORDER BY` 走 `_esc_id()`，排序列引用相对安全 | 已可接受 |
| `athena_data_loader.py` | ✅ 较稳 | 会校验列名，再构造 `ORDER BY` | 已可接受 |

---

## 3. 根因分析

### 3.1 Loader 排序契约没有统一测试

基类文档已经声明 `sort_columns` 和 `sort_order`，但各 Loader 是否遵守“排序后再 limit”没有统一测试矩阵。
因此新增或迁移 Loader 时容易只处理 `size`，漏掉排序参数。

`local_folder` 就是典型例子：它支持 CSV/TSV/Parquet/JSON/Excel 文件读取，也记录了截断前的
`_last_total_rows`，但没有读取 `sort_columns` / `sort_order`，导致预览排序对本地文件无效。

### 3.2 标识符引用策略分散

SQL/KQL/Cosmos Query/BigQuery/MSSQL 的标识符规则不同：

- MySQL/PostgreSQL 已有 `_esc_id()` helper，能处理对应 quote char。
- Athena 通过 `_validate_column_name()` 限制列名形状。
- MSSQL、BigQuery、Kusto、CosmosDB 仍在局部直接拼接排序字段。

这种分散实现容易出现边界行为：

- 列名中包含 quote 字符，例如 `]` 或 `` ` ``。
- 列名包含空格、点号、短横线、中文或其它特殊字符。
- BigQuery 嵌套字段被展开为别名后，前端传回的是输出列名，而 `ORDER BY` 仍按原始字段或错误引用拼接。
- CosmosDB flatten 后的输出列名和源文档路径不一定是一一对应关系。

### 3.3 文件型 Loader 的排序性能没有明确边界

S3 和 Azure Blob 当前为了保证排序语义，会完整读取文件，转换到 Pandas 排序，再 `slice(size)`。
这在小文件预览中行为正确，但对大 CSV/JSON 或大 Parquet 文件可能很重。该问题不是功能缺口，
但需要在文档和测试中明确是“本地排序 fallback”，避免误以为是源端分页排序。

---

## 4. 修复方案

### P0：补齐 `local_folder` 排序支持

**文件**：`py-src/data_formulator/data_loader/local_folder_data_loader.py`

在 `fetch_data_as_arrow()` 中读取：

- `sort_columns = opts.get("sort_columns")`
- `sort_order = opts.get("sort_order", "asc")`

推荐实现：

1. 先完整读取文件为 Arrow Table。
2. 如果存在排序列，校验所有排序列都在 `table.column_names` 中。
3. 使用 PyArrow compute / Table sort 能力优先排序；如果当前 PyArrow 版本不便使用，再转换为 Pandas 排序。
4. 排序完成后再执行 `slice(0, size)`。
5. 保留 `_last_total_rows` 为排序前、截断前的总行数。

验收标准：

- 本地 CSV/Parquet 文件传入 `sort_columns=["amount"]`、`sort_order="desc"` 时，返回前 N 行是全文件排序后的前 N 行。
- 不存在的排序列应抛出清晰错误，不能静默返回未排序数据。
- 排序发生在 `size` 截断之前。

### P1：统一高风险 Loader 的排序字段校验和引用

**文件**：

- `py-src/data_formulator/data_loader/cosmosdb_data_loader.py`
- `py-src/data_formulator/data_loader/kusto_data_loader.py`
- `py-src/data_formulator/data_loader/bigquery_data_loader.py`
- `py-src/data_formulator/data_loader/mssql_data_loader.py`

建议按数据源分别处理，不要把不同方言硬抽成一个过度通用 helper：

#### MSSQL

- 新增或复用 `quote_mssql_identifier(name)`，将 `]` 转义为 `]]`。
- `ORDER BY` 列名、schema、table 都应走同一引用函数。
- 对 `sort_columns` 做类型和非空校验。

#### BigQuery

- 新增 `quote_bigquery_identifier(name)`，将 `` ` `` 转义为 `` \` ``。
- 明确排序字段使用的是输出列别名还是源字段路径。
- `_build_select_parts()` 返回 alias 映射，排序时根据前端列名映射到可排序表达式。
- 对嵌套字段增加测试：例如 `customer.name AS customer_name` 后按 `customer_name` 排序。

#### Kusto

- 使用 KQL bracket quoted identifier 处理表名和列名，例如 `['Table Name']`、`['Column Name']`。
- 转义单引号或拒绝无法安全表示的标识符。
- 对 `sort_columns` 做白名单校验，优先从 schema metadata 中确认列存在。

#### CosmosDB

- 先决定排序语义：源端排序还是 client-side 排序。
- 如果保留源端 `ORDER BY c.<path>`，必须把可排序字段限制为合法的 Cosmos property path，不能直接使用 flatten 后的输出列名。
- 如果改为 client-side，则查询先按 `TOP` 之外的合理上限读取，再在 DataFrame 上排序并截断；同时文档说明性能边界。
- 修正文档注释，避免“client-side”与实际 `ORDER BY` 行为不一致。

验收标准：

- 特殊字符列名不会生成非法查询或注入额外语句。
- 不支持的排序字段以清晰错误失败，而不是静默忽略。
- BigQuery 嵌套字段排序与预览显示列一致。

### P2：明确 S3/Azure Blob 本地排序边界

**文件**：

- `py-src/data_formulator/data_loader/s3_data_loader.py`
- `py-src/data_formulator/data_loader/azure_blob_data_loader.py`
- `dev-guides/3-data-loader-development.md`

短期可保留当前行为，但应明确：

- 这是本地排序 fallback，不是源端排序。
- 排序必须在 `size` 截断前发生。
- 大文件预览可能昂贵，后续可考虑 Parquet row group / dataset scanner / DuckDB external scan 优化。

---

## 5. 测试计划

### 5.1 单元测试矩阵

建议新增或扩展 `tests/backend/data/` 下的 Loader 排序测试：

| 测试 | 覆盖点 |
|------|--------|
| `test_local_folder_sort_before_limit_csv` | CSV 本地文件先排序再截断 |
| `test_local_folder_sort_before_limit_parquet` | Parquet 本地文件排序行为一致 |
| `test_local_folder_invalid_sort_column_errors` | 不存在排序列返回清晰错误 |
| `test_mssql_quote_sort_identifier_with_bracket` | `]` 字符被正确转义或安全拒绝 |
| `test_bigquery_sort_uses_output_alias_for_nested_field` | 嵌套字段展开后的排序列与输出列一致 |
| `test_kusto_sort_rejects_unsafe_identifier` | KQL 排序列不允许注入管道或语句片段 |
| `test_cosmos_sort_rejects_unsafe_property_path` | CosmosDB 排序字段限制为安全 property path |

### 5.2 集成验证场景

手工验证同一份包含乱序数据的表或文件：

1. 创建至少 5 行数据，确保前 2 行不是按目标列排序后的前 2 行。
2. 通过连接器预览传 `size=2`、`sort_columns=[目标列]`、`sort_order=desc`。
3. 返回结果必须是全量数据排序后的前 2 行，而不是原始前 2 行再排序。
4. 用包含空格、中文、quote 字符或嵌套路径的列名覆盖边界行为。

---

## 6. 实施优先级

| 任务 | 优先级 | 复杂度 | 说明 |
|------|--------|--------|------|
| `local_folder` 支持排序 | P0 | 低 | 明确功能缺口，用户可直接感知 |
| CosmosDB 排序语义与字段安全 | P1 | 中 | 当前实现注释和行为不一致，且列名直接拼接 |
| Kusto 标识符引用与校验 | P1 | 中 | KQL 管道拼接风险高于普通 SQL 字段失败 |
| BigQuery 反引号转义与嵌套字段映射 | P1 | 中 | 影响嵌套字段预览排序正确性 |
| MSSQL `]` 转义与表/列引用统一 | P1 | 低 | 改动小，但可消除边界列名失败 |
| S3/Azure Blob 性能边界文档化 | P2 | 低 | 当前功能正确，主要是性能和预期管理 |
| 共用测试矩阵 | P2 | 中 | 防止后续新增 Loader 再次遗漏排序契约 |

---

## 7. 相关文件

| 文件 | 角色 |
|------|------|
| `py-src/data_formulator/data_loader/external_data_loader.py` | Loader 排序契约声明 |
| `py-src/data_formulator/data_loader/local_folder_data_loader.py` | 当前未处理排序参数 |
| `py-src/data_formulator/data_loader/cosmosdb_data_loader.py` | CosmosDB 查询排序字段拼接 |
| `py-src/data_formulator/data_loader/kusto_data_loader.py` | KQL 表名/列名拼接 |
| `py-src/data_formulator/data_loader/bigquery_data_loader.py` | BigQuery 排序字段引用与嵌套字段 alias |
| `py-src/data_formulator/data_loader/mssql_data_loader.py` | SQL Server bracket identifier 转义 |
| `py-src/data_formulator/data_loader/s3_data_loader.py` | 文件型远端本地排序 fallback |
| `py-src/data_formulator/data_loader/azure_blob_data_loader.py` | 文件型远端本地排序 fallback |
| `py-src/data_formulator/data_loader/mysql_data_loader.py` | 相对稳的 SQL 排序实现参考 |
| `py-src/data_formulator/data_loader/postgresql_data_loader.py` | 相对稳的 SQL 排序实现参考 |
| `py-src/data_formulator/data_loader/athena_data_loader.py` | 列名校验参考 |
| `tests/backend/data/` | 建议新增排序契约回归测试 |

---

## 8. 后续建议

修复完成后，建议把“支持 `sort_columns` 的 Loader 必须先排序再 limit，并且排序字段必须经过方言化引用或白名单校验”补入
`dev-guides/3-data-loader-development.md`。这样新增 Loader 时可以把排序契约作为 checklist，而不是依赖逐个实现者记忆。
