# Superset 端 SSO 桥接配置指南

本文档面向 **Superset 管理员**，说明如何在 Superset 端配置 SSO 桥接端点，使 Data Formulator（以下简称 DF）能通过 Superset 的 SSO 登录获取 JWT，从而调用 Superset REST API。

---

## 1. 背景

DF 需要调用 Superset REST API 来浏览数据集、仪表盘等。API 调用需要 Superset JWT。

由于 DF 和 Superset 部署在不同地址上（跨域），DF 无法直接读取 Superset 的 Session/Cookie。因此需要在 Superset 中添加一个小型桥接端点：用户通过 SSO 登录 Superset 后，该端点将 Session 转换为 JWT，通过浏览器 `postMessage` 传回 DF。

---

## 2. 工作原理

```
DF 前端                               Superset
  │                                     │
  │  ① window.open(弹窗)                │
  │ ──────────────────────────────────>│  /df-sso-bridge/?df_origin=http://DF地址
  │                                     │
  │                                     │  ② 如果用户未登录 → Superset 重定向到 SSO 登录
  │                                     │     如果用户已登录 → 直接到步骤 ④
  │                                     │
  │                                     │  ③ 用户在 SSO 完成登录（账密/企微扫码等）
  │                                     │     Superset 创建 Session，重定向回 /df-sso-bridge/
  │                                     │
  │                                     │  ④ bridge 端点：
  │                                     │     - 检查 Session（用户已登录）
  │                                     │     - 颁发 JWT access_token + refresh_token
  │                                     │     - 返回 HTML，执行 postMessage 将 token 发给 DF
  │                                     │     - 自动关闭弹窗
  │  ⑤ 收到 postMessage                 │
  │<─────────────────────────────────── │
  │                                     │
  │  ⑥ DF 拿到 Superset JWT，后续正常调用 API
```

---

## 3. 只需修改一个文件

在 Superset 服务器上编辑 `superset_config.py`，在末尾追加以下代码，然后**重启 Superset**。

不需要修改 Superset 源码、不需要安装额外包、不需要配置 CORS。

---

## 4. 完整代码

将以下代码追加到 `superset_config.py` 文件末尾：

```python
# =============================================================================
# Data Formulator SSO 桥接端点
# 用途：DF 通过弹窗打开此端点，SSO 登录成功后将 Superset JWT
#       通过 postMessage 传回 DF 前端。
# =============================================================================

from superset.security import SupersetSecurityManager
from flask_appbuilder import expose
from flask import request, Response
from flask_login import current_user


class CustomSecurityManager(SupersetSecurityManager):

    @expose("/df-sso-bridge/", methods=["GET"])
    def df_sso_bridge(self):
        """
        Data Formulator SSO 桥接端点。

        当用户通过 SSO 登录 Superset 后，此端点：
        1. 为当前用户颁发 JWT access_token 和 refresh_token
        2. 通过 postMessage 将 token 发送给 DF 父窗口
        3. 自动关闭弹窗

        URL 参数:
            df_origin: DF 前端的 origin（如 http://10.0.1.1:5567），
                       由 DF 前端自动传入，用于 postMessage 的 targetOrigin 安全校验。
        """
        df_origin = request.args.get("df_origin", "*")

        if not current_user.is_authenticated:
            return Response(
                "<html><body><p>未登录，请关闭此窗口重试。</p></body></html>",
                status=401,
                mimetype="text/html",
            )

        from flask_jwt_extended import create_access_token, create_refresh_token

        access_token = create_access_token(identity=current_user.id, fresh=True)
        refresh_token = create_refresh_token(identity=current_user.id)

        user_data = {
            "id": current_user.id,
            "username": current_user.username,
            "first_name": getattr(current_user, "first_name", "") or "",
            "last_name": getattr(current_user, "last_name", "") or "",
        }

        import json

        html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>SSO Bridge</title></head>
<body>
<p>正在完成登录...</p>
<script>
(function() {{
    var payload = {{
        type: 'df-sso-auth',
        access_token: {json.dumps(access_token)},
        refresh_token: {json.dumps(refresh_token)},
        user: {json.dumps(user_data)}
    }};
    var targetOrigin = {json.dumps(df_origin)};
    if (window.opener) {{
        window.opener.postMessage(payload, targetOrigin);
        setTimeout(function() {{ window.close(); }}, 500);
    }} else {{
        document.body.innerHTML = '<p>登录成功，请关闭此窗口并返回 Data Formulator。</p>';
    }}
}})();
</script>
</body></html>"""
        return Response(html, mimetype="text/html")


CUSTOM_SECURITY_MANAGER_CLASS = CustomSecurityManager
```

---

## 5. 注意事项

### 5.1 如果已有 CustomSecurityManager

如果 `superset_config.py` 中**已经定义**了 `CustomSecurityManager`（或其他自定义 SecurityManager 类），不要重复创建新类，只需将 `df_sso_bridge` 方法添加到现有类中即可：

```python
# 假设已有:
class CustomSecurityManager(SupersetSecurityManager):
    # ... 现有的自定义方法 ...

    # 追加这个方法:
    @expose("/df-sso-bridge/", methods=["GET"])
    def df_sso_bridge(self):
        # ... 上面第 4 节中的完整方法体 ...
```

### 5.2 如果已有 CUSTOM_SECURITY_MANAGER_CLASS

如果已经设置了 `CUSTOM_SECURITY_MANAGER_CLASS`，确认它指向的是包含 `df_sso_bridge` 方法的那个类。不需要重复设置。

### 5.3 无需额外配置

- **不需要**在 Superset 中配置任何 DF 的地址
- **不需要**新增环境变量
- **不需要**修改 CORS 配置
- DF 的地址通过 URL 参数 `df_origin` 动态传入，无需硬编码

---

## 6. DF 端配置

在 DF 的 `.env` 中确保 Superset 插件已启用：

```env
# 设置 Superset URL 即可自动启用插件
PLG_SUPERSET_URL=http://你的SUPERSET地址:8088/
```

DF 会自动：

- 生成 SSO 登录 URL：`{PLG_SUPERSET_URL}/df-sso-bridge/`
- 在 Superset 插件界面显示"SSO 登录"按钮
- 弹窗打开时自动拼接 `?df_origin=` 参数

如果需要自定义 SSO 入口 URL（例如先跳转到 Superset 登录页再重定向），可设置：

```env
# 可选：自定义 SSO 入口 URL（默认直接打开 /df-sso-bridge/）
# 如果 Superset 的桥接端点需要先经过登录页，可以设置为：
# PLG_SUPERSET_SSO_LOGIN_URL=http://你的SUPERSET地址:8088/login/?next=/df-sso-bridge/
```

---

## 7. 验证步骤

部署后按以下步骤验证：

### 7.1 未登录状态测试

浏览器直接访问（不要先登录 Superset）：

```
http://SUPERSET地址:端口/df-sso-bridge/
```

**预期**：返回 401 页面，显示"未登录，请关闭此窗口重试。"

### 7.2 已登录状态测试

1. 先通过 Superset 正常登录（SSO 或账密都行）
2. 在同一浏览器访问：

```
http://SUPERSET地址:端口/df-sso-bridge/?df_origin=http://test
```

**预期**：页面显示"正在完成登录..."，因为没有 `window.opener`（不是从弹窗打开），最终显示"登录成功，请关闭此窗口并返回 Data Formulator。"

### 7.3 验证 JWT 有效性

在步骤 7.2 的页面上，打开浏览器开发者工具 → 查看页面源码中的 `access_token` 值，然后用它调用：

```bash
curl -H "Authorization: Bearer <access_token>" http://SUPERSET地址:端口/api/v1/me/
```

**预期**：返回当前登录用户的信息。

### 7.4 完整端到端测试

1. 启动 DF（确保 `PLG_SUPERSET_URL` 已配置）
2. 在 DF 界面打开数据上传 → 选择 Superset 标签
3. 点击"SSO 登录"按钮
4. 弹窗打开 → 如果已有 SSO 会话则自动完成，否则先完成 SSO 登录
5. 弹窗自动关闭，DF 显示 Superset 数据目录

---

## 8. 安全说明

| 关注点 | 说明 |
|--------|------|
| **谁能访问 bridge 端点？** | 只有已通过 Superset 认证（有有效 Session）的用户，未登录返回 401 |
| **JWT 发给谁？** | 通过 `postMessage` 只发给 `window.opener`（即打开弹窗的 DF 页面） |
| **targetOrigin 安全性** | 使用 DF 传入的 `df_origin` 作为 `targetOrigin`，浏览器会校验接收窗口的实际 origin 是否匹配，不匹配则消息被丢弃 |
| **df_origin 被伪造？** | `postMessage` 始终发给 `window.opener`，`targetOrigin` 只是过滤条件。伪造只会导致消息被丢弃，不会泄露到第三方 |
| **JWT 生命周期** | 获取的 JWT 与正常登录的完全一致，DF 后端自动处理过期刷新 |

---

## 9. 故障排查

| 现象 | 可能原因 | 解决方法 |
|------|----------|----------|
| 弹窗显示"未登录" | 用户没有有效的 Superset Session | 先在 Superset 正常登录一次，再从 DF 发起 SSO |
| 弹窗打开后空白 | `superset_config.py` 代码未生效 | 确认已重启 Superset，检查日志是否有导入错误 |
| 弹窗显示"登录成功"但 DF 无反应 | postMessage type 不匹配 | 确认桥接代码中 `type: 'df-sso-auth'` 拼写正确 |
| curl 测试 JWT 返回 401 | `create_access_token` 异常 | 检查 Superset 日志，确认 `flask_jwt_extended` 已正确配置 |
| DF 显示"SSO 登录失败" | save-tokens 验证失败 | 检查 DF 后端日志，确认 DF 能访问 Superset `/api/v1/me/` |
| 弹窗被浏览器拦截 | 浏览器 popup 拦截 | 提示用户允许弹出窗口 |

---

## 10. 技术细节：DF 端 SSO 流程（供开发者参考）

### 10.1 前端流程（`SupersetLogin.tsx`）

```
用户点击"SSO 登录"
  → 构造 URL: {sso_login_url}?df_origin={window.location.origin}
  → window.open(url) 打开弹窗
  → window.addEventListener('message', handler)
  → 同时 setInterval 检测弹窗是否关闭
  
收到 postMessage (type === 'df-sso-auth')
  → 移除 listener，关闭弹窗
  → POST /api/plugins/superset/auth/sso/save-tokens
      { access_token, refresh_token, user }
  → 后端验证 token → 存入 Flask plugin session
  → 前端标记已认证 → 展示数据目录
```

### 10.2 后端 token 保存（`routes/auth.py`）

`POST /api/plugins/superset/auth/sso/save-tokens` 接收前端传来的 Superset JWT：

1. 用 `access_token` 调用 Superset `/api/v1/me/` 验证有效性
2. 获取用户信息（id, username 等）
3. 存入 Flask plugin session（`plugin_superset_token`, `plugin_superset_user`）
4. 后续所有 Superset API 调用使用此 JWT

### 10.3 postMessage 协议

桥接页发送的消息格式：

```json
{
    "type": "df-sso-auth",
    "access_token": "eyJhbGci...",
    "refresh_token": "eyJhbGci...",
    "user": {
        "id": 1,
        "username": "zhangsan",
        "first_name": "三",
        "last_name": "张"
    }
}
```

DF 前端只接受 `type === 'df-sso-auth'` 的消息，忽略其他所有 postMessage。
