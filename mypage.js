"use strict";

const mypageDatabaseName = "cpi-next-clear-status";
const mypageDatabaseVersion = 1;
const mypageStoreName = "chart-statuses";
const mypageFeatureNone = "特徴なし";
const mypageDifficultyValues = {
  N: "NORMAL",
  H: "HYPER",
  A: "ANOTHER",
  L: "LEGGENDARIA",
};
const mypageDifficultyLabels = {
  NORMAL: "N",
  HYPER: "H",
  ANOTHER: "A",
  LEGGENDARIA: "L",
};
const mypageDifficultyClasses = {
  NORMAL: "difficulty--normal",
  HYPER: "difficulty--hyper",
  ANOTHER: "difficulty--another",
  LEGGENDARIA: "difficulty--leggendaria",
};
const mypageDifficultyFilterValues = ["N", "H", "A", "L"];
const mypageStatuses = [
  { value: "unregistered", label: "未登録" },
  { value: "unowned", label: "未所持・未解禁" },
  { value: "no-play", label: "NO PLAY" },
  { value: "assisted", label: "ASSISTED" },
  { value: "easy", label: "EASY" },
  { value: "clear", label: "CLEAR" },
  { value: "hard", label: "HARD" },
];
const mypageStatusValues = new Set(mypageStatuses.map(({ value }) => value));

const mypageState = {
  rows: [],
  records: new Map(),
  query: "",
  statusFilter: mypageStatuses
    .filter(({ value }) => value !== "unregistered" && value !== "unowned")
    .map(({ value }) => value),
  levelFilter: null,
  difficultyFilter: null,
  featureFilter: null,
  bpmMinFilter: 0,
  bpmMaxFilter: 999,
  predMinFilter: 0,
  predMaxFilter: 999,
  predDataMin: 0,
  predDataMax: 999,
  sortKey: "calibrated_pred_skill",
  sortDir: "asc",
  renderTimer: null,
  db: null,
};

const mypageElements = {};

function mypageEscapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[character]));
}

function mypageGetNumericValue(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return null;
  }
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : null;
}

function mypageFormatPredValue(value) {
  const numeric = mypageGetNumericValue(value);
  return numeric === null ? null : (Math.round(numeric * 10) / 10).toFixed(1);
}

function mypageNormalizeFeature(value) {
  return String(value ?? "").trim().replace(/\++$/, "");
}

function mypageGetRowFeatures(row) {
  const features = String(row.features ?? "")
    .split("、")
    .map(mypageNormalizeFeature)
    .filter(Boolean);
  return features.length > 0 ? features : [mypageFeatureNone];
}

function mypageGetRawRowFeatures(row) {
  return String(row.features ?? "")
    .split("、")
    .map((feature) => feature.trim())
    .filter(Boolean);
}

function mypageGetFeatureOptions() {
  const values = new Set([mypageFeatureNone]);
  for (const row of mypageState.rows) {
    for (const feature of mypageGetRowFeatures(row)) {
      values.add(feature);
    }
  }
  return [
    mypageFeatureNone,
    ...[...values]
      .filter((feature) => feature !== mypageFeatureNone)
      .sort((left, right) => left.localeCompare(right, "ja")),
  ];
}

function mypageGetLevelOptions() {
  const levels = new Set();
  for (const row of mypageState.rows) {
    const level = mypageGetNumericValue(row.original_level);
    if (level !== null) {
      levels.add(level);
    }
  }
  return [...levels]
    .sort((left, right) => left - right)
    .map((level) => ({ value: String(level), label: "☆" + level }));
}

function mypageGetDifficultyOptions() {
  return mypageDifficultyFilterValues.map((value) => ({
    value,
    label: "[" + value + "] " + mypageDifficultyValues[value],
  }));
}

function mypageAreAllValuesSelected(selected, options) {
  const values = options.map((option) => option.value);
  return selected.length === values.length
    && values.every((value) => selected.includes(value));
}

function mypageUpdateValueFilterSummary(summary, selected, options) {
  if (mypageAreAllValuesSelected(selected, options)) {
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

function mypageFillValueFilter(stateKey, options, summary, container) {
  const values = options.map((option) => option.value);
  const current = Array.isArray(mypageState[stateKey])
    ? mypageState[stateKey]
    : values;
  mypageState[stateKey] = values.filter((value) => current.includes(value));

  const syncCheckboxes = () => {
    const selectedValues = new Set(mypageState[stateKey]);
    const allCheckbox = container.querySelector("input[data-filter-all]");
    if (allCheckbox) {
      allCheckbox.checked = mypageAreAllValuesSelected(mypageState[stateKey], options);
    }
    container.querySelectorAll("input[data-filter-option]").forEach((checkbox) => {
      checkbox.checked = selectedValues.has(checkbox.value);
    });
  };

  const notifyChange = () => {
    mypageUpdateValueFilterSummary(summary, mypageState[stateKey], options);
    mypageScheduleRender();
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
    mypageState[stateKey] = allCheckbox.checked ? [...values] : [];
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
      mypageState[stateKey] = [...container.querySelectorAll("input[data-filter-option]:checked")]
        .map((input) => input.value);
      syncCheckboxes();
      notifyChange();
    });
    fragment.append(label);
  }

  container.replaceChildren(fragment);
  syncCheckboxes();
  mypageUpdateValueFilterSummary(summary, mypageState[stateKey], options);
}

function mypageAreAllFeatureModesSelected(options) {
  return options.every((value) => {
    const modes = mypageState.featureFilter?.[value];
    return modes?.include === true && modes?.exclude === true;
  });
}

function mypageHasNoFeatureFilters(options) {
  return options.every((value) => {
    const modes = mypageState.featureFilter?.[value];
    return !modes || modes.include === modes.exclude;
  });
}

function mypageUpdateFeatureSummary(summary, options) {
  if (mypageHasNoFeatureFilters(options)) {
    summary.textContent = "all";
    summary.title = "";
    return;
  }

  const selectedModes = [];
  for (const value of options) {
    const modes = mypageState.featureFilter?.[value];
    if (modes?.include !== modes?.exclude) {
      selectedModes.push(value + ":" + (modes.include ? "含む" : "含まない"));
    }
  }
  const summaryText = selectedModes.join(", ");
  summary.textContent = summaryText;
  summary.title = summaryText;
}

function mypageFillFeatureFilter() {
  const options = mypageGetFeatureOptions();
  const previous = mypageState.featureFilter;
  const next = Object.create(null);
  for (const value of options) {
    const modes = previous?.[value];
    next[value] = {
      include: modes ? modes.include === true : true,
      exclude: modes ? modes.exclude === true : true,
    };
  }
  mypageState.featureFilter = next;

  const syncCheckboxes = () => {
    const allCheckbox = mypageElements.featureFilterOptions.querySelector("input[data-feature-all]");
    if (allCheckbox) {
      allCheckbox.checked = mypageAreAllFeatureModesSelected(options);
    }
    mypageElements.featureFilterOptions.querySelectorAll("input[data-feature-mode]")
      .forEach((checkbox) => {
        const modes = mypageState.featureFilter[checkbox.dataset.featureValue];
        checkbox.checked = Boolean(modes?.[checkbox.dataset.featureMode]);
      });
  };

  const notifyChange = () => {
    mypageUpdateFeatureSummary(mypageElements.featureFilterSummary, options);
    mypageScheduleRender();
  };

  const fragment = document.createDocumentFragment();
  const allLabel = document.createElement("label");
  allLabel.className = "multi-filter__option multi-filter__option--all";
  const allCheckbox = document.createElement("input");
  allCheckbox.type = "checkbox";
  allCheckbox.dataset.featureAll = "true";
  const allText = document.createElement("span");
  allText.textContent = "all";
  allLabel.append(allCheckbox, allText);
  allCheckbox.addEventListener("change", () => {
    for (const value of options) {
      mypageState.featureFilter[value] = {
        include: allCheckbox.checked,
        exclude: allCheckbox.checked,
      };
    }
    syncCheckboxes();
    notifyChange();
  });
  fragment.append(allLabel);

  for (const value of options) {
    const row = document.createElement("div");
    row.className = "multi-filter__option feature-filter__option";
    const name = document.createElement("span");
    name.className = "feature-filter__name";
    name.textContent = value;
    row.append(name);

    for (const [mode, labelText] of [["include", "を含む"], ["exclude", "を含まない"]]) {
      const label = document.createElement("label");
      label.className = "feature-filter__mode";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.featureMode = mode;
      checkbox.dataset.featureValue = value;
      const text = document.createElement("span");
      text.textContent = labelText;
      label.append(checkbox, text);
      row.append(label);
      checkbox.addEventListener("change", () => {
        mypageState.featureFilter[value][mode] = checkbox.checked;
        syncCheckboxes();
        notifyChange();
      });
    }
    fragment.append(row);
  }

  mypageElements.featureFilterOptions.replaceChildren(fragment);
  syncCheckboxes();
  mypageUpdateFeatureSummary(mypageElements.featureFilterSummary, options);
}

function mypageGetStatus(row) {
  return mypageState.records.get(String(row.chart_id))?.status ?? "unregistered";
}

function mypageStatusOptions(selected) {
  return mypageStatuses.map(({ value, label }) => (
    '<option value="' + value + '"' + (value === selected ? ' selected' : '') + ">" + label + "</option>"
  )).join("");
}

function mypageUpdateStatusSelect(select) {
  select.dataset.status = select.value;
}
function mypageCompareNumericValues(leftValue, rightValue) {
  const left = mypageGetNumericValue(leftValue);
  const right = mypageGetNumericValue(rightValue);
  if (left !== null && right !== null && left !== right) {
    return left - right;
  }
  if ((left !== null) !== (right !== null)) {
    return left !== null ? -1 : 1;
  }
  return 0;
}

function mypageCompareValues(left, right, key) {
  if (key === "status") {
    const leftIndex = mypageStatuses.findIndex(({ value }) => value === mypageGetStatus(left));
    const rightIndex = mypageStatuses.findIndex(({ value }) => value === mypageGetStatus(right));
    return leftIndex - rightIndex;
  }
  if (key === "bpm") {
    const bpmKey = mypageState.sortDir === "desc" ? "bpm_max" : "bpm_min";
    return mypageCompareNumericValues(left[bpmKey], right[bpmKey]);
  }
  if (key === "original_level" || key === "calibrated_pred_skill") {
    const numericResult = mypageCompareNumericValues(left[key], right[key]);
    if (numericResult !== 0) {
      return numericResult;
    }
  }
  return String(left[key] ?? "").localeCompare(String(right[key] ?? ""), "en", {
    numeric: true,
    sensitivity: "base",
  });
}

function mypageGetVisibleRows() {
  const query = mypageState.query.trim().toLowerCase();
  let rows = mypageState.rows;

  if (query) {
    rows = rows.filter((row) => String(row.title ?? "").toLowerCase().includes(query));
  }

  const statusOptions = mypageStatuses;
  const selectedStatuses = mypageState.statusFilter ?? [];
  if (selectedStatuses.length === 0) {
    return [];
  }
  if (!mypageAreAllValuesSelected(selectedStatuses, statusOptions)) {
    const selectedStatusSet = new Set(selectedStatuses);
    rows = rows.filter((row) => selectedStatusSet.has(mypageGetStatus(row)));
  }

  const difficultyOptions = mypageGetDifficultyOptions();
  const selectedDifficulties = mypageState.difficultyFilter ?? [];
  if (selectedDifficulties.length === 0) {
    return [];
  }
  if (!mypageAreAllValuesSelected(selectedDifficulties, difficultyOptions)) {
    const selectedSet = new Set(selectedDifficulties);
    rows = rows.filter((row) => {
      const value = Object.entries(mypageDifficultyValues)
        .find(([, difficulty]) => difficulty === String(row.difficulty ?? "").toUpperCase())?.[0];
      return selectedSet.has(value);
    });
  }

  const levelOptions = mypageGetLevelOptions();
  const selectedLevels = mypageState.levelFilter ?? [];
  if (selectedLevels.length === 0) {
    return [];
  }
  if (!mypageAreAllValuesSelected(selectedLevels, levelOptions)) {
    const selectedSet = new Set(selectedLevels);
    rows = rows.filter((row) => {
      const level = mypageGetNumericValue(row.original_level);
      return level !== null && selectedSet.has(String(level));
    });
  }

  rows = rows.filter((row) => {
    const rowMin = mypageGetNumericValue(row.bpm_min);
    const rowMax = mypageGetNumericValue(row.bpm_max);
    return rowMin !== null
      && rowMax !== null
      && rowMin >= mypageState.bpmMinFilter
      && rowMax <= mypageState.bpmMaxFilter;
  });

  rows = rows.filter((row) => {
    const predicted = mypageGetNumericValue(row.calibrated_pred_skill);
    return predicted !== null
      && predicted >= mypageState.predMinFilter
      && predicted <= mypageState.predMaxFilter;
  });

  const featureOptions = mypageGetFeatureOptions();
  if (mypageState.featureFilter && !mypageHasNoFeatureFilters(featureOptions)) {
    rows = rows.filter((row) => {
      const rowFeatures = new Set(mypageGetRowFeatures(row));
      return featureOptions.every((feature) => {
        const modes = mypageState.featureFilter[feature];
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

  return rows.slice().sort((left, right) => {
    const result = mypageCompareValues(left, right, mypageState.sortKey);
    if (result !== 0) {
      return mypageState.sortDir === "asc" ? result : -result;
    }
    return (left.__order ?? 0) - (right.__order ?? 0);
  });
}

function mypageFormatBpm(minValue, maxValue) {
  const minText = String(minValue ?? "").trim();
  const maxText = String(maxValue ?? "").trim();
  const min = mypageGetNumericValue(minText);
  const max = mypageGetNumericValue(maxText);
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

function mypageFormatBpmCell(minValue, maxValue) {
  const text = mypageFormatBpm(minValue, maxValue);
  if (!text.includes("~")) {
    return mypageEscapeHtml(text);
  }
  const parts = text.split("~", 2);
  return [
    '<span class="bpm-range">',
    '<span class="bpm-range__min">', mypageEscapeHtml(parts[0]), "~</span>",
    '<span class="bpm-range__max">', mypageEscapeHtml(parts[1]), "</span>",
    "</span>",
  ].join("");
}

function mypageRenderFeatureChips(row) {
  const features = mypageGetRawRowFeatures(row);
  if (features.length === 0) {
    return "";
  }
  return '<div class="feature-chips">' + features.map((feature) => {
    const plusCount = (feature.match(/\+/g) ?? []).length;
    const colorLevel = Math.min(3, plusCount);
    return '<span class="feature-chip feature-chip--plus-' + colorLevel + '">'
      + mypageEscapeHtml(feature) + "</span>";
  }).join("") + "</div>";
}

function mypageGetChartPageHref(chartId) {
  return "chart-pages/" + encodeURIComponent(String(chartId ?? "").trim()) + ".html";
}

function mypageRenderTable(rows) {
  mypageElements.tableBody.innerHTML = rows.map((row) => {
    const difficulty = String(row.difficulty ?? "").toUpperCase();
    const difficultyClass = mypageDifficultyClasses[difficulty] ?? "";
    const difficultyText = mypageDifficultyLabels[difficulty] ?? difficulty;
    const originalText = "☆" + (row.original_level ?? "");
    const predictedText = mypageFormatPredValue(row.calibrated_pred_skill)
      ?? row.calibrated_pred_skill ?? "";
    const status = mypageGetStatus(row);
    const levelColorStyle = getNumericColorStyle(
      row.original_level,
      mypageState.predDataMin,
      mypageState.predDataMax,
    );
    const predictedColorStyle = getNumericColorStyle(
      row.calibrated_pred_skill,
      mypageState.predDataMin,
      mypageState.predDataMax,
    );
    const titleHref = mypageGetChartPageHref(row.chart_id);
    const chartId = mypageEscapeHtml(row.chart_id);
    return [
      "<tr>",
      '<td class="mono numeric-value numeric-value--level"', levelColorStyle, ">",
      mypageEscapeHtml(originalText), "</td>",
      '<td class="chart-title-cell"><a class="chart-link ', difficultyClass,
      '" href="', titleHref, '"><span class="chart-title-cell__name">',
      mypageEscapeHtml(row.title ?? ""),
      '</span> <span class="chart-title-cell__difficulty">[',
      mypageEscapeHtml(difficultyText), "]</span></a></td>",
      '<td class="mono numeric-value numeric-value--pred"', predictedColorStyle, ">",
      mypageEscapeHtml(predictedText), "</td>",
      '<td><select class="mypage-status-select" data-chart-id="', chartId,
      '" aria-label="', mypageEscapeHtml(row.title ?? ""), 'のクリア状況">',
      mypageStatusOptions(status), "</select></td>",
      '<td class="mono">', mypageFormatBpmCell(row.bpm_min, row.bpm_max), "</td>",
      "<td>", mypageRenderFeatureChips(row), "</td>",
      "</tr>",
    ].join("");
  }).join("");
  for (const select of mypageElements.tableBody.querySelectorAll(".mypage-status-select")) {
    mypageUpdateStatusSelect(select);
  }
}

function mypageGetNumericExtremes(rows, key, fallbackMin, fallbackMax) {
  let min = null;
  let max = null;
  for (const row of rows) {
    const value = mypageGetNumericValue(row[key]);
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

function mypageUpdateAdvancedSummary() {
  const activeValues = [];
  if (mypageState.bpmMinFilter !== 0 || mypageState.bpmMaxFilter !== 999) {
    activeValues.push("BPM:" + mypageState.bpmMinFilter + "~" + mypageState.bpmMaxFilter);
  }
  const predMin = mypageFormatPredValue(mypageState.predMinFilter);
  const predMax = mypageFormatPredValue(mypageState.predMaxFilter);
  const defaultMin = mypageFormatPredValue(mypageState.predDataMin);
  const defaultMax = mypageFormatPredValue(mypageState.predDataMax);
  if (predMin !== defaultMin || predMax !== defaultMax) {
    activeValues.push("Pred:" + predMin + "~" + predMax);
  }
  const text = activeValues.length > 0 ? activeValues.join(" / ") : "詳細絞り込み";
  mypageElements.advancedFilterSummary.textContent = text;
  mypageElements.advancedFilterSummary.title = text;
}

function mypageUpdateRowCount(visibleCount) {
  mypageElements.rowCount.textContent =
    visibleCount.toLocaleString() + "件表示 / " + mypageState.rows.length.toLocaleString() + "件中";
}

function mypageUpdateTableOverflowState() {
  const shell = mypageElements.tableShell;
  shell.classList.toggle("is-overflowing", shell.scrollWidth > shell.clientWidth);
}

function mypageUpdateSortMarks() {
  mypageElements.tableBody.addEventListener("change", mypageHandleStatusChange);
  mypageElements.table.querySelectorAll("thead button[data-sort-key]").forEach((button) => {
    const mark = button.querySelector(".sort-mark");
    if (!mark) {
      return;
    }
    if (mypageState.sortKey !== button.dataset.sortKey) {
      mark.textContent = "";
      return;
    }
    mark.textContent = mypageState.sortDir === "asc" ? "▲" : "▼";
  });
}

function mypageRender() {
  mypageUpdateAdvancedSummary();
  const visibleRows = mypageGetVisibleRows();
  mypageUpdateRowCount(visibleRows.length);
  mypageRenderTable(visibleRows);
  mypageUpdateTableOverflowState();
  mypageUpdateSortMarks();
}

function mypageCancelScheduledRender() {
  if (mypageState.renderTimer !== null) {
    window.clearTimeout(mypageState.renderTimer);
    mypageState.renderTimer = null;
  }
}

function mypageScheduleRender(delay = 60) {
  mypageCancelScheduledRender();
  mypageState.renderTimer = window.setTimeout(() => {
    mypageState.renderTimer = null;
    mypageRender();
  }, delay);
}

function mypageSetSort(key) {
  if (mypageState.sortKey === key) {
    mypageState.sortDir = mypageState.sortDir === "asc" ? "desc" : "asc";
  } else {
    mypageState.sortKey = key;
    mypageState.sortDir = "asc";
  }
  mypageCancelScheduledRender();
  mypageRender();
}

function mypageParseFilterNumber(value, fallback) {
  const numeric = mypageGetNumericValue(value);
  return numeric === null ? fallback : numeric;
}

function mypageClampBpm(value, fallback) {
  return Math.min(999, Math.max(0, mypageParseFilterNumber(value, fallback)));
}

function mypageClampPred(value, fallback) {
  return Math.min(
    mypageState.predDataMax,
    Math.max(mypageState.predDataMin, mypageParseFilterNumber(value, fallback)),
  );
}

function mypageSetPredInputBounds() {
  const min = mypageFormatPredValue(mypageState.predDataMin);
  const max = mypageFormatPredValue(mypageState.predDataMax);
  mypageElements.predMinFilter.min = min;
  mypageElements.predMinFilter.max = max;
  mypageElements.predMaxFilter.min = min;
  mypageElements.predMaxFilter.max = max;
}

function mypageUpdateBpmFilters() {
  mypageState.bpmMinFilter = mypageClampBpm(mypageElements.bpmMinFilter.value, 0);
  mypageState.bpmMaxFilter = mypageClampBpm(mypageElements.bpmMaxFilter.value, 999);
  mypageScheduleRender();
}

function mypageCommitBpmFilters() {
  mypageState.bpmMinFilter = mypageClampBpm(mypageElements.bpmMinFilter.value, 0);
  mypageState.bpmMaxFilter = mypageClampBpm(mypageElements.bpmMaxFilter.value, 999);
  mypageElements.bpmMinFilter.value = String(mypageState.bpmMinFilter);
  mypageElements.bpmMaxFilter.value = String(mypageState.bpmMaxFilter);
  mypageCancelScheduledRender();
  mypageRender();
}

function mypageUpdatePredFilters() {
  mypageState.predMinFilter = mypageClampPred(
    mypageElements.predMinFilter.value,
    mypageState.predDataMin,
  );
  mypageState.predMaxFilter = mypageClampPred(
    mypageElements.predMaxFilter.value,
    mypageState.predDataMax,
  );
  mypageScheduleRender();
}

function mypageCommitPredFilters() {
  mypageState.predMinFilter = Math.round(
    mypageClampPred(mypageElements.predMinFilter.value, mypageState.predDataMin) * 10,
  ) / 10;
  mypageState.predMaxFilter = Math.round(
    mypageClampPred(mypageElements.predMaxFilter.value, mypageState.predDataMax) * 10,
  ) / 10;
  mypageElements.predMinFilter.value = mypageFormatPredValue(mypageState.predMinFilter);
  mypageElements.predMaxFilter.value = mypageFormatPredValue(mypageState.predMaxFilter);
  mypageCancelScheduledRender();
  mypageRender();
}

function mypageCloseOtherFilterDetails(activeDetails) {
  document.querySelectorAll(".mypage-filter-details").forEach((details) => {
    if (details !== activeDetails) {
      details.open = false;
    }
  });
}

function mypageSetupFilterDetails() {
  document.querySelectorAll(".mypage-filter-details").forEach((details) => {
    details.addEventListener("toggle", () => {
      if (details.open) {
        mypageCloseOtherFilterDetails(details);
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
    mypageCloseOtherFilterDetails(target?.closest(".mypage-filter-details") ?? null);
  });
}

function mypageUpdateScrollTopButton() {
  mypageElements.scrollTopButton.hidden = window.scrollY <= 0;
}

function mypageScrollToTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function mypagePopulateFilters() {
  mypageFillValueFilter(
    "statusFilter",
    mypageStatuses,
    mypageElements.statusFilterSummary,
    mypageElements.statusFilterOptions,
  );
  mypageFillValueFilter(
    "levelFilter",
    mypageGetLevelOptions(),
    mypageElements.levelFilterSummary,
    mypageElements.levelFilterOptions,
  );
  mypageFillValueFilter(
    "difficultyFilter",
    mypageGetDifficultyOptions(),
    mypageElements.difficultyFilterSummary,
    mypageElements.difficultyFilterOptions,
  );
  mypageFillFeatureFilter();
}

function mypageBindEvents() {
  mypageElements.searchInput.addEventListener("input", () => {
    mypageState.query = mypageElements.searchInput.value;
    mypageScheduleRender(100);
  });

  mypageElements.bpmMinFilter.addEventListener("input", mypageUpdateBpmFilters);
  mypageElements.bpmMaxFilter.addEventListener("input", mypageUpdateBpmFilters);
  mypageElements.bpmMinFilter.addEventListener("blur", mypageCommitBpmFilters);
  mypageElements.bpmMaxFilter.addEventListener("blur", mypageCommitBpmFilters);
  mypageElements.predMinFilter.addEventListener("input", mypageUpdatePredFilters);
  mypageElements.predMaxFilter.addEventListener("input", mypageUpdatePredFilters);
  mypageElements.predMinFilter.addEventListener("blur", mypageCommitPredFilters);
  mypageElements.predMaxFilter.addEventListener("blur", mypageCommitPredFilters);

  mypageElements.table.querySelectorAll("thead button[data-sort-key]").forEach((button) => {
    button.addEventListener("click", () => mypageSetSort(button.dataset.sortKey));
  });
  mypageElements.scrollTopButton.addEventListener("click", mypageScrollToTop);
  window.addEventListener("scroll", mypageUpdateScrollTopButton, { passive: true });
  window.addEventListener("resize", mypageUpdateTableOverflowState);
  mypageUpdateScrollTopButton();
}

function mypageLoadRows() {
  const csvText = window.__CSV_BUNDLE__;
  if (typeof csvText !== "string") {
    throw new Error("データを読み込めませんでした。");
  }
  const rows = normalizeRows(csvText);
  if (!rows.length) {
    throw new Error("譜面データが空です。");
  }
  return rows;
}

function mypageOpenDatabase() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("このブラウザではローカル保存を利用できません。"));
      return;
    }
    const request = window.indexedDB.open(mypageDatabaseName, mypageDatabaseVersion);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(mypageStoreName)) {
        database.createObjectStore(mypageStoreName, { keyPath: "chartId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("ローカル保存を開けませんでした。"));
  });
}

function mypageReadAllRecords() {
  return new Promise((resolve, reject) => {
    const transaction = mypageState.db.transaction(mypageStoreName, "readonly");
    const request = transaction.objectStore(mypageStoreName).getAll();
    request.onsuccess = () => resolve(request.result ?? []);
    request.onerror = () => reject(request.error ?? new Error("記録を読み込めませんでした。"));
  });
}

function mypageWriteStatus(chartId, status) {
  return new Promise((resolve, reject) => {
    if (!mypageState.db) {
      reject(new Error("ローカル保存を開けませんでした。"));
      return;
    }
    const transaction = mypageState.db.transaction(mypageStoreName, "readwrite");
    const store = transaction.objectStore(mypageStoreName);
    if (status === "unregistered") {
      store.delete(chartId);
    } else {
      store.put({ chartId, status, updatedAt: new Date().toISOString() });
    }
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(
      transaction.error ?? new Error("記録を保存できませんでした。"),
    );
  });
}
function mypageApplyRecords(records) {
  mypageState.records = new Map();
  for (const record of records) {
    const chartId = String(record.chartId ?? "");
    if (/^\d+$/.test(chartId) && mypageStatusValues.has(record.status)) {
      mypageState.records.set(chartId, record);
    }
  }
}

async function mypageHandleStatusChange(event) {
  const select = event.target.closest?.(".mypage-status-select");
  if (!select || !mypageStatusValues.has(select.value)) {
    return;
  }

  const chartId = select.dataset.chartId;
  const previousStatus = mypageState.records.get(chartId)?.status ?? "unregistered";
  const status = select.value;
  select.disabled = true;
  try {
    await mypageWriteStatus(chartId, status);
    if (status === "unregistered") {
      mypageState.records.delete(chartId);
    } else {
      mypageState.records.set(chartId, {
        chartId,
        status,
        updatedAt: new Date().toISOString(),
      });
    }
    mypageUpdateStatusSelect(select);
    mypageRender();
    mypageSetMessage("記録を保存しました。");
  } catch (error) {
    select.value = previousStatus;
    mypageUpdateStatusSelect(select);
    mypageSetMessage(error.message || "記録を保存できませんでした。");
  } finally {
    select.disabled = false;
  }
}
function mypageSetMessage(message) {
  mypageElements.message.textContent = message;
  mypageElements.message.hidden = !message;
}

function mypageInitializeElements() {
  mypageElements.searchInput = document.getElementById("mypageSearchInput");
  mypageElements.statusFilterSummary = document.getElementById("mypageStatusFilterSummary");
  mypageElements.statusFilterOptions = document.getElementById("mypageStatusFilterOptions");
  mypageElements.levelFilterSummary = document.getElementById("mypageLevelFilterSummary");
  mypageElements.levelFilterOptions = document.getElementById("mypageLevelFilterOptions");
  mypageElements.difficultyFilterSummary = document.getElementById("mypageDifficultyFilterSummary");
  mypageElements.difficultyFilterOptions = document.getElementById("mypageDifficultyFilterOptions");
  mypageElements.featureFilterSummary = document.getElementById("mypageFeatureFilterSummary");
  mypageElements.featureFilterOptions = document.getElementById("mypageFeatureFilterOptions");
  mypageElements.bpmMinFilter = document.getElementById("mypageBpmMinFilter");
  mypageElements.bpmMaxFilter = document.getElementById("mypageBpmMaxFilter");
  mypageElements.predMinFilter = document.getElementById("mypagePredMinFilter");
  mypageElements.predMaxFilter = document.getElementById("mypagePredMaxFilter");
  mypageElements.advancedFilterSummary = document.getElementById("mypageAdvancedFilterSummary");
  mypageElements.table = document.getElementById("mypageTable");
  mypageElements.tableBody = document.getElementById("mypageTableBody");
  mypageElements.tableShell = document.getElementById("mypageTableShell");
  mypageElements.rowCount = document.getElementById("mypageRowCount");
  mypageElements.scrollTopButton = document.getElementById("mypageScrollTopButton");
  mypageElements.message = document.getElementById("mypageMessage");
}

async function mypageInitialize() {
  mypageInitializeElements();
  mypageSetupFilterDetails();

  try {
    mypageState.rows = mypageLoadRows();
    const predRange = mypageGetNumericExtremes(
      mypageState.rows,
      "calibrated_pred_skill",
      0,
      999,
    );
    mypageState.predDataMin = predRange.min;
    mypageState.predDataMax = predRange.max;
    mypageState.predMinFilter = predRange.min;
    mypageState.predMaxFilter = predRange.max;
    mypageElements.predMinFilter.value = mypageFormatPredValue(predRange.min);
    mypageElements.predMaxFilter.value = mypageFormatPredValue(predRange.max);
    mypageSetPredInputBounds();
    mypagePopulateFilters();
    mypageBindEvents();
    mypageRender();
  } catch (error) {
    mypageSetMessage(error.message || "マイページを初期化できませんでした。");
    return;
  }

  try {
    mypageState.db = await mypageOpenDatabase();
    mypageApplyRecords(await mypageReadAllRecords());
    mypageRender();
  } catch (error) {
    mypageSetMessage(error.message || "記録を読み込めませんでした。");
  }
}

document.addEventListener("DOMContentLoaded", mypageInitialize);
