# LLM Pulse

LLM Pulse 是一个隐私保护优先的模型可用性仪表盘，用于从 `new-api` 管理员日志中聚合模型、渠道和可用性状态，再向前端提供脱敏后的可视化数据。

它的目标是帮助维护者快速看到模型是否可用、近期请求是否健康，以及不同渠道的聚合状态。项目不会把真实用户日志直接暴露给前端，前端只读取 BFF 生成的聚合结果。

## 工作区

本仓库使用 npm workspaces：

- `apps/server`：Express BFF，负责登录 `new-api` 管理员接口、轮询日志、聚合状态、持久化 SQLite 状态，并提供 REST API。
- `apps/frontend`：Vite + React 前端仪表盘，构建 base path 为 `/status/`。
- `packages/shared`：共享类型包，维护 `new-api` 日志响应类型和前端聚合可用性响应类型。

根目录的 `package.json` 统一管理工作区脚本，常用命令都应从仓库根目录执行。

## Prerequisites

- Node.js `>=22.0.0`
- npm `>=10.0.0`
- 可访问的 `new-api` 管理员接口
- 本地开发可使用默认 SQLite 文件路径 `./apps/server/data/pulse-state.sqlite`

Node 版本要求不能降低，因为服务端依赖 Node 22 提供的 `node:sqlite`。

## Installation

克隆仓库后，在仓库根目录安装依赖：

```bash
npm install
```

如果是首次配置本地环境，复制示例环境变量文件：

```bash
cp .env.example .env
```

然后按本机 `new-api` 管理员配置填写 `.env`。

## Environment Configuration

`.env.example` 包含当前支持的配置项：

```env
NEW_API_BASE_URL=http://127.0.0.1:3000
NEW_API_ADMIN_USERNAME=
NEW_API_ADMIN_PASSWORD=
BFF_PORT=3001
POLL_INTERVAL_MS=10000
AVAILABILITY_WINDOW_SECONDS=3600
LOG_PAGE_SIZE=100
LOG_MAX_PAGES_PER_POLL=10
LOG_REWIND_SECONDS=5
PULSE_DB_FILE=./apps/server/data/pulse-state.sqlite
```

安全提醒：不要提交真实凭证、session cookie、原始用户日志或生产 `.env`。生产环境建议通过 systemd、容器平台或密钥管理系统注入 `NEW_API_BASE_URL`、`NEW_API_ADMIN_USERNAME`、`NEW_API_ADMIN_PASSWORD`、`PORT` 或 `BFF_PORT` 等变量。

`PULSE_DB_FILE` 应指向持久化磁盘。SQLite 写入要求同一数据库文件只由一个 BFF 实例使用，如果要部署多个实例，需要先引入外部共享数据库或单独的轮询写入者。

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

开发环境默认 BFF 端口来自 `BFF_PORT`，示例值为 `3001`。前端路径约定为 `/status/`，API 路径为：

- `GET /status/api/pulse`
- `GET /status/api/health`

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

1. `apps/server` 使用管理员配置访问 `new-api` 日志接口。
2. 轮询服务按配置间隔抓取近期日志，并用 rewind 窗口降低漏数风险。
3. 聚合服务按模型、渠道和时间窗口生成可用性状态。
4. SQLite 保存轮询游标和近期状态，避免服务重启后完全丢失上下文。
5. Express 暴露 `/status/api/pulse` 和 `/status/api/health`。
6. `apps/frontend` 读取脱敏聚合 API，并在 `/status/` 下展示仪表盘。

共享类型位于 `packages/shared`，用于降低前后端 API 结构漂移风险。

## Privacy and Safety

本项目面向运维可观测场景，默认只向前端提供聚合后的状态数据。开发和排障时请遵守以下原则：

- 不把真实管理员账号、密码或 cookie 写入仓库。
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
