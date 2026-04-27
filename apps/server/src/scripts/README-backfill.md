# LLM Pulse one-shot backfill

这个脚本只做一次性的历史回补，不影响常驻服务逻辑。

## 作用

- 登录 `new-api`
- 拉取最近 N 小时日志（默认 72 小时）
- 带限速与 429 重试
- 将结果写入 SQLite
- 跑完退出

## 用法

```bash
npm run backfill --workspace @llm-pulse/server -- --hours 72 --page-size 100 --max-pages 300 --delay-ms 800 --retry-limit 6
```

## 参数

- `--hours`：回补最近多少小时，默认 `72`
- `--page-size`：每页拉取数量，默认 `100`
- `--max-pages`：最多拉取多少页，默认 `300`
- `--delay-ms`：每页请求间隔毫秒数，默认 `800`
- `--retry-limit`：遇到 429 的最大重试次数，默认 `6`

## 注意事项

- 这是一次性脚本，不会修改常驻轮询逻辑
- 跑脚本前后都建议检查 `llm-pulse.service`
- 脚本完成后可通过 `/status/api/pulse` 验证模型覆盖是否提升
