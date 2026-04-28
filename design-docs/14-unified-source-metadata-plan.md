# 统一数据源元数据方案

> 状态：历史设计摘要，主体实现已迁移到开发规范
> 最后更新：2026-04-28

## 背景

外部数据源会提供数据库表注释、字段注释、BI 数据集描述、报表或仪表盘描述等语义提示。统一源元数据链路的目标是让这些信息在 catalog、preview、import、refresh、Workspace 持久化和 Agent 上下文中保持一致。

源元数据始终是 **best-effort 辅助信息**：

- 元数据读取失败不能阻断 catalog 浏览、preview、import、refresh 或源端筛选。
- 数据正确性由 `fetch_data_as_arrow()` 和持久化后的 parquet 内容决定。
- 元数据用于提升用户理解、AI 上下文质量和数据发现体验，但不是加载数据的必要依赖。

## 当前实现状态

本方案的主链路已经实现，开发约定迁移到：

- [dev-guides/3-data-loader-development.md](../dev-guides/3-data-loader-development.md)：Loader 侧元数据契约、轻量 `list_tables()`、`get_metadata()` / `get_column_types()` 返回形状、best-effort 失败策略。
- [dev-guides/9-workspace-storage-architecture.md](../dev-guides/9-workspace-storage-architecture.md)：`workspace.yaml` 中 `TableMetadata.description` / `ColumnInfo.description`、`catalog_cache/`、系统描述与用户描述职责分离。

已落地的代码主干：

- `ColumnInfo.description` 和 `TableMetadata.description` 持久化。
- `ExternalDataLoader.ingest_to_workspace()` import 时 best-effort 合并源系统表/列描述。
- refresh 时重新拉取源 metadata，并按源系统结果更新只读描述。
- `/api/tables/list-tables` 返回表描述和列描述。
- `/api/connectors/preview-data` 返回表描述、列 `source_type` 和列描述。
- PostgreSQL、MySQL、MSSQL、Kusto、Athena、BigQuery、Superset 等高价值 Loader 已接入源描述能力；无原生描述的 Loader 保持可选缺省。
- `catalog_cache/<source_id>.json` 保存用户级轻量 catalog 快照，供 Agent 搜索。
- Agent 使用 `WorkspaceMetadata.search_tables()` 和 `search_catalog_cache()` 做两层只读搜索；`generate_data_summary()` / `get_field_summary()` 会使用表/列描述。

## 保留的设计决策

### 两类描述互不覆盖

`TableMetadata.description` / `ColumnInfo.description` 是源系统只读描述，写入 `workspace.yaml`；`DictTable.attachedMetadata` 是用户手写描述，写入前端 session state。源系统 import / refresh 永远不覆盖 `attachedMetadata`。

### 轻量 catalog 与详细 preview 分离

`list_tables()` 用于 catalog 缓存和发现，应只读取低成本 metadata，不应逐表执行 `SELECT * LIMIT ...`、`COUNT(*)` 或读取大文件样本。样本行和真实数据读取仍由 preview/import 路径负责。

### Catalog cache 是用户级资源

连接器是用户级资源，catalog cache 也存放在 `users/<identity>/catalog_cache/<source_id>.json`，不进入 workspace。Agent 搜索按需读取当前用户 cache，缓存不存在时跳过，不触发远程拉取。

### 元数据合并语义

- `description` key 存在且值为空字符串：源端明确清空描述，持久化时清为 `None`。
- `description` key 缺失：本次源端未提供该字段，保留已有描述。
- 列描述按列名匹配合并。
- metadata 合并失败不影响数据导入或刷新。

## 未完成或部分完成项

这些内容不应写成已完成规范，后续如果继续实现，需要独立设计或 PR：

1. `source_metadata_status`

   原设计希望在 `CatalogNode.metadata` 暴露 `source_metadata_status`（如 `ok`、`partial`、`unavailable`），用于 UI 提示 metadata 拉取状态。当前代码没有生产或消费该字段。

2. Catalog 树虚拟化

   前端仍使用 MUI `SimpleTreeView` / `TreeItem`。`react-arborist` 或 `@tanstack/react-virtual` 尚未引入，5000+ 节点全量虚拟滚动仍是后续优化。

3. Preview 表头列描述

   当前列描述主要在筛选列选择器 tooltip 中展示；数据预览表头尚未统一展示列级描述。

4. Workspace 主 UI 列级系统描述

   `/api/tables/list-tables` 已返回 `columns[].description`，但前端 `buildDictTableFromWorkspace()` 还没有把列描述写入 `DictTable.metadata` 供主 UI 通用展示。

5. Catalog cache 搜索引擎

   当前第二层搜索是 Python 读取 JSON 后做子串匹配。早期 DuckDB `read_json_auto()` / SQL 查询方案未落地，可作为未来性能优化，不再作为当前契约。

6. Agent 远端数据读取与自动导入

   当前 Agent 只能读取已导入 workspace 表的内容；未导入 connected 数据源只能通过 `catalog_cache` 搜索 metadata。后续需要设计受控的远端 preview/read 工具，让 Agent 或人工搜索结果可以读取小样例、schema 和统计信息，并在用户确认后 import 到 workspace。该能力必须包含权限校验、行数上限、超时、审计日志、source filters 和命名/去重策略。

7. 高级搜索引擎

   当前计划只应先实现 DuckDB Grep/Search 底座：统一 searchable fields、字段权重、token/子串匹配、annotation overlay 和结果解释字段。完整全文搜索、fuzzy match、query parser、embedding/semantic search、物化索引等能力应作为后续独立设计。

## 相关文档

- [14.1-source-metadata-dev-plan.md](./14.1-source-metadata-dev-plan.md)
- [3-data-loader-development.md](../dev-guides/3-data-loader-development.md)
- [9-workspace-storage-architecture.md](../dev-guides/9-workspace-storage-architecture.md)
- [5-data-connector-api.md](../dev-guides/5-data-connector-api.md)
- [7-unified-error-handling.md](../dev-guides/7-unified-error-handling.md)
