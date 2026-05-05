# 上游 PostgreSQL 容量与索引建议

本文记录 LLM Pulse 直读 `new-api` PostgreSQL `logs` 与 `abilities` 表时的索引建议、容量边界和后续保护项。示例只包含表名、列名和占位说明，不包含真实连接串、内部主机名或生产数据。

## 查询访问模式

BFF 的 upstream-db 查询层会读取 `logs` 表，并用 `abilities.enabled=true` 过滤可见模型。当前三类聚合查询共享这些条件：

- `logs.created_at < $1::bigint`
- `logs.type IN (2, 5)`
- `logs.model_name IS NOT NULL`
- `logs.model_name <> ''`
- `EXISTS (SELECT 1 FROM abilities WHERE abilities.model = logs.model_name AND abilities.enabled = true)`

查询会按模型和分钟 bucket 聚合最近 60 个有数据的 bucket，用于生成模型可用性、渠道聚合和 heartbeat。表增长后，主要风险是 `logs` 的时间范围扫描、按模型分组和 `abilities` 可见性过滤变慢。

## 推荐索引

建议在上游 PostgreSQL 中至少保留以下索引。创建方式需由上游数据库维护方评估锁等待、版本和维护窗口，生产环境优先使用 `CONCURRENTLY`。

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_logs_created_at
  ON logs (created_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_logs_model_name_created_at
  ON logs (model_name, created_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_logs_type_created_at
  ON logs (type, created_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_abilities_model_enabled
  ON abilities (model, enabled);
```

这些索引分别服务于时间边界裁剪、按模型分桶和排序、成功或错误类型过滤，以及 `abilities.enabled=true` 的模型可见性检查。若上游库已经存在等价或更优的复合索引，不需要重复创建。

## 容量边界

当前应用层没有实现 `PULSE_MAX_MODELS` 或 `PULSE_MAX_CHANNELS_PER_MODEL` 之类的硬限制，也没有对聚合结果做模型数或每模型渠道数截断。本任务仅补充文档和 Prometheus 规则，不改应用代码、不新增环境变量、不新增测试。

在没有代码层限制前，容量边界主要由以下因素决定：

- 上游 `logs` 表总量和近期活跃写入量。
- `abilities.enabled=true` 的模型数量。
- 每个模型最近 60 个分钟 bucket 内的渠道数量。
- `PULSE_QUERY_TIMEOUT_MS` 和 PostgreSQL `statement_timeout`。
- `PULSE_DB_POOL_MAX` 对上游数据库并发连接数的影响。

推荐把以下阈值作为运维观察线，而不是当前代码保证：

- `abilities.enabled=true` 模型数持续超过 200 时，复查 dashboard 是否仍需要展示全部模型。
- 单模型最近窗口内渠道数持续超过 100 时，复查渠道聚合是否需要分页、截断或按活跃度筛选。
- `llm_pulse_upstream_db_query_duration_seconds` 的 P95 持续超过 2 秒时，优先检查索引命中、慢查询计划和 `logs` 表膨胀。
- `llm_pulse_upstream_db_query_errors_total` 增长时，优先排查查询超时、只读账号权限、连接池耗尽和上游数据库负载。

后续如需要把容量边界变成应用层保护，建议单独实现 `PULSE_MAX_MODELS` 与 `PULSE_MAX_CHANNELS_PER_MODEL`，同步更新 `.env.example`、README、服务端配置解析、聚合逻辑和测试。未完成该代码变更前，不应把这些配置项写成已支持的运行时能力。

## 排障建议

慢查询排查时，建议在只读或受控排障会话中查看脱敏后的执行计划和索引命中情况。不要把真实 `DATABASE_URL`、数据库密码、内部主机名、原始用户日志或请求正文粘贴到工单、告警通知和文档中。

最小排查顺序：

1. 查看 `/status/api/health` 中 `upstreamDb.reachable` 和 `polling.lastQuerySucceeded`。
2. 查看 Prometheus 告警：`LLMPulseUpstreamDbUnreachable`、`LLMPulseUpstreamDbQueryErrors`、`LLMPulseUpstreamDbQuerySlow` 和 `LLMPulseQueryTimestampStale`。
3. 对照 `docs/monitoring.md` 与 `deploy/prometheus/llm-pulse.rules.yml` 检查阈值是否符合当前 `PULSE_REFRESH_INTERVAL_MS`。
4. 在上游 PostgreSQL 侧检查索引、慢查询和表膨胀，不在公开渠道暴露原始日志内容。
