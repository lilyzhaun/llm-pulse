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

const DESKTOP = { width: 2560, height: 1440 };

const pulseSnapshot = {
  generatedAt: "2026-06-23T08:00:00.000Z",
  dataSource: { kind: "upstream-postgres", lastQueryAt: "2026-06-23T08:00:00.000Z", lastQueryDurationMs: 18, lastErrorMessage: null },
  window: { seconds: 3600, from: "2026-06-23T07:00:00.000Z", to: "2026-06-23T08:00:00.000Z" },
  heartbeat: { bucketSeconds: 60, bucketCount: 60, from: "2026-06-23T07:00:00.000Z", to: "2026-06-23T08:00:00.000Z" },
  summary: { totalModels: 6, availableModels: 4, degradedModels: 1, unavailableModels: 1, unknownModels: 0 },
  models: [
    buildModel("gpt-4.1", "available", 0.95, 1.2, 1280, [
      ...beatSeq("available", 40, 3, 12, 1.0, 1.5), ...beatSeq("degraded", 8, 2, 6, 0.7, 2.1), ...beatSeq("available", 12, 3, 10, 0.95, 1.3),
    ]),
    buildModel("claude-3.5-sonnet", "available", 0.98, 0.9, 2400, [
      ...beatSeq("available", 55, 4, 15, 0.98, 0.9), ...beatSeq("available", 5, 2, 8, 0.9, 1.1),
    ]),
    buildModel("gemini-1.5-pro", "degraded", 0.72, 2.8, 860, [
      ...beatSeq("available", 20, 3, 10, 0.95, 1.2), ...beatSeq("degraded", 15, 2, 6, 0.6, 2.8), ...beatSeq("unavailable", 5, 0, 0, 0, null), ...beatSeq("available", 20, 3, 9, 0.9, 1.4),
    ]),
    buildModel("deepseek-v3", "available", 0.91, 1.6, 540, [
      ...beatSeq("available", 50, 2, 8, 0.92, 1.6), ...beatSeq("degraded", 10, 1, 4, 0.7, 2.2),
    ]),
    buildModel("qwen-max", "unavailable", 0.0, null, 0, [
      ...beatSeq("unavailable", 60, 0, 0, 0, null),
    ]),
    buildModel("llama-3.1-70b", "available", 0.88, 1.1, 420, [
      ...beatSeq("available", 45, 1, 6, 0.88, 1.1), ...beatSeq("degraded", 15, 1, 3, 0.6, 1.8),
    ]),
  ],
};

function buildModel(name, status, successRate, latency, total, beats) {
  return {
    modelName: name, status,
    successCount: Math.round(total * successRate), errorCount: Math.round(total * (1 - successRate)),
    totalCount: total, successRate, averageLatencySeconds: latency,
    lastSeenAt: "2026-06-23T07:59:00.000Z",
    tokens: { input: Math.round(total * 320), cacheInput: Math.round(total * 45), output: Math.round(total * 180), total: Math.round(total * 545) },
    cost: { quota: Math.round(total * 0.12 * 100) / 100 },
    rpm: { average: Math.round(total / 60 * 10) / 10, peak: Math.round(total / 60 * 30) / 10 },
    tpm: { average: Math.round(total * 545 / 60), peak: Math.round(total * 545 / 60 * 2.5) },
    heartbeat: {
      healthyBuckets: beats.filter((b) => b.status === "available").length,
      degradedBuckets: beats.filter((b) => b.status === "degraded").length,
      unavailableBuckets: beats.filter((b) => b.status === "unavailable").length,
      unknownBuckets: beats.filter((b) => b.status === "unknown").length,
      observedBuckets: beats.length,
      availabilityRate: beats.length ? beats.filter((b) => b.status === "available").length / beats.length : null,
      lastStatus: beats[beats.length - 1]?.status ?? "unknown",
      lastBeatAt: "2026-06-23T07:59:00.000Z",
    },
    beats, channels: [],
  };
}

function beatSeq(status, count, minReq, maxReq, successRate, latency) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const req = minReq + Math.floor(Math.random() * (maxReq - minReq + 1));
    const sc = Math.round(req * successRate);
    out.push({ start: `2026-06-23T07:${String(59 - i).padStart(2, "0")}:00.000Z`, end: `2026-06-23T08:00:00.000Z`, status, totalCount: req, successCount: sc, errorCount: req - sc, successRate, averageLatencySeconds: latency });
  }
  return out;
}

async function startPreviewServer() {
  const proc = spawn("npx", ["vite", "preview", "--host", "127.0.0.1", "--port", String(PREVIEW_PORT), "--strictPort"], { cwd: frontendDir, stdio: "pipe" });
  await waitForServer(BASE_URL, 15000);
  return proc;
}

function waitForServer(url, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function check() {
      if (Date.now() - start > timeoutMs) { reject(new Error(`Server not ready at ${url} within ${timeoutMs}ms`)); return; }
      fetch(url).then(() => resolve()).catch(() => setTimeout(check, 200));
    }
    check();
  });
}

async function makePage(browser, theme, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.route("**/status/api/pulse", async (r) => { await r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(pulseSnapshot) }); });
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.waitForSelector(".model-card", { timeout: 8000 });
  await page.evaluate((t) => { document.documentElement.setAttribute("data-theme", t); }, theme);
  await page.waitForTimeout(400);
  return { page, context };
}

function b64(path) { return readFileSync(path).toString("base64"); }

async function main() {
  if (!existsSync(previewsDir)) mkdirSync(previewsDir, { recursive: true });
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
  if (!existsSync(resolve(frontendDir, "dist/index.html"))) { console.error("请先构建前端"); process.exit(1); }

  console.log("启动 vite preview...");
  const serverProc = await startPreviewServer();
  let browser;
  try {
    browser = await chromium.launch();
    const tmp = (n) => resolve(tmpDir, n);
    const img = {};

    // Desktop Light — 16:9 clip
    console.log("桌面 Light...");
    const { page: pL, context: cL } = await makePage(browser, "light", { width: DESKTOP.width, height: DESKTOP.height });
    img.dl = tmp("dl.png");
    await pL.screenshot({ path: img.dl, clip: { x: 0, y: 0, width: DESKTOP.width, height: DESKTOP.height }, type: "png" });

    // Detail: expanded card + toolbar (from light page)
    console.log("细节截图...");
    const headers = await pL.$$(".model-card__header");
    if (headers.length > 0) { await headers[0].click(); await pL.waitForTimeout(600); }

    const cardEl = await pL.$(".model-card");
    img.card = tmp("card.png");
    if (cardEl) {
      const b = await cardEl.boundingBox();
      await pL.screenshot({ path: img.card, clip: { x: Math.max(0, b.x - 10), y: Math.max(0, b.y - 10), width: b.width + 20, height: b.height + 20 }, type: "png" });
    }

    const tbEl = await pL.$(".toolbar");
    img.toolbar = tmp("tb.png");
    if (tbEl) {
      const b = await tbEl.boundingBox();
      await pL.screenshot({ path: img.toolbar, clip: { x: Math.max(0, b.x - 10), y: Math.max(0, b.y - 10), width: b.width + 20, height: b.height + 20 }, type: "png" });
    }

    await cL.close();

    // Desktop Dark — 16:9 clip
    console.log("桌面 Dark...");
    const { page: pD, context: cD } = await makePage(browser, "dark", { width: DESKTOP.width, height: DESKTOP.height });
    img.dd = tmp("dd.png");
    await pD.screenshot({ path: img.dd, clip: { x: 0, y: 0, width: DESKTOP.width, height: DESKTOP.height }, type: "png" });

    // Detail: heartbeat bars from dark page
    const dHeaders = await pD.$$(".model-card__header");
    if (dHeaders.length > 0) { await dHeaders[0].click(); await pD.waitForTimeout(600); }
    const beatEl = await pD.$(".heartbeat-board");
    img.beat = tmp("beat.png");
    if (beatEl) {
      const b = await beatEl.boundingBox();
      await pD.screenshot({ path: img.beat, clip: { x: Math.max(0, b.x - 14), y: Math.max(0, b.y - 14), width: b.width + 28, height: b.height + 28 }, type: "png" });
    }

    await cD.close();

    // Mobile — 390px wide, clip to 16:9 (390 × 219 for landscape) or 9:16 (390 × 693 portrait)
    // User says 16:9. Phone screen 16:9 = landscape. But phone is held portrait...
    // User said "横屏或竖屏，屏幕比例也必须是16:9". So we use 16:9 portrait = 9:16 w:h
    // 390 * 16/9 = 693
    const MW = 390, MH = Math.round(390 * 16 / 9); // 693

    console.log("移动 Light...");
    const { page: pML, context: cML } = await makePage(browser, "light", { width: MW, height: MH });
    img.ml = tmp("ml.png");
    await pML.screenshot({ path: img.ml, clip: { x: 0, y: 0, width: MW, height: MH }, type: "png" });
    await cML.close();

    console.log("移动 Dark...");
    const { page: pMD2, context: cMD } = await makePage(browser, "dark", { width: MW, height: MH });
    img.md = tmp("md.png");
    await pMD2.screenshot({ path: img.md, clip: { x: 0, y: 0, width: MW, height: MH }, type: "png" });
    await cMD.close();

    // Compose poster
    console.log("合成海报...");
    const html = posterHtml({
      dl: b64(img.dl), dd: b64(img.dd),
      ml: b64(img.ml), md: b64(img.md),
      card: b64(img.card), toolbar: b64(img.toolbar), beat: b64(img.beat),
    });
    const htmlPath = resolve(tmpDir, "poster.html");
    writeFileSync(htmlPath, html);

    const cc = await browser.newContext({ viewport: { width: 2400, height: 1600 }, deviceScaleFactor: 1 });
    const cp = await cc.newPage();
    await cp.goto(`file://${htmlPath}`, { waitUntil: "networkidle" });
    await cp.waitForTimeout(800);
    const finalPath = resolve(previewsDir, "desktop-mobile-preview.png");
    await cp.screenshot({ path: finalPath, fullPage: true, type: "png" });
    await cc.close();

    console.log(`\n海报已生成: ${finalPath}`);
  } finally {
    if (browser) await browser.close();
    serverProc.kill("SIGTERM");
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

function posterHtml(d) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&family=Lora:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#f5f4ef;font-family:"Poppins",Arial,sans-serif;color:#141413;width:2400px;overflow:hidden}
.poster{position:relative;padding:80px 80px 72px;background:radial-gradient(ellipse 1400px 700px at 80% 0%,rgba(217,119,87,0.04),transparent 55%),radial-gradient(ellipse 1000px 600px at 10% 100%,rgba(106,155,204,0.03),transparent 50%),linear-gradient(180deg,#faf9f5 0%,#f5f4ef 100%)}
.poster::before{content:"";position:absolute;inset:0;background-image:linear-gradient(rgba(176,174,165,0.04) 1px,transparent 1px),linear-gradient(90deg,rgba(176,174,165,0.04) 1px,transparent 1px);background-size:56px 56px;pointer-events:none;mask-image:linear-gradient(180deg,rgba(0,0,0,0.5),transparent 85%)}

.header{position:relative;display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:56px}
.header-left{display:flex;flex-direction:column;gap:10px}
.brand-mark{display:flex;align-items:center;gap:10px}
.brand-dot{width:10px;height:10px;border-radius:50%;background:#d97757;box-shadow:0 0 10px rgba(217,119,87,0.3)}
.brand-name{font-size:14px;font-weight:500;letter-spacing:0.16em;text-transform:uppercase;color:#d97757}
.title{font-size:60px;font-weight:700;line-height:1.05;letter-spacing:-0.02em;color:#141413}
.title .accent{color:#d97757}
.subtitle{font-family:"Lora",Georgia,serif;font-size:18px;color:#6f6962;max-width:500px;margin-top:4px;line-height:1.45}
.header-right{display:flex;flex-direction:column;align-items:flex-end;gap:10px}
.tag-row{display:flex;gap:10px}
.tag{font-size:12px;font-weight:500;letter-spacing:0.1em;text-transform:uppercase;padding:7px 14px;border-radius:999px;color:#4c4944;background:rgba(176,174,165,0.08);border:1px solid rgba(176,174,165,0.15)}
.tag--accent{color:#d97757;background:rgba(217,119,87,0.06);border-color:rgba(217,119,87,0.2)}
.version{font-size:12px;color:#b0aea5;letter-spacing:0.06em}

.slabel{font-size:13px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#b0aea5;margin-bottom:20px;display:flex;align-items:center;gap:12px}
.slabel::after{content:"";flex:1;height:1px;background:rgba(176,174,165,0.15)}

.row{display:flex;gap:48px;margin-bottom:56px;align-items:flex-start}

.monitor{flex-shrink:0;border-radius:16px;background:#e8e6dc;box-shadow:0 0 0 1px rgba(176,174,165,0.2),0 2px 0 0 rgba(176,174,165,0.1),0 30px 70px rgba(20,20,19,0.08),0 12px 30px rgba(20,20,19,0.04);overflow:hidden;position:relative}
.monitor-bar{display:flex;align-items:center;gap:8px;padding:12px 16px;background:#e8e6dc;border-bottom:1px solid rgba(176,174,165,0.15)}
.traffic{display:flex;gap:7px}
.traffic span{width:12px;height:12px;border-radius:50%;display:block}
.traffic span:nth-child(1){background:#d97757;opacity:.7}
.traffic span:nth-child(2){background:#b0aea5;opacity:.4}
.traffic span:nth-child(3){background:#788c5d;opacity:.5}
.murl{flex:1;margin-left:12px;font-size:12px;color:#6f6962;font-family:"Lora",Georgia,serif;background:rgba(176,174,165,0.06);padding:5px 12px;border-radius:6px}
.monitor-content img{display:block;width:1440px;height:auto}

.tbadge{position:absolute;top:10px;right:10px;font-size:10px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;padding:4px 10px;border-radius:999px;z-index:10}
.tbadge-l{background:rgba(250,249,245,0.9);color:#141413;border:1px solid rgba(176,174,165,0.15)}
.tbadge-d{background:rgba(20,20,19,0.85);color:#faf9f5;border:1px solid rgba(250,249,245,0.12)}

.dmeta{margin-top:16px;display:flex;align-items:baseline;gap:10px}
.dmeta .name{font-size:14px;font-weight:600;color:#141413}
.dmeta .spec{font-family:"Lora",Georgia,serif;font-size:12px;color:#b0aea5}

.phone{border-radius:36px;background:#e8e6dc;padding:8px;box-shadow:0 0 0 1px rgba(176,174,165,0.2),0 0 0 4px #faf9f5,0 0 0 5px rgba(176,174,165,0.12),0 30px 60px rgba(20,20,19,0.06);position:relative}
.phone-notch{position:relative;height:18px}
.phone-notch::after{content:"";position:absolute;left:50%;transform:translateX(-50%);top:-6px;width:90px;height:18px;border-radius:0 0 12px 12px;background:#faf9f5}
.phone-screen{border-radius:28px;overflow:hidden;line-height:0;position:relative}
.phone-screen img{display:block;width:390px;height:auto}

.prow{display:flex;gap:32px;align-items:flex-start}

.detail-row{display:flex;gap:32px;margin-bottom:48px}
.dcard{flex:1;border-radius:20px;overflow:hidden;background:#fffdf9;box-shadow:0 0 0 1px rgba(176,174,165,0.12),0 16px 40px rgba(20,20,19,0.05);position:relative}
.dcard img{display:block;width:100%;height:auto}
.dtag{position:absolute;top:14px;left:14px;font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;padding:4px 10px;border-radius:999px;background:rgba(20,20,19,0.7);color:#faf9f5;z-index:5}

.features{display:flex;border-radius:20px;overflow:hidden;border:1px solid rgba(176,174,165,0.1);margin-bottom:36px}
.feature{flex:1;padding:24px 28px;display:flex;flex-direction:column;gap:6px;background:rgba(255,253,249,0.6);border-right:1px solid rgba(176,174,165,0.08)}
.feature:last-child{border-right:0}
.ficon{width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;margin-bottom:4px}
.feature:nth-child(1) .ficon{background:rgba(217,119,87,0.1);color:#d97757}
.feature:nth-child(2) .ficon{background:rgba(120,140,93,0.1);color:#788c5d}
.feature:nth-child(3) .ficon{background:rgba(106,155,204,0.1);color:#6a9bcc}
.feature:nth-child(4) .ficon{background:rgba(176,174,165,0.1);color:#6f6962}
.ftitle{font-size:14px;font-weight:600;color:#141413}
.fdesc{font-family:"Lora",Georgia,serif;font-size:12px;color:#6f6962;line-height:1.4}

.footer{display:flex;justify-content:space-between;align-items:center}
.fleft{display:flex;align-items:center;gap:8px;font-size:12px;color:#b0aea5;letter-spacing:0.06em}
.fleft .brand-dot{width:6px;height:6px}
.fright{font-family:"Lora",Georgia,serif;font-size:12px;color:#b0aea5}
</style></head>
<body>
<div class="poster">
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

  <div class="slabel">Desktop · 2K (2560 × 1440 · 16:9)</div>
  <div class="row">
    <div style="display:flex;flex-direction:column;gap:16px">
      <div class="monitor">
        <span class="tbadge tbadge-l">Light</span>
        <div class="monitor-bar"><div class="traffic"><span></span><span></span><span></span></div><div class="murl">https://ai.exesim.com/status/</div></div>
        <div class="monitor-content"><img src="data:image/png;base64,${d.dl}" alt="Desktop Light" /></div>
      </div>
      <div class="dmeta"><span class="name">Light Theme</span><span class="spec">#faf9f5 · Poppins + Lora · Shadow-border system</span></div>
    </div>
    <div style="display:flex;flex-direction:column;gap:16px">
      <div class="monitor">
        <span class="tbadge tbadge-d">Dark</span>
        <div class="monitor-bar"><div class="traffic"><span></span><span></span><span></span></div><div class="murl">https://ai.exesim.com/status/</div></div>
        <div class="monitor-content"><img src="data:image/png;base64,${d.dd}" alt="Desktop Dark" /></div>
      </div>
      <div class="dmeta"><span class="name">Dark Theme</span><span class="spec">#141413 · Accent #d97757 · Concentric radii</span></div>
    </div>
  </div>

  <div class="slabel">Mobile · 2K (390 × 693 · 9:16 · iPhone)</div>
  <div class="row">
    <div class="prow">
      <div style="display:flex;flex-direction:column;gap:14px">
        <div class="phone">
          <span class="tbadge tbadge-l">Light</span>
          <div class="phone-notch"></div>
          <div class="phone-screen"><img src="data:image/png;base64,${d.ml}" alt="Mobile Light" /></div>
        </div>
        <div class="dmeta"><span class="name">Light Theme</span><span class="spec">375px · Touch · Safe-area</span></div>
      </div>
      <div style="display:flex;flex-direction:column;gap:14px">
        <div class="phone">
          <span class="tbadge tbadge-d">Dark</span>
          <div class="phone-notch"></div>
          <div class="phone-screen"><img src="data:image/png;base64,${d.md}" alt="Mobile Dark" /></div>
        </div>
        <div class="dmeta"><span class="name">Dark Theme</span><span class="spec">375px · Reduced-motion</span></div>
      </div>
    </div>
  </div>

  <div class="slabel">UI Detail · Micro-interactions & Components</div>
  <div class="detail-row">
    <div class="dcard"><span class="dtag">Expanded Card</span><img src="data:image/png;base64,${d.card}" alt="Card detail" /></div>
    <div class="dcard"><span class="dtag">Toolbar</span><img src="data:image/png;base64,${d.toolbar}" alt="Toolbar detail" /></div>
    <div class="dcard"><span class="dtag">Heartbeat</span><img src="data:image/png;base64,${d.beat}" alt="Heartbeat detail" /></div>
  </div>

  <div class="features">
    <div class="feature"><div class="ficon">♥</div><div class="ftitle">Heartbeat Bars</div><div class="fdesc">Per-minute availability timeline with interactive beat inspection.</div></div>
    <div class="feature"><div class="ficon">⚡</div><div class="ftitle">Live Metrics</div><div class="fdesc">Token usage, RPM / TPM, quota, and latency per model in real time.</div></div>
    <div class="feature"><div class="ficon">◈</div><div class="ftitle">Shadow-Depth UI</div><div class="fdesc">Layered box-shadow — concentric radii, no hard borders, tactile press.</div></div>
    <div class="feature"><div class="ficon">☰</div><div class="ftitle">Mobile-First</div><div class="fdesc">375px → 1480px breakpoints with reduced-motion accessibility support.</div></div>
  </div>

  <div class="footer">
    <div class="fleft"><span class="brand-dot"></span><span>LLM PULSE · STATUS DASHBOARD</span></div>
    <div class="fright">ai.exesim.com/status</div>
  </div>
</div>
</body></html>`;
}

main().catch((err) => { console.error("生成海报失败:", err); process.exit(1); });