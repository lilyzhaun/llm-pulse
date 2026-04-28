# 运维故障排查手册

本文面向 LLM Pulse 生产运维，覆盖服务状态检查、健康检查、日志查看、重启和常见故障定位。示例以当前宿主机部署为准：服务名为 `llm-pulse`，BFF 监听端口为 `43130`，公开访问路径为 `https://ai.exesim.com/status/`。

## 快速判定

先用下面三条命令判断故障层级：

```bash
systemctl is-active llm-pulse
curl -f http://127.0.0.1:43130/status/api/health
curl -f https://ai.exesim.com/status/api/pulse
```

- `systemctl is-active` 不是 `active`：优先检查 systemd、环境变量、工作目录和端口占用。
- 本机 `health` 失败，但服务为 `active`：优先检查应用日志、端口监听和环境变量。
- 本机 `health` 正常，公网 `pulse` 失败：优先检查 Nginx `/status/` 反代和 TLS 配置。
- `health.status` 为 `degraded`：BFF 进程仍在运行，但最近一次轮询失败，需要检查上游 `new-api`、凭证和轮询日志。

## 服务状态检查

查看服务是否处于运行状态：

```bash
systemctl status llm-pulse
systemctl is-active llm-pulse
```

需要确认的重点：

- `Active` 是否为 `active (running)`。
- `Main PID` 是否存在且没有频繁变化。
- 最近日志里是否有 `CHDIR`、`EADDRINUSE`、`SQLITE`、`UpstreamError`、`permission denied` 等错误。
- unit 是否读取了正确环境文件，例如 `/etc/llm-pulse.env`。

如需查看关键 sandbox 配置：

```bash
systemctl show llm-pulse.service -p WorkingDirectory -p EnvironmentFile -p ProtectSystem -p ProtectHome -p ReadWritePaths -p ReadOnlyPaths
```

当前已知限制：不要把 `ProtectHome=yes` 视为已完成加固项。当前宿主机的工作目录是 `/root/repos/llm-pulse`，`ProtectHome=yes` 会让 systemd 服务命名空间内的 `/root` 不可达，服务可能在启动阶段卡在 `status=200/CHDIR`。在迁移到非 `/root` 部署目录，或重新设计路径隔离策略前，这个限制仍需保留在风险清单里。

## 健康检查

本机探活：

```bash
curl -f http://127.0.0.1:43130/status/api/health
```

公网探活：

```bash
curl -f https://ai.exesim.com/status/api/health
```

正常响应应为 JSON，并包含：

- `status`：`ok` 或 `degraded`。
- `service`：当前应为 `llm-pulse-bff`。
- `uptimeSeconds`：当前 Node.js 进程运行秒数。
- `polling`：轮询状态。服务刚启动时可能为 `null`。

判断方式：

- `status=ok`：BFF 正常运行，最近轮询没有失败。
- `status=degraded`：BFF 可访问，但最近一次轮询失败。继续看日志中的上游请求、认证或解析错误。
- curl 返回 000、连接拒绝或超时：检查进程是否启动、端口是否监听、Nginx 是否能连到 BFF。
- curl 返回 502 或 504：通常是 Nginx 到 BFF 的反代链路失败。

## Pulse 数据检查

检查聚合数据接口：

```bash
curl -f http://127.0.0.1:43130/status/api/pulse
curl -f https://ai.exesim.com/status/api/pulse
```

响应中至少应包含 `generatedAt`、`window`、`heartbeat`、`summary` 和 `models`。如果 `health` 正常但 `pulse` 数据为空或长期不更新，按顺序检查：

1. `polling` 是否有最近失败。
2. 上游 `new-api` 是否有近期日志。
3. `POLL_INTERVAL_MS`、`AVAILABILITY_WINDOW_SECONDS`、`LOG_PAGE_SIZE`、`LOG_MAX_PAGES_PER_POLL` 是否配置合理。
4. SQLite 状态文件是否可读写，游标是否被异常状态卡住。

## 日志查看

优先查看 systemd journal：

```bash
journalctl -u llm-pulse -n 200 --no-pager
journalctl -u llm-pulse -f
```

当前宿主机也会把服务日志写到文件：

```bash
less /var/log/llm-pulse.log
tail -n 200 /var/log/llm-pulse.log
tail -f /var/log/llm-pulse.log
```

排障时常用过滤词：

```bash
journalctl -u llm-pulse --no-pager | grep -Ei 'error|warn|upstream|sqlite|permission|EADDRINUSE|CHDIR'
grep -Ei 'error|warn|upstream|sqlite|permission|EADDRINUSE|CHDIR' /var/log/llm-pulse.log
```

安全要求：复制日志给他人前，先确认没有管理员账号、密码、cookie、上游完整鉴权响应、原始用户日志或请求正文。公开文档和工单里只保留匿名化片段。

## 重启步骤

重启前先记录当前状态，便于回滚和对比：

```bash
systemctl status llm-pulse
curl -s http://127.0.0.1:43130/status/api/health
```

执行重启：

```bash
systemctl restart llm-pulse
```

重启后验证：

```bash
systemctl is-active llm-pulse
curl -f http://127.0.0.1:43130/status/api/health
curl -f https://ai.exesim.com/status/api/pulse
```

如果重启失败，立即查看最近日志：

```bash
journalctl -u llm-pulse -n 100 --no-pager
```

不要在未确认根因前反复重启。频繁重启会掩盖第一现场日志，也可能让 SQLite 状态和轮询游标更难判断。

## 常见问题

### 上游 new-api 不可达

现象：

- `/status/api/health` 返回 `degraded`。
- 日志出现上游连接超时、连接拒绝、非 2xx 响应或 `UpstreamError`。
- `/status/api/pulse` 数据长期不更新。

处理：

1. 从宿主机访问 `NEW_API_BASE_URL`，确认网络和 DNS 可用。
2. 检查 `/etc/llm-pulse.env` 中 `NEW_API_BASE_URL` 是否是服务进程能访问的地址。
3. 确认 `NEW_API_ADMIN_USERNAME` 和 `NEW_API_ADMIN_PASSWORD` 未过期，且账号仍有读取管理员日志权限。
4. 查看上游是否限流、维护或返回异常结构。
5. 修正配置后执行 `systemctl restart llm-pulse`，再检查 `health` 是否回到 `ok`。

### SQLite 文件权限或单写者限制

现象：

- 日志出现 `SQLITE_CANTOPEN`、`SQLITE_BUSY`、`readonly database`、`permission denied`。
- 服务启动后很快退出，或轮询成功但状态无法持久化。

处理：

1. 检查 `PULSE_DB_FILE` 指向的文件和父目录是否存在。
2. 确认服务运行用户对数据库目录有读写权限。
3. 生产环境应把 `PULSE_DB_FILE` 放在持久化磁盘，例如 `/var/lib/llm-pulse/pulse-state.sqlite`。
4. 确认同一个 SQLite 文件只有一个 BFF 实例写入。当前架构不是多写者模型，多实例部署前需要改用外部共享数据库，或拆出单独的轮询写入者。
5. 如果使用 systemd sandbox，确认 `ReadWritePaths` 覆盖了 SQLite 文件所在目录。

### 轮询失败或数据不更新

现象：

- `/status/api/health` 可访问但 `status=degraded`。
- `pulse.generatedAt` 有变化，但 `models` 长期为空。
- 日志显示轮询 tick 失败、解析上游响应失败或认证失败。

处理：

1. 先看 `journalctl -u llm-pulse -n 200 --no-pager`。
2. 对照环境变量检查 `POLL_INTERVAL_MS`、`LOG_PAGE_SIZE`、`LOG_MAX_PAGES_PER_POLL` 和 `LOG_REWIND_SECONDS`。
3. 确认上游日志接口确实有当前时间窗口内的数据。
4. 如怀疑游标状态异常，先备份 SQLite 文件，再决定是否清理状态。不要直接删除生产数据库文件。
5. 修复后等待至少一个轮询周期，再复查 `health.polling` 和 `pulse.generatedAt`。

### 端口冲突

现象：

- 日志出现 `EADDRINUSE`。
- `systemctl status llm-pulse` 显示服务反复退出。
- 本机 `curl http://127.0.0.1:43130/status/api/health` 返回的不是 LLM Pulse。

处理：

```bash
ss -ltnp | grep ':43130'
```

确认占用进程后，选择释放端口或调整 `PORT` / `BFF_PORT`。如果调整端口，同步检查 Nginx `/status/` 反代目标，避免公网仍代理到旧端口。

### Nginx 反代异常

现象：

- 本机 `http://127.0.0.1:43130/status/api/health` 正常。
- 公网 `https://ai.exesim.com/status/api/health` 返回 404、502 或 504。

处理：

1. 检查 Nginx 配置是否包含 `location = /status` 和 `location ^~ /status/`。
2. 确认 `/status/*` 代理到当前 BFF 端口 `43130`。
3. 确认根站点 `https://ai.exesim.com/` 的原有代理没有被覆盖。
4. 修改配置后先执行 `nginx -t`，再 reload Nginx。

## 安全提醒

- `/etc/llm-pulse.env` 这类凭证文件应限制为仅 root 或服务运行用户可读，建议权限为 `600`。
- 不要把真实 `.env`、管理员账号、密码、cookie、session、原始用户日志或请求正文提交到仓库。
- 不要把带敏感字段的日志片段直接落盘到文档、工单或聊天记录。
- 排障命令输出需要分享时，先用占位符替换域名之外的内部地址、账号、token、cookie 和用户标识。
- `/status/api/pulse` 是公开只读聚合接口，不能扩展为返回原始日志明细。

## 升级或改配置后的验收

每次改 systemd、Nginx、环境变量或部署目录后，至少执行：

```bash
systemctl is-active llm-pulse
curl -f http://127.0.0.1:43130/status/api/health
curl -f https://ai.exesim.com/status/api/health
curl -f https://ai.exesim.com/status/api/pulse
```

验收通过标准：

- systemd 服务为 `active`。
- 本机和公网 `health` 返回 2xx JSON。
- `pulse` 返回聚合响应结构。
- 日志中没有新的 `permission denied`、`CHDIR`、`EADDRINUSE`、`SQLITE` 或上游认证错误。
