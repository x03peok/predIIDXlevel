"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const vm = require("node:vm");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");
const bundle = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, "data.js"), "utf8"), bundle);
const headers = bundle.window.__CSV_BUNDLE__.split(/\r?\n/)[0].split(",");
const fixtures = [
  { chart_id: "999991", title: "Missing Pred Fixture", difficulty: "ANOTHER", original_level: "10" },
  { chart_id: "999992", title: "Partial Pred Fixture", difficulty: "HYPER", original_level: "10", easy_pred_skill: "9.2", hard_pred_skill: "10.8", bpm_min: "150", bpm_max: "150" },
];
const csv = bundle.window.__CSV_BUNDLE__.trimEnd() + "\n"
  + fixtures.map(row => headers.map(key => row[key] ?? "").join(",")).join("\n");

(async () => {
  const server = http.createServer((req, res) => {
    const name = new URL(req.url, "http://localhost").pathname;
    if (name === "/data.js") {
      res.setHeader("Content-Type", "text/javascript; charset=utf-8");
      res.end("window.__CSV_BUNDLE__=" + JSON.stringify(csv) + ";");
      return;
    }
    const file = path.resolve(root, "." + decodeURIComponent(name));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404).end(); return;
    }
    res.setHeader("Content-Type", ({ ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript" })[path.extname(file)] || "application/octet-stream");
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
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base + "/pred.html");
    await page.waitForFunction(() => state.rows.length > 0);
    assert.equal(await page.evaluate(() => {
      state.query = "missing pred fixture";
      return getVisibleRows().length;
    }), 1);
    assert.equal(await page.evaluate(() => formatPredValue("")), "\u2014");
    assert.equal(await page.evaluate(() => {
      state.predMinFilter += 0.1;
      return getVisibleRows().length;
    }), 0);

    await page.goto(base + "/record.html");
    await page.waitForFunction(() => recordState.db && recordState.rows.length > 0);
    await page.evaluate(async () => {
      await recordWriteStatus("999991", "easy");
      await recordWriteStatus("999992", "clear");
      const db = recordState.db;
      await new Promise((resolve, reject) => {
        const tx = db.transaction("chart-statuses", "readwrite");
        recordState.rows.filter(row => !row.chartId.startsWith("99999")).forEach((row, index) => {
          tx.objectStore("chart-statuses").put({ chartId: row.chartId, status: index % 2 ? "failed" : "hard", updatedAt: new Date().toISOString(), historyBackfillExcluded: true });
        });
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
      });
    });

    await page.goto(base + "/target.html");
    await page.waitForFunction(() => targetStorageReady && dailyState.ready);
    assert.deepEqual(await page.evaluate(() => {
      const row = targetState.rowsByChartId.get("999991");
      const daily = dailyState.rowsById.get("999991");
      return [row.calibrated_pred_skill, daily.pred,
        targetGetExpectedClearProbability(row, "normal"),
        targetGetAutoCandidateDetails().some(candidate => candidate.row.chart_id === "999991"),
        targetMatchesFilters(row), dailyGetFilteredRows().some(item => item.chartId === "999991")];
    }), [null, null, null, false, true, true]);
    assert.equal(await page.evaluate(() => {
      dailyState.selected.set("999991", "clear");
      dailyRender();
      return dailyRenderAdjustedPredCell(dailyState.rowsById.get("999991"), "normal").includes("(+0.0)");
    }), false);

    await page.goto(base + "/mypage.html");
    await page.waitForFunction(() => mypageState.db && mypageState.records.has("999991"));
    assert.deepEqual(await page.evaluate(() => {
      const row = mypageState.rowsByChartId.get("999991");
      return [mypageGetStatus(row), mypageGetRecommendationProbability(row, "normal"),
        mypageGetHighPredCandidates().some(candidate => candidate.row.chart_id === "999991")];
    }), ["easy", null, false]);

    for (const [id, known] of [["999991", 0], ["999992", 2]]) {
      await page.goto(base + "/chart.html?id=" + id);
      await page.waitForFunction(() => chartState.chartId && chartState.optionMemoReady);
      assert.equal(await page.locator('[data-chart-pred-position-mode]:visible').count(), 3);
      assert.equal(await page.locator('.chart-pred-histogram:visible').count(), known);
      assert(!(await page.locator('.chart-pred-position__mode-value').allTextContents()).includes("0.00"));
      const shareText = await page.locator('#chartShareButton').evaluate(link => new URL(link.href).searchParams.get('text'));
      for (const label of ["イージーPred", "ノマゲPred", "ハードPred"]) assert(shareText.includes(label + ": "));
      assert(!shareText.includes("undefined") && !shareText.includes("NaN"));
      assert(shareText.includes("ノマゲPred: —"));
    }
    assert.deepEqual(errors, []);
    console.log("PASS: missing/partial Pred metadata, filtering, lamp writes, daily manual selection, calculation exclusion and chart placeholders.");
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
