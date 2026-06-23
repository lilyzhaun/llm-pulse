/*
 * LLM Pulse — 双端预览图生成脚本
 *
 * 用途：启动 vite preview（基于已构建的 dist），用 Playwright 分别截取
 *       桌面端（1440x900）和移动端（375x812）视图，再合成为一张并排图。
 *
 * 运行方式（在仓库根目录）：
 *   npm run build --workspace @llm-pulse/frontend
 *   node scripts/preview/generate-preview.mjs
 *
 * 输出：previews/desktop-mobile-preview.png
 *
 * 原理：不依赖任何外部图像库。先各自截图保存为临时 PNG，然后用一个
 *       临时 HTML 页面把两张图并排嵌入，再用 Playwright 截整页得到合成图。
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import { chromium } from "@playwright/test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const frontendDir = resolve(repoRoot, "apps/frontend");
const previewsDir = resolve(repoRoot, "previews");
const tmpDir = resolve(repoRoot, "scripts/preview/.tmp");

const PREVIEW_PORT = 43150;
const BASE_URL = `http://127.0.0.1:${PREVIEW_PORT}/status/`;

const DESKTOP_VIEWPORT = { width: 1440, height: 900 };
const MOBILE_VIEWPORT = { width: 375, height: 812 };

// —— 富数据快照（用于 mock /status/api/pulse） ——
const pulseSnapshot = {
  generatedAt: "2026-06-23T08:00:00.000Z",
  dataSource: {
    kind: "upstream-postgres",
    lastQueryAt: "2026-06-23T08:00:00.000Z",
    lastQueryDurationMs: 18,
    lastErrorMessage: null,
  },
  window: {
    seconds: 3600,
    from: "2026-06-23T07:00:00.000Z",
    to: "2026-06-23T08:00:00.000Z",
  },
  heartbeat: {
    bucketSeconds: 60,
    bucketCount: 60,
    from: "2026-06-23T07:00:00.000Z",
    to: "2026-06-23T08:00:00.000Z",
  },
  summary: {
    totalModels: 6,
    availableModels: 4,
    degradedModels: 1,
    unavailableModels: 1,
    unknownModels: 0,
  },
  models: [
    buildModel("gpt-4.1", "available", 0.95, 1.2, 1280, 60, [
      ...beatSeq("available", 40, 3, 12, 1.0, 1.5),
      ...beatSeq("degraded", 8, 2, 6, 0.7, 2.1),
      ...beatSeq("available", 12, 3, 10, 0.95, 1.3),
    ]),
    buildModel("claude-3.5-sonnet", "available", 0.98, 0.9, 2400, 60, [
      ...beatSeq("available", 55, 4, 15, 0.98, 0.9),
      ...beatSeq("available", 5, 2, 8, 0.9, 1.1),
    ]),
    buildModel("gemini-1.5-pro", "degraded", 0.72, 2.8, 860, 60, [
      ...beatSeq("available", 20, 3, 10, 0.95, 1.2),
      ...beatSeq("degraded", 15, 2, 6, 0.6, 2.8),
      ...beatSeq("unavailable", 5, 0, 0, 0, null),
      ...beatSeq("available", 20, 3, 9, 0.9, 1.4),
    ]),
    buildModel("deepseek-v3", "available", 0.91, 1.6, 540, 60, [
      ...beatSeq("available", 50, 2, 8, 0.92, 1.6),
      ...beatSeq("degraded", 10, 1, 4, 0.7, 2.2),
    ]),
    buildModel("qwen-max", "unavailable", 0.0, null, 0, 60, [
      ...beatSeq("unavailable", 60, 0, 0, 0, null),
    ]),
    buildModel("llama-3.1-70b", "available", 0.88, 1.1, 420, 60, [
      ...beatSeq("available", 45, 1, 6, 0.88, 1.1),
      ...beatSeq("degraded", 15, 1, 3, 0.6, 1.8),
    ]),
  ],
};

function buildModel(name, status, successRate, latency, total, bucketCount, beats) {
  return {
    modelName: name,
    status,
    successCount: Math.round(total * successRate),
    errorCount: Math.round(total * (1 - successRate)),
    totalCount: total,
    successRate,
    averageLatencySeconds: latency,
    lastSeenAt: "2026-06-23T07:59:00.000Z",
    tokens: {
      input: Math.round(total * 320),
      cacheInput: Math.round(total * 45),
      output: Math.round(total * 180),
      total: Math.round(total * 545),
    },
    cost: { quota: Math.round(total * 0.12 * 100) / 100 },
    rpm: { average: Math.round(total / 60 * 10) / 10, peak: Math.round(total / 60 * 30) / 10 },
    tpm: { average: Math.round(total * 545 / 60), peak: Math.round(total * 545 / 60 * 2.5) },
    heartbeat: {
      healthyBuckets: beats.filter((b) => b.status === "available").length,
      degradedBuckets: beats.filter((b) => b.status === "degraded").length,
      unavailableBuckets: beats.filter((b) => b.status === "unavailable").length,
      unknownBuckets: beats.filter((b) => b.status === "unknown").length,
      observedBuckets: beats.length,
      availabilityRate: beats.length
        ? beats.filter((b) => b.status === "available").length / beats.length
        : null,
      lastStatus: beats[beats.length - 1]?.status ?? "unknown",
      lastBeatAt: "2026-06-23T07:59:00.000Z",
    },
    beats,
    channels: [],
  };
}

function beatSeq(status, count, minReq, maxReq, successRate, latency) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const req = minReq + Math.floor(Math.random() * (maxReq - minReq + 1));
    const sc = Math.round(req * successRate);
    out.push({
      start: `2026-06-23T07:${String(59 - i).padStart(2, "0")}:00.000Z`,
      end: `2026-06-23T08:${String(0).padStart(2, "0")}:00.000Z`,
      status,
      totalCount: req,
      successCount: sc,
      errorCount: req - sc,
      successRate,
      averageLatencySeconds: latency,
    });
  }
  return out;
}

async function startPreviewServer() {
  const proc = spawn(
    "npx",
    ["vite", "preview", "--host", "127.0.0.1", "--port", String(PREVIEW_PORT), "--strictPort"],
    { cwd: frontendDir, stdio: "pipe" },
  );
  // 等待服务器就绪
  await waitForServer(BASE_URL, 15000);
  return proc;
}

function waitForServer(url, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function check() {
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Server not ready at ${url} within ${timeoutMs}ms`));
        return;
      }
      fetch(url)
        .then(() => resolve())
        .catch(() => setTimeout(check, 200));
    }
    check();
  });
}

async function captureScreenshot(browser, viewport, deviceName, outputPath) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    isMobile: deviceName === "mobile",
    hasTouch: deviceName === "mobile",
    userAgent:
      deviceName === "mobile"
        ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
        : undefined,
  });
  const page = await context.newPage();

  // mock API
  await page.route("**/status/api/pulse", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(pulseSnapshot),
    });
  });

  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  // 等待模型卡片渲染完成
  await page.waitForSelector(".model-card", { timeout: 8000 });
  // 展开第一个卡片以展示丰富细节
  const firstCard = await page.$(".model-card__header");
  if (firstCard) {
    await firstCard.click();
    await page.waitForTimeout(400);
  }
  // 截取整页（full page）
  await page.screenshot({ path: outputPath, fullPage: true, type: "png" });
  await context.close();
}

async function composeSideBySide(desktopPngPath, mobilePngPath, outputPath) {
  // 用一个临时 HTML 把两张图并排显示，再用 Playwright 截整页得到合成图
  const desktopB64 = readFileSync(desktopPngPath).toString("base64");
  const mobileB64 = readFileSync(mobilePngPath).toString("base64");

  const html = `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #141413; display: flex; align-items: flex-start; gap: 24px; padding: 32px; font-family: -apple-system, sans-serif; }
  .frame { display: flex; flex-direction: column; gap: 12px; }
  .label { color: #faf9f5; font-size: 18px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; }
  .sub { color: #b0aea5; font-size: 13px; }
  .image-wrap { border-radius: 16px; overflow: hidden; border: 1px solid rgba(176,174,165,0.2); box-shadow: 0 20px 60px rgba(0,0,0,0.5); }
  img { display: block; height: auto; }
  .desktop img { width: 1440px; }
  .mobile img { width: 375px; }
  .mobile .image-wrap { border-radius: 28px; }
</style></head>
<body>
  <div class="frame desktop">
    <div>
      <div class="label">Desktop · 1440 × 900</div>
      <div class="sub">LLM Pulse Dashboard — Light theme</div>
    </div>
    <div class="image-wrap"><img src="data:image/png;base64,${desktopB64}" alt="desktop" /></div>
  </div>
  <div class="frame mobile">
    <div>
      <div class="label">Mobile · 375 × 812</div>
      <div class="sub">iPhone viewport</div>
    </div>
    <div class="image-wrap"><img src="data:image/png;base64,${mobileB64}" alt="mobile" /></div>
  </div>
</body></html>`;

  const composerHtmlPath = resolve(tmpDir, "compose.html");
  writeFileSync(composerHtmlPath, html);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1880, height: 1200 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto(`file://${composerHtmlPath}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await page.screenshot({ path: outputPath, fullPage: true, type: "png" });
  await browser.close();
}

async function main() {
  if (!existsSync(previewsDir)) mkdirSync(previewsDir, { recursive: true });
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

  const distExists = existsSync(resolve(frontendDir, "dist/index.html"));
  if (!distExists) {
    console.error("前端构建产物不存在，请先运行: npm run build --workspace @llm-pulse/frontend");
    process.exit(1);
  }

  console.log("启动 vite preview 服务器...");
  const serverProc = await startPreviewServer();

  let browser;
  try {
    console.log("启动 Chromium...");
    browser = await chromium.launch();

    const desktopPng = resolve(tmpDir, "desktop.png");
    const mobilePng = resolve(tmpDir, "mobile.png");

    console.log("截取桌面端视图 (1440x900)...");
    await captureScreenshot(browser, DESKTOP_VIEWPORT, "desktop", desktopPng);

    console.log("截取移动端视图 (375x812)...");
    await captureScreenshot(browser, MOBILE_VIEWPORT, "mobile", mobilePng);

    const finalPath = resolve(previewsDir, "desktop-mobile-preview.png");
    console.log("合成双端并排预览图...");
    await composeSideBySide(desktopPng, mobilePng, finalPath);

    console.log(`\n预览图已生成: ${finalPath}`);
  } finally {
    if (browser) await browser.close();
    serverProc.kill("SIGTERM");
    // 清理临时文件
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

main().catch((err) => {
  console.error("生成预览图失败:", err);
  process.exit(1);
});