"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const { createPage, loadRows, readChartPlatforms } = require("../generate_chart_pages.js");
const { generatePublicData } = require("../generate_public_data.js");
const root = path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8").replace(/\r\n/g, "\n");
const rows = loadRows();

test("chart platform declarations resolve to AC, INFINITAS, or both", () => {
  assert.deepEqual(readChartPlatforms("AC"), ["ac"]);
  assert.deepEqual(readChartPlatforms("INF"), ["inf"]);
  assert.deepEqual(readChartPlatforms("ac|inf"), ["ac", "inf"]);
  assert.deepEqual(readChartPlatforms(""), ["ac", "inf"]);
  for (const invalid of ["ac|ac", "inf|other", "ac|inf|ac"]) {
    assert.throws(() => readChartPlatforms(invalid), /Invalid platforms/);
  }
  const counts = new Map();
  for (const row of rows) {
    const key = [...row.platforms].sort().join("|");
    assert.ok(["ac", "inf", "ac|inf"].includes(key), row.chart_id + ": " + key);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  assert.equal(counts.size, 3, "all three editions must be represented");
  const context = vm.createContext({
    window: { addEventListener() {} },
    document: {
      addEventListener() {},
      createElement: () => ({ innerHTML: "", get value() { return this.innerHTML; } }),
    },
  });
  for (const filename of ["data.js", "record.js"]) vm.runInContext(read(filename), context);
  vm.runInContext('recordEntityDecoder = document.createElement("textarea")', context);
  for (const platform of ["ac", "inf"]) {
    const expected = rows.filter(row => row.platforms.includes(platform)).map(row => String(row.chart_id)).sort();
    const actual = vm.runInContext(`recordLoadRows("${platform}").map(row => row.chartId).sort().join(",")`, context);
    assert.equal(actual, expected.join(","), platform + ": runtime catalog differs from generator");
  }
});

test("public JSON, generated detail HTML and the sitemap match the current catalog", () => {
  const snapshot = generatePublicData(root, { check: true });
  assert.equal(snapshot.chartCount, rows.length);
  const ids = rows.map(row => String(row.chart_id));
  assert.equal(new Set(ids).size, ids.length);
  const expectedFiles = ids.map(id => id + ".html").sort();
  const actualFiles = fs.readdirSync(path.join(root, "chart-pages")).filter(name => name.endsWith(".html")).sort();
  const actual = new Set(actualFiles);
  const expected = new Set(expectedFiles);
  assert.deepEqual(actualFiles.filter(name => !expected.has(name)), [], "remove stale detail pages");
  assert.deepEqual(expectedFiles.filter(name => !actual.has(name)), [], "generate missing detail pages");
  const template = read("chart.html");
  const stale = rows.filter(row => read("chart-pages/" + row.chart_id + ".html") !== createPage(template, row));
  assert.deepEqual(stale.map(row => row.chart_id), [], "regenerate out-of-date detail pages");
  const sitemapIds = [...read("sitemap.xml").matchAll(/<loc>https:\/\/cpi-next\.com\/chart-pages\/(\d+)\.html<\/loc>/g)]
    .map(match => match[1]).sort();
  assert.deepEqual(sitemapIds, ids.sort());
});
