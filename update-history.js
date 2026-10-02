"use strict";

(() => {
  const storeName = "status-update-events";
  const timeZone = "Asia/Tokyo";
  const retentionDays = 30;
  const statusLabels = Object.freeze({
    unregistered: "未登録",
    unowned: "未所持・未解禁",
    "no-play": "NO PLAY",
    failed: "FAILED",
    assisted: "ASSISTED",
    easy: "EASY",
    clear: "CLEAR",
    hard: "HARD以上",
  });
  const statusRanks = Object.freeze({
    unregistered: 0,
    unowned: 0,
    "no-play": 0,
    failed: 1,
    assisted: 2,
    easy: 3,
    clear: 4,
    hard: 5,
  });

  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  function getDateParts(date = new Date()) {
    const parts = Object.fromEntries(
      dateFormatter.formatToParts(date).map(({ type, value }) => [type, value]),
    );
    return {
      year: Number(parts.year),
      month: Number(parts.month),
      day: Number(parts.day),
      hour: Number(parts.hour),
      minute: Number(parts.minute),
      second: Number(parts.second),
    };
  }

  function shiftDateKey(dateKey, days) {
    const [year, month, day] = String(dateKey).split("-").map(Number);
    const shifted = new Date(Date.UTC(year, month - 1, day + days));
    return shifted.toISOString().slice(0, 10);
  }

  function getCycleKey(date = new Date()) {
    const parts = getDateParts(date);
    const dateKey = [parts.year, parts.month, parts.day]
      .map((value, index) => String(value).padStart(index === 0 ? 4 : 2, "0"))
      .join("-");
    return parts.hour < 5 ? shiftDateKey(dateKey, -1) : dateKey;
  }

  function getRetentionCutoffKey(date = new Date()) {
    return shiftDateKey(getCycleKey(date), -(retentionDays - 1));
  }

  function formatCycleDate(cycleKey) {
    const [year, month, day] = String(cycleKey).split("-").map(Number);
    if (![year, month, day].every(Number.isFinite)) return String(cycleKey ?? "");
    return year + "-" + month + "-" + day;
  }

  function formatCyclePeriod(cycleKey, days = retentionDays) {
    const normalizedKey = String(cycleKey ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedKey)) return "";
    const endKey = shiftDateKey(normalizedKey, Math.max(0, Number(days) - 1));
    return formatCycleDate(normalizedKey) + " 5:00 ～ " + formatCycleDate(endKey) + " 4:59";
  }

  function normalizeStatus(status) {
    const value = String(status ?? "").trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(statusLabels, value) ? value : "unregistered";
  }

  function ensureStore(database) {
    if (!database.objectStoreNames.contains(storeName)) {
      const store = database.createObjectStore(storeName, { keyPath: "id", autoIncrement: true });
      store.createIndex("cycleKey", "cycleKey", { unique: false });
      store.createIndex("changedAt", "changedAt", { unique: false });
    }
  }

  function getValidChangedAt(value, fallback) {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date : fallback;
  }

  function appendToTransaction(transaction, changes, options = {}) {
    const store = transaction.objectStore(storeName);
    const source = String(options.source ?? "manual");
    const requestedChangedAt = options.changedAt instanceof Date
      ? options.changedAt
      : new Date(options.changedAt ?? Date.now());
    const defaultChangedAt = getValidChangedAt(requestedChangedAt, new Date());
    const snapshots = options.snapshots instanceof Map ? options.snapshots : new Map();
    const values = changes instanceof Map
      ? [...changes].map(([chartId, afterStatus]) => ({ chartId, afterStatus }))
      : Array.isArray(changes) ? changes : [];
    const normalizedChanges = values.map((change) => {
      const chartId = String(change.chartId ?? "").trim();
      if (!/^\d+$/.test(chartId)) return null;
      const beforeStatus = normalizeStatus(change.beforeStatus);
      const afterStatus = normalizeStatus(change.afterStatus);
      if (beforeStatus === afterStatus) return null;
      const changedAt = getValidChangedAt(change.changedAt, defaultChangedAt);
      const snapshot = change.snapshot ?? snapshots.get(chartId) ?? {};
      return {
        chartId,
        beforeStatus,
        afterStatus,
        changedAt,
        snapshot,
      };
    }).filter(Boolean);

    const addEvents = () => {
      for (const change of normalizedChanges) {
        store.add({
          chartId: change.chartId,
          cycleKey: getCycleKey(change.changedAt),
          changedAt: change.changedAt.toISOString(),
          updatedAt: change.changedAt.toISOString(),
          beforeStatus: change.beforeStatus,
          afterStatus: change.afterStatus,
          source,
          title: String(change.snapshot.title ?? "").trim(),
          difficulty: String(change.snapshot.difficulty ?? "").trim(),
          level: String(change.snapshot.level ?? change.snapshot.original_level ?? "").trim(),
        });
      }
    };

    // Preserve all transitions; daily aggregation handles reverts without
    // deleting earlier days or changing the original daily baseline.
    addEvents();
  }
  function readEvents(database, cycleKey = null) {
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, "readonly");
      const store = transaction.objectStore(storeName);
      const request = cycleKey
        ? store.index("cycleKey").getAll(IDBKeyRange.only(cycleKey))
        : store.getAll();
      request.onsuccess = () => resolve(request.result ?? []);
      request.onerror = () => reject(request.error ?? new Error("更新履歴を読み込めませんでした。"));
    });
  }

  function backfillFromRecords(database, records, snapshots = new Map()) {
    if (!database || !database.objectStoreNames.contains(storeName)) {
      return Promise.resolve([]);
    }

    const cutoffKey = getRetentionCutoffKey(new Date());
    const candidates = (Array.isArray(records) ? records : [])
      .map((record) => {
        const chartId = String(record?.chartId ?? "").trim();
        const status = normalizeStatus(record?.status);
        const timestamp = record?.updatedAt ?? record?.updatedat ?? record?.updated_at;
        const changedAt = getValidChangedAt(timestamp, null);
        if (
          record?.historyBackfillExcluded === true
          || !/^\d+$/.test(chartId)
          || (statusRanks[status] ?? 0) < statusRanks.assisted
          || !changedAt
        ) {
          return null;
        }
        const cycleKey = getCycleKey(changedAt);
        if (cycleKey < cutoffKey) return null;
        const snapshot = snapshots instanceof Map ? snapshots.get(chartId) : undefined;
        return {
          chartId,
          beforeStatus: "unregistered",
          afterStatus: status,
          changedAt: changedAt.toISOString(),
          snapshot: snapshot ?? {},
        };
      })
      .filter(Boolean);

    if (!candidates.length) return Promise.resolve([]);

    return readEvents(database).then((events) => {
      const latestByChartId = new Map();
      for (const event of events) {
        const chartId = String(event?.chartId ?? "").trim();
        const changedAt = new Date(event?.changedAt).getTime();
        if (!chartId || !Number.isFinite(changedAt)) continue;
        const previous = latestByChartId.get(chartId);
        if (!previous || changedAt > previous) latestByChartId.set(chartId, changedAt);
      }
      const changes = candidates.filter((candidate) => {
        const previous = latestByChartId.get(candidate.chartId);
        return !previous || new Date(candidate.changedAt).getTime() > previous;
      });
      if (!changes.length) return [];

      return new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, "readwrite");
        appendToTransaction(transaction, changes, { source: "updatedAt-backfill" });
        transaction.oncomplete = () => resolve(changes);
        transaction.onerror = () => reject(
          transaction.error ?? new Error("更新履歴を補完できませんでした。"),
        );
        transaction.onabort = () => reject(
          transaction.error ?? new Error("更新履歴を補完できませんでした。"),
        );
      });
    });
  }
  function cleanup(database, date = new Date()) {
    return new Promise((resolve, reject) => {
      const cutoffKey = getRetentionCutoffKey(date);
      const transaction = database.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const isLegacySeed = cursor.value?.source === "legacy-updatedAt";
        if (isLegacySeed || String(cursor.value?.cycleKey ?? "") < cutoffKey) cursor.delete();
        cursor.continue();
      };
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error ?? new Error("更新履歴を整理できませんでした。"));
      transaction.onabort = () => reject(transaction.error ?? new Error("更新履歴を整理できませんでした。"));
    });
  }

  function getDemoEvents(date = new Date()) {
    const currentKey = getCycleKey(date);
    return [
      { id: "demo-1", chartId: "203", cycleKey: currentKey, changedAt: currentKey + "T06:20:00.000Z", beforeStatus: "failed", afterStatus: "easy", source: "demo", title: "Demo Update Alpha", difficulty: "HYPER", level: "10" },
      { id: "demo-2", chartId: "358", cycleKey: shiftDateKey(currentKey, -1), changedAt: shiftDateKey(currentKey, -1) + "T08:10:00.000Z", beforeStatus: "easy", afterStatus: "clear", source: "demo", title: "Demo Update Beta", difficulty: "ANOTHER", level: "11" },
      { id: "demo-3", chartId: "6076", cycleKey: shiftDateKey(currentKey, -4), changedAt: shiftDateKey(currentKey, -4) + "T10:45:00.000Z", beforeStatus: "clear", afterStatus: "hard", source: "demo", title: "Demo Update Gamma", difficulty: "ANOTHER", level: "12" },
    ];
  }

  window.cpiUpdateHistory = Object.freeze({
    storeName,
    retentionDays,
    statusLabels,
    statusRanks,
    ensureStore,
    appendToTransaction,
    backfillFromRecords,
    readEvents,
    cleanup,
    getCycleKey,
    getRetentionCutoffKey,
    formatCycleDate,
    formatCyclePeriod,
    getDemoEvents,
  });
})();
