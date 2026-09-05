"use strict";

const mypageDatabaseName = "cpi-next-clear-status";
const mypageDatabaseVersion = 2;
const mypageStoreName = "chart-statuses";
const mypageManualMemoStoreName = "manual-targets";
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
const mypagePredNotClearStatuses = new Set(["failed", "assisted", "easy"]);
const mypagePredClearStatuses = new Set(["clear", "hard"]);
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
  predMinFilter: 0,
  predMaxFilter: 999,
  predDataMin: 0,
  predDataMax: 999,
  includeUnregistered: false,
  includeUnowned: false,
  rowsByChartId: new Map(),
  sortKey: "calibrated_pred_skill",
  sortDir: "asc",
  visibleLimit: mypagePageSize,
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

function mypageRenderMemoCheckbox(row) {
  const chartId = mypageEscapeHtml(row.chart_id);
  const title = mypageEscapeHtml(row.title ?? "");
  const checked = mypageState.manualMemoIds.has(String(row.chart_id));
  const action = checked ? "手動メモから削除" : "手動メモに登録";
  return '<input class="memo-checkbox mypage-memo-checkbox" type="checkbox" data-chart-id="'
    + chartId + '"' + (checked ? " checked" : "")
    + ' aria-label="' + title + "を" + action + '" title="' + action + '">';
}

function mypageRenderTableRow(row) {
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
    '<td class="memo-cell">', mypageRenderMemoCheckbox(row), "</td>",
    '<td class="mono numeric-value numeric-value--level"', levelColorStyle, ">",
    mypageEscapeHtml(originalText), "</td>",
    '<td class="chart-title-cell"><a class="chart-link ', difficultyClass,
    '" href="', titleHref, '"><span class="chart-title-cell__name">',
    mypageEscapeHtml(row.title ?? ""),
    '</span> <span class="chart-title-cell__difficulty">[',
    mypageEscapeHtml(difficultyText), "]</span></a></td>",
    '<td class="mono numeric-value numeric-value--pred"', predictedColorStyle, ">",
    mypageEscapeHtml(predictedText), "</td>",
    '<td><select class="mypage-status-select" data-status="', mypageEscapeHtml(status),
    '" data-chart-id="', chartId,
    '" aria-label="', mypageEscapeHtml(row.title ?? ""), 'のクリア状況">',
    mypageStatusOption(status), "</select></td>",
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

function mypageGetPredObservations() {
  const observations = [];
  for (const [chartId, record] of mypageState.records) {
    const row = mypageState.rowsByChartId.get(String(chartId));
    const pred = mypageGetNumericValue(row?.calibrated_pred_skill);
    const status = String(record?.status ?? "").toLowerCase();
    const outcome = mypagePredClearStatuses.has(status)
      ? 1
      : mypagePredNotClearStatuses.has(status)
        ? 0
        : null;
    if (row && pred !== null && outcome !== null) {
      observations.push({ row, pred, outcome });
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
function mypageFitPredRegression() {
  const observations = mypageGetPredObservations();
  const counts = {
    total: observations.length,
    clear: observations.filter(({ outcome }) => outcome === 1).length,
    notClear: observations.filter(({ outcome }) => outcome === 0).length,
  };
  if (counts.total < 5) {
    return mypageBuildPredInsufficientResult(
      observations,
      counts,
      "プレイした譜面を5件以上登録すると推定されます",
    );
  }

  const bounds = {
    min: mypageState.predDataMin,
    max: mypageState.predDataMax,
  };
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
      message: "未クリア曲数不足により推定できませんでした",
      model: null,
    usedLogistic: false,
      observations,
      counts,
    };
  }

  const center = observations.reduce((sum, { pred }) => sum + pred, 0) / observations.length;
  const variance = observations.reduce((sum, { pred }) => sum + (pred - center) ** 2, 0) / observations.length;
  const scale = Math.max(Math.sqrt(variance), 0.25);
  const clearPredAverage = observations
    .filter(({ outcome }) => outcome === 1)
    .reduce((sum, { pred }) => sum + pred, 0) / counts.clear;
  const notClearPredAverage = observations
    .filter(({ outcome }) => outcome === 0)
    .reduce((sum, { pred }) => sum + pred, 0) / counts.notClear;
  if (clearPredAverage > notClearPredAverage) {
    return mypageBuildPredProvisionalResult(observations, counts);
  }

  const clearRate = Math.min(0.95, Math.max(0.05, counts.clear / observations.length));
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
      break;
    }
    const stepIntercept = (hessianSlope * gradientIntercept - hessianCross * gradientSlope) / determinant;
    const stepSlope = (-hessianCross * gradientIntercept + hessianIntercept * gradientSlope) / determinant;
    intercept = Math.max(-30, Math.min(30, intercept - stepIntercept));
    slope = Math.max(-30, Math.min(30, slope - stepSlope));
    if (Math.abs(stepIntercept) + Math.abs(stepSlope) < 1e-5) {
      break;
    }
  }

  // Keep the same decreasing-clear-probability constraint as the diagnosis page.
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
    fittedSlope >= 0
    || !hasValidRange
    || rangeWidth >= bounds.max - bounds.min
    || !thresholdInBounds
  ) {
    return mypageBuildPredProvisionalResult(observations, counts);
  }

  const lower = Math.min(bounds.max, Math.max(bounds.min, Math.min(...rangeValues)));
  const upper = Math.min(bounds.max, Math.max(bounds.min, Math.max(...rangeValues)));
  return {
    range: mypageFormatPredRange(lower, upper),
    rangeLower: lower,
    rangeUpper: upper,
    rangePrefix: "",
    rangeQualifier: "",
    message: "クリア確率40%-60%範囲",
    model: { intercept, slope, center, scale },
    usedLogistic: true,
    observations,
    counts,
  };
}

function mypageGetFeatureScores(observations, model) {
  const priorCharts = 1;
  return mypageFeatureNames.map((feature) => {
    let totalWeight = 0;
    let observedTotal = 0;
    let expectedTotal = 0;
    let known = 0;

    for (const observation of observations) {
      const detail = mypageGetFeatureDetails(observation.row)
        .find((item) => item.name === feature);
      if (!detail) {
        continue;
      }

      const normalizedPred = model
        ? (observation.pred - model.center) / model.scale
        : 0;
      const baselineProbability = model
        ? mypageSigmoid(model.intercept + model.slope * normalizedPred)
        : 0.5;
      const weight = 1 + Math.min(detail.plusCount, 2);
      totalWeight += weight;
      observedTotal += weight * observation.outcome;
      expectedTotal += weight * baselineProbability;
      known += 1;
    }

    if (totalWeight === 0) {
      return { name: feature, score: 50, known: 0 };
    }

    const rawEffect = observedTotal / totalWeight - expectedTotal / totalWeight;
    const reliability = known / (known + priorCharts);
    const effect = rawEffect * reliability;
    const score = Math.max(0, Math.min(100, 50 + effect * 100));
    return { name: feature, score, known };
  });
}
function mypageRenderFeatureResult(predResult) {
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

  const scores = mypageGetFeatureScores(observations, predResult.model)
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
  const epsilon = 1e-9;
  const positive = scores.filter(({ score }) => score > 50 + epsilon);
  const negative = scores.filter(({ score }) => score < 50 - epsilon);
  const strongestPositive = positive.length
    ? Math.max(...positive.map(({ score }) => score - 50))
    : 0;
  const strongestNegative = negative.length
    ? Math.max(...negative.map(({ score }) => 50 - score))
    : 0;

  return {
    strong: positive
      .filter(({ score }) => Math.abs((score - 50) - strongestPositive) < epsilon)
      .map(({ name }) => name),
    weak: negative
      .filter(({ score }) => Math.abs((50 - score) - strongestNegative) < epsilon)
      .map(({ name }) => name),
  };
}

function mypageGetPublicUrl() {
  return "https://cpi-next.com/mypage.html";
}

function mypageBuildShareText(result, scores) {
  const tendencies = mypageGetFeatureShareTendencies(scores);
  const lines = [
    "推定適正Pred: " + (result.range || "ー"),
  ];

  if (tendencies.strong.length) {
    lines.push("得意傾向: " + tendencies.strong.join("、"));
  }
  if (tendencies.weak.length) {
    lines.push("不得意傾向: " + tendencies.weak.join("、"));
  }

  lines.push("", mypageGetPublicUrl(), "", "#CPINext");
  return lines.join("\n");
}

function mypageUpdateShare(shareText) {
  const button = mypageElements.shareButton;
  if (!button) {
    return;
  }

  button.href = "https://x.com/intent/tweet?"
    + new URLSearchParams({ text: shareText }).toString();
  button.hidden = false;
}

function mypageRenderPredEstimate() {
  const result = mypageFitPredRegression();
  const element = mypageElements.predEstimate;
  element.replaceChildren();
  if (!Number.isFinite(result.rangeLower)) {
    element.textContent = result.range || "ー";
  } else {
    const appendValue = (value) => {
      const valueElement = document.createElement("span");
      valueElement.className = "mypage-pred-estimate__value-part";
      valueElement.textContent = mypageFormatPredValue(value);
      const color = getNumericScaleColor(value, mypageState.predDataMin, mypageState.predDataMax);
      if (color) {
        valueElement.style.setProperty("--numeric-color", color);
      }
      element.append(valueElement);
    };
    if (result.rangePrefix) {
      element.append(document.createTextNode(result.rangePrefix));
    }
    appendValue(result.rangeLower);
    if (Number.isFinite(result.rangeUpper) && result.rangeUpper !== result.rangeLower) {
      const separator = document.createElement("span");
      separator.className = "mypage-pred-estimate__separator";
      separator.textContent = "-";
      element.append(separator);
      appendValue(result.rangeUpper);
    }
    if (result.rangeQualifier) {
      element.append(document.createTextNode(result.rangeQualifier));
    }
  }

  const note = mypageElements.predEstimateNote;
  note.replaceChildren();
  if (result.message) {
    note.append(document.createTextNode(result.message));
    if (mypageState.records.size === 0) {
      const link = document.createElement("a");
      link.href = "record.html";
      link.textContent = "クリアランプ登録";
      note.append(
        document.createElement("br"),
        link,
        document.createTextNode("を行ってください"),
      );
    }
  }
  note.hidden = !result.message;
  const featureScores = result.usedLogistic === true && Array.isArray(result.observations) && result.observations.length >= 5
    ? mypageGetFeatureScores(result.observations, result.model)
    : [];
  mypageUpdateShare(mypageBuildShareText(result, featureScores));
  mypageRenderStatusDistribution();
  mypageRenderFeatureResult(result);
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
function mypageRender() {
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
      .filter((chartId) => mypageState.rowsByChartId.has(chartId)),
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
    const chartId = String(record.chartId ?? "");
    if (/^\d+$/.test(chartId) && mypageStoredStatusValues.has(record.status)) {
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
    mypageRenderPredEstimate();
    if (mypageState.sortKey === "status" || !mypageStatusMatchesFilter(status)) {
      mypageRender();
    } else {
      mypageCompactStatusSelect(select);
    }
    mypageSetMessage("記録を保存しました。");
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
  mypageElements.loadMoreButton = document.getElementById("mypageLoadMoreButton");
  mypageElements.scrollTopButton = document.getElementById("mypageScrollTopButton");
  mypageElements.message = document.getElementById("mypageMessage");
  mypageElements.predEstimate = document.getElementById("mypagePredEstimate");
  mypageElements.statusDistributionChart = document.getElementById("mypageStatusDistributionChart");
  mypageElements.statusDistributionLegend = document.getElementById("mypageStatusDistributionLegend");
  mypageElements.featureResult = document.getElementById("mypageFeatureResult");
  mypageElements.featureBars = document.getElementById("mypageFeatureBars");
  mypageElements.includeUnregistered = document.getElementById("mypageIncludeUnregistered");
  mypageElements.includeUnowned = document.getElementById("mypageIncludeUnowned");
  mypageElements.predEstimateNote = document.getElementById("mypagePredEstimateNote");
  mypageElements.shareButton = document.getElementById("mypageShareButton");
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
    mypageApplyManualMemos(await mypageReadAllManualMemos());
    mypageRender();
  } catch (error) {
    mypageSetMessage(error.message || "記録を読み込めませんでした。");
  }
}

document.addEventListener("DOMContentLoaded", mypageInitialize);
