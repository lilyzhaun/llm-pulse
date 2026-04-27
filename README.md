# LLM Pulse

LLM Pulse 是一个隐私保护优先的模型可用性仪表盘，用于从 `new-api` 管理员日志中聚合模型、渠道和可用性状态，再向前端提供脱敏后的可视化数据。

## 工作区

本仓库使用 npm workspaces：

- `apps/*`：后续前端与 BFF 应用。
- `packages/*`：共享类型与工具包。

当前已包含 `packages/shared`，用于维护 `new-api` 日志响应类型和前端聚合可用性响应类型。

## 本地约定

复制 `.env.example` 为 `.env` 后填写本机 `new-api` 管理员配置。不要提交真实凭证、session cookie 或原始用户日志。
