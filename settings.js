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
const settingsRecommendationLevelValues = [8, 9, 10, 11, 12];
const settingsRecommendationLevelOptions = settingsRecommendationLevelValues.map((value) => ({
  value,
  label: "☆" + value,
}));
const settingsRecommendationCountValues = [5, 10, 20];
const settingsDefaultRecommendationStatuses = ["unregistered", "no-play", "failed", "assisted", "easy"];

const settingsElements = {};
let settingsDatabase = null;
let settingsBusy = false;
let settingsRecommendationSettings = settingsGetDefaultRecommendationSettings();

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

function settingsWriteAll(records, manualMemos) {
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
  settingsElements.recommendationSaveButton.disabled = busy;
  settingsElements.recommendationResetButton.disabled = busy;
}

function settingsGetDefaultRecommendationSettings() {
  return {
    probabilityMin: 40,
    probabilityMax: 60,
    count: 10,
    levels: [...settingsRecommendationLevelValues],
    statuses: [...settingsDefaultRecommendationStatuses],
  };
}

function settingsNormalizeRecommendationProbability(value, fallback) {
  const numeric = Number(value);
  return Number.isInteger(numeric)
    ? Math.min(100, Math.max(0, numeric))
    : fallback;
}

function settingsNormalizeRecommendationCount(value, fallback) {
  const numeric = Number(value);
  return settingsRecommendationCountValues.includes(numeric) ? numeric : fallback;
}

function settingsReadRecommendationSettings() {
  const fallback = settingsGetDefaultRecommendationSettings();
  try {
    const parsed = JSON.parse(window.localStorage?.getItem(settingsRecommendationSettingsKey) ?? "null");
    if (Array.isArray(parsed)) {
      return {
        ...fallback,
        statuses: [...new Set(parsed.filter((value) => settingsRecommendationStatusValues.has(value)))],
      };
    }
    if (!parsed || typeof parsed !== "object") {
      return fallback;
    }

    let probabilityMin = settingsNormalizeRecommendationProbability(
      parsed.probabilityMin,
      fallback.probabilityMin,
    );
    let probabilityMax = settingsNormalizeRecommendationProbability(
      parsed.probabilityMax,
      fallback.probabilityMax,
    );
    const count = settingsNormalizeRecommendationCount(parsed.count, fallback.count);
    if (probabilityMin > probabilityMax) {
      [probabilityMin, probabilityMax] = [probabilityMax, probabilityMin];
    }

    const levels = Array.isArray(parsed.levels)
      ? [...new Set(parsed.levels
        .map((value) => Number(value))
        .filter((value) => settingsRecommendationLevelValues.includes(value)))]
      : [...fallback.levels];
    const statuses = Array.isArray(parsed.statuses)
      ? [...new Set(parsed.statuses.filter((value) => settingsRecommendationStatusValues.has(value)))]
      : [...fallback.statuses];
    return { probabilityMin, probabilityMax, count, levels, statuses };
  } catch (error) {
    // Fall back to the default when local storage is unavailable or invalid.
  }
  return fallback;
}

function settingsSaveRecommendationSettings() {
  const payload = {
    probabilityMin: settingsRecommendationSettings.probabilityMin,
    probabilityMax: settingsRecommendationSettings.probabilityMax,
    count: settingsRecommendationSettings.count,
    levels: [...settingsRecommendationSettings.levels],
    statuses: [...settingsRecommendationSettings.statuses],
  };
  try {
    window.localStorage?.setItem(settingsRecommendationSettingsKey, JSON.stringify(payload));
  } catch (error) {
    settingsSetMessage("自動リコメンド設定を保存できませんでした。", true);
    return;
  }
  settingsSetMessage("自動リコメンド設定を保存しました。");
}

function settingsAreAllRecommendationValuesSelected(selectedValues, options) {
  return selectedValues.size === options.length
    && options.every(({ value }) => selectedValues.has(value));
}

function settingsUpdateRecommendationSummary(summary, selectedValues, options) {
  if (settingsAreAllRecommendationValuesSelected(selectedValues, options)) {
    summary.textContent = "all";
    summary.title = "";
    return;
  }
  if (selectedValues.size === 0) {
    summary.textContent = "none";
    summary.title = "";
    return;
  }
  const labels = options
    .filter(({ value }) => selectedValues.has(value))
    .map(({ label }) => label);
  summary.textContent = labels.length === 1 ? labels[0] : labels.length + " selected";
  summary.title = labels.join(", ");
}

function settingsRenderRecommendationFilter({ container, summary, options, settingKey }) {
  const values = options.map(({ value }) => value);
  const selectedValues = new Set(settingsRecommendationSettings[settingKey]);
  const convertValue = (value) => typeof values[0] === "number" ? Number(value) : value;

  const syncCheckboxes = () => {
    const allInput = container.querySelector("input[data-filter-all]");
    if (allInput) {
      allInput.checked = settingsAreAllRecommendationValuesSelected(selectedValues, options);
    }
    container.querySelectorAll("input[data-filter-option]").forEach((input) => {
      input.checked = selectedValues.has(convertValue(input.value));
    });
    settingsUpdateRecommendationSummary(summary, selectedValues, options);
  };

  const fragment = document.createDocumentFragment();
  const allLabel = document.createElement("label");
  allLabel.className = "multi-filter__option multi-filter__option--all";
  const allInput = document.createElement("input");
  allInput.type = "checkbox";
  allInput.dataset.filterAll = "true";
  const allText = document.createElement("span");
  allText.textContent = "all";
  allLabel.append(allInput, allText);
  fragment.append(allLabel);

  for (const option of options) {
    const label = document.createElement("label");
    label.className = "multi-filter__option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.dataset.filterOption = "true";
    input.value = String(option.value);
    const text = document.createElement("span");
    text.textContent = option.label;
    label.append(input, text);
    fragment.append(label);
  }
  container.replaceChildren(fragment);
  syncCheckboxes();

  allInput.addEventListener("change", () => {
    selectedValues.clear();
    if (allInput.checked) {
      values.forEach((value) => selectedValues.add(value));
    }
    settingsRecommendationSettings[settingKey] = [...selectedValues];
    syncCheckboxes();
  });
  container.querySelectorAll("input[data-filter-option]").forEach((input) => {
    input.addEventListener("change", () => {
      selectedValues.clear();
      container.querySelectorAll("input[data-filter-option]:checked").forEach((checkedInput) => {
        selectedValues.add(convertValue(checkedInput.value));
      });
      settingsRecommendationSettings[settingKey] = [...selectedValues];
      syncCheckboxes();
    });
  });
}

function settingsUpdateRecommendationInputs() {
  settingsElements.recommendationProbabilityMin.value = String(settingsRecommendationSettings.probabilityMin);
  settingsElements.recommendationProbabilityMax.value = String(settingsRecommendationSettings.probabilityMax);
  settingsElements.recommendationCount.value = String(settingsRecommendationSettings.count);
}

function settingsRenderRecommendationOptions() {
  settingsRecommendationSettings = settingsReadRecommendationSettings();
  settingsUpdateRecommendationInputs();
  settingsRenderRecommendationFilter({
    container: settingsElements.recommendationLevelOptions,
    summary: settingsElements.recommendationLevelSummary,
    options: settingsRecommendationLevelOptions,
    settingKey: "levels",
  });
  settingsRenderRecommendationFilter({
    container: settingsElements.recommendationStatusOptions,
    summary: settingsElements.recommendationStatusSummary,
    options: settingsRecommendationStatuses,
    settingKey: "statuses",
  });
}

function settingsReadRecommendationProbability(input, fallback) {
  const rawValue = String(input.value ?? "").trim();
  if (!rawValue) {
    return fallback;
  }
  return settingsNormalizeRecommendationProbability(rawValue, fallback);
}

function settingsCommitRecommendationProbability(changedKey) {
  let probabilityMin = settingsReadRecommendationProbability(
    settingsElements.recommendationProbabilityMin,
    settingsRecommendationSettings.probabilityMin,
  );
  let probabilityMax = settingsReadRecommendationProbability(
    settingsElements.recommendationProbabilityMax,
    settingsRecommendationSettings.probabilityMax,
  );
  if (probabilityMin > probabilityMax) {
    if (changedKey === "min") {
      probabilityMax = probabilityMin;
    } else {
      probabilityMin = probabilityMax;
    }
  }
  settingsRecommendationSettings.probabilityMin = probabilityMin;
  settingsRecommendationSettings.probabilityMax = probabilityMax;
  settingsUpdateRecommendationInputs();
}

function settingsCommitRecommendationCount() {
  const count = settingsNormalizeRecommendationCount(
    settingsElements.recommendationCount.value,
    settingsRecommendationSettings.count,
  );
  settingsRecommendationSettings.count = count;
  settingsUpdateRecommendationInputs();
}

function settingsCommitRecommendationSettings() {
  let probabilityMin = settingsReadRecommendationProbability(
    settingsElements.recommendationProbabilityMin,
    settingsRecommendationSettings.probabilityMin,
  );
  let probabilityMax = settingsReadRecommendationProbability(
    settingsElements.recommendationProbabilityMax,
    settingsRecommendationSettings.probabilityMax,
  );
  if (probabilityMin > probabilityMax) {
    [probabilityMin, probabilityMax] = [probabilityMax, probabilityMin];
  }
  settingsRecommendationSettings.probabilityMin = probabilityMin;
  settingsRecommendationSettings.probabilityMax = probabilityMax;
  settingsRecommendationSettings.count = settingsNormalizeRecommendationCount(
    settingsElements.recommendationCount.value,
    settingsRecommendationSettings.count,
  );
  settingsUpdateRecommendationInputs();
  settingsSaveRecommendationSettings();
}

function settingsResetRecommendationSettings() {
  settingsRecommendationSettings = settingsGetDefaultRecommendationSettings();
  settingsUpdateRecommendationInputs();
  settingsRenderRecommendationFilter({
    container: settingsElements.recommendationLevelOptions,
    summary: settingsElements.recommendationLevelSummary,
    options: settingsRecommendationLevelOptions,
    settingKey: "levels",
  });
  settingsRenderRecommendationFilter({
    container: settingsElements.recommendationStatusOptions,
    summary: settingsElements.recommendationStatusSummary,
    options: settingsRecommendationStatuses,
    settingKey: "statuses",
  });
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

  return { records, manualMemos, version: payload.version };
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

  const importConfirmation = backup.version >= 2
    ? "現在のクリアランプ記録と手動メモを、このバックアップで置き換えます。よろしいですか？"
    : "現在のクリアランプ記録を、このバックアップで置き換えます。手動メモは保持されます。";
  if (!window.confirm(importConfirmation)) {
    return;
  }

  settingsSetBusy(true);
  try {
    await settingsWriteAll(
      backup.records,
      backup.version >= 2 ? backup.manualMemos : undefined,
    );
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
  if (settingsBusy || !window.confirm("保存されているクリアランプ記録のみを削除します。手動メモは保持されます。よろしいですか？")) {
    return;
  }

  settingsSetBusy(true);
  try {
    await settingsClearAll();
    settingsUpdateCount([]);
    settingsSetMessage("クリアランプ記録をリセットしました。");
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
  settingsElements.recommendationProbabilityMin.addEventListener("change", () => {
    settingsCommitRecommendationProbability("min");
  });
  settingsElements.recommendationProbabilityMax.addEventListener("change", () => {
    settingsCommitRecommendationProbability("max");
  });
  settingsElements.recommendationCount.addEventListener("change", settingsCommitRecommendationCount);
  settingsElements.recommendationSaveButton.addEventListener("click", settingsCommitRecommendationSettings);
  settingsElements.recommendationResetButton.addEventListener("click", settingsResetRecommendationSettings);
}

async function settingsInitialize() {
  settingsElements.exportButton = document.getElementById("settingsExportButton");
  settingsElements.importButton = document.getElementById("settingsImportButton");
  settingsElements.importInput = document.getElementById("settingsImportInput");
  settingsElements.resetButton = document.getElementById("settingsResetButton");
  settingsElements.recordCount = document.getElementById("settingsRecordCount");
  settingsElements.message = document.getElementById("settingsMessage");
  settingsElements.recommendationProbabilityMin = document.getElementById("settingsRecommendationProbabilityMin");
  settingsElements.recommendationProbabilityMax = document.getElementById("settingsRecommendationProbabilityMax");
  settingsElements.recommendationCount = document.getElementById("settingsRecommendationCount");
  settingsElements.recommendationLevelOptions = document.getElementById("settingsRecommendationLevelOptions");
  settingsElements.recommendationLevelSummary = document.getElementById("settingsRecommendationLevelSummary");
  settingsElements.recommendationStatusOptions = document.getElementById("settingsRecommendationStatusOptions");
  settingsElements.recommendationStatusSummary = document.getElementById("settingsRecommendationStatusSummary");
  settingsElements.recommendationSaveButton = document.getElementById("settingsRecommendationSaveButton");
  settingsElements.recommendationResetButton = document.getElementById("settingsRecommendationResetButton");
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
