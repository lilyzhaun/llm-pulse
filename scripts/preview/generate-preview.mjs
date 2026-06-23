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

const PORT = 43151;
const BASE = `http://127.0.0.1:${PORT}/status/`;

// Strict 16:9 dimensions
const DESKTOP = { w: 2560, h: 1440 };       // 16:9 2K
const MOBILE_CSS = { w: 400, h: 780 };       // CSS px → 1200x2340 physical (compact)
const MOBILE_DSF = 3;                         // deviceScaleFactor → 1200×2670 physical px

const snap = {
  generatedAt: "2026-06-23T08:00:00.000Z",
  dataSource: { kind: "upstream-postgres", lastQueryAt: "2026-06-23T08:00:00.000Z", lastQueryDurationMs: 18, lastErrorMessage: null },
  window: { seconds: 3600, from: "2026-06-23T07:00:00.000Z", to: "2026-06-23T08:00:00.000Z" },
  heartbeat: { bucketSeconds: 60, bucketCount: 60, from: "2026-06-23T07:00:00.000Z", to: "2026-06-23T08:00:00.000Z" },
  summary: { totalModels: 6, availableModels: 4, degradedModels: 1, unavailableModels: 1, unknownModels: 0 },
  models: [
    m("gpt-5", "available", 0.99, 0.8, 3200, [
      ...b("available", 52, 5, 18, 1.0, 0.7), ...b("available", 8, 3, 10, 0.95, 0.9),
    ]),
    m("claude-sonnet-4.5", "available", 0.97, 1.1, 1800, [
      ...b("available", 48, 4, 12, 0.98, 1.0), ...b("degraded", 6, 2, 5, 0.7, 1.8), ...b("available", 6, 3, 8, 0.95, 1.1),
    ]),
    m("gemini-2.5-pro", "degraded", 0.82, 2.4, 960, [
      ...b("available", 30, 3, 10, 0.95, 1.2), ...b("degraded", 20, 2, 6, 0.6, 2.8), ...b("available", 10, 3, 7, 0.9, 1.4),
    ]),
    m("deepseek-r2", "available", 0.94, 1.4, 720, [
      ...b("available", 50, 3, 9, 0.93, 1.4), ...b("degraded", 10, 1, 4, 0.7, 2.0),
    ]),
    m("qwen3-max", "unavailable", 0.0, null, 0, [
      ...b("unavailable", 60, 0, 0, 0, 0),
    ]),
    m("llama-4-scout", "available", 0.91, 1.3, 580, [
      ...b("available", 45, 2, 7, 0.91, 1.3), ...b("degraded", 15, 1, 3, 0.6, 1.9),
    ]),
  ],
};

function m(name, status, sr, lat, total, beats) {
  return {
    modelName: name, status,
    successCount: Math.round(total * sr), errorCount: Math.round(total * (1 - sr)),
    totalCount: total, successRate: sr, averageLatencySeconds: lat,
    lastSeenAt: "2026-06-23T07:59:00.000Z",
    tokens: { input: Math.round(total * 350), cacheInput: Math.round(total * 80), output: Math.round(total * 120), total: Math.round(total * 550) },
    cost: { quota: Math.round(total * 0.15 * 100) / 100 },
    rpm: { average: Math.round(total / 60 * 10) / 10, peak: Math.round(total / 60 * 35) / 10 },
    tpm: { average: Math.round(total * 550 / 60), peak: Math.round(total * 550 / 60 * 3) },
    heartbeat: {
      healthyBuckets: beats.filter((x) => x.status === "available").length,
      degradedBuckets: beats.filter((x) => x.status === "degraded").length,
      unavailableBuckets: beats.filter((x) => x.status === "unavailable").length,
      unknownBuckets: 0, observedBuckets: beats.length,
      availabilityRate: beats.filter((x) => x.status === "available").length / beats.length,
      lastStatus: beats[beats.length - 1]?.status ?? "unknown",
      lastBeatAt: "2026-06-23T07:59:00.000Z",
    },
    beats, channels: [],
  };
}

function b(status, count, minR, maxR, sr, lat) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const r = minR + Math.floor(Math.random() * (maxR - minR + 1));
    const sc = Math.round(r * sr);
    out.push({
      start: `2026-06-23T07:${String(59 - i).padStart(2, "0")}:00.000Z`,
      end: `2026-06-23T08:00:00.000Z`,
      status,
      totalCount: r,
      successCount: sc,
      errorCount: r - sc,
      successRate: sr,
      averageLatencySeconds: lat ?? 0,
    });
  }
  return out;
}

async function startServer() {
  const p = spawn("npx", ["vite", "preview", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], { cwd: frontendDir, stdio: "pipe" });
  await wait(BASE, 15000);
  return p;
}

function wait(url, ms) {
  const s = Date.now();
  return new Promise((ok, no) => {
    const c = () => { if (Date.now() - s > ms) { no(new Error("timeout")); return; } fetch(url).then(() => ok()).catch(() => setTimeout(c, 200)); };
    c();
  });
}

async function makePage(browser, theme, vp) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
  const pg = await ctx.newPage();
  await pg.route("**/status/api/pulse", async (r) => {
    await r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(snap) });
  });
  await pg.goto(BASE, { waitUntil: "networkidle" });
  await pg.waitForTimeout(2000);
  await pg.waitForSelector(".model-card", { timeout: 10000 });
  await pg.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
  await pg.waitForTimeout(400);
  return { pg, ctx };
}

function b64(p) { return readFileSync(p).toString("base64"); }

async function main() {
  if (!existsSync(previewsDir)) mkdirSync(previewsDir, { recursive: true });
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
  if (!existsSync(resolve(frontendDir, "dist/index.html"))) { console.error("请先构建前端"); process.exit(1); }

  console.log("启动服务器...");
  const srv = await startServer();
  let browser;
  try {
    browser = await chromium.launch();
    const t = (n) => resolve(tmpDir, n);
    const img = {};

    // Desktop light — 16:9 clip
    console.log("桌面 Light...");
    const { pg: pL, ctx: cL } = await makePage(browser, "light", { width: DESKTOP.w, height: DESKTOP.h });
    img.dl = t("dl.png");
    await pL.screenshot({ path: img.dl, clip: { x: 0, y: 0, width: DESKTOP.w, height: DESKTOP.h }, type: "png" });

    // Detail: expand first card
    const hs = await pL.$$(".model-card__header");
    if (hs.length) { await hs[0].click(); await pL.waitForTimeout(600); }
    const ce = await pL.$(".model-card");
    img.card = t("card.png");
    if (ce) { const b = await ce.boundingBox(); await pL.screenshot({ path: img.card, clip: { x: Math.max(0, b.x - 10), y: Math.max(0, b.y - 10), width: b.width + 20, height: b.height + 20 } }); }

    const te = await pL.$(".toolbar");
    img.tb = t("tb.png");
    if (te) { const b = await te.boundingBox(); await pL.screenshot({ path: img.tb, clip: { x: Math.max(0, b.x - 10), y: Math.max(0, b.y - 10), width: b.width + 20, height: b.height + 20 } }); }

    const be = await pL.$(".heartbeat-board");
    img.beat = t("beat.png");
    if (be) { const b = await be.boundingBox(); await pL.screenshot({ path: img.beat, clip: { x: Math.max(0, b.x - 14), y: Math.max(0, b.y - 14), width: b.width + 28, height: b.height + 28 } }); }

    await cL.close();

    // Desktop dark
    console.log("桌面 Dark...");
    const { pg: pD, ctx: cD } = await makePage(browser, "dark", { width: DESKTOP.w, height: DESKTOP.h });
    img.dd = t("dd.png");
    await pD.screenshot({ path: img.dd, clip: { x: 0, y: 0, width: DESKTOP.w, height: DESKTOP.h }, type: "png" });
    await cD.close();

    // Mobile — CSS viewport 400x890 triggers mobile layout, deviceScaleFactor 3 → 1200x2670 physical px
    console.log("移动 Light...");
    const cML = await browser.newContext({ viewport: { width: MOBILE_CSS.w, height: MOBILE_CSS.h }, deviceScaleFactor: MOBILE_DSF, isMobile: true, hasTouch: true });
    const pML = await cML.newPage();
    await pML.route("**/status/api/pulse", async (r) => { await r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(snap) }); });
    await pML.goto(BASE, { waitUntil: "networkidle" });
    await pML.waitForTimeout(2000);
    await pML.waitForSelector(".model-card", { timeout: 10000 });
    await pML.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
    await pML.waitForTimeout(400);
    img.ml = t("ml.png");
    await pML.screenshot({ path: img.ml, fullPage: false, type: "png" });
    await cML.close();

    console.log("移动 Dark...");
    const cMD = await browser.newContext({ viewport: { width: MOBILE_CSS.w, height: MOBILE_CSS.h }, deviceScaleFactor: MOBILE_DSF, isMobile: true, hasTouch: true });
    const pMD = await cMD.newPage();
    await pMD.route("**/status/api/pulse", async (r) => { await r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(snap) }); });
    await pMD.goto(BASE, { waitUntil: "networkidle" });
    await pMD.waitForTimeout(2000);
    await pMD.waitForSelector(".model-card", { timeout: 10000 });
    await pMD.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await pMD.waitForTimeout(400);
    img.md = t("md.png");
    await pMD.screenshot({ path: img.md, fullPage: false, type: "png" });
    await cMD.close();

    // Compose
    console.log("合成海报...");
    const html = poster({
      dl: b64(img.dl), dd: b64(img.dd),
      ml: b64(img.ml), md: b64(img.md),
      card: b64(img.card), tb: b64(img.tb), beat: b64(img.beat),
    });
    const hp = resolve(tmpDir, "poster.html");
    writeFileSync(hp, html);
    const cc = await browser.newContext({ viewport: { width: 2400, height: 1800 }, deviceScaleFactor: 1 });
    const cp = await cc.newPage();
    await cp.goto(`file://${hp}`, { waitUntil: "networkidle" });
    await cp.waitForTimeout(800);
    const out = resolve(previewsDir, "desktop-mobile-preview.png");
    await cp.screenshot({ path: out, fullPage: true, type: "png" });
    await cc.close();
    console.log(`\n海报: ${out}`);
  } finally {
    if (browser) await browser.close();
    srv.kill("SIGTERM");
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

function poster(d) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&family=Lora:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#f5f4ef;font-family:"Poppins",Arial,sans-serif;color:#141413;width:2400px;overflow:hidden}
.poster{position:relative;padding:72px 80px 56px;background:radial-gradient(ellipse 1600px 800px at 75% 0%,rgba(217,119,87,0.05),transparent 55%),radial-gradient(ellipse 1200px 700px at 15% 100%,rgba(106,155,204,0.035),transparent 50%),linear-gradient(180deg,#faf9f5 0%,#f2f1ec 100%)}
.poster::before{content:"";position:absolute;inset:0;background-image:linear-gradient(rgba(176,174,165,0.035) 1px,transparent 1px),linear-gradient(90deg,rgba(176,174,165,0.035) 1px,transparent 1px);background-size:64px 64px;pointer-events:none;mask-image:linear-gradient(180deg,rgba(0,0,0,0.4),transparent 80%)}

/* Header */
.hdr{position:relative;display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:48px}
.hdr-l{display:flex;flex-direction:column;gap:12px}
.bm{display:flex;align-items:center;gap:10px}
.bd{width:11px;height:11px;border-radius:50%;background:#d97757;box-shadow:0 0 12px rgba(217,119,87,0.35)}
.bn{font-size:15px;font-weight:500;letter-spacing:0.16em;text-transform:uppercase;color:#d97757}
.ttl{font-size:64px;font-weight:700;line-height:1.04;letter-spacing:-0.02em;color:#141413}
.ttl .a{color:#d97757}
.sub{font-family:"Lora",Georgia,serif;font-size:19px;color:#6f6962;max-width:520px;margin-top:6px;line-height:1.45}
.hdr-r{display:flex;flex-direction:column;align-items:flex-end;gap:12px}
.tags{display:flex;gap:10px}
.tg{font-size:12px;font-weight:500;letter-spacing:0.1em;text-transform:uppercase;padding:8px 16px;border-radius:999px;color:#4c4944;background:rgba(176,174,165,0.06);border:1px solid rgba(176,174,165,0.14)}
.tg-a{color:#d97757;background:rgba(217,119,87,0.05);border-color:rgba(217,119,87,0.18)}
.ver{font-size:12px;color:#b0aea5;letter-spacing:0.06em}

/* Section label */
.sl{font-size:13px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#b0aea5;margin-bottom:24px;display:flex;align-items:center;gap:14px}
.sl::after{content:"";flex:1;height:1px;background:rgba(176,174,165,0.12)}

/* Desktop row */
.drow{display:flex;gap:48px;margin-bottom:48px;align-items:flex-start}
.dcol{display:flex;flex-direction:column;gap:20px;flex:1}

.mon{border-radius:16px;background:#e8e6dc;box-shadow:0 0 0 1px rgba(176,174,165,0.18),0 4px 0 0 rgba(176,174,165,0.08),0 32px 80px rgba(20,20,19,0.07),0 12px 32px rgba(20,20,19,0.035);overflow:hidden;position:relative}
.mon-bar{display:flex;align-items:center;gap:8px;padding:14px 18px;background:#e8e6dc;border-bottom:1px solid rgba(176,174,165,0.14)}
.tf{display:flex;gap:7px}
.tf span{width:13px;height:13px;border-radius:50%;display:block}
.tf span:nth-child(1){background:#d97757;opacity:.7}
.tf span:nth-child(2){background:#b0aea5;opacity:.4}
.tf span:nth-child(3){background:#788c5d;opacity:.5}
.murl{flex:1;margin-left:14px;font-size:13px;color:#6f6962;font-family:"Lora",Georgia,serif;background:rgba(176,174,165,0.05);padding:6px 14px;border-radius:6px}
.mon-c img{display:block;width:100%;height:auto}

.tbadge{position:absolute;top:12px;right:14px;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;padding:5px 12px;border-radius:999px;z-index:10}
.tl{background:rgba(250,249,245,0.92);color:#141413;border:1px solid rgba(176,174,165,0.14)}
.td{background:rgba(20,20,19,0.88);color:#faf9f5;border:1px solid rgba(250,249,245,0.1)}

.dmeta{display:flex;align-items:baseline;gap:10px}
.dmeta .nm{font-size:15px;font-weight:600;color:#141413}
.dmeta .sp{font-family:"Lora",Georgia,serif;font-size:13px;color:#b0aea5}

/* Mobile row — 16:9 landscape phones */
.mrow{display:flex;gap:48px;margin-bottom:48px;align-items:flex-start}
.mcol{display:flex;flex-direction:column;gap:20px}

.ph{border-radius:24px;background:#d8d6cc;padding:10px;box-shadow:0 0 0 1px rgba(176,174,165,0.2),0 0 0 5px #faf9f5,0 0 0 6px rgba(176,174,165,0.1),0 32px 64px rgba(20,20,19,0.06);position:relative;overflow:hidden}
.ph-c{border-radius:16px;overflow:hidden;line-height:0;position:relative}
.ph-c img{display:block;width:100%;height:auto}

/* Detail row */
.detrow{display:flex;gap:32px;margin-bottom:48px;align-items:flex-start}
.dcard{border-radius:20px;overflow:hidden;background:#fffdf9;box-shadow:0 0 0 1px rgba(176,174,165,0.1),0 16px 40px rgba(20,20,19,0.04);position:relative;width:auto;max-width:33%}
.dcard img{display:block;width:100%;height:auto}
.dtag{position:absolute;top:14px;left:14px;font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;padding:5px 12px;border-radius:999px;background:rgba(20,20,19,0.75);color:#faf9f5;z-index:5}

/* Features */
.feat{display:flex;border-radius:24px;overflow:hidden;border:1px solid rgba(176,174,165,0.08);margin-bottom:40px;background:rgba(255,253,249,0.4)}
.ft{flex:1;padding:28px 32px;display:flex;flex-direction:column;gap:8px;border-right:1px solid rgba(176,174,165,0.06)}
.ft:last-child{border-right:0}
.fi{width:32px;height:32px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;margin-bottom:6px}
.ft:nth-child(1) .fi{background:rgba(217,119,87,0.08);color:#d97757}
.ft:nth-child(2) .fi{background:rgba(120,140,93,0.08);color:#788c5d}
.ft:nth-child(3) .fi{background:rgba(106,155,204,0.08);color:#6a9bcc}
.ft:nth-child(4) .fi{background:rgba(176,174,165,0.08);color:#6f6962}
.ftt{font-size:15px;font-weight:600;color:#141413}
.fdd{font-family:"Lora",Georgia,serif;font-size:13px;color:#6f6962;line-height:1.45}

/* Footer */
.ftr{display:flex;justify-content:space-between;align-items:center}
.ftrl{display:flex;align-items:center;gap:8px;font-size:13px;color:#b0aea5;letter-spacing:0.06em}
.ftrl .bd{width:7px;height:7px}
.ftrr{font-family:"Lora",Georgia,serif;font-size:13px;color:#b0aea5}
</style></head>
<body>
<div class="poster">

  <!-- Header -->
  <header class="hdr">
    <div class="hdr-l">
      <div class="bm"><span class="bd"></span><span class="bn">LLM Pulse</span></div>
      <h1 class="ttl">Model Availability<br><span class="a">Snapshot Dashboard</span></h1>
      <p class="sub">Real-time heartbeat monitoring for every LLM endpoint — availability, latency, and token economics at a glance.</p>
    </div>
    <div class="hdr-r">
      <div class="tags">
        <span class="tg tg-a">Responsive</span>
        <span class="tg">Mobile-First</span>
        <span class="tg">Dark / Light</span>
        <span class="tg">Shadow-Depth UI</span>
      </div>
      <span class="ver">v1.0 · 2026.06</span>
    </div>
  </header>

  <!-- Desktop -->
  <div class="sl">Desktop · 2K (2560 × 1440 · 16:9)</div>
  <div class="drow">
    <div class="dcol">
      <div class="mon">
        <span class="tbadge tl">Light</span>
        <div class="mon-bar"><div class="tf"><span></span><span></span><span></span></div><div class="murl">https://ai.exesim.com/status/</div></div>
        <div class="mon-c"><img src="data:image/png;base64,${d.dl}" alt="Desktop Light" /></div>
      </div>
      <div class="dmeta"><span class="nm">Light Theme</span><span class="sp">#faf9f5 · Poppins + Lora · Shadow-border system</span></div>
    </div>
    <div class="dcol">
      <div class="mon">
        <span class="tbadge td">Dark</span>
        <div class="mon-bar"><div class="tf"><span></span><span></span><span></span></div><div class="murl">https://ai.exesim.com/status/</div></div>
        <div class="mon-c"><img src="data:image/png;base64,${d.dd}" alt="Desktop Dark" /></div>
      </div>
      <div class="dmeta"><span class="nm">Dark Theme</span><span class="sp">#141413 · Accent #d97757 · Concentric radii</span></div>
    </div>
  </div>

  <!-- Mobile 16:9 landscape -->
  <div class="sl">Mobile · 2K (1200 × 2670 · 6.36" · Portrait)</div>
  <div class="mrow">
    <div class="mcol">
      <div class="ph">
        <span class="tbadge tl">Light</span>
        <div class="ph-c"><img src="data:image/png;base64,${d.ml}" alt="Mobile Light" /></div>
      </div>
      <div class="dmeta"><span class="nm">Light Theme</span><span class="sp">693px · Touch · Safe-area</span></div>
    </div>
    <div class="mcol">
      <div class="ph">
        <span class="tbadge td">Dark</span>
        <div class="ph-c"><img src="data:image/png;base64,${d.md}" alt="Mobile Dark" /></div>
      </div>
      <div class="dmeta"><span class="nm">Dark Theme</span><span class="sp">693px · Reduced-motion</span></div>
    </div>
  </div>

  <!-- Details -->
  <div class="sl">UI Detail · Micro-interactions & Components</div>
  <div class="detrow">
    <div class="dcard"><span class="dtag">Expanded Card</span><img src="data:image/png;base64,${d.card}" alt="Card" /></div>
    <div class="dcard"><span class="dtag">Toolbar</span><img src="data:image/png;base64,${d.tb}" alt="Toolbar" /></div>
    <div class="dcard"><span class="dtag">Heartbeat</span><img src="data:image/png;base64,${d.beat}" alt="Heartbeat" /></div>
  </div>

  <!-- Features -->
  <div class="feat">
    <div class="ft"><div class="fi">♥</div><div class="ftt">Heartbeat Bars</div><div class="fdd">Per-minute availability timeline with interactive beat inspection.</div></div>
    <div class="ft"><div class="fi">⚡</div><div class="ftt">Live Metrics</div><div class="fdd">Token usage, RPM / TPM, quota, and latency per model in real time.</div></div>
    <div class="ft"><div class="fi">◈</div><div class="ftt">Shadow-Depth UI</div><div class="fdd">Layered box-shadow — concentric radii, no hard borders, tactile press.</div></div>
    <div class="ft"><div class="fi">☰</div><div class="ftt">Mobile-First</div><div class="fdd">375px → 1480px breakpoints with reduced-motion accessibility support.</div></div>
  </div>

  <!-- Footer -->
  <div class="ftr">
    <div class="ftrl"><span class="bd"></span><span>LLM PULSE · STATUS DASHBOARD</span></div>
    <div class="ftrr">ai.exesim.com/status</div>
  </div>
</div>
</body></html>`;
}

main().catch((e) => { console.error(e); process.exit(1); });