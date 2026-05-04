import { describe, expect, it, vi } from "vitest";
import {
  CHANNEL_AGGREGATES_SQL,
  getChannelAggregates,
  type UpstreamQueryClient,
} from "../../../src/services/upstreamDb/index.js";

describe("getChannelAggregates", () => {
  it("maps channel aggregates from logs.channel_id and logs.channel_name", async () => {
    const query = vi.fn(async () => ({
      rows: [
        {
          model_name: "gpt-4o-mini",
          channel_id: "10",
          channel_name: "primary",
          total_count: "4",
          success_count: "3",
          error_count: "1",
          latency_avg_seconds: "2.5",
          last_seen_at: "1704067260",
        },
      ],
    }));
    const client = { query } as unknown as UpstreamQueryClient;

    await expect(getChannelAggregates(1_704_070_800, client)).resolves.toEqual([
      {
        modelName: "gpt-4o-mini",
        channelId: 10,
        channelName: "primary",
        totalCount: 4,
        successCount: 3,
        errorCount: 1,
        latencyAvgSeconds: 2.5,
        lastSeenAtMs: 1_704_067_260_000,
      },
    ]);

    expect(query).toHaveBeenCalledWith(
      CHANNEL_AGGREGATES_SQL,
      [1_704_070_800],
    );
    expect(CHANNEL_AGGREGATES_SQL).toContain(
      "COALESCE(scoped_logs.channel_id, 0) AS channel_id",
    );
    expect(CHANNEL_AGGREGATES_SQL).toContain(
      "COALESCE(NULLIF(scoped_logs.channel_name, ''), 'unknown')",
    );
    expect(CHANNEL_AGGREGATES_SQL).toContain("logs.created_at < $1::bigint");
    expect(CHANNEL_AGGREGATES_SQL).toContain("bucket_rank <= 60");
  });
});
