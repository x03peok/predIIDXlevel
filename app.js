const columns = [
  { key: "title" },
  { key: "difficulty" },
  { key: "original_level", className: "mono", numeric: true },
  { key: "calibrated_pred_skill", className: "mono", numeric: true },
];

const difficultyOrder = ["NORMAL", "HYPER", "ANOTHER", "LEGGENDARIA"];
const difficultyLabels = {
  NORMAL: "N",
  HYPER: "H",
  ANOTHER: "A",
  LEGGENDARIA: "L",
};
const difficultyClasses = {
  NORMAL: "difficulty--normal",
  HYPER: "difficulty--hyper",
  ANOTHER: "difficulty--another",
  LEGGENDARIA: "difficulty--leggendaria",
};
const searchFields = ["title"];
const htmlEntityDecoder = document.createElement("textarea");

const state = {
  rows: [],
  query: "",
  sortKey: "calibrated_pred_skill",
  sortDir: "asc",
  origFilter: "all",
  predFilter: "all",
  searchAnalyticsTimer: null,
  lastTrackedSearchTerm: "",
};

const els = {};

function parseCsv(text) {
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

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === "\"") {
        if (text[i + 1] === "\"") {
          cell += "\"";
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === "\"") {
      inQuotes = true;
      continue;
    }

    if (ch === ",") {
      row.push(cell);
      cell = "";
      continue;
    }

    if (ch === "\r") {
      if (text[i + 1] === "\n") {
        i += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += ch;
  }

  row.push(cell);
  rows.push(row);

  if (
    rows.length > 1 &&
    rows[rows.length - 1].length === 1 &&
    rows[rows.length - 1][0] === "" &&
    /[\r\n]$/.test(text)
  ) {
    rows.pop();
  }

  return rows;
}

function normalizeRows(text) {
  const parsed = parseCsv(text);
  if (!parsed.length) {
    throw new Error("CSV file is empty.");
  }

  const headers = parsed.shift().map((value) => value.trim());
  const headerIndex = new Map(headers.map((header, index) => [header, index]));

  for (const key of searchFields) {
    if (!headerIndex.has(key)) {
      throw new Error(`Missing required column: ${key}`);
    }
  }

  for (const column of columns) {
    if (!headerIndex.has(column.key)) {
      throw new Error(`Missing required column: ${column.key}`);
    }
  }

  return parsed.map((cells, index) => {
    const row = { __order: index };

    for (const column of columns) {
      const rawValue = (cells[headerIndex.get(column.key)] ?? "").trim();
      row[column.key] = column.key === "title" ? normalizeTitle(rawValue) : rawValue;
    }

    row.__search = searchFields
      .map((key) => row[key])
      .join(" ")
      .toLowerCase();

    return row;
  });
}

function stripHtmlTags(text) {
  return text.replace(/<\/?[A-Za-z][^>]*>/g, "");
}

function decodeHtmlEntities(text) {
  htmlEntityDecoder.innerHTML = text;
  return htmlEntityDecoder.value;
}

function normalizeTitle(value) {
  const decoded = decodeHtmlEntities(value);
  const stripped = stripHtmlTags(decoded);
  return decodeHtmlEntities(stripped);
}

function compareValues(a, b, key) {
  if (key === "difficulty") {
    const left = difficultyOrder.indexOf(a[key]);
    const right = difficultyOrder.indexOf(b[key]);
    const safeLeft = left === -1 ? Number.MAX_SAFE_INTEGER : left;
    const safeRight = right === -1 ? Number.MAX_SAFE_INTEGER : right;
    if (safeLeft !== safeRight) {
      return safeLeft - safeRight;
    }
    return String(a[key]).localeCompare(String(b[key]));
  }

  const column = columns.find((item) => item.key === key);
  if (column?.numeric) {
    const left = Number(a[key]);
    const right = Number(b[key]);
    const leftValid = Number.isFinite(left);
    const rightValid = Number.isFinite(right);

    if (leftValid && rightValid && left !== right) {
      return left - right;
    }

    if (leftValid !== rightValid) {
      return leftValid ? -1 : 1;
    }
  }

  return String(a[key]).localeCompare(String(b[key]), "en", {
    numeric: true,
    sensitivity: "base",
  });
}

function toLevelValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatPredValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  return (Math.round(numeric * 10) / 10).toFixed(1);
}

function trackAnalyticsEvent(name, params = {}) {
  if (typeof window.gtag !== "function") {
    return;
  }

  window.gtag("event", name, params);
}

function scheduleSearchAnalytics() {
  if (state.searchAnalyticsTimer !== null) {
    window.clearTimeout(state.searchAnalyticsTimer);
  }

  state.searchAnalyticsTimer = window.setTimeout(() => {
    state.searchAnalyticsTimer = null;

    const searchTerm = state.query.trim();
    if (!searchTerm) {
      state.lastTrackedSearchTerm = "";
      return;
    }

    if (searchTerm === state.lastTrackedSearchTerm) {
      return;
    }

    trackAnalyticsEvent("search", {
      search_term: searchTerm,
      search_length: searchTerm.length,
    });
    state.lastTrackedSearchTerm = searchTerm;
  }, 600);
}

function fillOrigSelect(select, levels) {
  const current = select.value || "all";
  const options = [{ value: "all", label: "all" }];

  for (const level of levels) {
    options.push({ value: String(level), label: `\u2606${level}` });
  }

  const fragment = document.createDocumentFragment();
  for (const option of options) {
    const el = document.createElement("option");
    el.value = option.value;
    el.textContent = option.label;
    fragment.appendChild(el);
  }

  select.replaceChildren(fragment);
  select.value = options.some((option) => option.value === current) ? current : "all";
}

function fillPredSelect(select, values) {
  const current = select.value || "all";
  const options = [{ value: "all", label: "all" }];

  for (const value of values) {
    options.push({ value, label: value });
  }

  const fragment = document.createDocumentFragment();
  for (const option of options) {
    const el = document.createElement("option");
    el.value = option.value;
    el.textContent = option.label;
    fragment.appendChild(el);
  }

  select.replaceChildren(fragment);
  select.value = options.some((option) => option.value === current) ? current : "all";
}

function getPredFilterRows() {
  if (state.origFilter === "all") {
    return state.rows;
  }

  return state.rows.filter((row) => row.original_level === state.origFilter);
}

function populateFilterOptions() {
  const origLevels = new Set();
  const predLevels = new Set();

  for (const row of state.rows) {
    const origLevel = toLevelValue(row.original_level);
    if (origLevel !== null) {
      origLevels.add(origLevel);
    }
  }

  fillOrigSelect(els.origFilter, [...origLevels].sort((a, b) => a - b));
  state.origFilter = els.origFilter.value;

  for (const row of getPredFilterRows()) {
    const predLevel = formatPredValue(row.calibrated_pred_skill);
    if (predLevel !== null) {
      predLevels.add(predLevel);
    }
  }

  fillPredSelect(els.predFilter, [...predLevels].sort((a, b) => Number(a) - Number(b)));
  state.predFilter = els.predFilter.value;
}

function getVisibleRows() {
  const query = state.query.trim().toLowerCase();
  let rows = state.rows;

  if (query) {
    rows = rows.filter((row) => row.__search.includes(query));
  }

  if (state.origFilter !== "all") {
    rows = rows.filter((row) => row.original_level === state.origFilter);
  }

  if (state.predFilter !== "all") {
    rows = rows.filter((row) => formatPredValue(row.calibrated_pred_skill) === state.predFilter);
  }

  if (state.sortKey) {
    rows = rows.slice().sort((a, b) => {
      const result = compareValues(a, b, state.sortKey);
      if (result !== 0) {
        return state.sortDir === "asc" ? result : -result;
      }
      return a.__order - b.__order;
    });
  }

  return rows;
}

function updateSortMarks() {
  document.querySelectorAll("thead button[data-sort-key]").forEach((button) => {
    const key = button.dataset.sortKey;
    const mark = button.querySelector(".sort-mark");

    if (!mark) {
      return;
    }

    if (state.sortKey !== key) {
      mark.textContent = "";
      return;
    }

    mark.textContent = state.sortDir === "asc" ? "\u25B2" : "\u25BC";
  });
}

function renderTable(rows) {
  const fragment = document.createDocumentFragment();

  for (const row of rows) {
    const tr = document.createElement("tr");

    for (const column of columns) {
      const td = document.createElement("td");

      if (column.key === "difficulty") {
        const badge = document.createElement("span");
        const difficulty = row[column.key];
        badge.className = `difficulty ${difficultyClasses[difficulty] ?? ""}`.trim();
        badge.textContent = difficultyLabels[difficulty] ?? difficulty;
        td.appendChild(badge);
      } else if (column.key === "original_level") {
        td.textContent = `\u2606${row[column.key]}`;
        if (column.className) {
          td.className = column.className;
        }
      } else if (column.key === "calibrated_pred_skill") {
        td.textContent = formatPredValue(row[column.key]) ?? row[column.key];
        if (column.className) {
          td.className = column.className;
        }
      } else {
        td.textContent = row[column.key];
        if (column.className) {
          td.className = column.className;
        }
      }

      tr.appendChild(td);
    }

    fragment.appendChild(tr);
  }

  els.tableBody.replaceChildren(fragment);
}

function render() {
  renderTable(getVisibleRows());
  updateSortMarks();
}

function loadCsvText(text) {
  try {
    state.rows = normalizeRows(text);
    state.query = "";
    state.sortKey = "calibrated_pred_skill";
    state.sortDir = "asc";
    state.origFilter = "all";
    state.predFilter = "all";
    state.lastTrackedSearchTerm = "";
    if (state.searchAnalyticsTimer !== null) {
      window.clearTimeout(state.searchAnalyticsTimer);
      state.searchAnalyticsTimer = null;
    }
    els.searchInput.value = "";
    els.origFilter.value = "all";
    els.predFilter.value = "all";
    populateFilterOptions();
    render();
  } catch (error) {
    state.rows = [];
    renderTable([]);
    updateSortMarks();
    console.error(error);
  }
}

function getBundledCsvText() {
  const bundle = window.__CSV_BUNDLE__;

  if (typeof bundle === "string") {
    return bundle;
  }

  if (bundle && typeof bundle.value === "string") {
    return bundle.value;
  }

  return null;
}

async function loadBundledCsv() {
  const bundledCsv = getBundledCsvText();
  if (bundledCsv && bundledCsv.length > 0) {
    loadCsvText(bundledCsv);
    return;
  }

  state.rows = [];
  renderTable([]);
  updateSortMarks();
  console.error("Missing bundled CSV data in data.js");
}

function setSort(key) {
  if (state.sortKey === key) {
    state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
  } else {
    state.sortKey = key;
    state.sortDir = "asc";
  }

  render();
}

function init() {
  els.searchInput = document.getElementById("searchInput");
  els.origFilter = document.getElementById("origFilter");
  els.predFilter = document.getElementById("predFilter");
  els.tableBody = document.getElementById("tableBody");

  document.querySelectorAll("thead button[data-sort-key]").forEach((button) => {
    button.addEventListener("click", () => setSort(button.dataset.sortKey));
  });

  els.searchInput.addEventListener("input", () => {
    state.query = els.searchInput.value;
    render();
    scheduleSearchAnalytics();
  });

  els.origFilter.addEventListener("change", () => {
    state.origFilter = els.origFilter.value;
    populateFilterOptions();
    render();
    trackAnalyticsEvent("filter_change", {
      filter_name: "orig",
      selected_value: state.origFilter,
    });
  });

  els.predFilter.addEventListener("change", () => {
    state.predFilter = els.predFilter.value;
    render();
    trackAnalyticsEvent("filter_change", {
      filter_name: "pred",
      selected_value: state.predFilter,
    });
  });

  loadBundledCsv();
}

document.addEventListener("DOMContentLoaded", init);
