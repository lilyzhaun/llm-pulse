import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { HeartbeatBucket, ModelAvailability } from "@llm-pulse/shared";
import { StatusBadge } from "./StatusBadge";

export interface ModelPulseCardProps {
  model: ModelAvailability;
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatNullablePercent(value: number | null) {
  return value === null ? "暂无" : formatPercent(value);
}

function formatLatencyLabel(value: number | null) {
  return value === null ? "平均延迟 暂无" : `平均延迟 ${value.toFixed(1)}s`;
}

function formatRelativeTimestamp(value: string | null) {
  if (!value) {
    return "暂无活动";
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? "暂无活动"
    : `${date.toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
      })} 更新`;
}

function formatBeatTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "未知时间";
  }

  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatBeatTooltip(beat: HeartbeatBucket) {
  const latency =
    beat.averageLatencySeconds === null
      ? "暂无延迟"
      : `延迟 ${beat.averageLatencySeconds.toFixed(1)}s`;

  return [
    `${formatBeatTime(beat.start)} · ${beat.status}`,
    `${beat.totalCount} 次请求`,
    `成功率 ${formatPercent(beat.successRate)}`,
    latency,
  ].join("\n");
}

function formatBeatSummary(beat: HeartbeatBucket) {
  return {
    time: formatBeatTime(beat.start),
    status: beat.status,
    requests: beat.totalCount,
    successRate: formatPercent(beat.successRate),
    latency:
      beat.averageLatencySeconds === null
        ? "暂无延迟"
        : `延迟 ${beat.averageLatencySeconds.toFixed(1)}s`,
  };
}

function ModelPulseCardInner({ model }: ModelPulseCardProps) {
  const latestBeats = model.beats.slice(-30);
  const maxBeatCount = Math.max(
    ...latestBeats.map((beat) => beat.totalCount),
    1,
  );
  const leadingSlotCount = Math.max(30 - latestBeats.length, 0);
  const slots: Array<HeartbeatBucket | null> = [
    ...Array.from({ length: leadingSlotCount }, () => null),
    ...latestBeats,
  ];
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedBeatStart, setSelectedBeatStart] = useState<string | null>(
    null,
  );
  const cardRef = useRef<HTMLElement | null>(null);
  const selectedBeat = useMemo(
    () => latestBeats.find((beat) => beat.start === selectedBeatStart) ?? null,
    [latestBeats, selectedBeatStart],
  );
  const selectedBeatSummary = selectedBeat
    ? formatBeatSummary(selectedBeat)
    : null;

  useEffect(() => {
    if (!selectedBeatStart) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!cardRef.current) {
        return;
      }

      if (!cardRef.current.contains(event.target as Node)) {
        setSelectedBeatStart(null);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [selectedBeatStart]);

  return (
    <article
      ref={cardRef}
      className={`model-card${isExpanded ? " model-card--expanded" : ""}`}
    >
      <header
        className="model-card__header"
        onClick={() => setIsExpanded((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setIsExpanded((value) => !value);
          }
        }}
        role="button"
        tabIndex={0}
      >
        <div>
          <p className="model-card__eyebrow">模型心跳</p>
          <h3>{model.modelName}</h3>
          <p className="model-card__subtle">
            {formatRelativeTimestamp(
              model.heartbeat.lastBeatAt ?? model.lastSeenAt,
            )}
          </p>
        </div>
        <StatusBadge status={model.status} />
      </header>

      <div className="model-card__overview">
        <div className="metric-tile">
          <span>健康度</span>
          <strong>
            {formatNullablePercent(model.heartbeat.availabilityRate)}
          </strong>
        </div>
        <div className="metric-tile">
          <span>请求数</span>
          <strong>{model.totalCount}</strong>
        </div>
      </div>

      <section
        className="heartbeat-board"
        aria-label={`${model.modelName} recent heartbeat`}
      >
        <div className="heartbeat-board__header">
          <p>最近活跃分钟</p>
          <p>{formatLatencyLabel(model.averageLatencySeconds)}</p>
        </div>

        <div className="heartbeat-board__bars-shell">
          <div
            className="heartbeat-board__bars"
            style={
              {
                "--beat-count": `30`,
              } as CSSProperties
            }
          >
            {slots.map((beat, index) =>
              beat ? (
                <button
                  type="button"
                  key={beat.start}
                  className={`heartbeat-board__beat heartbeat-board__beat--${beat.status}${selectedBeat?.start === beat.start ? " heartbeat-board__beat--selected" : ""}`}
                  style={
                    {
                      "--beat-intensity": `${beat.totalCount / maxBeatCount}`,
                    } as CSSProperties
                  }
                  aria-label={formatBeatTooltip(beat)}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedBeatStart((current) =>
                      current === beat.start ? null : beat.start,
                    );
                  }}
                />
              ) : (
                <span
                  key={`empty-${index}`}
                  className="heartbeat-board__slot"
                  aria-hidden="true"
                />
              ),
            )}
          </div>
        </div>

        <div className="heartbeat-board__axis" aria-hidden="true">
          <span>较早</span>
          <span>最新</span>
        </div>

        {selectedBeatSummary ? (
          <div
            className="heartbeat-board__detail"
            aria-live="polite"
            onClick={(event) => event.stopPropagation()}
          >
            <strong>{selectedBeatSummary.time}</strong>
            <span>{selectedBeatSummary.status}</span>
            <span>{selectedBeatSummary.requests} 次请求</span>
            <span>成功率 {selectedBeatSummary.successRate}</span>
            <span>{selectedBeatSummary.latency}</span>
          </div>
        ) : null}
      </section>

      {isExpanded ? (
        <dl className="model-card__summary">
          <div>
            <dt>正常分钟</dt>
            <dd>{model.heartbeat.healthyBuckets}</dd>
          </div>
          <div>
            <dt>告警分钟</dt>
            <dd>
              {model.heartbeat.degradedBuckets +
                model.heartbeat.unavailableBuckets}
            </dd>
          </div>
        </dl>
      ) : null}
    </article>
  );
}

export const ModelPulseCard = memo(ModelPulseCardInner);
