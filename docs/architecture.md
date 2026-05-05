# 架构设计文档

LLM Pulse 是一个隐私保护优先的模型可用性仪表盘。系统由 BFF 直读 `new-api` PostgreSQL `logs` 表，在服务端完成聚合与脱敏，再把结果提供给前端仪表盘。前端只读取聚合后的状态，不直接访问 PostgreSQL，也不展示原始用户日志。

## 工作区结构

本仓库使用 npm workspaces，核心代码分为三个工作区：

- `apps/server`：Express BFF。负责读取配置、建立 `pg` 连接池、查询上游 PostgreSQL `logs` 表、根据 `abilities.enabled=true` 过滤可见模型、聚合模型和渠道可用性、维护最近一次成功的内存快照，并提供 `/status/api/*` REST API。
- `apps/frontend`：Vite + React Dashboard。构建 base path 为 `/status/`，通过 BFF 提供的公开只读 API 渲染模型可用性、心跳桶、成功率、延迟、tokens、quota、RPM、TPM 和渠道状态。
- `packages/shared`：共享 TypeScript 类型。维护 `AvailabilityResponse`、`AvailabilityDataSource`、`ModelAvailability`、`ChannelAvailability`、`HeartbeatBucket` 等前后端共用结构，降低 API 字段漂移风险。

根目录的 `package.json` 统一管理工作区脚本。开发、构建、测试等命令应从仓库根目录执行。

## 总体架构

系统采用 BFF 架构，BFF 是上游 PostgreSQL 日志表与公开前端之间的唯一桥接层。

```text
new-api PostgreSQL logs / abilities 表
        |
        | DATABASE_URL，仅服务端持有，建议只读用户
        v
apps/server Express BFF
        |
        | pg pool 查询、聚合、脱敏、内存快照
        v
/status/api/pulse、/status/api/health、/status/api/metrics
        |
        | JSON 或 Prometheus 文本，只读公开接口
        v
apps/frontend React Dashboard
```

BFF 持有访问 PostgreSQL 所需的 `DATABASE_URL`，前端不会接触数据库连接串、数据库账号、密码或单条请求日志。服务端不持久化本地状态，只在进程内保存最近一次成功聚合快照，用于上游数据库短暂不可达时降级返回。

## 数据流

1. `apps/server` 从环境变量读取 `DATABASE_URL`、`PULSE_REFRESH_INTERVAL_MS`、`AVAILABILITY_WINDOW_SECONDS`、`PULSE_QUERY_TIMEOUT_MS`、`PULSE_DB_POOL_MAX`、`PULSE_DB_IDLE_TIMEOUT_MS`、`PULSE_DB_CONN_TIMEOUT_MS` 与端口配置。
2. 上游查询层使用 `pg` pool 连接 `new-api` PostgreSQL，并对查询设置超时。查询参数通过 pg values 传入，不拼接用户输入。
3. 查询层先用 `abilities.enabled=true` 过滤出可见模型，再按当前窗口查询三组数据：模型聚合、渠道聚合、心跳 bucket。
4. 模型聚合输出请求数、成功数、错误数、成功率、平均延迟、最近观测时间，以及模型级 `tokens`、`cost.quota`、`rpm` 和 `tpm`。
5. 心跳聚合按固定 bucket 生成每个模型的 `beats`，并汇总 `healthyBuckets`、`degradedBuckets`、`unavailableBuckets`、`unknownBuckets`、`availabilityRate`、`lastStatus` 与 `lastBeatAt`。
6. 查询成功时，BFF 返回 `dataSource.kind=upstream-postgres`，并把本次响应保存在内存中作为 `lastSnapshot`。
7. 查询失败时，BFF 记录脱敏后的错误消息，不返回 5xx。若存在内存快照，返回 `dataSource.kind=memory-snapshot`；若没有快照，返回 `dataSource.kind=empty` 的空响应。
8. React Dashboard 调用这些 API，并在 `/status/` 下展示聚合后的可用性视图。

## 模型可见性规则

当前“可用模型集合”的权威来源不是 `logs` 表本身，而是上游 `abilities` 表。

- 若某个 `logs.model_name` 在 `abilities` 中存在至少一条 `enabled=true` 记录，则该模型对 Dashboard 可见。
- 若模型只存在于 `logs` 中，但在 `abilities` 中没有任何 `enabled=true` 记录，则不会出现在 `/status/api/pulse`。
- 当前不按 `abilities.group` 做二次过滤，也不附加 `channels.status=1` 之类的渠道健康约束。

这条规则统一应用在模型聚合、渠道聚合和心跳聚合三个查询层，避免 `summary`、`models`、`channels` 与心跳统计口径分裂。

## `dataSource` 语义

`/status/api/pulse` 响应包含 additive 字段 `dataSource`：

| 字段 | 说明 |
| --- | --- |
| `kind` | 数据来源，取值为 `upstream-postgres`、`memory-snapshot` 或 `empty`。 |
| `lastQueryAt` | 最近一次 PostgreSQL 查询尝试时间。启动后尚无查询时可为 `null`。 |
| `lastQueryDurationMs` | 最近一次查询耗时毫秒数。启动检查失败或尚无耗时时可为 `null`。 |
| `lastErrorMessage` | 最近一次查询失败的脱敏错误消息。成功时为 `null`。 |

`kind=upstream-postgres` 表示响应来自当前窗口内的上游 PostgreSQL 查询。`kind=memory-snapshot` 表示上游数据库当前不可达，响应来自最近一次成功快照，summary 会被标记为整体降级。`kind=empty` 表示上游数据库不可达且进程内没有可用快照，响应仍为 200，但模型列表为空。

## 模型级用量字段

`models[]` 保留旧的可用性字段，并新增模型级 additive 用量字段：

| 字段 | 说明 |
| --- | --- |
| `tokens.input` | 聚合窗口内输入 tokens。 |
| `tokens.cacheInput` | 聚合窗口内缓存输入 tokens。 |
| `tokens.output` | 聚合窗口内输出 tokens。 |
| `tokens.total` | 输入、缓存输入和输出 tokens 总和。 |
| `cost.quota` | 聚合窗口内 `quota` 原始数值之和，不附加币种语义。 |
| `rpm.average` | 窗口内平均每分钟请求数。 |
| `rpm.peak` | 窗口内单分钟请求峰值。 |
| `tpm.average` | 窗口内平均每分钟 tokens。 |
| `tpm.peak` | 窗口内单分钟 tokens 峰值。 |

这些字段是模型级聚合，不在 channel 行展示，避免扩大公开 API 的细粒度数据范围。

## 核心模块职责

### `apps/server`

- 配置管理：解析端口、PostgreSQL 连接串、刷新间隔、窗口长度、查询超时和连接池参数。
- 上游访问：通过 `pg` pool 查询 `new-api` PostgreSQL `logs` 表，并读取 `abilities` 表做模型可见性过滤。
- 聚合计算：按模型和渠道生成可用性、心跳桶、成功率、延迟、最近出现时间、tokens、quota、RPM、TPM 和 summary。
- 降级快照：查询成功后保存最近一次响应；查询失败时返回内存快照或空快照。
- API 输出：提供 `/status/api/pulse`、`/status/api/health` 与 `/status/api/metrics`。

### `apps/frontend`

- 作为 `/status/` 下的可视化 Dashboard 运行。
- 调用 `/status/api/pulse` 获取聚合后的模型和渠道状态。
- 展示 `summary`、模型状态、心跳桶、成功率、平均延迟、最近出现时间、模型级 tokens、quota、RPM、TPM 和渠道聚合信息。
- 不直接访问 PostgreSQL，不持有 `DATABASE_URL`，不读取原始日志。

### `packages/shared`

- 定义前后端共享的可用性响应类型。
- 约束 `AvailabilityResponse`、`AvailabilityDataSource`、`AvailabilitySummary`、`ModelAvailability`、`ChannelAvailability`、`HeartbeatSummary` 与 `HeartbeatBucket` 等结构。
- 帮助服务端输出和前端消费保持一致。

## REST API 角色分工

### `GET /status/api/pulse`

`/status/api/pulse` 是前端仪表盘的核心数据源。它返回当前聚合窗口内的模型可用性脉冲数据，包括：

- `generatedAt`：响应生成时间。
- `dataSource`：响应数据来源和最近查询状态。
- `window`：聚合统计窗口。
- `heartbeat`：心跳桶窗口。
- `summary`：模型总览计数。
- `models`：模型级可用性列表，每个模型包含心跳、请求统计、延迟、tokens、quota、RPM、TPM 和渠道聚合结果。

该接口面向展示层，只包含聚合后的状态数据，不包含原始用户日志明细、数据库连接串、请求正文或单条请求记录。上游 PostgreSQL 不可达时，该接口仍返回 200，并通过 `dataSource.kind` 表示降级来源。

### `GET /status/api/health`

`/status/api/health` 用于服务探活、反向代理检查和人工排障。它返回 BFF 自身状态，包括服务标识、进程运行时间、兼容命名的 `polling` 状态和 `upstreamDb` 状态。

`upstreamDb.reachable=false` 时，健康状态为 `degraded`。`lastSuccessAt` 只在最近一次查询成功时返回时间，否则为 `null`。

### `GET /status/api/metrics`

`/status/api/metrics` 暴露 Prometheus 文本格式指标。除进程默认指标外，当前重点指标包括上游 PostgreSQL 查询耗时、查询失败次数和可达性。

## 安全边界

安全边界集中在 BFF：

- `DATABASE_URL` 只允许服务端读取。当前宿主机生产配置源是 `/etc/llm-pulse.env`，该文件由 systemd `EnvironmentFile` 读取并限制权限；仓库根目录 `.env` 只用于本地开发，不保存生产 secret。
- 前端只调用 `/status/api/*`，不直接访问 PostgreSQL。
- `/status/api/pulse` 只返回模型、渠道和时间窗口上的聚合结果，不暴露原始用户日志、请求正文、单条请求记录或用户级明细。
- `/status/api/health` 用于探活和排障，生产环境中的错误消息应保持脱敏，避免把连接串、内部主机名、账号或密码泄露给客户端。
- 文档、测试和示例应使用占位值或匿名化数据。
- 生产环境已为 BFF 使用最小权限 PostgreSQL 只读用户，只授予读取 `logs` 与 `abilities` 表所需字段的权限。

这条边界让公开 Dashboard 可以展示服务质量趋势，同时避免把数据库访问能力和用户请求明细传给浏览器。

### 访问控制设计

`/status/api/pulse`、`/status/api/health` 与 `/status/api/metrics` 是设计上的公开只读聚合接口，不属于安全漏洞。它们服务于 `/status/` 下的公开 Dashboard、部署探活和可观测性读取，只返回聚合后的脱敏状态，不包含原始日志、数据库连接串或 PII。

这些公开接口禁止暴露以下数据类别：`DATABASE_URL`、数据库用户名、数据库密码、内部主机名、原始用户日志、上游请求正文。若未来接入用户级明细、租户数据、请求正文、计费明细或其他敏感数据，必须重新评审访问控制策略，再决定是否引入应用层鉴权、访问控制列表或隔离后的内部接口。

生产部署建议在反向代理层对 `/status/api/*` 实施 rate limit，降低公开只读接口被高频访问的风险。本设计不要求在当前应用层为这些端点添加鉴权。

### 当前生产约束与补偿控制

当前宿主机保留以下硬约束，文档和配置不得把它们写成已迁移状态：

- `User=root`
- `WorkingDirectory=/root/repos/llm-pulse`
- `ProtectHome=no`

这些约束已通过已落地的补偿控制降低风险：

- BFF 默认绑定 `127.0.0.1:43130`，只接受本机 Nginx 反向代理访问；Docker Compose 端口发布场景才在容器内显式使用 `BFF_BIND_HOST=0.0.0.0`。
- Nginx 已为 `/status/` 启用 HTTPS、`limit_req`、基础安全响应头和 Report-Only CSP；`/status/api/metrics` 在反向代理层限制为 localhost 访问。
- systemd 在保留 root 和 `/root/repos/llm-pulse` 的同时启用 `NoNewPrivileges=yes`、`ProtectSystem=strict`、`PrivateTmp=yes`、内核相关保护、地址族限制、`ReadOnlyPaths`、`ReadWritePaths`、`MemoryMax=512M`、`MemoryHigh=384M`、`CPUQuota=80%`、`TasksMax=128` 和 `LimitNOFILE=65536`。
- PostgreSQL 使用 least-privilege DB 账号，BFF 只具备读取 `logs` 与 `abilities` 的最小权限，不具备写入或 DDL 能力。
- CI 已加入 secret scanning 和依赖完整性检查，避免生产 secret、连接串或 token 回流到仓库。

## 关键配置

常用配置来自环境变量：

| 配置 | 说明 |
| --- | --- |
| `DATABASE_URL` | 上游 `new-api` PostgreSQL 连接串，仅服务端使用。建议使用只读用户和脱敏占位值写入文档。 |
| `PORT` / `BFF_PORT` | BFF 监听端口。开发示例为 `3001`，当前生产服务端口为 `43130`。 |
| `PULSE_REFRESH_INTERVAL_MS` | 刷新间隔。 |
| `AVAILABILITY_WINDOW_SECONDS` | 可用性聚合窗口长度。 |
| `PULSE_QUERY_TIMEOUT_MS` | 查询超时毫秒数，同时用于 PostgreSQL `statement_timeout`。 |
| `PULSE_DB_POOL_MAX` | PostgreSQL 连接池最大连接数。 |
| `PULSE_DB_IDLE_TIMEOUT_MS` | PostgreSQL 空闲连接超时。 |
| `PULSE_DB_CONN_TIMEOUT_MS` | PostgreSQL 建连超时。 |

路径约定：

- 前端 base path：`/status/`
- 静态资源路径：`/status/assets/*`
- 聚合 API：`/status/api/pulse`
- 健康检查：`/status/api/health`
- 指标接口：`/status/api/metrics`

## 当前限制与部署注意事项

- BFF 依赖运行环境到 `new-api` PostgreSQL 的网络可达性。本机开发不应假设 `127.0.0.1:5432` 一定可用，除非 PostgreSQL 已显式把端口映射到宿主机。
- 上游 PostgreSQL 短暂不可达时，`/status/api/pulse` 会返回内存快照或空响应，`/status/api/health` 会返回 200 与 `status=degraded`，并设置 `upstreamDb.reachable=false`。
- 服务端只维护进程内快照。进程重启后若 PostgreSQL 仍不可达，会返回 `dataSource.kind=empty`，直到下一次查询成功。
- 当前宿主机部署路径保留在 `/root/repos/llm-pulse`，systemd 保留 `User=root`、`WorkingDirectory=/root/repos/llm-pulse` 与 `ProtectHome=no`。不要在未迁移目录前把文档或配置改写为非 root 用户、非 `/root` 路径或 `ProtectHome=yes`。
- 生产环境不要依赖仓库根目录本地 `.env`。当前生产配置源是 `/etc/llm-pulse.env`，连接串和端口等配置由该文件注入，并限制环境文件权限。
- 上游 PostgreSQL 的推荐索引和容量边界见 [`docs/upstream-db.md`](upstream-db.md)。当前没有实现 `PULSE_MAX_MODELS` 或 `PULSE_MAX_CHANNELS_PER_MODEL` 代码层限制，这两个配置名仅作为后续保护项建议。
