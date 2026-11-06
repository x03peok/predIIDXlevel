"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");

function database() {
  const data = new Map(["chart-statuses", "status-update-events", "chart-option-memos"].map(name => [name, new Map()]));
  const db = { data, failHistory: false };
  db.transaction = (names, mode = "readonly") => {
    const keys = Array.isArray(names) ? names : [names];
    const local = new Map(keys.map(name => [name, new Map([...data.get(name)].map(([key, value]) => [key, structuredClone(value)]))]));
    let pending = 0, ended = false;
    const finish = () => queueMicrotask(() => {
      if (ended || pending) return;
      ended = true;
      if (mode === "readwrite") for (const name of keys) data.set(name, local.get(name));
      transaction.oncomplete?.();
    });
    const transaction = {
      error: null,
      abort() {
        if (ended) return;
        ended = true;
        queueMicrotask(() => transaction.onabort?.());
      },
      objectStore(name) {
        assert(keys.includes(name));
        const store = local.get(name);
        const read = value => {
          const request = {};
          pending++;
          queueMicrotask(() => {
            if (ended) return;
            request.result = structuredClone(value());
            request.onsuccess?.();
            pending--;
            finish();
          });
          return request;
        };
        return {
          get: key => read(() => store.get(key)),
          getAll: () => read(() => [...store.values()]),
          put(record) { store.set(record.chartId, structuredClone(record)); },
          delete(key) { store.delete(key); },
          add(event) {
            if (db.failHistory) throw new Error("Simulated history write failure");
            const id = store.size + 1;
            store.set(id, { ...structuredClone(event), id });
          },
        };
      },
    };
    finish();
    return transaction;
  };
  return db;
}

function environment() {
  const nodes = new Map();
  for (const id of ["chartCurrentStatus", "chartCurrentStatusMessage", "targetOptionMemoCount", "targetOptionMemoMessage",
    "targetOptionMemoTableShell", "targetOptionMemoTableBody"]) nodes.set(id, {
      value: "", textContent: "", innerHTML: "", hidden: false, disabled: false, dataset: {}, addEventListener() {},
    });
  const events = [];
  const context = vm.createContext({
    console, Date, Map, Set, URL, URLSearchParams,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    window: { addEventListener() {}, dispatchEvent: event => events.push(event),
      localStorage: { getItem: () => null }, cpiStatusToast: { show: info => { context.undo = info.onUndo; } } },
    document: { getElementById: id => nodes.get(id), createElement: () => ({}), addEventListener() {}, querySelectorAll: () => [] },
  });
  for (const name of ["update-history.js", "chart-options.js", "chart.js", "target-analysis.js", "target.js"]) {
    vm.runInContext(fs.readFileSync(path.join(root, name), "utf8"), context, { filename: name });
  }
  const db = database();
  context.database = db;
  context.window.cpiStorage = { open: async () => db };
  vm.runInContext(`
    chartState.chartId = "1";
    chartState.predRow = { chart_id: "1", title: "Chart One", difficulty: "ANOTHER", original_level: "11" };
    targetState.db = database;
    targetCacheElements = () => {};
    targetElements.optionMemoCount = document.getElementById("targetOptionMemoCount");
    targetElements.optionMemoMessage = document.getElementById("targetOptionMemoMessage");
    targetElements.optionMemoTableShell = document.getElementById("targetOptionMemoTableShell");
    targetElements.optionMemoTableBody = document.getElementById("targetOptionMemoTableBody");
  `, context);
  return { context, db, nodes, events, run: code => vm.runInContext(code, context) };
}

async function runTests() {
  const { context, db, nodes, events, run } = environment();
  const row = { chartId: "1", status: "easy", updatedAt: "2026-11-01T00:00:00Z", historyBackfillExcluded: true };
  db.data.get("chart-statuses").set("1", row);
  await run("chartLoadStatusState()");
  assert.equal(nodes.get("chartCurrentStatus").value, "easy");
  assert.equal(nodes.get("chartCurrentStatus").disabled, false);
  await run('chartHandleStatusChange({ target: { value: "clear" } })');
  assert.equal(db.data.get("chart-statuses").get("1").status, "clear");
  assert.equal(db.data.get("chart-statuses").get("1").historyBackfillExcluded, true);
  const first = db.data.get("status-update-events").get(1);
  assert.equal(first.beforeStatus, "easy");
  assert.equal(first.afterStatus, "clear");
  assert.equal(first.source, "chart");
  assert.equal(first.title, "Chart One");
  assert.equal(first.level, "11");
  assert(events.some(event => event.type === "cpi:status-changed" && event.detail.source === "chart"));
  await context.undo();
  assert.equal(db.data.get("chart-statuses").get("1").status, "easy");
  const reverted = db.data.get("status-update-events").get(2);
  assert.equal(reverted.beforeStatus, "clear");
  assert.equal(reverted.afterStatus, "easy");
  const page = fs.readFileSync(path.join(root, "mypage.js"), "utf8");
  const start = page.indexOf("function mypageMergeUpdateHistoryEvents(");
  const end = page.indexOf("function mypageRenderUpdateHistory(", start);
  vm.runInContext(page.slice(start, end), context);
  context.changes = [...db.data.get("status-update-events").values()];
  assert.equal(run('mypageMergeUpdateHistoryEvents(changes, window.cpiUpdateHistory.statusRanks, new Set(["assisted", "easy", "clear", "hard"])).length'), 0);
  const count = db.data.get("status-update-events").size;
  const timestamp = db.data.get("chart-statuses").get("1").updatedAt;
  await run('chartSaveCurrentStatus("easy")');
  assert.equal(db.data.get("status-update-events").size, count);
  assert.equal(db.data.get("chart-statuses").get("1").updatedAt, timestamp);
  db.data.get("chart-statuses").set("1", { ...row, status: "clear" });
  await run('chartSaveCurrentStatus("hard")');
  assert.equal(db.data.get("status-update-events").get(3).beforeStatus, "clear", "Use stored baseline, not stale UI");
  await run('chartSaveCurrentStatus("unregistered")');
  assert.equal(db.data.get("chart-statuses").has("1"), false);
  db.failHistory = true;
  await assert.rejects(run('chartSaveCurrentStatus("clear")'), /history write failure/);
  assert.equal(db.data.get("chart-statuses").has("1"), false, "Status and history must roll back together");
  assert.equal(nodes.get("chartCurrentStatus").value, "unregistered");
  assert.equal(nodes.get("chartCurrentStatus").disabled, false);
  await assert.rejects(run('chartWriteCurrentStatus(database, "1", "invalid")'), /不正/);
  db.failHistory = false;

  const memos = db.data.get("chart-option-memos");
  memos.set("1", { chartId: "1", options: ["s-random", "regular"], updatedAt: "2026-11-06T01:00:00Z" });
  memos.set("2", { chartId: "2", options: ["mirror"], updatedAt: "2026-11-06T01:00:00Z" });
  memos.set("999999", { chartId: "999999", options: ["random"], updatedAt: "2026-11-06T01:00:00Z" });
  run(`
    targetState.rows = [
      { chart_id: "1", title: "B <script>", difficulty: "ANOTHER", original_level: 11, __order: 0 },
      { chart_id: "2", title: "A", difficulty: "HYPER", original_level: 10, __order: 1 },
    ];
    targetState.rowsByChartId = new Map(targetState.rows.map(row => [row.chart_id, row]));
    targetState.records = new Map([["1", { status: "hard" }]]);
    targetState.manualMemoIds = new Set();
    targetState.recommendationSettings.targetGoals = [];
  `);
  assert.equal(await run("targetLoadOptionMemos()"), true);
  run("targetRenderOptionMemos()");
  assert.equal(nodes.get("targetOptionMemoCount").textContent, "2件");
  const html = nodes.get("targetOptionMemoTableBody").innerHTML;
  assert(html.indexOf("2.html") < html.indexOf("1.html"), "Sort by title");
  assert(html.includes("B &lt;script&gt;"));
  assert(html.includes("正規") && html.includes("S乱") && html.includes("鏡"));
  assert(!html.includes("999999.html"));
  assert.equal(nodes.get("targetOptionMemoTableShell").hidden, false);
  assert.equal(await run("targetLoadOptionMemos()"), false);
  db.data.get("chart-option-memos").clear();
  assert.equal(await run("targetLoadOptionMemos()"), true);
  run("targetRenderOptionMemos()");
  assert.equal(nodes.get("targetOptionMemoCount").textContent, "0件");
  assert.equal(nodes.get("targetOptionMemoTableShell").hidden, true);
  assert.equal(nodes.get("targetOptionMemoMessage").hidden, false);

  db.data.get("chart-option-memos").set("1", { chartId: "1", options: ["random"], updatedAt: "2026-11-06T01:00:00Z" });
  run(`
    targetStorageReady = true;
    targetState.records = new Map();
    targetState.autoRecommendationsInitialized = true;
    targetReadAllRecords = async () => [];
    targetReadAllManualMemos = async () => [];
    targetSyncRecommendationSettings = () => false;
    targetUpdateAvailability = () => {};
    targetRender = () => { window.renderCount = (window.renderCount ?? 0) + 1; };
    const originalLoadOptions = targetLoadOptionMemos;
    let interruptOnce = true;
    targetLoadOptionMemos = async () => {
      const changed = await originalLoadOptions();
      if (interruptOnce) { interruptOnce = false; targetRefreshAgain = true; }
      return changed;
    };
  `);
  await run("targetRefreshFromExternalDataChange()");
  assert.equal(context.window.renderCount, 1, "Coalesced refresh must still render the option change");

  const template = fs.readFileSync(path.join(root, "chart.html"), "utf8");
  assert(template.indexOf('id="chartFeatures"') < template.indexOf('id="chartCurrentStatus"'));
  assert(template.indexOf('id="chartCurrentStatus"') < template.indexOf('id="chartOptionMemos"'));
  const target = fs.readFileSync(path.join(root, "target.html"), "utf8");
  assert(target.indexOf('src="chart-options.js?') < target.indexOf('src="target.js?'));
  return "PASS: atomic Status/history writes, Undo, daily revert aggregation, stale UI baseline, deletion, no-op, rollback, option-memo listing/refresh, independent filters, escaped titles and template order.";
}

module.exports = runTests;
if (require.main === module) runTests().then(console.log).catch(error => { console.error(error); process.exitCode = 1; });
