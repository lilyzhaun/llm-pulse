# LLM Pulse

[![CI](actions/workflows/ci.yml/badge.svg)](actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js 22](https://img.shields.io/badge/Node.js-22-339933.svg)](.nvmrc)

LLM Pulse 是一个隐私保护优先的模型可用性仪表盘，用于从 `new-api` PostgreSQL `logs` 表中聚合模型、渠道和可用性状态，再向前端提供脱敏后的可视化数据。

它的目标是帮助维护者快速看到模型是否可用、近期请求是否健康，以及不同渠道的聚合状态。项目不会把真实用户日志直接暴露给前端，前端只读取 BFF 生成的聚合结果。

## 工作区

本仓库使用 npm workspaces：

- `apps/server`：Express BFF，使用 `pg` 连接池直读 `new-api` PostgreSQL `logs` 表，并仅保留在 `abilities` 表中存在 `enabled=true` 记录的模型，按请求窗口聚合状态并提供 REST API。服务端默认仍可直接查询 PostgreSQL，同时支持可选的本地 SQLite 增量快照路径。
- `apps/frontend`：Vite + React 前端仪表盘，构建 base path 为 `/status/`。
- `packages/shared`：共享类型包，维护前端聚合可用性响应类型和 additive 扩展字段。

根目录的 `package.json` 统一管理工作区脚本，常用命令都应从仓库根目录执行。

## Prerequisites

- Node.js `>=22.0.0`
- npm `>=10.0.0`
- 可访问 `new-api` PostgreSQL 的网络路径
- PostgreSQL 只读连接串，配置在 `DATABASE_URL`

服务端运行时通过 `pg` 查询上游数据库；当启用 `PULSE_SNAPSHOT_ENABLED=true` 时，会在 `apps/server/data/pulse-snapshot.sqlite` 维护本地 SQLite 增量快照，用于缩小 steady-state 刷新查询范围并降低 `/status/api/pulse` 的延迟。

## Installation

克隆仓库后，在仓库根目录安装依赖：

```bash
npm install
```

如果是首次配置本地环境，复制示例环境变量文件：

```bash
cp .env.example .env
```

然后按本机或部署环境能访问到的 PostgreSQL 地址填写 `.env`。不要把真实 `DATABASE_URL` 提交到仓库。

## Environment Configuration

`.env.example` 包含当前支持的配置项：

```env
DATABASE_URL=postgresql://llm_pulse_readonly:REDACTED_PASSWORD@postgres.example.internal:5432/newapi
BFF_BIND_HOST=127.0.0.1
BFF_PORT=3001
PULSE_REFRESH_INTERVAL_MS=20000
AVAILABILITY_WINDOW_SECONDS=3600
PULSE_QUERY_TIMEOUT_MS=5000
PULSE_DB_POOL_MAX=5
PULSE_DB_IDLE_TIMEOUT_MS=30000
PULSE_DB_CONN_TIMEOUT_MS=2000
PULSE_SNAPSHOT_ENABLED=false
PULSE_SNAPSHOT_PATH=apps/server/data/pulse-snapshot.sqlite
PULSE_RECONCILE_SECONDS=120
PULSE_BOOTSTRAP_BATCH_SIZE=1000
```

配置说明：

| 配置 | 说明 |
| --- | --- |
| `DATABASE_URL` | 必填。BFF 访问 `new-api` PostgreSQL 的连接串，建议使用只读用户，只允许读取 `logs` 与 `abilities` 表所需字段。 |
| `BFF_BIND_HOST` | BFF 监听地址，默认 `127.0.0.1`，用于让生产进程只接受本机反向代理访问；Docker Compose 等容器端口发布场景需要在容器内显式设为 `0.0.0.0`。 |
| `BFF_PORT` / `PORT` | BFF 监听端口。开发示例为 `3001`，生产可通过 `PORT` 或 `BFF_PORT` 覆盖。 |
| `PULSE_REFRESH_INTERVAL_MS` | 前端和运维语义上的刷新间隔。 |
| `AVAILABILITY_WINDOW_SECONDS` | 可用性聚合窗口长度。 |
| `PULSE_QUERY_TIMEOUT_MS` | 单次上游 PostgreSQL 查询超时，同时用于设置 `statement_timeout`。 |
| `PULSE_DB_POOL_MAX` | PostgreSQL 连接池最大连接数。 |
| `PULSE_DB_IDLE_TIMEOUT_MS` | 连接池空闲连接释放时间。 |
| `PULSE_DB_CONN_TIMEOUT_MS` | PostgreSQL 建连超时。 |
| `PULSE_SNAPSHOT_ENABLED` | 是否启用本地 SQLite 增量快照主路径。默认 `false`，关闭时继续走直接 PostgreSQL 聚合。 |
| `PULSE_SNAPSHOT_PATH` | SQLite 快照文件路径。默认解析为 `apps/server/data/pulse-snapshot.sqlite`。 |
| `PULSE_RECONCILE_SECONDS` | 增量刷新回查窗口秒数。默认 `120`，用于吸收同秒写入和短时间迟到日志。 |
| `PULSE_BOOTSTRAP_BATCH_SIZE` | bootstrap / reconcile 游标分页批大小。默认 `1000`。 |

安全提醒：不要提交真实 `DATABASE_URL`、生产 `.env`、原始用户日志或数据库排障输出。生产环境建议通过 systemd、容器平台或密钥管理系统注入 `DATABASE_URL`、`BFF_BIND_HOST`、`PORT` 或 `BFF_PORT` 等变量，并把环境文件权限限制为仅服务运行用户可读。非容器生产部署建议保留 `BFF_BIND_HOST=127.0.0.1`，由 Nginx 从本机反向代理访问；只有容器内端口发布需要使用 `0.0.0.0`。

额外运维建议：如果 BFF 运行在宿主机、上游 PostgreSQL 运行在 Docker 中，不要把 `DATABASE_URL` 的 host 写死为容器 IP（例如 `172.x.x.x`）。容器重建后 IP 可能漂移，导致仪表盘静默回退到旧 snapshot。优先使用稳定的宿主机入口、反向代理、固定网络别名解析方案，或其他可持久寻址方式。

## Development

从仓库根目录启动前后端开发服务：

```bash
npm run dev
```

也可以分别启动：

```bash
npm run dev:server
npm run dev:frontend
```

开发环境默认 BFF 地址来自 `BFF_BIND_HOST`，示例值为 `127.0.0.1`；端口来自 `BFF_PORT`，示例值为 `3001`。前端路径约定为 `/status/`，API 路径为：

- `GET /status/api/pulse`
- `GET /status/api/health`
- `GET /status/api/metrics`

## Build

构建所有 workspace：

```bash
npm run build
```

该命令会执行各 workspace 中存在的 build 脚本，包括服务端 TypeScript 构建和前端 Vite 构建。前端构建产物使用 `/status/` 作为 base path，部署时不要把它挂到根路径。

## Testing

运行测试：

```bash
npm test
```

运行类型检查：

```bash
npm run typecheck
```

运行 lint：

```bash
npm run lint
```

检查格式：

```bash
npm run format:check
```

自动格式化：

```bash
npm run format
```

当前测试由服务端 workspace 的 Vitest 配置承载。新增服务端逻辑时，优先在 `apps/server/test` 下补充对应测试。

## Deployment

生产部署说明见 [`deploy/README.md`](deploy/README.md)。

关键路径约定：

- 前端入口：`/status/`
- 静态资源：`/status/assets/*`
- 聚合 API：`/status/api/pulse`
- 健康检查：`/status/api/health`
- 指标接口：`/status/api/metrics`

生产环境建议先构建，再运行服务端构建产物：

```bash
npm run build --workspace @llm-pulse/server
node apps/server/dist/index.js
```

Nginx 反代示例见 `deploy/nginx-status.example.conf`。上线后至少检查：

```bash
curl -I https://ai.exesim.com/status/
curl https://ai.exesim.com/status/api/health
curl https://ai.exesim.com/status/api/pulse
```

## Architecture Overview

LLM Pulse 采用 BFF 架构：

1. `apps/server` 使用 `DATABASE_URL` 建立 `pg` 连接池，直读上游 `new-api` PostgreSQL `logs` 表，并用 `abilities.enabled=true` 过滤可见模型。
2. 聚合服务按配置窗口查询模型、渠道和心跳桶数据，并在内存中保留最近一次成功快照。
3. 启用 `PULSE_SNAPSHOT_ENABLED=true` 后，BFF 会优先从本地 SQLite snapshot 读取 `/status/api/pulse`；后台只回查最近一个小窗口的原始日志，并使用 `processed_logs` 去重。
4. `/status/api/pulse` 返回脱敏聚合结果，包含 `dataSource` 和模型级 `tokens`、`cost`、`rpm`、`tpm`；`summary` 与 `models` 只统计通过 `abilities.enabled=true` 过滤后的模型集合。
5. PostgreSQL 不可达时，BFF 不把连接错误作为 5xx 直接暴露给前端，而是返回内存快照或空快照，并通过 `dataSource.kind` 标记数据来源。
6. Express 暴露 `/status/api/pulse`、`/status/api/health` 和 `/status/api/metrics`。
7. BFF 默认绑定 `127.0.0.1`，生产由本机 Nginx 反代访问；Docker Compose 在容器内显式使用 `BFF_BIND_HOST=0.0.0.0` 以配合端口发布。
8. `apps/frontend` 读取脱敏聚合 API，并在 `/status/` 下展示仪表盘。

共享类型位于 `packages/shared`，用于降低前后端 API 结构漂移风险。

## Privacy and Safety

本项目面向运维可观测场景，默认只向前端提供聚合后的状态数据。开发和排障时请遵守以下原则：

- `/status/api/pulse`、`/status/api/health` 和 `/status/api/metrics` 是设计上的公开只读聚合接口。该公开 API 设计决策记录在 [`docs/architecture.md`](docs/architecture.md) 的访问控制设计章节中。
- 这些接口公开的原因是前端需要面向所有用户展示聚合后的脱敏状态，响应不得包含原始日志、数据库连接串或 PII。
- 公开接口禁止暴露 `DATABASE_URL`、数据库用户名、密码、内部主机名、原始用户日志和上游请求正文。未来若接入敏感数据，需要重新评审访问控制策略。
- 生产环境建议在反向代理层对 `/status/api/*` 做 rate limit；当前设计不要求为这些端点添加应用层鉴权。
- `DATABASE_URL` 必须使用占位值写入文档和示例，不能提交真实密码、真实内网地址或真实容器 IP。
- 响应和日志中的 PostgreSQL 错误必须脱敏，不应泄露连接串、密码、host 或 `host:port`。
- 生产环境建议为 BFF 创建 PostgreSQL 只读用户，只授予查询 `logs` 与 `abilities` 表的最小权限。
- 不提交 `.env`、生产环境变量文件或包含真实用户数据的日志。
- 文档示例应使用占位值或匿名化数据。
- 生产环境凭证文件应限制文件权限，只允许服务运行用户读取。

## Contributing

提交代码前建议依次运行：

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

变更应尽量保持在单一主题内。修改 API 结构时，同步更新 `packages/shared` 类型、服务端测试和前端调用方。修改部署行为时，同步检查 `deploy/README.md` 与 Nginx 示例。

## License

本项目使用 MIT License。完整文本见 [`LICENSE`](LICENSE)。
