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
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404).end(); return;
    }
    res.setHeader("Content-Type", ({ ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css" })[path.extname(file)] || "application/octet-stream");
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
    for (const id of ["1", "6042", "806", "1220", "6144"]) {
      await page.goto(base + "/chart-pages/" + id + ".html");
      await page.waitForFunction(() => document.getElementById("chartShareButton")?.href.includes("intent/tweet"));
      const result = await page.evaluate(() => {
        const text = new URL(document.getElementById("chartShareButton").href).searchParams.get("text");
        const lines = Object.entries(chartPredModes).map(([mode, definition]) => {
          const position = getChartPredPosition(chartState.predRow, chartState.predRows, mode);
          const percentile = formatChartPredPercentile(position, chartState.predRow).replace("（", "(").replace("）", ")");
          return definition.label + ": " + formatChartPred(getChartPredValue(chartState.predRow, mode))
            + (percentile ? " " + percentile : "");
        });
        return { text, lines, title: window.cpiShareText.formatTitle(chartState.predRow.title) };
      });
      for (const line of result.lines) assert(result.text.includes(line), id + ": " + line);
      assert(result.text.indexOf(result.lines[0]) < result.text.indexOf(result.lines[1]));
      assert(result.text.indexOf(result.lines[1]) < result.text.indexOf(result.lines[2]));
      assert(result.text.includes(result.title));
      assert(result.text.includes("Feature: "));
      const sharedUrl = new URL(result.text.trim().split("\n").at(-1));
      assert.equal(sharedUrl.pathname, "/chart-pages/" + id + ".html");
      assert.equal(sharedUrl.search, "");
      assert.equal(sharedUrl.hash, "");
      assert(!/undefined|NaN/.test(result.text));
      if (id === "6144") assert(result.lines.every(line => line.endsWith("—")));
    }
    assert.deepEqual(errors, []);
    console.log("PASS: EASY/NORMAL/HARD share values and per-lamp percentiles, missing Pred, title spacing and query-free URLs.");
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
