"use strict";

const recordDbName = "cpi-next-clear-status";
const recordDbVersion = 2;
const recordStoreName = "chart-statuses";
const recordManualMemoStoreName = "manual-targets";
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

const recordState = {
  rows: [],
  records: new Map(),
  query: "",
  statusFilter: recordStatuses
    .filter(({ value }) => value !== "unowned")
    .map(({ value }) => value),
  levelFilter: null,
  difficultyFilter: null,
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
      if (!database.objectStoreNames.contains(recordManualMemoStoreName)) {
        database.createObjectStore(recordManualMemoStoreName, { keyPath: "chartId" });
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

  return rows;
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
  recordElements.tableBody.addEventListener("change", recordHandleStatusChange);
  recordElements.loadMore.addEventListener("click", () => {
    recordState.visibleLimit += recordPageSize;
    recordRender();
  });
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
