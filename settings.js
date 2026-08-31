"use strict";

const settingsDatabaseName = "cpi-next-clear-status";
const settingsDatabaseVersion = 2;
const settingsStoreName = "chart-statuses";
const settingsManualMemoStoreName = "manual-targets";
const settingsBackupFormat = "cpi-next-clear-status-backup";
const settingsBackupVersion = 2;
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
const settingsRecommendationSettingsKey = "cpi-next-target-recommendation-statuses";
const settingsRecommendationStatuses = [
  { value: "unregistered", label: "未登録" },
  { value: "unowned", label: "未所持・未解禁" },
  { value: "no-play", label: "NO PLAY" },
  { value: "failed", label: "FAILED" },
  { value: "assisted", label: "ASSISTED" },
  { value: "easy", label: "EASY" },
  { value: "clear", label: "CLEAR" },
  { value: "hard", label: "HARD以上" },
];
const settingsRecommendationStatusValues = new Set(
  settingsRecommendationStatuses.map(({ value }) => value),
);
const settingsDefaultRecommendationStatuses = ["unregistered", "no-play", "failed", "assisted", "easy"];

const settingsElements = {};
let settingsDatabase = null;
let settingsBusy = false;
let settingsRecommendationSelection = new Set(settingsDefaultRecommendationStatuses);

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
      if (!database.objectStoreNames.contains(settingsManualMemoStoreName)) {
        database.createObjectStore(settingsManualMemoStoreName, { keyPath: "chartId" });
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

function settingsReadAllManualMemos() {
  return new Promise((resolve, reject) => {
    if (!settingsDatabase) {
      reject(new Error("ローカル保存を開けませんでした。"));
      return;
    }

    const transaction = settingsDatabase.transaction(settingsManualMemoStoreName, "readonly");
    const request = transaction.objectStore(settingsManualMemoStoreName).getAll();
    request.onsuccess = () => resolve(request.result ?? []);
    request.onerror = () => reject(request.error ?? new Error("手動メモを読み込めませんでした。"));
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

function settingsWriteAll(records, manualMemos = []) {
  return new Promise((resolve, reject) => {
    if (!settingsDatabase) {
      reject(new Error("ローカル保存を開けませんでした。"));
      return;
    }

    const transaction = settingsDatabase.transaction(
      [settingsStoreName, settingsManualMemoStoreName],
      "readwrite",
    );
    const store = transaction.objectStore(settingsStoreName);
    const manualMemoStore = transaction.objectStore(settingsManualMemoStoreName);
    store.clear();
    manualMemoStore.clear();
    for (const record of records) {
      store.put(record);
    }
    for (const memo of manualMemos) {
      manualMemoStore.put(memo);
    }
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error ?? new Error("データを保存できませんでした。"));
    transaction.onabort = () => reject(transaction.error ?? new Error("データを保存できませんでした。"));
  });
}

function settingsClearAll() {
  return settingsWriteAll([], []);
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

function settingsReadRecommendationStatuses() {
  try {
    const parsed = JSON.parse(window.localStorage?.getItem(settingsRecommendationSettingsKey) ?? "null");
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((value) => settingsRecommendationStatusValues.has(value)));
    }
  } catch (error) {
    // Fall back to the default when local storage is unavailable or invalid.
  }
  return new Set(settingsDefaultRecommendationStatuses);
}

function settingsSaveRecommendationStatuses() {
  const values = settingsRecommendationStatuses
    .map(({ value }) => value)
    .filter((value) => settingsRecommendationSelection.has(value));
  try {
    window.localStorage?.setItem(settingsRecommendationSettingsKey, JSON.stringify(values));
  } catch (error) {
    settingsSetMessage("自動リコメンド設定を保存できませんでした。", true);
    return;
  }
  settingsSetMessage("自動リコメンド設定を保存しました。");
}

function settingsUpdateRecommendationAllCheckbox() {
  const allInput = settingsElements.recommendationOptions.querySelector("input[data-recommendation-all]");
  if (!allInput) {
    return;
  }
  const selectedCount = settingsRecommendationSelection.size;
  const totalCount = settingsRecommendationStatuses.length;
  allInput.checked = selectedCount === totalCount;
  allInput.indeterminate = selectedCount > 0 && selectedCount < totalCount;
}

function settingsRenderRecommendationOptions() {
  const container = settingsElements.recommendationOptions;
  container.replaceChildren();
  settingsRecommendationSelection = settingsReadRecommendationStatuses();

  const allLabel = document.createElement("label");
  const allInput = document.createElement("input");
  allInput.type = "checkbox";
  allInput.dataset.recommendationAll = "true";
  allLabel.append(allInput, document.createTextNode("all"));
  container.append(allLabel);

  for (const { value, label } of settingsRecommendationStatuses) {
    const optionLabel = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = value;
    input.dataset.recommendationValue = value;
    input.checked = settingsRecommendationSelection.has(value);
    optionLabel.append(input, document.createTextNode(label));
    container.append(optionLabel);
  }

  allInput.addEventListener("change", () => {
    settingsRecommendationSelection = allInput.checked
      ? new Set(settingsRecommendationStatuses.map(({ value }) => value))
      : new Set();
    container.querySelectorAll("input[data-recommendation-value]").forEach((input) => {
      input.checked = settingsRecommendationSelection.has(input.value);
    });
    settingsSaveRecommendationStatuses();
    settingsUpdateRecommendationAllCheckbox();
  });
  container.querySelectorAll("input[data-recommendation-value]").forEach((input) => {
    input.addEventListener("change", () => {
      settingsRecommendationSelection = new Set(
        [...container.querySelectorAll("input[data-recommendation-value]:checked")]
          .map((checkedInput) => checkedInput.value),
      );
      settingsSaveRecommendationStatuses();
      settingsUpdateRecommendationAllCheckbox();
    });
  });
  settingsUpdateRecommendationAllCheckbox();
}

function settingsValidateBackup(payload) {
  if (!payload || typeof payload !== "object"
    || payload.format !== settingsBackupFormat
    || ![1, settingsBackupVersion].includes(payload.version)
    || !Array.isArray(payload.records)) {
    throw new Error("対応していないバックアップ形式です。");
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
      updatedAt: typeof record.updatedAt === "string" && record.updatedAt.length <= 100
        ? record.updatedAt
        : new Date().toISOString(),
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

  return { records, manualMemos };
}
async function settingsHandleExport() {
  if (settingsBusy) {
    return;
  }

  settingsSetBusy(true);
  try {
    const records = settingsGetValidRecords(await settingsReadAll());
    const manualMemos = settingsGetValidManualMemos(await settingsReadAllManualMemos());
    const payload = {
      format: settingsBackupFormat,
      version: settingsBackupVersion,
      exportedAt: new Date().toISOString(),
      records,
      manualMemos,
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
  event.target.value = "";
  if (!file || settingsBusy) {
    return;
  }
  if (file.size > settingsMaxBackupBytes) {
    settingsSetMessage("バックアップファイルが大きすぎます。", true);
    return;
  }

  let backup;
  try {
    const payload = JSON.parse(await file.text());
    backup = settingsValidateBackup(payload);
  } catch (error) {
    settingsSetMessage(error.message || "バックアップを読み込めませんでした。", true);
    return;
  }

  if (!window.confirm("現在のクリアランプ記録を、このバックアップで置き換えます。よろしいですか？")) {
    return;
  }

  settingsSetBusy(true);
  try {
    await settingsWriteAll(backup.records, backup.manualMemos);
    settingsUpdateCount(backup.records);
    settingsSetMessage("データをインポートしました。");
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
  if (settingsBusy || !window.confirm("保存されているクリアランプ記録をすべて削除します。よろしいですか？")) {
    return;
  }

  settingsSetBusy(true);
  try {
    await settingsClearAll();
    settingsUpdateCount([]);
    settingsSetMessage("全データをリセットしました。");
    window.cpiAnalytics?.track("data_reset");
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
  settingsElements.recommendationOptions = document.getElementById("settingsRecommendationStatusOptions");
  settingsRenderRecommendationOptions();
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