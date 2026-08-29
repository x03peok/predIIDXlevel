"use strict";

const recordDbName = "cpi-next-clear-status";
const recordDbVersion = 1;
const recordStoreName = "chart-statuses";
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
const recordStatuses = [
  { value: "unregistered", label: "未登録" },
  { value: "unowned", label: "未所持・未解禁" },
  { value: "no-play", label: "NO PLAY" },
  { value: "assisted", label: "ASSISTED" },
  { value: "easy", label: "EASY" },
  { value: "clear", label: "CLEAR" },
  { value: "hard", label: "HARD" },
];
const recordStatusValues = new Set(recordStatuses.map(({ value }) => value));

const recordState = {
  rows: [],
  records: new Map(),
  query: "",
  level: "all",
  difficulty: "all",
  status: "all",
  visibleLimit: recordPageSize,
  db: null,
};

const recordElements = {};
let recordEntityDecoder;

function recordParseCsv(text) {
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

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inQuotes) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        inQuotes = false;
      } else {
        cell += character;
      }
      continue;
    }

    if (character === '"') {
      inQuotes = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\r" || character === "\n") {
      if (character === "\r" && text[index + 1] === "\n") {
        index += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  row.push(cell);
  rows.push(row);
  if (rows.length > 1 && rows.at(-1).length === 1 && rows.at(-1)[0] === "") {
    rows.pop();
  }
  return rows;
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

function recordLoadRows() {
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
    "calibrated_pred_skill",
    "bpm_min",
    "bpm_max",
    "features",
  ];
  for (const header of requiredHeaders) {
    if (!headerIndex.has(header)) {
      throw new Error("必要な列がありません: " + header);
    }
  }

  return parsed.map((cells) => {
    const get = (key) => (cells[headerIndex.get(key)] ?? "").trim();
    return {
      chartId: get("chart_id"),
      title: recordNormalizeTitle(get("title")),
      difficulty: get("difficulty").toUpperCase(),
      level: get("original_level"),
      pred: get("calibrated_pred_skill"),
      bpmMin: get("bpm_min"),
      bpmMax: get("bpm_max"),
      features: get("features"),
    };
  }).filter((row) => /^\d+$/.test(row.chartId));
}

function recordFormatPred(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? (Math.round(numeric * 10) / 10).toFixed(1) : String(value ?? "");
}

function recordFormatBpm(row) {
  const min = String(row.bpmMin ?? "").trim();
  const max = String(row.bpmMax ?? "").trim();
  return min && min === max ? min : min + "~" + max;
}

function recordFormatFeature(row) {
  return String(row.features ?? "").trim() || "特徴なし";
}

function recordOpenDatabase() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("このブラウザではローカル保存を利用できません。"));
      return;
    }

    const request = window.indexedDB.open(recordDbName, recordDbVersion);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(recordStoreName)) {
        database.createObjectStore(recordStoreName, { keyPath: "chartId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("ローカル保存を開けませんでした。"));
  });
}

function recordReadAll() {
  return new Promise((resolve, reject) => {
    const transaction = recordState.db.transaction(recordStoreName, "readonly");
    const request = transaction.objectStore(recordStoreName).getAll();
    request.onsuccess = () => resolve(request.result ?? []);
    request.onerror = () => reject(request.error ?? new Error("記録を読み込めませんでした。"));
  });
}

function recordWriteStatus(chartId, status) {
  return new Promise((resolve, reject) => {
    const transaction = recordState.db.transaction(recordStoreName, "readwrite");
    const store = transaction.objectStore(recordStoreName);
    if (status === "unregistered") {
      store.delete(chartId);
    } else {
      store.put({ chartId, status, updatedAt: new Date().toISOString() });
    }
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error ?? new Error("記録を保存できませんでした。"));
  });
}

function recordWriteImported(entries) {
  return new Promise((resolve, reject) => {
    const transaction = recordState.db.transaction(recordStoreName, "readwrite");
    const store = transaction.objectStore(recordStoreName);
    for (const entry of entries) {
      if (entry.status === "unregistered") {
        store.delete(entry.chartId);
      } else {
        store.put(entry);
      }
    }
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error ?? new Error("バックアップを反映できませんでした。"));
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

function recordGetFilteredRows() {
  const query = recordState.query.trim().toLowerCase();
  return recordState.rows.filter((row) => {
    if (query && !row.title.toLowerCase().includes(query)) {
      return false;
    }
    if (recordState.level !== "all" && row.level !== recordState.level) {
      return false;
    }
    if (recordState.difficulty !== "all" && row.difficulty !== recordDifficultyValues[recordState.difficulty]) {
      return false;
    }
    if (recordState.status !== "all" && (recordState.records.get(row.chartId)?.status ?? "unregistered") !== recordState.status) {
      return false;
    }
    return true;
  });
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

function recordRender() {
  const filteredRows = recordGetFilteredRows();
  const visibleRows = filteredRows.slice(0, recordState.visibleLimit);
  recordElements.tableBody.innerHTML = visibleRows.map((row) => {
    const difficulty = recordDifficultyLabels[row.difficulty] ?? row.difficulty;
    const status = recordGetStatus(row);
    const title = recordEscapeHtml(row.title);
    const chartId = recordEscapeHtml(row.chartId);
    return [
      "<tr>",
      `<td><a class="record-title-link" href="chart-pages/${encodeURIComponent(row.chartId)}.html"><span>${title}</span>${difficulty ? ` <span class="record-title-link__difficulty">[${recordEscapeHtml(difficulty)}]</span>` : ""}</a></td>`,
      `<td>${recordEscapeHtml("☆" + row.level)}</td>`,
      `<td>${recordEscapeHtml(recordFormatPred(row.pred))}</td>`,
      `<td>${recordEscapeHtml(recordFormatBpm(row))}</td>`,
      `<td>${recordEscapeHtml(recordFormatFeature(row))}</td>`,
      `<td><select class="record-status-select" data-chart-id="${chartId}" aria-label="${title}のクリア状況">${recordStatusOptions(status)}</select></td>`,
      "</tr>",
    ].join("");
  }).join("");

  for (const select of recordElements.tableBody.querySelectorAll(".record-status-select")) {
    recordUpdateStatusSelect(select);
  }

  recordElements.summary.textContent = `${visibleRows.length.toLocaleString()}件表示 / ${filteredRows.length.toLocaleString()}件中　登録 ${recordState.records.size.toLocaleString()}件`;
  recordElements.loadMore.hidden = visibleRows.length >= filteredRows.length;
}

function recordPopulateFilters() {
  const levels = [...new Set(recordState.rows.map((row) => row.level).filter(Boolean))]
    .sort((left, right) => Number(left) - Number(right));
  recordElements.levelFilter.innerHTML = [
    '<option value="all">all</option>',
    ...levels.map((level) => `<option value="${recordEscapeHtml(level)}">☆${recordEscapeHtml(level)}</option>`),
  ].join("");
  recordElements.difficultyFilter.innerHTML = [
    '<option value="all">all</option>',
    ...Object.keys(recordDifficultyValues).map((value) => `<option value="${value}">[${value}] ${recordDifficultyLabels[recordDifficultyValues[value]] === value ? "" : ""}${{
      N: "NORMAL",
      H: "HYPER",
      A: "ANOTHER",
      L: "LEGGENDARIA",
    }[value]}</option>`),
  ].join("");
  recordElements.statusFilter.innerHTML = [
    '<option value="all">all</option>',
    ...recordStatuses.map(({ value, label }) => `<option value="${value}">${label}</option>`),
  ].join("");
}

function recordSetMessage(message, isError = false) {
  recordElements.message.textContent = message;
  recordElements.message.dataset.state = isError ? "error" : "ok";
}

function recordExport() {
  const statuses = [...recordState.records.values()]
    .filter((record) => record.status !== "unregistered")
    .sort((left, right) => Number(left.chartId) - Number(right.chartId))
    .map((record) => ({
      chart_id: record.chartId,
      status: record.status,
      updatedAt: record.updatedAt,
    }));
  const payload = {
    format: "cpi-next-clear-status",
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    statuses,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `cpi-next-clear-status-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  recordSetMessage(`${statuses.length.toLocaleString()}件の記録をエクスポートしました。`);
}

async function recordImport(file) {
  if (!file) {
    return;
  }

  try {
    const payload = JSON.parse(await file.text());
    if (!payload || payload.format !== "cpi-next-clear-status" || !Array.isArray(payload.statuses)) {
      throw new Error("対応していないバックアップ形式です。");
    }
    if (Number(payload.schemaVersion) > 1) {
      throw new Error("新しい形式のバックアップです。サイトを更新してから再試行してください。");
    }

    const knownIds = new Set(recordState.rows.map((row) => row.chartId));
    const imported = [];
    let ignored = 0;
    for (const item of payload.statuses) {
      const chartId = String(item?.chart_id ?? item?.chartId ?? "").trim();
      const status = String(item?.status ?? "");
      if (!knownIds.has(chartId) || !recordStatusValues.has(status)) {
        ignored += 1;
        continue;
      }
      imported.push({
        chartId,
        status,
        updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : new Date().toISOString(),
      });
    }

    await recordWriteImported(imported);
    recordApplyRecords(await recordReadAll());
    recordRender();
    recordElements.importInput.value = "";
    recordSetMessage(`${imported.length.toLocaleString()}件をインポートしました。${ignored ? `（${ignored.toLocaleString()}件は対象外のため無視）` : ""}`);
  } catch (error) {
    recordElements.importInput.value = "";
    recordSetMessage(error.message || "バックアップを読み込めませんでした。", true);
  }
}

async function recordHandleStatusChange(event) {
  const select = event.target.closest(".record-status-select");
  if (!select) {
    return;
  }
  const chartId = select.dataset.chartId;
  const status = select.value;
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
  } catch (error) {
    recordSetMessage(error.message || "記録を保存できませんでした。", true);
  } finally {
    select.disabled = false;
  }
}

function recordBindEvents() {
  recordElements.search.addEventListener("input", () => {
    recordState.query = recordElements.search.value;
    recordState.visibleLimit = recordPageSize;
    recordRender();
  });
  recordElements.levelFilter.addEventListener("change", () => {
    recordState.level = recordElements.levelFilter.value;
    recordState.visibleLimit = recordPageSize;
    recordRender();
  });
  recordElements.difficultyFilter.addEventListener("change", () => {
    recordState.difficulty = recordElements.difficultyFilter.value;
    recordState.visibleLimit = recordPageSize;
    recordRender();
  });
  recordElements.statusFilter.addEventListener("change", () => {
    recordState.status = recordElements.statusFilter.value;
    recordState.visibleLimit = recordPageSize;
    recordRender();
  });
  recordElements.tableBody.addEventListener("change", recordHandleStatusChange);
  recordElements.loadMore.addEventListener("click", () => {
    recordState.visibleLimit += recordPageSize;
    recordRender();
  });
  recordElements.exportButton.addEventListener("click", recordExport);
  recordElements.importInput.addEventListener("change", () => recordImport(recordElements.importInput.files[0]));
}

async function recordInitialize() {
  recordEntityDecoder = document.createElement("textarea");
  recordElements.search = document.getElementById("recordSearchInput");
  recordElements.levelFilter = document.getElementById("recordLevelFilter");
  recordElements.difficultyFilter = document.getElementById("recordDifficultyFilter");
  recordElements.statusFilter = document.getElementById("recordStatusFilter");
  recordElements.exportButton = document.getElementById("recordExportButton");
  recordElements.importInput = document.getElementById("recordImportInput");
  recordElements.message = document.getElementById("recordMessage");
  recordElements.summary = document.getElementById("recordSummary");
  recordElements.tableBody = document.getElementById("recordTableBody");
  recordElements.loadMore = document.getElementById("recordLoadMoreButton");

  try {
    recordState.rows = recordLoadRows();
    recordPopulateFilters();
    recordBindEvents();
    recordRender();
    recordState.db = await recordOpenDatabase();
    recordApplyRecords(await recordReadAll());
    recordRender();
  } catch (error) {
    recordSetMessage(error.message || "記録ページを初期化できませんでした。", true);
    recordElements.exportButton.disabled = true;
    recordElements.importInput.disabled = true;
  }
}

document.addEventListener("DOMContentLoaded", recordInitialize);
