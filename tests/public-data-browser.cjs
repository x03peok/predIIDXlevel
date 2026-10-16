"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");

(async () => {
  const serve = (req, res) => {
    const name = new URL(req.url, "http://localhost").pathname;
    if (name === "/blank") {
      res.setHeader("Content-Type", "text/html");
      res.end("<!doctype html><title>External consumer</title>");
      return;
    }
    const file = path.resolve(root, "." + decodeURIComponent(name));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404).end();
      return;
    }
    res.setHeader("Content-Type", ({ ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json" })[path.extname(file)] || "application/octet-stream");
    if (name.startsWith("/data/")) res.setHeader("Access-Control-Allow-Origin", "*");
    res.end(fs.readFileSync(file));
  };
  const server = http.createServer(serve);
  const consumer = http.createServer(serve);
  const listen = instance => new Promise(resolve => instance.listen(0, "127.0.0.1", resolve));
  await Promise.all([listen(server), listen(consumer)]);
  let browser;
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ channel: process.env.TEST_BROWSER || "msedge", headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base + "/data-guide.html");
    await page.waitForFunction(() => document.getElementById("dataVersionStatus").textContent.startsWith("最新版："));
    assert.equal(await page.locator('meta[name="robots"]').getAttribute("content"), "noindex,nofollow");
    assert.equal(await page.locator("#dataVersionList a").count() > 0, true);
    for (const width of [390, 320, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Page overflow at ${width}px`);
      assert.equal(await page.locator(".data-guide__table-wrap").evaluateAll(elements => elements.every(element => element.scrollWidth <= element.clientWidth + 1)), true, `Clipped specification table at ${width}px`);
    }
    if (process.env.DATA_GUIDE_SCREENSHOT) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: process.env.DATA_GUIDE_SCREENSHOT, fullPage: true });
    }
    await page.goto(`http://127.0.0.1:${consumer.address().port}/blank`);
    const result = await page.evaluate(async url => {
      const response = await fetch(url);
      const json = await response.json();
      return { ok: response.ok, count: json.chartCount, length: json.charts.length, version: json.dataVersion };
    }, base + "/data/v1/latest.json");
    assert.equal(result.ok, true);
    assert.equal(result.count, result.length);
    assert.equal(result.count > 0, true);
    assert.deepEqual(errors, []);
    console.log(`PASS: responsive guide, version links, noindex and cross-origin JSON fetch (${result.count} charts).`);
  } finally {
    if (browser) await browser.close();
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => consumer.close(resolve))]);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
