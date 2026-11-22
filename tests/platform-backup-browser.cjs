"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { loadRows } = require("../generate_chart_pages.js");
const root = path.resolve(__dirname, "..");
const origin = "https://cpi.test";
const date = "2026-10-01T00:00:00.000Z";

(async () => {
  const browser = await chromium.launch({ channel: process.env.TEST_BROWSER || "msedge", headless: true });
  try {
    const context = await browser.newContext();
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      const file = path.resolve(root, "." + url.pathname);
      if (url.origin !== origin || !file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.abort();
      const mime = { ".html": "text/html", ".css": "text/css", ".js": "application/javascript" };
      return route.fulfill({ body: fs.readFileSync(file), contentType: (mime[path.extname(file)] ?? "application/octet-stream") + "; charset=utf-8" });
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("dialog", dialog => dialog.accept());
    const ready = () => page.waitForFunction(() => settingsDatabase && !settingsBusy);
    await page.goto(origin + "/settings.html?platform=ac");
    await ready();
    await page.evaluate(() => localStorage.setItem("cpi-next-platform-migration-v1", "ac"));
    const sharedId = loadRows().find(row => row.platforms.length === 2)?.chart_id;
    assert.ok(sharedId, "fixture must use a shared chart");
    const seed = async (platform, status) => page.evaluate(async ({ platform, status, chartId, updatedAt }) => {
      const db = await cpiStorage.open(platform);
      const tx = db.transaction(["chart-statuses", "manual-targets"], "readwrite");
      tx.objectStore("chart-statuses").put({ chartId, status, updatedAt });
      tx.objectStore("manual-targets").put({ chartId, updatedAt });
      await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    }, { platform, status, chartId: sharedId, updatedAt: date });
    await seed("ac", "easy");
    await seed("inf", "hard");
    const read = (platform, includeOptions = false) => page.evaluate(async ([platform, includeOptions]) =>
      cpiBackupData.readSnapshot(await cpiStorage.open(platform), includeOptions), [platform, includeOptions]);
    const initialInf = await read("inf");
    await page.goto(origin + "/chart-pages/" + sharedId + ".html?platform=ac");
    await page.waitForFunction(() => chartState.statusReady);
    await page.locator("#chartCurrentStatus").selectOption("failed");
    await page.waitForFunction(() => !chartState.statusBusy && chartState.currentStatus === "failed");

    await page.goto(origin + "/settings.html?platform=ac");
    await ready();
    assert.deepEqual(await read("inf"), initialInf);
    assert.equal((await read("ac")).records[0].status, "failed");
    const restore = async (payload, message) => {
      await page.locator("#settingsImportInput").setInputFiles({
        name: "legacy.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(payload)),
      });
      await page.waitForFunction(message => !settingsBusy && document.getElementById("settingsMessage").textContent.includes(message), message);
    };
    for (const version of [1, 2, 3, 4]) {
      const status = version % 2 ? "clear" : "easy";
      const payload = {
        format: "cpi-next-clear-status-backup", version,
        records: [{ chartId: sharedId, status, updatedAt: date }],
        ...(version >= 2 ? { manualMemos: [] } : {}),
        ...(version >= 3 ? { dailyTargets: [], updateHistory: [] } : {}),
        ...(version >= 4 ? { optionMemos: [{ chartId: sharedId, options: ["mirror"], updatedAt: date }] } : {}),
      };
      await restore(payload, "データをインポートしました。");
      const ac = await read("ac", true);
      assert.deepEqual(ac.records, payload.records, "restore v" + version);
      assert.equal(ac.manualMemos.length, version === 1 ? 1 : 0);
      assert.deepEqual(await read("inf"), initialInf, "legacy restore is AC-only");
      if (version === 4) assert.deepEqual(ac.optionMemos, payload.optionMemos);
    }
    await page.goto(origin + "/settings.html?platform=inf");
    await ready();
    await restore({ format: "cpi-next-clear-status-backup", version: 1, records: [] }, "このバックアップはAC版です");
    assert.deepEqual(await read("inf"), initialInf);
    assert.deepEqual(errors, []);
    console.log("PASS: AC chart writes and legacy backup restorations preserve the INFINITAS profile.");
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
