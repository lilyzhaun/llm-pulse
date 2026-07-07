import type { ChannelAvailability } from "@llm-pulse/shared";
import { formatLatency, formatPercent } from "../lib/format";
import { StatusBadge } from "./StatusBadge";

export interface PulseRowProps {
  channel: ChannelAvailability;
}

export function PulseRow({ channel }: PulseRowProps) {
  return (
    <div className="pulse-row">
      <div className="pulse-row__primary">
        <div>
          <p className="pulse-row__eyebrow">Channel</p>
          <h4>{channel.channelName}</h4>
        </div>
        <StatusBadge status={channel.status} />
      </div>

      <dl className="pulse-row__metrics">
        <div>
          <dt>成功率</dt>
          <dd>{formatPercent(channel.successRate)}</dd>
        </div>
        <div>
          <dt>Requests</dt>
          <dd>{channel.totalCount}</dd>
        </div>
        <div>
          <dt>Latency</dt>
          <dd>{formatLatency(channel.averageLatencySeconds)}</dd>
        </div>
      </dl>
    </div>
  );
}
