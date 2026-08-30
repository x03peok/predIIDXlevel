"use strict";

const settingsDatabaseName = "cpi-next-clear-status";
const settingsDatabaseVersion = 1;
const settingsStoreName = "chart-statuses";
const settingsBackupFormat = "cpi-next-clear-status-backup";
const settingsBackupVersion = 1;
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

function settingsSetMessage(message, isError = false) {
  settingsElements.message.textContent = message;
  settingsElements.message.dataset.state = isError ? "error" : "ok";
}

function settingsOpenDatabase() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("このブラウザではローカル保存を利用できません。"));
      return;
    }

    const request = window.indexedDB.open(settingsDatabaseName, settingsDatabaseVersion);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(settingsStoreName)) {
        database.createObjectStore(settingsStoreName, { keyPath: "chartId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("ローカル保存を開けませんでした。"));
  });
}

function settingsReadAll() {
  return new Promise((resolve, reject) => {
    if (!settingsDatabase) {
      reject(new Error("ローカル保存を開けませんでした。"));
      return;
    }

    const transaction = settingsDatabase.transaction(settingsStoreName, "readonly");
    const request = transaction.objectStore(settingsStoreName).getAll();
    request.onsuccess = () => resolve(request.result ?? []);
    request.onerror = () => reject(request.error ?? new Error("記録を読み込めませんでした。"));
  });
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
      updatedAt: typeof record.updatedAt === "string" && record.updatedAt.length <= 100
        ? record.updatedAt
        : new Date().toISOString(),
    }));
}

function settingsWriteAll(records) {
  return new Promise((resolve, reject) => {
    if (!settingsDatabase) {
      reject(new Error("ローカル保存を開けませんでした。"));
      return;
    }

    const transaction = settingsDatabase.transaction(settingsStoreName, "readwrite");
    const store = transaction.objectStore(settingsStoreName);
    store.clear();
    for (const record of records) {
      store.put(record);
    }
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error ?? new Error("データを保存できませんでした。"));
    transaction.onabort = () => reject(transaction.error ?? new Error("データを保存できませんでした。"));
  });
}

function settingsClearAll() {
  return settingsWriteAll([]);
}

function settingsUpdateCount(records) {
  settingsElements.recordCount.textContent = "保存: " + records.length.toLocaleString() + "譜面";
}

function settingsSetBusy(busy) {
  settingsBusy = busy;
  settingsElements.exportButton.disabled = busy;
  settingsElements.importButton.disabled = busy;
  settingsElements.resetButton.disabled = busy;
}

function settingsValidateBackup(payload) {
  if (!payload || typeof payload !== "object"
    || payload.format !== settingsBackupFormat
    || payload.version !== settingsBackupVersion
    || !Array.isArray(payload.records)) {
    throw new Error("対応していないバックアップ形式です。");
  }
  if (payload.records.length > settingsMaxRecords) {
    throw new Error("記録件数が多すぎます。");
  }

  const chartIds = new Set();
  return payload.records.map((record, index) => {
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
      updatedAt: typeof record.updatedAt === "string" && record.updatedAt.length <= 100
        ? record.updatedAt
        : new Date().toISOString(),
    };
  });
}

async function settingsHandleExport() {
  if (settingsBusy) {
    return;
  }

  settingsSetBusy(true);
  try {
    const records = settingsGetValidRecords(await settingsReadAll());
    const payload = {
      format: settingsBackupFormat,
      version: settingsBackupVersion,
      exportedAt: new Date().toISOString(),
      records,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    link.href = downloadUrl;
    link.download = "cpi-next-clear-status-" + date + ".json";
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    settingsUpdateCount(records);
    settingsSetMessage("データをエクスポートしました。");
  } catch (error) {
    settingsSetMessage(error.message || "データをエクスポートできませんでした。", true);
  } finally {
    settingsSetBusy(false);
  }
}

async function settingsHandleImport(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file || settingsBusy) {
    return;
  }
  if (file.size > settingsMaxBackupBytes) {
    settingsSetMessage("バックアップファイルが大きすぎます。", true);
    return;
  }

  let records;
  try {
    const payload = JSON.parse(await file.text());
    records = settingsValidateBackup(payload);
  } catch (error) {
    settingsSetMessage(error.message || "バックアップを読み込めませんでした。", true);
    return;
  }

  if (!window.confirm("現在のクリアランプ記録を、このバックアップで置き換えます。よろしいですか？")) {
    return;
  }

  settingsSetBusy(true);
  try {
    await settingsWriteAll(records);
    settingsUpdateCount(records);
    settingsSetMessage("データをインポートしました。");
  } catch (error) {
    settingsSetMessage(error.message || "データをインポートできませんでした。", true);
  } finally {
    settingsSetBusy(false);
  }
}

async function settingsHandleReset() {
  if (settingsBusy || !window.confirm("保存されているクリアランプ記録をすべて削除します。よろしいですか？")) {
    return;
  }

  settingsSetBusy(true);
  try {
    await settingsClearAll();
    settingsUpdateCount([]);
    settingsSetMessage("全データをリセットしました。");
  } catch (error) {
    settingsSetMessage(error.message || "データをリセットできませんでした。", true);
  } finally {
    settingsSetBusy(false);
  }
}

function settingsBindEvents() {
  settingsElements.exportButton.addEventListener("click", settingsHandleExport);
  settingsElements.importButton.addEventListener("click", () => {
    if (!settingsBusy) {
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
  settingsBindEvents();

  try {
    settingsDatabase = await settingsOpenDatabase();
    settingsUpdateCount(settingsGetValidRecords(await settingsReadAll()));
  } catch (error) {
    settingsSetMessage(error.message || "設定ページを初期化できませんでした。", true);
    settingsSetBusy(true);
  }
}

document.addEventListener("DOMContentLoaded", settingsInitialize);