const columns = [
  { key: "title" },
  { key: "difficulty" },
  { key: "original_level", className: "mono", numeric: true },
  { key: "calibrated_pred_skill", className: "mono", numeric: true },
  { key: "bpm", sourceKeys: ["bpm_min", "bpm_max"] },
  { key: "features" },
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
const difficultyFilterValues = ["N", "H", "A", "L"];
const difficultyFilterToDifficulty = {
  N: "NORMAL",
  H: "HYPER",
  A: "ANOTHER",
  L: "LEGGENDARIA",
};
const searchFields = ["title"];
const FEATURE_NONE = "特徴なし";
const htmlEntityDecoder = document.createElement("textarea");

const state = {
  rows: [],
  query: "",
  sortKey: "calibrated_pred_skill",
  sortDir: "asc",
  difficultyFilter: null,
  bpmMinFilter: 0,
  bpmMaxFilter: 999,
  predMinFilter: 0,
  predMaxFilter: 999,
  predDataMin: 0,
  predDataMax: 999,
  origFilter: null,
  featureFilter: null,
  searchAnalyticsTimer: null,
  renderTimer: null,
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
    const sourceKeys = column.sourceKeys ?? [column.key];
    for (const sourceKey of sourceKeys) {
      if (!headerIndex.has(sourceKey)) {
        throw new Error("Missing required column: " + sourceKey);
      }
    }
  }

  return parsed.map((cells, index) => {
    const row = { __order: index };

    for (const column of columns) {
      if (column.key === "bpm") {
        for (const sourceKey of column.sourceKeys) {
          row[sourceKey] = (cells[headerIndex.get(sourceKey)] ?? "").trim();
        }
        continue;
      }

      const rawValue = cells[headerIndex.get(column.key)] ?? "";
      if (column.key === "features") {
        row[column.key] = rawValue;
      } else {
        const trimmedValue = rawValue.trim();
        row[column.key] = column.key === "title" ? normalizeTitle(trimmedValue) : trimmedValue;
      }
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

function normalizeFeature(value) {
  return String(value ?? "").trim().replace(/\++$/, "");
}

function getRowFeatures(row) {
  const features = String(row.features ?? "")
    .split("、")
    .map(normalizeFeature)
    .filter(Boolean);

  return features.length > 0 ? features : [FEATURE_NONE];
}

function compareValues(a, b, key) {
  if (key === "difficulty") {
    const left = difficultyOrder.indexOf(normalizeDifficulty(a[key]));
    const right = difficultyOrder.indexOf(normalizeDifficulty(b[key]));
    const safeLeft = left === -1 ? Number.MAX_SAFE_INTEGER : left;
    const safeRight = right === -1 ? Number.MAX_SAFE_INTEGER : right;
    if (safeLeft !== safeRight) {
      return safeLeft - safeRight;
    }
    return String(a[key]).localeCompare(String(b[key]));
  }

  if (key === "bpm") {
    const bpmKey = state.sortDir === "desc" ? "bpm_max" : "bpm_min";
    return compareNumericValues(a[bpmKey], b[bpmKey]);
  }

  const column = columns.find((item) => item.key === key);
  if (column?.numeric) {
    const numericResult = compareNumericValues(a[key], b[key]);
    if (numericResult !== 0) {
      return numericResult;
    }
  }

  return String(a[key]).localeCompare(String(b[key]), "en", {
    numeric: true,
    sensitivity: "base",
  });
}

function compareNumericValues(leftValue, rightValue) {
  const left = getNumericValue(leftValue);
  const right = getNumericValue(rightValue);
  const leftValid = left !== null;
  const rightValid = right !== null;

  if (leftValid && rightValid && left !== right) {
    return left - right;
  }

  if (leftValid !== rightValid) {
    return leftValid ? -1 : 1;
  }

  return 0;
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

function getNumericValue(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return null;
  }

  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseFilterNumber(value, fallback) {
  const text = String(value ?? "").trim();
  if (!text) {
    return fallback;
  }

  const numeric = getNumericValue(text);
  return numeric === null ? fallback : numeric;
}

function getNumericExtremes(rows, key, fallbackMin, fallbackMax) {
  let min = null;
  let max = null;

  for (const row of rows) {
    const value = getNumericValue(row[key]);
    if (value === null) {
      continue;
    }

    min = min === null ? value : Math.min(min, value);
    max = max === null ? value : Math.max(max, value);
  }

  return {
    min: min ?? fallbackMin,
    max: max ?? fallbackMax,
  };
}

function setPredInputBounds() {
  if (!els.predMinFilter || !els.predMaxFilter) {
    return;
  }

  const min = formatPredValue(state.predDataMin);
  const max = formatPredValue(state.predDataMax);
  els.predMinFilter.min = min;
  els.predMinFilter.max = max;
  els.predMaxFilter.min = min;
  els.predMaxFilter.max = max;
}

function clampPredFilterValue(value, fallback) {
  const numeric = parseFilterNumber(value, fallback);
  return Math.min(state.predDataMax, Math.max(state.predDataMin, numeric));
}

function isPredValueInDataRange(value) {
  return value >= state.predDataMin && value <= state.predDataMax;
}

function normalizePredFilterValue(value, fallback) {
  const clamped = clampPredFilterValue(value, fallback);
  return Math.round(clamped * 10) / 10;
}

function formatBpm(minValue, maxValue) {
  const minText = String(minValue ?? "").trim();
  const maxText = String(maxValue ?? "").trim();
  const min = minText ? getNumericValue(minText) : null;
  const max = maxText ? getNumericValue(maxText) : null;

  if (min === null && max === null) {
    return "";
  }
  if (min === null) {
    return maxText;
  }
  if (max === null || min === max) {
    return minText;
  }
  return minText + "~" + maxText;
}

function formatBpmCell(minValue, maxValue) {
  const text = formatBpm(minValue, maxValue);
  if (!text.includes("~")) {
    return escapeHtml(text);
  }

  const [minText, maxText] = text.split("~", 2);
  return [
    '<span class="bpm-range">',
    `<span class="bpm-range__min">${escapeHtml(minText)}~</span>`,
    `<span class="bpm-range__max">${escapeHtml(maxText)}</span>`,
    '</span>',
  ].join("");
}

function normalizeDifficulty(value) {
  if (difficultyClasses[value]) {
    return value;
  }

  return difficultyFilterToDifficulty[value] ?? value;
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

function getDifficultyFilterOptions() {
  return difficultyFilterValues.map((value) => ({ value, label: value }));
}

function getOrigFilterOptions() {
  const levels = new Set();

  for (const row of state.rows) {
    const level = toLevelValue(row.original_level);
    if (level !== null) {
      levels.add(level);
    }
  }

  return [...levels]
    .sort((a, b) => a - b)
    .map((level) => ({ value: String(level), label: `\u2606${level}` }));
}

function areAllFilterValuesSelected(selected, options) {
  const values = options.map((option) => option.value);
  return selected.length === values.length
    && values.every((value) => selected.includes(value));
}

function updateMultiFilterSummary(summary, selected, options) {
  const allSelected = areAllFilterValuesSelected(selected, options);
  if (allSelected) {
    summary.textContent = "all";
    summary.title = "";
    return;
  }

  if (selected.length === 0) {
    summary.textContent = "none";
    summary.title = "";
    return;
  }

  const selectedLabels = selected.map((value) => {
    const option = options.find((item) => item.value === value);
    return option?.label ?? value;
  });
  summary.textContent = selectedLabels.length === 1
    ? selectedLabels[0]
    : selectedLabels.length + " selected";
  summary.title = selectedLabels.join(", ");
}

function fillMultiFilterOptions({ stateKey, options, summary, container, filterName }) {
  const values = options.map((option) => option.value);
  const initialSelection = state[stateKey] === null;
  const selected = new Set(initialSelection ? values : state[stateKey]);
  state[stateKey] = values.filter((value) => selected.has(value));

  const notifyChange = () => {
    updateMultiFilterSummary(summary, state[stateKey], options);
    scheduleRender();
    trackAnalyticsEvent("filter_change", {
      filter_name: filterName,
      selected_value: state[stateKey].join("|"),
    });
  };

  const syncCheckboxes = () => {
    const selectedValues = new Set(state[stateKey]);
    const allCheckbox = container.querySelector("input[data-filter-all]");
    if (allCheckbox) {
      allCheckbox.checked = areAllFilterValuesSelected(state[stateKey], options);
    }

    container.querySelectorAll("input[data-filter-option]").forEach((checkbox) => {
      checkbox.checked = selectedValues.has(checkbox.value);
    });
  };

  const fragment = document.createDocumentFragment();
  const allLabel = document.createElement("label");
  allLabel.className = "multi-filter__option multi-filter__option--all";

  const allCheckbox = document.createElement("input");
  allCheckbox.type = "checkbox";
  allCheckbox.dataset.filterAll = "true";
  allCheckbox.checked = areAllFilterValuesSelected(state[stateKey], options);

  const allText = document.createElement("span");
  allText.textContent = "all";
  allLabel.append(allCheckbox, allText);
  allCheckbox.addEventListener("change", () => {
    state[stateKey] = allCheckbox.checked ? [...values] : [];
    syncCheckboxes();
    notifyChange();
  });
  fragment.appendChild(allLabel);

  for (const option of options) {
    const label = document.createElement("label");
    label.className = "multi-filter__option";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.filterOption = "true";
    checkbox.value = option.value;
    checkbox.checked = state[stateKey].includes(option.value);

    const text = document.createElement("span");
    text.textContent = option.label;
    label.append(checkbox, text);

    checkbox.addEventListener("change", () => {
      state[stateKey] = [...container.querySelectorAll("input[data-filter-option]:checked")]
        .map((input) => input.value);
      syncCheckboxes();
      notifyChange();
    });

    fragment.appendChild(label);
  }

  container.replaceChildren(fragment);
  updateMultiFilterSummary(summary, state[stateKey], options);
}

function getFeatureOptions() {
  const values = new Set([FEATURE_NONE]);
  for (const row of state.rows) {
    for (const feature of getRowFeatures(row)) {
      values.add(feature);
    }
  }

  return [
    FEATURE_NONE,
    ...[...values]
      .filter((feature) => feature !== FEATURE_NONE)
      .sort((a, b) => a.localeCompare(b, "ja")),
  ];
}

function fillFeatureOptions() {
  const options = getFeatureOptions().map((feature) => ({
    value: feature,
    label: feature,
  }));
  const previousFilter = state.featureFilter && !Array.isArray(state.featureFilter)
    ? state.featureFilter
    : null;
  const nextFilter = Object.create(null);

  for (const option of options) {
    const previousModes = previousFilter?.[option.value];
    nextFilter[option.value] = {
      include: previousModes ? previousModes.include === true : true,
      exclude: previousModes ? previousModes.exclude === true : true,
    };
  }
  state.featureFilter = nextFilter;

  const notifyChange = () => {
    updateFeatureFilterSummary(els.featureFilterSummary, options);
    scheduleRender();
    trackAnalyticsEvent("filter_change", {
      filter_name: "feature",
      selected_value: getFeatureFilterAnalyticsValue(options),
    });
  };

  const syncCheckboxes = () => {
    const allCheckbox = els.featureFilterOptions.querySelector("input[data-feature-all]");
    if (allCheckbox) {
      allCheckbox.checked = areAllFeatureModesSelected(options);
    }

    els.featureFilterOptions.querySelectorAll("input[data-feature-mode]").forEach((checkbox) => {
      const modes = state.featureFilter[checkbox.dataset.featureValue];
      checkbox.checked = Boolean(modes?.[checkbox.dataset.featureMode]);
    });
  };

  const fragment = document.createDocumentFragment();
  const allLabel = document.createElement("label");
  allLabel.className = "multi-filter__option multi-filter__option--all";

  const allCheckbox = document.createElement("input");
  allCheckbox.type = "checkbox";
  allCheckbox.dataset.featureAll = "true";
  allCheckbox.checked = areAllFeatureModesSelected(options);

  const allText = document.createElement("span");
  allText.textContent = "all";
  allLabel.append(allCheckbox, allText);
  allCheckbox.addEventListener("change", () => {
    for (const option of options) {
      state.featureFilter[option.value] = {
        include: allCheckbox.checked,
        exclude: allCheckbox.checked,
      };
    }
    syncCheckboxes();
    notifyChange();
  });
  fragment.appendChild(allLabel);

  for (const option of options) {
    const row = document.createElement("div");
    row.className = "multi-filter__option feature-filter__option";

    const name = document.createElement("span");
    name.className = "feature-filter__name";
    name.textContent = option.label;
    row.appendChild(name);

    for (const [mode, labelText] of [["include", "を含む"], ["exclude", "を含まない"]]) {
      const label = document.createElement("label");
      label.className = "feature-filter__mode";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.featureMode = mode;
      checkbox.dataset.featureValue = option.value;
      checkbox.checked = state.featureFilter[option.value][mode];

      const text = document.createElement("span");
      text.textContent = labelText;
      label.append(checkbox, text);
      row.appendChild(label);

      checkbox.addEventListener("change", () => {
        state.featureFilter[option.value][mode] = checkbox.checked;
        syncCheckboxes();
        notifyChange();
      });
    }

    fragment.appendChild(row);
  }

  els.featureFilterOptions.replaceChildren(fragment);
  syncCheckboxes();
  updateFeatureFilterSummary(els.featureFilterSummary, options);
}

function areAllFeatureModesSelected(options) {
  return options.every(({ value }) => {
    const modes = state.featureFilter?.[value];
    return modes?.include === true && modes?.exclude === true;
  });
}

function hasNoFeatureFilters(options) {
  return options.every(({ value }) => {
    const modes = state.featureFilter?.[value];
    return !modes || modes.include === modes.exclude;
  });
}

function getFeatureFilterAnalyticsValue(options) {
  return options.map(({ value }) => {
    const modes = state.featureFilter[value];
    const selectedModes = [
      modes.include ? "include" : "",
      modes.exclude ? "exclude" : "",
    ].filter(Boolean);
    return value + ":" + selectedModes.join(",");
  }).join("|");
}

function updateFeatureFilterSummary(summary, options) {
  if (hasNoFeatureFilters(options)) {
    summary.textContent = "all";
    summary.title = "";
    return;
  }

  const selectedModes = [];
  for (const option of options) {
    const modes = state.featureFilter?.[option.value];
    if (modes?.include !== modes?.exclude) {
      selectedModes.push(option.label + ":" + (modes.include ? "含む" : "含まない"));
    }
  }

  const summaryText = selectedModes.join(", ");
  summary.textContent = summaryText;
  summary.title = summaryText;
}

function populateFilterOptions() {
  fillMultiFilterOptions({
    stateKey: "difficultyFilter",
    options: getDifficultyFilterOptions(),
    summary: els.difficultyFilterSummary,
    container: els.difficultyFilterOptions,
    filterName: "difficulty",
  });
  fillFeatureOptions();
  fillMultiFilterOptions({
    stateKey: "origFilter",
    options: getOrigFilterOptions(),
    summary: els.origFilterSummary,
    container: els.origFilterOptions,
    filterName: "orig",
  });
}

function getVisibleRows() {
  const query = state.query.trim().toLowerCase();
  let rows = state.rows;

  if (query) {
    rows = rows.filter((row) => row.__search.includes(query));
  }

  const difficultyOptions = getDifficultyFilterOptions();
  const selectedDifficultyValues = state.difficultyFilter ?? [];
  if (selectedDifficultyValues.length === 0) {
    rows = [];
  } else if (!areAllFilterValuesSelected(selectedDifficultyValues, difficultyOptions)) {
    const selectedDifficulties = new Set(
      selectedDifficultyValues.map((value) => difficultyFilterToDifficulty[value] ?? value),
    );
    rows = rows.filter((row) => selectedDifficulties.has(normalizeDifficulty(row.difficulty)));
  }

  rows = rows.filter((row) => {
    const rowMin = getNumericValue(row.bpm_min);
    const rowMax = getNumericValue(row.bpm_max);
    return rowMin !== null
      && rowMax !== null
      && rowMin >= state.bpmMinFilter
      && rowMax <= state.bpmMaxFilter;
  });

  const levelOptions = getOrigFilterOptions();
  const selectedLevelValues = state.origFilter ?? [];
  if (selectedLevelValues.length === 0) {
    rows = [];
  } else if (!areAllFilterValuesSelected(selectedLevelValues, levelOptions)) {
    const selectedLevels = new Set(selectedLevelValues);
    rows = rows.filter((row) => {
      const level = toLevelValue(row.original_level);
      return level !== null && selectedLevels.has(String(level));
    });
  }

  rows = rows.filter((row) => {
    const predicted = getNumericValue(row.calibrated_pred_skill);
    return predicted !== null
      && predicted >= state.predMinFilter
      && predicted <= state.predMaxFilter;
  });

  const featureOptions = getFeatureOptions();
  if (state.featureFilter !== null && !hasNoFeatureFilters(
    featureOptions.map((feature) => ({ value: feature })),
  )) {
    rows = rows.filter((row) => {
      const rowFeatures = new Set(getRowFeatures(row));
      return featureOptions.every((feature) => {
        const modes = state.featureFilter[feature];
        if (!modes?.include && !modes?.exclude) {
          return true;
        }
        if (modes.include && !modes.exclude) {
          return rowFeatures.has(feature);
        }
        if (!modes.include && modes.exclude) {
          return !rowFeatures.has(feature);
        }
        return true;
      });
    });
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

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
}

function renderTable(rows) {
  const html = rows.map((row) => {
    const difficulty = normalizeDifficulty(row.difficulty);
    const difficultyClass = difficultyClasses[difficulty] ?? "";
    const difficultyText = difficultyLabels[difficulty] ?? row.difficulty ?? difficulty;
    const originalText = `\u2606${row.original_level ?? ""}`;
    const predictedText = formatPredValue(row.calibrated_pred_skill) ?? row.calibrated_pred_skill ?? "";
    const bpmHtml = formatBpmCell(row.bpm_min, row.bpm_max);

    return [
      "<tr>",
      `<td>${escapeHtml(row.title)}</td>`,
      `<td><span class="difficulty ${difficultyClass}">${escapeHtml(difficultyText)}</span></td>`,
      `<td class="mono">${escapeHtml(originalText)}</td>`,
      `<td class="mono">${escapeHtml(predictedText)}</td>`,
      `<td class="mono">${bpmHtml}</td>`,
      `<td>${escapeHtml(row.features)}</td>`,
      "</tr>",
    ].join("");
  }).join("");

  els.tableBody.innerHTML = html;
}

function cancelScheduledRender() {
  if (state.renderTimer !== null) {
    window.clearTimeout(state.renderTimer);
    state.renderTimer = null;
  }
}

function scheduleRender(delay = 60) {
  cancelScheduledRender();
  state.renderTimer = window.setTimeout(() => {
    state.renderTimer = null;
    render();
  }, delay);
}

function render() {
  const visibleRows = getVisibleRows();
  updateRowCount(visibleRows.length, state.rows.length);
  renderTable(visibleRows);
  updateTableOverflowState();
  updateSortMarks();
}

function updateTableOverflowState() {
  if (!els.tableShell) {
    return;
  }

  const isOverflowing = els.tableShell.scrollWidth > els.tableShell.clientWidth;
  els.tableShell.classList.toggle("is-overflowing", isOverflowing);
}

function updateRowCount(visibleCount, totalCount) {
  if (!els.rowCount) {
    return;
  }

  els.rowCount.textContent = `${visibleCount.toLocaleString()}件表示 / ${totalCount.toLocaleString()}件中`;
}

function loadCsvText(text) {
  try {
    state.rows = normalizeRows(text);
    const predRange = getNumericExtremes(state.rows, "calibrated_pred_skill", 0, 999);
    state.query = "";
    state.sortKey = "calibrated_pred_skill";
    state.sortDir = "asc";
    state.difficultyFilter = null;
    state.bpmMinFilter = 0;
    state.bpmMaxFilter = 999;
    state.predDataMin = predRange.min;
    state.predDataMax = predRange.max;
    state.predMinFilter = predRange.min;
    state.predMaxFilter = predRange.max;
    state.origFilter = null;
    state.featureFilter = null;
    state.lastTrackedSearchTerm = "";
    if (state.searchAnalyticsTimer !== null) {
      window.clearTimeout(state.searchAnalyticsTimer);
      state.searchAnalyticsTimer = null;
    }
    cancelScheduledRender();
    els.searchInput.value = "";
    els.bpmMinFilter.value = "0";
    els.bpmMaxFilter.value = "999";
    setPredInputBounds();
    els.predMinFilter.value = formatPredValue(predRange.min);
    els.predMaxFilter.value = formatPredValue(predRange.max);
    populateFilterOptions();
    render();
  } catch (error) {
    state.rows = [];
    updateRowCount(0, 0);
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
  updateRowCount(0, 0);
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

  cancelScheduledRender();
  render();
}

function updateBpmFilters() {
  state.bpmMinFilter = parseFilterNumber(els.bpmMinFilter.value, 0);
  state.bpmMaxFilter = parseFilterNumber(els.bpmMaxFilter.value, 999);
  scheduleRender();
  trackAnalyticsEvent("filter_change", {
    filter_name: "bpm",
    bpm_min: state.bpmMinFilter,
    bpm_max: state.bpmMaxFilter,
  });
}

function updatePredFilters() {
  const minValue = getNumericValue(els.predMinFilter.value);
  const maxValue = getNumericValue(els.predMaxFilter.value);

  if (minValue === null) {
    state.predMinFilter = state.predDataMin;
  } else if (isPredValueInDataRange(minValue)) {
    state.predMinFilter = minValue;
  }
  if (maxValue === null) {
    state.predMaxFilter = state.predDataMax;
  } else if (isPredValueInDataRange(maxValue)) {
    state.predMaxFilter = maxValue;
  }

  scheduleRender();
}

function commitBpmFilters() {
  state.bpmMinFilter = parseFilterNumber(els.bpmMinFilter.value, 0);
  state.bpmMaxFilter = parseFilterNumber(els.bpmMaxFilter.value, 999);
  els.bpmMinFilter.value = String(state.bpmMinFilter);
  els.bpmMaxFilter.value = String(state.bpmMaxFilter);
  cancelScheduledRender();
  render();
}

function commitPredFilters() {
  state.predMinFilter = normalizePredFilterValue(els.predMinFilter.value, state.predDataMin);
  state.predMaxFilter = normalizePredFilterValue(els.predMaxFilter.value, state.predDataMax);
  els.predMinFilter.value = formatPredValue(state.predMinFilter);
  els.predMaxFilter.value = formatPredValue(state.predMaxFilter);
  cancelScheduledRender();
  render();
  trackAnalyticsEvent("filter_change", {
    filter_name: "pred",
    pred_min: state.predMinFilter,
    pred_max: state.predMaxFilter,
  });
}

function closeOtherFilterDetails(activeDetails) {
  document.querySelectorAll(".multi-filter__details").forEach((details) => {
    if (details !== activeDetails) {
      details.open = false;
    }
  });
}

function setupFilterDetails() {
  document.querySelectorAll(".multi-filter__details").forEach((details) => {
    details.addEventListener("toggle", () => {
      if (details.open) {
        closeOtherFilterDetails(details);
      }
    });
  });

  document.addEventListener("click", (event) => {
    const activeDetails = event.target.closest?.(".multi-filter__details") ?? null;
    closeOtherFilterDetails(activeDetails);
  });
}

function updateScrollTopButton() {
  if (!els.scrollTopButton) {
    return;
  }

  els.scrollTopButton.hidden = window.scrollY <= 0;
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function init() {
  els.searchInput = document.getElementById("searchInput");
  els.difficultyFilterSummary = document.getElementById("difficultyFilterSummary");
  els.difficultyFilterOptions = document.getElementById("difficultyFilterOptions");
  els.bpmMinFilter = document.getElementById("bpmMinFilter");
  els.bpmMaxFilter = document.getElementById("bpmMaxFilter");
  els.predMinFilter = document.getElementById("predMinFilter");
  els.predMaxFilter = document.getElementById("predMaxFilter");
  els.origFilterSummary = document.getElementById("origFilterSummary");
  els.origFilterOptions = document.getElementById("origFilterOptions");
  els.featureFilterSummary = document.getElementById("featureFilterSummary");
  els.featureFilterOptions = document.getElementById("featureFilterOptions");
  els.tableBody = document.getElementById("tableBody");
  els.rowCount = document.getElementById("rowCount");
  els.scrollTopButton = document.getElementById("scrollTopButton");
  els.tableShell = document.getElementById("tableShell");

  setupFilterDetails();
  window.addEventListener("scroll", updateScrollTopButton, { passive: true });
  window.addEventListener("resize", updateTableOverflowState);
  els.scrollTopButton.addEventListener("click", scrollToTop);
  updateScrollTopButton();

  document.querySelectorAll("thead button[data-sort-key]").forEach((button) => {
    button.addEventListener("click", () => setSort(button.dataset.sortKey));
  });

  els.searchInput.addEventListener("input", () => {
    state.query = els.searchInput.value;
    scheduleRender(100);
    scheduleSearchAnalytics();
  });

  els.bpmMinFilter.addEventListener("input", updateBpmFilters);
  els.bpmMaxFilter.addEventListener("input", updateBpmFilters);
  els.bpmMinFilter.addEventListener("blur", commitBpmFilters);
  els.bpmMaxFilter.addEventListener("blur", commitBpmFilters);
  els.predMinFilter.addEventListener("input", updatePredFilters);
  els.predMaxFilter.addEventListener("input", updatePredFilters);
  els.predMinFilter.addEventListener("blur", commitPredFilters);
  els.predMaxFilter.addEventListener("blur", commitPredFilters);

  loadBundledCsv();
}

document.addEventListener("DOMContentLoaded", init);
