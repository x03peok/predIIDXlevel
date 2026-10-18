"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");

(async () => {
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, "." + decodeURIComponent(new URL(req.url, "http://localhost").pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
    res.setHeader("Content-Type", ({ ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" })[path.extname(file)] || "application/octet-stream");
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: process.env.TEST_BROWSER || "msedge", headless: true });
    const context = await browser.newContext();
    const base = "http://127.0.0.1:" + server.address().port;
    await context.route("**/*", route => route.request().url().startsWith(base) ? route.continue() : route.abort());
    const page = await context.newPage();
    await page.goto(base + "/target.html");
    await page.waitForFunction(() => targetStorageReady && dailyState.ready);
    await page.evaluate(async () => {
      const db = await cpiStorage.open();
      await new Promise((resolve, reject) => {
        const tx = db.transaction("chart-statuses", "readwrite");
        targetState.rows.filter((_, index) => index % 3 === 0).forEach((row, index) => {
          const strength = 10.8 + (((index * 37) % 101) / 100 - 0.5) * 2.4;
          let status = "failed";
          for (const [mode, lamp] of [["easy", "easy"], ["normal", "clear"], ["hard", "hard"]]) {
            if (targetGetPredValue(row, mode) < strength) status = lamp;
          }
          tx.objectStore("chart-statuses").put({ chartId: row.chart_id, status, updatedAt: new Date().toISOString(), historyBackfillExcluded: true });
        });
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
      });
      await targetRefreshFromExternalDataChange();
    });
    const snapshot = await page.evaluate(() => targetState.autoRecommendationIds.slice());
    assert(snapshot.length > 0);
    const monitor = () => page.evaluate(() => {
      window.testGenerations = 0;
      const original = targetGenerateAutoRecommendations;
      targetGenerateAutoRecommendations = () => { window.testGenerations++; return original(); };
    });
    await page.reload();
    await page.waitForFunction(() => targetStorageReady);
    assert.deepEqual(await page.evaluate(() => targetState.autoRecommendationIds), snapshot);
    await monitor();
    await page.evaluate(async () => {
      const candidate = targetState.autoRecommendationMetaById.get(targetState.autoRecommendationIds[0]);
      await targetWriteStatus(candidate.row.chart_id, "hard");
      await targetRefreshFromExternalDataChange();
      window.dispatchEvent(new Event("focus"));
      targetRender();
    });
    assert.deepEqual(await page.evaluate(() => targetState.autoRecommendationIds), snapshot);
    assert.equal(await page.evaluate(() => window.testGenerations), 0);
    await page.evaluate(() => { targetOpenRecommendationSettings(); targetSaveRecommendationSettings(); });
    assert.equal(await page.evaluate(() => window.testGenerations), 0, "Unchanged settings do not regenerate");
    await page.evaluate(() => { targetElements.recommendationCount.value = "3"; targetSaveRecommendationSettings(); });
    assert.equal(await page.evaluate(() => window.testGenerations), 1);
    assert.equal(await page.evaluate(() => targetState.autoRecommendationIds.length), 3);
    await page.evaluate(() => { targetCloseRecommendationSettings(); targetElements.autoRegenerate.click(); });
    assert.equal(await page.evaluate(() => window.testGenerations), 2);

    const record = await context.newPage();
    await record.goto(base + "/record.html");
    await record.waitForFunction(() => recordState.db && recordState.rows.length > 0);
    await record.evaluate(async () => {
      const row = recordState.rows[0];
      await recordWriteStatus(row.chartId, "easy");
    });
    await page.evaluate(() => targetRefreshFromExternalDataChange());
    assert.equal(await page.evaluate(() => window.testGenerations), 2, "Manual writes keep selection");
    await record.evaluate(async () => {
      recordState.importText = "invalid csv";
      await recordHandleCsvImport();
    });
    assert.equal(await record.evaluate(() => Boolean(localStorage.getItem(cpiRecommendationCache.key))), true);
    await record.evaluate(() => {
      const row = recordState.rows.find(item => item.title === "ADAMANT" && item.difficulty === "ANOTHER");
      recordState.importText = [
        ["\u30d0\u30fc\u30b8\u30e7\u30f3", "\u30bf\u30a4\u30c8\u30eb", "ANOTHER \u30af\u30ea\u30a2\u30bf\u30a4\u30d7", "ANOTHER \u96e3\u6613\u5ea6"].join(","),
        ["", row.title, "EASY CLEAR", row.level].join(","),
      ].join("\n");
    });
    await record.evaluate(() => recordHandleCsvImport());
    await page.waitForFunction(() => window.testGenerations === 3);
    assert.equal(await page.evaluate(() => targetState.autoRecommendationsInitialized), true);
    console.log("PASS: stable selection across reload, lamp updates and focus; regenerate only on changed settings, button and successful CSV import.");
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
