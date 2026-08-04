# Custom Changes (Fork Notes)

> 本仓库基于 [microsoft/data-formulator](https://github.com/microsoft/data-formulator) 的 fork。  
> 用本文档记录相对上游的定制，方便后续 `git fetch upstream && git merge upstream/main` 时核对与回归。

## Remotes

| Remote | URL | 用途 |
|--------|-----|------|
| `origin` | `git@github.com:smile928/data-formulator.git` | 本 fork，推送定制 |
| `upstream` | `https://github.com/microsoft/data-formulator.git` | 官方源，只 fetch / merge |

## Sync cheat sheet

```bash
git fetch upstream
git checkout my-main          # 或你的主定制分支
git merge upstream/main       # 冲突解决后跑相关测试
git push origin my-main
```

合并后勾选：

- [ ] 浏览下方「改动清单」，确认行为仍符合预期
- [ ] 启动：`uv run data_formulator --dev` + `yarn start`（或 `yarn build` 后一体启动）
- [ ] 跑与改动相关的测试（如有）
- [ ] 更新本文件的「上次同步」与冲突备注

## 上次同步

| 项 | 值 |
|----|-----|
| 日期 | YYYY-MM-DD |
| 上游 commit / tag | （例：`upstream/main` @ `5d4f7b3` / `0.8.0a4`） |
| 本分支 tip | |
| 冲突文件 | （无 / 列出路径） |
| 备注 | |

---

## 改动清单

按功能拆条记录。合并上游后若某条失效，在「状态」里标 `需重做` / `已废弃`。

### 模板（复制后填写）

```md
### [短标题] — YYYY-MM-DD

- **状态**: 有效 | 需重做 | 已废弃
- **动机**: 为什么要改（业务/性能/安全）
- **触及文件**:
  - `path/to/file.py` — 改了什么（一句话）
- **行为变化**: 对用户/API 可见的差异
- **相关 commit**: `abc1234`
- **回归要点**: 合并上游后怎么验
- **风险 / 冲突热点**: 是否改了上游高频文件
```

### 条目

<!-- 在下方追加真实改动；没有定制前可留空 -->

<!--
### 示例：MongoDB 元数据改用估算计数 — 2026-08-04

- **状态**: 有效
- **动机**: 大集合上 `count_documents({})` 过慢且拖高内存
- **触及文件**:
  - `py-src/data_formulator/data_loader/mongodb_data_loader.py` — `get_metadata` / `list_tables` 改用 `estimated_document_count`
- **行为变化**: Catalog 行数可能为估算值，不再保证精确
- **相关 commit**: （填写）
- **回归要点**: 连接含千万级 collection 的 Mongo，点开 catalog 应秒级返回
- **风险 / 冲突热点**: 中 — 上游若改同一 loader 易冲突
-->

---

## 未合入上游的本地-only 文件

只存在于本 fork、不应被 upstream 覆盖或误删的路径：

| 路径 | 说明 |
|------|------|
| `CUSTOM_CHANGES.md` | 本文件 |
| | |

## 配置与环境（勿提交密钥）

| 项 | 说明 |
|----|------|
| `.env` | 本地 LLM / 连接串等（参考 `.env.template`） |
| `DATA_FORMULATOR_HOME` | 默认 `~/.data_formulator` |
| Settings `frontendRowLimit` | 大表导入前建议调小（如 100） |

## 刻意不改 / 待做

- （例：暂不改 Agent 主循环，避免跟版成本过高）
- （例：TODO — Mongo `source_filters` 推送）
