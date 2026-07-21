import type { HeartbeatBucket, ModelAvailability } from "@llm-pulse/shared";
import {
  type CSSProperties,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  formatLatencyWithLabel,
  formatPercent,
  formatQuota,
  formatRate,
  formatTokens,
} from "../lib/format";
import { useHeartbeatSlotCount } from "../contexts/HeartbeatSlotContext";
import { StatusBadge } from "./StatusBadge";

export interface ModelPulseCardProps {
  model: ModelAvailability;
}

function formatNullablePercent(value: number | null) {
  return value === null ? "暂无" : formatPercent(value);
}

function formatStatusLabel(status: HeartbeatBucket["status"]) {
  const labels: Record<HeartbeatBucket["status"], string> = {
    available: "可用",
    degraded: "降级",
    unavailable: "不可用",
    unknown: "暂无",
  };

  return labels[status];
}

function formatRelativeTimestamp(value: string | null) {
  if (!value) {
    return "暂无 Request";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "暂无 Request";
  }

  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  const timePart = date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });

  if (isToday) {
    return `最近一次 Request : ${timePart}`;
  }

  const datePart = `${date.getMonth() + 1}/${date.getDate()}`;
  return `最近一次 Request : ${datePart} ${timePart}`;
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
  return [
    `${formatBeatTime(beat.start)} · ${formatStatusLabel(beat.status)}`,
    `Requests ${beat.totalCount}`,
    `成功率 ${formatPercent(beat.successRate)}`,
    formatLatencyWithLabel(beat.averageLatencySeconds),
  ].join("\n");
}

function formatBeatSummary(beat: HeartbeatBucket) {
  return {
    time: formatBeatTime(beat.start),
    status: formatStatusLabel(beat.status),
    requests: beat.totalCount,
    successRate: formatPercent(beat.successRate),
    latency: formatLatencyWithLabel(beat.averageLatencySeconds),
  };
}

function ModelPulseCardInner({ model }: ModelPulseCardProps) {
  const heartbeatSlotCount = useHeartbeatSlotCount();
  const latestBeats = model.beats.slice(-heartbeatSlotCount);
  const maxBeatCount = Math.max(
    ...latestBeats.map((beat) => beat.totalCount),
    1,
  );
  const leadingSlotCount = Math.max(heartbeatSlotCount - latestBeats.length, 0);
  const slots: Array<HeartbeatBucket | null> = [
    ...Array.from({ length: leadingSlotCount }, () => null),
    ...latestBeats,
  ];
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedBeatStart, setSelectedBeatStart] = useState<string | null>(
    null,
  );
  const cardRef = useRef<HTMLElement | null>(null);
  const heartbeatBarsRef = useRef<HTMLDivElement | null>(null);
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
      if (!heartbeatBarsRef.current) {
        return;
      }

      if (!heartbeatBarsRef.current.contains(event.target as Node)) {
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
          <p className="model-card__eyebrow">Model Heartbeat</p>
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
          <span>Heartbeat</span>
          <strong>
            {formatNullablePercent(model.heartbeat.availabilityRate)}
          </strong>
        </div>
        <div className="metric-tile">
          <span>Requests</span>
          <strong>{model.totalCount}</strong>
        </div>
      </div>

      <div
        className={`model-card__summary-wrapper${
          isExpanded ? " model-card__summary-wrapper--open" : ""
        }`}
        aria-hidden={!isExpanded}
      >
        <dl
          className="model-card__summary"
          aria-label={`${model.modelName} 用量概览`}
        >
          <div>
            <dt>输入 tokens</dt>
            <dd>{formatTokens(model.tokens?.input ?? 0)}</dd>
          </div>
          <div>
            <dt>缓存输入 tokens</dt>
            <dd>{formatTokens(model.tokens?.cacheInput ?? 0)}</dd>
          </div>
          <div>
            <dt>输出 tokens</dt>
            <dd>{formatTokens(model.tokens?.output ?? 0)}</dd>
          </div>
          <div>
            <dt>Quota</dt>
            <dd>{formatQuota(model.cost?.quota ?? 0)}</dd>
          </div>
          <div>
            <dt>RPM avg / peak</dt>
            <dd>
              {formatRate(model.rpm?.average ?? 0, "RPM")} /{" "}
              {formatRate(model.rpm?.peak ?? 0, "RPM")}
            </dd>
          </div>
          <div>
            <dt>TPM avg / peak</dt>
            <dd>
              {formatRate(model.tpm?.average ?? 0, "TPM")} /{" "}
              {formatRate(model.tpm?.peak ?? 0, "TPM")}
            </dd>
          </div>
        </dl>
      </div>

      <section
        className="heartbeat-board"
        aria-label={`${model.modelName} 最近 Heartbeat`}
        data-beat-count={latestBeats.length}
        data-slot-count={heartbeatSlotCount}
      >
        <div className="heartbeat-board__header">
          <p>近 {heartbeatSlotCount} 分钟</p>
          <p>{formatLatencyWithLabel(model.averageLatencySeconds)}</p>
        </div>

        <div className="heartbeat-board__bars-shell">
          <div
            ref={heartbeatBarsRef}
            className="heartbeat-board__bars"
            style={
              {
                "--beat-count": `${heartbeatSlotCount}`,
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
            <span>Requests {selectedBeatSummary.requests}</span>
            <span>成功率 {selectedBeatSummary.successRate}</span>
            <span>{selectedBeatSummary.latency}</span>
          </div>
        ) : null}
      </section>

      <div
        className={`model-card__summary-wrapper${
          isExpanded ? " model-card__summary-wrapper--open" : ""
        }`}
        aria-hidden={!isExpanded}
      >
        <dl className="model-card__summary">
          <div>
            <dt>可用分钟</dt>
            <dd>{model.heartbeat.healthyBuckets}</dd>
          </div>
          <div>
            <dt>异常分钟</dt>
            <dd>
              {model.heartbeat.degradedBuckets +
                model.heartbeat.unavailableBuckets}
            </dd>
          </div>
        </dl>
      </div>
    </article>
  );
}

export const ModelPulseCard = memo(ModelPulseCardInner);
