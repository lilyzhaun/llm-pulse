import type { AvailabilityResponse } from "@llm-pulse/shared";

export interface ToolbarProps {
  snapshot: AvailabilityResponse;
  modelSearchQuery: string;
  onModelSearchQueryChange: (value: string) => void;
  isRefreshing: boolean;
  canRefresh: boolean;
  onRefresh: () => void;
}

function formatHeartbeatWindow(bucketCount: number) {
  return `近 ${bucketCount} 分钟`;
}

function formatGeneratedAt(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "无 Snapshot";
  }

  return `${date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })}`;
}

export function Toolbar({
  snapshot,
  modelSearchQuery,
  onModelSearchQueryChange,
  isRefreshing,
  canRefresh,
  onRefresh,
}: ToolbarProps) {
  const snapshotChipLabel = isRefreshing
    ? "刷新中…"
    : canRefresh
      ? "点击刷新"
      : "稍候再刷新";

  return (
    <section className="toolbar">
      <div>
        <p className="toolbar__eyebrow">Model 状态</p>
        <h1>{snapshot.dashboardTitle ?? "状态监控"}</h1>
        <p className="toolbar__description">
          每模型最近 60 个 1 分钟窗口的可用性。
        </p>
      </div>

      <div className="toolbar__controls">
        <label className="toolbar-search" htmlFor="model-search-input">
          <span className="toolbar-search__label">搜索 Model</span>
          <input
            id="model-search-input"
            className="toolbar-search__input"
            type="search"
            value={modelSearchQuery}
            onChange={(event) => onModelSearchQueryChange(event.target.value)}
            placeholder="输入模型名关键词"
            autoComplete="off"
          />
        </label>

        <div className="toolbar__meta" aria-label="Dashboard 概览">
          <div className="toolbar-chip">
            <span>Models</span>
            <strong>{snapshot.summary.totalModels}</strong>
          </div>
          <div className="toolbar-chip">
            <span>Heartbeat</span>
            <strong>
              {formatHeartbeatWindow(snapshot.heartbeat.bucketCount)}
            </strong>
          </div>
          <button
            type="button"
            className={`toolbar-chip toolbar-chip--button${
              isRefreshing ? " toolbar-chip--refreshing" : ""
            }`}
            onClick={onRefresh}
            disabled={!canRefresh || isRefreshing}
            aria-label={`Snapshot ${formatGeneratedAt(snapshot.generatedAt)} · ${snapshotChipLabel}`}
            title={snapshotChipLabel}
          >
            <span>Snapshot</span>
            <strong>{formatGeneratedAt(snapshot.generatedAt)}</strong>
          </button>
        </div>
      </div>
    </section>
  );
}
