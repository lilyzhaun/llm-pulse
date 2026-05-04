import { describe, expect, it, vi } from "vitest";
import {
  getHeartbeatBuckets,
  HEARTBEAT_SQL,
  type UpstreamQueryClient,
} from "../../../src/services/upstreamDb/index.js";

describe("getHeartbeatBuckets", () => {
  it("maps minute heartbeat buckets and uses parameterized bounds", async () => {
    const query = vi.fn(async () => ({
      rows: [
        {
          model_name: "gpt-4o-mini",
          bucket_start: "1704067200",
          success_count: "2",
          error_count: "1",
          total_count: "3",
          latency_avg_seconds: "0.75",
        },
      ],
    }));
    const client = { query } as unknown as UpstreamQueryClient;

    await expect(getHeartbeatBuckets(1_704_070_800, client)).resolves.toEqual([
      {
        modelName: "gpt-4o-mini",
        bucketStartMs: 1_704_067_200_000,
        successCount: 2,
        errorCount: 1,
        totalCount: 3,
        latencyAvgSeconds: 0.75,
      },
    ]);

    expect(query).toHaveBeenCalledWith(HEARTBEAT_SQL, [1_704_070_800]);
    expect(HEARTBEAT_SQL).toContain("logs.created_at < $1::bigint");
    expect(HEARTBEAT_SQL).toContain("bucket_rank <= 60");
    expect(HEARTBEAT_SQL).toContain(
      "FLOOR(logs.created_at::numeric / 60) * 60 AS bucket_start",
    );
  });
});
