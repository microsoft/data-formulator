# 凭证保险箱（Credential Vault）

> **适用版本**: Data Formulator 0.7+
> **面向读者**: 部署运维人员、插件开发者

---

## 1. 功能简介

当用户登录插件（如 Superset）时勾选"记住凭证"，密码会被 **Fernet 加密**后存储在服务端 SQLite 数据库中。下次打开插件时自动取用凭证登录，无需重新输入。

---

## 2. 零配置启动

本地使用无需任何配置。首次访问时系统自动：

1. 生成 Fernet 加密密钥 → `DATA_FORMULATOR_HOME/.vault_key`
2. 创建加密数据库 → `DATA_FORMULATOR_HOME/credentials.db`

```
~/.data_formulator/
├── .vault_key         ← 自动生成的加密密钥
├── credentials.db     ← 加密凭证数据库
└── users/             ← 用户工作区数据
```

两个文件在重启和升级后持续保留。

---

## 3. 安全模型

| 方面 | 设计 |
|------|------|
| 加密算法 | Fernet（AES-128-CBC + HMAC-SHA256） |
| 密钥存储 | 文件系统（`DATA_FORMULATOR_HOME/.vault_key`），或 `CREDENTIAL_VAULT_KEY` 环境变量 |
| 访问隔离 | 按 `(user_identity, source_key)` 索引 — 用户只能访问自己的凭证 |
| 前端隔离 | 明文凭证从不离开服务端；前端只知道是否有已存储的凭证 |
| 传输安全 | 生产环境应使用 HTTPS |

---

## 4. 工作流程

### 4.1 首次登录

```
用户输入密码 → 勾选"记住凭证" → 后端登录成功
                                      ↓
                                加密并存入 credentials.db
```

### 4.2 后续访问

```
前端: GET /auth/status
         ↓
后端: Session 有 token? → 有 → 直接使用
         ↓ 没有
     Vault 有凭证?  → 有 → 取出 → 尝试登录外部系统
         ↓                          ↓
         ↓                    成功 → 无感登录
         ↓                    失败 → 返回 vault_stale（密码已变更）
         ↓ 没有
     显示登录表单
```

### 4.3 外部系统密码变更

当第三方系统密码被修改后，下次自动登录时：

1. 后端从 Vault 取出凭证 → 尝试登录 → 失败（401）
2. 返回 `vault_stale: true` 给前端
3. 前端显示登录表单 + 警告"已保存的凭证已失效"
4. 用户输入新密码：
   - 勾选"记住" → 新凭证覆盖旧的
   - 取消"记住" → 旧凭证从 Vault 删除

---

## 5. API 接口

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/api/credentials/list` | 列出有存储凭证的插件 ID（不暴露密码） |
| POST | `/api/credentials/store` | 存储或更新凭证 |
| POST | `/api/credentials/delete` | 删除凭证 |

`/list` 只返回 source_key 名称（如 `["superset"]`），**不返回密码或 token**。

Vault 不可用时：`/list` 返回空数组，`/store` 和 `/delete` 返回 503。

---

## 6. Docker 部署

挂载整个数据目录即可，密钥和数据库自动包含：

```yaml
volumes:
  - df-data:/root/.data_formulator
```

无需配置环境变量。密钥文件和数据库都在 `DATA_FORMULATOR_HOME` 下。

---

## 7. 高级配置：手动指定密钥

在密钥需要由外部 Secrets Manager 注入的场景，设置环境变量：

```bash
CREDENTIAL_VAULT_KEY=<your-fernet-key>
```

生成密钥：

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

设置后 `.vault_key` 文件将被忽略，直接使用环境变量中的密钥。

---

## 8. 插件集成

插件通过 `PluginAuthHandler` 基类（见 `docs-cn/5-datasource_plugin-development-guide.md` §6–7）自动获得 Vault 生命周期管理。插件作者**不需要**手动编写 Vault 操作代码。

基类自动处理：

- 登录路由：`remember=true` → 存入 Vault，`remember=false` → 从 Vault 删除
- 退出路由：始终从 Vault 删除（强制）
- 状态路由：尝试用 Vault 凭证自动登录

核心原则：Vault 操作是 best-effort — 当 Vault 不可用时静默跳过，不会崩溃。

---

## 9. 文件结构

```
py-src/data_formulator/auth/vault/
├── __init__.py      # get_credential_vault() 工厂 — 密钥自动解析 + 单例
├── base.py          # CredentialVault 抽象基类
└── local_vault.py   # LocalCredentialVault: SQLite + Fernet 实现
```
