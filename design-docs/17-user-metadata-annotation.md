# 17 - 用户自定义 Metadata 描述功能

> **状态：已完成** — 2026-05

## 实现总结

本设计的核心目标——让用户可以为数据源表补充自定义描述——已通过 Phase 2（Catalog Annotation 系统）全部实现：

- **存储层**：`catalog_annotations/<source_id>.json`，per-user 独立，与 `catalog_cache/` 物理分离
- **后端 API**：`PATCH/GET /api/connectors/catalog-annotations`（`data_connector.py`）
- **合并逻辑**：`catalog_merge.py`，在搜索、前端展示、Agent context 注入时按 annotation > cache 优先级合并
- **前端 UI**：DataSourceSidebar 中通过 catalog tree 的 ✏️ 按钮打开 annotation 编辑对话框

## 放弃的 Phase 1（已导入表列头编辑）

原设计 Phase 1 计划为已导入 workspace 的表提供 `PATCH /api/tables/metadata` API 和 SelectableDataGrid 列头 inline 编辑。经评估决定不实现，原因：

1. **描述以源头为准** — 表描述应在数据源层面维护，而非在 workspace 副本上编辑
2. **避免重复入口** — 已有 catalog annotation 编辑入口，再加一套 workspace 表编辑会让用户困惑
3. **维护成本** — 两套编辑路径意味着更多同步逻辑和测试负担
