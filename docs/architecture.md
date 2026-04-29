# 架构设计文档

LLM Pulse 是一个隐私保护优先的模型可用性仪表盘。系统从 `new-api` 管理员日志中读取近期请求记录，在 BFF 内完成聚合与脱敏，再把结果提供给前端仪表盘。前端只读取聚合后的状态，不直接访问 `new-api`，也不展示原始用户日志。

## 工作区结构

本仓库使用 npm workspaces，核心代码分为三个工作区：

- `apps/server`：Express BFF。负责读取配置、登录 `new-api` 管理员接口、按间隔轮询日志、聚合模型和渠道可用性、把轮询游标与近期状态写入 SQLite，并提供 `/status/api/*` REST API。
- `apps/frontend`：Vite + React Dashboard。构建 base path 为 `/status/`，通过 BFF 提供的公开只读 API 渲染模型可用性、心跳桶、成功率、延迟和渠道状态。
- `packages/shared`：共享 TypeScript 类型。维护 `AvailabilityResponse`、`ModelAvailability`、`ChannelAvailability`、`HeartbeatBucket` 等前后端共用结构，降低 API 字段漂移风险。

根目录的 `package.json` 统一管理工作区脚本。开发、构建、测试等命令应从仓库根目录执行。

## 总体架构

系统采用 BFF 架构，BFF 是上游 `new-api` 管理员日志与公开前端之间的唯一桥接层。

```text
new-api 管理员日志
        |
        | 管理员凭证，仅服务端持有
        v
apps/server Express BFF
        |
        | 轮询、rewind、去重、聚合、脱敏
        v
SQLite 持久化状态
        |
        | 聚合响应
        v
/status/api/pulse 与 /status/api/health
        |
        | JSON，只读公开接口
        v
apps/frontend React Dashboard
```

BFF 持有访问 `new-api` 管理员接口所需的配置，前端不会接触管理员账号、密码、session cookie 或单条请求日志。SQLite 用来保存轮询游标和近期状态，避免服务重启后完全丢失上下文。

## 数据流

1. `apps/server` 从环境变量读取 `NEW_API_BASE_URL`、`NEW_API_ADMIN_USERNAME`、`NEW_API_ADMIN_PASSWORD`、`POLL_INTERVAL_MS`、`AVAILABILITY_WINDOW_SECONDS`、`LOG_PAGE_SIZE`、`LOG_MAX_PAGES_PER_POLL`、`LOG_REWIND_SECONDS` 与 `PULSE_DB_FILE`。
2. 轮询服务按 `POLL_INTERVAL_MS` 定期访问 `new-api` 管理员日志接口。读取日志时使用 rewind 窗口，降低边界时间和分页造成漏数的风险。
3. 服务端对日志做去重和归一化处理，再按模型、渠道和时间窗口聚合请求数、成功数、错误数、成功率、平均延迟和最近观测时间。
4. 聚合服务生成模型级和渠道级可用性状态，状态取值来自 `packages/shared`：`available`、`degraded`、`unavailable`、`unknown`。
5. 心跳聚合把窗口切成固定 bucket，生成每个模型和渠道的 `beats`，并汇总 `healthyBuckets`、`degradedBuckets`、`unavailableBuckets`、`unknownBuckets`、`availabilityRate`、`lastStatus` 与 `lastBeatAt`。
6. SQLite 保存轮询游标和近期聚合所需状态。服务重启后，BFF 可以基于持久化数据继续工作，而不是完全依赖内存。
7. Express 对外暴露只读 REST API。React Dashboard 调用这些 API，并在 `/status/` 下展示聚合后的可用性视图。

## 核心模块职责

### `apps/server`

- 配置管理：解析端口、上游地址、管理员凭证、轮询间隔、窗口长度、分页大小、rewind 秒数和 SQLite 文件路径。
- 上游访问：使用服务端持有的管理员配置访问 `new-api` 日志接口。
- 轮询调度：周期性抓取近期日志，并防止未完成 tick 并发执行。
- 日志处理：按请求标识去重，结合 rewind 策略减少漏采。
- 聚合计算：按模型和渠道生成可用性、心跳桶、成功率、延迟、最近出现时间和 summary。
- 持久化：通过 `PULSE_DB_FILE` 指向的 SQLite 文件保存轮询游标和近期状态。
- API 输出：提供 `/status/api/pulse` 与 `/status/api/health`，只返回 JSON。

### `apps/frontend`

- 作为 `/status/` 下的可视化 Dashboard 运行。
- 调用 `/status/api/pulse` 获取聚合后的模型和渠道状态。
- 展示 `summary`、模型状态、心跳桶、成功率、平均延迟、最近出现时间和渠道聚合信息。
- 不直接访问 `new-api`，不持有管理员凭证，不读取原始日志。

### `packages/shared`

- 定义前后端共享的可用性响应类型。
- 约束 `AvailabilityResponse`、`AvailabilitySummary`、`ModelAvailability`、`ChannelAvailability`、`HeartbeatSummary` 与 `HeartbeatBucket` 等结构。
- 帮助服务端输出和前端消费保持一致。

## REST API 角色分工

### `GET /status/api/pulse`

`/status/api/pulse` 是前端仪表盘的核心数据源。它返回当前聚合窗口内的模型可用性脉冲数据，包括：

- `generatedAt`：响应生成时间。
- `window`：聚合统计窗口。
- `heartbeat`：心跳桶窗口。
- `summary`：模型总览计数。
- `models`：模型级可用性列表，每个模型包含心跳、请求统计、延迟和渠道聚合结果。

该接口面向展示层，只包含聚合后的状态数据，不包含原始用户日志明细、管理员凭证、请求正文或单条请求记录。

### `GET /status/api/health`

`/status/api/health` 用于服务探活、反向代理检查和人工排障。它返回 BFF 自身状态，包括服务标识、进程运行时间和轮询状态。最近一次轮询失败时，健康状态可能变为 `degraded`。

该接口不用于驱动 Dashboard 主视图，也不返回模型列表。它的职责是回答“BFF 是否在运行，轮询是否健康”。

## 安全边界

安全边界集中在 BFF：

- 管理员凭证只允许服务端读取。生产环境应通过 systemd、容器平台或密钥管理系统注入，不应提交 `.env`、生产环境变量文件或 session cookie。
- 前端只调用 `/status/api/*`，不直接访问 `new-api` 管理员接口。
- `/status/api/pulse` 只返回模型、渠道和时间窗口上的聚合结果，不暴露原始用户日志、请求正文、单条请求记录或用户级明细。
- `/status/api/health` 用于探活和排障，生产环境中的轮询错误消息应保持脱敏，避免把上游地址、凭证或敏感响应泄露给客户端。
- 文档、测试和示例应使用占位值或匿名化数据。

这条边界让公开 Dashboard 可以展示服务质量趋势，同时避免把运维侧管理员权限和用户请求明细传给浏览器。

### 访问控制设计

`/status/api/pulse`、`/status/api/health` 与 `/status/api/metrics` 是设计上的公开只读聚合接口，不属于安全漏洞。它们服务于 `/status/` 下的公开 Dashboard、部署探活和可观测性读取，只返回聚合后的脱敏状态，不包含原始日志、管理员凭证或 PII。

这些公开接口禁止暴露以下数据类别：管理员凭证、session cookie、原始用户日志、上游请求正文。若未来接入用户级明细、租户数据、请求正文、计费数据或其他敏感数据，必须重新评审访问控制策略，再决定是否引入应用层鉴权、访问控制列表或隔离后的内部接口。

生产部署建议在反向代理层对 `/status/api/*` 实施 rate limit，降低公开只读接口被高频访问的风险。本设计不要求在当前应用层为这些端点添加鉴权。

## 关键配置

常用配置来自环境变量：

| 配置 | 说明 |
| --- | --- |
| `NEW_API_BASE_URL` | 上游 `new-api` 地址，仅服务端使用。 |
| `NEW_API_ADMIN_USERNAME` | 上游管理员用户名，仅服务端使用。 |
| `NEW_API_ADMIN_PASSWORD` | 上游管理员密码，仅服务端使用。 |
| `PORT` / `BFF_PORT` | BFF 监听端口。开发示例为 `3001`，当前生产服务端口为 `43130`。 |
| `POLL_INTERVAL_MS` | 轮询间隔。 |
| `AVAILABILITY_WINDOW_SECONDS` | 可用性聚合窗口长度。 |
| `LOG_PAGE_SIZE` | 每页读取的上游日志数量。 |
| `LOG_MAX_PAGES_PER_POLL` | 单次轮询最多读取页数。 |
| `LOG_REWIND_SECONDS` | 增量轮询时向前回退的秒数。 |
| `PULSE_DB_FILE` | SQLite 状态文件路径。本地默认可用 `./apps/server/data/pulse-state.sqlite`，生产应指向持久化磁盘，例如 `/var/lib/llm-pulse/pulse-state.sqlite`。 |

路径约定：

- 前端 base path：`/status/`
- 静态资源路径：`/status/assets/*`
- 聚合 API：`/status/api/pulse`
- 健康检查：`/status/api/health`

## 当前限制与部署注意事项

- SQLite 当前适合单 BFF 写入者模型。同一个 `PULSE_DB_FILE` 不应被多个 BFF 实例同时写入。如需多实例部署，需要先引入外部共享数据库，或拆出单独的轮询写入者。
- SQLite 文件必须放在持久化磁盘上。若 `PULSE_DB_FILE` 指向临时目录，重启或重新部署后会丢失轮询游标和近期状态。
- 当前宿主机部署路径在 `/root/repos/llm-pulse`。已知 `systemd` 的 `ProtectHome=yes` 会让服务命名空间内的 `/root` 不可达，和 `WorkingDirectory=/root/repos/llm-pulse` 存在启动阶段冲突。该限制尚未闭环，不应把它记录为已完成的加固项。后续可通过迁移部署目录到非 `/root` 路径，或重新设计 unit 的路径隔离策略来解决。
- 生产环境不要依赖仓库根目录本地 `.env`。凭证和端口等配置应由部署系统注入，并限制环境文件权限。
