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

const DESKTOP_W = 2560;
const DESKTOP_H = 1440;
const MOBILE_W = 1170;
const MOBILE_H = 2532;

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
      end: `2026-06-23T08:00:00.000Z`,
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
      fetch(url).then(() => resolve()).catch(() => setTimeout(check, 200));
    }
    check();
  });
}

async function setupPage(context, theme) {
  const page = await context.newPage();
  await page.route("**/status/api/pulse", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(pulseSnapshot),
    });
  });
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.waitForSelector(".model-card", { timeout: 8000 });
  await page.evaluate((t) => {
    document.documentElement.setAttribute("data-theme", t);
  }, theme);
  await page.waitForTimeout(300);
  return page;
}

async function captureDesktop(page, theme, outputPath) {
  await page.setViewportSize({ width: DESKTOP_W, height: DESKTOP_H });
  await page.waitForTimeout(400);
  await page.screenshot({ path: outputPath, fullPage: false, type: "png" });
}

async function captureMobile(page, theme, outputPath) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: outputPath, fullPage: true, type: "png" });
}

async function captureDetail(page, theme, outputPath) {
  await page.setViewportSize({ width: DESKTOP_W, height: DESKTOP_H });
  await page.waitForTimeout(300);

  const cards = await page.$$(".model-card__header");
  if (cards.length > 0) {
    await cards[1].click();
    await page.waitForTimeout(600);
  }

  const card = await page.$(".model-card:nth-child(2)");
  if (card) {
    await card.screenshot({ path: outputPath, type: "png" });
  } else {
    await page.screenshot({ path: outputPath, fullPage: false, type: "png" });
  }
}

async function captureToolbar(page, theme, outputPath) {
  await page.setViewportSize({ width: DESKTOP_W, height: DESKTOP_H });
  const toolbar = await page.$(".toolbar");
  if (toolbar) {
    await toolbar.screenshot({ path: outputPath, type: "png" });
  }
}

function b64(path) {
  return readFileSync(path).toString("base64");
}

function buildPosterHtml(images, outputPath) {
  const dLight = b64(images.desktopLight);
  const dDark = b64(images.desktopDark);
  const mLight = b64(images.mobileLight);
  const mDark = b64(images.mobileDark);
  const detailLight = b64(images.detailLight);
  const toolbarLight = b64(images.toolbarLight);

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&family=Lora:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #0d0c0b;
    font-family: "Poppins", Arial, sans-serif;
    color: #faf9f5;
    width: 2400px;
    overflow: hidden;
  }
  .poster {
    position: relative;
    padding: 72px 72px 64px;
    background:
      radial-gradient(ellipse 1600px 800px at 15% 0%, rgba(217,119,87,0.10), transparent 55%),
      radial-gradient(ellipse 1200px 700px at 85% 100%, rgba(106,155,204,0.06), transparent 50%),
      linear-gradient(180deg, #0d0c0b 0%, #141413 50%, #181714 100%);
  }
  .poster::before {
    content: "";
    position: absolute; inset: 0;
    background-image:
      linear-gradient(rgba(176,174,165,0.02) 1px, transparent 1px),
      linear-gradient(90deg, rgba(176,174,165,0.02) 1px, transparent 1px);
    background-size: 48px 48px;
    pointer-events: none;
    mask-image: linear-gradient(180deg, rgba(0,0,0,0.4), transparent 85%);
  }

  /* —— Header —— */
  .header { position: relative; display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 48px; }
  .header-left { display: flex; flex-direction: column; gap: 10px; }
  .brand-mark { display: flex; align-items: center; gap: 10px; }
  .brand-dot { width: 10px; height: 10px; border-radius: 50%; background: #d97757; box-shadow: 0 0 12px rgba(217,119,87,0.6); }
  .brand-name { font-size: 14px; font-weight: 500; letter-spacing: 0.16em; text-transform: uppercase; color: #d97757; }
  .title { font-size: 56px; font-weight: 700; line-height: 1.05; letter-spacing: -0.02em; }
  .title .accent { color: #d97757; }
  .subtitle { font-family: "Lora", Georgia, serif; font-size: 17px; color: #b0aea5; max-width: 480px; margin-top: 4px; line-height: 1.45; }
  .header-right { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
  .tag-row { display: flex; gap: 10px; }
  .tag { font-size: 11px; font-weight: 500; letter-spacing: 0.1em; text-transform: uppercase; padding: 6px 12px; border-radius: 999px; color: #faf9f5; background: rgba(250,249,245,0.06); border: 1px solid rgba(250,249,245,0.1); }
  .tag--accent { color: #d97757; background: rgba(217,119,87,0.08); border-color: rgba(217,119,87,0.25); }
  .version { font-size: 11px; color: #4c4944; letter-spacing: 0.06em; }

  /* —— Section label —— */
  .section-label { font-size: 12px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: #6f6962; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
  .section-label::after { content: ""; flex: 1; height: 1px; background: rgba(176,174,165,0.1); }

  /* —— Device frames —— */
  .device-row { display: flex; gap: 40px; margin-bottom: 48px; }
  .device-col { display: flex; flex-direction: column; gap: 14px; }
  .device-meta { display: flex; align-items: baseline; gap: 8px; }
  .device-name { font-size: 14px; font-weight: 600; color: #faf9f5; letter-spacing: 0.02em; }
  .device-spec { font-family: "Lora", Georgia, serif; font-size: 12px; color: #4c4944; }

  /* Browser frame */
  .browser {
    border-radius: 12px;
    background: #1c1b19;
    box-shadow: 0 0 0 1px rgba(250,249,245,0.08), 0 30px 80px rgba(0,0,0,0.5);
    overflow: hidden;
  }
  .browser-bar { display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: #1c1b19; border-bottom: 1px solid rgba(250,249,245,0.06); }
  .traffic { display: flex; gap: 6px; }
  .traffic span { width: 11px; height: 11px; border-radius: 50%; display: block; }
  .traffic span:nth-child(1) { background: #d97757; opacity: 0.85; }
  .traffic span:nth-child(2) { background: #b0aea5; opacity: 0.5; }
  .traffic span:nth-child(3) { background: #788c5d; opacity: 0.6; }
  .browser-url { flex: 1; margin-left: 10px; font-size: 11px; color: #4c4944; font-family: "Lora", Georgia, serif; background: rgba(250,249,245,0.04); padding: 4px 10px; border-radius: 5px; border: 1px solid rgba(250,249,245,0.05); }
  .browser-content img { display: block; width: 100%; height: auto; }

  /* Phone frame */
  .phone {
    border-radius: 40px;
    background: #1c1b19;
    padding: 9px;
    box-shadow: 0 0 0 1px rgba(250,249,245,0.1), 0 0 0 5px #141413, 0 0 0 6px rgba(250,249,245,0.06), 0 30px 80px rgba(0,0,0,0.55);
  }
  .phone-notch { position: relative; height: 22px; display: flex; justify-content: center; }
  .phone-notch::after { content: ""; position: absolute; width: 100px; height: 22px; border-radius: 0 0 14px 14px; background: #141413; top: -9px; }
  .phone-screen { border-radius: 32px; overflow: hidden; line-height: 0; }
  .phone-screen img { display: block; width: 100%; height: auto; }

  /* —— Detail cards —— */
  .detail-row { display: flex; gap: 40px; margin-bottom: 48px; }
  .detail-card {
    flex: 1;
    border-radius: 16px;
    overflow: hidden;
    box-shadow: 0 0 0 1px rgba(250,249,245,0.08), 0 20px 60px rgba(0,0,0,0.4);
  }
  .detail-card img { display: block; width: 100%; height: auto; }

  /* —— Features bar —— */
  .features { display: flex; border-radius: 16px; overflow: hidden; border: 1px solid rgba(250,249,245,0.06); margin-bottom: 32px; }
  .feature { flex: 1; padding: 22px 26px; display: flex; flex-direction: column; gap: 5px; background: rgba(250,249,245,0.02); border-right: 1px solid rgba(250,249,245,0.05); }
  .feature:last-child { border-right: 0; }
  .feature-icon { width: 26px; height: 26px; border-radius: 7px; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; margin-bottom: 3px; }
  .feature:nth-child(1) .feature-icon { background: rgba(217,119,87,0.12); color: #d97757; }
  .feature:nth-child(2) .feature-icon { background: rgba(120,140,93,0.12); color: #788c5d; }
  .feature:nth-child(3) .feature-icon { background: rgba(106,155,204,0.12); color: #6a9bcc; }
  .feature:nth-child(4) .feature-icon { background: rgba(176,174,165,0.12); color: #b0aea5; }
  .feature-title { font-size: 13px; font-weight: 600; color: #faf9f5; }
  .feature-desc { font-family: "Lora", Georgia, serif; font-size: 11px; color: #6f6962; line-height: 1.4; }

  /* —— Footer —— */
  .footer { display: flex; justify-content: space-between; align-items: center; }
  .footer-left { display: flex; align-items: center; gap: 8px; font-size: 11px; color: #4c4944; letter-spacing: 0.06em; }
  .footer-left .brand-dot { width: 6px; height: 6px; }
  .footer-right { font-family: "Lora", Georgia, serif; font-size: 11px; color: #4c4944; }

  /* —— Theme label badge on device —— */
  .theme-badge {
    position: absolute;
    top: -8px;
    right: -8px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 4px 10px;
    border-radius: 999px;
    z-index: 10;
  }
  .theme-badge--light { background: rgba(250,249,245,0.9); color: #141413; }
  .theme-badge--dark { background: rgba(20,20,19,0.9); color: #faf9f5; border: 1px solid rgba(250,249,245,0.15); }

  .device-wrap { position: relative; }
</style></head>
<body>
  <div class="poster">
    <!-- Header -->
    <header class="header">
      <div class="header-left">
        <div class="brand-mark"><span class="brand-dot"></span><span class="brand-name">LLM Pulse</span></div>
        <h1 class="title">Model Availability<br><span class="accent">Snapshot Dashboard</span></h1>
        <p class="subtitle">Real-time heartbeat monitoring for every LLM endpoint — availability, latency, and token economics at a glance.</p>
      </div>
      <div class="header-right">
        <div class="tag-row">
          <span class="tag tag--accent">Responsive</span>
          <span class="tag">Mobile-First</span>
          <span class="tag">Dark / Light</span>
          <span class="tag">Shadow-Depth UI</span>
        </div>
        <span class="version">v1.0 · 2026.06</span>
      </div>
    </header>

    <!-- Desktop: Light + Dark side by side -->
    <div class="section-label">Desktop · 2K (2560 × 1440)</div>
    <div class="device-row">
      <div class="device-col">
        <div class="device-wrap">
          <div class="theme-badge theme-badge--light">Light</div>
          <div class="browser">
            <div class="browser-bar">
              <div class="traffic"><span></span><span></span><span></span></div>
              <div class="browser-url">https://ai.exesim.com/status/</div>
            </div>
            <div class="browser-content"><img src="data:image/png;base64,${dLight}" alt="Desktop Light" /></div>
          </div>
        </div>
        <div class="device-meta"><span class="device-name">Light Theme</span><span class="device-spec">#faf9f5 background · Poppins + Lora</span></div>
      </div>
      <div class="device-col">
        <div class="device-wrap">
          <div class="theme-badge theme-badge--dark">Dark</div>
          <div class="browser">
            <div class="browser-bar">
              <div class="traffic"><span></span><span></span><span></span></div>
              <div class="browser-url">https://ai.exesim.com/status/</div>
            </div>
            <div class="browser-content"><img src="data:image/png;base64,${dDark}" alt="Desktop Dark" /></div>
          </div>
        </div>
        <div class="device-meta"><span class="device-name">Dark Theme</span><span class="device-spec">#141413 background · Accent #d97757</span></div>
      </div>
    </div>

    <!-- Mobile: Light + Dark side by side -->
    <div class="section-label">Mobile · 2K (1170 × 2532 · iPhone 15 Pro)</div>
    <div class="device-row" style="align-items: flex-start;">
      <div class="device-col" style="width: 520px;">
        <div class="device-wrap">
          <div class="theme-badge theme-badge--light">Light</div>
          <div class="phone">
            <div class="phone-notch"></div>
            <div class="phone-screen"><img src="data:image/png;base64,${mLight}" alt="Mobile Light" /></div>
          </div>
        </div>
        <div class="device-meta"><span class="device-name">Light Theme</span><span class="device-spec">375px viewport · Touch optimized</span></div>
      </div>
      <div class="device-col" style="width: 520px;">
        <div class="device-wrap">
          <div class="theme-badge theme-badge--dark">Dark</div>
          <div class="phone">
            <div class="phone-notch"></div>
            <div class="phone-screen"><img src="data:image/png;base64,${mDark}" alt="Mobile Dark" /></div>
          </div>
        </div>
        <div class="device-meta"><span class="device-name">Dark Theme</span><span class="device-spec">375px viewport · Safe-area aware</span></div>
      </div>
    </div>

    <!-- Detail close-ups -->
    <div class="section-label">Detail · Expanded Card & Toolbar</div>
    <div class="detail-row">
      <div class="detail-card"><img src="data:image/png;base64,${detailLight}" alt="Card detail" /></div>
      <div class="detail-card"><img src="data:image/png;base64,${toolbarLight}" alt="Toolbar detail" /></div>
    </div>

    <!-- Features -->
    <div class="features">
      <div class="feature"><div class="feature-icon">♥</div><div class="feature-title">Heartbeat Bars</div><div class="feature-desc">Per-minute availability timeline with interactive beat inspection.</div></div>
      <div class="feature"><div class="feature-icon">⚡</div><div class="feature-title">Live Metrics</div><div class="feature-desc">Token usage, RPM / TPM, quota, and latency per model in real time.</div></div>
      <div class="feature"><div class="feature-icon">◈</div><div class="feature-title">Shadow-Depth UI</div><div class="feature-desc">Layered box-shadow system — concentric radii, no hard borders, tactile press.</div></div>
      <div class="feature"><div class="feature-icon">☰</div><div class="feature-title">Mobile-First</div><div class="feature-desc">Breakpoints from 375px to 1480px with reduced-motion accessibility support.</div></div>
    </div>

    <!-- Footer -->
    <div class="footer">
      <div class="footer-left"><span class="brand-dot"></span><span>LLM PULSE · STATUS DASHBOARD</span></div>
      <div class="footer-right">ai.exesim.com/status</div>
    </div>
  </div>
</body></html>`;
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

    const images = {};

    // Light theme captures — independent context
    console.log("截取桌面端 Light...");
    const ctxLight = await browser.newContext({
      viewport: { width: DESKTOP_W, height: DESKTOP_H },
      deviceScaleFactor: 1,
    });
    const pageLight = await setupPage(ctxLight, "light");
    images.desktopLight = resolve(tmpDir, "desktop-light.png");
    await captureDesktop(pageLight, "light", images.desktopLight);

    images.toolbarLight = resolve(tmpDir, "toolbar-light.png");
    await captureToolbar(pageLight, "light", images.toolbarLight);

    images.detailLight = resolve(tmpDir, "detail-light.png");
    await captureDetail(pageLight, "light", images.detailLight);

    images.mobileLight = resolve(tmpDir, "mobile-light.png");
    await captureMobile(pageLight, "light", images.mobileLight);
    await ctxLight.close();

    // Dark theme captures — independent context
    console.log("截取桌面端 Dark...");
    const ctxDark = await browser.newContext({
      viewport: { width: DESKTOP_W, height: DESKTOP_H },
      deviceScaleFactor: 1,
    });
    const pageDark = await setupPage(ctxDark, "dark");
    images.desktopDark = resolve(tmpDir, "desktop-dark.png");
    await captureDesktop(pageDark, "dark", images.desktopDark);

    images.mobileDark = resolve(tmpDir, "mobile-dark.png");
    await captureMobile(pageDark, "dark", images.mobileDark);
    await ctxDark.close();

    // Compose poster
    console.log("合成海报...");
    const html = buildPosterHtml(images);
    const htmlPath = resolve(tmpDir, "poster.html");
    writeFileSync(htmlPath, html);

    const composeCtx = await browser.newContext({
      viewport: { width: 2400, height: 2000 },
      deviceScaleFactor: 1,
    });
    const composePage = await composeCtx.newPage();
    await composePage.goto(`file://${htmlPath}`, { waitUntil: "networkidle" });
    await composePage.waitForTimeout(800);
    const finalPath = resolve(previewsDir, "desktop-mobile-preview.png");
    await composePage.screenshot({ path: finalPath, fullPage: true, type: "png" });
    await composeCtx.close();

    console.log(`\n海报已生成: ${finalPath}`);
  } finally {
    if (browser) await browser.close();
    serverProc.kill("SIGTERM");
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

main().catch((err) => {
  console.error("生成海报失败:", err);
  process.exit(1);
});