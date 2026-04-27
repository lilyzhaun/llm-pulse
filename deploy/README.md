# LLM Pulse 生产部署说明

## 目标

将 LLM Pulse 安全部署到：

- `https://ai.exesim.com/status/`

并确保：

- 根站点 `https://ai.exesim.com/` 保持现有代理行为不变
- LLM Pulse 仅占用 `/status` 前缀
- API 仅暴露在 `/status/api/*`

## 代码侧约定

- 前端构建 base：`/status/`
- 前端 API：`/status/api/pulse`
- BFF 健康检查：`/status/api/health`
- BFF 静态托管：`/status/` 与 `/status/assets/*`

## 构建

在仓库根目录执行：

```bash
npm run build
```

## 运行 BFF

示例：

```bash
PORT=43111 BFF_PORT=43111 npm run dev:server
```

生产建议改为运行：

```bash
npm run build --workspace @llm-pulse/server && node apps/server/dist/index.js
```

生产环境不要依赖仓库根目录的本地 `.env` 文件；请通过 systemd、容器平台或密钥管理系统注入 `NEW_API_BASE_URL`、`NEW_API_ADMIN_USERNAME`、`NEW_API_ADMIN_PASSWORD`、`PORT`/`BFF_PORT` 等环境变量，避免把凭证写入代码目录。

`PULSE_DB_FILE` 用于配置 BFF 持久化状态的 SQLite 文件路径。生产环境必须指向持久化磁盘，例如 `/var/lib/llm-pulse/pulse-state.sqlite`，否则重启或重新部署后会丢失轮询游标和近期状态。SQLite 写入要求同一数据库文件只由一个 BFF 实例使用；如需多实例部署，请先引入外部共享数据库或单独的轮询写入者。

## Nginx

参考：

- `deploy/nginx-status.example.conf`

关键原则：

1. 保持现有 `location /` 继续代理到原站点
2. 只新增 `location = /status` 和 `location ^~ /status/`
3. 将 `/status/*` 反代到 LLM Pulse BFF 端口

## 验证项

上线后至少检查：

```bash
curl -I https://ai.exesim.com/status/
curl https://ai.exesim.com/status/api/health
curl https://ai.exesim.com/status/api/pulse
```

并手动确认：

- `https://ai.exesim.com/` 仍返回旧站点
- `https://ai.exesim.com/status/` 返回 LLM Pulse
- 刷新 `/status/` 深层路径不出现 404
