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
- BFF metrics：`/status/api/metrics`
- BFF 静态托管：`/status/` 与 `/status/assets/*`
- BFF 默认监听：`127.0.0.1:43130`，由本机 Nginx 反向代理访问；仅容器端口发布场景在容器内使用 `BFF_BIND_HOST=0.0.0.0`

## 构建

在仓库根目录执行：

```bash
npm run build
```

## 运行 BFF

示例：

```bash
BFF_BIND_HOST=127.0.0.1 PORT=43130 BFF_PORT=43130 npm run dev:server
```

生产建议改为运行：

```bash
npm run build --workspace @llm-pulse/server && node apps/server/dist/index.js
```

当前宿主机通过 systemd `EnvironmentFile=/etc/llm-pulse.env` 注入生产配置。`/etc/llm-pulse.env` 是生产配置源，仓库根目录 `.env` 只用于本地开发，不保存生产 secret。请通过 systemd、容器平台或密钥管理系统注入 `DATABASE_URL`、`BFF_BIND_HOST`、`PORT`/`BFF_PORT`、`PULSE_REFRESH_INTERVAL_MS`、`AVAILABILITY_WINDOW_SECONDS` 和 PostgreSQL 连接池参数，避免把连接串写入代码目录。非容器部署应保留 `BFF_BIND_HOST=127.0.0.1`，避免 BFF 直接暴露到公网网卡；Docker Compose 已在容器内显式设置 `BFF_BIND_HOST=0.0.0.0` 以支持端口发布。

`DATABASE_URL` 是 BFF 访问 `new-api` PostgreSQL `logs` 表的连接串。生产已使用 least-privilege DB 账号，只授予读取 `logs` 与 `abilities` 表所需字段的最小权限。即使当前 systemd 模板仍以 `root` 运行，数据库权限也保持只读，避免 BFF 进程拥有写入或 DDL 能力。

如果 PostgreSQL 在容器内运行，本机示例不要默认写 `127.0.0.1:5432`。只有 PostgreSQL 容器显式做了端口映射时，宿主机本地端口才可用。未映射时，应让 BFF 通过容器网络 IP、Docker 网络服务名，或部署平台提供的内部 DNS 访问 PostgreSQL。

脱敏示例：

```env
DATABASE_URL=postgresql://llm_pulse_readonly:REDACTED_PASSWORD@postgres.example.internal:5432/newapi
BFF_BIND_HOST=127.0.0.1
BFF_PORT=43130
PULSE_REFRESH_INTERVAL_MS=20000
AVAILABILITY_WINDOW_SECONDS=3600
PULSE_QUERY_TIMEOUT_MS=5000
PULSE_DB_POOL_MAX=5
PULSE_DB_IDLE_TIMEOUT_MS=30000
PULSE_DB_CONN_TIMEOUT_MS=2000
```

## systemd 资源限制

仓库中的 `deploy/llm-pulse.service` 模板与当前宿主机约束保持一致，保留：

- `User=root`
- `WorkingDirectory=/root/repos/llm-pulse`
- `ProtectHome=no`

在这些约束下，模板已经为服务设置明确的资源边界：

- `MemoryMax=512M`：单实例的硬上限，防止异常缓存、日志堆积或查询风暴把主机内存吃满。
- `MemoryHigh=384M`：软上限，接近阈值时 systemd 会开始施加回压，帮助服务在压力升高时更早暴露问题。
- `CPUQuota=80%`：限制该服务占用整机 CPU 的比例，避免 BFF 影响同机其他进程。
- `TasksMax=128` 和 `LimitNOFILE=65536`：限制任务数量并明确文件描述符上限。

模板也启用了当前已落地的 sandbox 控制：`NoNewPrivileges=yes`、`ProtectSystem=strict`、`PrivateTmp=yes`、内核相关保护、`PrivateDevices=yes`、`RestrictSUIDSGID=yes`、`LockPersonality=yes`、`RestrictRealtime=yes`、`RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX`、`SystemCallArchitectures=native`、`ReadOnlyPaths=/root/repos/llm-pulse /etc/llm-pulse.env` 和 `ReadWritePaths=/var/log /root/repos/llm-pulse/apps/server/data`。

`MemoryMax` 和 PostgreSQL 查询结果规模、进程内最近快照、前端静态托管存在直接关系。如果后续发现 `MemoryHigh` 触发过于频繁，可以先检查聚合窗口、上游查询耗时、返回模型数量和日志量，再决定是否上调上限；不要在未确认原因前直接移除限制。

当前模板明确保留服务以 `root` 运行。如果未来要切换为 `llm-pulse` 用户，需要作为独立迁移任务提前验证以下事项：

1. 如果继续写日志到 `/var/log/llm-pulse.log`，确保日志文件和轮转脚本的权限允许新用户追加。
2. 预先验证 `EnvironmentFile=/etc/llm-pulse.env` 对新用户仍可读取，且文件权限足够收紧但不影响启动。
3. 确认新用户能访问部署目录和前端构建产物。
4. 更新 systemd 模板中的 `User=` / `Group=` 后，再用一次完整启动检查验证 `ExecStartPre`、`WorkingDirectory` 和 sandbox 配置是否都还成立。

重要：当前任务范围内不要修改线上 systemd。变更部署前应单独对照 `/etc/systemd/system/llm-pulse.service` 与仓库模板，并确认 `User=root`、`WorkingDirectory=/root/repos/llm-pulse` 与 `ProtectHome=no` 仍符合保留约束。

## Nginx

参考：

- `deploy/nginx-status.example.conf`

关键原则：

1. 保持现有 `location /` 继续代理到原站点
2. 只新增 `location = /status` 和 `location ^~ /status/`
3. 将 `/status/*` 反代到 LLM Pulse BFF 端口
4. 保留 `/status/` HTTPS、`limit_req`、安全响应头和 Report-Only CSP
5. 保留 `/status/api/metrics` 的 localhost 访问限制，按需只增加明确的 Prometheus 抓取 IP

这些 Nginx 控制与 BFF `127.0.0.1` 监听、systemd sandbox 和资源限制、least-privilege DB、CI secret scanning 一起构成当前 root 运行约束下的补偿控制。

## logrotate

仓库内提供 `deploy/logrotate.d/llm-pulse`，用于轮转 `/var/log/llm-pulse.log`。部署时将该文件安装到宿主机的 logrotate 配置目录，例如 `/etc/logrotate.d/llm-pulse`，即可按每日轮转、保留 7 份并启用压缩。

日志中不应出现真实 `DATABASE_URL`、数据库密码、内部主机名或原始用户日志。发现泄露后应立即轮换数据库密码，并清理相关日志或工单附件。

## 验证项

上线后至少检查：

```bash
curl -I https://ai.exesim.com/status/
curl https://ai.exesim.com/status/api/health
curl https://ai.exesim.com/status/api/pulse
curl http://127.0.0.1:43130/status/api/metrics
```

并手动确认：

- `https://ai.exesim.com/` 仍返回旧站点
- `https://ai.exesim.com/status/` 返回 LLM Pulse
- 刷新 `/status/` 深层路径不出现 404
- `health.upstreamDb.reachable=true`，除非正在验证数据库不可达降级
- `pulse.dataSource.kind=upstream-postgres`，并包含模型级 `tokens`、`cost`、`rpm` 和 `tpm`
- metrics 包含 `llm_pulse_upstream_db_reachable`、`llm_pulse_upstream_db_query_duration_seconds` 和 `llm_pulse_upstream_db_query_errors_total`
