"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const { test } = require("node:test");

function contextFor(files) {
  const context = vm.createContext({
    assert,
    window: { addEventListener() {}, localStorage: { getItem() { return null; } } },
    document: { createElement() { return {}; }, addEventListener() {} },
  });
  for (const file of files) vm.runInContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), context);
  vm.runInContext(`
    const fixtureRows = [null, 12, 0, 11, undefined, '', NaN].map((pred, index) => ({
      chart_id: String(index), title: String(index), difficulty: 'ANOTHER', original_level: 10,
      __order: index, features: '', easy_pred_skill: pred, calibrated_pred_skill: pred, hard_pred_skill: pred,
    }));
    const expected = { asc: ['2', '3', '1', '0', '4', '5', '6'], desc: ['1', '3', '2', '0', '4', '5', '6'] };
  `, context);
  return context;
}

test("detail tables keep missing EASY/NORMAL/HARD Pred last in both directions", () => {
  vm.runInContext(`
    state.rows = fixtureRows;
    state.difficultyFilter = ['A']; state.origFilter = ['10'];
    for (const key of ['easy_pred_skill', 'calibrated_pred_skill', 'hard_pred_skill']) {
      state.sortKey = key;
      for (const direction of ['asc', 'desc']) {
        state.sortDir = direction;
        assert.deepEqual(getVisibleRows().map(row => row.chart_id), expected[direction]);
      }
    }
  `, contextFor(["app.js"]));
});

test("My Page current-lamp Pred keeps unknown values and unplayed lamps last", () => {
  vm.runInContext(`
    mypageState.rows = fixtureRows;
    mypageState.records = new Map(fixtureRows.map(row => [row.chart_id, { status: 'clear' }]));
    mypageState.statusFilter = mypageStatuses.map(status => status.value);
    mypageState.difficultyFilter = ['A']; mypageState.levelFilter = ['10'];
    mypageState.sortKey = 'current_pred';
    for (const direction of ['asc', 'desc']) {
      mypageState.sortDir = direction;
      assert.deepEqual(mypageGetVisibleRows().map(row => row.chart_id), expected[direction]);
    }
    mypageState.records.set('1', { status: 'easy' });
    mypageState.records.set('3', { status: 'hard' });
    fixtureRows[1].easy_pred_skill = 10;
    fixtureRows[3].hard_pred_skill = 13;
    mypageState.sortDir = 'asc';
    assert.deepEqual(mypageGetVisibleRows().slice(0, 3).map(row => row.chart_id), ['2', '1', '3']);
    mypageState.records.set('1', { status: 'failed' });
    mypageState.sortDir = 'desc';
    assert.deepEqual(mypageGetVisibleRows().slice(0, 2).map(row => row.chart_id), ['3', '2']);
  `, contextFor(["mypage.js"]));
});

test("My Target uses goal-specific raw/adjusted Pred and keeps missing values last", () => {
  vm.runInContext(`
    for (const key of ['calibrated_pred_skill', 'adjusted_pred']) {
      targetState.sortKey = key;
      for (const goal of ['easy', 'clear', 'hard']) {
        targetState.goalById = new Map(fixtureRows.map(row => [row.chart_id, goal]));
        for (const direction of ['asc', 'desc']) {
          targetState.sortDirection = direction;
          assert.deepEqual(fixtureRows.slice().sort(targetCompareRows).map(row => row.chart_id), expected[direction]);
        }
      }
    }
  `, contextFor(["target-analysis.js", "target.js"]));
});
