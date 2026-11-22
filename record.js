"use strict";

const recordDbName = "cpi-next-clear-status";
const recordDbVersion = 5;
const recordStoreName = "chart-statuses";
const recordManualMemoStoreName = "manual-targets";
const recordDailyTargetsStoreName = "daily-targets";
const recordUpdateHistoryStoreName = "status-update-events";
const recordPageSize = 100;
const recordDifficultyLabels = {
  NORMAL: "N",
  HYPER: "H",
  ANOTHER: "A",
  LEGGENDARIA: "L",
};
const recordDifficultyValues = {
  N: "NORMAL",
  H: "HYPER",
  A: "ANOTHER",
  L: "LEGGENDARIA",
};
const recordDifficultyClasses = {
  NORMAL: "difficulty--normal",
  HYPER: "difficulty--hyper",
  ANOTHER: "difficulty--another",
  LEGGENDARIA: "difficulty--leggendaria",
};
const recordStatuses = [
  { value: "unregistered", label: "未登録" },
  { value: "unowned", label: "未所持・未解禁" },
  { value: "no-play", label: "NO PLAY" },
  { value: "failed", label: "FAILED" },
  { value: "assisted", label: "ASSISTED" },
  { value: "easy", label: "EASY" },
  { value: "clear", label: "CLEAR" },
  { value: "hard", label: "HARD以上" },
];
const recordStatusValues = new Set(recordStatuses.map(({ value }) => value));
const recordImportDifficulties = ["NORMAL", "HYPER", "ANOTHER", "LEGGENDARIA"];
const recordImportMinimumLevel = 8;
const recordPlatformKey = "cpi-next-record-platform";
const recordPlatformLabels = { ac: "AC", inf: "INFINITAS" };
let recordImportIndex = null;

const recordState = {
  platform: "ac",
  busy: false,
  reconnect: false,
  rows: [],
  rowsByChartId: new Map(),
  records: new Map(),
  query: "",
  statusFilter: recordStatuses
    .filter(({ value }) => value !== "unowned")
    .map(({ value }) => value),
  levelFilter: null,
  difficultyFilter: null,
  sortKey: "title",
  sortDir: "asc",
  visibleLimit: recordPageSize,
  importFile: null,
  importFileWarning: "",
  importText: "",
  db: null,
};

const recordElements = {};
let recordEntityDecoder;

function recordParseCsv(text, { strict = false } = {}) {
  if (!text) {
    return [];
  }
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  let quoteClosed = false;
  const invalidFormat = message => new Error(message + " 公式CSVファイルを選び直してください。");

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inQuotes) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        inQuotes = false;
        quoteClosed = true;
      } else {
        cell += character;
      }
      continue;
    }

    if (strict && quoteClosed && character !== "," && character !== "\r" && character !== "\n") {
      throw invalidFormat("CSVの引用符の後に余分な文字があります。");
    }
    // Official exports can include literal quotes inside unquoted fields.
    if (character === '"' && (!strict || cell === "")) {
      inQuotes = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
      quoteClosed = false;
    } else if (character === "\r" || character === "\n") {
      if (character === "\r" && text[index + 1] === "\n") {
        index += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      quoteClosed = false;
    } else {
      cell += character;
    }
  }

  if (strict && inQuotes) throw invalidFormat("CSVの引用符が閉じていません。");
  row.push(cell);
  rows.push(row);
  if (rows.length > 1 && rows.at(-1).length === 1 && rows.at(-1)[0] === "") {
    rows.pop();
  }
  return rows;
}

function recordNormalizeImportText(value) {
  return recordNormalizeTitle(value)
    .normalize("NFKC")
    .replace(/\u3000/g, " ")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/[〜～]/g, "~")
    .replace(/\s+/g, "")
    .toUpperCase();
}
function recordBuildImportIndex(rows, aliases = window.__RECORD_IMPORT_INDEX__) {
  const separator = String.fromCharCode(0);
  const byId = new Map(rows.map(row => [String(row.chartId), row]));
  const entries = new Map();
  const titleDifficulties = new Map();
  function add(title, version, difficulty, chartId) {
    const row = byId.get(String(chartId));
    if (!row || row.difficulty !== difficulty || !title) return;
    const key = [title, version, difficulty].join(separator);
    if (!entries.has(key)) entries.set(key, new Set());
    entries.get(key).add(String(chartId));
    const plainKey = [title, difficulty].join(separator);
    if (!titleDifficulties.has(plainKey)) titleDifficulties.set(plainKey, new Set());
    titleDifficulties.get(plainKey).add(String(chartId));
  }
  for (const row of rows) {
    const version = recordNormalizeImportText(row.officialVersion);
    for (const title of new Set([row.officialTitle, row.title])) {
      add(recordNormalizeImportText(title), version, row.difficulty, row.chartId);
    }
  }
  // Keep legacy aliases, but never let them register charts removed from the dataset.
  for (const [key, values] of Object.entries(aliases?.plain ?? {})) {
    const [title, difficulty] = key.split(separator);
    for (const id of Array.isArray(values) ? values : [values]) {
      add(title, recordNormalizeImportText(byId.get(String(id))?.officialVersion), difficulty, id);
    }
  }
  for (const [key, values] of Object.entries(aliases?.versioned ?? {})) {
    const [title, version, difficulty] = key.split(separator);
    for (const id of Array.isArray(values) ? values : [values]) add(title, version, difficulty, id);
  }
  const collisionTitles = new Set([...titleDifficulties]
    .filter(([, ids]) => ids.size > 1).map(([key]) => key.split(separator)[0]));
  const plain = Object.create(null);
  const versioned = Object.create(null);
  for (const [key, ids] of entries) {
    const [title, , difficulty] = key.split(separator);
    if (collisionTitles.has(title)) versioned[key] = [...ids];
    else plain[[title, difficulty].join(separator)] = [...ids];
  }
  return { collisionTitles, plain, versioned };
}

function recordGetImportChartIds(title, version, difficulty, { includeAmbiguous = false } = {}) {
  if (!recordImportIndex) return [];
  const titleKey = recordNormalizeImportText(title);
  const difficultyKey = String(difficulty ?? "").trim().toUpperCase();
  const versionKey = recordNormalizeImportText(version);
  const separator = String.fromCharCode(0);
  const isCollision = recordImportIndex.collisionTitles.has(titleKey);
  const key = isCollision ? [titleKey, versionKey, difficultyKey].join(separator) : [titleKey, difficultyKey].join(separator);
  const source = isCollision ? recordImportIndex.versioned : recordImportIndex.plain;
  const values = source?.[key];
  if (Array.isArray(values)) return values;
  if (values) return [values];
  if (!isCollision) return [];

  // A title can be marked as colliding only because another difficulty uses it.
  // Fall back to the unique title+difficulty match, but keep same-difficulty
  // collisions (for example Shooting Star [A]) unresolved.
  const fallbackIds = new Set();
  for (const [versionedKey, chartIds] of Object.entries(recordImportIndex.versioned ?? {})) {
    const [candidateTitle, , candidateDifficulty] = versionedKey.split(separator);
    if (candidateTitle !== titleKey || candidateDifficulty !== difficultyKey) {
      continue;
    }
    for (const chartId of Array.isArray(chartIds) ? chartIds : [chartIds]) {
      fallbackIds.add(chartId);
    }
  }
  return includeAmbiguous || fallbackIds.size === 1 ? [...fallbackIds] : [];
}
function recordMapImportClearType(clearType) {
  const value = String(clearType ?? "").trim().toUpperCase();
  if (!value || value === "---") return null;
  if (value === "NO PLAY") return "no-play";
  if (value === "FAILED") return "failed";
  if (value.includes("ASSIST")) return "assisted";
  if (value.includes("EASY")) return "easy";
  if (value === "CLEAR") return "clear";
  if (value.includes("HARD") || value.includes("FULLCOMBO")) return "hard";
  return undefined;
}
function recordGetHistorySnapshot(chartId) {
  const row = recordState.rowsByChartId.get(String(chartId ?? ""));
  return row ? {
    title: row.title,
    difficulty: row.difficulty,
    level: row.level,
  } : undefined;
}

function recordWriteStatuses(statuses, options = {}) {
  return new Promise((resolve, reject) => {
    if (!recordState.db) {
      reject(new Error("ローカル保存を開けませんでした."));
      return;
    }
    const csvMissingIds = options.csvMissingIds;
    const beforeStatuses = options.beforeStatuses instanceof Map ? options.beforeStatuses : null;
    const recordHistory = options.recordHistory !== false;
    const source = String(options.source ?? "record");
    const hasHistory = Boolean(
      recordHistory
      && window.cpiUpdateHistory
      && recordState.db.objectStoreNames.contains(recordUpdateHistoryStoreName),
    );
    const stores = hasHistory
      ? [recordStoreName, recordUpdateHistoryStoreName]
      : [recordStoreName];
    const transaction = recordState.db.transaction(stores, "readwrite");
    const store = transaction.objectStore(recordStoreName);
    const updatedAt = new Date().toISOString();
    let changes = [];
    let existingRecords;
    let csvUnownedCount = 0;
    const apply = (records) => {
      existingRecords = records;
      const updates = new Map(statuses);
      for (const chartId of csvMissingIds ?? []) {
        if (!updates.has(chartId) && (records.get(chartId)?.status ?? "unregistered") === "unregistered") {
          updates.set(chartId, "unowned");
          csvUnownedCount += 1;
        }
      }
      changes = [...updates].map(([chartId, status]) => {
        const normalizedChartId = String(chartId);
        const existingRecord = records.get(normalizedChartId);
        const beforeStatus = beforeStatuses?.get(normalizedChartId)
          ?? existingRecord?.status
          ?? "unregistered";
        const afterStatus = String(status ?? "").trim().toLowerCase();
        return {
          chartId: normalizedChartId,
          beforeStatus,
          afterStatus,
          changed: beforeStatus !== afterStatus,
          existingRecord,
          snapshot: recordGetHistorySnapshot(normalizedChartId),
        };
      });
      for (const change of changes) {
        if (!change.changed && change.existingRecord) {
          if (
            options.recordHistory === false
            && change.existingRecord.historyBackfillExcluded !== true
          ) {
            store.put({ ...change.existingRecord, historyBackfillExcluded: true });
          }
          continue;
        }
        if (change.afterStatus === "unregistered") {
          store.delete(change.chartId);
          continue;
        }
        const nextRecord = {
          ...(change.existingRecord ?? {}),
          chartId: change.chartId,
          status: change.afterStatus,
        };
        if (change.changed || !change.existingRecord) {
          nextRecord.updatedAt = updatedAt;
        }
        if (options.recordHistory === false) {
          nextRecord.historyBackfillExcluded = true;
        }
        store.put(nextRecord);
      }
      if (hasHistory) {
        window.cpiUpdateHistory.appendToTransaction(
          transaction,
          changes.filter(change => change.changed),
          { source, changedAt: updatedAt, reconcileReverts: options.reconcileReverts === true },
        );
      }
    };
    transaction.oncomplete = () => {
      resolve({ changes, existingRecords, csvUnownedCount });
      for (const change of changes) {
        if (!change.changed) continue;
        window.dispatchEvent(new CustomEvent("cpi:status-changed", {
          detail: { source: "record", chartId: change.chartId, status: change.afterStatus },
        }));
      }
    };
    transaction.onerror = () => reject(transaction.error ?? new Error("記録を保存できませんでした。"));
    transaction.onabort = () => reject(transaction.error ?? new Error("記録を保存できませんでした。"));
    const write = (records) => {
      try {
        apply(records);
      } catch (error) {
        reject(error);
        transaction.abort();
      }
    };
    if (csvMissingIds) {
      // Check for records added in other tabs in the same transaction as the CSV write.
      const request = store.getAll();
      request.onsuccess = () => write(new Map(request.result.map(record => [String(record.chartId), record])));
    } else {
      write(recordState.records);
    }
  });
}
function recordGetCsvPlatform(headers) {
  const has = (suffix) => recordImportDifficulties.some((difficulty) => headers.has(difficulty + suffix));
  const ac = has(" 難易度");
  const inf = has(" 最終スコア更新時刻") && has(" 最終プレー日時");
  return ac === inf ? null : ac ? "ac" : "inf";
}

function recordParseOfficialCsv(text, platform) {
  const parsed = recordParseCsv(text, { strict: true });
  if (!parsed.length) throw new Error("CSVが空です。");
  const headers = parsed.shift().map((header) => header.trim());
  const headerIndex = new Map(headers.map((header, index) => [header, index]));
  const csvPlatform = recordGetCsvPlatform(headerIndex);
  // INFINITAS can have a trailing comma on the header but not on the data rows.
  const optionalTrailingColumn = csvPlatform === "inf" && headers.at(-1) === "";
  for (const [index, row] of parsed.entries()) {
    if (row.length === 1 && row[0].trim() === "") continue;
    const expectedWidth = optionalTrailingColumn ? headers.length - 1 : headers.length;
    const hasOptionalBlank = optionalTrailingColumn && row.length === headers.length && row.at(-1).trim() === "";
    if (row.length !== expectedWidth && !hasOptionalBlank) {
      throw new Error("CSVのデータ" + (index + 1) + "行目の列数が見出しと一致しません。公式CSVファイルを選び直してください。");
    }
  }
  if (!headerIndex.has("バージョン") || !headerIndex.has("タイトル")) throw new Error("公式CSVの列を確認できませんでした。");
  if (platform) {
    if (!csvPlatform) throw new Error("CSVがAC版かINFINITAS版か判別できません。公式のSP CSVを選択してください。");
    if (csvPlatform !== platform) {
      throw new Error("このCSVは" + recordPlatformLabels[csvPlatform] + "版です。登録先を" + recordPlatformLabels[csvPlatform] + "に切り替えてから、再度インポートしてください。");
    }
  }
  const availableDifficulties = recordImportDifficulties.filter((difficulty) => headerIndex.has(difficulty + " クリアタイプ"));
  if (!availableDifficulties.length) throw new Error("対応するクリアタイプ列がありません。");
  const get = (cells, key) => (cells[headerIndex.get(key)] ?? "").trim();
  const updates = new Map();
  const presentIds = new Set();
  let matched = 0;
  let unmatched = 0;
  let ambiguous = 0;
  let unsupported = 0;
  let duplicate = 0;
  for (const cells of parsed) {
    const title = get(cells, "タイトル");
    if (!title) continue;
    const version = get(cells, "バージョン");
    for (const difficulty of availableDifficulties) {
      const status = recordMapImportClearType(get(cells, difficulty + " クリアタイプ"));
      const csvLevel = Number(get(cells, difficulty + " 難易度"));
      if (status === null && !(csvLevel > 0)) continue;
      const countAsUnmatched = platform === "inf" || (Number.isFinite(csvLevel) && csvLevel >= recordImportMinimumLevel);
      const chartIds = recordGetImportChartIds(title, version, difficulty);
      for (const id of chartIds.length ? chartIds : recordGetImportChartIds(title, version, difficulty, { includeAmbiguous: true })) {
        presentIds.add(id);
      }
      if (status === null) continue;
      if (status === undefined) { unsupported += 1; continue; }
      if (chartIds.length === 0) {
        if (countAsUnmatched) unmatched += 1;
        continue;
      }
      if (chartIds.length !== 1) { ambiguous += 1; continue; }
      if (updates.has(chartIds[0])) duplicate += 1;
      updates.set(chartIds[0], status);
      matched += 1;
    }
  }
  return { updates, presentIds, availableDifficulties, matched, unmatched, ambiguous, unsupported, duplicate };
}

function recordGetCsvMissingChartIds(rows, { presentIds, availableDifficulties }) {
  const difficulties = new Set(availableDifficulties);
  return rows.filter(row => difficulties.has(row.difficulty) && !presentIds.has(row.chartId))
    .map(row => row.chartId);
}

function recordGetMissingPreviousCsvRows(rows, previousIds, presentIds) {
  return rows.filter(row => previousIds.has(row.chartId) && !presentIds.has(row.chartId))
    .sort((left, right) => recordCompareTitles(left, right));
}

function recordReadCsvSnapshot(key) {
  try {
    const ids = JSON.parse(window.localStorage.getItem(key));
    if (Array.isArray(ids)) return new Set(ids.filter(id => typeof id === "string" && /^\d+$/.test(id)));
  } catch { /* The CSV can still be imported if storage is unavailable. */ }
  return new Set();
}

function recordConfirmCsvImport(missingRows, unownedCount) {
  const dialog = document.getElementById("recordCsvConfirm");
  const title = dialog.querySelector("h2");
  const list = dialog.querySelector("ul");
  const note = dialog.querySelector("p");
  const option = dialog.querySelector("label");
  const checkbox = option.querySelector("input");
  title.textContent = missingRows.length
    ? "以下の" + missingRows.length.toLocaleString() + "譜面が見つかりません。取り込みを実行しますか？"
    : "CSVテキストを取り込みますか？";
  list.replaceChildren(...missingRows.map(row => {
    const item = document.createElement("li");
    const difficulty = recordDifficultyLabels[row.difficulty] ?? row.difficulty;
    item.textContent = row.title + " [" + difficulty + "]";
    return item;
  }));
  list.hidden = !missingRows.length;
  note.textContent = missingRows.length
    ? "前回のCSVにあった譜面です。公式での配信終了などでも表示されます。取り込む場合は、今回のCSVにあるランプだけを保存します。"
    : "初期状態では、CSVにあるランプだけを保存します。";
  option.hidden = !unownedCount;
  checkbox.checked = false;
  option.querySelector("span").textContent = "CSVにない未登録の" + unownedCount.toLocaleString() + "譜面を「未所持・未解禁」にする";
  dialog.returnValue = "";
  dialog.showModal();
  return new Promise(resolve => dialog.addEventListener("close", () => {
    resolve({ confirmed: dialog.returnValue === "import", markUnowned: !option.hidden && checkbox.checked });
  }, { once: true }));
}
function recordSetCsvMessage(message, isError = false, isWarning = false) {
  if (!recordElements.csvMessage) return;
  recordElements.csvMessage.textContent = message;
  recordElements.csvMessage.dataset.state = isError ? "error" : isWarning ? "warning" : "ok";
}
function recordHideCsvImportLinks() {
  if (recordElements.csvImportLinks) recordElements.csvImportLinks.hidden = true;
}
function recordGetCsvFileNotice(file) {
  const fileName = String(file?.name ?? "").trim();
  if (/_DP_score(?:\s*\(\d+\))?\.csv$/i.test(fileName)) {
    return {
      allowed: false,
      warning: false,
      message: "DPのCSVは登録できません。SPの公式CSVを選択してください。",
    };
  }
  if (/_SP_score(?:\s*\(\d+\))?\.csv$/i.test(fileName)) {
    return {
      allowed: true,
      warning: false,
      message: "",
    };
  }
  return {
    allowed: true,
    warning: true,
    message: "ファイル名からSP/DPを確認できません。SPの公式CSVか確認してから登録してください。",
  };
}
function recordHasCsvImportSource() {
  return Boolean(recordState.importFile || recordState.importText.trim());
}
function recordSyncCsvImportButton() {
  if (recordElements.csvImportButton) {
    recordElements.csvImportButton.disabled = recordState.busy || !recordHasCsvImportSource() || !recordState.db;
  }
}
function recordHandleCsvFileChange() {
  const file = recordElements.csvInput.files?.[0] ?? null;
  recordHideCsvImportLinks();
  recordState.importFileWarning = "";
  recordState.importFile = null;
  if (file) {
    recordState.importText = "";
    if (recordElements.csvText) recordElements.csvText.value = "";
    const notice = recordGetCsvFileNotice(file);
    if (!notice.allowed) {
      recordElements.csvInput.value = "";
      recordSetCsvMessage(notice.message, true);
      recordSyncCsvImportButton();
      return;
    }
    recordState.importFile = file;
    recordState.importFileWarning = notice.warning ? notice.message : "";
    recordSetCsvMessage(notice.message, false, notice.warning);
  } else if (recordState.importText.trim()) {
    recordSetCsvMessage("CSVテキストを入力しました。", false, true);
  } else {
    recordSetCsvMessage("");
  }
  recordSyncCsvImportButton();
}
function recordHandleCsvTextInput() {
  recordState.importText = recordElements.csvText.value;
  recordState.importFileWarning = "";
  recordHideCsvImportLinks();
  if (recordState.importText.trim()) {
    recordState.importFile = null;
    if (recordElements.csvInput) recordElements.csvInput.value = "";
    recordSetCsvMessage("CSVテキストを入力しました。", false, true);
  } else if (recordState.importFile) {
    const notice = recordGetCsvFileNotice(recordState.importFile);
    recordState.importFileWarning = notice.warning ? notice.message : "";
    recordSetCsvMessage(notice.message, false, notice.warning);
  } else {
    recordSetCsvMessage("");
  }
  recordSyncCsvImportButton();
}
async function recordHandleCsvImport() {
  const file = recordState.importFile;
  const pastedText = recordState.importText;
  const fileWarning = recordState.importFileWarning;
  const showImportCta = recordState.records.size === 0;
  if (recordState.busy || !recordState.db || (!file && !pastedText.trim())) return;
  const platform = recordState.platform;
  recordSetBusy(true);
  recordHideCsvImportLinks();
  recordElements.csvInput.disabled = true;
  recordElements.csvText.disabled = true;
  recordElements.csvImportButton.disabled = true;
  recordSetCsvMessage("CSVを読み込んでいます。");
  try {
    const isPaste = Boolean(pastedText.trim());
    const csvText = isPaste ? pastedText : await file.text();
    const result = recordParseOfficialCsv(csvText, platform);
    if (!result.updates.size) {
      const skipped = result.unmatched + result.ambiguous;
      throw new Error("登録できる譜面が見つかりませんでした。" + (skipped ? " 照合できない譜面: " + skipped.toLocaleString() + "件。" : ""));
    }
    const snapshotKey = "cpi-next-record-csv-chart-ids-" + platform;
    const previousCsvIds = recordReadCsvSnapshot(snapshotKey);
    const missingRows = recordGetMissingPreviousCsvRows(recordState.rows, previousCsvIds, result.presentIds);
    let csvMissingIds = missingRows.length ? [] : recordGetCsvMissingChartIds(recordState.rows, result);
    const markUnownedByDefault = !isPaste && !missingRows.length;
    if (!markUnownedByDefault) {
      // Match the preview to the records currently saved, not a potentially stale tab.
      if (csvMissingIds.length) {
        const records = new Map((await recordReadAll()).map(record => [String(record.chartId), record.status]));
        csvMissingIds = csvMissingIds.filter(id => (records.get(id) ?? "unregistered") === "unregistered");
      }
      if (missingRows.length || csvMissingIds.length) {
        const decision = await recordConfirmCsvImport(missingRows, csvMissingIds.length);
        if (!decision.confirmed) {
          recordSetCsvMessage("CSVの取り込みをキャンセルしました。");
          return;
        }
        if (!decision.markUnowned) csvMissingIds = [];
      }
    }
    const { changes, existingRecords, csvUnownedCount } = await recordWriteStatuses(result.updates, {
      recordHistory: !showImportCta,
      source: "csv-import",
      csvMissingIds,
    });
    if (!missingRows.length) {
      try { window.localStorage.setItem(snapshotKey, JSON.stringify([...result.presentIds])); } catch { /* Optional persistence. */ }
    }
    const previousStatuses = new Map();
    const importedStatuses = new Map();
    recordApplyRecords([...existingRecords.values()]);
    window.cpiRecommendationCache?.invalidate(platform);
    for (const { chartId, beforeStatus, afterStatus: status, changed } of changes) {
      if (!changed) continue;
      previousStatuses.set(chartId, beforeStatus);
      importedStatuses.set(chartId, status);
      const previousRecord = recordState.records.get(chartId);
      if (previousRecord?.status === status) {
        continue;
      }
      if (status === "unregistered") {
        recordState.records.delete(chartId);
      } else {
        recordState.records.set(chartId, {
          ...(previousRecord ?? {}),
          chartId,
          status,
          updatedAt: new Date().toISOString(),
        });
      }
    }
    recordRender();
    let message = recordPlatformLabels[platform] + "に" + result.updates.size.toLocaleString() + "譜面を登録しました。";
    if (csvUnownedCount) message += " CSVにない未登録譜面 " + csvUnownedCount.toLocaleString() + "件を未所持・未解禁にしました。";
    if (result.unmatched) message += " 対応しない譜面 " + result.unmatched.toLocaleString() + "件は変更していません。";
    if (result.ambiguous) message += " 判別できない譜面 " + result.ambiguous.toLocaleString() + "件は変更していません。";
    if (fileWarning) message += " " + fileWarning;
    recordSetCsvMessage(message, false, Boolean(fileWarning));
    window.cpiStatusToast?.show({
      onUndo: recordWrapUndo(async () => {
        await recordWriteStatuses(previousStatuses, {
          source: "csv-undo",
          beforeStatuses: importedStatuses,
        });
        for (const [chartId, status] of previousStatuses) {
          const currentRecord = recordState.records.get(chartId);
          if (currentRecord?.status === status) {
            continue;
          }
          if (status === "unregistered") {
            recordState.records.delete(chartId);
          } else {
            recordState.records.set(chartId, {
              ...(currentRecord ?? {}),
              chartId,
              status,
              updatedAt: new Date().toISOString(),
            });
          }
        }
        recordRender();
        recordSetCsvMessage("CSV登録を元に戻しました。", false);
      }),
    });
    if (showImportCta && recordElements.csvImportLinks) recordElements.csvImportLinks.hidden = false;
    if (!showImportCta) {
      window.location.assign("mypage.html?tab=history&platform=" + platform);
    }
  } catch (error) {
    recordHideCsvImportLinks();
    recordSetCsvMessage(error.message || "CSVをインポートできませんでした。", true);
  } finally {
    recordElements.csvInput.disabled = false;
    recordElements.csvText.disabled = false;
    recordSetBusy(false);
  }
}
function recordDecodeEntities(value) {
  recordEntityDecoder.innerHTML = String(value ?? "");
  return recordEntityDecoder.value;
}

function recordNormalizeTitle(value) {
  const decoded = recordDecodeEntities(value);
  const stripped = decoded.replace(/<\/?[A-Za-z][^>]*>/g, "");
  return recordDecodeEntities(stripped);
}

function recordEscapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[character]));
}

function recordLoadRows(platform = "ac") {
  const csvText = window.__CSV_BUNDLE__;
  if (typeof csvText !== "string") {
    throw new Error("データを読み込めませんでした。");
  }

  const parsed = recordParseCsv(csvText);
  if (!parsed.length) {
    throw new Error("譜面データが空です。");
  }

  const headers = parsed.shift().map((header) => header.trim());
  const headerIndex = new Map(headers.map((header, index) => [header, index]));
  const requiredHeaders = [
    "chart_id",
    "title",
    "difficulty",
    "original_level",
  ];
  for (const header of requiredHeaders) {
    if (!headerIndex.has(header)) {
      throw new Error("必要な列がありません: " + header);
    }
  }

  return parsed.map((cells, index) => {
    const get = (key) => (cells[headerIndex.get(key)] ?? "").trim();
    return {
      __order: index,
      chartId: get("chart_id"),
      title: recordNormalizeTitle(get("title")),
      officialTitle: recordNormalizeTitle(get("official_title") || get("title")),
      officialVersion: get("official_version"),
      difficulty: get("difficulty").toUpperCase(),
      level: get("original_level"),
      platforms: get("platforms").toLowerCase().split("|"),
    };
  }).filter((row) => /^\d+$/.test(row.chartId) && (row.platforms[0] === "" || row.platforms.includes(platform)));
}


function recordOpenDatabase(platform = recordState.platform) {
  return window.cpiStorage.open(platform);
}

function recordReadAll(database = recordState.db) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(recordStoreName, "readonly");
    const request = transaction.objectStore(recordStoreName).getAll();
    request.onsuccess = () => resolve(request.result ?? []);
    request.onerror = () => reject(request.error ?? new Error("記録を読み込めませんでした。"));
  });
}

function recordWriteStatus(chartId, status, options = {}) {
  return recordWriteStatuses(new Map([[String(chartId), status]]), {
    reconcileReverts: true,
    ...options,
  });
}

function recordApplyRecords(records) {
  recordState.records = new Map();
  for (const record of records) {
    if (/^\d+$/.test(String(record.chartId)) && recordStatusValues.has(record.status)) {
      recordState.records.set(String(record.chartId), record);
    }
  }
}

function recordGetLevelOptions() {
  const levels = new Set();
  for (const row of recordState.rows) {
    if (row.level) {
      levels.add(row.level);
    }
  }
  return [...levels]
    .sort((left, right) => Number(left) - Number(right))
    .map((level) => ({ value: level, label: "☆" + level }));
}

function recordGetDifficultyOptions() {
  return ["N", "H", "A", "L"].map((value) => ({
    value,
    label: "[" + value + "] " + recordDifficultyValues[value],
  }));
}

function recordAreAllValuesSelected(selected, options) {
  const values = options.map((option) => option.value);
  return selected.length === values.length
    && values.every((value) => selected.includes(value));
}

function recordUpdateFilterSummary(summary, selected, options) {
  if (recordAreAllValuesSelected(selected, options)) {
    summary.textContent = "all";
    summary.title = "";
    return;
  }
  if (selected.length === 0) {
    summary.textContent = "none";
    summary.title = "";
    return;
  }

  const labels = selected.map((value) => {
    const option = options.find((item) => item.value === value);
    return option?.label ?? value;
  });
  summary.textContent = labels.length === 1 ? labels[0] : labels.length + " selected";
  summary.title = labels.join(", ");
}

function recordFillMultiFilter(stateKey, options, summary, container) {
  const values = options.map((option) => option.value);
  const current = Array.isArray(recordState[stateKey])
    ? recordState[stateKey]
    : values;
  recordState[stateKey] = values.filter((value) => current.includes(value));

  const syncCheckboxes = () => {
    const selectedValues = new Set(recordState[stateKey]);
    const allCheckbox = container.querySelector("input[data-filter-all]");
    if (allCheckbox) {
      allCheckbox.checked = recordAreAllValuesSelected(recordState[stateKey], options);
    }
    container.querySelectorAll("input[data-filter-option]").forEach((checkbox) => {
      checkbox.checked = selectedValues.has(checkbox.value);
    });
  };

  const notifyChange = () => {
    recordUpdateFilterSummary(summary, recordState[stateKey], options);
    recordState.visibleLimit = recordPageSize;
    recordRender();
  };

  const fragment = document.createDocumentFragment();
  const allLabel = document.createElement("label");
  allLabel.className = "multi-filter__option multi-filter__option--all";
  const allCheckbox = document.createElement("input");
  allCheckbox.type = "checkbox";
  allCheckbox.dataset.filterAll = "true";
  const allText = document.createElement("span");
  allText.textContent = "all";
  allLabel.append(allCheckbox, allText);
  allCheckbox.addEventListener("change", () => {
    recordState[stateKey] = allCheckbox.checked ? [...values] : [];
    syncCheckboxes();
    notifyChange();
  });
  fragment.append(allLabel);

  for (const option of options) {
    const label = document.createElement("label");
    label.className = "multi-filter__option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.filterOption = "true";
    checkbox.value = option.value;
    const text = document.createElement("span");
    text.textContent = option.label;
    label.append(checkbox, text);
    checkbox.addEventListener("change", () => {
      recordState[stateKey] = [...container.querySelectorAll("input[data-filter-option]:checked")]
        .map((input) => input.value);
      syncCheckboxes();
      notifyChange();
    });
    fragment.append(label);
  }

  container.replaceChildren(fragment);
  syncCheckboxes();
  recordUpdateFilterSummary(summary, recordState[stateKey], options);
}

function recordSetupFilterDetails() {
  const closeOtherFilterDetails = (activeDetails) => {
    document.querySelectorAll(".record-filter-details").forEach((details) => {
      if (details !== activeDetails) {
        details.open = false;
      }
    });
  };

  document.querySelectorAll(".record-filter-details").forEach((details) => {
    details.addEventListener("toggle", () => {
      if (details.open) {
        closeOtherFilterDetails(details);
      }
    });
  });

  document.addEventListener("pointerdown", (event) => {
    const target = event.target instanceof Element
      ? event.target
      : event.target?.parentElement;
    if (target?.closest("summary")) {
      return;
    }
    closeOtherFilterDetails(target?.closest(".record-filter-details") ?? null);
  });
}
function recordSetupTabs() {
  const manualTab = document.getElementById("recordManualTab");
  const csvTab = document.getElementById("recordCsvTab");
  const manualPanel = document.getElementById("recordManualPanel");
  const csvPanel = document.getElementById("recordCsvPanel");
  if (!manualTab || !csvTab || !manualPanel || !csvPanel) {
    return;
  }

  const setActiveTab = (mode) => {
    const isCsv = mode === "csv";
    manualTab.classList.toggle("is-active", !isCsv);
    csvTab.classList.toggle("is-active", isCsv);
    manualTab.setAttribute("aria-selected", String(!isCsv));
    csvTab.setAttribute("aria-selected", String(isCsv));
    manualPanel.hidden = isCsv;
    csvPanel.hidden = !isCsv;
  };

  manualTab.addEventListener("click", () => setActiveTab("manual"));
  csvTab.addEventListener("click", () => setActiveTab("csv"));
  setActiveTab("manual");
}

function recordGetFilteredRows() {
  const query = recordState.query.trim().toLowerCase();
  let rows = recordState.rows;

  if (query) {
    rows = rows.filter((row) => row.title.toLowerCase().includes(query));
  }

  const selectedStatuses = recordState.statusFilter ?? [];
  if (selectedStatuses.length === 0) {
    return [];
  }
  if (!recordAreAllValuesSelected(selectedStatuses, recordStatuses)) {
    const selectedStatusSet = new Set(selectedStatuses);
    rows = rows.filter((row) => selectedStatusSet.has(recordGetStatus(row)));
  }

  const difficultyOptions = recordGetDifficultyOptions();
  const selectedDifficulties = recordState.difficultyFilter ?? [];
  if (selectedDifficulties.length === 0) {
    return [];
  }
  if (!recordAreAllValuesSelected(selectedDifficulties, difficultyOptions)) {
    const selectedDifficultySet = new Set(selectedDifficulties);
    rows = rows.filter((row) => {
      const difficultyValue = Object.entries(recordDifficultyValues)
        .find(([, difficulty]) => difficulty === row.difficulty)?.[0];
      return selectedDifficultySet.has(difficultyValue);
    });
  }

  const levelOptions = recordGetLevelOptions();
  const selectedLevels = recordState.levelFilter ?? [];
  if (selectedLevels.length === 0) {
    return [];
  }
  if (!recordAreAllValuesSelected(selectedLevels, levelOptions)) {
    const selectedLevelSet = new Set(selectedLevels);
    rows = rows.filter((row) => selectedLevelSet.has(row.level));
  }

  return rows.slice().sort((left, right) => {
    const comparison = recordCompareRows(left, right);
    if (comparison !== 0) {
      return recordState.sortDir === "asc" ? comparison : -comparison;
    }
    if (recordState.sortKey !== "title") {
      const titleComparison = recordCompareTitles(left, right);
      if (titleComparison !== 0) return titleComparison;
    }
    return left.__order - right.__order;
  });
}

function recordCompareRows(left, right) {
  if (recordState.sortKey === "status") {
    const leftRank = recordStatuses.findIndex(({ value }) => value === recordGetStatus(left));
    const rightRank = recordStatuses.findIndex(({ value }) => value === recordGetStatus(right));
    return leftRank - rightRank;
  }
  if (recordState.sortKey === "level") {
    return Number(left.level) - Number(right.level);
  }
  return recordCompareTitles(left, right);
}

function recordCompareTitles(left, right) {
  return String(left.title ?? "").localeCompare(String(right.title ?? ""), "en", {
    numeric: true,
    sensitivity: "base",
  });
}

function recordUpdateSortIndicators() {
  recordElements.table.querySelectorAll("thead button[data-sort-key]").forEach((button) => {
    const isActive = button.dataset.sortKey === recordState.sortKey;
    const mark = button.querySelector(".sort-mark");
    const heading = button.closest("th");
    if (mark) {
      mark.textContent = isActive ? (recordState.sortDir === "asc" ? "▲" : "▼") : "";
    }
    if (heading) {
      heading.setAttribute("aria-sort", isActive
        ? (recordState.sortDir === "asc" ? "ascending" : "descending")
        : "none");
    }
  });
}

function recordSetSort(key) {
  if (recordState.sortKey === key) {
    recordState.sortDir = recordState.sortDir === "asc" ? "desc" : "asc";
  } else {
    recordState.sortKey = key;
    recordState.sortDir = "asc";
  }
  recordState.visibleLimit = recordPageSize;
  recordRender();
}
function recordGetStatus(row) {
  return recordState.records.get(row.chartId)?.status ?? "unregistered";
}

function recordStatusOptions(selected) {
  return recordStatuses.map(({ value, label }) => (
    `<option value="${value}"${value === selected ? " selected" : ""}>${label}</option>`
  )).join("");
}

function recordUpdateStatusSelect(select) {
  select.dataset.status = select.value;
}

function recordGetMissingSavedCount() {
  let count = 0;
  for (const chartId of recordState.records.keys()) {
    if (!recordState.rowsByChartId.has(String(chartId))) count += 1;
  }
  return count;
}

function recordUpdateMissingDataMessage() {
  const message = recordElements.missingDataMessage;
  if (!message) return;
  const count = recordGetMissingSavedCount();
  message.hidden = count === 0;
  message.textContent = count === 0
    ? ""
    : "譜面データなし: " + count.toLocaleString() + "譜面。保存されたクリアランプは保持されていますが、現在の譜面データがないため、表の対象外です。";
}

function recordRender() {
  const filteredRows = recordGetFilteredRows();
  const visibleRows = filteredRows.slice(0, recordState.visibleLimit);
  recordElements.tableBody.innerHTML = visibleRows.map((row) => {
    const difficulty = recordDifficultyLabels[row.difficulty] ?? row.difficulty;
    const difficultyClass = recordDifficultyClasses[row.difficulty] ?? "";
    const status = recordGetStatus(row);
    const title = recordEscapeHtml(row.title);
    const chartId = recordEscapeHtml(row.chartId);
    const chartHref = "chart-pages/" + encodeURIComponent(row.chartId) + ".html"
      + (recordState.platform === "inf" ? "?platform=inf" : "");
    const titleLink = [
      '<a class="record-title-link ' + difficultyClass + '" href="' + chartHref + '">',
      "<span>" + title + "</span>",
      difficulty ? ' <span class="record-title-link__difficulty">[' + recordEscapeHtml(difficulty) + "]</span>" : "",
      "</a>",
    ].join("");
    return [
      "<tr>",
      "<td>" + recordEscapeHtml(row.level) + "</td>",
      "<td>" + titleLink + "</td>",
      '<td><select class="record-status-select" data-chart-id="' + chartId + '" aria-label="' + title + 'のクリア状況">' + recordStatusOptions(status) + "</select></td>",
      "</tr>",
    ].join("");
  }).join("");

  for (const select of recordElements.tableBody.querySelectorAll(".record-status-select")) {
    recordUpdateStatusSelect(select);
  }

  recordElements.summary.textContent =
    visibleRows.length.toLocaleString() + "件表示 / " +
    filteredRows.length.toLocaleString() + "件中　登録 " +
    recordState.records.size.toLocaleString() + "件";
  recordUpdateMissingDataMessage();
  recordElements.loadMore.hidden = visibleRows.length >= filteredRows.length;
  recordUpdateSortIndicators();
}

function recordPopulateFilters() {
  recordFillMultiFilter(
    "statusFilter",
    recordStatuses,
    recordElements.statusFilterSummary,
    recordElements.statusFilterOptions,
  );
  recordFillMultiFilter(
    "levelFilter",
    recordGetLevelOptions(),
    recordElements.levelFilterSummary,
    recordElements.levelFilterOptions,
  );
  recordFillMultiFilter(
    "difficultyFilter",
    recordGetDifficultyOptions(),
    recordElements.difficultyFilterSummary,
    recordElements.difficultyFilterOptions,
  );
}
function recordSetMessage(message, isError = false) {
  recordElements.message.textContent = message;
  recordElements.message.dataset.state = isError ? "error" : "ok";
}

function recordReadPlatform() {
  const explicit = new URLSearchParams(window.location.search).get("platform");
  if (explicit === "ac" || explicit === "inf") return explicit;
  try {
    if (window.localStorage.getItem(recordPlatformKey) === "inf") return "inf";
  } catch { /* The switch still works without localStorage. */ }
  return "ac";
}

function recordSyncPlatformControl() {
  const platform = recordState.platform;
  document.body.dataset.platform = platform;
  recordElements.platformPicker.dataset.platform = platform;
  recordElements.platformBadge.textContent = recordPlatformLabels[platform];
  const nextPlatform = platform === "inf" ? "ac" : "inf";
  recordElements.platformBadge.setAttribute("aria-label", "現在の登録先：" + recordPlatformLabels[platform] + "。" + recordPlatformLabels[nextPlatform] + "に切り替える");
  for (const input of recordElements.platformInputs) input.checked = input.value === platform;
  recordElements.csvImportButton.textContent = recordPlatformLabels[platform] + "版にインポート";
  for (const link of recordElements.csvImportLinks.querySelectorAll("[data-platform-href]")) {
    link.href = link.dataset.platformHref + "?platform=" + platform;
  }
  for (const item of document.querySelectorAll('#siteMenu :is([data-page="mypage"], [data-page="target"], [data-page="settings"])')) {
    item.dataset.href = item.dataset.page + ".html?platform=" + platform;
  }
}

function recordSetBusy(busy) {
  recordState.busy = busy;
  recordElements.tableBody.inert = busy || !recordState.db;
  recordElements.platformBadge.disabled = busy;
  for (const input of recordElements.platformInputs) input.disabled = busy;
  recordSyncCsvImportButton();
  if (!busy && recordState.reconnect) {
    recordState.reconnect = false;
    if (!recordState.db) void recordSelectPlatform(recordState.platform);
  }
}

function recordWrapUndo(undo) {
  const platform = recordState.platform;
  return async () => {
    if (platform !== recordState.platform || !recordState.db || recordState.busy) {
      throw new Error("現在の登録先では、この変更を元に戻せません。");
    }
    recordSetBusy(true);
    try { await undo(); } finally { recordSetBusy(false); }
  };
}

async function recordSelectPlatform(platform) {
  if (recordState.busy || !Object.hasOwn(recordPlatformLabels, platform)) return;
  if (platform === recordState.platform && recordState.db) return;
  recordSyncPlatformControl();
  recordSetBusy(true);
  window.cpiStatusToast?.hide();
  recordHideCsvImportLinks();
  recordSetMessage("");
  recordSetCsvMessage("");
  try {
    const rows = recordLoadRows(platform);
    const importIndex = recordBuildImportIndex(rows);
    const database = await recordOpenDatabase(platform);
    const records = await recordReadAll(database);
    recordState.platform = platform;
    recordState.db = database;
    recordState.rows = rows;
    recordState.rowsByChartId = new Map(rows.map(row => [row.chartId, row]));
    recordImportIndex = importIndex;
    recordApplyRecords(records);
    recordState.levelFilter = null;
    recordState.visibleLimit = recordPageSize;
    recordPopulateFilters();
    recordRender();
    try { window.localStorage.setItem(recordPlatformKey, platform); } catch { /* Optional persistence. */ }
    const url = new URL(window.location.href);
    if (url.searchParams.has("platform") && url.searchParams.get("platform") !== platform) {
      url.searchParams.set("platform", platform);
      window.history.replaceState(null, "", url.href);
    }
  } catch (error) {
    const message = error.message || "登録先を読み込めませんでした。";
    recordSetMessage(message, true);
    recordSetCsvMessage(message, true);
  } finally {
    recordSyncPlatformControl();
    recordSetBusy(false);
  }
}

async function recordHandleStatusChange(event) {
  const select = event.target.closest(".record-status-select");
  if (!select || recordState.busy || !recordState.db) {
    return;
  }
  const chartId = select.dataset.chartId;
  const previousStatus = recordState.records.get(chartId)?.status ?? "unregistered";
  const status = select.value;
  recordSetBusy(true);
  select.disabled = true;
  try {
    await recordWriteStatus(chartId, status);
    if (status === "unregistered") {
      recordState.records.delete(chartId);
    } else {
      recordState.records.set(chartId, { chartId, status, updatedAt: new Date().toISOString() });
    }
    recordUpdateStatusSelect(select);
    recordRender();
    recordSetMessage("記録を保存しました。");
    window.cpiStatusToast?.show({
      onUndo: recordWrapUndo(async () => {
        await recordWriteStatus(chartId, previousStatus);
        if (previousStatus === "unregistered") {
          recordState.records.delete(chartId);
        } else {
          recordState.records.set(chartId, {
            chartId,
            status: previousStatus,
            updatedAt: new Date().toISOString(),
          });
        }
        recordRender();
        recordSetMessage("記録を元に戻しました。");
      }),
    });
  } catch (error) {
    recordRender();
    recordSetMessage(error.message || "記録を保存できませんでした。", true);
  } finally {
    select.disabled = false;
    recordSetBusy(false);
  }
}

function recordBindEvents() {
  recordElements.platformBadge.addEventListener("click", () => {
    void recordSelectPlatform(recordState.platform === "inf" ? "ac" : "inf");
  });
  for (const input of recordElements.platformInputs) {
    input.addEventListener("change", () => { if (input.checked) void recordSelectPlatform(input.value); });
  }
  recordElements.table.querySelectorAll("thead button[data-sort-key]").forEach((button) => {
    button.addEventListener("click", () => recordSetSort(button.dataset.sortKey));
  });
  recordElements.search.addEventListener("input", () => {
    recordState.query = recordElements.search.value;
    recordState.visibleLimit = recordPageSize;
    recordRender();
  });
  recordElements.tableBody.addEventListener("change", recordHandleStatusChange);
  recordElements.loadMore.addEventListener("click", () => {
    recordState.visibleLimit += recordPageSize;
    recordRender();
  });
  recordElements.csvInput.addEventListener("change", recordHandleCsvFileChange);
  recordElements.csvText.addEventListener("input", recordHandleCsvTextInput);
  recordElements.csvImportButton.addEventListener("click", recordHandleCsvImport);
}
async function recordInitialize() {
  recordEntityDecoder = document.createElement("textarea");
  recordSetupTabs();
  recordSetupFilterDetails();
  recordElements.search = document.getElementById("recordSearchInput");
  recordElements.statusFilterSummary = document.getElementById("recordStatusFilterSummary");
  recordElements.statusFilterOptions = document.getElementById("recordStatusFilterOptions");
  recordElements.levelFilterSummary = document.getElementById("recordLevelFilterSummary");
  recordElements.levelFilterOptions = document.getElementById("recordLevelFilterOptions");
  recordElements.difficultyFilterSummary = document.getElementById("recordDifficultyFilterSummary");
  recordElements.difficultyFilterOptions = document.getElementById("recordDifficultyFilterOptions");
  recordElements.message = document.getElementById("recordMessage");
  recordElements.missingDataMessage = document.getElementById("recordMissingDataMessage");
  recordElements.summary = document.getElementById("recordSummary");
  recordElements.table = document.querySelector(".record-table");
  recordElements.tableBody = document.getElementById("recordTableBody");
  recordElements.loadMore = document.getElementById("recordLoadMoreButton");
  recordElements.csvInput = document.getElementById("recordCsvInput");
  recordElements.csvText = document.getElementById("recordCsvText");
  recordElements.csvImportButton = document.getElementById("recordCsvImportButton");
  recordElements.csvMessage = document.getElementById("recordCsvImportMessage");
  recordElements.csvImportLinks = document.getElementById("recordCsvImportLinks");

  recordElements.platformPicker = document.getElementById("recordPlatformPicker");
  recordElements.platformBadge = document.getElementById("recordPlatformBadge");
  recordElements.platformInputs = recordElements.platformPicker.querySelectorAll('input[name="recordPlatform"]');
  recordState.platform = recordReadPlatform();
  recordBindEvents();
  for (const platform of Object.keys(recordPlatformLabels)) {
    window.addEventListener("cpi:storage-versionchange" + (platform === "inf" ? "-inf" : ""), () => {
      if (recordState.platform !== platform) return;
      recordState.db = null;
      if (recordState.busy) recordState.reconnect = true;
      else void recordSelectPlatform(platform);
    });
  }
  await recordSelectPlatform(recordState.platform);
}

document.addEventListener("DOMContentLoaded", recordInitialize);
