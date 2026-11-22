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

test("AC and INFINITAS import NO PLAY without changing absent charts", () => {
  vm.runInContext(`
    recordEntityDecoder = document.createElement('textarea');
    const rows = [
      ['1', 'Played', 'ZINRAI', 'ANOTHER'],
      ['2', 'Not Played', 'ZINRAI', 'ANOTHER'],
      ['3', 'Missing', 'ZINRAI', 'ANOTHER'],
      ['4', 'Unknown Status', 'ZINRAI', 'ANOTHER'],
      ['5', 'Collision', '10th style', 'ANOTHER'],
      ['6', 'Collision', 'ZINRAI', 'ANOTHER'],
      ['7', 'Played', 'ZINRAI', 'HYPER'],
      ['8', 'No Lamp', 'ZINRAI', 'ANOTHER'],
    ].map(([chartId, title, officialVersion, difficulty]) => ({ chartId, title, officialVersion, difficulty }));
    recordImportIndex = recordBuildImportIndex(rows);
    for (const platform of ['ac', 'inf']) {
      const lastColumns = platform === 'ac' ? 'ANOTHER 難易度' : 'ANOTHER 最終スコア更新時刻,ANOTHER 最終プレー日時,';
      const csv = [
        'バージョン,タイトル,ANOTHER クリアタイプ,' + lastColumns,
        'ZINRAI,Played,CLEAR,10',
        'ZINRAI,Not Played,NO PLAY,10',
        'ZINRAI,Unknown Status,UNKNOWN,10',
        'unknown,Collision,CLEAR,10',
        ...(platform === 'ac' ? ['ZINRAI,No Lamp,---,10'] : []),
      ].map((line, index) => platform === 'inf' && index > 0 ? line + ',' : line).join('\\n');
      const result = recordParseOfficialCsv(csv, platform);
      assert.deepEqual([...result.updates], [['1', 'clear'], ['2', 'no-play']]);
      assert.deepEqual([...result.presentIds].sort(), platform === 'ac' ? ['1','2','4','5','6','8'] : ['1','2','4','5','6']);
      const oldIds = new Set(['1', '3', '999']);
      assert.deepEqual(recordGetMissingPreviousCsvRows(rows, oldIds, result.presentIds).map(row => row.chartId), ['3']);
      assert.throws(() => recordParseOfficialCsv(csv, platform === 'ac' ? 'inf' : 'ac'));
      if (platform === 'inf') {
        assert.doesNotThrow(() => recordParseOfficialCsv(csv + ',', platform));
        assert.throws(() => recordParseOfficialCsv(csv.slice(0, -1), platform), /列数が見出しと一致しません/);
      }
    }
  `, createContext(["record.js"]));
});

test("official CSV rejects broken records and accepts quoted fields and blank lines", () => {
  vm.runInContext(`
    const header = 'バージョン,タイトル,ANOTHER クリアタイプ,ANOTHER 難易度';
    const row = 'ZINRAI,"Title, ""quoted""",CLEAR,10';
    const parse = tail => recordParseOfficialCsv(header + '\\r\\n' + row + '\\r\\n' + tail, 'ac');
    assert.doesNotThrow(() => parse('ZINRAI,"Title\\ncontinued",CLEAR,10\\r\\n\\r\\n'));
    assert.throws(() => parse('ZINRAI,"Truncated'), /引用符が閉じていません/);
    assert.throws(() => parse('ZINRAI,Truncated,CLEAR'), /列数が見出しと一致しません/);
    assert.throws(() => parse('ZINRAI,Extra,CLEAR,10,11'), /列数が見出しと一致しません/);
    assert.throws(() => parse('ZINRAI,"Quoted"suffix,CLEAR,10'), /引用符の後に余分な文字/);
    assert.doesNotThrow(() => parse('ZINRAI,Title "Forza",CLEAR,10'));
    assert.equal(recordParseCsv('BEMANI Sound Team "Artist",CLEAR', { strict: true })[0][0], 'BEMANI Sound Team "Artist"');
  `, createContext(["record.js"]));
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

test("identical official titles resolve to the chart ID for the CSV edition only", () => {
  vm.runInContext(`
    recordEntityDecoder = document.createElement('textarea');
    window.__CSV_BUNDLE__ = [
      'chart_id,title,official_title,official_version,difficulty,original_level,platforms',
      '101,Display AC,Same Official,ZINRAI,ANOTHER,10,ac',
      '102,Display INF,Same Official,ZINRAI,ANOTHER,10,inf',
      '103,Display Shared,Shared,ZINRAI,ANOTHER,10,ac|inf',
    ].join('\\n');
    for (const [platform, expected] of [['ac','101'], ['inf','102']]) {
      const headers = platform === 'ac'
        ? 'ANOTHER 難易度' : 'ANOTHER 最終スコア更新時刻,ANOTHER 最終プレー日時';
      const extra = platform === 'ac' ? '' : ',';
      recordImportIndex = recordBuildImportIndex(recordLoadRows(platform));
      const result = recordParseOfficialCsv([
        'バージョン,タイトル,ANOTHER クリアタイプ,' + headers,
        'ZINRAI,Same Official,HARD CLEAR,10' + extra,
        'ZINRAI,Shared,CLEAR,10' + extra,
      ].join('\\n'), platform);
      assert.deepEqual([...result.updates], [[expected, 'hard'], ['103', 'clear']]);
    }
  `, createContext(["record.js"]));
});
