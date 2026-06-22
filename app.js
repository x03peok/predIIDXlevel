const columns = [
  { key: "chart_id", label: "chart_id", className: "mono" },
  { key: "title", label: "title" },
  { key: "difficulty", label: "difficulty" },
  { key: "original_level", label: "original_level", className: "mono", numeric: true },
  { key: "calibrated_pred_skill", label: "calibrated_pred_skill", className: "mono", numeric: true },
];

const difficultyOrder = ["NORMAL", "HYPER", "ANOTHER", "LEGGENDARIA"];
const defaultCsv = "sample_predictions_extracted.csv";

const state = {
  rows: [],
  query: "",
  sortKey: "",
  sortDir: "asc",
  sourceName: defaultCsv,
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

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

function normalizeRows(text) {
  const parsed = parseCsv(text);
  if (!parsed.length) {
    throw new Error("CSV file is empty.");
  }

  const headers = parsed.shift().map((value) => value.trim());
  const headerIndex = new Map(headers.map((header, index) => [header, index]));

  for (const column of columns) {
    if (!headerIndex.has(column.key)) {
      throw new Error(`Missing required column: ${column.key}`);
    }
  }

  return parsed.map((cells, index) => {
    const row = { __order: index };

    for (const column of columns) {
      row[column.key] = (cells[headerIndex.get(column.key)] ?? "").trim();
    }

    row.__search = columns
      .map((column) => row[column.key])
      .join(" ")
      .toLowerCase();

    return row;
  });
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
    return a[key].localeCompare(b[key]);
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

function getVisibleRows() {
  const query = state.query.trim().toLowerCase();
  let rows = state.rows;

  if (query) {
    rows = rows.filter((row) => row.__search.includes(query));
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

function setStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.classList.toggle("error", isError);
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

    mark.textContent = state.sortDir === "asc" ? "↑" : "↓";
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
        badge.className = "difficulty";
        badge.textContent = row[column.key];
        td.appendChild(badge);
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
  const rows = getVisibleRows();
  els.totalCount.textContent = state.rows.length.toLocaleString();
  els.visibleCount.textContent = rows.length.toLocaleString();
  els.sourceName.textContent = state.sourceName;
  renderTable(rows);
  updateSortMarks();

  if (!state.rows.length) {
    setStatus("No data loaded yet.", true);
    return;
  }

  if (state.query.trim()) {
    setStatus(`Showing ${rows.length.toLocaleString()} of ${state.rows.length.toLocaleString()} rows.`);
  } else {
    setStatus(`Loaded ${state.rows.length.toLocaleString()} rows from ${state.sourceName}.`);
  }
}

function loadCsvText(text, sourceName) {
  try {
    state.rows = normalizeRows(text);
    state.query = "";
    state.sortKey = "";
    state.sortDir = "asc";
    state.sourceName = sourceName;
    els.searchInput.value = "";
    render();
  } catch (error) {
    state.rows = [];
    state.sourceName = sourceName;
    renderTable([]);
    updateSortMarks();
    setStatus(error instanceof Error ? error.message : "Failed to parse CSV.", true);
  }
}

async function loadBundledCsv() {
  setStatus(`Loading ${defaultCsv}...`);
  try {
    const response = await fetch(`./${defaultCsv}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to load ${defaultCsv} (${response.status}).`);
    }
    const text = await response.text();
    loadCsvText(text, defaultCsv);
  } catch (error) {
    state.rows = [];
    renderTable([]);
    updateSortMarks();
    setStatus(
      `Could not load ${defaultCsv}. Use the file picker to open it directly, or serve the folder through a static host.`,
      true
    );
    console.error(error);
  }
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

async function handleFileSelection(file) {
  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    loadCsvText(text, file.name);
  } catch (error) {
    setStatus("Failed to read the selected file.", true);
    console.error(error);
  } finally {
    els.fileInput.value = "";
  }
}

function init() {
  els.fileInput = document.getElementById("fileInput");
  els.reloadButton = document.getElementById("reloadButton");
  els.searchInput = document.getElementById("searchInput");
  els.status = document.getElementById("status");
  els.totalCount = document.getElementById("totalCount");
  els.visibleCount = document.getElementById("visibleCount");
  els.sourceName = document.getElementById("sourceName");
  els.tableBody = document.getElementById("tableBody");

  document.querySelectorAll("thead button[data-sort-key]").forEach((button) => {
    button.addEventListener("click", () => setSort(button.dataset.sortKey));
  });

  els.searchInput.addEventListener("input", () => {
    state.query = els.searchInput.value;
    render();
  });

  els.fileInput.addEventListener("change", (event) => {
    const [file] = event.target.files ?? [];
    handleFileSelection(file);
  });

  els.reloadButton.addEventListener("click", () => {
    loadBundledCsv();
  });

  loadBundledCsv();
}

document.addEventListener("DOMContentLoaded", init);
