# API 文档

LLM Pulse 暴露的是公开只读聚合接口，用于前端仪表盘读取服务健康状态和模型可用性摘要。接口只返回从上游日志计算出的脱敏聚合结果，不包含原始用户日志明细、管理员凭证、请求正文或单条请求记录。

所有接口路径都以 `/status/api` 开头。响应体均为 JSON。

## GET /status/api/health

返回 BFF 服务自身的健康状态。该接口用于部署探活、反向代理检查和人工排障。

### 请求

- 方法：`GET`
- 路径：`/status/api/health`
- 请求体：无

### 响应字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `status` | `"ok"` 或 `"degraded"` | 当前服务健康状态。最近一次轮询失败时返回 `degraded`，否则返回 `ok`。 |
| `service` | `string` | 服务标识，当前为 `llm-pulse-bff`。 |
| `uptimeSeconds` | `number` | 当前 Node.js 进程已运行秒数，按整数返回。 |
| `polling` | `object` 或 `null` | 聚合轮询状态。服务尚未产生轮询状态时可能为 `null`；生产环境会对轮询错误消息做脱敏处理。 |

### JSON 示例

```json
{
  "status": "ok",
  "service": "llm-pulse-bff",
  "uptimeSeconds": 42,
  "polling": null
}
```

## GET /status/api/pulse

返回当前模型可用性脉冲数据。该接口由 BFF 从轮询结果中生成，面向前端展示聚合状态，不暴露原始用户日志明细。

### 请求

- 方法：`GET`
- 路径：`/status/api/pulse`
- 请求体：无

### 响应字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `generatedAt` | `string` | 本次聚合响应生成时间，使用 ISO 8601 字符串。 |
| `window` | `object` | 聚合统计窗口，包含 `from`、`to` 和 `seconds`。 |
| `heartbeat` | `object` | 心跳桶窗口，包含 `bucketSeconds`、`bucketCount`、`from` 和 `to`。 |
| `summary` | `object` | 模型总览计数，包含 `totalModels`、`availableModels`、`degradedModels`、`unavailableModels` 和 `unknownModels`。 |
| `models` | `array` | 按模型聚合的可用性列表。每个模型包含状态、成功数、错误数、成功率、平均延迟、最近出现时间、心跳摘要、心跳桶和渠道聚合结果。 |

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
| `modelName` | `string` | 模型名称。 |
| `status` | `"available"`、`"degraded"`、`"unavailable"` 或 `"unknown"` | 模型聚合可用性状态。 |
| `successCount` | `number` | 聚合窗口内成功请求数。 |
| `errorCount` | `number` | 聚合窗口内错误请求数。 |
| `totalCount` | `number` | 聚合窗口内请求总数。 |
| `successRate` | `number` | 成功率，范围通常为 `0` 到 `1`。 |
| `averageLatencySeconds` | `number` 或 `null` | 平均延迟秒数；无可用延迟数据时为 `null`。 |
| `lastSeenAt` | `string` 或 `null` | 该模型最近一次被观测到的时间。 |
| `heartbeat` | `object` | 该模型的心跳摘要。 |
| `beats` | `array` | 该模型的心跳桶列表。 |
| `channels` | `array` | 该模型下按渠道聚合的可用性列表。 |

### JSON 示例

```json
{
  "generatedAt": "2024-01-01T00:05:00.000Z",
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

`beats` 中的每个元素包含 `start`、`end`、`status`、`successCount`、`errorCount`、`totalCount`、`successRate` 和 `averageLatencySeconds`。`channels` 中的每个元素包含 `channelId`、`channelName`、`status`、`successCount`、`errorCount`、`totalCount`、`successRate`、`averageLatencySeconds`、`lastSeenAt`、`heartbeat` 和 `beats`。
