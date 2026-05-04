import { describe, expect, it, vi } from "vitest";
import {
  getModelAggregates,
  mapModelAggregateRow,
  MODEL_AGGREGATES_SQL,
  type ModelAggregateRow,
  type UpstreamQueryClient,
} from "../../../src/services/upstreamDb/index.js";

const mockClient = (rows: ModelAggregateRow[]) => {
  const query = vi.fn(async () => ({ rows }));
  const client = { query } as unknown as UpstreamQueryClient;
  return { client, query };
};

describe("getModelAggregates", () => {
  it("maps a normal upstream aggregate response", async () => {
    const { client, query } = mockClient([
      {
        model_name: "gpt-4o-mini",
        total_count: "3",
        success_count: "2",
        error_count: "1",
        latency_avg_seconds: "1.25",
        last_seen_at: "1704067260",
        input_tokens: "100",
        cache_input_tokens: "40",
        output_tokens: "25",
        quota_sum: "123.45",
        rpm_avg: "0.05",
        rpm_peak: "2",
        tpm_avg: "2.75",
        tpm_peak: "155",
      },
    ]);

    await expect(getModelAggregates(1_704_070_800, client)).resolves.toEqual([
      {
        modelName: "gpt-4o-mini",
        totalCount: 3,
        successCount: 2,
        errorCount: 1,
        latencyAvgSeconds: 1.25,
        lastSeenAtMs: 1_704_067_260_000,
        inputTokens: 100,
        cacheInputTokens: 40,
        outputTokens: 25,
        totalTokens: 165,
        quotaSum: 123.45,
        rpmAvg: 0.05,
        rpmPeak: 2,
        tpmAvg: 2.75,
        tpmPeak: 155,
      },
    ]);

    expect(query).toHaveBeenCalledWith(MODEL_AGGREGATES_SQL, [1_704_070_800]);
  });

  it("returns an empty list for an empty window", async () => {
    const { client } = mockClient([]);

    await expect(getModelAggregates(2, client)).resolves.toEqual([]);
  });

  it("keeps null and negative quota semantics from SQL rows", () => {
    expect(
      mapModelAggregateRow({
        model_name: "negative-cost",
        total_count: "2",
        success_count: "1",
        error_count: "1",
        latency_avg_seconds: null,
        last_seen_at: null,
        input_tokens: null,
        cache_input_tokens: null,
        output_tokens: null,
        quota_sum: "-42",
        rpm_avg: "2",
        rpm_peak: "2",
        tpm_avg: null,
        tpm_peak: null,
      }),
    ).toMatchObject({
      modelName: "negative-cost",
      latencyAvgSeconds: null,
      lastSeenAtMs: null,
      inputTokens: 0,
      cacheInputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      quotaSum: -42,
      tpmAvg: 0,
      tpmPeak: 0,
    });
  });

  it("uses safe cache_tokens extraction without casting dirty other text to jsonb", () => {
    expect(MODEL_AGGREGATES_SQL).toContain("logs.other IS NULL");
    expect(MODEL_AGGREGATES_SQL).toContain("btrim(logs.other) = ''");
    expect(MODEL_AGGREGATES_SQL).toContain("substring(");
    expect(MODEL_AGGREGATES_SQL).toContain('"cache_tokens"');
    expect(MODEL_AGGREGATES_SQL).not.toContain("other::json");
    expect(MODEL_AGGREGATES_SQL).not.toContain("other ::json");
  });

  it("preserves bigint boundary values through numeric row parsing", () => {
    const nearSafeInteger = "9007199254740991";
    const mapped = mapModelAggregateRow({
      model_name: "big-model",
      total_count: nearSafeInteger,
      success_count: nearSafeInteger,
      error_count: "0",
      latency_avg_seconds: "0.5",
      last_seen_at: "9007199254",
      input_tokens: nearSafeInteger,
      cache_input_tokens: "1",
      output_tokens: "2",
      quota_sum: "-9007199254740991",
      rpm_avg: "150119987579016.52",
      rpm_peak: nearSafeInteger,
      tpm_avg: "150119987579016.56",
      tpm_peak: nearSafeInteger,
    });

    expect(mapped.totalCount).toBe(Number.MAX_SAFE_INTEGER);
    expect(mapped.successCount).toBe(Number.MAX_SAFE_INTEGER);
    expect(mapped.inputTokens).toBe(Number.MAX_SAFE_INTEGER);
    expect(mapped.totalTokens).toBe(Number.MAX_SAFE_INTEGER + 3);
    expect(mapped.quotaSum).toBe(-Number.MAX_SAFE_INTEGER);
    expect(mapped.lastSeenAtMs).toBe(9_007_199_254_000);
  });

  it("keeps time filtering parameterized and rate definitions explicit", () => {
    expect(MODEL_AGGREGATES_SQL).toContain("logs.created_at < $1::bigint");
    expect(MODEL_AGGREGATES_SQL).toContain("bucket_rank <= 60");
    expect(MODEL_AGGREGATES_SQL).toContain("COUNT(*) AS rpm");
    expect(MODEL_AGGREGATES_SQL).toContain(
      "SUM(prompt_tokens + completion_tokens + cache_tokens) FILTER (WHERE type = 2) AS tpm",
    );
    expect(MODEL_AGGREGATES_SQL).toContain(
      "GREATEST(bucket_counts.bucket_count::numeric, 1)",
    );
  });
});
