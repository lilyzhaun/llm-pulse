# 本机实测：管理员登录与 `GET /api/log/` 接口说明

本文档基于 **本机实际部署实例** 的真实请求与真实响应整理，目的是让其他 AI 或自动化工具快速理解：

- 如何登录本机 `new-api`
- 如何以管理员身份调用 `GET /api/log/`
- 日志接口的真实请求头、查询参数、响应结构
- 如何区分“看全部用户”与“只看某个用户”

> 说明：
>
> 1. 文档中的接口地址、响应头、响应体结构、字段名、状态码均来自本机实测。
> 2. **敏感值已脱敏**，包括管理员密码、完整 session cookie。
> 3. 本文档保留了足够的真实细节，便于复现与二次分析，但不会把有效凭证直接落盘。

---

## 1. 测试环境

- 服务地址：`http://127.0.0.1:3000`
- 服务版本：`v0.13.1-patch.1`
- 部署方式：Docker 容器运行的 `calciumion/new-api:v0.13.1-patch.1`
- 数据库：PostgreSQL（容器内配置 `SQL_DSN=postgresql://root:<password>@postgres:5432/new-api`）

---

## 2. 关键结论

### 2.1 管理员日志接口不是匿名可访问的

直接请求：

```bash
curl -i -sS http://127.0.0.1:3000/api/log/
```

真实响应：

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json; charset=utf-8
X-New-Api-Version: v0.13.1-patch.1
X-Oneapi-Request-Id: req-example-001

{"message":"Unauthorized, not logged in and no access token provided","success":false}
```

结论：

- `GET /api/log/` 需要管理员身份
- 不能匿名访问

### 2.2 登录后还不够，调用 `/api/log/` 时还必须带 `New-Api-User`

实测证明：管理员登录成功后，请求 `/api/log/` 时除了 session cookie，还必须带：

```http
New-Api-User: 1001
```

其中 `1001` 是当前登录管理员 `admin` 的用户 ID。

### 2.3 管理员接口默认能看所有用户

不带 `username` 参数时：

- 返回里同时出现了 `admin`
- 也出现了 `user-a`
- 也出现了 `user-b`

说明管理员接口默认是**全站视角**。

只有在显式传了：

```http
username=admin
```

时，才会只返回 `admin` 的日志。

---

## 3. 真实登录请求与响应

### 3.1 登录请求

实际使用的请求：

```bash
curl -i -sS -c /tmp/newapi.cookie \
  -H 'Content-Type: application/json' \
  -X POST http://127.0.0.1:3000/api/user/login \
  -d '{"username":"admin","password":"<已脱敏>"}'
```

说明：

- `-c /tmp/newapi.cookie`：把服务端返回的 session cookie 存到本地文件
- 用户名实测为：`admin`
- 密码已脱敏，不写入本文档

### 3.2 登录成功响应（真实样本）

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Set-Cookie: session=<已脱敏>; Path=/; Expires=Wed, 27 May 2026 08:06:43 GMT; Max-Age=2592000; HttpOnly; SameSite=Strict
X-New-Api-Version: v0.13.1-patch.1
X-Oneapi-Request-Id: req-example-002
Date: Mon, 27 Apr 2026 08:06:43 GMT
Content-Length: 129

{"data":{"display_name":"Root User","group":"group-a","id":1001,"role":100,"status":1,"username":"admin"},"message":"","success":true}
```

### 3.3 从登录响应可以确认的事实

- `username = admin`
- `id = 1001`
- `role = 100`
- `status = 1`
- `group = group-a`

其中：

- `role = 100` 代表 root 管理员
- `id = 1001` 是后续 `New-Api-User` 请求头要填写的值

---

## 4. 管理员调用 `GET /api/log/` 的真实方式

### 4.1 最小可用请求

```bash
curl -i -sS \
  -b /tmp/newapi.cookie \
  -H 'New-Api-User: 1001' \
  'http://127.0.0.1:3000/api/log/?p=0&page_size=5'
```

说明：

- `-b /tmp/newapi.cookie`：带上刚登录拿到的 session
- `New-Api-User: 1001`：必须与当前登录用户 ID 一致
- `p=0&page_size=5`：请求第一页 5 条数据

---

## 5. 管理员日志接口：真实响应样本（看全部用户）

### 5.1 请求

```http
GET /api/log/?p=0&page_size=5 HTTP/1.1
Host: 127.0.0.1:3000
Cookie: session=<已脱敏>
New-Api-User: 1001
```

### 5.2 真实响应头

```http
HTTP/1.1 200 OK
Auth-Version: 864b7076dbcd0a3c01b5520316720ebf
Content-Type: application/json; charset=utf-8
X-New-Api-Version: v0.13.1-patch.1
X-Oneapi-Request-Id: req-example-003
Date: Mon, 27 Apr 2026 08:06:51 GMT
Transfer-Encoding: chunked
```

### 5.3 真实响应体

```json
{
  "data": {
    "page": 1,
    "page_size": 5,
    "total": 223798,
    "items": [
      {
        "id": 223921,
        "user_id": 1001,
        "created_at": 1777277211,
        "type": 2,
        "content": "",
        "username": "admin",
        "token_name": "token-1",
        "model_name": "gpt-5.4",
        "quota": 88239,
        "prompt_tokens": 89324,
        "completion_tokens": 257,
        "use_time": 8,
        "is_stream": true,
        "channel": 2,
        "channel_name": "channel-1",
        "token_id": 2301,
        "group": "group-a",
        "ip": "",
        "request_id": "req-example-004",
        "other": "{\"admin_info\":{\"use_channel\":[\"2\"]},\"billing_source\":\"wallet\",\"cache_ratio\":0.1,\"cache_tokens\":22528,\"completion_ratio\":6,\"frt\":2640,\"group_ratio\":1,\"model_price\":-1,\"model_ratio\":1.25,\"reasoning_effort\":\"medium\",\"request_conversion\":[\"OpenAI Compatible\"],\"request_path\":\"/v1/chat/completions\",\"stream_status\":{\"end_reason\":\"done\",\"status\":\"ok\"},\"user_group_ratio\":-1}"
      },
      {
        "id": 223920,
        "user_id": 1001,
        "created_at": 1777277203,
        "type": 2,
        "content": "",
        "username": "admin",
        "token_name": "token-1",
        "model_name": "gpt-5.4",
        "quota": 88227,
        "prompt_tokens": 88643,
        "completion_tokens": 369,
        "use_time": 11,
        "is_stream": true,
        "channel": 2,
        "channel_name": "channel-1",
        "token_id": 2301,
        "group": "group-a",
        "ip": "",
        "request_id": "req-example-005",
        "other": "{\"admin_info\":{\"use_channel\":[\"2\"]},\"billing_source\":\"wallet\",\"cache_ratio\":0.1,\"cache_tokens\":22528,\"completion_ratio\":6,\"frt\":6375,\"group_ratio\":1,\"model_price\":-1,\"model_ratio\":1.25,\"reasoning_effort\":\"medium\",\"request_conversion\":[\"OpenAI Compatible\"],\"request_path\":\"/v1/chat/completions\",\"stream_status\":{\"end_reason\":\"done\",\"status\":\"ok\"},\"user_group_ratio\":-1}"
      },
      {
        "id": 223919,
        "user_id": 1002,
        "created_at": 1777277199,
        "type": 5,
        "content": "status_code=429, All credentials for model gpt-5.3-codex are cooling down via provider codex",
        "username": "user-a",
        "token_name": "token-2",
        "model_name": "gpt-5.3-codex",
        "quota": 0,
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "use_time": 0,
        "is_stream": true,
        "channel": 1,
        "channel_name": "channel-2",
        "token_id": 2302,
        "group": "group-b",
        "ip": "",
        "request_id": "req-example-006",
        "other": "{\"admin_info\":{\"use_channel\":[\"1\"]},\"channel_id\":1,\"channel_name\":\"channel-2\",\"channel_type\":1,\"error_code\":\"model_cooldown\",\"error_type\":\"openai_error\",\"request_path\":\"/v1/chat/completions\",\"status_code\":429}"
      },
      {
        "id": 223918,
        "user_id": 1003,
        "created_at": 1777277187,
        "type": 2,
        "content": "",
        "username": "user-b",
        "token_name": "token-3",
        "model_name": "gpt-5.5",
        "quota": 49797,
        "prompt_tokens": 115237,
        "completion_tokens": 1240,
        "use_time": 14,
        "is_stream": true,
        "channel": 1,
        "channel_name": "channel-2",
        "token_id": 2303,
        "group": "group-c",
        "ip": "",
        "request_id": "req-example-007",
        "other": "{\"admin_info\":{\"use_channel\":[\"1\"]},\"billing_source\":\"wallet\",\"cache_ratio\":0.1,\"cache_tokens\":114176,\"completion_ratio\":6,\"frt\":2100,\"group_ratio\":1,\"model_price\":-1,\"model_ratio\":2.5,\"request_conversion\":[\"OpenAI Compatible\"],\"request_path\":\"/v1/chat/completions\",\"stream_status\":{\"end_reason\":\"done\",\"status\":\"ok\"},\"user_group_ratio\":-1}"
      },
      {
        "id": 223917,
        "user_id": 1003,
        "created_at": 1777277170,
        "type": 2,
        "content": "",
        "username": "user-b",
        "token_name": "token-3",
        "model_name": "gpt-5.5",
        "quota": 38155,
        "prompt_tokens": 114472,
        "completion_tokens": 361,
        "use_time": 7,
        "is_stream": true,
        "channel": 1,
        "channel_name": "channel-2",
        "token_id": 2303,
        "group": "group-c",
        "ip": "",
        "request_id": "req-example-008",
        "other": "{\"admin_info\":{\"use_channel\":[\"1\"]},\"billing_source\":\"wallet\",\"cache_ratio\":0.1,\"cache_tokens\":112640,\"completion_ratio\":6,\"frt\":3013,\"group_ratio\":1,\"model_price\":-1,\"model_ratio\":2.5,\"request_conversion\":[\"OpenAI Compatible\"],\"request_path\":\"/v1/chat/completions\",\"stream_status\":{\"end_reason\":\"done\",\"status\":\"ok\"},\"user_group_ratio\":-1}"
      }
    ]
  },
  "message": "",
  "success": true
}
```

### 5.4 这个响应证明了什么

这个真实响应同时包含了以下用户：

- `admin`
- `user-a`
- `user-b`

因此可以确认：

**管理员调用 `GET /api/log/` 默认能看到所有用户的日志。**

---

## 6. 管理员日志接口：真实响应样本（带筛选）

### 6.1 请求

```bash
curl -i -sS \
  -b /tmp/newapi.cookie \
  -H 'New-Api-User: 1001' \
  'http://127.0.0.1:3000/api/log/?p=0&page_size=2&type=2&username=admin&model_name=gpt-5.4'
```

### 6.2 真实响应头

```http
HTTP/1.1 200 OK
Auth-Version: 864b7076dbcd0a3c01b5520316720ebf
Content-Type: application/json; charset=utf-8
X-New-Api-Version: v0.13.1-patch.1
X-Oneapi-Request-Id: req-example-009
Date: Mon, 27 Apr 2026 08:06:52 GMT
Content-Length: 1656
```

### 6.3 真实响应体

```json
{
  "data": {
    "page": 1,
    "page_size": 2,
    "total": 10079,
    "items": [
      {
        "id": 223921,
        "user_id": 1001,
        "created_at": 1777277211,
        "type": 2,
        "content": "",
        "username": "admin",
        "token_name": "token-1",
        "model_name": "gpt-5.4",
        "quota": 88239,
        "prompt_tokens": 89324,
        "completion_tokens": 257,
        "use_time": 8,
        "is_stream": true,
        "channel": 2,
        "channel_name": "channel-1",
        "token_id": 2301,
        "group": "group-a",
        "ip": "",
        "request_id": "req-example-004",
        "other": "{\"admin_info\":{\"use_channel\":[\"2\"]},\"billing_source\":\"wallet\",\"cache_ratio\":0.1,\"cache_tokens\":22528,\"completion_ratio\":6,\"frt\":2640,\"group_ratio\":1,\"model_price\":-1,\"model_ratio\":1.25,\"reasoning_effort\":\"medium\",\"request_conversion\":[\"OpenAI Compatible\"],\"request_path\":\"/v1/chat/completions\",\"stream_status\":{\"end_reason\":\"done\",\"status\":\"ok\"},\"user_group_ratio\":-1}"
      },
      {
        "id": 223920,
        "user_id": 1001,
        "created_at": 1777277203,
        "type": 2,
        "content": "",
        "username": "admin",
        "token_name": "token-1",
        "model_name": "gpt-5.4",
        "quota": 88227,
        "prompt_tokens": 88643,
        "completion_tokens": 369,
        "use_time": 11,
        "is_stream": true,
        "channel": 2,
        "channel_name": "channel-1",
        "token_id": 2301,
        "group": "group-a",
        "ip": "",
        "request_id": "req-example-005",
        "other": "{\"admin_info\":{\"use_channel\":[\"2\"]},\"billing_source\":\"wallet\",\"cache_ratio\":0.1,\"cache_tokens\":22528,\"completion_ratio\":6,\"frt\":6375,\"group_ratio\":1,\"model_price\":-1,\"model_ratio\":1.25,\"reasoning_effort\":\"medium\",\"request_conversion\":[\"OpenAI Compatible\"],\"request_path\":\"/v1/chat/completions\",\"stream_status\":{\"end_reason\":\"done\",\"status\":\"ok\"},\"user_group_ratio\":-1}"
      }
    ]
  },
  "message": "",
  "success": true
}
```

### 6.4 这个筛选请求说明了什么

由于请求里明确带了：

```http
type=2
username=admin
model_name=gpt-5.4
```

所以返回只剩下：

- 用户 `admin`
- 模型 `gpt-5.4`
- 类型 `type=2` 的日志

即：

**管理员默认看全部；一旦传了筛选参数，就按条件过滤。**

---

## 7. 字段解释（基于本机真实返回）

下面这些字段是本机真实返回中出现的：

| 字段 | 含义 | 示例 |
|---|---|---|
| `id` | 日志记录 ID | `223921` |
| `user_id` | 用户 ID | `1` |
| `created_at` | 创建时间（Unix 时间戳） | `1777277211` |
| `type` | 日志类型 | `2` 成功消费，`5` 错误 |
| `content` | 内容/错误信息 | `status_code=429, ...` |
| `username` | 用户名 | `admin` |
| `token_name` | 使用的令牌名 | `token-1` |
| `model_name` | 模型名 | `gpt-5.4` |
| `quota` | 额度消耗 | `88239` |
| `prompt_tokens` | 输入 token 数 | `89324` |
| `completion_tokens` | 输出 token 数 | `257` |
| `use_time` | 耗时（秒） | `8` |
| `is_stream` | 是否流式 | `true` |
| `channel` | 渠道 ID | `2` |
| `channel_name` | 渠道名 | `channel-1` |
| `token_id` | 令牌 ID | `2301` |
| `group` | 用户分组 | `group-a` |
| `ip` | IP | `""` |
| `request_id` | 请求 ID | `req-example-001` |
| `other` | 扩展 JSON 字符串 | 包含 `frt`、`request_path`、`status_code` 等 |

---

## 8. 如何判断成功、失败、响应码

### 8.1 成功 / 失败

从真实返回看：

- `type = 2`：通常表示成功消费日志
- `type = 5`：通常表示错误日志

### 8.2 响应码

响应码不是固定顶层字段，但在失败日志中可以出现在：

#### `content`

```json
"content": "status_code=429, All credentials for model gpt-5.3-codex are cooling down via provider codex"
```

#### `other`

```json
"other": "{...,\"status_code\":429}"
```

### 8.3 其他有用扩展字段

`other` 中常见：

- `frt`：首响应时间
- `request_path`：如 `/v1/chat/completions`
- `stream_status.status`：如 `ok`
- `stream_status.end_reason`：如 `done`
- `request_conversion`：如 `OpenAI Compatible`
- `error_code` / `error_type` / `status_code`

---

## 9. 请求参数总结

实测中已使用到的参数：

- `p`
- `page_size`
- `type`
- `username`
- `model_name`

按代码与前端调用方式，这个接口还支持：

- `token_name`
- `start_timestamp`
- `end_timestamp`
- `channel`
- `group`
- `request_id`

---

## 10. 给其他 AI 的最短结论

如果另一个 AI 只需要一句话版本，可以直接读这段：

> 本机 `new-api` 的管理员日志接口是 `GET /api/log/`。实际调用前必须先登录 `POST /api/user/login` 拿到 session cookie，然后请求 `/api/log/` 时还必须附带 `New-Api-User: <当前登录用户ID>`。管理员默认能看到所有用户日志；如果传 `username`、`model_name`、`type` 等参数，则按条件过滤。返回结构为 `{ success, message, data: { page, page_size, total, items } }`，`items` 中包含 `username`、`model_name`、`prompt_tokens`、`completion_tokens`、`use_time`、`type`、`content`、`request_id`、`other` 等字段。

---

## 11. 复现步骤（安全版）

1. 用管理员账号调用：

```bash
curl -i -sS -c /tmp/newapi.cookie \
  -H 'Content-Type: application/json' \
  -X POST http://127.0.0.1:3000/api/user/login \
  -d '{"username":"admin","password":"<你的密码>"}'
```

2. 取全部用户日志：

```bash
curl -i -sS \
  -b /tmp/newapi.cookie \
  -H 'New-Api-User: 1001' \
  'http://127.0.0.1:3000/api/log/?p=0&page_size=5'
```

3. 只看某用户某模型：

```bash
curl -i -sS \
  -b /tmp/newapi.cookie \
  -H 'New-Api-User: 1001' \
  'http://127.0.0.1:3000/api/log/?p=0&page_size=2&type=2&username=admin&model_name=gpt-5.4'
```

---

## 12. 文件用途说明

本文件适合给：

- 代码助手
- 自动化测试代理
- 数据接入代理
- 文档分析型 AI

用于快速理解：

- 本机真实登录链路
- 本机真实日志接口调用方式
- 管理员与筛选行为
- 返回字段与扩展字段位置
