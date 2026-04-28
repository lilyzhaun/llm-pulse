import type { HeartbeatBucket, ModelAvailability } from "@llm-pulse/shared";
import {
  type CSSProperties,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { formatPercent } from "../lib/format";
import { StatusBadge } from "./StatusBadge";

export interface ModelPulseCardProps {
  model: ModelAvailability;
}

const DESKTOP_HEARTBEAT_SLOT_COUNT = 60;
const MOBILE_HEARTBEAT_SLOT_COUNT = 30;
const MOBILE_HEARTBEAT_QUERY = "(max-width: 720px)";

function getHeartbeatSlotCount() {
  if (typeof window === "undefined") {
    return DESKTOP_HEARTBEAT_SLOT_COUNT;
  }

  return window.matchMedia(MOBILE_HEARTBEAT_QUERY).matches
    ? MOBILE_HEARTBEAT_SLOT_COUNT
    : DESKTOP_HEARTBEAT_SLOT_COUNT;
}

function formatNullablePercent(value: number | null) {
  return value === null ? "暂无" : formatPercent(value);
}

function formatLatencyLabel(value: number | null) {
  return value === null ? "Latency 暂无" : `Latency ${value.toFixed(1)}s`;
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

  return Number.isNaN(date.getTime())
    ? "暂无 Request"
    : `最近一次 Request : ${date.toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
      })}`;
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
      ? "Latency 暂无"
      : `Latency ${beat.averageLatencySeconds.toFixed(1)}s`;

  return [
    `${formatBeatTime(beat.start)} · ${formatStatusLabel(beat.status)}`,
    `Requests ${beat.totalCount}`,
    `成功率 ${formatPercent(beat.successRate)}`,
    latency,
  ].join("\n");
}

function formatBeatSummary(beat: HeartbeatBucket) {
  return {
    time: formatBeatTime(beat.start),
    status: formatStatusLabel(beat.status),
    requests: beat.totalCount,
    successRate: formatPercent(beat.successRate),
    latency:
      beat.averageLatencySeconds === null
        ? "Latency 暂无"
        : `Latency ${beat.averageLatencySeconds.toFixed(1)}s`,
  };
}

function useHeartbeatSlotCount() {
  const [slotCount, setSlotCount] = useState(getHeartbeatSlotCount);

  useEffect(() => {
    const mediaQuery = window.matchMedia(MOBILE_HEARTBEAT_QUERY);
    const updateSlotCount = () => {
      setSlotCount(
        mediaQuery.matches
          ? MOBILE_HEARTBEAT_SLOT_COUNT
          : DESKTOP_HEARTBEAT_SLOT_COUNT,
      );
    };

    updateSlotCount();
    mediaQuery.addEventListener("change", updateSlotCount);

    return () => {
      mediaQuery.removeEventListener("change", updateSlotCount);
    };
  }, []);

  return slotCount;
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

      <section
        className="heartbeat-board"
        aria-label={`${model.modelName} 最近 Heartbeat`}
        data-beat-count={latestBeats.length}
        data-slot-count={heartbeatSlotCount}
      >
        <div className="heartbeat-board__header">
          <p>近 {heartbeatSlotCount} 分钟</p>
          <p>{formatLatencyLabel(model.averageLatencySeconds)}</p>
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
