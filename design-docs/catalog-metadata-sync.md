---
name: catalog metadata sync
overview: 本轮核心功能已全部实现并迁移至开发者文档。此文件仅保留未来迭代的设计 TODO。
isProject: false
---

# Catalog Metadata Sync — 后续设计 TODO

> **已实现部分**已迁移至 [`dev-guides/11-catalog-metadata-sync.md`](../dev-guides/11-catalog-metadata-sync.md)。
> 包括：catalog_cache / catalog_annotations 存储、table_key 契约、Metadata 合并策略、
> Sync API / Annotation API、Loader override（Superset / PostgreSQL / MSSQL）、
> DuckDB 搜索底座、Agent 工具链（search_data_tables / read_catalog_metadata）、
> 前端 sync 浏览模型、错误码、i18n、连接生命周期、测试。

---

## 远端数据内容读取工具

Agent 当前只能读取已导入 workspace 表的内容；未导入 connected 表本轮只支持搜索 metadata 和读取 catalog metadata。

后续需要设计 `preview_remote_table` / `read_remote_sample` 类工具，用于基于搜索结果读取远端表样例行、schema 和统计信息。

约束：
- 行数限制
- 权限校验
- 超时控制
- 审计日志
- 脱敏策略
- 不能变成任意远端查询入口

## Agent 自动导入工具

后续需要让 Agent 在搜索命中后，根据用户目标选择合适数据集并调用受控 import，将远端表加载到 workspace。

需要明确：
- 用户确认机制
- 默认行数上限
- source filters
- 命名策略
- 重复导入处理

## 人工搜索/选表体验

后续在前端提供搜索结果详情、远端预览、加入 workspace 的完整流程。

本轮只完成 metadata 搜索与 catalog metadata read，为该体验提供基础。

## 高级搜索引擎

本轮只做 DuckDB Grep/Search 底座。后续可选方向：
- DuckDB FTS / 倒排索引
- fuzzy match / typo tolerance
- query parser（例如 `source:superset status:orders column:region`）
- embedding/semantic search
- 搜索索引物化表（避免每次读 JSON）

## 异步 Sync Job

当前 sync 为同步执行。若 Superset 数据集过多导致用户等待体验差，需引入异步 job：
- `POST` 返回 `job_id`
- `GET status` 轮询进度
- 完成后通知前端刷新树
