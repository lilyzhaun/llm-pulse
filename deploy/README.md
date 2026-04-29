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
PORT=43130 BFF_PORT=43130 npm run dev:server
```

生产建议改为运行：

```bash
npm run build --workspace @llm-pulse/server && node apps/server/dist/index.js
```

生产环境不要依赖仓库根目录的本地 `.env` 文件；请通过 systemd、容器平台或密钥管理系统注入 `NEW_API_BASE_URL`、`NEW_API_ADMIN_USERNAME`、`NEW_API_ADMIN_PASSWORD`、`PORT`/`BFF_PORT` 等环境变量，避免把凭证写入代码目录。

`PULSE_DB_FILE` 用于配置 BFF 持久化状态的 SQLite 文件路径。生产环境必须指向持久化磁盘，例如 `/var/lib/llm-pulse/pulse-state.sqlite`，否则重启或重新部署后会丢失轮询游标和近期状态。SQLite 写入要求同一数据库文件只由一个 BFF 实例使用；如需多实例部署，请先引入外部共享数据库或单独的轮询写入者。

## systemd 资源限制

仓库中的 `deploy/llm-pulse.service` 模板为服务预留了明确的资源边界：

- `MemoryMax=512M`：单实例的硬上限，防止异常缓存、日志堆积或轮询风暴把主机内存吃满。
- `MemoryHigh=384M`：软上限，接近阈值时 systemd 会开始施加回压，帮助服务在压力升高时更早暴露问题。
- `CPUQuota=80%`：限制该服务占用整机 CPU 的比例，避免 BFF 影响同机其他进程。

`MemoryMax` 和 SQLite 数据量、缓存规模存在直接关系：轮询保存的近期日志、聚合缓存和数据库文件越大，进程的常驻内存越容易上升。如果后续发现 `MemoryHigh` 触发过于频繁，可以先检查轮询窗口、缓存保留量和数据库膨胀，再决定是否上调上限；不要在未确认原因前直接移除限制。

当前模板仍假设服务以 `root` 运行，因此 `PULSE_DB_FILE=/var/lib/llm-pulse/pulse-state.sqlite` 只要求目录存在即可，不需要额外 `chown`。如果未来要切换为 `llm-pulse` 用户，需要提前迁移目录所有权和权限，至少包括：

1. 确认 `/var/lib/llm-pulse` 及其下的 SQLite 文件可被 `llm-pulse` 用户读写。
2. 如果继续写日志到 `/var/log/llm-pulse.log`，确保日志文件和轮转脚本的权限也允许新用户追加。
3. 预先验证 `EnvironmentFile=/etc/llm-pulse.env` 对新用户仍可读取，且文件权限足够收紧但不影响启动。
4. 更新 systemd 模板中的 `User=` / `Group=` 后，再用一次完整启动检查验证 `ExecStartPre`、`WorkingDirectory` 和 `ReadWritePaths` 是否都还成立。

重要：仓库模板表达的是目标部署形态，不等于线上 `/etc/systemd/system/llm-pulse.service` 已同步。实际宿主机的单位文件需要单独对照确认。

## Nginx

参考：

- `deploy/nginx-status.example.conf`

关键原则：

1. 保持现有 `location /` 继续代理到原站点
2. 只新增 `location = /status` 和 `location ^~ /status/`
3. 将 `/status/*` 反代到 LLM Pulse BFF 端口

## logrotate

仓库内提供 `deploy/logrotate.d/llm-pulse`，用于轮转 `/var/log/llm-pulse.log`。部署时将该文件安装到宿主机的 logrotate 配置目录，例如 `/etc/logrotate.d/llm-pulse`，即可按每日轮转、保留 7 份并启用压缩。

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
