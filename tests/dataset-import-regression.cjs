"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readCsv, normalizeRows, buildStageRows, serializeCsv } = require("../import_dataset.js");

const source = overrides => ({ chart_id: "2", title: "A", official_title: "A", official_version: "7th style",
  diff_label_from_query: "ANOTHER", level_from_query: "12", "1SD\u4ee5\u4e0a\u306e\u8981\u7d20": "",
  bpm: "93\uFF5E191", url: "", EASY_Pred: "11.66", CLEAR_Pred: "11.93", HARD_Pred: "12.17", ...overrides });

test("imports BPM ranges and fixed BPM without including unrelated source numbers", () => {
  const [range] = normalizeRows([source()]);
  assert.equal(range.bpm_min, "93");
  assert.equal(range.bpm_max, "191");
  const [fixed] = normalizeRows([source({ bpm: "200" })]);
  assert.equal(fixed.bpm_min, fixed.bpm_max);
  assert.throws(() => normalizeRows([source({ bpm: "191~93" })]));
  assert.throws(() => normalizeRows([source({ bpm: "unknown" })]));
});

test("preserves missing predictions, exact chart IDs and supplied titles", () => {
  const [chart] = normalizeRows([source({ chart_id: "12345", title: 'A, "B"', bpm: "", EASY_Pred: "", CLEAR_Pred: "", HARD_Pred: "" })]);
  assert.equal(chart.chart_id, "12345");
  assert.equal(chart.calibrated_pred_skill, "");
  assert.equal(chart.bpm_min, "");
  assert.deepEqual(readCsv("\uFEFF" + serializeCsv([chart])), [chart]);
  assert.throws(() => normalizeRows([source(), source()]));
  assert.throws(() => normalizeRows([source({ official_version: "" })]));
});

test("updates stage skills while preserving other versions", () => {
  const charts = normalizeRows([source()]);
  const course = { version: "ZINRAI", course: "test" };
  for (let index = 1; index <= 4; index += 1) {
    course[`stage_${index}_chart_id`] = "2";
    course[`skill_after_${index}`] = String(8 + index / 10);
  }
  const retained = { version: "INFINITAS" };
  const stages = buildStageRows([course], charts, [retained, { version: "ZINRAI" }]);
  assert.equal(stages.length, 5);
  assert.equal(stages[0], retained);
  assert.equal(stages[4].stage, "FINAL");
  assert.equal(stages[4].pred, "8.4");
  assert.equal(stages[4].title, "A");
  assert.throws(() => buildStageRows([{ ...course, stage_4_chart_id: "missing" }], charts, []));
  assert.throws(() => buildStageRows([course, course], charts, []));
});
