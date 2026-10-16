"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");

(async () => {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    const file = path.resolve(root, "." + decodeURIComponent(pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404).end(); return;
    }
    res.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css" })[path.extname(file)] || "application/octet-stream");
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    const base = "http://127.0.0.1:" + server.address().port;
    browser = await chromium.launch({ channel: process.env.TEST_BROWSER || "msedge", headless: true });
    const context = await browser.newContext();
    await context.route("**/*", route => route.request().url().startsWith(base) ? route.continue() : route.abort());
    const errors = [];
    context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
    const page = await context.newPage();
    await page.goto(base + "/target.html");
    await page.waitForFunction(() => targetStorageReady && dailyState.ready);
    await page.evaluate(async () => {
      const records = targetState.rows.filter((_, index) => index % 3 === 0).map((row, index) => {
        const strength = 10.8 + (((index * 37) % 101) / 100 - 0.5) * 2.4;
        let status = "failed";
        for (const [mode, lamp] of [["easy", "easy"], ["normal", "clear"], ["hard", "hard"]]) {
          if (targetGetPredValue(row, mode) < strength) status = lamp;
        }
        return { chartId: String(row.chart_id), status, updatedAt: new Date().toISOString(), historyBackfillExcluded: true };
      });
      const db = await cpiStorage.open();
      await new Promise((resolve, reject) => {
        const tx = db.transaction("chart-statuses", "readwrite");
        records.forEach(record => tx.objectStore("chart-statuses").put(record));
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
      });
      await targetRefreshFromExternalDataChange();
      await dailyRefreshPersistedState();
    });
    const expected = await page.evaluate(() => {
      const rows = targetState.rows.slice(0, 120);
      return rows.map(row => ({ id: String(row.chart_id), probabilities: Object.fromEntries(["easy", "normal", "hard"].map(mode => [mode, targetGetExpectedClearProbability(row, mode)])) }));
    });
    const mypage = await context.newPage();
    await mypage.goto(base + "/mypage.html");
    await mypage.waitForFunction(() => mypageState.db && mypageGetAnalysis().overallResult.usedLogistic);
    const actual = await mypage.evaluate(ids => ids.map(id => {
      const row = mypageState.rowsByChartId.get(id);
      return { id, probabilities: Object.fromEntries(["easy", "normal", "hard"].map(mode => [mode, mypageGetRecommendationProbability(row, mode)])) };
    }), expected.map(item => item.id));
    for (let index = 0; index < actual.length; index += 1) for (const mode of ["easy", "normal", "hard"]) {
      assert(Math.abs(actual[index].probabilities[mode] - expected[index].probabilities[mode]) < 1e-10, actual[index].id + ":" + mode);
    }
    console.log("PASS: My Page and My Target probabilities match for 120 charts and all three goals.");

    const memoGoal = await page.evaluate(() => {
      const row = dailyState.rows.find(row => dailyGetStatus(row.chartId) === "failed");
      dailyState.manualMemoIds = new Set([row.chartId]);
      dailyState.manualGoalById.set(row.chartId, "hard");
      dailyAutoFillFromManualMemos();
      const goal = dailyState.selected.get(row.chartId);
      dailyState.selected.clear();
      dailyRenderCandidateTable();
      return goal;
    });
    assert.equal(memoGoal, "hard");

    const other = await context.newPage();
    await other.goto(base + "/target.html");
    await other.waitForFunction(() => targetStorageReady && dailyState.ready);
    await other.evaluate(() => {
      targetOpenRecommendationSettings();
      targetRecommendationDraft.targetGoals = ["hard"];
      targetElements.recommendationCount.value = "3";
      targetSaveRecommendationSettings();
    });
    await page.waitForFunction(() => targetState.recommendationSettings.count === 3 && targetState.recommendationSettings.targetGoals.join(",") === "hard");
    await page.evaluate(() => {
      targetOpenRecommendationSettings();
      targetElements.recommendationCount.value = "7";
      targetCommitRecommendationCount();
    });
    await other.evaluate(() => { targetElements.recommendationCount.value = "4"; targetSaveRecommendationSettings(); });
    await page.waitForFunction(() => targetState.recommendationSettings.count === 4);
    assert.equal(await page.evaluate(() => targetRecommendationDraft.count), 7);
    await page.evaluate(() => targetCloseRecommendationSettings());
    const selected = await page.evaluate(() => {
      dailyAutoFillSelection();
      return [...dailyState.selected.values()];
    });
    assert.equal(selected.length, 10);
    assert(selected.every(goal => goal === "hard"));
    console.log("PASS: cross-tab settings update without reload, unsaved drafts are preserved, daily selection uses saved goals.");

    await other.evaluate(() => {
      targetRecommendationDraft.targetGoals = [];
      window.confirm = () => true;
      targetSaveRecommendationSettings();
    });
    await page.waitForFunction(() => targetState.recommendationSettings.targetGoals.length === 0);
    await page.reload();
    await page.waitForFunction(() => targetStorageReady && dailyState.ready);
    assert.equal(await page.evaluate(() => targetState.recommendationSettings.targetGoals.length), 0);
    assert.equal(await page.evaluate(() => dailyGetAutoFillCandidates().length), 0);
    console.log("PASS: explicitly disabled target goals remain disabled after reload.");
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
