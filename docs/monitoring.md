# 监控与告警配置

本文说明如何把 LLM Pulse 接入 Prometheus 抓取，并给出基于当前已实现指标的告警规则建议。示例只描述接入方向，不假设生产环境已经部署 Prometheus 或 Alertmanager。

## Metrics 端点

LLM Pulse 在 BFF 上暴露 Prometheus 文本格式指标：

- 方法：`GET`
- 路径：`/status/api/metrics`
- 内容类型：由 `prom-client` 设置，通常为 `text/plain; version=0.0.4; charset=utf-8`

该端点包含两类指标：

1. `prom-client` 默认 Node.js 进程指标，例如进程 CPU、内存、事件循环、GC 和 Node.js 版本相关指标。
2. LLM Pulse 应用级指标：
   - `llm_pulse_uptime_seconds`：BFF 进程已运行秒数。
   - `llm_pulse_polling_healthy`：兼容旧命名的查询健康状态，`1` 表示最近查询未失败，`0` 表示降级。
   - `llm_pulse_polling_last_timestamp_seconds`：最近一次 PostgreSQL 查询尝试的 Unix 秒级时间戳；服务尚未产生查询时间时可能暂时没有样本。
   - `llm_pulse_poll_duration_seconds`：BFF 刷新编排耗时直方图。
   - `llm_pulse_aggregation_duration_seconds`：聚合逻辑耗时直方图。
   - `llm_pulse_upstream_db_query_duration_seconds`：上游 PostgreSQL 查询耗时直方图。
   - `llm_pulse_upstream_db_query_errors_total`：上游 PostgreSQL 查询失败总数。
   - `llm_pulse_upstream_db_reachable`：上游 PostgreSQL 当前是否可达，`1` 表示可达，`0` 表示降级。

人工检查时可以先从本机访问：

```bash
curl -f http://127.0.0.1:43130/status/api/metrics
```

正常响应应包含 Prometheus 文本格式的 `# HELP`、`# TYPE` 行，以及 `llm_pulse_*` 应用指标。

## Prometheus 抓取示例

如果 Prometheus 与 BFF 在同一台宿主机或可访问内网端口，可以直接抓取本机 BFF：

```yaml
scrape_configs:
  - job_name: llm-pulse
    metrics_path: /status/api/metrics
    scheme: http
    static_configs:
      - targets:
          - 127.0.0.1:43130
        labels:
          service: llm-pulse
```

如果只能通过公开域名访问，也可以抓取反代后的 HTTPS 地址：

```yaml
scrape_configs:
  - job_name: llm-pulse-public
    metrics_path: /status/api/metrics
    scheme: https
    static_configs:
      - targets:
          - ai.exesim.com
        labels:
          service: llm-pulse
```

生产环境优先选择内网或本机抓取，避免把监控依赖绑定到公网 TLS、DNS 或外部链路上。若使用公网抓取，请同时保留 `/status/api/health` 的独立探活，以便区分应用降级和反向代理链路异常。

## 告警规则建议

以下规则仅使用当前实现中真实存在的指标名。阈值应按实际 `PULSE_REFRESH_INTERVAL_MS`、网络条件和告警噪声调整。

### 上游 PostgreSQL 不可达

最近一次 PostgreSQL 查询失败时，`llm_pulse_upstream_db_reachable` 会变为 `0`。该告警用于发现 `DATABASE_URL` 配置错误、数据库网络不可达、认证失败、权限不足或查询超时。

```yaml
groups:
  - name: llm-pulse
    rules:
      - alert: LLMPulseUpstreamDbUnreachable
        expr: llm_pulse_upstream_db_reachable == 0
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: LLM Pulse 上游 PostgreSQL 不可达
          description: 最近一次 LLM Pulse PostgreSQL 查询失败。请检查 /status/api/health 中的 upstreamDb、systemd journal、DATABASE_URL、数据库网络和 logs 表权限。
```

### 上游 PostgreSQL 查询错误增加

`llm_pulse_upstream_db_query_errors_total` 是递增 counter。该告警用于捕捉持续查询失败，即使可达性 gauge 因短暂恢复而抖动，也能看到错误增长。

```yaml
groups:
  - name: llm-pulse
    rules:
      - alert: LLMPulseUpstreamDbQueryErrors
        expr: increase(llm_pulse_upstream_db_query_errors_total[5m]) > 0
        for: 1m
        labels:
          severity: warning
        annotations:
          summary: LLM Pulse PostgreSQL 查询错误增加
          description: 最近 5 分钟内 upstream-db 查询错误数增加。请检查 PostgreSQL 连接参数、权限、查询超时和 BFF 日志。
```

### 上游 PostgreSQL 查询变慢

`llm_pulse_upstream_db_query_duration_seconds` 是直方图。该告警用于发现数据库响应变慢或 `logs` 表查询压力升高。

```yaml
groups:
  - name: llm-pulse
    rules:
      - alert: LLMPulseUpstreamDbQuerySlow
        expr: histogram_quantile(0.95, rate(llm_pulse_upstream_db_query_duration_seconds_bucket[5m])) > 2
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: LLM Pulse PostgreSQL 查询变慢
          description: upstream-db 查询 P95 超过 2 秒。请检查 logs 表数据量、索引、数据库负载和 PULSE_QUERY_TIMEOUT_MS。
```

### Metrics 端点不可达

Prometheus 自带的 `up` 指标可用于判断 `/status/api/metrics` 抓取是否成功。该告警不依赖应用自定义指标，适合发现进程退出、端口不可达、Nginx 反代失败或 metrics 端点返回非 2xx。

```yaml
groups:
  - name: llm-pulse
    rules:
      - alert: LLMPulseMetricsUnavailable
        expr: up{job="llm-pulse"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: LLM Pulse metrics 端点不可达
          description: Prometheus 无法抓取 /status/api/metrics。请检查 systemctl is-active llm-pulse、本机端口 43130 和 Nginx /status/ 反代配置。
```

如果使用的 `job_name` 不是 `llm-pulse`，请同步调整表达式中的 `job` 标签。

### 查询时间戳长期未更新

`llm_pulse_polling_last_timestamp_seconds` 表示最近一次 PostgreSQL 查询尝试时间。它可以发现进程仍可抓取 metrics，但刷新循环长时间没有推进的情况。

```yaml
groups:
  - name: llm-pulse
    rules:
      - alert: LLMPulseQueryTimestampStale
        expr: time() - llm_pulse_polling_last_timestamp_seconds > 300
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: LLM Pulse 查询时间戳长期未更新
          description: 最近一次 PostgreSQL 查询时间距离当前已超过 5 分钟。请结合 PULSE_REFRESH_INTERVAL_MS 检查服务刷新、数据库连接和应用日志。
```

如果服务刚启动且尚未产生查询状态，该指标可能暂时没有样本。首次接入时可以先观察一段时间，再决定是否为缺失样本单独配置告警。

## Alertmanager 使用建议

Alertmanager 模板应把告警定位信息放在最前面，便于值班人员快速分辨是进程不可达、上游 PostgreSQL 不可达还是查询变慢。建议包含：

- 告警名、严重级别、`job`、`instance` 和 `service` 标签。
- 触发值或表达式含义，例如 `llm_pulse_upstream_db_reachable=0`、查询错误 counter 增长或 metrics `up=0`。
- 入口链接：公开仪表盘 `/status/`、健康检查 `/status/api/health`、metrics `/status/api/metrics`。
- 排障动作：执行 `systemctl is-active llm-pulse`，查看 `journalctl -u llm-pulse -n 200 --no-pager`，再对照 `docs/ops-runbook.md` 的 upstream-db 故障分类处理。

模板方向示例：

```tmpl
{{ define "llm_pulse.default.message" -}}
告警：{{ .CommonLabels.alertname }}
级别：{{ .CommonLabels.severity }}
实例：{{ .CommonLabels.instance }}
说明：{{ range .Alerts }}{{ .Annotations.description }}{{ end }}
排障：先检查 /status/api/health 的 upstreamDb，再查看 systemd 状态和 journalctl -u llm-pulse -n 200 --no-pager。
{{- end }}
```

实际生产模板可以按团队通知渠道拆分为简短标题和详细正文，但不要在通知里包含 `DATABASE_URL`、数据库密码、内部主机名、原始用户日志或请求正文。

## 与 Health 探活的关系

`/status/api/health` 和 `/status/api/metrics` 解决的问题不同，建议同时保留：

- `/status/api/health` 返回 JSON，适合 systemd/Nginx/人工排障做快速探活；其中 `status=degraded` 和 `upstreamDb.reachable=false` 表示 BFF 可访问，但上游 PostgreSQL 当前不可达或最近查询失败。
- `/status/api/metrics` 返回 Prometheus 文本格式，适合持续抓取、时间序列留存、趋势观察和 Alertmanager 告警。

排障时优先用 `health` 判断当前状态，再用 metrics 和 Prometheus 历史数据判断问题持续时间、是否频繁抖动，以及是否与进程重启或数据库异常同时发生。
