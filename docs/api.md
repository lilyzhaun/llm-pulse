# API 文档

LLM Pulse 暴露的是公开只读聚合接口，用于前端仪表盘读取服务健康状态和模型可用性摘要。接口只返回从 `new-api` PostgreSQL `logs` 表计算、并结合 `abilities.enabled=true` 可见性规则过滤后的脱敏聚合结果，不包含原始用户日志明细、数据库连接串、请求正文或单条请求记录。

所有接口路径都以 `/status/api` 开头。JSON 接口响应体均为 JSON。

## GET /status/api/health

返回 BFF 服务自身的健康状态。该接口用于部署探活、反向代理检查和人工排障。

### 请求

- 方法：`GET`
- 路径：`/status/api/health`
- 请求体：无

### 响应字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `status` | `"ok"` 或 `"degraded"` | 当前服务健康状态。上游 PostgreSQL 不可达时返回 `degraded`，否则返回 `ok`。 |
| `service` | `string` | 服务标识，当前为 `llm-pulse-bff`。 |
| `uptimeSeconds` | `number` | 当前 Node.js 进程已运行秒数，按整数返回。 |
| `polling` | `object` 或 `null` | 兼容旧命名的查询状态。服务尚未产生查询状态时可能为 `null`；生产环境会对错误消息做脱敏处理。 |
| `upstreamDb` | `object` | 上游 PostgreSQL 状态，包含 `reachable` 和 `lastSuccessAt`。 |
| `snapshot` | `object` | 本地 SQLite 增量快照状态，包含是否启用、是否 ready、最近 refresh 时间、covered-until watermark 与 lag 秒数。 |

### `upstreamDb` 字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `reachable` | `boolean` | 最近一次查询是否未失败。启动期尚无失败记录时按可达处理。 |
| `lastSuccessAt` | `string` 或 `null` | 最近一次成功查询时间。最近查询失败或尚无成功查询时为 `null`。 |

### `snapshot` 字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `enabled` | `boolean` | 是否已启用本地 SQLite snapshot 主路径。 |
| `ready` | `boolean` | snapshot 是否完成 bootstrap 并可用于读取 `/status/api/pulse`。 |
| `bootstrapCompletedAt` | `string` 或 `null` | 最近一次 bootstrap 完成时间。 |
| `lastRefreshAt` | `string` 或 `null` | 最近一次 snapshot refresh 尝试时间。 |
| `coveredUntil` | `number` 或 `null` | 当前 snapshot 覆盖到的上游 `logs.created_at` 秒级 watermark。 |
| `lagSeconds` | `number` 或 `null` | 当前时间与 snapshot watermark 之间的滞后秒数。 |
| `lastRefreshSucceeded` | `boolean` 或 `null` | 最近一次 snapshot refresh 是否成功。 |
| `processedLogCount` | `number` 或 `null` | 当前 snapshot 去重表 `processed_logs` 的保留行数。 |

### JSON 示例

```json
{
  "status": "ok",
  "service": "llm-pulse-bff",
  "uptimeSeconds": 42,
  "polling": {
    "lastQueryAt": "2024-01-01T00:05:00.000Z",
    "lastQuerySucceeded": true,
    "lastErrorMessage": null,
    "lastQueryDurationMs": 38,
    "lastPollAt": "2024-01-01T00:05:00.000Z",
    "lastPollSucceeded": true
  },
  "upstreamDb": {
    "reachable": true,
    "lastSuccessAt": "2024-01-01T00:05:00.000Z"
  },
  "snapshot": {
    "enabled": true,
    "ready": true,
    "bootstrapCompletedAt": "2024-01-01T00:00:00.000Z",
    "lastRefreshAt": "2024-01-01T00:05:00.000Z",
    "coveredUntil": 1704067500,
    "lagSeconds": 12,
    "lastRefreshSucceeded": true,
    "processedLogCount": 21
  }
}
```

PostgreSQL 不可达时，该接口仍返回 200 JSON，示例：

```json
{
  "status": "degraded",
  "service": "llm-pulse-bff",
  "uptimeSeconds": 84,
  "polling": {
    "lastQueryAt": "2024-01-01T00:06:00.000Z",
    "lastQuerySucceeded": false,
    "lastErrorMessage": "Upstream PostgreSQL query failed",
    "lastQueryDurationMs": 2000,
    "lastPollAt": "2024-01-01T00:06:00.000Z",
    "lastPollSucceeded": false
  },
  "upstreamDb": {
    "reachable": false,
    "lastSuccessAt": null
  },
  "snapshot": {
    "enabled": true,
    "ready": false,
    "bootstrapCompletedAt": null,
    "lastRefreshAt": null,
    "coveredUntil": null,
    "lagSeconds": null,
    "lastRefreshSucceeded": false,
    "processedLogCount": 0
  }
}
```

## GET /status/api/pulse

返回当前模型可用性脉冲数据。该接口面向前端展示聚合状态，不暴露原始用户日志明细。底层既可能来自直接 PostgreSQL 聚合，也可能来自本地 SQLite snapshot 主路径，但对外响应结构保持不变。

模型可见性规则：只有在上游 `abilities` 表中存在至少一条 `enabled=true` 记录的模型，才会出现在该接口的 `models`、`summary`、`channels` 与心跳统计中。不按 `group` 再做二次过滤。

### 请求

- 方法：`GET`
- 路径：`/status/api/pulse`
- 请求体：无

### 响应字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `generatedAt` | `string` | 本次聚合响应生成时间，使用 ISO 8601 字符串。 |
| `dataSource` | `object` | 响应数据来源和最近查询状态。 |
| `window` | `object` | 聚合统计窗口，包含 `from`、`to` 和 `seconds`。 |
| `heartbeat` | `object` | 心跳桶窗口，包含 `bucketSeconds`、`bucketCount`、`from` 和 `to`。 |
| `summary` | `object` | 模型总览计数，包含 `totalModels`、`availableModels`、`degradedModels`、`unavailableModels` 和 `unknownModels`。这些计数只覆盖通过 `abilities.enabled=true` 过滤后的可见模型。 |
| `models` | `array` | 按模型聚合的可用性列表。每个模型包含状态、成功数、错误数、成功率、平均延迟、最近出现时间、模型级用量、心跳摘要、心跳桶和渠道聚合结果。列表只包含通过 `abilities.enabled=true` 过滤后的可见模型。 |

### `dataSource` 字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `kind` | `"upstream-postgres"`、`"memory-snapshot"` 或 `"empty"` | `upstream-postgres` 表示当前响应来自健康的主聚合路径；当启用 SQLite snapshot 主路径时，对外仍保持这个值以兼容现有前端校验。`memory-snapshot` 表示 PostgreSQL 或 snapshot 刷新失败，返回最近一次成功快照；`empty` 表示没有可用快照。 |
| `lastQueryAt` | `string` 或 `null` | 最近一次查询尝试时间。 |
| `lastQueryDurationMs` | `number` 或 `null` | 最近一次查询耗时毫秒数。 |
| `lastErrorMessage` | `string` 或 `null` | 最近一次查询失败的脱敏错误消息。成功时为 `null`。 |

PostgreSQL 不可达或 snapshot refresh 失败时，该接口仍返回 200。若 `kind=memory-snapshot`，响应来自进程内最近一次成功快照，summary 会标记为整体降级；若 `kind=empty`，响应包含空模型列表和空窗口。

### `window` 字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `from` | `string` | 聚合窗口开始时间。 |
| `to` | `string` | 聚合窗口结束时间。 |
| `seconds` | `number` | 窗口长度，单位为秒。 |

### `heartbeat` 字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `bucketSeconds` | `number` | 单个心跳桶长度，单位为秒。 |
| `bucketCount` | `number` | 心跳桶数量。 |
| `from` | `string` | 心跳窗口开始时间。 |
| `to` | `string` | 心跳窗口结束时间。 |

### `models[]` 字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `modelName` | `string` | 模型名称。只有在 `abilities` 中存在至少一条 `enabled=true` 记录时才会出现。 |
| `status` | `"available"`、`"degraded"`、`"unavailable"` 或 `"unknown"` | 模型聚合可用性状态。 |
| `successCount` | `number` | 聚合窗口内成功请求数。 |
| `errorCount` | `number` | 聚合窗口内错误请求数。 |
| `totalCount` | `number` | 聚合窗口内请求总数。 |
| `successRate` | `number` | 成功率，范围通常为 `0` 到 `1`。 |
| `averageLatencySeconds` | `number` 或 `null` | 平均延迟秒数；无可用延迟数据时为 `null`。 |
| `lastSeenAt` | `string` 或 `null` | 该模型最近一次被观测到的时间。 |
| `tokens` | `object` | 模型级 tokens 聚合，包含 `input`、`cacheInput`、`output` 和 `total`。 |
| `cost` | `object` | 模型级费用口径，当前仅包含 `quota` 原始数值，不附加币种语义。 |
| `rpm` | `object` | 模型级请求速率，包含 `average` 和 `peak`。 |
| `tpm` | `object` | 模型级 tokens 速率，包含 `average` 和 `peak`。 |
| `heartbeat` | `object` | 该模型的心跳摘要。 |
| `beats` | `array` | 该模型的心跳桶列表。 |
| `channels` | `array` | 该模型下按渠道聚合的可用性列表。 |

### JSON 示例

```json
{
  "generatedAt": "2024-01-01T00:05:00.000Z",
  "dataSource": {
    "kind": "upstream-postgres",
    "lastQueryAt": "2024-01-01T00:05:00.000Z",
    "lastQueryDurationMs": 38,
    "lastErrorMessage": null
  },
  "window": {
    "from": "2024-01-01T00:00:00.000Z",
    "to": "2024-01-01T00:05:00.000Z",
    "seconds": 300
  },
  "heartbeat": {
    "bucketSeconds": 60,
    "bucketCount": 5,
    "from": "2024-01-01T00:00:00.000Z",
    "to": "2024-01-01T00:05:00.000Z"
  },
  "summary": {
    "totalModels": 1,
    "availableModels": 1,
    "degradedModels": 0,
    "unavailableModels": 0,
    "unknownModels": 0
  },
  "models": [
    {
      "modelName": "gpt-4o-mini",
      "status": "available",
      "successCount": 3,
      "errorCount": 0,
      "totalCount": 3,
      "successRate": 1,
      "averageLatencySeconds": 1.2,
      "lastSeenAt": "2024-01-01T00:04:00.000Z",
      "tokens": {
        "input": 1200,
        "cacheInput": 300,
        "output": 800,
        "total": 2300
      },
      "cost": {
        "quota": 42
      },
      "rpm": {
        "average": 0.6,
        "peak": 2
      },
      "tpm": {
        "average": 460,
        "peak": 1200
      },
      "heartbeat": {
        "healthyBuckets": 1,
        "degradedBuckets": 0,
        "unavailableBuckets": 0,
        "unknownBuckets": 0,
        "observedBuckets": 1,
        "availabilityRate": 1,
        "lastStatus": "available",
        "lastBeatAt": "2024-01-01T00:04:00.000Z"
      },
      "beats": [],
      "channels": []
    }
  ]
}
```

`beats` 中的每个元素包含 `start`、`end`、`status`、`successCount`、`errorCount`、`totalCount`、`successRate` 和 `averageLatencySeconds`。`channels` 中的每个元素包含 `channelId`、`channelName`、`status`、`successCount`、`errorCount`、`totalCount`、`successRate`、`averageLatencySeconds`、`lastSeenAt`、`heartbeat` 和 `beats`。这些渠道和心跳聚合同样只覆盖通过 `abilities.enabled=true` 过滤后的模型日志。

## GET /status/api/metrics

返回 Prometheus 文本格式指标。该接口用于持续监控，不返回 JSON。

当前 upstream-db 相关指标包括：

- `llm_pulse_upstream_db_query_duration_seconds`
- `llm_pulse_upstream_db_query_errors_total`
- `llm_pulse_upstream_db_reachable`

当前 snapshot 相关指标包括：

- `llm_pulse_snapshot_enabled`
- `llm_pulse_snapshot_ready`
- `llm_pulse_snapshot_refresh_duration_seconds`
- `llm_pulse_snapshot_lag_seconds`
- `llm_pulse_snapshot_processed_logs`
- `llm_pulse_snapshot_errors_total`
