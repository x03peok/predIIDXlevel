"use strict";

(() => {
  const storeFields = {
    "chart-statuses": "records",
    "manual-targets": "manualMemos",
    "daily-targets": "dailyTargets",
    "status-update-events": "updateHistory",
  };
  const statuses = new Set(["unregistered", "unowned", "no-play", "failed", "assisted", "easy", "clear", "hard"]);
  const goals = new Set(["easy", "clear", "hard"]);
  function fail() { throw new Error("バックアップの更新履歴または今日の10曲の形式が不正です。"); }
  function id(value) {
    const result = String(value ?? "");
    if (!/^\d{1,32}$/.test(result)) fail();
    return result;
  }
  function timestamp(value) {
    if (typeof value !== "string" || value.length > 100 || !Number.isFinite(Date.parse(value))) fail();
    return new Date(value).toISOString();
  }
  function status(value) { if (!statuses.has(value)) fail(); return value; }
  function validateExtra(payload) {
    if (!Array.isArray(payload.updateHistory) || payload.updateHistory.length > 100000
      || !Array.isArray(payload.dailyTargets) || payload.dailyTargets.length > 10000) fail();
    const historyIds = new Set();
    const updateHistory = payload.updateHistory.map(event => {
      if (!event || !Number.isSafeInteger(event.id) || event.id < 1 || historyIds.has(event.id)) fail();
      historyIds.add(event.id);
      const changedAt = timestamp(event.changedAt);
      return {
        id: event.id, chartId: id(event.chartId), changedAt, updatedAt: changedAt,
        cycleKey: window.cpiUpdateHistory.getCycleKey(new Date(changedAt)),
        beforeStatus: status(event.beforeStatus), afterStatus: status(event.afterStatus),
        source: String(event.source ?? "backup").slice(0, 100),
        title: String(event.title ?? "").slice(0, 1000),
        difficulty: String(event.difficulty ?? "").slice(0, 32),
        level: String(event.level ?? "").slice(0, 32),
      };
    });
    const dates = new Set();
    const dailyTargets = payload.dailyTargets.map(day => {
      if (!day || typeof day.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day.date)
        || !Number.isFinite(Date.parse(day.date)) || new Date(day.date).toISOString().slice(0, 10) !== day.date
        || dates.has(day.date) || !Array.isArray(day.charts) || day.charts.length < 1 || day.charts.length > 10) fail();
      dates.add(day.date);
      const chartIds = new Set();
      const charts = day.charts.map(chart => {
        if (!chart) fail();
        const chartId = id(chart.chartId);
        if (chartIds.has(chartId) || !goals.has(chart.targetStatus)) fail();
        chartIds.add(chartId);
        return { chartId, initialStatus: status(chart.initialStatus), targetStatus: chart.targetStatus };
      });
      return { date: day.date, lockedAt: timestamp(day.lockedAt), charts };
    });
    return { updateHistory, dailyTargets };
  }
  function readSnapshot(database) {
    return new Promise((resolve, reject) => {
      const result = {};
      const transaction = database.transaction(Object.keys(storeFields), "readonly");
      for (const [store, field] of Object.entries(storeFields)) {
        const request = transaction.objectStore(store).getAll();
        request.onsuccess = () => { result[field] = request.result; };
      }
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = transaction.onabort = () => reject(transaction.error ?? new Error("バックアップを読み込めませんでした。"));
    });
  }
  window.cpiBackupData = Object.freeze({ readSnapshot, validateExtra });
})();
