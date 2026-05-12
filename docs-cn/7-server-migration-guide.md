# 服务器迁移指南

> **适用版本**: Data Formulator 0.7+
> **面向读者**: 部署运维人员

---

## 1. 概述

将 Data Formulator 从旧服务器迁移到新服务器（包括 Docker 容器重建、云主机更换、版本升级等场景）时，需要正确搬运密钥文件和数据目录，否则会出现用户登录失效、凭证丢失、图表无法刷新等问题。

本文提供完整的迁移清单和操作步骤。

---

## 2. 关键文件清单

以下文件/配置在迁移时 **必须** 保留：

| 文件 / 配置项 | 默认位置 | 作用 | 丢失后果 |
|---------------|---------|------|---------|
| `FLASK_SECRET_KEY` | `.env` 环境变量 | 签名 Session Cookie、派生代码签名密钥 | 所有用户被踢出登录，Agent 生成的代码签名失效 |
| `.vault_key` | `DATA_FORMULATOR_HOME/.vault_key` | 加密凭证保险箱的 Fernet 密钥 | `credentials.db` 中的数据库密码等凭证无法解密 |
| `credentials.db` | `DATA_FORMULATOR_HOME/credentials.db` | 加密的凭证数据库 | 用户保存的数据库密码、数据源服务凭证全部丢失 |
| `connectors.yaml` | `DATA_FORMULATOR_HOME/connectors.yaml` | 管理员预配置的全局数据源连接 | 管理员配置的数据源卡片消失 |
| `users/` 目录 | `DATA_FORMULATOR_HOME/users/` | 用户工作区数据（parquet、会话元数据） | 用户的图表和数据全部丢失 |
| `workspaces/` 目录 | `DATA_FORMULATOR_HOME/workspaces/` | 遗留默认工作区（旧版数据） | 同上 |

### 可选配置项（如设置过也需带走）

| 配置项 | 说明 |
|--------|------|
| `DF_CODE_SIGNING_SECRET` | 显式设定的代码签名密钥，优先级高于 Flask 密钥。设置过则必须带走，否则已有代码签名全部失效 |
| `CREDENTIAL_VAULT_KEY` | 显式设定的 Vault 加密密钥，优先级高于 `.vault_key` 文件。设置过则必须带走，否则凭证数据库不可读 |
| `DF_SOURCES__*` | 通过环境变量配置的数据源连接。设置过则必须迁移到新服务器的 `.env`、容器环境或 Secret Manager |
| `DF_PLUGIN_DIR` | 外部 Data Loader 目录。设置过则必须同时迁移该目录内容 |
| `PLG_SUPERSET_URL` | Superset 快捷配置。设置过则新服务器也需要保留，否则 Superset 数据源卡片不会自动注册 |

---

## 3. 密钥变更的影响详解

### 3.1 FLASK_SECRET_KEY 变更

`FLASK_SECRET_KEY` 影响两个核心功能：

**Session 签名（影响：高）**

Flask 使用此密钥对浏览器 Cookie 进行签名。密钥变更后：
- 所有用户的 Session Cookie 签名校验失败 → 全体用户被踢出登录
- SSO 登录状态（`session["df_user"]`）失效，需重新走 SSO 认证流程
- 外部系统 Token（如 Superset）失效，需重新授权
- 正在进行中的 OIDC 登录流程中断（`session["_oauth_state"]` 失效）

**Agent 代码签名（影响：中）**

系统使用从 Flask 密钥派生的 HMAC 密钥对 Agent 生成的 Python 代码进行签名。密钥变更后：
- 已有图表刷新数据时，代码签名验证失败，拒绝执行
- 需要重新让 Agent 跑一遍生成新签名
- 图表数据本身（parquet 文件）不受影响

> **注意**：如果没有在 `.env` 中显式设定 `FLASK_SECRET_KEY`，系统每次启动都会随机生成一个临时密钥，重启后所有 Session 和代码签名就会失效。**生产环境务必显式设定此值。**

### 3.2 Vault 密钥变更

`.vault_key`（或 `CREDENTIAL_VAULT_KEY`）影响凭证保险箱：

- `credentials.db` 中存储的数据库密码、服务凭证使用此密钥加密
- 密钥丢失后加密数据不可逆，**无法恢复**
- 用户需要重新输入所有数据库密码

详见 [凭证保险箱文档](6-credential-vault.md)。

---

## 4. 迁移步骤

### 4.1 确认数据目录位置

```bash
# 数据目录优先级：--data-dir CLI参数 > DATA_FORMULATOR_HOME 环境变量 > ~/.data_formulator
# 查看当前配置
grep DATA_FORMULATOR_HOME .env
```

下文用 `$DF_HOME` 代指实际数据目录路径。

### 4.2 在旧服务器上备份

```bash
# 1. 备份配置文件（含 FLASK_SECRET_KEY 等所有密钥）
cp .env /backup/.env

# 2. 备份 Vault 密钥和凭证数据库
cp $DF_HOME/.vault_key      /backup/.vault_key
cp $DF_HOME/credentials.db  /backup/credentials.db

# 3. 备份管理员预配置连接（如存在）
[ -f $DF_HOME/connectors.yaml ] && cp $DF_HOME/connectors.yaml /backup/connectors.yaml

# 4. 备份用户工作区数据和用户连接配置
cp -r $DF_HOME/users        /backup/users
cp -r $DF_HOME/workspaces   /backup/workspaces

# 5.（可选）如设置了 DF_PLUGIN_DIR，备份外部 Loader 目录
[ -n "$DF_PLUGIN_DIR" ] && cp -r $DF_PLUGIN_DIR /backup/df-plugins

# 6.（可选）如使用 Azure Blob 存储后端，工作区数据在云端，无需备份 users/ 和 workspaces/
```

### 4.3 在新服务器上恢复

```bash
# 1. 安装 Data Formulator（新版本或同版本）
pip install data-formulator  # 或其他安装方式

# 2. 恢复配置文件
cp /backup/.env .env
# 检查并按需修改新环境相关的配置（端口、域名等）

# 3. 创建数据目录并恢复密钥
mkdir -p $DF_HOME
cp /backup/.vault_key      $DF_HOME/.vault_key
cp /backup/credentials.db  $DF_HOME/credentials.db
[ -f /backup/connectors.yaml ] && cp /backup/connectors.yaml $DF_HOME/connectors.yaml

# 4. 恢复工作区数据和用户连接配置
cp -r /backup/users        $DF_HOME/users
cp -r /backup/workspaces   $DF_HOME/workspaces

# 5.（可选）恢复外部 Loader 目录，并确认 DF_PLUGIN_DIR 指向它
[ -d /backup/df-plugins ] && cp -r /backup/df-plugins $DF_PLUGIN_DIR

# 6. 启动服务
data_formulator
```

### 4.4 Docker 部署迁移

如果使用 Docker，将数据目录挂载为命名卷：

```yaml
# docker-compose.yml
services:
  data-formulator:
    image: data-formulator:latest
    env_file: .env
    volumes:
      - df-data:/root/.data_formulator
    ports:
      - "5567:5567"

volumes:
  df-data:
```

**迁移步骤：**

```bash
# 1. 导出旧容器的数据卷
docker run --rm -v df-data:/data -v $(pwd)/backup:/backup \
  alpine tar czf /backup/df-data.tar.gz -C /data .

# 2. 在新服务器上导入
docker volume create df-data
docker run --rm -v df-data:/data -v $(pwd)/backup:/backup \
  alpine tar xzf /backup/df-data.tar.gz -C /data

# 3. 复制 .env 到新服务器，启动容器
docker compose up -d
```

---

## 5. 迁移后验证

| 检查项 | 验证方法 | 预期结果 |
|--------|---------|---------|
| 用户登录 | 访问页面，检查是否仍处于登录状态 | 无需重新登录（Session 未失效） |
| SSO 认证 | 退出后重新 SSO 登录 | 能正常完成 SSO 流程 |
| 已有图表 | 打开旧图表，点击刷新数据 | 正常刷新，不报签名错误 |
| 数据库连接 | 打开数据源面板，查看已保存的连接 | 显示"已连接"状态，无需重新输入密码 |
| 外部系统 Token | 打开 Superset 等数据源连接 | 自动登录或正常授权 |
| 管理员连接 | 打开 Load Data 页面 | `connectors.yaml` 或 `DF_SOURCES__*` 配置的数据源卡片正常显示 |
| 用户连接 | 切换到已有用户 | 用户自己创建的数据源卡片正常显示 |
| 外部 Loader | 打开 Add Connection | `DF_PLUGIN_DIR` 中的自定义 loader 正常出现在可选列表 |

---

## 6. 忘记备份密钥的补救措施

### FLASK_SECRET_KEY 丢失

如果之前未显式设定 `FLASK_SECRET_KEY`（使用的是自动生成的临时密钥），则无法恢复。影响和处理方式：

| 影响 | 处理方式 |
|------|---------|
| 所有用户被踢出登录 | 用户重新 SSO 登录即可 |
| Agent 代码签名失效 | 用户重新执行 Agent 生成新代码（自动获得新签名） |
| 工作区数据 | **不受影响**（parquet 文件不依赖此密钥） |

**建议**：在新服务器上立即设定一个固定的 `FLASK_SECRET_KEY`，防止下次再丢失：

```bash
# 生成一个安全的随机密钥
python -c "import secrets; print(secrets.token_hex(32))"

# 将输出写入 .env
# FLASK_SECRET_KEY=<生成的密钥>
```

### .vault_key 丢失

Vault 加密密钥丢失后，已存储的凭证 **无法恢复**。处理方式：

1. 删除旧的 `credentials.db`（已无法解密）
2. 系统会自动生成新的 `.vault_key`
3. 用户需要重新输入数据库密码并勾选"记住凭证"

---

## 7. 最佳实践

1. **生产环境务必显式设定 `FLASK_SECRET_KEY`**：写入 `.env`，不要依赖自动生成

   ```bash
   python -c "import secrets; print(secrets.token_hex(32))"
   ```

2. **定期备份数据目录**：`$DF_HOME` 整个目录包含密钥、凭证、工作区数据，备份它就够了

3. **Docker 部署使用命名卷**：避免使用匿名卷，方便识别和迁移

4. **密钥管理**：在企业部署中，考虑使用外部 Secrets Manager 注入 `FLASK_SECRET_KEY` 和 `CREDENTIAL_VAULT_KEY`，避免密钥散落在文件系统中

5. **升级前备份**：版本升级前也执行完整备份流程，以便回退

---

## 8. 相关文档

- [凭证保险箱（Credential Vault）](6-credential-vault.md) — Vault 加密机制详解
- [DEVELOPMENT.md — Server Migration Checklist](../DEVELOPMENT.md) — 英文版迁移清单
- [.env.template](../.env.template) — 完整配置项说明
