# 自定义数据源 Loader 开发指南

> **适用版本**: Data Formulator 0.7+
> **面向读者**: 想接入新数据库、报表系统、对象存储或内部数据服务的管理员与开发者

---

## 1. 当前扩展模型

Data Formulator 0.7 使用 `ExternalDataLoader + DataConnector` 作为统一的数据源扩展模型：

```text
ExternalDataLoader  # 具体数据源实现的适配器接口
DataConnector       # 框架自动提供的连接实例管理层
connectors.yaml     # 管理员预配置连接实例
DF_PLUGIN_DIR       # 不改源码外加 loader type 的目录
```

新增数据源时，通常只需要实现一个 `ExternalDataLoader` 子类。`DataConnector` 会自动把它包装成
可连接、可浏览、可预览、可导入、可刷新的连接实例，并统一使用 `/api/connectors/...` API。

不要为每个数据源新增专有后端路由或前端面板。除非产品需求已经超出“数据源浏览与导入”的范围，
否则优先通过 loader 接口表达能力。

---

## 2. 两种接入场景

### 已有 loader type

如果系统已经内置对应 loader type，例如 PostgreSQL、MySQL、Superset、S3、BigQuery，使用者不需要写代码：

1. 打开 Load Data 页面。
2. 点击 **Add Connection**。
3. 选择数据源类型。
4. 填写 URL、host、database、token、用户名密码等参数。
5. 点击 **Add & Connect**。

连接成功后，会出现一个 connector instance 卡片。一个用户可以创建多个同类型连接，例如
`MySQL · prod` 和 `MySQL · staging`。

### 全新的数据源类型

如果要接入一个全新的报表系统或内部数据服务，管理员可以提供一个外部 loader 文件：

```text
~/.data-formulator/plugins/my_report_data_loader.py
```

也可以通过环境变量指定目录：

```bash
DF_PLUGIN_DIR=/opt/data-formulator-loaders
```

服务启动时会扫描 `DF_PLUGIN_DIR` 中所有 `*_data_loader.py` 文件。文件名会决定 loader type：

```text
my_report_data_loader.py -> my_report
```

注册成功后，`my_report` 会出现在 Add Connection 的可选数据源类型中。

---

## 3. 最小 Loader 示例

```python
from typing import Any

import pyarrow as pa

from data_formulator.data_loader.external_data_loader import ExternalDataLoader


class MyReportDataLoader(ExternalDataLoader):
    def __init__(self, params: dict[str, Any]):
        self.params = params
        self.url = params.get("url", "").rstrip("/")
        self.token = params.get("token", "")
        if not self.url:
            raise ValueError("url is required")

    @staticmethod
    def list_params() -> list[dict[str, Any]]:
        return [
            {
                "name": "url",
                "type": "string",
                "required": True,
                "tier": "connection",
                "description": "Report system base URL",
            },
            {
                "name": "token",
                "type": "password",
                "required": True,
                "sensitive": True,
                "tier": "auth",
                "description": "API token with dataset read access",
            },
        ]

    @staticmethod
    def auth_instructions() -> str:
        return "Provide the report system URL and an API token with dataset read access."

    def list_tables(self, table_filter: str | None = None) -> list[dict[str, Any]]:
        return [
            {
                "name": "sales_report",
                "metadata": {
                    "row_count": None,
                    "columns": [{"name": "region", "type": "STRING"}],
                    "sample_rows": [],
                },
            }
        ]

    def fetch_data_as_arrow(
        self,
        source_table: str,
        import_options: dict[str, Any] | None = None,
    ) -> pa.Table:
        # Call the source system API and convert the result to Arrow.
        return pa.table({"region": ["US", "EU"]})
```

---

## 4. 必须实现的方法

| 方法 | 说明 |
|------|------|
| `__init__(self, params)` | 保存并验证连接参数；可创建客户端或延迟到首次调用时连接 |
| `list_params()` | 返回连接参数定义，用于 Add Connection 表单 |
| `auth_instructions()` | 返回给用户看的连接或认证说明 |
| `list_tables(table_filter=None)` | 返回可导入表、文件或数据集列表 |
| `fetch_data_as_arrow(source_table, import_options=None)` | 读取数据并返回 `pyarrow.Table` |

`fetch_data_as_arrow()` 只接受表、文件、集合或数据集标识符，不应该接受用户传入的原始 SQL。
如果支持筛选、排序、列选择或行数限制，应从 `import_options` 中读取：

```python
{
    "size": 100000,
    "columns": ["id", "amount"],
    "sort_columns": ["created_at"],
    "sort_order": "desc",
    "filters": [],
    "source_filters": [],
}
```

---

## 5. 推荐实现的方法

| 方法 | 用途 |
|------|------|
| `catalog_hierarchy()` | 声明目录层级，例如 database -> schema -> table |
| `ls(path=None, filter=None, limit=None, offset=0)` | 懒加载当前层级节点，大目录应支持分页 |
| `search_catalog(query, limit=100)` | 跨层级搜索表或数据集 |
| `get_metadata(path)` | 返回表/列元数据、描述、样例等 |
| `get_column_types(source_table)` | 返回源系统列类型，帮助前端选择筛选控件 |
| `get_column_values(source_table, column_name, keyword, limit, offset)` | 返回列值候选项，用于智能筛选 |
| `test_connection()` | 用轻量请求验证连接是否可用 |

能力对应关系：

| 目标能力 | Loader 接口 |
|----------|-------------|
| 列举所有表/数据集 | `list_tables()` |
| 按层级浏览 | `catalog_hierarchy()` + `ls()` |
| 当前层级过滤 | `ls(..., filter=...)` |
| 跨层级搜索 | `search_catalog(query)` |
| 表/列元数据 | `get_metadata(path)`、`get_column_types(source_table)` |
| 列值枚举 | `get_column_values(...)` |
| 预览、导入、刷新 | `fetch_data_as_arrow()` |

---

## 6. 连接实例配置

Loader type 只定义“这种数据源怎么连接和读取”。实际连接卡片由 connector instance 配置决定。

管理员可以在 `DATA_FORMULATOR_HOME/connectors.yaml` 中预置全局连接：

```yaml
connectors:
  - id: my_report_prod
    type: my_report
    name: "My Report · prod"
    icon: report
    params:
      url: ${MY_REPORT_URL}
```

也可以用环境变量创建：

```bash
DF_SOURCES__my_report_prod__type=my_report
DF_SOURCES__my_report_prod__name="My Report · prod"
DF_SOURCES__my_report_prod__params__url=https://report.example.com
```

不要把密码、token、API key、connection string 写入 `connectors.yaml`。敏感凭证只在连接时使用，
并由 Credential Vault 按用户和连接隔离保存。

---

## 7. 认证与凭证

简单账号密码或 token 认证通常只需要在 `list_params()` 中声明敏感字段：

```python
{"name": "password", "type": "password", "sensitive": True, "tier": "auth"}
```

如果数据源支持 SSO、token exchange 或 delegated login，可以按需实现：

| 方法 | 说明 |
|------|------|
| `auth_config()` | 声明 credentials、sso_exchange、delegated、oauth2 等认证模式 |
| `delegated_login_config()` | 声明弹窗登录 URL 与按钮文案 |
| `auth_mode()` | 旧兼容接口，新 loader 优先使用 `auth_config()` |

认证细节见 `dev-guides/4-authentication-oidc-tokenstore.md`。

---

## 8. 安全要求

- 不要执行用户提供的原始 SQL。
- 表名、列名、文件路径等外部输入必须校验或转义。
- 涉及本机文件系统读取的 loader 必须限制在安全目录，并在多人服务器模式下默认禁用。
- `list_params()` 中的密码、token、secret、access key 等字段必须标记为 `sensitive` 或 `type="password"`。
- 返回给前端的元数据不能包含密钥、连接串或内部路径。

---

## 9. 验证清单

- [ ] loader 文件名是 `*_data_loader.py`。
- [ ] 文件中定义了公开的 `ExternalDataLoader` 子类。
- [ ] `list_params()`、`auth_instructions()`、`list_tables()`、`fetch_data_as_arrow()` 已实现。
- [ ] 大目录数据源实现了 `ls(..., limit, offset)` 或 `search_catalog()`。
- [ ] 表节点需要稳定源标识符时，`metadata["_source_name"]` 已设置。
- [ ] 敏感字段不会写入 `connectors.yaml`，也不会返回给前端。
- [ ] 服务重启后，`GET /api/data-loaders` 能看到新的 loader type。
- [ ] Add Connection 能创建连接，preview/import/refresh 能正常工作。

更多开发细节见 [dev-guides/3-data-loader-development.md](../dev-guides/3-data-loader-development.md)
和 [dev-guides/5-data-connector-api.md](../dev-guides/5-data-connector-api.md)。
