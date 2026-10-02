"use strict";

const settingsDatabaseName = "cpi-next-clear-status";

const settingsStoreName = "chart-statuses";
const settingsManualMemoStoreName = "manual-targets";
const settingsDailyTargetsStoreName = "daily-targets";
const settingsUpdateHistoryStoreName = "status-update-events";
const settingsBackupFormat = "cpi-next-clear-status-backup";
const settingsBackupVersion = 3;
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
const settingsTargetGoalOptions = [
  { value: "easy", label: "EASY" },
  { value: "clear", label: "CLEAR" },
  { value: "hard", label: "HARD以上" },
];
const settingsTargetGoalValues = new Set(settingsTargetGoalOptions.map(({ value }) => value));
const settingsDefaultTargetGoals = settingsTargetGoalOptions.map(({ value }) => value);

const settingsElements = {};
let settingsDatabase = null;
let settingsBusy = false;
let settingsRecommendationSettings = settingsGetDefaultRecommendationSettings();

function settingsSetMessage(message, isError = false) {
  settingsElements.message.textContent = message;
  settingsElements.message.dataset.state = isError ? "error" : "ok";
}

function settingsOpenDatabase() {
  return window.cpiStorage.open();
}
window.addEventListener("cpi:storage-versionchange", () => {
  if (settingsDatabase) {
    settingsOpenDatabase().then(database => { settingsDatabase = database; }).catch(error => console.warn(error));
  }
});

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
      for (const [name, values] of [[settingsUpdateHistoryStoreName, snapshot.updateHistory], [settingsDailyTargetsStoreName, snapshot.dailyTargets]]) {
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
  return settingsWriteAll([]).then(() => new Promise((resolve, reject) => {
    const stores = [settingsDailyTargetsStoreName];
    const hasHistory = Boolean(
      window.cpiUpdateHistory
      && settingsDatabase.objectStoreNames.contains(settingsUpdateHistoryStoreName),
    );
    if (hasHistory) stores.push(settingsUpdateHistoryStoreName);
    const transaction = settingsDatabase.transaction(stores, "readwrite");
    transaction.objectStore(settingsDailyTargetsStoreName).clear();
    if (hasHistory) transaction.objectStore(settingsUpdateHistoryStoreName).clear();
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error ?? new Error("保存データを削除できませんでした。"));
    transaction.onabort = () => reject(transaction.error ?? new Error("保存データを削除できませんでした。"));
  }));
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

function settingsGetDefaultRecommendationSettings() {
  return {
    probabilityMin: 40,
    probabilityMax: 60,
    count: 10,
    levels: [...settingsRecommendationLevelValues],
    statuses: [...settingsDefaultRecommendationStatuses],
    targetGoals: [...settingsDefaultTargetGoals],
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
    const targetGoals = Array.isArray(parsed.targetGoals)
      ? [...new Set(parsed.targetGoals.filter((value) => settingsTargetGoalValues.has(value)))]
      : [...fallback.targetGoals];
    return { probabilityMin, probabilityMax, count, levels, statuses, targetGoals };
  } catch (error) {
    // Fall back to the default when local storage is unavailable or invalid.
  }
  return fallback;
}

function settingsSaveRecommendationSettings() {
  const savedSettings = settingsReadRecommendationSettings();
  const payload = {
    probabilityMin: settingsRecommendationSettings.probabilityMin,
    probabilityMax: settingsRecommendationSettings.probabilityMax,
    count: settingsRecommendationSettings.count,
    levels: [...settingsRecommendationSettings.levels],
    statuses: [...settingsRecommendationSettings.statuses],
    targetGoals: [...savedSettings.targetGoals],
  };
  try {
    window.localStorage?.setItem(settingsRecommendationSettingsKey, JSON.stringify(payload));
  } catch (error) {
    settingsSetMessage("自動リコメンド設定を保存できませんでした。", true);
    return;
  }
  settingsSetMessage("自動リコメンド設定を保存しました。");
}

function settingsSaveTargetSettings() {
  if (settingsRecommendationSettings.targetGoals.length === 0
    && !window.confirm("マイターゲットに曲が表示されなくなります。よろしいですか？")) {
    return;
  }
  const savedSettings = settingsReadRecommendationSettings();
  const payload = {
    probabilityMin: savedSettings.probabilityMin,
    probabilityMax: savedSettings.probabilityMax,
    count: savedSettings.count,
    levels: [...savedSettings.levels],
    statuses: [...savedSettings.statuses],
    targetGoals: [...settingsRecommendationSettings.targetGoals],
  };
  try {
    window.localStorage?.setItem(settingsRecommendationSettingsKey, JSON.stringify(payload));
  } catch (error) {
    settingsSetMessage("ターゲット設定を保存できませんでした。", true);
    return;
  }
  settingsSetMessage("ターゲット設定を保存しました。");
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

function settingsRenderTargetGoalOptions() {
  const selectedValues = new Set(settingsRecommendationSettings.targetGoals);
  const fragment = document.createDocumentFragment();
  for (const option of settingsTargetGoalOptions) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = option.value;
    input.checked = selectedValues.has(option.value);
    const text = document.createElement("span");
    text.textContent = option.label;
    label.append(input, text);
    fragment.append(label);
  }
  settingsElements.targetGoalOptions.replaceChildren(fragment);
  settingsElements.targetGoalOptions.querySelectorAll("input").forEach((input) => {
    input.addEventListener("change", () => {
      settingsRecommendationSettings.targetGoals = Array.from(
        settingsElements.targetGoalOptions.querySelectorAll("input:checked"),
        (checkedInput) => checkedInput.value,
      );
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
  settingsRenderTargetGoalOptions();
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
  const targetGoals = [...settingsRecommendationSettings.targetGoals];
  settingsRecommendationSettings = {
    ...settingsGetDefaultRecommendationSettings(),
    targetGoals,
  };
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

function settingsResetTargetSettings() {
  settingsRecommendationSettings.targetGoals = [...settingsDefaultTargetGoals];
  settingsRenderTargetGoalOptions();
}

function settingsValidateBackup(payload) {
  if (!payload || typeof payload !== "object"
    || payload.format !== settingsBackupFormat
    || ![1, 2, settingsBackupVersion].includes(payload.version)
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

  const extra = payload.version >= 3 ? window.cpiBackupData.validateExtra(payload) : {};
  return { records, manualMemos, version: payload.version, ...extra };
}
async function settingsHandleExport() {
  if (settingsBusy) {
    return;
  }

  settingsSetBusy(true);
  try {
    settingsDatabase = await settingsOpenDatabase();
    const snapshot = await window.cpiBackupData.readSnapshot(settingsDatabase);
    const records = settingsGetValidRecords(snapshot.records);
    const manualMemos = settingsGetValidManualMemos(snapshot.manualMemos);
    const payload = {
      format: settingsBackupFormat,
      version: settingsBackupVersion,
      exportedAt: new Date().toISOString(),
      records,
      manualMemos,
      updateHistory: snapshot.updateHistory,
      dailyTargets: snapshot.dailyTargets,
    };
    settingsValidateBackup(payload);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    if (blob.size > settingsMaxBackupBytes) throw new Error("バックアップが上限の10MBを超えています。エクスポートを中止しました。");
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

  const importConfirmation = backup.version >= 3
    ? "現在のクリアランプ記録、手動メモ、今日の10曲、更新履歴を、このバックアップで置き換えます。よろしいですか？"
    : backup.version >= 2
    ? "現在のクリアランプ記録と手動メモを、このバックアップで置き換えます。よろしいですか？"
    : "現在のクリアランプ記録を、このバックアップで置き換えます。手動メモは保持されます。";
  if (!window.confirm(importConfirmation)) {
    return;
  }

  settingsSetBusy(true);
  try {
    settingsDatabase = await settingsOpenDatabase();
    const previousSnapshot = await window.cpiBackupData.readSnapshot(settingsDatabase);
    const previousRecords = settingsGetValidRecords(previousSnapshot.records);
    const previousManualMemos = settingsGetValidManualMemos(previousSnapshot.manualMemos);
    await settingsWriteAll(
      backup.records,
      backup.version >= 2 ? backup.manualMemos : undefined,
      settingsBuildStatusChanges(previousRecords, backup.records),
      "backup-import",
      backup.version >= 3 ? backup : null,
    );
    settingsUpdateCount(backup.records);
    settingsSetMessage("データをインポートしました。");
    window.cpiStatusToast?.show({
      onUndo: async () => {
        settingsSetBusy(true);
        try {
          await settingsWriteAll(
            previousRecords,
            previousManualMemos,
            settingsBuildStatusChanges(backup.records, previousRecords, { useUpdatedAt: false }),
            "backup-undo",
            previousSnapshot,
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
  if (settingsBusy || !window.confirm("保存されているクリアランプ記録、今日の10曲、更新履歴を削除します。手動メモは保持されます。よろしいですか？")) {
    return;
  }

  settingsSetBusy(true);
  try {
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
  settingsElements.recommendationProbabilityMin = document.getElementById("settingsRecommendationProbabilityMin");
  settingsElements.recommendationProbabilityMax = document.getElementById("settingsRecommendationProbabilityMax");
  settingsElements.recommendationCount = document.getElementById("settingsRecommendationCount");
  settingsElements.recommendationLevelOptions = document.getElementById("settingsRecommendationLevelOptions");
  settingsElements.recommendationLevelSummary = document.getElementById("settingsRecommendationLevelSummary");
  settingsElements.recommendationStatusOptions = document.getElementById("settingsRecommendationStatusOptions");
  settingsElements.recommendationStatusSummary = document.getElementById("settingsRecommendationStatusSummary");
  settingsElements.recommendationSaveButton = document.getElementById("settingsRecommendationSaveButton");
  settingsElements.recommendationResetButton = document.getElementById("settingsRecommendationResetButton");
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
