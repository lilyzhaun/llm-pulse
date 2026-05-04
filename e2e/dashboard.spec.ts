import { expect, test } from "@playwright/test";

const pulseSnapshot = {
  generatedAt: "2026-04-29T00:00:00.000Z",
  dataSource: {
    kind: "upstream-postgres",
    lastQueryAt: "2026-04-29T00:00:00.000Z",
    lastQueryDurationMs: 12,
    lastErrorMessage: null,
  },
  window: {
    seconds: 3600,
    from: "2026-04-28T23:00:00.000Z",
    to: "2026-04-29T00:00:00.000Z",
  },
  heartbeat: {
    bucketSeconds: 60,
    bucketCount: 60,
    from: "2026-04-28T23:00:00.000Z",
    to: "2026-04-29T00:00:00.000Z",
  },
  summary: {
    totalModels: 1,
    availableModels: 1,
    degradedModels: 0,
    unavailableModels: 0,
    unknownModels: 0,
  },
  models: [
    {
      modelName: "smoke-model",
      status: "available",
      totalCount: 3,
      successCount: 3,
      errorCount: 0,
      successRate: 1,
      averageLatencySeconds: 0.5,
      lastSeenAt: "2026-04-29T00:00:00.000Z",
      tokens: {
        input: 2500,
        cacheInput: 500,
        output: 750,
        total: 3750,
      },
      cost: {
        quota: 45.67,
      },
      rpm: {
        average: 3,
        peak: 7,
      },
      tpm: {
        average: 1250,
        peak: 3750,
      },
      heartbeat: {
        healthyBuckets: 1,
        degradedBuckets: 0,
        unavailableBuckets: 0,
        unknownBuckets: 0,
        observedBuckets: 1,
        availabilityRate: 1,
        lastStatus: "available",
        lastBeatAt: "2026-04-29T00:00:00.000Z",
      },
      beats: [
        {
          start: "2026-04-28T23:59:00.000Z",
          end: "2026-04-29T00:00:00.000Z",
          status: "available",
          totalCount: 3,
          successCount: 3,
          errorCount: 0,
          successRate: 1,
          averageLatencySeconds: 0.5,
        },
      ],
      channels: [
        {
          channelId: 1,
          channelName: "smoke-channel",
          status: "available",
          totalCount: 3,
          successCount: 3,
          errorCount: 0,
          successRate: 1,
          averageLatencySeconds: 0.5,
          lastSeenAt: "2026-04-29T00:00:00.000Z",
          heartbeat: {
            healthyBuckets: 1,
            degradedBuckets: 0,
            unavailableBuckets: 0,
            unknownBuckets: 0,
            observedBuckets: 1,
            availabilityRate: 1,
            lastStatus: "available",
            lastBeatAt: "2026-04-29T00:00:00.000Z",
          },
          beats: [
            {
              start: "2026-04-28T23:59:00.000Z",
              end: "2026-04-29T00:00:00.000Z",
              status: "available",
              totalCount: 3,
              successCount: 3,
              errorCount: 0,
              successRate: 1,
              averageLatencySeconds: 0.5,
            },
          ],
        },
      ],
    },
  ],
};

test("Dashboard smoke 场景可加载并显示标题", async ({ page }) => {
  const fatalConsoleMessages: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      fatalConsoleMessages.push(message.text());
    }
  });

  await page.route("**/status/api/pulse", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(pulseSnapshot),
    });
  });

  await page.goto("./");

  await expect(page).toHaveTitle(/dammapi状态监控/);
  await expect(
    page.getByRole("heading", { name: "dammapi状态监控" }),
  ).toBeVisible();
  await expect(page.getByText("smoke-model")).toBeVisible();
  await page.getByRole("button", { name: /smoke-model/i }).click();
  await expect(page.getByText("输入 tokens", { exact: true })).toBeVisible();
  await expect(page.getByText("2,500 (2.5K)")).toBeVisible();
  await expect(page.getByText("45.67")).toBeVisible();
  await expect(page.getByText("1.3K TPM / 3.8K TPM")).toBeVisible();

  expect(fatalConsoleMessages).toEqual([]);
});
