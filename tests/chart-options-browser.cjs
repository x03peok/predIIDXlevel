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
    if (pathname === "/blank") { res.setHeader("Content-Type", "text/html"); res.end("<!doctype html><title>Test</title>"); return; }
    const file = path.resolve(root, "." + decodeURIComponent(pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
    res.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css" })[path.extname(file)] || "application/octet-stream");
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    const base = "http://127.0.0.1:" + server.address().port;
    browser = await chromium.launch({ channel: process.env.TEST_BROWSER || "msedge", headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route("**/*", route => route.request().url().startsWith(base) ? route.continue() : route.abort());
    const errors = [];
    context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
    const page = await context.newPage();
    await page.goto(base + "/blank");
    await page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open("cpi-next-clear-status", 6);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore("chart-statuses", { keyPath: "chartId" }).put({ chartId: "203", status: "clear", updatedAt: "2026-10-01T00:00:00Z" });
        db.createObjectStore("manual-targets", { keyPath: "chartId" });
        db.createObjectStore("daily-targets", { keyPath: "date" });
        const history = db.createObjectStore("status-update-events", { keyPath: "id", autoIncrement: true });
        history.createIndex("changedAt", "changedAt"); history.createIndex("cycleKey", "cycleKey");
      };
      request.onsuccess = () => { request.result.close(); resolve(); }; request.onerror = () => reject(request.error);
    }));
    const chip = (tab, option) => tab.locator('#chartOptionMemos [data-chart-option="' + option + '"]');
    const ready = tab => tab.waitForFunction(() => chartState.optionMemoReady && !chartState.optionMemoBusy);
    await page.goto(base + "/chart-pages/1.html");
    await ready(page);
    assert.deepEqual(await page.locator("#chartOptionMemos button").allTextContents(), ["正規", "鏡", "乱", "R乱", "S乱"]);
    assert.equal(await page.evaluate(() => document.getElementById("chartFeatures").closest(".chart-detail__line").nextElementSibling.classList.contains("chart-detail__option-line")), true);
    const before = await chip(page, "regular").evaluate(element => getComputedStyle(element).backgroundColor);
    await chip(page, "regular").click(); await ready(page);
    assert.equal(await chip(page, "regular").getAttribute("aria-pressed"), "true");
    await page.waitForFunction(color => getComputedStyle(document.querySelector('[data-chart-option="regular"]')).backgroundColor !== color, before);
    assert.notEqual(await chip(page, "regular").evaluate(element => getComputedStyle(element).backgroundColor), before);
    await chip(page, "random").click(); await ready(page);
    await page.reload(); await ready(page);
    assert.equal(await chip(page, "regular").getAttribute("aria-pressed"), "true");
    assert.equal(await chip(page, "random").getAttribute("aria-pressed"), "true");
    const migration = await page.evaluate(async () => {
      const db = await cpiStorage.open();
      const request = db.transaction("chart-statuses").objectStore("chart-statuses").getAll();
      return new Promise(resolve => { request.onsuccess = () => resolve({ version: db.version, records: request.result }); });
    });
    assert.equal(migration.version, 7);
    assert.deepEqual(migration.records, [{ chartId: "203", status: "clear", updatedAt: "2026-10-01T00:00:00Z" }]);
    const other = await context.newPage();
    await other.goto(base + "/chart-pages/1.html"); await ready(other);
    await chip(other, "mirror").click(); await ready(other);
    await page.waitForFunction(() => document.querySelector('[data-chart-option="mirror"]').getAttribute("aria-pressed") === "true");
    await chip(page, "regular").click(); await ready(page);
    await other.waitForFunction(() => document.querySelector('[data-chart-option="regular"]').getAttribute("aria-pressed") === "false");
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.locator("#chartOptionMemos").evaluate(element => element.getBoundingClientRect().right <= innerWidth), true);
    }
    if (process.env.CHART_OPTIONS_SCREENSHOT) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator(".chart-detail__stats").screenshot({ path: process.env.CHART_OPTIONS_SCREENSHOT });
    }
    await other.goto(base + "/chart.html?id=3"); await ready(other);
    assert.equal(await other.locator('#chartOptionMemos [aria-pressed="true"]').count(), 0);
    await chip(other, "s-random").click(); await ready(other);
    console.log("PASS: five toggle chips, independent charts, persistence, cross-tab sync, v6 migration and responsive layout.");

    const settings = await context.newPage();
    settings.on("dialog", dialog => dialog.accept());
    await settings.goto(base + "/settings.html");
    await settings.waitForFunction(() => !!settingsDatabase);
    const [download] = await Promise.all([settings.waitForEvent("download"), settings.locator("#settingsExportButton").click()]);
    const exported = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
    assert.equal(exported.version, 4);
    assert.equal(exported.optionMemos.length, 2);
    assert.deepEqual(exported.optionMemos.find(item => item.chartId === "1").options, ["mirror", "random"]);
    await settings.evaluate(async () => {
      const tx = settingsDatabase.transaction("chart-option-memos", "readwrite"); tx.objectStore("chart-option-memos").clear();
      await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
      window.cpiStatusToast.show = options => { window.optionsUndo = options.onUndo; };
    });
    await settings.locator("#settingsImportInput").setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(exported)) });
    await settings.waitForFunction(() => typeof window.optionsUndo === "function");
    assert.deepEqual(await settings.evaluate(() => cpiBackupData.readSnapshot(settingsDatabase).then(snapshot => snapshot.optionMemos)), exported.optionMemos);
    await settings.evaluate(() => window.optionsUndo());
    assert.equal(await settings.evaluate(() => cpiBackupData.readSnapshot(settingsDatabase).then(snapshot => snapshot.optionMemos.length)), 0);
    await settings.evaluate(async () => {
      await Promise.all([cpiChartOptions.toggle(settingsDatabase, "1", "regular"), cpiChartOptions.toggle(settingsDatabase, "1", "r-random")]);
    });
    assert.deepEqual(await settings.evaluate(() => cpiChartOptions.read(settingsDatabase, "1")), ["regular", "r-random"]);
    const legacy = { ...exported, version: 3 }; delete legacy.optionMemos;
    await settings.locator("#settingsImportInput").setInputFiles({ name: "legacy.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(legacy)) });
    await settings.waitForFunction(() => !settingsBusy && settingsElements.message.textContent === "データをインポートしました。");
    assert.deepEqual(await settings.evaluate(() => cpiChartOptions.read(settingsDatabase, "1")), ["regular", "r-random"]);
    assert(await settings.evaluate(payload => {
      try { settingsValidateBackup({ ...payload, optionMemos: [{ ...payload.optionMemos[0], options: ["invalid"] }] }); return false; }
      catch { return true; }
    }, exported));
    console.log("PASS: v4 backup export/import/Undo, preserved options on v3 import, serialized toggles and invalid-option rejection.");
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
