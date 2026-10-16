"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const baselinePath = path.join(__dirname, "fixtures", "prediction-before-unification.json");
const features = ["BPM変化", "チャージノート", "ラスト難", "皿複合", "単鍵ラッシュ", "同時押し", "物量", "連皿", "連打"];
const rows = Array.from({ length: 81 }, (_, index) => {
  const pred = 7 + index * 0.085;
  return { chart_id: String(index + 1), title: "Synthetic " + index, original_level: Math.min(12, Math.max(8, Math.floor(pred))),
    difficulty: "ANOTHER", __order: index, __search: "synthetic " + index,
    easy_pred_skill: pred - 0.4, calibrated_pred_skill: pred, hard_pred_skill: pred + 0.65,
    features: index % 4 === 0 ? "" : features[index % 9] + "+".repeat(index % 3) + "、" + features[(index + 2) % 9] };
});
const mixed = rows.map((row, index) => {
  const strength = 10.3 + ((index * 37) % 29 - 14) / 18;
  let status = "failed";
  for (const [key, lamp] of [["easy_pred_skill", "easy"], ["calibrated_pred_skill", "clear"], ["hard_pred_skill", "hard"]]) {
    if (row[key] < strength) status = lamp;
  }
  return { chartId: row.chart_id, status };
});
const scenarios = {
  empty: [],
  four: mixed.slice(30, 34),
  noClears: rows.slice(20, 30).map(row => ({ chartId: row.chart_id, status: "failed" })),
  allHard: rows.slice(20, 30).map(row => ({ chartId: row.chart_id, status: "hard" })),
  provisional: [21, 22, 23, 70, 71, 72].map((id, index) => ({ chartId: String(id), status: index < 3 ? "failed" : "hard" })),
  mixed,
  noHardClears: mixed.map(record => ({ ...record, status: record.status === "hard" ? "clear" : record.status })),
  invalidIds: [...mixed, { chartId: "99999", status: "hard" }, { chartId: "100000", status: "failed" }],
};

function createContext() {
  const context = vm.createContext({
    console,
    window: { addEventListener() {}, localStorage: { getItem() { return null; } } },
    document: { addEventListener() {}, createElement() { return {}; } },
  });
  for (const file of ["target-analysis.js", "target.js", "daily-target.js", "mypage.js"]) {
    vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename: file });
  }
  context.testRows = structuredClone(rows);
  vm.runInContext(`
    targetState.rows = testRows;
    targetState.rowsByChartId = new Map(testRows.map(row => [row.chart_id, row]));
    mypageState.rows = testRows;
    mypageState.rowsByChartId = targetState.rowsByChartId;
    dailyState.rows = testRows.map(row => ({ chartId: row.chart_id, pred: row.calibrated_pred_skill,
      easyPred: row.easy_pred_skill, hardPred: row.hard_pred_skill }));
    dailyState.rowsById = new Map(dailyState.rows.map(row => [row.chartId, row]));
  `, context);
  return context;
}

function runScenario(context, records) {
  context.testRecords = structuredClone(records);
  return JSON.parse(vm.runInContext(`(() => {
    const records = new Map(testRecords.map(record => [record.chartId, record]));
    const before = JSON.stringify([...records]);
    targetState.records = records;
    Object.assign(targetState, targetGetAnalysis(records));
    dailyState.records = records;
    dailyState.model = targetState.model;
    dailyState.modelsByMode = targetState.modelsByMode;
    dailyState.deltas = targetState.deltas;
    mypageState.records = records;
    const analysis = mypageBuildAnalysis();
    const summarize = result => ({ range: result.range, message: result.message, usedLogistic: result.usedLogistic,
      counts: result.counts, model: result.model });
    let maxProbabilityDifference = 0;
    for (const row of testRows) for (const mode of ['easy', 'normal', 'hard']) {
      const dailyRow = dailyState.rowsById.get(row.chart_id);
      const probabilities = [targetGetExpectedClearProbability(row, mode), dailyGetExpectedClearProbability(dailyRow, mode),
        mypageGetRecommendationProbability(row, mode, analysis.overallResult, analysis.lampResults, analysis.featureDeltas)];
      if (!probabilities.every(value => value === null || Number.isFinite(value))) throw new Error('Non-finite probability');
      if (probabilities.some(value => value === null) && probabilities.some(value => value !== null)) throw new Error('Model fallback mismatch');
      if (probabilities[0] !== null) for (const probability of probabilities) maxProbabilityDifference = Math.max(maxProbabilityDifference, Math.abs(probability - probabilities[0]));
    }
    if (JSON.stringify([...records]) !== before) throw new Error('Analysis changed stored records');
    return JSON.stringify({
      overall: summarize(analysis.overallResult),
      lamps: Object.fromEntries(Object.entries(analysis.lampResults).map(([mode, result]) => [mode, summarize(result)])),
      deltas: analysis.featureDeltas,
      scores: analysis.featureScores.map(({ name, score }) => ({ name, score })),
      updates: analysis.updateTargetCandidates.slice(0, 5).map(({ row, target, probability }) => ({ id: row.chart_id, goal: target.mode, probability })),
      maxProbabilityDifference,
    });
  })()`, context));
}

function compare(actual, expected, location) {
  if (typeof expected === "number") {
    assert(Number.isFinite(actual) && Math.abs(actual - expected) < 1e-6, `${location}: ${actual} vs ${expected}`);
  } else if (expected && typeof expected === "object") {
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), location);
    for (const key of Object.keys(expected)) compare(actual[key], expected[key], `${location}.${key}`);
  } else {
    assert.equal(actual, expected, location);
  }
}

const context = createContext();
const results = Object.fromEntries(Object.entries(scenarios).map(([name, records]) => [name, runScenario(context, records)]));
if (process.argv.includes("--capture-baseline")) {
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
  fs.writeFileSync(baselinePath, JSON.stringify(results, null, 2) + "\n");
  console.log("Captured pre-unification behavior for eight synthetic scenarios.");
} else {
  const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  compare(results, baseline, "scenarios");
  for (const [name, result] of Object.entries(results)) assert(result.maxProbabilityDifference < 1e-10, name);
  vm.runInContext(`
    const records = new Map(testRecords.map(record => [record.chartId, record]));
    if (targetGetAnalysis(records) !== targetGetAnalysis(new Map([...records].reverse()))) throw new Error('Cache regression');
    const cached = mypageGetPredictionAnalysis();
    if (cached !== mypageGetPredictionAnalysis()) throw new Error('Repeated inference recomputed analysis');
    const [id, record] = [...mypageState.records][0];
    mypageState.records.set(id, { ...record, status: record.status === 'hard' ? 'failed' : 'hard' });
    mypageInvalidateAnalysis();
    if (cached === mypageGetPredictionAnalysis()) throw new Error('Status edit did not invalidate prediction cache');
  `, context);
  console.log("PASS: eight legacy behavior snapshots, identical probabilities across three pages, model fallback, no record mutation and cache.");
}
