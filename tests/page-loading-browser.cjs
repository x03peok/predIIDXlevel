"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");
const charts = JSON.parse(fs.readFileSync(path.join(root, "data/v1/latest.json"), "utf8")).charts;

(async () => {
  const server = http.createServer((req, res) => {
    const name = new URL(req.url, "http://localhost").pathname;
    if (name === "/blank") { res.setHeader("Content-Type", "text/html"); res.end("<!doctype html><title>Test</title>"); return; }
    const file = path.resolve(root, "." + decodeURIComponent(name));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404).end(); return;
    }
    res.setHeader("Content-Type", ({ ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript" })[path.extname(file)] || "application/octet-stream");
    let content = fs.readFileSync(file);
    if (name === "/storage.js") {
      content = content.toString() + `
        const realStorage = window.cpiStorage;
        window.cpiStorage = { ...realStorage, open: async (...args) => {
          window.testOpenCalls = (window.testOpenCalls || 0) + 1;
          await window.testLoadingGate;
          if (sessionStorage.getItem('test-storage-fail') === '1') throw new Error('Test storage failure');
          return realStorage.open(...args);
        } };
      `;
    }
    res.end(content);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    const base = "http://127.0.0.1:" + server.address().port;
    browser = await chromium.launch({ channel: process.env.TEST_BROWSER || "msedge", headless: true });
    for (const route of ["mypage.html", "mypage.html?tab=history", "target.html", "target.html#daily"]) {
      for (const scenario of ["empty", "registered", "failure"]) {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
        await context.route("**/*", request => request.request().url().startsWith(base) ? request.continue() : request.abort());
        await context.addInitScript(() => {
          window.testLoadingGate = new Promise(resolve => { window.testReleaseLoading = resolve; });
        });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.goto(base + "/blank");
        if (scenario === "failure") await page.evaluate(() => sessionStorage.setItem("test-storage-fail", "1"));
        if (scenario === "registered") {
          await page.addScriptTag({ url: base + "/storage.js" });
          await page.evaluate(() => window.testReleaseLoading());
          await page.evaluate(async fixtures => {
            const db = await cpiStorage.open();
            await new Promise((resolve, reject) => {
              const tx = db.transaction("chart-statuses", "readwrite");
              fixtures.forEach((chart, index) => tx.objectStore("chart-statuses").put({
                chartId: chart.id, status: index % 2 ? "failed" : "hard",
                updatedAt: new Date().toISOString(), historyBackfillExcluded: true,
              }));
              tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
            });
          }, charts.slice(0, 120));
        }
        await page.goto(base + "/" + route);
        await page.waitForFunction(() => window.testOpenCalls > 0);
        assert.equal(await page.locator("#pageLoading").isVisible(), true, route + ": initial loading");
        assert.equal(await page.locator("#personalPageContent").isVisible(), false, route + ": no empty-state flash");
        assert.equal(await page.locator("#personalPageContent").getAttribute("inert"), "");
        await page.evaluate(() => window.testReleaseLoading());
        if (scenario === "failure") {
          await page.waitForSelector('#pageLoading[data-state="error"]');
          assert.equal(await page.locator("#personalPageContent").isVisible(), false);
          assert.equal(await page.locator("#pageLoadingRetry").isVisible(), true);
          assert.equal(await page.locator("#pageLoadingText").textContent(), "Test storage failure");
          await page.evaluate(() => sessionStorage.removeItem("test-storage-fail"));
          await page.locator("#pageLoadingRetry").click();
          await page.waitForFunction(() => window.testOpenCalls > 0);
          await page.evaluate(() => window.testReleaseLoading());
        }
        await page.waitForSelector("#personalPageContent:visible");
        assert.equal(await page.locator("#pageLoading").isVisible(), false);
        assert.equal(await page.locator("#personalPageContent").getAttribute("aria-busy"), "false");
        if (scenario === "registered") {
          const seedId = charts[0].id;
          assert.equal(await page.evaluate(id => (typeof mypageState !== "undefined" ? mypageState : targetState).records.has(id), seedId), true);
          if (route === "target.html") assert.equal(await page.locator("#targetInsufficientMessage").isVisible(), false);
          await page.evaluate(() => window.dispatchEvent(new Event("focus")));
          assert.equal(await page.locator("#pageLoading").isVisible(), false, "Background refresh keeps content visible");
        }
        assert.deepEqual(errors, []);
        console.log("PASS:", route, scenario);
        await context.close();
      }
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
