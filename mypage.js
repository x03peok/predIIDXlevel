"use strict";

const mypageDatabaseName = "cpi-next-clear-status";
const mypageDatabaseVersion = 3;
const mypageStoreName = "chart-statuses";
const mypageManualMemoStoreName = "manual-targets";
const mypageDailyTargetsStoreName = "daily-targets";
const mypagePageSize = 100;
const mypageFeatureNone = "特徴なし";
const mypageFeatureNames = [
  "BPM変化",
  "チャージノート",
  "ラスト難",
  "皿複合",
  "単鍵ラッシュ",
  "同時押し",
  "物量",
  "連皿",
  "連打",
];
const mypageFeatureDeltaLambda = 10;
const mypageFeatureDeltaIterations = 50;
const mypageFeatureDeltaTolerance = 0.00001;
const mypageFeatureDescriptions = {
  "BPM変化": "激しいBPM変化と、変化周辺の難しい配置が特徴です。",
  "チャージノート": "CN/HCN/BSS/HBSS/MSSと、同時に来る難しい配置が特徴です。",
  "ラスト難": "ラスト数十秒の難易度がそれ以前の平均と比べて高いことが特徴です。",
  "皿複合": "スクラッチと同時に来る鍵盤の難しい配置が特徴です。",
  "単鍵ラッシュ": "1個～2個押し主体の細かい配置が特徴です。",
  "同時押し": "3個以上の横に広い同時押し主体の配置が特徴です。",
  "物量": "曲全体を平均した1秒あたりのノーツ数の多さが特徴です。",
  "連皿": "短い時間に連続するスクラッチの難しさが特徴です。",
  "連打": "同じ鍵盤に連続して降ってくるノーツの難しさが特徴です。",
};
const mypageFeatureNoneDescription = "既定の譜面特徴に強く当てはまらない譜面です。";
const mypagePredNotClearStatuses = new Set(["failed", "assisted", "easy"]);
const mypagePredClearStatuses = new Set(["clear", "hard"]);
const mypagePredModes = {
  easy: { key: "easy_pred_skill", label: "イージーPred", clear: new Set(["easy", "clear", "hard"]), notClear: new Set(["failed", "assisted"]) },
  normal: { key: "calibrated_pred_skill", label: "ノマゲPred", clear: new Set(["clear", "hard"]), notClear: new Set(["failed", "assisted", "easy"]) },
  hard: { key: "hard_pred_skill", label: "ハードPred", clear: new Set(["hard"]), notClear: new Set(["failed", "assisted", "easy", "clear"]) },
};
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
  { value: "failed", label: "FAILED" },
  { value: "assisted", label: "ASSISTED" },
  { value: "easy", label: "EASY" },
  { value: "clear", label: "CLEAR" },
  { value: "hard", label: "HARD以上" },
];
const mypageStatusValues = new Set(mypageStatuses.map(({ value }) => value));
const mypageStoredStatusValues = new Set([...mypageStatusValues, "failed"]);
const mypageRecommendationPageSize = 3;
const mypageUpdateTargetByStatus = Object.freeze({
  failed: { mode: "easy", label: "EASY" },
  assisted: { mode: "easy", label: "EASY" },
  easy: { mode: "normal", label: "CLEAR" },
  clear: { mode: "hard", label: "HARD以上" },
});

const mypageState = {
  rows: [],
  records: new Map(),
  manualMemoIds: new Set(),
  query: "",
  statusFilter: mypageStatuses
    .filter(({ value }) => value !== "unregistered" && value !== "unowned")
    .map(({ value }) => value),
  levelFilter: null,
  difficultyFilter: null,
  featureFilter: null,
  bpmMinFilter: 0,
  bpmMaxFilter: 999,
  predDataMin: 0,
  predDataMax: 999,
  includeUnregistered: false,
  includeUnowned: false,
  rowsByChartId: new Map(),
  sortKey: "original_level",
  sortDir: "asc",
  visibleLimit: mypagePageSize,
  renderTimer: null,
  db: null,
  activeTab: "summary",
  highPredVisibleLimit: 3,
  updateTargetVisibleLimit: 3,
  analysis: null,
  analysisDirty: true,
  storageRefreshPromise: null,
  analyticsStateTracked: false,
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

function mypageGetFeatureDetails(row) {
  const raw = String(row.features ?? "").trim();
  if (!raw || raw === mypageFeatureNone) {
    return [];
  }

  return raw
    .split("、")
    .map((feature) => {
      const trimmed = feature.trim();
      const plusMatch = trimmed.match(/\++$/);
      const plusCount = plusMatch ? plusMatch[0].length : 0;
      const name = trimmed.replace(/\++$/, "").trim();
      return name ? { name, plusCount } : null;
    })
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

    for (const [mode, labelText] of [["include", "含む"], ["exclude", "含まない"]]) {
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
  const status = String(mypageState.records.get(String(row.chart_id))?.status ?? "")
    .trim()
    .toLowerCase();
  return mypageStatusValues.has(status) ? status : "unregistered";
}

function mypageRenderStatusDistribution() {
  const chart = mypageElements.statusDistributionChart;
  const legend = mypageElements.statusDistributionLegend;
  if (!chart || !legend) {
    return;
  }

  const distributions = new Map();
  for (const row of mypageState.rows) {
    const level = mypageGetNumericValue(row.original_level);
    if (level === null) {
      continue;
    }
    if (!distributions.has(level)) {
      distributions.set(level, new Map(mypageStatuses.map(({ value }) => [value, 0])));
    }
    const statusCounts = distributions.get(level);
    const status = mypageGetStatus(row);
    if (statusCounts.has(status)) {
      statusCounts.set(status, statusCounts.get(status) + 1);
    }
  }

  chart.replaceChildren();
  legend.replaceChildren();
  const displayStatuses = mypageStatuses.filter(({ value }) => (
    (value !== "unregistered" || mypageState.includeUnregistered)
    && (value !== "unowned" || mypageState.includeUnowned)
  ));
  const levels = new Set([8, 9, 10, 11, 12]);
  for (const level of distributions.keys()) {
    levels.add(level);
  }

  const chartFragment = document.createDocumentFragment();
  for (const level of [...levels].sort((left, right) => left - right)) {
    const statusCounts = distributions.get(level);
    const total = displayStatuses.reduce((sum, { value }) => sum + (statusCounts?.get(value) ?? 0), 0);

    const group = document.createElement("div");
    group.className = "mypage-status-distribution__bar-group";
    group.setAttribute("role", "listitem");

    const levelLabel = document.createElement("span");
    levelLabel.className = "mypage-status-distribution__label";
    levelLabel.textContent = "☆" + level;
    group.append(levelLabel);

    if (!total) {
      const noData = document.createElement("span");
      noData.className = "mypage-status-distribution__no-data";

      noData.title = "このレベルに表示できる譜面がありません";
      noData.setAttribute("aria-label", "データなし");
      const noDataText = document.createElement("span");
      noDataText.className = "mypage-status-distribution__no-data-text";
      noDataText.textContent = "NO DATA";
      noData.append(noDataText);
      group.append(noData);
      chartFragment.append(group);
      continue;
    }

    const bar = document.createElement("div");
    bar.className = "mypage-status-distribution__bar";
    bar.setAttribute("role", "img");
    const summary = [];
    for (const { value, label } of displayStatuses) {
      const count = statusCounts.get(value) ?? 0;
      if (count <= 0) {
        continue;
      }
      const percentage = count / total * 100;
      const segment = document.createElement("span");
      segment.className = "mypage-status-distribution__segment";
      segment.dataset.status = value;
      segment.style.height = percentage + "%";
      segment.title = label + " " + count + "譜面 (" + (Math.round(percentage * 10) / 10).toFixed(1) + "%)";
      bar.append(segment);
      summary.push(label + " " + count + "譜面");
    }
    bar.setAttribute("aria-label", "Level ☆" + level + "のStatus分布: " + summary.join("、"));
    group.append(bar);
    chartFragment.append(group);
  }
  chart.append(chartFragment);

  const legendFragment = document.createDocumentFragment();
  for (const { value, label } of displayStatuses) {
    const item = document.createElement("span");
    item.className = "mypage-status-distribution__legend-item";
    item.setAttribute("role", "listitem");
    const swatch = document.createElement("span");
    swatch.className = "mypage-status-distribution__swatch";
    swatch.dataset.status = value;
    swatch.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.textContent = label;
    item.append(swatch, text);
    legendFragment.append(item);
  }
  legend.append(legendFragment);
}
function mypageStatusOptions(selected) {
  return mypageStatuses.map(({ value, label }) => (
    '<option value="' + value + '"' + (value === selected ? ' selected' : '') + ">" + label + "</option>"
  )).join("");
}

function mypageStatusOption(selected) {
  const status = mypageStatuses.find(({ value }) => value === selected) ?? mypageStatuses[0];
  return '<option value="' + status.value + '" selected>' + status.label + "</option>";
}

function mypagePrepareStatusSelect(select) {
  if (!select || select.options.length > 1) {
    return;
  }
  const status = mypageStatusValues.has(select.value) ? select.value : "unregistered";
  select.innerHTML = mypageStatusOptions(status);
}

function mypageCompactStatusSelect(select) {
  if (!select || select.options.length <= 1) {
    return;
  }
  const status = mypageStatusValues.has(select.value) ? select.value : "unregistered";
  select.innerHTML = mypageStatusOption(status);
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
  if (key === "current_pred") {
    const leftMode = mypageGetCurrentPredMode(mypageGetStatus(left));
    const rightMode = mypageGetCurrentPredMode(mypageGetStatus(right));
    const leftValue = leftMode ? left[mypagePredModes[leftMode].key] : null;
    const rightValue = rightMode ? right[mypagePredModes[rightMode].key] : null;
    return mypageCompareNumericValues(leftValue, rightValue);
  }
  if (key === "bpm") {
    const bpmKey = mypageState.sortDir === "desc" ? "bpm_max" : "bpm_min";
    return mypageCompareNumericValues(left[bpmKey], right[bpmKey]);
  }
  if (key === "original_level") {
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

  const selectedStatuses = mypageState.statusFilter ?? [];
  if (selectedStatuses.length === 0) {
    return [];
  }
  if (!mypageAreAllValuesSelected(selectedStatuses, mypageStatuses)) {
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
    const tooltip = ' data-tooltip="' + mypageEscapeHtml(mypageFeatureNoneDescription) + '"'
      + ' tabindex="0" role="button" aria-label="特徴の説明"';
    return '<div class="feature-chips"><span class="feature-chip feature-chip--none"' + tooltip + '>特徴なし</span></div>';
  }
  return '<div class="feature-chips">' + features.map((feature) => {
    const plusCount = (feature.match(/\+/g) ?? []).length;
    const colorLevel = Math.min(3, plusCount);
    const featureName = feature.replace(/\+{1,2}$/, "");
    const description = mypageFeatureDescriptions[featureName] ?? "";
    const tooltip = description
      ? ' data-tooltip="' + mypageEscapeHtml(description) + '"'
        + ' tabindex="0" role="button" aria-label="' + mypageEscapeHtml(feature + "の説明") + '"'
      : "";
    return '<span class="feature-chip feature-chip--plus-' + colorLevel + '"' + tooltip + '>'
      + mypageEscapeHtml(feature) + "</span>";
  }).join("") + "</div>";
}
function mypageGetChartPageHref(chartId) {
  return "chart-pages/" + encodeURIComponent(String(chartId ?? "").trim()) + ".html";
}

function mypageRenderMemoCheckbox(row) {
  const chartId = mypageEscapeHtml(row.chart_id);
  const title = mypageEscapeHtml(row.title ?? "");
  const checked = mypageState.manualMemoIds.has(String(row.chart_id));
  const action = checked ? "手動メモから削除" : "手動メモに登録";
  return '<input class="memo-checkbox mypage-memo-checkbox" type="checkbox" data-chart-id="'
    + chartId + '"' + (checked ? " checked" : "")
    + ' aria-label="' + title + "を" + action + '" title="' + action + '">';
}

function mypageRenderPredStack(row) {
  const bounds = mypageGetPredBounds("overall");
  return `<div class="mypage-pred-stack">${Object.entries(mypagePredModes).map(([mode, definition]) => {
    const value = row[definition.key];
    const formatted = mypageFormatPredValue(value) ?? value ?? "";
    const color = getNumericColorStyle(value, bounds.min, bounds.max);
    return `<span class="mypage-pred-stack__item mypage-pred-stack__item--${mode}"><span>${definition.label}</span><strong class="numeric-value numeric-value--pred"${color}>${mypageEscapeHtml(formatted)}</strong></span>`;
  }).join("")}</div>`;
}


function mypageGetCurrentPredMode(status) {
  if (status === "easy") return "easy";
  if (status === "clear") return "normal";
  if (status === "hard") return "hard";
  return null;
}
function mypageRenderCurrentPredCell(row, status) {
  const mode = mypageGetCurrentPredMode(status);
  const value = mode ? mypageGetNumericValue(row[mypagePredModes[mode].key]) : null;
  const text = value === null ? "ー" : (mypageFormatPredValue(value) ?? "ー");
  const color = value === null
    ? ""
    : getNumericColorStyle(value, mypageState.predDataMin - 0.5, mypageState.predDataMax + 1.0);
  return '<td class="mono numeric-value numeric-value--pred mypage-current-pred"' + color + ">" + mypageEscapeHtml(text) + "</td>";
}
function mypageRenderTableRow(row) {
  const difficulty = String(row.difficulty ?? "").toUpperCase();
  const difficultyClass = mypageDifficultyClasses[difficulty] ?? "";
  const difficultyText = mypageDifficultyLabels[difficulty] ?? difficulty;
  const originalText = "☆" + (row.original_level ?? "");
  const status = mypageGetStatus(row);
  const levelColorStyle = getNumericColorStyle(row.original_level, mypageState.predDataMin, mypageState.predDataMax);
  const titleHref = mypageGetChartPageHref(row.chart_id);
  const chartId = mypageEscapeHtml(row.chart_id);

  return [
    "<tr>",
    '<td class="memo-cell">', mypageRenderMemoCheckbox(row), "</td>",
    '<td class="mono numeric-value numeric-value--level"', levelColorStyle, ">",
    mypageEscapeHtml(originalText), "</td>",
    '<td class="chart-title-cell"><a class="chart-link ', difficultyClass,
    '" href="', titleHref, '"><span class="chart-title-cell__name">',
    mypageEscapeHtml(row.title ?? ""),
    '</span> <span class="chart-title-cell__difficulty">[','',
    mypageEscapeHtml(difficultyText), "]</span></a></td>",
    '<td><select class="mypage-status-select" data-status="', mypageEscapeHtml(status),
    '" data-chart-id="', chartId,
    '" aria-label="', mypageEscapeHtml(row.title ?? ""), 'のクリア状況">',
    mypageStatusOption(status), "</select></td>",
    mypageRenderCurrentPredCell(row, status),
    '<td class="mono">', mypageFormatBpmCell(row.bpm_min, row.bpm_max), "</td>",
    "<td>", mypageRenderFeatureChips(row), "</td>",
    "</tr>",
  ].join("");
}

function mypageRenderTable(rows) {
  mypageElements.tableBody.innerHTML = rows.map(mypageRenderTableRow).join("");
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

function mypageSigmoid(value) {
  if (value >= 0) {
    return 1 / (1 + Math.exp(-value));
  }
  const exponential = Math.exp(value);
  return exponential / (1 + exponential);
}

function mypageFormatPredRange(lower, upper) {
  const lowerText = mypageFormatPredValue(lower);
  const upperText = mypageFormatPredValue(upper);
  return lowerText === upperText ? lowerText : lowerText + "-" + upperText;
}

function mypageGetPredObservations(mode = "normal") {
  const observations = [];
  const modes = mode === "overall" ? Object.values(mypagePredModes) : [mypagePredModes[mode] ?? mypagePredModes.normal];
  for (const [chartId, record] of mypageState.records) {
    const row = mypageState.rowsByChartId.get(String(chartId));
    const status = String(record?.status ?? "").toLowerCase();
    for (const modeDefinition of modes) {
      const pred = mypageGetNumericValue(row?.[modeDefinition.key]);
      const outcome = modeDefinition.clear.has(status)
        ? 1
        : modeDefinition.notClear.has(status)
          ? 0
          : null;
      if (row && pred !== null && outcome !== null) {
        observations.push({ row, pred, outcome, mode: modeDefinition.key });
      }
    }
  }
  return observations;
}

function mypageBuildPredInsufficientResult(observations, counts, message) {
  return {
    range: "ー",
    rangeLower: null,
    rangeUpper: null,
    rangePrefix: "",
    rangeQualifier: "",
    message,
    model: null,
    usedLogistic: false,
    observations,
    counts,
  };
}

function mypageBuildPredProvisionalResult(observations, counts) {
  const highestClearPred = observations
    .filter(({ outcome }) => outcome === 1)
    .reduce((maximum, { pred }) => Math.max(maximum, pred), -Infinity);
  if (!Number.isFinite(highestClearPred)) {
    return mypageBuildPredInsufficientResult(
      observations,
      counts,
      "有効回答が増えると詳細推定に切り替わります",
    );
  }
  return {
    range: "暫定" + mypageFormatPredValue(highestClearPred),
    rangeLower: highestClearPred,
    rangeUpper: null,
    rangePrefix: "暫定",
    rangeQualifier: "",
    message: "有効回答が増えると詳細推定に切り替わります",
    model: null,
    usedLogistic: false,
    observations,
    counts,
  };
}
function mypageGetPredBounds(mode = "normal") {
  const keys = mode === "overall"
    ? Object.values(mypagePredModes).map((definition) => definition.key)
    : [mypagePredModes[mode]?.key ?? mypagePredModes.normal.key];
  const values = mypageState.rows
    .flatMap((row) => keys.map((key) => mypageGetNumericValue(row[key])))
    .filter((value) => value !== null);
  return {
    min: values.length ? Math.min(...values) : mypageState.predDataMin,
    max: values.length ? Math.max(...values) : mypageState.predDataMax,
  };
}

function mypageGetPredModeNameFromKey(modeKey) {
  const entry = Object.entries(mypagePredModes)
    .find(([, definition]) => definition.key === modeKey);
  return entry?.[0] ?? "normal";
}

function mypageApplyCalculationClearRules(observations, modelsByMode = new Map()) {
  const highestClearPredByMode = new Map();
  observations.forEach((observation) => {
    if (observation.outcome !== 1) {
      return;
    }
    const modeKey = observation.mode ?? mypagePredModes.normal.key;
    const highest = highestClearPredByMode.get(modeKey);
    if (!Number.isFinite(highest) || observation.pred > highest) {
      highestClearPredByMode.set(modeKey, observation.pred);
    }
  });

  return observations.map((observation) => {
    const modeKey = observation.mode ?? mypagePredModes.normal.key;
    const highestClearPred = highestClearPredByMode.get(modeKey);
    let outcome = observation.outcome;
    if (outcome === 0
      && Number.isFinite(highestClearPred)
      && observation.pred < highestClearPred - 2) {
      outcome = 1;
    }
    const model = modelsByMode.get(modeKey);
    if (outcome === 0 && model) {
      const normalizedPred = (observation.pred - model.center) / model.scale;
      const probability = mypageSigmoid(model.intercept + model.slope * normalizedPred);
      if (probability >= 0.95) {
        outcome = 1;
      }
    }
    if (outcome === observation.outcome) {
      return observation;
    }
    return { ...observation, outcome, calculationOnlyClear: true };
  });
}

function mypageFitLogisticModel(observations, bounds) {
  const center = observations.reduce((sum, { pred }) => sum + pred, 0) / observations.length;
  const variance = observations.reduce((sum, { pred }) => sum + (pred - center) ** 2, 0) / observations.length;
  const scale = Math.max(Math.sqrt(variance), 0.25);
  const clearCount = observations.filter(({ outcome }) => outcome === 1).length;
  const clearRate = Math.min(0.95, Math.max(0.05, clearCount / observations.length));
  let intercept = Math.log(clearRate / (1 - clearRate));
  let slope = -1;
  const regularization = 0.03;

  for (let iteration = 0; iteration < 80; iteration += 1) {
    let gradientIntercept = 0;
    let gradientSlope = regularization * slope;
    let hessianIntercept = 0;
    let hessianCross = 0;
    let hessianSlope = regularization;

    for (const observation of observations) {
      const normalizedPred = (observation.pred - center) / scale;
      const probability = mypageSigmoid(intercept + slope * normalizedPred);
      const weight = Math.max(probability * (1 - probability), 1e-5);
      const residual = probability - observation.outcome;
      gradientIntercept += residual;
      gradientSlope += residual * normalizedPred;
      hessianIntercept += weight;
      hessianCross += weight * normalizedPred;
      hessianSlope += weight * normalizedPred * normalizedPred;
    }

    const determinant = hessianIntercept * hessianSlope - hessianCross ** 2;
    if (!Number.isFinite(determinant) || determinant <= 1e-8) {
      return null;
    }
    const stepIntercept = (hessianSlope * gradientIntercept - hessianCross * gradientSlope) / determinant;
    const stepSlope = (-hessianCross * gradientIntercept + hessianIntercept * gradientSlope) / determinant;
    if (!Number.isFinite(stepIntercept) || !Number.isFinite(stepSlope)) {
      return null;
    }
    intercept = Math.max(-30, Math.min(30, intercept - stepIntercept));
    slope = Math.max(-30, Math.min(30, slope - stepSlope));
    if (Math.abs(stepIntercept) + Math.abs(stepSlope) < 1e-5) {
      break;
    }
  }

  const fittedSlope = slope;
  slope = Math.min(-0.05, slope);
  const threshold = center + (-intercept / slope) * scale;
  const predAt60 = center + (Math.log(0.6 / 0.4) - intercept) / slope * scale;
  const predAt40 = center + (Math.log(0.4 / 0.6) - intercept) / slope * scale;
  const rangeValues = [predAt60, predAt40];
  const hasValidRange = rangeValues.every(Number.isFinite);
  const rangeWidth = hasValidRange ? Math.abs(predAt40 - predAt60) : Infinity;
  const thresholdInBounds = Number.isFinite(threshold)
    && threshold > bounds.min
    && threshold < bounds.max;
  if (
    !Number.isFinite(intercept)
    || !Number.isFinite(slope)
    || fittedSlope >= 0
    || !hasValidRange
    || rangeWidth >= bounds.max - bounds.min
    || !thresholdInBounds
  ) {
    return null;
  }
  return { intercept, slope, center, scale };
}

function mypageFitPreliminaryModels(observations) {
  const grouped = new Map();
  observations.forEach((observation) => {
    const modeKey = observation.mode ?? mypagePredModes.normal.key;
    const group = grouped.get(modeKey) ?? [];
    group.push(observation);
    grouped.set(modeKey, group);
  });
  const modelsByMode = new Map();
  grouped.forEach((group, modeKey) => {
    const observedChartCount = new Set(group.map(({ row }) => String(row.chart_id ?? ""))).size;
    const clearObservations = group.filter(({ outcome }) => outcome === 1);
    const notClearObservations = group.filter(({ outcome }) => outcome === 0);
    if (observedChartCount < 5 || clearObservations.length === 0 || notClearObservations.length === 0) {
      return;
    }
    const clearAverage = clearObservations.reduce((sum, { pred }) => sum + pred, 0) / clearObservations.length;
    const notClearAverage = notClearObservations.reduce((sum, { pred }) => sum + pred, 0) / notClearObservations.length;
    if (clearAverage > notClearAverage) {
      return;
    }
    const mode = mypageGetPredModeNameFromKey(modeKey);
    const model = mypageFitLogisticModel(group, mypageGetPredBounds(mode));
    if (model) {
      modelsByMode.set(modeKey, model);
    }
  });
  return modelsByMode;
}

function mypagePreparePredObservations(mode = "normal") {
  const rawObservations = mypageGetPredObservations(mode);
  const thresholdedObservations = mypageApplyCalculationClearRules(rawObservations);
  const preliminaryModels = mypageFitPreliminaryModels(thresholdedObservations);
  return mypageApplyCalculationClearRules(rawObservations, preliminaryModels);
}

function mypageFitPredRegression(mode = "normal") {
  const observations = mypagePreparePredObservations(mode);
  const counts = {
    total: observations.length,
    clear: observations.filter(({ outcome }) => outcome === 1).length,
    notClear: observations.filter(({ outcome }) => outcome === 0).length,
  };
  const observedChartCount = new Set(observations.map(({ row }) => String(row.chart_id ?? ""))).size;
  if (observedChartCount < 5) {
    return mypageBuildPredInsufficientResult(
      observations,
      counts,
      "プレイした譜面を5件以上登録すると推定されます",
    );
  }

  const bounds = mypageGetPredBounds(mode);
  if (counts.clear === 0) {
    return {
      range: mypageFormatPredValue(bounds.min) + "未満",
      rangeLower: bounds.min,
      rangeQualifier: "未満",
      message: "クリア曲数不足により推定できませんでした",
      model: null,
      usedLogistic: false,
      observations,
      counts,
    };
  }
  if (counts.notClear === 0) {
    return {
      range: mypageFormatPredValue(bounds.max) + "以上",
      rangeLower: bounds.max,
      rangeQualifier: "以上",
      message: "未クリア曲数不足により推定できませんでした。ノマゲ以下の未登録譜面があれば登録してください",
      model: null,
      usedLogistic: false,
      observations,
      counts,
    };
  }

  const clearPredAverage = observations
    .filter(({ outcome }) => outcome === 1)
    .reduce((sum, { pred }) => sum + pred, 0) / counts.clear;
  const notClearPredAverage = observations
    .filter(({ outcome }) => outcome === 0)
    .reduce((sum, { pred }) => sum + pred, 0) / counts.notClear;
  if (clearPredAverage > notClearPredAverage) {
    return mypageBuildPredProvisionalResult(observations, counts);
  }

  const model = mypageFitLogisticModel(observations, bounds);
  if (!model) {
    return mypageBuildPredProvisionalResult(observations, counts);
  }
  const predAt60 = model.center + (Math.log(0.6 / 0.4) - model.intercept) / model.slope * model.scale;
  const predAt40 = model.center + (Math.log(0.4 / 0.6) - model.intercept) / model.slope * model.scale;
  const lower = Math.min(bounds.max, Math.max(bounds.min, Math.min(predAt60, predAt40)));
  const upper = Math.min(bounds.max, Math.max(bounds.min, Math.max(predAt60, predAt40)));
  return {
    range: mypageFormatPredRange(lower, upper),
    rangeLower: lower,
    rangeUpper: upper,
    rangePrefix: "",
    rangeQualifier: "",
    message: "",
    model,
    usedLogistic: true,
    observations,
    counts,
  };
}

function mypageFeatureStrength(plusCount) {
  if (plusCount >= 2) {
    return 2;
  }
  if (plusCount === 1) {
    return 1.5;
  }
  return 1;
}

function mypageGetFeatureVector(row) {
  const vector = new Array(mypageFeatureNames.length).fill(0);
  mypageGetFeatureDetails(row).forEach((feature) => {
    const index = mypageFeatureNames.indexOf(feature.name);
    if (index >= 0) {
      vector[index] += mypageFeatureStrength(feature.plusCount);
    }
  });
  return vector;
}

function mypageSolveLinearSystem(matrix, values) {
  const size = values.length;
  const augmented = matrix.map((row, index) => [...row, values[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivotRow = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivotRow][column])) {
        pivotRow = row;
      }
    }
    if (Math.abs(augmented[pivotRow][column]) < 0.0000000001) {
      return null;
    }
    [augmented[column], augmented[pivotRow]] = [augmented[pivotRow], augmented[column]];
    const pivot = augmented[column][column];
    for (let index = column; index <= size; index += 1) {
      augmented[column][index] /= pivot;
    }
    for (let row = 0; row < size; row += 1) {
      if (row === column) {
        continue;
      }
      const factor = augmented[row][column];
      if (factor === 0) {
        continue;
      }
      for (let index = column; index <= size; index += 1) {
        augmented[row][index] -= factor * augmented[column][index];
      }
    }
  }
  return augmented.map((row) => row[size]);
}

function mypageFitFeatureDeltas(observations, model) {
  const deltas = new Array(mypageFeatureNames.length).fill(0);
  if (!model) {
    return deltas;
  }
  const samples = observations
    .map((observation) => ({
      pred: observation.pred,
      outcome: observation.outcome,
      vector: mypageGetFeatureVector(observation.row),
    }))
    .filter((sample) => sample.vector.some((value) => value > 0));
  if (samples.length === 0) {
    return deltas;
  }

  const modelDerivativePerPred = model.slope / model.scale;
  for (let iteration = 0; iteration < mypageFeatureDeltaIterations; iteration += 1) {
    const gradient = new Array(mypageFeatureNames.length).fill(0);
    const hessian = Array.from(
      { length: mypageFeatureNames.length },
      () => new Array(mypageFeatureNames.length).fill(0),
    );

    samples.forEach((sample) => {
      const adjustment = sample.vector.reduce((total, strength, index) => total + deltas[index] * strength, 0);
      const normalizedPred = (sample.pred + adjustment - model.center) / model.scale;
      const probability = mypageSigmoid(model.intercept + model.slope * normalizedPred);
      const residual = probability - sample.outcome;
      const curvature = Math.max(probability * (1 - probability), 0.00001);
      sample.vector.forEach((leftStrength, leftIndex) => {
        gradient[leftIndex] += residual * modelDerivativePerPred * leftStrength;
        sample.vector.forEach((rightStrength, rightIndex) => {
          hessian[leftIndex][rightIndex] += curvature
            * modelDerivativePerPred
            * modelDerivativePerPred
            * leftStrength
            * rightStrength;
        });
      });
    });

    for (let index = 0; index < mypageFeatureNames.length; index += 1) {
      gradient[index] += 2 * mypageFeatureDeltaLambda * deltas[index];
      hessian[index][index] += 2 * mypageFeatureDeltaLambda;
    }

    const step = mypageSolveLinearSystem(hessian, gradient);
    if (!step) {
      break;
    }
    let largestStep = 0;
    for (let index = 0; index < deltas.length; index += 1) {
      const next = deltas[index] - step[index];
      if (!Number.isFinite(next)) {
        return new Array(mypageFeatureNames.length).fill(0);
      }
      deltas[index] = next;
      largestStep = Math.max(largestStep, Math.abs(step[index]));
    }
    if (largestStep < mypageFeatureDeltaTolerance) {
      break;
    }
  }
  return deltas;
}

function mypageGetFeatureScores(observations, model, featureDeltas = null) {
  const deltas = Array.isArray(featureDeltas)
    ? featureDeltas
    : mypageFitFeatureDeltas(observations, model);
  return mypageFeatureNames.map((feature, index) => {
    const known = observations.reduce((count, observation) => count
      + (mypageGetFeatureDetails(observation.row).some((item) => item.name === feature) ? 1 : 0), 0);
    const delta = Number.isFinite(deltas[index]) ? deltas[index] : 0;
    const score = Math.max(0, Math.min(100, 50 - delta * 100));
    return { name: feature, score, delta, known };
  });
}
function mypageRenderFeatureResult(predResult, precomputedScores = null) {
  const section = mypageElements.featureResult;
  const bars = mypageElements.featureBars;
  if (!section || !bars) {
    return;
  }

  if (predResult?.usedLogistic !== true) {
    bars.replaceChildren();
    section.hidden = true;
    return;
  }
  const observations = Array.isArray(predResult?.observations)
    ? predResult.observations
    : [];
  if (observations.length < 5) {
    bars.replaceChildren();
    section.hidden = true;
    return;
  }

  const scores = (Array.isArray(precomputedScores)
    ? precomputedScores
    : mypageGetFeatureScores(observations, predResult.model))
    .map((score, order) => ({ ...score, order }))
    .sort((left, right) => right.score - left.score || left.order - right.order);
  const scale = [
    '<div class="mypage-feature-bars__scale" aria-hidden="true">',
    '  <span></span>',
    '  <div class="mypage-feature-bars__scale-track"><span>不得意</span><span>得意</span></div>',
    '</div>',
  ].join("");

  const rows = scores.map((score) => {
    const description = mypageFeatureDescriptions[score.name] ?? "";
    const tooltip = description
      ? ' data-tooltip="' + mypageEscapeHtml(description) + '"'
        + ' tabindex="0" role="button" aria-label="' + mypageEscapeHtml(score.name + "の説明") + '"'
      : "";
    const chip = '<span class="feature-chip feature-chip--plus-0"' + tooltip + '>' +
      mypageEscapeHtml(score.name) + "</span>";
    const leftWidth = score.score < 50 ? Math.min(100, (50 - score.score) * 2) : 0;
    const rightWidth = score.score > 50 ? Math.min(100, (score.score - 50) * 2) : 0;
    const status = score.known === 0
      ? "データ不足"
      : score.score >= 55
        ? "得意寄り"
        : score.score <= 45
          ? "不得意寄り"
          : "標準";
    const ariaLabel = score.name + "、" + status;

    return [
      '<div class="mypage-feature-bar-row">',
      '  <div class="mypage-feature-bar-row__label">' + chip + '</div>',
      '  <div class="mypage-feature-bar" role="img" aria-label="' + mypageEscapeHtml(ariaLabel) + '">',
      '    <span class="mypage-feature-bar__track">',
      '      <span class="mypage-feature-bar__half mypage-feature-bar__half--left"><span class="mypage-feature-bar__fill mypage-feature-bar__fill--left" style="width:' + leftWidth.toFixed(1) + '%"></span></span>',
      '      <span class="mypage-feature-bar__half mypage-feature-bar__half--right"><span class="mypage-feature-bar__fill mypage-feature-bar__fill--right" style="width:' + rightWidth.toFixed(1) + '%"></span></span>',
      '      <span class="mypage-feature-bar__center"></span>',
      '    </span>',
      '  </div>',
      '</div>',
    ].join("");
  }).join("");

  bars.innerHTML = scale + rows;
  section.hidden = false;
}


function mypageGetFeatureShareTendencies(scores) {
  const strong = scores
    .filter(({ score }) => score >= 55)
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name, "ja"))
    .map(({ name }) => name);
  const weak = scores
    .filter(({ score }) => score <= 45)
    .sort((left, right) => left.score - right.score || left.name.localeCompare(right.name, "ja"))
    .map(({ name }) => name);
  return { strong: strong.slice(0, 3), weak: weak.slice(0, 3) };
}
function mypageGetPublicUrl() {
  return "https://cpi-next.com/mypage.html?utm_source=x&utm_medium=share&utm_campaign=mypage_result";
}

function mypageBuildShareText(result, scores, lampResults = {}) {
  const tendencies = mypageGetFeatureShareTendencies(scores);
  const bestClear = mypageGetHighPredCandidates()[0] ?? null;
  const lines = [
    "推定適正Pred",
    "   総合: " + (result.range || "ー"),
  ];

  for (const [mode, definition] of Object.entries(mypagePredModes)) {
    lines.push("   " + definition.label + ": " + (lampResults[mode]?.range || "ー"));
  }

  const tendencyLines = [];
  if (tendencies.strong.length) {
    tendencyLines.push("得意傾向: " + tendencies.strong.join("、"));
  }
  if (tendencies.weak.length) {
    tendencyLines.push("不得意傾向: " + tendencies.weak.join("、"));
  }

  if (tendencyLines.length) {
    lines.push("", ...tendencyLines);
  }

  if (bestClear) {
    const difficulty = mypageDifficultyLabels[String(bestClear.row.difficulty ?? "").toUpperCase()]
      ?? String(bestClear.row.difficulty ?? "");
    const marker = bestClear.status === "hard"
      ? "🟥"
      : bestClear.status === "clear"
        ? "🟦"
        : "🟩";
    const predText = Number.isFinite(bestClear.pred) ? bestClear.pred.toFixed(2) : "ー";
    lines.push(
      "",
      "ベストクリア: " + marker + " " + (bestClear.row.title ?? "") + " [" + difficulty + "]",
      "   適正Pred: " + predText,
    );
  }

  lines.push("", mypageGetPublicUrl().replace("https://", "").replace("http://", ""));
  return lines.join("\n");
}
function mypageUpdateShare(shareText) {
  const buttons = [mypageElements.shareButton, mypageElements.shareButtonTop].filter(Boolean);
  if (!buttons.length) {
    return;
  }
  if (!shareText) {
    buttons.forEach((button) => {
      button.hidden = true;
      button.removeAttribute("href");
    });
    return;
  }

  const href = "https://x.com/intent/tweet?"
    + new URLSearchParams({ text: shareText }).toString();
  buttons.forEach((button) => {
    button.href = href;
    button.hidden = false;
  });
}
function mypageRenderPredResult(element, result, scaleMin, scaleMax) {
  element.replaceChildren();
  if (!Number.isFinite(result.rangeLower)) {
    element.textContent = result.range || "ー";
    return;
  }
  const appendValue = (value) => {
    const valueElement = document.createElement("span");
    valueElement.className = "mypage-pred-estimate__value-part";
    valueElement.textContent = mypageFormatPredValue(value);
    const color = getNumericScaleColor(value, scaleMin, scaleMax);
    if (color) valueElement.style.setProperty("--numeric-color", color);
    element.append(valueElement);
  };
  if (result.rangePrefix) element.append(document.createTextNode(result.rangePrefix));
  appendValue(result.rangeLower);
  if (Number.isFinite(result.rangeUpper) && result.rangeUpper !== result.rangeLower) {
    const separator = document.createElement("span");
    separator.className = "mypage-pred-estimate__separator";
    separator.textContent = "-";
    element.append(separator);
    appendValue(result.rangeUpper);
  }
  if (result.rangeQualifier) element.append(document.createTextNode(result.rangeQualifier));
}

function mypageGetStatusLabel(status) {
  return mypageStatuses.find(({ value }) => value === status)?.label ?? "未登録";
}

function mypageGetRecommendationModel(mode, overallResult, lampResults) {
  const lampResult = lampResults?.[mode];
  if (lampResult?.usedLogistic === true && lampResult.model) {
    return lampResult.model;
  }
  if (overallResult?.usedLogistic === true && overallResult.model) {
    return overallResult.model;
  }
  return null;
}

function mypageGetRecommendationAdjustedPred(row, mode, featureDeltas) {
  const definition = mypagePredModes[mode];
  const rawPred = definition ? mypageGetNumericValue(row?.[definition.key]) : null;
  if (rawPred === null) {
    return null;
  }
  if (!Array.isArray(featureDeltas)) {
    return rawPred;
  }
  const adjustment = mypageGetFeatureVector(row)
    .reduce((total, strength, index) => total + (featureDeltas[index] ?? 0) * strength, 0);
  return rawPred + adjustment;
}

function mypageGetRecommendationProbability(row, mode, overallResult, lampResults, featureDeltas) {
  const model = mypageGetRecommendationModel(mode, overallResult, lampResults);
  const adjustedPred = mypageGetRecommendationAdjustedPred(row, mode, featureDeltas);
  if (!model || adjustedPred === null
    || !Number.isFinite(model.intercept)
    || !Number.isFinite(model.slope)
    || !Number.isFinite(model.center)
    || !Number.isFinite(model.scale)
    || model.scale <= 0) {
    return null;
  }
  const normalizedPred = (adjustedPred - model.center) / model.scale;
  return mypageSigmoid(model.intercept + model.slope * normalizedPred);
}

function mypageGetHighPredCandidates() {
  return mypageState.rows
    .map((row) => {
      const status = mypageGetStatus(row);
      const mode = mypageGetCurrentPredMode(status);
      const pred = mode ? mypageGetNumericValue(row[mypagePredModes[mode].key]) : null;
      return mode && pred !== null ? { row, status, mode, pred } : null;
    })
    .filter(Boolean)
    .sort((left, right) => right.pred - left.pred || left.row.__order - right.row.__order);
}

function mypageGetUpdateTargetCandidates(overallResult, lampResults, featureDeltas) {
  if (overallResult?.usedLogistic !== true) {
    return [];
  }

  return mypageState.rows
    .map((row) => {
      const status = mypageGetStatus(row);
      const target = mypageUpdateTargetByStatus[status];
      if (!target) {
        return null;
      }
      const probability = mypageGetRecommendationProbability(
        row,
        target.mode,
        overallResult,
        lampResults,
        featureDeltas,
      );
      const adjustedPred = mypageGetRecommendationAdjustedPred(row, target.mode, featureDeltas);
      return probability === null || adjustedPred === null
        ? null
        : { row, status, target, probability, adjustedPred };
    })
    .filter(Boolean)
    .sort((left, right) => (
      right.probability - left.probability
      || right.adjustedPred - left.adjustedPred
      || left.row.__order - right.row.__order
    ));
}

function mypageGetUpdateTargetQualityMessage(updateTargetCandidates) {
  const playedStatuses = new Set(["failed", "assisted", "easy", "clear", "hard"]);
  const playedCount = mypageState.rows.reduce(
    (count, row) => count + (playedStatuses.has(mypageGetStatus(row)) ? 1 : 0),
    0,
  );
  const highProbabilityCount = updateTargetCandidates.filter(({ probability }) => (
    Number.isFinite(probability) && probability >= 0.95
  )).length;
  return highProbabilityCount > Math.max(10, playedCount / 10)
    ? "プレイ済み譜面を埋め直すと、現在の実力を推測する精度が上がる可能性があります"
    : "";
}
function mypageGetRecommendationTitleHtml(row) {
  const difficulty = String(row.difficulty ?? "").toUpperCase();
  const difficultyClass = mypageDifficultyClasses[difficulty] ?? "";
  const difficultyText = mypageDifficultyLabels[difficulty] ?? difficulty;
  const href = mypageEscapeHtml(mypageGetChartPageHref(row.chart_id));
  return '<a class="chart-link ' + difficultyClass + ' mypage-recommendation-card__title" href="' + href + '">'
    + '<span class="chart-title-cell__name">' + mypageEscapeHtml(row.title ?? "") + '</span>'
    + ' <span class="chart-title-cell__difficulty">[' + mypageEscapeHtml(difficultyText) + ']</span>'
    + '</a>';
}

function mypageRenderHighPredStatusLabel(status) {
  const label = mypageGetStatusLabel(status);
  if (status === "hard" && label === "HARD以上") {
    return '<span>HARD</span><span class="target-recommendation-status__suffix">以上</span>';
  }
  return mypageEscapeHtml(label);
}
function mypageRenderHighPredCard(candidate) {
  const row = candidate.row;
  const predText = Number.isFinite(candidate.pred)
    ? candidate.pred.toFixed(2)
    : String(candidate.pred);
  const predColor = getNumericColorStyle(
    candidate.pred,
    mypageGetPredBounds(candidate.mode).min,
    mypageGetPredBounds(candidate.mode).max,
  );
  return [
    '<article class="mypage-recommendation-card mypage-recommendation-card--high-pred mypage-recommendation-card--summary">',
    '  <div class="mypage-recommendation-card__header" data-status="' + mypageEscapeHtml(candidate.status) + '" aria-label="クリアランプ"><div class="mypage-recommendation-card__status-line"><span class="target-recommendation-status target-recommendation-status--' + mypageEscapeHtml(candidate.status) + '">' + mypageRenderHighPredStatusLabel(candidate.status) + '</span></div></div>',
    '  ' + mypageGetRecommendationTitleHtml(row),
    '  <div class="mypage-recommendation-card__level-pred"><span class="mypage-recommendation-card__level">☆' + mypageEscapeHtml(row.original_level ?? "") + '</span><span class="mypage-recommendation-card__pred-label">Pred</span><strong class="numeric-value numeric-value--pred"' + predColor + '>' + mypageEscapeHtml(predText) + '</strong></div>',
    '  ' + mypageRenderFeatureChips(row),
    '</article>',
  ].join("");
}

function mypageFormatRecommendationProbability(value) {
  const probability = Number(value);
  if (!Number.isFinite(probability)) {
    return "ー";
  }
  const percent = Math.max(0, Math.min(100, probability * 100));
  const bucket = Math.min(95, Math.floor(percent / 5) * 5);
  return bucket >= 95 ? "95%以上" : bucket + "%～" + (bucket + 5) + "%";
}

function mypageRenderUpdateTargetCard(candidate) {
  const row = candidate.row;
  const targetLabel = candidate.target.mode === "hard" ? "HARD" : candidate.target.label;
  const probabilityText = mypageFormatRecommendationProbability(candidate.probability);
  return [
    '<article class="mypage-recommendation-card mypage-recommendation-card--update mypage-recommendation-card--summary">',
    '  <div class="mypage-recommendation-card__header mypage-recommendation-card__header--combined" aria-label="現在と目標">',
    '    <span class="mypage-recommendation-card__header-status" data-status="' + mypageEscapeHtml(candidate.status) + '"><span class="mypage-recommendation-card__header-status-label">現在：</span><strong class="mypage-recommendation-card__header-status-value">' + mypageRenderHighPredStatusLabel(candidate.status) + '</strong></span>',
    '    <span class="mypage-recommendation-card__header-arrow" aria-hidden="true">→</span>',
    '    <span class="mypage-recommendation-card__header-status" data-status="' + mypageEscapeHtml(candidate.target.mode) + '"><span class="mypage-recommendation-card__header-status-label">目標：</span><strong class="mypage-recommendation-card__header-status-value">' + mypageEscapeHtml(targetLabel) + '</strong></span>',
    '  </div>',
    '  ' + mypageGetRecommendationTitleHtml(row),
    '  <div class="mypage-recommendation-card__level-pred"><span class="mypage-recommendation-card__level">' + mypageEscapeHtml("☆" + (row.original_level ?? "")) + '</span><span class="mypage-recommendation-card__pred-label">更新見込み</span><strong>' + probabilityText + '</strong></div>',
    '  ' + mypageRenderFeatureChips(row),
    '</article>',
  ].join("");
}

function mypageInvalidateAnalysis() {
  mypageState.analysisDirty = true;
}

function mypageBuildAnalysis() {
  const overallResult = mypageFitPredRegression("overall");
  const lampResults = {};
  for (const mode of Object.keys(mypagePredModes)) {
    lampResults[mode] = mypageFitPredRegression(mode);
  }
  const featureDeltas = overallResult.usedLogistic === true
    && Array.isArray(overallResult.observations)
    ? mypageFitFeatureDeltas(overallResult.observations, overallResult.model)
    : null;
  const featureScores = overallResult.usedLogistic === true
    && Array.isArray(overallResult.observations)
    && overallResult.observations.length >= 5
    ? mypageGetFeatureScores(overallResult.observations, overallResult.model, featureDeltas)
    : [];
  const highPredCandidates = mypageGetHighPredCandidates();
  const updateTargetCandidates = mypageGetUpdateTargetCandidates(
    overallResult,
    lampResults,
    featureDeltas,
  );
  const updateTargetQualityMessage = mypageGetUpdateTargetQualityMessage(updateTargetCandidates);
  return {
    overallResult,
    lampResults,
    featureDeltas,
    featureScores,
    highPredCandidates,
    updateTargetCandidates,
    updateTargetQualityMessage,
  };
}

function mypageGetAnalysis() {
  if (!mypageState.analysis || mypageState.analysisDirty) {
    mypageState.analysis = mypageBuildAnalysis();
    mypageState.analysisDirty = false;
  }
  return mypageState.analysis;
}
function mypageRenderRecommendationLists(analysis) {
  const { overallResult } = analysis;
  const highCards = mypageElements.highPredCards;
  const highMore = mypageElements.highPredMore;
  const highMessage = mypageElements.highPredMessage;
  const highCandidates = analysis.highPredCandidates;
  if (highCards && highMore && highMessage) {
    const highVisible = highCandidates.slice(0, mypageState.highPredVisibleLimit);
    highCards.innerHTML = highVisible.map(mypageRenderHighPredCard).join("");
    highMore.hidden = highCandidates.length <= mypageState.highPredVisibleLimit;
    highMessage.hidden = highCandidates.length > 0;
    highMessage.textContent = highCandidates.length > 0
      ? ""
      : "EASY以上のクリアランプを登録すると表示されます。";
  }

  const updateCards = mypageElements.updateTargetCards;
  const updateMore = mypageElements.updateTargetMore;
  const updateMessage = mypageElements.updateTargetMessage;
  if (!updateCards || !updateMore || !updateMessage) {
    return;
  }
  const updateCandidates = analysis.updateTargetCandidates;
  const calculationUnavailable = overallResult?.usedLogistic !== true;
  if (calculationUnavailable) {
    updateCards.replaceChildren();
    updateMore.hidden = true;
    updateMessage.hidden = false;
    updateMessage.textContent = "クリア確率を計算できるデータがありません。クリアランプ登録が増えると表示されます。";
    return;
  }
  const updateVisible = updateCandidates.slice(0, mypageState.updateTargetVisibleLimit);
  updateCards.innerHTML = updateVisible.map(mypageRenderUpdateTargetCard).join("");
  updateMore.hidden = updateCandidates.length <= mypageState.updateTargetVisibleLimit;
  updateMessage.hidden = updateCandidates.length > 0;
  updateMessage.textContent = updateCandidates.length > 0
    ? ""
    : "次のランプ更新を狙えるプレイ済み譜面がありません。";
}
function mypageRenderPredEstimate() {
  const analysis = mypageGetAnalysis();
  const { overallResult, lampResults } = analysis;
  mypageRenderPredResult(
    mypageElements.predEstimate,
    overallResult,
    mypageGetPredBounds("overall").min,
    mypageGetPredBounds("overall").max,
  );
  const note = mypageElements.predEstimateNote;
  const message = analysis.updateTargetQualityMessage || overallResult.message;
  note.replaceChildren();
  if (message) {
    note.append(document.createTextNode(message));
    if (mypageState.records.size === 0) {
      const link = document.createElement("a");
      link.href = "record.html";
      link.textContent = "クリアランプ登録";
      note.append(document.createElement("br"), link, document.createTextNode("を行ってください"));
    }
  }
  note.hidden = !message;
  if (mypageElements.predLampEstimates) {
    mypageElements.predLampEstimates.replaceChildren();
    for (const [mode, definition] of Object.entries(mypagePredModes)) {
      const row = document.createElement("div");
      row.className = "mypage-pred-lamp-row mypage-pred-lamp-row--" + mode;
      const label = document.createElement("span");
      label.className = "mypage-pred-lamp-row__label";
      label.textContent = definition.label.replace(/Pred$/, "");
      const value = document.createElement("span");
      value.className = "mypage-pred-lamp-row__value";
      mypageRenderPredResult(
        value,
        lampResults[mode],
        mypageGetPredBounds(mode).min,
        mypageGetPredBounds(mode).max,
      );
      row.append(label, value);
      mypageElements.predLampEstimates.append(row);
    }
  }
  mypageRenderRecommendationLists(analysis);
  mypageUpdateShare(
    overallResult.usedLogistic === true
      ? mypageBuildShareText(overallResult, analysis.featureScores, lampResults)
      : "",
  );
  mypageRenderStatusDistribution();
  mypageRenderFeatureResult(overallResult, analysis.featureScores);
}
function mypageUpdateSortMarks() {
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

function mypageStatusMatchesFilter(status) {
  const selectedStatuses = mypageState.statusFilter ?? [];
  if (selectedStatuses.length === 0) {
    return false;
  }
  return mypageAreAllValuesSelected(selectedStatuses, mypageStatuses)
    || selectedStatuses.includes(status);
}
function mypageGetMissingSavedIds() {
  const missingIds = new Set();
  [...mypageState.records.keys(), ...mypageState.manualMemoIds].forEach((chartId) => {
    const normalizedChartId = String(chartId ?? "").trim();
    if (normalizedChartId && !mypageState.rowsByChartId.has(normalizedChartId)) {
      missingIds.add(normalizedChartId);
    }
  });
  return missingIds;
}

function mypageUpdateMissingDataMessage() {
  const message = mypageElements.missingDataMessage;
  if (!message) return;
  const count = mypageGetMissingSavedIds().size;
  message.hidden = count === 0;
  message.textContent = count === 0
    ? ""
    : "譜面データなし: " + count.toLocaleString() + "譜面。保存されたクリアランプ・手動メモは保持されていますが、現在の譜面データがないため、表・Pred推定・リコメンドの対象外です。";
}

function mypageTrackStateEvent() {
  if (mypageState.analyticsStateTracked || typeof window.cpiAnalytics?.track !== "function") {
    return;
  }
  const analysis = mypageGetAnalysis();
  const state = mypageState.records.size === 0
    ? "empty"
    : analysis.overallResult?.usedLogistic === true
      ? "ready"
      : "provisional";
  window.cpiAnalytics.track("mypage_state", {
    state,
    registered_count: mypageState.records.size,
  });
  mypageState.analyticsStateTracked = true;
}
function mypageRender() {
  mypageUpdateMissingDataMessage();
  mypageUpdateAdvancedSummary();
  mypageRenderPredEstimate();
  const filteredRows = mypageGetVisibleRows();
  const visibleRows = filteredRows.slice(0, mypageState.visibleLimit);
  mypageUpdateRowCount(visibleRows.length);
  mypageRenderTable(visibleRows);
  mypageElements.loadMoreButton.hidden = visibleRows.length >= filteredRows.length;
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
  mypageState.visibleLimit = mypagePageSize;
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
  mypageState.visibleLimit = mypagePageSize;
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

function mypageSetActiveTab(tabName) {
  const isSummary = tabName !== "detail";
  mypageState.activeTab = isSummary ? "summary" : "detail";
  const tabs = [
    [mypageElements.summaryTab, mypageElements.summaryPanel, isSummary],
    [mypageElements.detailTab, mypageElements.detailPanel, !isSummary],
  ];
  tabs.forEach(([tab, panel, active]) => {
    if (!tab || !panel) {
      return;
    }
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
    tab.tabIndex = active ? 0 : -1;
    panel.hidden = !active;
    panel.setAttribute("aria-hidden", active ? "false" : "true");
  });
}
function mypageBindEvents() {
  [mypageElements.summaryTab, mypageElements.detailTab].forEach((tab) => {
    tab?.addEventListener("click", () => mypageSetActiveTab(tab.dataset.mypageTab));
  });
  mypageElements.highPredMore.addEventListener("click", () => {
    mypageState.highPredVisibleLimit += mypageRecommendationPageSize;
    mypageRender();
  });
  mypageElements.updateTargetMore.addEventListener("click", () => {
    mypageState.updateTargetVisibleLimit += mypageRecommendationPageSize;
    mypageRender();
  });

  mypageElements.searchInput.addEventListener("input", () => {
    mypageState.query = mypageElements.searchInput.value;
    mypageScheduleRender(100);
  });

  mypageElements.bpmMinFilter.addEventListener("input", mypageUpdateBpmFilters);
  mypageElements.bpmMaxFilter.addEventListener("input", mypageUpdateBpmFilters);
  mypageElements.bpmMinFilter.addEventListener("blur", mypageCommitBpmFilters);
  mypageElements.bpmMaxFilter.addEventListener("blur", mypageCommitBpmFilters);
  mypageElements.includeUnregistered.addEventListener("change", () => {
    mypageState.includeUnregistered = mypageElements.includeUnregistered.checked;
    mypageRenderStatusDistribution();
  });
  mypageElements.includeUnowned.addEventListener("change", () => {
    mypageState.includeUnowned = mypageElements.includeUnowned.checked;
    mypageRenderStatusDistribution();
  });

  mypageElements.table.querySelectorAll("thead button[data-sort-key]").forEach((button) => {
    button.addEventListener("click", () => mypageSetSort(button.dataset.sortKey));
  });
  mypageElements.tableBody.addEventListener("pointerdown", (event) => {
    const select = event.target.closest?.(".mypage-status-select");
    mypagePrepareStatusSelect(select);
  });
  mypageElements.tableBody.addEventListener("focusin", (event) => {
    const select = event.target.closest?.(".mypage-status-select");
    mypagePrepareStatusSelect(select);
  });
  mypageElements.tableBody.addEventListener("change", mypageHandleStatusChange);
  mypageElements.tableBody.addEventListener("change", mypageHandleManualMemoChange);
  mypageElements.loadMoreButton.addEventListener("click", () => {
    mypageState.visibleLimit += mypagePageSize;
    mypageRender();
  });
  mypageElements.scrollTopButton.addEventListener("click", mypageScrollToTop);
  window.addEventListener("scroll", mypageUpdateScrollTopButton, { passive: true });
  window.addEventListener("resize", mypageUpdateTableOverflowState);
  const refreshFromStorage = () => {
    void mypageRefreshFromStorage();
  };
  window.addEventListener("pageshow", refreshFromStorage);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      refreshFromStorage();
    }
  });
  window.addEventListener("focus", refreshFromStorage);
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
      if (!database.objectStoreNames.contains(mypageManualMemoStoreName)) {
        database.createObjectStore(mypageManualMemoStoreName, { keyPath: "chartId" });
      }
      if (!database.objectStoreNames.contains(mypageDailyTargetsStoreName)) {
        database.createObjectStore(mypageDailyTargetsStoreName, { keyPath: "date" });
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

function mypageReadAllManualMemos() {
  return new Promise((resolve, reject) => {
    const transaction = mypageState.db.transaction(mypageManualMemoStoreName, "readonly");
    const request = transaction.objectStore(mypageManualMemoStoreName).getAll();
    request.onsuccess = () => resolve(request.result ?? []);
    request.onerror = () => reject(request.error ?? new Error("手動メモを読み込めませんでした。"));
  });
}

function mypageWriteManualMemo(chartId, registered) {
  return new Promise((resolve, reject) => {
    if (!mypageState.db) {
      reject(new Error("ローカル保存を開けませんでした。"));
      return;
    }
    const transaction = mypageState.db.transaction(mypageManualMemoStoreName, "readwrite");
    const store = transaction.objectStore(mypageManualMemoStoreName);
    if (registered) {
      store.put({ chartId, updatedAt: new Date().toISOString() });
    } else {
      store.delete(chartId);
    }
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(
      transaction.error ?? new Error("手動メモを保存できませんでした。"),
    );
  });
}

function mypageApplyManualMemos(memos) {
  mypageState.manualMemoIds = new Set(
    (memos ?? [])
      .map((memo) => String(memo?.chartId ?? "").trim())
      .filter((chartId) => /^\d+$/.test(chartId)),
  );
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
    const chartId = String(record?.chartId ?? record?.chart_id ?? "").trim();
    const status = String(record?.status ?? record?.clearType ?? "").trim().toLowerCase();
    if (/^\d+$/.test(chartId) && mypageStoredStatusValues.has(status)) {
      mypageState.records.set(chartId, { ...(record ?? {}), chartId, status });
    }
  }
  mypageInvalidateAnalysis();
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
    const row = mypageState.rowsByChartId.get(chartId);
    const currentPredCell = select.closest("tr")?.querySelector(".mypage-current-pred");
    if (row && currentPredCell) currentPredCell.outerHTML = mypageRenderCurrentPredCell(row, status);
    mypageInvalidateAnalysis();
    mypageRender();
    mypageSetMessage("記録を保存しました。");
    window.cpiStatusToast?.show({
      onUndo: async () => {
        await mypageWriteStatus(chartId, previousStatus);
        if (previousStatus === "unregistered") {
          mypageState.records.delete(chartId);
        } else {
          mypageState.records.set(chartId, {
            chartId,
            status: previousStatus,
            updatedAt: new Date().toISOString(),
          });
        }
        mypageInvalidateAnalysis();
        mypageRender();
        mypageSetMessage("記録を元に戻しました。");
      },
    });
  } catch (error) {
    select.value = previousStatus;
    mypageUpdateStatusSelect(select);
    mypageCompactStatusSelect(select);
    mypageSetMessage(error.message || "記録を保存できませんでした。");
  } finally {
    select.disabled = false;
  }
}
async function mypageHandleManualMemoChange(event) {
  const checkbox = event.target.closest?.(".mypage-memo-checkbox");
  if (!checkbox) {
    return;
  }

  const chartId = String(checkbox.dataset.chartId ?? "").trim();
  const row = mypageState.rowsByChartId.get(chartId);
  if (!row || !mypageState.db) {
    checkbox.checked = false;
    return;
  }

  const previousValue = mypageState.manualMemoIds.has(chartId);
  const nextValue = checkbox.checked;
  checkbox.disabled = true;
  try {
    await mypageWriteManualMemo(chartId, nextValue);
    if (nextValue) {
      mypageState.manualMemoIds.add(chartId);
    } else {
      mypageState.manualMemoIds.delete(chartId);
    }
    const action = nextValue ? "手動メモから削除" : "手動メモに登録";
    checkbox.setAttribute("aria-label", row.title + "を" + action);
    checkbox.title = action;
  } catch (error) {
    checkbox.checked = previousValue;
    const action = previousValue ? "手動メモから削除" : "手動メモに登録";
    checkbox.setAttribute("aria-label", row.title + "を" + action);
    checkbox.title = action;
    mypageSetMessage(error.message || "手動メモを保存できませんでした。");
  } finally {
    checkbox.disabled = false;
  }
}

function mypageSetMessage(message) {
  mypageElements.message.textContent = message;
  mypageElements.message.hidden = !message;
}

async function mypageRefreshFromStorage() {
  if (!mypageState.db) {
    return;
  }
  if (mypageState.storageRefreshPromise) {
    return mypageState.storageRefreshPromise;
  }
  mypageState.storageRefreshPromise = Promise.all([
    mypageReadAllRecords(),
    mypageReadAllManualMemos(),
  ])
    .then(([records, memos]) => {
      mypageApplyRecords(records);
      mypageApplyManualMemos(memos);
      mypageRender();
    })
    .catch((error) => {
      mypageSetMessage(error.message || "記録を読み込めませんでした。");
    })
    .finally(() => {
      mypageState.storageRefreshPromise = null;
    });
  return mypageState.storageRefreshPromise;
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
  mypageElements.advancedFilterSummary = document.getElementById("mypageAdvancedFilterSummary");
  mypageElements.table = document.getElementById("mypageTable");
  mypageElements.tableBody = document.getElementById("mypageTableBody");
  mypageElements.tableShell = document.getElementById("mypageTableShell");
  mypageElements.rowCount = document.getElementById("mypageRowCount");
  mypageElements.loadMoreButton = document.getElementById("mypageLoadMoreButton");
  mypageElements.scrollTopButton = document.getElementById("mypageScrollTopButton");
  mypageElements.message = document.getElementById("mypageMessage");
  mypageElements.missingDataMessage = document.getElementById("mypageMissingDataMessage");
  mypageElements.predEstimate = document.getElementById("mypagePredEstimate");
  mypageElements.statusDistributionChart = document.getElementById("mypageStatusDistributionChart");
  mypageElements.statusDistributionLegend = document.getElementById("mypageStatusDistributionLegend");
  mypageElements.featureResult = document.getElementById("mypageFeatureResult");
  mypageElements.featureBars = document.getElementById("mypageFeatureBars");
  mypageElements.includeUnregistered = document.getElementById("mypageIncludeUnregistered");
  mypageElements.includeUnowned = document.getElementById("mypageIncludeUnowned");
  mypageElements.predEstimateNote = document.getElementById("mypagePredEstimateNote");
  mypageElements.predLampEstimates = document.getElementById("mypagePredLampEstimates");
  mypageElements.summaryTab = document.getElementById("mypageSummaryTab");
  mypageElements.detailTab = document.getElementById("mypageDetailTab");
  mypageElements.summaryPanel = document.getElementById("mypageSummaryPanel");
  mypageElements.detailPanel = document.getElementById("mypageDetailPanel");
  mypageElements.highPredCards = document.getElementById("mypageHighPredCards");
  mypageElements.highPredMore = document.getElementById("mypageHighPredMore");
  mypageElements.highPredMessage = document.getElementById("mypageHighPredMessage");
  mypageElements.updateTargetCards = document.getElementById("mypageUpdateTargetCards");
  mypageElements.updateTargetMore = document.getElementById("mypageUpdateTargetMore");
  mypageElements.updateTargetMessage = document.getElementById("mypageUpdateTargetMessage");
  mypageElements.shareButton = document.getElementById("mypageShareButton");
  mypageElements.shareButtonTop = document.getElementById("mypageShareButtonTop");
}

async function mypageInitialize() {
  mypageInitializeElements();
  mypageSetupFilterDetails();

  try {
    mypageState.rows = mypageLoadRows();
    mypageState.rowsByChartId = new Map(
      mypageState.rows.map((row) => [String(row.chart_id ?? "").trim(), row]),
    );
    const predRange = mypageGetNumericExtremes(
      mypageState.rows,
      "calibrated_pred_skill",
      0,
      999,
    );
    mypageState.predDataMin = predRange.min;
    mypageState.predDataMax = predRange.max;
    mypagePopulateFilters();
    mypageBindEvents();
    mypageRender();
  } catch (error) {
    mypageSetMessage(error.message || "マイページを初期化できませんでした。");
    return;
  }

  try {
    mypageState.db = await mypageOpenDatabase();
    await mypageRefreshFromStorage();
    mypageTrackStateEvent();
  } catch (error) {
    mypageSetMessage(error.message || "記録を読み込めませんでした。");
  }
}

document.addEventListener("DOMContentLoaded", mypageInitialize);

