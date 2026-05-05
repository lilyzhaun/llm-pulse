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
- `health.status` 为 `degraded` 且 `upstreamDb.reachable=false`：BFF 进程仍在运行，但上游 PostgreSQL 不可达或查询失败，需要检查 `DATABASE_URL`、网络、数据库权限以及 `logs` / `abilities` 表可读性。

## 服务状态检查

查看服务是否处于运行状态：

```bash
systemctl status llm-pulse
systemctl is-active llm-pulse
```

需要确认的重点：

- `Active` 是否为 `active (running)`。
- `Main PID` 是否存在且没有频繁变化。
- 最近日志里是否有 `CHDIR`、`EADDRINUSE`、`PostgreSQL`、`database`、`permission denied`、`timeout` 等错误。
- unit 是否读取了正确环境文件，例如 `/etc/llm-pulse.env`。

如需查看关键 sandbox 配置：

```bash
systemctl show llm-pulse.service -p User -p Group -p WorkingDirectory -p EnvironmentFile -p ProtectSystem -p ProtectHome -p NoNewPrivileges -p MemoryMax -p MemoryHigh -p CPUQuota -p ReadWritePaths -p ReadOnlyPaths
```

当前宿主机保留硬约束：`User=root`、`WorkingDirectory=/root/repos/llm-pulse`、`ProtectHome=no`。不要在未迁移部署目录前把它们改成非 root 用户、非 `/root` 路径或 `ProtectHome=yes`。已落地的补偿控制包括 `NoNewPrivileges=yes`、`ProtectSystem=strict`、`PrivateTmp=yes`、内核相关保护、地址族限制、`ReadOnlyPaths=/root/repos/llm-pulse /etc/llm-pulse.env`、`ReadWritePaths=/var/log /root/repos/llm-pulse/apps/server/data`、`MemoryMax=512M`、`MemoryHigh=384M`、`CPUQuota=80%`、`TasksMax=128` 和 `LimitNOFILE=65536`。

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
- `polling`：兼容命名的查询状态。服务刚启动时可能为 `null`。
- `upstreamDb.reachable`：上游 PostgreSQL 是否可达。
- `upstreamDb.lastSuccessAt`：最近一次成功查询时间，失败或尚无成功查询时为 `null`。

判断方式：

- `status=ok`：BFF 正常运行，最近 PostgreSQL 查询没有失败。
- `status=degraded` 且 `upstreamDb.reachable=false`：BFF 可访问，但上游 PostgreSQL 不可达或查询失败。继续检查连接参数、数据库权限和日志。
- curl 返回 000、连接拒绝或超时：检查进程是否启动、端口是否监听、Nginx 是否能连到 BFF。
- curl 返回 502 或 504：通常是 Nginx 到 BFF 的反代链路失败。

## Pulse 数据检查

检查聚合数据接口：

```bash
curl -f http://127.0.0.1:43130/status/api/pulse
curl -f https://ai.exesim.com/status/api/pulse
```

响应中至少应包含 `generatedAt`、`dataSource`、`window`、`heartbeat`、`summary` 和 `models`。如果 `health` 正常但 `pulse` 数据为空或长期不更新，按顺序检查：

1. `dataSource.kind` 是否为 `upstream-postgres`。如果是 `memory-snapshot` 或 `empty`，先排查 PostgreSQL 可达性。
2. `upstreamDb.reachable` 是否为 `false`。
3. 上游 `logs` 表是否有当前 `AVAILABILITY_WINDOW_SECONDS` 窗口内的数据。
4. 若期望中的模型缺失，检查 `abilities` 表里是否存在对应模型的 `enabled=true` 记录；没有的话该模型会被 BFF 过滤掉。
5. `DATABASE_URL`、`PULSE_QUERY_TIMEOUT_MS`、`PULSE_DB_POOL_MAX`、`PULSE_DB_CONN_TIMEOUT_MS` 是否配置合理。

## 上游 PostgreSQL 排障

### 检查环境变量

先确认 systemd 读取的环境文件存在且权限收紧：

```bash
ls -l /etc/llm-pulse.env
systemctl show llm-pulse.service -p EnvironmentFile
```

`/etc/llm-pulse.env` 应包含脱敏后形如下面的配置，真实值不要写入文档、工单或聊天记录：

```env
DATABASE_URL=postgresql://llm_pulse_readonly:REDACTED_PASSWORD@postgres.example.internal:5432/newapi
PULSE_QUERY_TIMEOUT_MS=5000
PULSE_DB_POOL_MAX=5
PULSE_DB_CONN_TIMEOUT_MS=2000
```

`/etc/llm-pulse.env` 是当前宿主机的生产配置源，仓库根目录 `.env` 只用于本地开发，不保存生产 secret。安全要求：分享排障信息前，必须替换 `DATABASE_URL` 中的密码、用户名之外的敏感路径、内部主机名和端口。应用日志和 API 响应也不应暴露完整连接串。

### 检查网络和 SQL

如果 PostgreSQL 在容器内运行，不要默认使用宿主机 `127.0.0.1:5432`。只有显式做了端口映射时，宿主机本地端口才可用。未映射时，应从 BFF 所在网络使用容器网络 IP、服务名或同一 Docker 网络内的主机名。

可在 PostgreSQL 容器内检查：

```bash
docker exec postgres psql -U newapi -d newapi -c 'SELECT 1;'
docker exec postgres psql -U newapi -d newapi -c 'SELECT COUNT(*) FROM logs;'
```

如果 BFF 在另一个容器中运行，应从 BFF 容器所在网络测试到 PostgreSQL 的连接，而不是只在宿主机测试。

### 检查权限

生产已为 LLM Pulse 使用 least-privilege DB 账号。该用户只需要读取 `logs` 与 `abilities` 表所需字段，不需要写权限、DDL 权限或管理员权限。

可以用只读用户验证最小查询能力：

```bash
psql 'postgresql://llm_pulse_readonly:REDACTED_PASSWORD@postgres.example.internal:5432/newapi' -c 'SELECT 1;'
psql 'postgresql://llm_pulse_readonly:REDACTED_PASSWORD@postgres.example.internal:5432/newapi' -c 'SELECT COUNT(*) FROM logs;'
psql 'postgresql://llm_pulse_readonly:REDACTED_PASSWORD@postgres.example.internal:5432/newapi' -c 'SELECT COUNT(*) FROM abilities WHERE enabled = true;'
```

命令中的连接串必须先替换为脱敏占位值再分享。若排障必须在终端中使用真实值，确保 shell 历史和日志不会被公开。

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
journalctl -u llm-pulse --no-pager | grep -Ei 'error|warn|upstream|postgres|database|permission|timeout|EADDRINUSE|CHDIR'
grep -Ei 'error|warn|upstream|postgres|database|permission|timeout|EADDRINUSE|CHDIR' /var/log/llm-pulse.log
```

安全要求：复制日志给他人前，先确认没有 `DATABASE_URL`、数据库用户名、密码、内部主机名、原始用户日志或请求正文。公开文档和工单里只保留匿名化片段。

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

不要在未确认根因前反复重启。频繁重启会掩盖第一现场日志，也会清空进程内最近一次成功快照。

## 常见问题

### 上游 PostgreSQL 不可达

现象：

- `/status/api/health` 返回 200 JSON，但 `status=degraded`。
- `upstreamDb.reachable=false`。
- `/status/api/pulse` 返回 `dataSource.kind=memory-snapshot` 或 `dataSource.kind=empty`。
- 日志出现上游连接超时、连接拒绝、认证失败、权限不足或 PostgreSQL 查询错误。

处理：

1. 检查 `/etc/llm-pulse.env` 中 `DATABASE_URL` 是否是服务进程能访问的地址。
2. 确认 PostgreSQL 容器或服务正在运行，并且 BFF 所在网络能访问它。
3. 如果没有端口映射，不要用宿主机 `127.0.0.1:5432` 作为连接地址。改用容器网络 IP、Docker 网络服务名，或显式映射端口后再使用宿主机地址。
4. 使用 `SELECT 1`、`SELECT COUNT(*) FROM logs` 和 `SELECT COUNT(*) FROM abilities WHERE enabled = true` 验证连接、权限和表存在。
5. 检查 `PULSE_QUERY_TIMEOUT_MS` 和 `PULSE_DB_CONN_TIMEOUT_MS` 是否过短。
6. 修正配置后执行 `systemctl restart llm-pulse`，再检查 `health` 是否回到 `ok`。

### 数据为空或长期不更新

现象：

- `/status/api/health` 可访问。
- `pulse.generatedAt` 有变化，但 `models` 长期为空。
- `dataSource.kind=upstream-postgres`，说明数据库查询成功。

处理：

1. 确认 `AVAILABILITY_WINDOW_SECONDS` 覆盖了预期观察范围。
2. 在 PostgreSQL 中检查 `logs` 表是否有当前窗口内的数据。
3. 确认日志中的模型名称、请求类型、成功失败字段符合当前聚合口径。
4. 查看 `/status/api/metrics` 中 `llm_pulse_upstream_db_query_errors_total` 是否持续增加。
5. 如果只有个别模型缺失，先检查上游是否真的写入了该模型的记录，再检查 `abilities` 中是否存在对应模型的 `enabled=true` 记录，避免把可见性过滤误判为 BFF 故障。

### `DATABASE_URL` 权限或脱敏问题

现象：

- 日志出现认证失败、权限不足或 relation access denied。
- 工单或聊天记录中误贴了完整连接串。

处理：

1. 立即轮换泄露的数据库密码。
2. 确认 BFF 使用只读用户，且权限只覆盖 `logs` 与 `abilities` 表所需读取范围。
3. 检查 `/etc/llm-pulse.env` 权限，建议为 `600`。
4. 检查应用日志、shell 历史和工单附件，删除或脱敏完整连接串。
5. 重启服务并确认 `/status/api/health` 返回 `ok`。

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
- `/etc/llm-pulse.env` 是生产配置源，仓库根目录 `.env` 不保存生产 secret；不要把真实 `.env`、`DATABASE_URL`、数据库密码、内部主机名、原始用户日志或请求正文提交到仓库。
- 不要把带敏感字段的日志片段直接落盘到文档、工单或聊天记录。
- 排障命令输出需要分享时，先用占位符替换内部地址、账号、密码、token、cookie 和用户标识。
- `/status/api/pulse` 是公开只读聚合接口，不能扩展为返回原始日志明细。
- 当前补偿控制依赖 BFF localhost bind、Nginx rate limit 与安全响应头、metrics localhost 限制、systemd sandbox 与资源限制、least-privilege DB，以及 CI secret scanning。排障或改配置时必须逐项确认这些控制仍有效。

## 升级或改配置后的验收

每次改 systemd、Nginx、环境变量或部署目录后，至少执行：

```bash
systemctl is-active llm-pulse
curl -f http://127.0.0.1:43130/status/api/health
curl -f https://ai.exesim.com/status/api/health
curl -f https://ai.exesim.com/status/api/pulse
curl -f http://127.0.0.1:43130/status/api/metrics
```

验收通过标准：

- systemd 服务为 `active`。
- 本机和公网 `health` 返回 2xx JSON。
- `health.upstreamDb.reachable=true`，除非正在验证故障降级路径。
- `pulse` 返回聚合响应结构，并包含 `dataSource`。
- metrics 包含 `llm_pulse_upstream_db_reachable`、`llm_pulse_upstream_db_query_duration_seconds` 和 `llm_pulse_upstream_db_query_errors_total`。
- 日志中没有新的 `permission denied`、`CHDIR`、`EADDRINUSE`、PostgreSQL 认证错误或连接串泄露。
