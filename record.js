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
    };
  }).filter((row) => /^\d+$/.test(row.chartId));
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
    const difficultyClass = recordDifficultyClasses[row.difficulty] ?? "";
    const status = recordGetStatus(row);
    const title = recordEscapeHtml(row.title);
    const chartId = recordEscapeHtml(row.chartId);
    const chartHref = "chart-pages/" + encodeURIComponent(row.chartId) + ".html";
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
  recordElements.loadMore.hidden = visibleRows.length >= filteredRows.length;
}

function recordPopulateFilters() {
  const levels = [...new Set(recordState.rows.map((row) => row.level).filter(Boolean))]
    .sort((left, right) => Number(left) - Number(right));
  recordElements.levelFilter.innerHTML = [
    '<option value="all">all</option>',
    ...levels.map((level) => `<option value="${recordEscapeHtml(level)}">${recordEscapeHtml(level)}</option>`),
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
}

async function recordInitialize() {
  recordEntityDecoder = document.createElement("textarea");
  recordElements.search = document.getElementById("recordSearchInput");
  recordElements.levelFilter = document.getElementById("recordLevelFilter");
  recordElements.difficultyFilter = document.getElementById("recordDifficultyFilter");
  recordElements.statusFilter = document.getElementById("recordStatusFilter");
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
  }
}

document.addEventListener("DOMContentLoaded", recordInitialize);
