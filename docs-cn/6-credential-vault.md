# 凭证保险箱（Credential Vault）

> **适用版本**: Data Formulator 0.7+
> **面向读者**: 部署运维人员、管理员、需要理解凭证保存行为的用户

---

## 1. 功能简介

Credential Vault 用于在服务端加密保存外部数据源凭证，例如数据库密码、访问 token、
API key 等。DataConnector 连接成功后，可以把敏感凭证保存到 vault，后续用户打开同一个
连接时无需重新输入。

Vault 只保存凭证，不保存连接卡片本身。连接卡片定义保存在：

```text
DATA_FORMULATOR_HOME/connectors.yaml                  # 管理员全局连接
DATA_FORMULATOR_HOME/users/<identity>/connectors.yaml # 用户个人连接
```

---

## 2. 零配置启动

本地使用无需任何配置。首次使用 vault 时系统自动：

1. 生成 Fernet 加密密钥：`DATA_FORMULATOR_HOME/.vault_key`
2. 创建加密数据库：`DATA_FORMULATOR_HOME/credentials.db`

```text
~/.data_formulator/
├── .vault_key
├── credentials.db
├── connectors.yaml          # 可选，管理员预配置连接
└── users/
    └── <identity>/
        ├── connectors.yaml  # 用户创建的连接
        └── ...
```

这些文件在重启和升级后持续保留。迁移服务器时必须一起备份，详见
`docs-cn/7-server-migration-guide.md`。

---

## 3. 安全模型

| 方面 | 设计 |
|------|------|
| 加密算法 | Fernet（AES-128-CBC + HMAC-SHA256） |
| 密钥存储 | `DATA_FORMULATOR_HOME/.vault_key`，或 `CREDENTIAL_VAULT_KEY` 环境变量 |
| 数据库位置 | `DATA_FORMULATOR_HOME/credentials.db` |
| 访问隔离 | 按 `(user_identity, connector_id)` 逻辑隔离 |
| 前端隔离 | 明文凭证不返回前端；前端只看到连接状态、参数表单和非敏感配置 |
| 传输安全 | 生产环境应使用 HTTPS |

Vault 是逻辑隔离，不是每个用户一个数据库文件。服务端进程持有加密密钥，因此备份和权限管理
应以整个 `DATA_FORMULATOR_HOME` 为单位处理。

---

## 4. DataConnector 工作流程

### 4.1 创建连接

```text
用户填写连接参数
  ↓
POST /api/connectors
  ↓
后端创建用户 connector 定义
  ↓
如果参数足够，立即连接并测试
  ↓
非敏感参数写入 users/<identity>/connectors.yaml
敏感凭证加密写入 credentials.db
```

### 4.2 重新连接

```text
用户点击已存在的数据源卡片
  ↓
后端按 identity + connector_id 查找连接定义
  ↓
如需要凭证，则从 vault 取出并创建 loader
  ↓
连接成功后进入 catalog 浏览和导入界面
```

### 4.3 断开和删除

| 操作 | 连接卡片 | 当前 loader | Vault 凭证 |
|------|----------|-------------|------------|
| Disconnect | 保留 | 清除 | 清除当前服务 token/凭证 |
| Delete | 删除 | 清除 | 删除 |

Disconnect 适合临时切换账号或清理当前授权；Delete 表示不再需要该用户连接。管理员预配置的
连接不能由普通用户删除。

---

## 5. TokenStore 与 SSO

对于 Superset 等支持 SSO 或弹窗委托登录的数据源，TokenStore 会优先使用当前 Session 中的
service token 或通过 SSO exchange 获取目标系统 token。

简化优先级：

1. Session 中已有目标系统 token。
2. refresh token 可续期。
3. 用 Data Formulator 的 SSO token 换取目标系统 token。
4. 使用弹窗委托登录保存的 token。
5. 使用 vault 中保存的静态凭证。
6. 无可用凭证，提示用户重新授权或重新输入。

开发细节见 `dev-guides/4-authentication-oidc-tokenstore.md`。

---

## 6. 手动 API

系统仍保留通用凭证 API：

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/api/credentials/list` | 列出有存储凭证的 source key，不暴露密码 |
| POST | `/api/credentials/store` | 存储或更新凭证 |
| POST | `/api/credentials/delete` | 删除凭证 |

普通 DataConnector 流程通常不需要用户直接调用这些 API。连接、断开、删除操作会通过
`/api/connectors/*` 路由完成对应的 vault 生命周期处理。

---

## 7. Docker 部署

挂载整个数据目录即可，密钥、凭证库、连接配置和用户数据都会包含在其中：

```yaml
volumes:
  - df-data:/root/.data_formulator
```

如果使用外部 Secret Manager 管理密钥，可以通过环境变量注入：

```bash
CREDENTIAL_VAULT_KEY=<your-fernet-key>
```

设置后 `.vault_key` 文件将被忽略，直接使用环境变量中的密钥。

---

## 8. 生成 Vault 密钥

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

如果密钥丢失，`credentials.db` 中的已保存凭证无法恢复，用户需要重新输入外部数据源密码
或重新授权。

---

## 9. 相关文件

```text
py-src/data_formulator/credential_vault/
├── __init__.py
├── base.py
└── local_vault.py
```

相关文档：

- `docs-cn/1-data-source-connections.md`
- `docs-cn/7-server-migration-guide.md`
- `dev-guides/5-data-connector-api.md`
