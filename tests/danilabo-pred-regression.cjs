"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "danilabo-table.js"), "utf8");

function render(rows, version = "ZINRAI") {
  const tables = { innerHTML: "", querySelectorAll: () => [] };
  const tab = {
    dataset: { version }, classList: { toggle() {} },
    getAttribute: () => "true", setAttribute() {}, addEventListener() {},
  };
  vm.runInNewContext(source, {
    window: {
      __DANILABO_ROWS__: rows,
      __CSV_BUNDLE__: "chart_id,calibrated_pred_skill\n" + rows.map(row => row.chart_id + ",8.00").join("\n"),
    },
    document: { querySelectorAll: () => [tab], getElementById: () => tables },
  });
  return tables.innerHTML;
}

function predLabels(html) {
  return [...html.matchAll(/class="[^"]*\bnumeric-value--pred"[^>]*>([^<]*)</g)].map(match => match[1]);
}

const stage = pred => ({
  version: "ZINRAI", class: "皆伝", stage: "FINAL", chart_id: "5893",
  title: "Final chart", difficulty: "ANOTHER", level: "12", pred,
});

test("passing and FINAL Stage estimates use the same rounding at decimal boundaries", () => {
  for (const [pred, expected] of [["12.85", "12.9"], ["10.05", "10.1"], ["8.61", "8.6"]]) {
    assert.deepEqual(predLabels(render([stage(pred)])), [expected, expected]);
  }
});

test("all current passing estimates match their FINAL Stage label in both versions", () => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, "danilabo-data.js"), "utf8"), context);
  for (const version of ["ZINRAI", "INFINITAS"]) {
    const html = render(context.window.__DANILABO_ROWS__, version);
    const sections = html.match(/<section class="danilabo-rank"[\s\S]*?<\/section>/g);
    assert.equal(sections.length, 9);
    for (const section of sections) {
      const labels = predLabels(section);
      assert.equal(labels.length, 5);
      assert.equal(labels[0], labels[4]);
    }
  }
});

test("missing and invalid FINAL estimates do not appear as zero passing estimates", () => {
  for (const pred of [null, undefined, "", " ", "NaN"]) {
    const html = render([stage(pred)]);
    assert.deepEqual(predLabels(html), ["－"]);
    assert(!html.includes("合格適正Pred"));
  }
});

test("INFINITAS shows its stage estimates, not chart Pred or the course average", () => {
  const rows = [10.05, 11.28, 12.14, 12.85].map((pred, index) => ({
    ...stage(pred), chart_id: String(index + 1), version: "INFINITAS", stage: ["1st", "2nd", "3rd", "FINAL"][index],
  }));
  const html = render(rows, "INFINITAS");
  assert.deepEqual(predLabels(html), ["12.9", "10.1", "11.3", "12.1", "12.9"]);
  assert.match(html, /Stage適正Pred/);
  assert.match(html, /合格適正Pred/);
  assert.doesNotMatch(html, /ノマゲPred/);
});

