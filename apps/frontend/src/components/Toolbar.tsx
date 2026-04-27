import type { AvailabilityResponse } from "@llm-pulse/shared";

export interface ToolbarProps {
  snapshot: AvailabilityResponse;
}

function formatHeartbeatWindow(bucketCount: number) {
  return `最近 ${bucketCount} 个活跃分钟`;
}

function formatGeneratedAt(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "等待快照";
  }

  return `${date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })}`;
}

export function Toolbar({ snapshot }: ToolbarProps) {
  return (
    <section className="toolbar">
      <div>
        <p className="toolbar__eyebrow">模型状态</p>
        <h1>LLM Pulse</h1>
        <p className="toolbar__description">最近一小时活跃模型总览。</p>
      </div>

      <div className="toolbar__meta" aria-label="顶部统计">
        <div className="toolbar-chip">
          <span>模型数</span>
          <strong>{snapshot.summary.totalModels}</strong>
        </div>
        <div className="toolbar-chip">
          <span>心跳窗口</span>
          <strong>
            {formatHeartbeatWindow(snapshot.heartbeat.bucketCount)}
          </strong>
        </div>
        <div className="toolbar-chip">
          <span>快照时间</span>
          <strong>{formatGeneratedAt(snapshot.generatedAt)}</strong>
        </div>
      </div>
    </section>
  );
}
