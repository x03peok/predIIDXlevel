"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const storage = new Map();
const context = vm.createContext({
  assert,
  console,
  Event,
  window: {
    addEventListener() {},
    dispatchEvent() {},
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
  },
  document: { createElement: () => ({}), addEventListener() {} },
});
for (const file of ["target-analysis.js", "target.js", "daily-target.js"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), context, { filename: file });
}

vm.runInContext(`
  targetRenderRecommendationSettings = () => {};
  targetGetExpectedClearProbability = (row, mode) => row.probabilities[mode];
  targetGetAdjustedPred = (row, mode) => targetGetPredValue(row, mode) + row.delta;
  targetGetRecommendationAppropriatePred = () => 11;
  dailyRenderCandidateTable = () => {};
  dailyShowError = message => { window.testError = message; };

  function resetScenario(count = 14) {
    targetState.model = {};
    dailyState.model = targetState.model;
    dailyState.ready = true;
    dailyState.selected = new Map();
    targetState.rows = Array.from({ length: count }, (_, index) => ({
      chart_id: String(index + 1), original_level: 11, difficulty: 'ANOTHER',
      title: 'Test ' + index, features: '皿複合++',
      easy_pred_skill: 10, calibrated_pred_skill: 11, hard_pred_skill: 12,
      delta: -0.3, probabilities: { easy: 0.95, normal: 0.85, hard: 0.5 },
    }));
    targetState.records = new Map(targetState.rows.map(row => [row.chart_id, { status: 'failed' }]));
    dailyState.records = new Map(targetState.records);
    dailyState.rows = targetState.rows.map(row => ({ chartId: row.chart_id, level: row.original_level }));
    dailyState.rowsById = new Map(dailyState.rows.map(row => [row.chartId, row]));
    saveSettings({});
  }

  function saveSettings(overrides) {
    targetState.recommendationSettings = {
      ...targetGetDefaultRecommendationSettings(),
      count: 1, statuses: ['failed'], levels: [11],
      difficultyReasons: ['appropriate'], featureReasons: ['favorable'],
      targetGoals: ['easy', 'clear', 'hard'], ...overrides,
    };
    window.localStorage.setItem(targetRecommendationSettingsKey, JSON.stringify(targetState.recommendationSettings));
  }

  resetScenario();
  assert.equal(dailyGetDefaultGoal('failed'), 'easy');
  assert.equal(dailyGetAutoFillCandidates().length, 14);
  assert(dailyGetAutoFillCandidates().every(candidate => candidate.goal === 'hard'));
  dailyAutoFillSelection();
  assert.equal(dailyState.selected.size, 10);
  assert([...dailyState.selected.values()].every(goal => goal === 'hard'), 'A qualifying HARD goal must not be replaced with EASY');

  resetScenario();
  targetState.rows.forEach(row => { row.probabilities = { easy: 0.95, normal: 0.5, hard: 0.15 }; });
  dailyAutoFillSelection();
  assert.equal(dailyState.selected.size, 10);
  assert([...dailyState.selected.values()].every(goal => goal === 'clear'));

  resetScenario();
  saveSettings({ difficultyReasons: [...targetRecommendationDifficultyValues], featureReasons: [...targetRecommendationFeatureReasonValues] });
  assert.equal(dailyGetAutoFillCandidates().length, 42);
  dailyState.selected.set('1', 'clear');
  dailyAutoFillSelection();
  assert.equal(dailyState.selected.size, 10, 'Duplicate chart-goal candidates must not consume daily slots');
  assert.equal(dailyState.selected.get('1'), 'clear', 'Preserve existing selections');

  resetScenario(3);
  saveSettings({ difficultyReasons: [...targetRecommendationDifficultyValues] });
  dailyAutoFillSelection();
  assert.equal(dailyState.selected.size, 3, 'Select each chart only once when fewer than ten charts qualify');

  for (const overrides of [
    { levels: [12] }, { statuses: ['easy'] }, { targetGoals: ['easy', 'clear'] },
    { difficultyReasons: ['challenge'] }, { featureReasons: ['unfavorable'] },
    { featureFilters: { '皿複合': { include: false, exclude: true } } },
  ]) {
    resetScenario();
    saveSettings(overrides);
    assert.equal(dailyGetAutoFillCandidates().length, 0, JSON.stringify(overrides));
    dailyAutoFillSelection();
    assert.equal(dailyState.selected.size, 0);
    assert.match(window.testError, /設定に合う譜面がありません/);
  }

  resetScenario(1);
  dailyState.records.set('1', { status: 'hard' });
  assert.equal(dailyGetAutoFillCandidates().length, 0, 'Reject already achieved goals if daily status is newer');
  resetScenario();
  targetState.model = null;
  assert.equal(dailyGetAutoFillCandidates().length, 0, 'Do not fall back to a different selection algorithm');
`, context);
console.log("PASS: exact chart-goal selection, all recommendation filters, unique ten-chart limit and existing selections.");
