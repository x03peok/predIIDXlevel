"use strict";

const settingsStoreName = "chart-statuses";
const settingsManualMemoStoreName = "manual-targets";
const settingsDailyTargetsStoreName = "daily-targets";
const settingsUpdateHistoryStoreName = "status-update-events";
const settingsOptionMemoStoreName = "chart-option-memos";
const settingsBackupFormat = "cpi-next-clear-status-backup";
const settingsBackupVersion = 5;
const settingsPlatformKey = "cpi-next-record-platform";
const settingsPlatformLabels = { ac: "AC", inf: "INFINITAS" };
const settingsMaxBackupBytes = 10 * 1024 * 1024;
const settingsMaxRecords = 100000;
const settingsStatusValues = new Set([
  "unowned",
  "no-play",
  "failed",
  "assisted",
  "easy",
  "clear",
  "hard",
]);
const settingsElements = {};
let settingsDatabase = null;
let settingsBusy = false;
let settingsPlatform = "ac";
let settingsImportPlatform = null;

function settingsSetMessage(message, isError = false) {
  settingsElements.message.textContent = message;
  settingsElements.message.dataset.state = isError ? "error" : "ok";
}

function settingsOpenDatabase(platform = settingsPlatform) {
  return window.cpiStorage.open(platform);
}

function settingsReadAll(database) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(settingsStoreName, "readonly");
    const request = transaction.objectStore(settingsStoreName).getAll();
    request.onsuccess = () => resolve(request.result ?? []);
    request.onerror = () => reject(request.error ?? new Error("記録を読み込めませんでした。"));
  });
}

function settingsGetRecordUpdatedAt(record) {
  const value = record?.updatedAt ?? record?.updatedat ?? record?.updated_at;
  return typeof value === "string" && value.length <= 100
    ? value
    : new Date().toISOString();
}
function settingsIsValidRecord(record) {
  const chartId = String(record?.chartId ?? "").trim();
  return /^\d+$/.test(chartId) && settingsStatusValues.has(record?.status);
}

function settingsGetValidRecords(records) {
  return records
    .filter(settingsIsValidRecord)
    .map((record) => ({
      chartId: String(record.chartId).trim(),
      status: record.status,
      updatedAt: settingsGetRecordUpdatedAt(record),
      ...(record.historyBackfillExcluded === true ? { historyBackfillExcluded: true } : {}),
    }));
}

function settingsIsValidManualMemo(memo) {
  const chartId = String(memo?.chartId ?? "").trim();
  return /^\d+$/.test(chartId) && chartId.length <= 32;
}

function settingsGetValidManualMemos(memos) {
  const chartIds = new Set();
  return memos
    .filter((memo) => {
      const chartId = String(memo?.chartId ?? "").trim();
      if (!settingsIsValidManualMemo(memo) || chartIds.has(chartId)) {
        return false;
      }
      chartIds.add(chartId);
      return true;
    })
    .map((memo) => ({
      chartId: String(memo.chartId).trim(),
      updatedAt: typeof memo.updatedAt === "string" && memo.updatedAt.length <= 100
        ? memo.updatedAt
        : new Date().toISOString(),
    }));
}

function settingsBuildStatusChanges(beforeRecords, afterRecords, options = {}) {
  const before = new Map((beforeRecords ?? []).map((record) => [String(record.chartId), record.status]));
  const after = new Map((afterRecords ?? []).map((record) => [String(record.chartId), record.status]));
  const afterByChartId = new Map((afterRecords ?? []).map((record) => [String(record.chartId), record]));
  const useUpdatedAt = options.useUpdatedAt !== false;
  const chartIds = new Set([...before.keys(), ...after.keys()]);
  return [...chartIds].map((chartId) => {
    const afterRecord = afterByChartId.get(chartId);
    const changedAt = useUpdatedAt && typeof afterRecord?.updatedAt === "string"
      ? afterRecord.updatedAt
      : undefined;
    return {
      chartId,
      beforeStatus: before.get(chartId) ?? "unregistered",
      afterStatus: after.get(chartId) ?? "unregistered",
      ...(changedAt ? { changedAt } : {}),
    };
  }).filter((change) => change.beforeStatus !== change.afterStatus);
}

function settingsWriteAll(records, manualMemos, historyChanges = [], historySource = "settings", snapshot = null) {
  return new Promise((resolve, reject) => {
    if (!settingsDatabase) {
      reject(new Error("ローカル保存を開けませんでした。"));
      return;
    }
    const hasHistory = Boolean(
      historyChanges.length
      && window.cpiUpdateHistory
      && settingsDatabase.objectStoreNames.contains(settingsUpdateHistoryStoreName),
    );
    const stores = hasHistory
      ? [settingsStoreName, settingsManualMemoStoreName, settingsUpdateHistoryStoreName]
      : [settingsStoreName, settingsManualMemoStoreName];
    if (snapshot) {
      if (!stores.includes(settingsUpdateHistoryStoreName)) stores.push(settingsUpdateHistoryStoreName);
      stores.push(settingsDailyTargetsStoreName);
      if (Array.isArray(snapshot.optionMemos)) stores.push(settingsOptionMemoStoreName);
    }
    const transaction = settingsDatabase.transaction(stores, "readwrite");
    const store = transaction.objectStore(settingsStoreName);
    const manualMemoStore = transaction.objectStore(settingsManualMemoStoreName);
    store.clear();
    if (Array.isArray(manualMemos)) {
      manualMemoStore.clear();
    }
    for (const record of records) {
      store.put(record);
    }
    if (Array.isArray(manualMemos)) {
      for (const memo of manualMemos) {
        manualMemoStore.put(memo);
      }
    }
    if (snapshot) {
      const snapshotStores = [[settingsUpdateHistoryStoreName, snapshot.updateHistory], [settingsDailyTargetsStoreName, snapshot.dailyTargets]];
      if (Array.isArray(snapshot.optionMemos)) snapshotStores.push([settingsOptionMemoStoreName, snapshot.optionMemos]);
      for (const [name, values] of snapshotStores) {
        const target = transaction.objectStore(name);
        target.clear();
        for (const value of values) target.put(value);
      }
    } else if (hasHistory) {
      window.cpiUpdateHistory.appendToTransaction(transaction, historyChanges, { source: historySource });
    }
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error ?? new Error("データを保存できませんでした。"));
    transaction.onabort = () => reject(transaction.error ?? new Error("データを保存できませんでした。"));
  });
}

function settingsClearAll() {
  return new Promise((resolve, reject) => {
    const stores = [settingsStoreName, settingsDailyTargetsStoreName, settingsUpdateHistoryStoreName];
    const transaction = settingsDatabase.transaction(stores, "readwrite");
    for (const name of stores) transaction.objectStore(name).clear();
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error ?? new Error("保存データを削除できませんでした。"));
    transaction.onabort = () => reject(transaction.error ?? new Error("保存データを削除できませんでした。"));
  });
}

async function settingsReadBackupSnapshot(includeOptionMemos) {
  const separateOptions = includeOptionMemos && settingsPlatform === "inf";
  const snapshot = await window.cpiBackupData.readSnapshot(settingsDatabase, {
    includeOptionMemos: includeOptionMemos && !separateOptions,
  });
  if (separateOptions) {
    snapshot.optionMemos = await window.cpiChartOptions.readAll(await settingsOpenDatabase("ac"));
  }
  return snapshot;
}

function settingsWriteSharedOptionMemos(database, memos) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(settingsOptionMemoStoreName, "readwrite");
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error ?? new Error("共通オプションメモを保存できませんでした。"));
    try {
      const store = transaction.objectStore(settingsOptionMemoStoreName);
      store.clear();
      for (const memo of memos) store.put(memo);
    } catch (error) {
      transaction.abort();
      reject(error);
    }
  });
}

async function settingsWriteBackup(records, manualMemos, historyChanges, source, snapshot, rollbackSnapshot) {
  if (settingsPlatform !== "inf" || !Array.isArray(snapshot?.optionMemos)) {
    await settingsWriteAll(records, manualMemos, historyChanges, source, snapshot);
    return;
  }
  const database = await settingsOpenDatabase("ac");
  await settingsWriteAll(records, manualMemos, historyChanges, source, { ...snapshot, optionMemos: undefined });
  try {
    await settingsWriteSharedOptionMemos(database, snapshot.optionMemos);
  } catch {
    // IndexedDB cannot group writes across the AC and INFINITAS databases.
    const previousRecords = settingsGetValidRecords(rollbackSnapshot.records);
    try {
      await settingsWriteAll(previousRecords, settingsGetValidManualMemos(rollbackSnapshot.manualMemos),
        [], source, { ...rollbackSnapshot, optionMemos: undefined });
    } catch {
      settingsUpdateCount(records);
      throw new Error("共通オプションメモの保存に失敗し、INFINITAS版の記録を元に戻せませんでした。");
    }
    settingsUpdateCount(previousRecords);
    throw new Error("共通オプションメモを保存できなかったため、INFINITAS版の記録を元に戻しました。");
  }
}

function settingsUpdateCount(records) {
  settingsElements.recordCount.textContent = settingsPlatformLabels[settingsPlatform] + "版の保存: " + records.length.toLocaleString() + "譜面";
}

function settingsSetBusy(busy) {
  settingsBusy = busy;
  settingsElements.exportButton.disabled = busy || !settingsDatabase;
  settingsElements.importButton.disabled = busy || !settingsDatabase;
  settingsElements.resetButton.disabled = busy || !settingsDatabase;
  settingsElements.platformBadge.disabled = busy;
  for (const input of settingsElements.platformInputs) input.disabled = busy;
}

function settingsSyncPlatform() {
  const label = settingsPlatformLabels[settingsPlatform];
  document.body.dataset.platform = settingsPlatform;
  settingsElements.platformPicker.dataset.platform = settingsPlatform;
  settingsElements.platformBadge.textContent = label;
  settingsElements.platformBadge.setAttribute("aria-label", "現在の管理対象：" + label + "。別の版に切り替える");
  for (const input of settingsElements.platformInputs) input.checked = input.value === settingsPlatform;
  for (const item of document.querySelectorAll('#siteMenu :is([data-page="record"], [data-page="mypage"], [data-page="target"])')) {
    item.dataset.href = item.dataset.page + ".html?platform=" + settingsPlatform;
  }
}

async function settingsSelectPlatform(platform) {
  if (settingsBusy || !Object.hasOwn(settingsPlatformLabels, platform)) return;
  if (platform === settingsPlatform && settingsDatabase) return;
  settingsSyncPlatform();
  settingsSetBusy(true);
  window.cpiStatusToast?.hide();
  settingsSetMessage("");
  try {
    const database = await settingsOpenDatabase(platform);
    const records = settingsGetValidRecords(await settingsReadAll(database));
    settingsDatabase = database;
    settingsPlatform = platform;
    settingsUpdateCount(records);
    try { window.localStorage.setItem(settingsPlatformKey, platform); } catch { /* Optional persistence. */ }
    const url = new URL(window.location.href);
    if (url.searchParams.has("platform") && url.searchParams.get("platform") !== platform) {
      url.searchParams.set("platform", platform);
      window.history.replaceState(null, "", url.href);
    }
  } catch (error) {
    settingsSetMessage(error.message || "管理対象のデータを読み込めませんでした。", true);
    if (!settingsDatabase) settingsElements.recordCount.textContent = "保存件数を取得できませんでした。";
  } finally {
    settingsSyncPlatform();
    settingsSetBusy(false);
  }
}

function settingsValidateBackup(payload) {
  if (!payload || typeof payload !== "object"
    || payload.format !== settingsBackupFormat
    || ![1, 2, 3, 4, settingsBackupVersion].includes(payload.version)
    || !Array.isArray(payload.records)) {
    throw new Error("対応していないバックアップ形式です。");
  }
  const platform = payload.version >= 5 ? payload.platform : "ac";
  if (!Object.hasOwn(settingsPlatformLabels, platform)) {
    throw new Error("バックアップの版情報が不正です。");
  }
  if (payload.records.length > settingsMaxRecords) {
    throw new Error("記録件数が多すぎます。");
  }

  const chartIds = new Set();
  const records = payload.records.map((record, index) => {
    const chartId = String(record?.chartId ?? "").trim();
    if (!/^\d+$/.test(chartId) || chartId.length > 32) {
      throw new Error("バックアップの" + (index + 1) + "件目の譜面IDが不正です。");
    }
    if (!settingsStatusValues.has(record?.status)) {
      throw new Error("バックアップの" + (index + 1) + "件目のステータスが不正です。");
    }
    if (chartIds.has(chartId)) {
      throw new Error("同じ譜面IDが重複しています。");
    }
    chartIds.add(chartId);
    return {
      chartId,
      status: record.status,
      updatedAt: settingsGetRecordUpdatedAt(record),
      ...(record.historyBackfillExcluded === true ? { historyBackfillExcluded: true } : {}),
    };
  });

  const rawManualMemos = payload.version >= 2 ? (payload.manualMemos ?? []) : [];
  if (!Array.isArray(rawManualMemos) || rawManualMemos.length > settingsMaxRecords) {
    throw new Error("手動メモ件数が多すぎます。");
  }
  const manualMemoIds = new Set();
  const manualMemos = rawManualMemos.map((memo, index) => {
    const chartId = String(memo?.chartId ?? "").trim();
    if (!settingsIsValidManualMemo(memo)) {
      throw new Error("バックアップの手動メモ" + (index + 1) + "件目の譜面IDが不正です。");
    }
    if (manualMemoIds.has(chartId)) {
      throw new Error("手動メモの譜面IDが重複しています。");
    }
    manualMemoIds.add(chartId);
    return {
      chartId,
      updatedAt: typeof memo.updatedAt === "string" && memo.updatedAt.length <= 100
        ? memo.updatedAt
        : new Date().toISOString(),
    };
  });

  const extra = payload.version >= 3 ? window.cpiBackupData.validateExtra({ ...payload, platform }) : {};
  return { records, manualMemos, platform, version: payload.version, ...extra };
}
async function settingsHandleExport() {
  if (settingsBusy) {
    return;
  }

  settingsSetBusy(true);
  try {
    settingsDatabase = await settingsOpenDatabase();
    const snapshot = await settingsReadBackupSnapshot(true);
    const records = settingsGetValidRecords(snapshot.records);
    const manualMemos = settingsGetValidManualMemos(snapshot.manualMemos);
    const payload = {
      format: settingsBackupFormat,
      version: settingsBackupVersion,
      platform: settingsPlatform,
      exportedAt: new Date().toISOString(),
      records,
      manualMemos,
      updateHistory: snapshot.updateHistory,
      dailyTargets: snapshot.dailyTargets,
      optionMemos: snapshot.optionMemos,
    };
    settingsValidateBackup(payload);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    if (blob.size > settingsMaxBackupBytes) throw new Error("バックアップが上限の10MBを超えています。エクスポートを中止しました。");
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    link.href = downloadUrl;
    link.download = "cpi-next-clear-status-" + settingsPlatform + "-" + date + ".json";
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    settingsUpdateCount(records);
    settingsSetMessage("データをエクスポートしました。");
    window.cpiAnalytics?.track("data_export", {
      record_count: records.length,
      manual_memo_count: manualMemos.length,
    });
  } catch (error) {
    settingsSetMessage(error.message || "データをエクスポートできませんでした。", true);
  } finally {
    settingsSetBusy(false);
  }
}

async function settingsHandleImport(event) {
  const file = event.target.files?.[0];
  const destination = settingsImportPlatform ?? settingsPlatform;
  settingsImportPlatform = null;
  event.target.value = "";
  if (!file || settingsBusy) {
    return;
  }
  if (file.size > settingsMaxBackupBytes) {
    settingsSetMessage("バックアップファイルが大きすぎます。", true);
    return;
  }

  if (destination !== settingsPlatform) {
    settingsSetMessage("管理する版が変わりました。ファイルを選び直してください。", true);
    return;
  }
  settingsSetBusy(true);
  try {
    const payload = JSON.parse(await file.text());
    const backup = settingsValidateBackup(payload);
    if (backup.platform !== destination) {
      throw new Error("このバックアップは" + settingsPlatformLabels[backup.platform] + "版です。管理対象を切り替えてからインポートしてください。");
    }
    const label = settingsPlatformLabels[destination];
    const affected = ["クリアランプ記録"];
    if (backup.version >= 2) affected.push("手動メモ");
    if (backup.version >= 3) affected.push("今日の10曲", "更新履歴");
    const shared = Array.isArray(backup.optionMemos) ? "AC／INFINITAS共通のオプションメモも置き換えます。" : "";
    if (!window.confirm(label + "版の" + affected.join("、") + "を、このバックアップで置き換えます。" + shared + "よろしいですか？")) return;
    settingsDatabase = await settingsOpenDatabase();
    const previousSnapshot = await settingsReadBackupSnapshot(Boolean(shared));
    const previousRecords = settingsGetValidRecords(previousSnapshot.records);
    const previousManualMemos = settingsGetValidManualMemos(previousSnapshot.manualMemos);
    await settingsWriteBackup(
      backup.records,
      backup.version >= 2 ? backup.manualMemos : undefined,
      settingsBuildStatusChanges(previousRecords, backup.records),
      "backup-import",
      backup.version >= 3 ? backup : null,
      previousSnapshot,
    );
    settingsUpdateCount(backup.records);
    settingsSetMessage("データをインポートしました。");
    window.cpiStatusToast?.show({
      onUndo: async () => {
        if (settingsBusy || settingsPlatform !== destination) throw new Error("この版ではインポートを元に戻せません。");
        settingsSetBusy(true);
        try {
          settingsDatabase = await settingsOpenDatabase(destination);
          await settingsWriteBackup(
            previousRecords,
            previousManualMemos,
            settingsBuildStatusChanges(backup.records, previousRecords, { useUpdatedAt: false }),
            "backup-undo",
            previousSnapshot,
            backup,
          );
          settingsUpdateCount(previousRecords);
          settingsSetMessage("インポートを元に戻しました。");
        } finally {
          settingsSetBusy(false);
        }
      },
    });
    window.cpiAnalytics?.track("data_import", {
      record_count: backup.records.length,
      manual_memo_count: backup.manualMemos.length,
    });
  } catch (error) {
    settingsSetMessage(error.message || "データをインポートできませんでした。", true);
  } finally {
    settingsSetBusy(false);
  }
}

async function settingsHandleReset() {
  if (settingsBusy || !window.confirm(settingsPlatformLabels[settingsPlatform] + "版のクリアランプ記録、今日の10曲、更新履歴を削除します。手動メモ・オプションメモは保持されます。よろしいですか？")) {
    return;
  }

  settingsSetBusy(true);
  try {
    settingsDatabase = await settingsOpenDatabase();
    await settingsClearAll();
    settingsUpdateCount([]);
    settingsSetMessage("クリアランプ記録と更新履歴をリセットしました。");
    window.cpiAnalytics?.track("data_reset");
  } catch (error) {
    settingsSetMessage(error.message || "データをリセットできませんでした。", true);
  } finally {
    settingsSetBusy(false);
  }
}

function settingsBindEvents() {
  settingsElements.platformBadge.addEventListener("click", () => { void settingsSelectPlatform(settingsPlatform === "ac" ? "inf" : "ac"); });
  for (const input of settingsElements.platformInputs) {
    input.addEventListener("change", () => { if (input.checked) void settingsSelectPlatform(input.value); });
  }
  settingsElements.exportButton.addEventListener("click", settingsHandleExport);
  settingsElements.importButton.addEventListener("click", () => {
    if (!settingsBusy) {
      settingsImportPlatform = settingsPlatform;
      settingsElements.importInput.click();
    }
  });
  settingsElements.importInput.addEventListener("change", settingsHandleImport);
  settingsElements.resetButton.addEventListener("click", settingsHandleReset);
}

async function settingsInitialize() {
  settingsElements.exportButton = document.getElementById("settingsExportButton");
  settingsElements.importButton = document.getElementById("settingsImportButton");
  settingsElements.importInput = document.getElementById("settingsImportInput");
  settingsElements.resetButton = document.getElementById("settingsResetButton");
  settingsElements.recordCount = document.getElementById("settingsRecordCount");
  settingsElements.message = document.getElementById("settingsMessage");
  settingsElements.platformBadge = document.getElementById("settingsPlatformBadge");
  settingsElements.platformPicker = document.getElementById("settingsPlatformPicker");
  settingsElements.platformInputs = settingsElements.platformPicker.querySelectorAll('input[name="settingsPlatform"]');
  settingsBindEvents();

  const explicit = new URLSearchParams(window.location.search).get("platform");
  if (explicit === "ac" || explicit === "inf") {
    settingsPlatform = explicit;
  } else {
    try { if (window.localStorage.getItem(settingsPlatformKey) === "inf") settingsPlatform = "inf"; }
    catch { /* Optional persistence. */ }
  }
  await settingsSelectPlatform(settingsPlatform);
}

document.addEventListener("DOMContentLoaded", settingsInitialize);
