"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const { test } = require("node:test");

function createContext(files) {
  const context = vm.createContext({
    assert,
    window: { addEventListener() {} },
    document: {
      addEventListener() {},
      createElement() { return { innerHTML: "", get value() { return this.innerHTML; } }; },
    },
  });
  for (const file of files) vm.runInContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), context);
  return context;
}

test("official CSV lookup follows current data without rebuilding the static alias file", () => {
  vm.runInContext(`
    recordEntityDecoder = document.createElement('textarea');
    const fixture = (chartId, title, officialTitle, officialVersion, difficulty = 'ANOTHER') => ({
      chartId, title, officialTitle, officialVersion, difficulty, level: '10',
    });
    const legacy = { plain: { ['OLDALIAS\\0ANOTHER']: ['1'], ['REMOVED\\0ANOTHER']: ['999'] } };
    const rows = [
      fixture('1', 'Display', 'Official Title', 'ZINRAI'),
      fixture('2', 'New Chart', 'New Official', 'ZINRAI'),
      fixture('3', 'Same', 'Same', '10th style'),
      fixture('4', 'Same', 'Same', 'ZINRAI'),
      fixture('5', 'Same', 'Same', 'ZINRAI', 'HYPER'),
    ];
    recordImportIndex = recordBuildImportIndex(rows, legacy);
    assert.deepEqual(recordGetImportChartIds('Official Title', 'ZINRAI', 'ANOTHER'), ['1']);
    assert.deepEqual(recordGetImportChartIds('Old Alias', '', 'ANOTHER'), ['1']);
    assert.deepEqual(recordGetImportChartIds('Ｎｅｗ　Ｏｆｆｉｃｉａｌ', 'ZINRAI', 'ANOTHER'), ['2']);
    assert.deepEqual(recordGetImportChartIds('Same', '10th style', 'ANOTHER'), ['3']);
    assert.deepEqual(recordGetImportChartIds('Same', 'ZINRAI', 'ANOTHER'), ['4']);
    assert.deepEqual(recordGetImportChartIds('Same', 'unknown', 'ANOTHER'), []);
    assert.deepEqual(recordGetImportChartIds('Same', 'unknown', 'HYPER'), ['5']);
    assert.deepEqual(recordGetImportChartIds('Removed', '', 'ANOTHER'), []);
    rows.push(fixture('6', 'Later Chart', 'Later Official', 'NEXT'));
    recordImportIndex = recordBuildImportIndex(rows, legacy);
    assert.deepEqual(recordGetImportChartIds('Later Official', 'NEXT', 'ANOTHER'), ['6']);
    recordImportIndex = recordBuildImportIndex(rows, null);
    assert.deepEqual(recordGetImportChartIds('Official Title', 'ZINRAI', 'ANOTHER'), ['1']);
  `, createContext(["record.js"]));
});

test("every current official title resolves to its chart, including the 75 new charts", () => {
  vm.runInContext(`
    recordEntityDecoder = document.createElement('textarea');
    recordState.rows = recordLoadRows();
    recordImportIndex = recordBuildImportIndex(recordState.rows);
    for (const row of recordState.rows) {
      assert.deepEqual(recordGetImportChartIds(row.officialTitle, row.officialVersion, row.difficulty), [row.chartId]);
    }
    const newRows = recordState.rows.filter(row => Number(row.chartId) >= 6143);
    const quote = value => '"' + String(value).replaceAll('"', '""') + '"';
    const csv = ['バージョン,タイトル,ANOTHER クリアタイプ,ANOTHER 難易度,HYPER クリアタイプ,HYPER 難易度',
      ...newRows.map(row => [row.officialVersion, row.officialTitle,
        row.difficulty === 'ANOTHER' ? 'CLEAR' : '', row.difficulty === 'ANOTHER' ? row.level : '',
        row.difficulty === 'HYPER' ? 'CLEAR' : '', row.difficulty === 'HYPER' ? row.level : '',
      ].map(quote).join(','))].join('\\n');
    const result = recordParseOfficialCsv(csv);
    assert.equal(result.updates.size, newRows.length);
    assert.equal(result.unmatched, 0);
    assert.equal(result.ambiguous, 0);
  `, createContext(["data.js", "record-import-index.js", "record.js"]));
});

test("diagnosis treats missing and invalid Pred as null, never zero", () => {
  vm.runInContext(`
    for (const value of ['', '  ', null, undefined, NaN, Infinity, 'invalid', 'null']) {
      assert.equal(diagnosisPredNumber({ calibrated_pred_skill: value }), null);
    }
    assert.equal(diagnosisPredNumber({ calibrated_pred_skill: '10.5' }), 10.5);
    assert.equal(diagnosisPredNumber({ calibrated_pred_skill: 0 }), 0);
    diagnosisState.rows = diagnosisLoadRows();
    const missing = diagnosisState.rows.filter(row => diagnosisPredNumber(row) === null);
    const candidates = diagnosisGetCandidateRows();
    assert(missing.length > 0);
    assert.equal(candidates.length, diagnosisState.rows.length - missing.length);
    assert(candidates.every(row => diagnosisPredNumber(row) !== null));
    for (const option of diagnosisAptitudeOptions) {
      assert(diagnosisGetAptitudeRows(option).every(row => diagnosisPredNumber(row) !== null));
    }
    assert(diagnosisGetLevelBounds().min > 0);
  `, createContext(["data.js", "diagnosis.js"]));
});
