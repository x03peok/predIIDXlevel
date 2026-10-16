"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const storage = new Map();
const context = vm.createContext({
  assert, Event,
  window: {
    addEventListener() {}, dispatchEvent() {},
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
  },
  document: { createElement: () => ({}), addEventListener() {} },
});
for (const file of ["target-analysis.js", "target.js", "daily-target.js"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), context, { filename: file });
}
vm.runInContext(`
  const row = { chart_id: '1', title: 'Synthetic', original_level: 11, difficulty: 'ANOTHER',
    features: '', __search: 'synthetic', easy_pred_skill: 10, calibrated_pred_skill: 10.5, hard_pred_skill: 12 };
  const dailyRow = { chartId: '1', title: 'Synthetic', level: 11, difficulty: 'A', search: 'synthetic',
    easyPred: 10, pred: 10.5, hardPred: 12 };
  targetState.rows = [row];
  targetState.rowsByChartId = new Map([['1', row]]);
  targetState.records = new Map([['1', { status: 'clear' }]]);
  targetState.statusFilter = new Set(['clear']);
  targetState.levelFilter = new Set([11]);
  targetState.difficultyFilter = new Set(['ANOTHER']);
  dailyState.rows = [dailyRow];
  dailyState.rowsById = new Map([['1', dailyRow]]);
  dailyState.records = new Map(targetState.records);
  dailyState.statusFilter = new Set(['clear']);
  dailyState.levelFilter = new Set([11]);
  dailyState.difficultyFilter = new Set(['A']);

  targetState.predMinFilter = dailyState.predMinFilter = 12;
  targetState.predMaxFilter = dailyState.predMaxFilter = 13;
  assert.equal(targetMatchesFilters(row), true);
  assert.equal(dailyGetFilteredRows().length, 1);
  targetState.predMinFilter = dailyState.predMinFilter = 10;
  targetState.predMaxFilter = dailyState.predMaxFilter = 11;
  assert.equal(targetMatchesFilters(row), false, 'Filter must not use NORMAL Pred for a HARD goal');
  assert.equal(dailyGetFilteredRows().length, 0);
  targetState.predMinFilter = dailyState.predMinFilter = 0;
  targetState.predMaxFilter = dailyState.predMaxFilter = 999;
  targetState.adjustedPredMinFilter = dailyState.adjustedPredMinFilter = 12;
  targetState.adjustedPredMaxFilter = dailyState.adjustedPredMaxFilter = 13;
  assert.equal(targetMatchesFilters(row), true);
  assert.equal(dailyGetFilteredRows().length, 1);

  targetUpdateAdvancedSummary = dailyUpdateAdvancedSummary = () => {};
  for (const name of ['predMinInput', 'predMaxInput', 'adjustedPredMinInput', 'adjustedPredMaxInput']) targetElements[name] = {};
  dailyElements.adjustedPredMinInput = {}; dailyElements.adjustedPredMaxInput = {};
  targetSetPredBounds(); targetSetAdjustedPredBounds(); dailySetAdjustedPredBounds();
  assert.equal(targetState.predDataMax, 12);
  assert.equal(targetState.adjustedPredDataMax, 12);
  assert.equal(dailyState.adjustedPredDataMax, 12);
  assert.equal(targetState.predDataMin, 10);

  dailyState.ready = true;
  dailyState.records.set('1', { status: 'failed' });
  dailyState.manualMemoIds = new Set(['1']);
  dailyState.manualGoalById.set('1', 'hard');
  dailyRenderCandidateTable = () => {};
  dailyShowError = () => {};
  dailyAutoFillFromManualMemos();
  assert.equal(dailyState.selected.get('1'), 'hard', 'Keep the manually chosen goal');

  let rendered = 0;
  targetRenderRecommendationSettings = () => { rendered += 1; };
  targetElements.autoSettingsOverlay = { hidden: true };
  const saved = { ...targetGetDefaultRecommendationSettings(), count: 3, targetGoals: ['hard'] };
  window.localStorage.setItem(targetRecommendationSettingsKey, JSON.stringify(saved));
  assert.equal(targetSyncRecommendationSettings(), true);
  assert.equal(targetState.recommendationSettings.count, 3);
  assert.equal(targetState.recommendationSettings.targetGoals.join(','), 'hard');
  assert.equal(targetRecommendationDraft.count, 3);
  assert.equal(targetSyncRecommendationSettings(), false);
  assert.equal(rendered, 1);
  targetElements.autoSettingsOverlay.hidden = false;
  targetRecommendationDraft.count = 7;
  window.localStorage.setItem(targetRecommendationSettingsKey, JSON.stringify({ ...saved, count: 4 }));
  assert.equal(targetSyncRecommendationSettings(), true);
  assert.equal(targetState.recommendationSettings.count, 4);
  assert.equal(targetRecommendationDraft.count, 7, 'Do not discard an unsaved settings draft');

  const model = { intercept: 0, slope: -1, center: 11, scale: 1 };
  assert.equal(window.cpiPrediction.probability(model, null), null);
  assert.equal(window.cpiPrediction.probability({ ...model, scale: 0 }, 11), null);
  assert.equal(window.cpiPrediction.adjustPred(null, [], []), null);
  row.hard_pred_skill = null; dailyRow.hardPred = null;
  targetState.model = dailyState.model = model;
  assert.equal(targetGetExpectedClearProbability(row, 'hard'), null);
  assert.equal(dailyGetExpectedClearProbability(dailyRow, 'hard'), null);
`, context);
console.log("PASS: goal-specific raw/adjusted filters and bounds, manual memo goals, settings synchronization, preserved drafts and missing-Pred guards.");
