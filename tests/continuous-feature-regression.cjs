"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const { buildFeatureDataset, featureNames, modes, serializeFeatureBundles } = require("../generate_feature_data.js");
const { buildCharts } = require("../generate_public_data.js");
const { readCsv, serializeCsv, importDataset } = require("../import_dataset.js");
const root = path.resolve(__dirname, "..");

function fixture() {
  const chart = { chart_id: "1", title: "9-1", difficulty: "ANOTHER", original_level: "11",
    easy_pred_skill: "10", calibrated_pred_skill: "11", hard_pred_skill: "12", features: "",
    official_title: "Official title", official_version: "ZINRAI", bpm_min: "150", bpm_max: "150", url: "" };
  const element = { chart_id: "1", name: "Wrong CSV name", difficulty: "ANOTHER", level: "11" };
  for (const mode of modes) for (const feature of featureNames) {
    element[`${mode}_${feature}_amount_sd`] = "0";
    if (!["物量", "ラスト難"].includes(feature)) element[`${mode}_${feature}_impact_sd`] = "0";
  }
  return { chart, element };
}

test("method A averages raw SD first; vectors use gauge-specific clipped impact with amount fallback", () => {
  const { chart, element } = fixture();
  element.easy_同時押し_amount_sd = "8";
  element.easy_同時押し_impact_sd = "-0.5";
  element.normal_同時押し_impact_sd = "0.5";
  element.hard_同時押し_impact_sd = "0";
  element.easy_連打_impact_sd = "-12";
  element.normal_連打_impact_sd = "32";
  element.hard_連打_impact_sd = "";
  element.hard_連打_amount_sd = "-0.25";
  for (const mode of modes) element[`${mode}_物量_amount_sd`] = "2.5";
  const result = buildFeatureDataset([chart], [element]);
  assert.equal(result.charts[0].title, "9-1");
  assert.equal(result.charts[0].official_title, chart.official_title);
  assert.match(result.charts[0].features, /同時押し(?:、|$)/);
  assert.match(result.charts[0].features, /連打\+\+/);
  assert.match(result.charts[0].features, /物量\+(?:、|$)/);
  assert.deepEqual(result.data.charts["1"].map(vector => vector[0]), [-0.5, 0.5, 0]);
  assert.deepEqual(result.data.charts["1"].map(vector => vector[3]), [-4, 4, -0.25]);
  assert.deepEqual(result.data.charts["1"].map(vector => vector[2]), [2.5, 2.5, 2.5]);
  const context = { window: {} };
  const bundles = serializeFeatureBundles(result);
  vm.runInNewContext(bundles.charts + bundles.corrections, context);
  assert.equal(context.window.__FEATURE_DATA_ID__, context.window.__FEATURE_DATA__.id);
  assert.equal(readCsv(context.window.__CSV_BUNDLE__)[0].official_version, chart.official_version);
  const published = buildCharts(result.charts)[0];
  assert.deepEqual(Object.keys(published), ["id", "title", "difficulty", "level", "pred", "features"]);
  assert(published.features.every(feature => Number.isInteger(feature.strength) && feature.strength >= 1 && feature.strength <= 3));
});

test("missing metrics remain null; invalid, partial, mismatched and duplicate inputs fail closed", () => {
  const { chart, element } = fixture();
  const empty = Object.fromEntries(Object.entries(element).map(([key, value]) => [key, key.endsWith("_sd") ? "" : value]));
  const unknown = { ...chart, easy_pred_skill: "", calibrated_pred_skill: "", hard_pred_skill: "" };
  const result = buildFeatureDataset([unknown], [empty]);
  assert.equal(result.data.charts["1"], null);
  assert.equal(result.charts[0].features, "");
  for (const input of [empty, { ...element, easy_連打_amount_sd: "" }, { ...element, easy_連打_impact_sd: "NaN" },
    { ...element, difficulty: "HYPER" }, { ...element, chart_id: "2" }]) {
    assert.throws(() => buildFeatureDataset([chart], [input]));
  }
  assert.throws(() => buildFeatureDataset([chart], [element, element]));
  const thresholds = [0.999999999, 1, 2, 3];
  for (const value of thresholds) {
    const next = { ...element };
    for (const mode of modes) for (const kind of ["amount", "impact"]) next[`${mode}_同時押し_${kind}_sd`] = String(value);
    assert.equal(buildFeatureDataset([chart], [next]).charts[0].features,
      value < 1 ? "" : "同時押し" + "+".repeat(value >= 3 ? 2 : value >= 2 ? 1 : 0));
  }
});

test("runtime uses continuous values regardless of tags and includes negative-only observations in fitting", () => {
  const context = vm.createContext({ window: {} });
  let source = fs.readFileSync(path.join(root, "target-analysis.js"), "utf8");
  source = source.replace("  return function(records) {", "  window.fitDeltas = targetFitFeatureDeltas;\n  return function(records) {");
  vm.runInContext(source, context);
  context.window.__FEATURE_DATA_ID__ = "test";
  context.window.__FEATURE_DATA__ = { version: 1, id: "test", features: ["同時押し"], modes,
    charts: { "1": [[-1], [-2], [-3]], "2": [[-3], [-1], [-2]], "3": null } };
  const prediction = context.window.cpiPrediction;
  assert.deepEqual(Array.from(prediction.featureVector({ chart_id: "1", features: "同時押し++" }, "easy", ["同時押し"])), [-1]);
  assert.deepEqual(Array.from(prediction.featureVector({ chart_id: "1", features: "" }, "hard", ["同時押し"])), [-3]);
  assert.deepEqual(Array.from(prediction.featureVector({ chart_id: "3" }, "easy", ["同時押し"])), [0]);
  assert.equal(prediction.adjustPred(null, [-1], [0.2]), null);
  assert.equal(prediction.adjustPred(10, [-1], [0.2]), 9.8);
  const usedModes = [];
  context.window.cpiCreateTargetAnalysis({ rows: [], predModes: {}, outcomes: {}, featureNames: ["同時押し"], number: Number,
    featureVector: (row, mode) => { usedModes.push(mode); return prediction.featureVector(row, mode, ["同時押し"]); } });
  const deltas = context.window.fitDeltas([
    { row: { chart_id: "1" }, mode: "easy", pred: 10, outcome: 1 },
    { row: { chart_id: "2" }, mode: "hard", pred: 10, outcome: 0 },
  ], { intercept: 0, slope: -1, center: 10, scale: 1 });
  assert.deepEqual(usedModes, ["easy", "hard"]);
  assert(Number.isFinite(deltas[0]) && Math.abs(deltas[0]) > 0.0001);
  context.window.__FEATURE_DATA_ID__ = "stale";
  assert.throws(() => prediction.featureVector({ chart_id: "1" }, "normal", ["同時押し"]), /再読み込み/);
});

test("generated public assets match IDs, preserve missing predictions, and contain only bounded correction values", () => {
  const context = { window: {} };
  for (const name of ["data.js", "feature-data.js"]) vm.runInNewContext(fs.readFileSync(path.join(root, name), "utf8"), context);
  const rows = readCsv(context.window.__CSV_BUNDLE__);
  const data = context.window.__FEATURE_DATA__;
  assert.equal(context.window.__FEATURE_DATA_ID__, data.id);
  assert.deepEqual(Object.keys(data.charts).sort(), rows.map(row => row.chart_id).sort());
  for (const row of rows) {
    assert(row.official_title && row.official_version);
    const vectors = data.charts[row.chart_id];
    if (vectors === null) {
      assert.equal(row.features, "");
      assert.equal(row.easy_pred_skill + row.calibrated_pred_skill + row.hard_pred_skill, "");
    } else {
      assert.equal(vectors.length, 3);
      for (const vector of vectors) {
        assert.equal(vector.length, 9);
        assert(vector.every(value => Number.isFinite(value) && value >= -4 && value <= 4));
      }
    }
  }
  for (const name of ["target.html", "mypage.html"]) {
    const html = fs.readFileSync(path.join(root, name), "utf8");
    assert(html.indexOf('src="feature-data.js?') < html.indexOf('src="target-analysis.js?'));
  }
});

test("future full imports require matching metrics before writing any bundle", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cpi-feature-import-"));
  try {
    const source = path.join(directory, "source");
    fs.mkdirSync(source);
    const { chart, element } = fixture();
    fs.writeFileSync(path.join(source, "data.csv"), serializeCsv([{
      chart_id: chart.chart_id, title: chart.title, official_title: chart.official_title, official_version: chart.official_version,
      diff_label_from_query: chart.difficulty, level_from_query: chart.original_level, bpm: "150", url: "",
      EASY_Pred: "10", CLEAR_Pred: "11", HARD_Pred: "12", "1SD以上の要素": "皿複合++",
    }]));
    const course = { version: "ZINRAI", course: "test" };
    for (let stage = 1; stage <= 4; stage++) {
      course[`stage_${stage}_chart_id`] = "1";
      course[`skill_after_${stage}`] = "10";
    }
    fs.writeFileSync(path.join(source, "stage_skills.csv"), serializeCsv([course]));
    fs.writeFileSync(path.join(directory, "data.js"), "unchanged");
    fs.writeFileSync(path.join(directory, "feature-data.js"), "unchanged");
    fs.writeFileSync(path.join(directory, "danilabo-data.js"), "window.__DANILABO_ROWS__ = [];");
    assert.throws(() => importDataset(source, directory), /Continuous Feature data requires/);
    assert.equal(fs.readFileSync(path.join(directory, "data.js"), "utf8"), "unchanged");
    assert.equal(fs.readFileSync(path.join(directory, "feature-data.js"), "utf8"), "unchanged");
    fs.writeFileSync(path.join(source, "chart_elements_48.csv"), serializeCsv([element]));
    importDataset(source, directory);
    const context = { window: {} };
    for (const file of ["data.js", "feature-data.js"]) vm.runInNewContext(fs.readFileSync(path.join(directory, file), "utf8"), context);
    assert.equal(context.window.__FEATURE_DATA_ID__, context.window.__FEATURE_DATA__.id);
    assert.equal(readCsv(context.window.__CSV_BUNDLE__)[0].features, "", "old source tags must not override method A");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
