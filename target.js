"use strict";

const targetDatabaseName = "cpi-next-clear-status";
const targetDatabaseVersion = 2;
const targetStoreName = "chart-statuses";
const targetManualMemoStoreName = "manual-targets";
const targetPageSize = 100;
const targetFeatureNone = "特徴なし";
const targetFeatureNames = [
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
const targetNotClearStatuses = new Set(["failed", "assisted", "easy"]);
const targetClearStatuses = new Set(["clear", "hard"]);
const targetStatuses = [
  { value: "unregistered", label: "未登録" },
  { value: "unowned", label: "未所持・未解禁" },
  { value: "no-play", label: "NO PLAY" },
  { value: "failed", label: "FAILED" },
  { value: "assisted", label: "ASSISTED" },
  { value: "easy", label: "EASY" },
  { value: "clear", label: "CLEAR" },
  { value: "hard", label: "HARD以上" },
];
const targetStatusValues = new Set(targetStatuses.map(({ value }) => value));
const targetDefaultStatusFilter = targetStatuses
  .filter(({ value }) => !["unowned", "clear", "hard"].includes(value))
  .map(({ value }) => value);
const targetRecommendationSettingsKey = "cpi-next-target-recommendation-statuses";
const targetRecommendationLevelValues = [8, 9, 10, 11, 12];
const targetRecommendationCountValues = [5, 10, 20];
const targetDefaultRecommendationSettings = {
  probabilityMin: 40,
  probabilityMax: 60,
  count: 10,
  levels: [...targetRecommendationLevelValues],
  statuses: ["unregistered", "no-play", "failed", "assisted", "easy"],
};
const targetDifficultyOrder = ["N", "H", "A", "L"];
const targetDifficultyLabels = {
  N: "[N] NORMAL",
  H: "[H] HYPER",
  A: "[A] ANOTHER",
  L: "[L] LEGGENDARIA",
};
const targetDifficultyClasses = {
  N: "difficulty--normal",
  H: "difficulty--hyper",
  A: "difficulty--another",
  L: "difficulty--leggendaria",
};
const targetFeatureDeltaLambda = 10;
const targetFeatureDeltaIterations = 50;
const targetFeatureDeltaTolerance = 0.00001;
const targetEntityDecoder = document.createElement("textarea");

const targetState = {
  rows: [],
  rowsByChartId: new Map(),
  records: new Map(),
  manualMemoIds: new Set(),
  searchQuery: "",
  statusFilter: new Set(targetDefaultStatusFilter),
  recommendationSettings: targetGetDefaultRecommendationSettings(),
  autoRecommendationIds: [],
  autoRecommendationCandidateCount: 0,
  autoRecommendationsInitialized: false,
  levelFilter: new Set(),
  difficultyFilter: new Set(),
  featureFilter: new Map(),
  bpmMinFilter: 0,
  bpmMaxFilter: 999,
  predMinFilter: 0,
  predMaxFilter: 999,
  predDataMin: 0,
  predDataMax: 999,
  adjustedPredMinFilter: 0,
  adjustedPredMaxFilter: 999,
  adjustedPredDataMin: 0,
  adjustedPredDataMax: 999,
  sortKey: "adjusted_pred",
  sortDirection: "asc",
  visibleLimit: targetPageSize,
  renderTimer: null,
  db: null,
  model: null,
  deltas: new Array(targetFeatureNames.length).fill(0),
  adjustedPredById: new Map(),
  expectedProbabilityById: new Map(),
};

const targetElements = {};

function targetEscapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function targetDecodeHtmlEntities(value) {
  targetEntityDecoder.innerHTML = String(value ?? "");
  return targetEntityDecoder.value || targetEntityDecoder.textContent || "";
}

function targetStripHtmlTags(value) {
  return String(value ?? "").replace(/<[^>]*>/g, "");
}

function targetNormalizeTitle(value) {
  return targetDecodeHtmlEntities(targetStripHtmlTags(value))
    .replace(/\s+/g, " ")
    .trim();
}

function targetParseCsv(text) {
  const source = String(text ?? "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const nextCharacter = source[index + 1];
    if (inQuotes) {
      if (character === '"' && nextCharacter === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        inQuotes = false;
      } else {
        cell += character;
      }
    } else if (character === '"') {
      inQuotes = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }
      row.push(cell);
      if (row.some((value) => value !== "")) {
        rows.push(row);
      }
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  if (cell !== "" || row.length > 0) {
    row.push(cell);
    if (row.some((value) => value !== "")) {
      rows.push(row);
    }
  }

  if (rows.length === 0) {
    return [];
  }

  const headers = rows[0].map((header) => String(header).trim());
  return rows.slice(1).map((values, index) => {
    const parsed = { __order: index };
    headers.forEach((header, headerIndex) => {
      parsed[header] = values[headerIndex] ?? "";
    });
    return parsed;
  });
}

function targetGetNumericValue(value) {
  const number = Number.parseFloat(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(number) ? number : null;
}

function targetNormalizeDifficulty(value) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "NORMAL" || normalized === "N") {
    return "N";
  }
  if (normalized === "HYPER" || normalized === "H") {
    return "H";
  }
  if (normalized === "ANOTHER" || normalized === "A") {
    return "A";
  }
  if (normalized === "LEGGENDARIA" || normalized === "L") {
    return "L";
  }
  return normalized;
}

function targetNormalizeRows(parsedRows) {
  return parsedRows
    .map((source, index) => {
      const chartId = String(source.chart_id ?? "").trim();
      const title = targetNormalizeTitle(source.title);
      const difficulty = targetNormalizeDifficulty(source.difficulty);
      const originalLevel = targetGetNumericValue(source.original_level);
      const calibratedPred = targetGetNumericValue(source.calibrated_pred_skill);
      const bpmMin = targetGetNumericValue(source.bpm_min);
      const bpmMax = targetGetNumericValue(source.bpm_max);
      const features = targetDecodeHtmlEntities(targetStripHtmlTags(source.features ?? "")).trim();
      if (!/^\d+$/.test(chartId) || !title || originalLevel === null || calibratedPred === null) {
        return null;
      }
      return {
        chart_id: chartId,
        title,
        difficulty,
        original_level: originalLevel,
        calibrated_pred_skill: calibratedPred,
        bpm_min: bpmMin,
        bpm_max: bpmMax,
        features,
        __order: Number.isFinite(source.__order) ? source.__order : index,
        __search: (title + " " + difficulty).toLocaleLowerCase("ja"),
      };
    })
    .filter(Boolean);
}

function targetFormatPredValue(value) {
  const numeric = targetGetNumericValue(value);
  return numeric === null ? "" : numeric.toFixed(1);
}

function targetFormatPredDifference(value) {
  const numeric = targetGetNumericValue(value);
  if (numeric === null) {
    return "";
  }
  const rounded = Number(numeric.toFixed(1));
  return (rounded >= 0 ? "+" : "") + rounded.toFixed(1);
}

function targetFormatBpmPart(value) {
  const numeric = targetGetNumericValue(value);
  return numeric === null ? String(value ?? "").trim() : String(numeric);
}

function targetFormatBpmCell(row) {
  const minText = targetFormatBpmPart(row.bpm_min);
  const maxText = targetFormatBpmPart(row.bpm_max);
  if (!minText && !maxText) {
    return "";
  }
  if (minText === maxText || !maxText) {
    return targetEscapeHtml(minText);
  }
  return '<span class="bpm-range"><span class="bpm-range__min">' + targetEscapeHtml(minText) + '~</span><span class="bpm-range__max">' + targetEscapeHtml(maxText) + "</span></span>";
}

function targetGetRawRowFeatures(row) {
  return String(row.features ?? "")
    .split("、")
    .map((feature) => feature.trim())
    .filter(Boolean);
}

function targetGetFeatureDetails(row) {
  const rawFeatures = targetGetRawRowFeatures(row);
  if (rawFeatures.length === 0 || (rawFeatures.length === 1 && rawFeatures[0] === targetFeatureNone)) {
    return [];
  }
  return rawFeatures
    .map((feature) => {
      const plusMatch = feature.match(/\++$/);
      const plusCount = plusMatch ? plusMatch[0].length : 0;
      const name = feature.replace(/\++$/, "").trim();
      return name ? { name, plusCount } : null;
    })
    .filter(Boolean);
}

function targetGetRowFeatures(row) {
  const names = targetGetFeatureDetails(row).map((feature) => feature.name);
  return names.length > 0 ? names : [targetFeatureNone];
}

function targetGetFeatureOptions() {
  const available = new Set([targetFeatureNone]);
  targetState.rows.forEach((row) => {
    targetGetFeatureDetails(row).forEach((feature) => available.add(feature.name));
  });
  return [
    targetFeatureNone,
    ...targetFeatureNames.filter((feature) => available.has(feature)),
    ...Array.from(available).filter((feature) => feature !== targetFeatureNone && !targetFeatureNames.includes(feature)),
  ];
}

function targetFeatureStrength(plusCount) {
  if (plusCount >= 2) {
    return 2;
  }
  if (plusCount === 1) {
    return 1.5;
  }
  return 1;
}

function targetGetDifficultyOptions() {
  const available = new Set(targetState.rows.map((row) => row.difficulty));
  return targetDifficultyOrder.filter((difficulty) => available.has(difficulty));
}

function targetGetLevelOptions() {
  return Array.from(new Set(targetState.rows.map((row) => row.original_level)))
    .sort((left, right) => left - right);
}

function targetBuildCheckbox(id, label, checked, className, dataAttributes) {
  const attributes = Object.entries(dataAttributes ?? {})
    .map(([key, value]) => 'data-' + key + '="' + targetEscapeHtml(value) + '"')
    .join(" ");
  return '<label class="multi-filter__option ' + (className ?? "") + '"><input id="' + id + '" type="checkbox" ' + (checked ? "checked" : "") + " " + attributes + '><span>' + targetEscapeHtml(label) + "</span></label>";
}

function targetUpdateMultiFilterSummary(summary, selectedValues, values, formatLabel) {
  if (!summary) {
    return;
  }
  if (selectedValues.size === values.length && values.every((value) => selectedValues.has(value))) {
    summary.textContent = "all";
    summary.title = "";
    return;
  }
  if (selectedValues.size === 0) {
    summary.textContent = "none";
    summary.title = "";
    return;
  }
  const labels = values
    .filter((value) => selectedValues.has(value))
    .map(formatLabel);
  summary.textContent = labels.length === 1 ? labels[0] : labels.length + " selected";
  summary.title = labels.join(", ");
}

function targetFillMultiFilterOptions(container, values, stateKey, formatLabel, summary) {
  const allId = "target-" + stateKey + "-all";
  const selectedValues = targetState[stateKey];
  const getStoredValue = (value) => typeof values[0] === "number" ? Number(value) : value;
  container.innerHTML = [
    targetBuildCheckbox(allId, "all", selectedValues.size === values.length, "multi-filter__all", { filter: "all" }),
    ...values.map((value, index) => targetBuildCheckbox(
      "target-" + stateKey + "-" + index,
      formatLabel(value),
      selectedValues.has(value),
      "",
      { filter: "value", value },
    )),
  ].join("");

  container.querySelectorAll('input[data-filter="value"]').forEach((input) => {
    input.addEventListener("change", () => {
      const value = getStoredValue(input.dataset.value);
      if (input.checked) {
        selectedValues.add(value);
      } else {
        selectedValues.delete(value);
      }
      const allInput = container.querySelector('input[data-filter="all"]');
      if (allInput) {
        allInput.checked = selectedValues.size === values.length;
      }
      targetUpdateMultiFilterSummary(summary, selectedValues, values, formatLabel);
      targetState.visibleLimit = targetPageSize;
      targetScheduleRender();
    });
  });

  const allInput = container.querySelector('input[data-filter="all"]');
  if (allInput) {
    allInput.addEventListener("change", () => {
      selectedValues.clear();
      if (allInput.checked) {
        values.forEach((value) => selectedValues.add(value));
      }
      container.querySelectorAll('input[data-filter="value"]').forEach((input) => {
        input.checked = allInput.checked;
      });
      targetUpdateMultiFilterSummary(summary, selectedValues, values, formatLabel);
      targetState.visibleLimit = targetPageSize;
      targetScheduleRender();
    });
  }
  targetUpdateMultiFilterSummary(summary, selectedValues, values, formatLabel);
}

function targetFillFeatureFilterOptions(container) {
  const values = targetGetFeatureOptions();
  targetState.featureFilter = new Map(values.map((feature) => [feature, { include: true, exclude: true }]));
  container.innerHTML = [
    '<label class="multi-filter__option multi-filter__option--all"><input type="checkbox" data-feature-all checked><span>all</span></label>',
    ...values.map((feature, index) => '<div class="multi-filter__option feature-filter__option"><span class="feature-filter__name">' + targetEscapeHtml(feature) + '</span><label class="feature-filter__mode"><input type="checkbox" data-feature-index="' + index + '" data-feature-mode="include" checked><span>を含む</span></label><label class="feature-filter__mode"><input type="checkbox" data-feature-index="' + index + '" data-feature-mode="exclude" checked><span>を含まない</span></label></div>'),
  ].join("");

  const updateFeatureMode = (input) => {
    const index = Number(input.dataset.featureIndex);
    const feature = values[index];
    const setting = targetState.featureFilter.get(feature);
    if (!setting) {
      return;
    }
    setting[input.dataset.featureMode] = input.checked;
    const allInput = container.querySelector("input[data-feature-all]");
    if (allInput) {
      allInput.checked = targetAreAllFeatureModesSelected(values);
    }
    targetUpdateFeatureFilterSummary(targetElements.featureSummary, values);
    targetState.visibleLimit = targetPageSize;
    targetScheduleRender();
  };

  container.querySelectorAll("input[data-feature-index]").forEach((input) => {
    input.addEventListener("change", () => updateFeatureMode(input));
  });

  const allInput = container.querySelector("input[data-feature-all]");
  if (allInput) {
    allInput.addEventListener("change", () => {
      values.forEach((feature) => {
        const setting = targetState.featureFilter.get(feature);
        if (setting) {
          setting.include = allInput.checked;
          setting.exclude = allInput.checked;
        }
      });
      container.querySelectorAll("input[data-feature-mode]").forEach((input) => {
        input.checked = allInput.checked;
      });
      targetUpdateFeatureFilterSummary(targetElements.featureSummary, values);
      targetState.visibleLimit = targetPageSize;
      targetScheduleRender();
    });
  }
  targetUpdateFeatureFilterSummary(targetElements.featureSummary, values);
}

function targetAreAllFeatureModesSelected(values) {
  return values.every((feature) => {
    const setting = targetState.featureFilter.get(feature);
    return setting?.include === true && setting?.exclude === true;
  });
}

function targetUpdateFeatureFilterSummary(summary, values) {
  if (!summary) {
    return;
  }
  if (values.every((feature) => {
    const setting = targetState.featureFilter.get(feature);
    return !setting || setting.include === setting.exclude;
  })) {
    summary.textContent = "all";
    summary.title = "";
    return;
  }
  const selectedModes = values.map((feature) => {
    const setting = targetState.featureFilter.get(feature);
    if (!setting || setting.include === setting.exclude) {
      return "";
    }
    return feature + ":" + (setting.include ? "含む" : "含まない");
  }).filter(Boolean);
  summary.textContent = selectedModes.join(", ");
  summary.title = summary.textContent;
}

function targetClampNumber(value, fallback, minimum, maximum) {
  const numeric = targetGetNumericValue(value);
  if (numeric === null) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, numeric));
}

function targetUpdateAdvancedSummary() {
  const isDefault = targetState.bpmMinFilter === 0
    && targetState.bpmMaxFilter === 999
    && targetState.predMinFilter === targetState.predDataMin
    && targetState.predMaxFilter === targetState.predDataMax
    && targetState.adjustedPredMinFilter === targetState.adjustedPredDataMin
    && targetState.adjustedPredMaxFilter === targetState.adjustedPredDataMax;
  targetElements.advancedSummary.textContent = isDefault
    ? "詳細絞り込み"
    : "BPM:" + targetState.bpmMinFilter + "~" + targetState.bpmMaxFilter
      + " / Pred:" + targetFormatPredValue(targetState.predMinFilter) + "~" + targetFormatPredValue(targetState.predMaxFilter)
      + " / 補正Pred:" + targetFormatPredValue(targetState.adjustedPredMinFilter) + "~" + targetFormatPredValue(targetState.adjustedPredMaxFilter);
}

function targetCommitBpmFilters() {
  targetState.bpmMinFilter = targetClampNumber(targetElements.bpmMinInput.value, 0, 0, 999);
  targetState.bpmMaxFilter = targetClampNumber(targetElements.bpmMaxInput.value, 999, 0, 999);
  targetElements.bpmMinInput.value = String(targetState.bpmMinFilter);
  targetElements.bpmMaxInput.value = String(targetState.bpmMaxFilter);
  targetState.visibleLimit = targetPageSize;
  targetUpdateAdvancedSummary();
  targetRender();
}

function targetCommitPredFilters() {
  targetState.predMinFilter = targetClampNumber(targetElements.predMinInput.value, targetState.predDataMin, targetState.predDataMin, targetState.predDataMax);
  targetState.predMaxFilter = targetClampNumber(targetElements.predMaxInput.value, targetState.predDataMax, targetState.predDataMin, targetState.predDataMax);
  targetElements.predMinInput.value = targetFormatPredValue(targetState.predMinFilter);
  targetElements.predMaxInput.value = targetFormatPredValue(targetState.predMaxFilter);
  targetState.visibleLimit = targetPageSize;
  targetUpdateAdvancedSummary();
  targetRender();
}

function targetUpdateBpmFilters() {
  targetState.bpmMinFilter = targetClampNumber(targetElements.bpmMinInput.value, 0, 0, 999);
  targetState.bpmMaxFilter = targetClampNumber(targetElements.bpmMaxInput.value, 999, 0, 999);
  targetState.visibleLimit = targetPageSize;
  targetUpdateAdvancedSummary();
  targetScheduleRender();
}

function targetUpdatePredFilters() {
  targetState.predMinFilter = targetClampNumber(targetElements.predMinInput.value, targetState.predDataMin, targetState.predDataMin, targetState.predDataMax);
  targetState.predMaxFilter = targetClampNumber(targetElements.predMaxInput.value, targetState.predDataMax, targetState.predDataMin, targetState.predDataMax);
  targetState.visibleLimit = targetPageSize;
  targetUpdateAdvancedSummary();
  targetScheduleRender();
}

function targetCommitAdjustedPredFilters() {
  targetState.adjustedPredMinFilter = targetClampNumber(targetElements.adjustedPredMinInput.value, targetState.adjustedPredDataMin, targetState.adjustedPredDataMin, targetState.adjustedPredDataMax);
  targetState.adjustedPredMaxFilter = targetClampNumber(targetElements.adjustedPredMaxInput.value, targetState.adjustedPredDataMax, targetState.adjustedPredDataMin, targetState.adjustedPredDataMax);
  targetElements.adjustedPredMinInput.value = targetFormatPredValue(targetState.adjustedPredMinFilter);
  targetElements.adjustedPredMaxInput.value = targetFormatPredValue(targetState.adjustedPredMaxFilter);
  targetState.visibleLimit = targetPageSize;
  targetUpdateAdvancedSummary();
  targetRender();
}

function targetUpdateAdjustedPredFilters() {
  targetState.adjustedPredMinFilter = targetClampNumber(targetElements.adjustedPredMinInput.value, targetState.adjustedPredDataMin, targetState.adjustedPredDataMin, targetState.adjustedPredDataMax);
  targetState.adjustedPredMaxFilter = targetClampNumber(targetElements.adjustedPredMaxInput.value, targetState.adjustedPredDataMax, targetState.adjustedPredDataMin, targetState.adjustedPredDataMax);
  targetState.visibleLimit = targetPageSize;
  targetUpdateAdvancedSummary();
  targetScheduleRender();
}

function targetFeatureFilterMatches(row) {
  if (targetState.featureFilter.size === 0) {
    return true;
  }
  const rowFeatures = new Set(targetGetRowFeatures(row));
  return Array.from(targetState.featureFilter.entries()).every(([feature, setting]) => {
    if (setting.include === setting.exclude) {
      return true;
    }
    const hasFeature = rowFeatures.has(feature);
    return setting.include ? hasFeature : !hasFeature;
  });
}

function targetMatchesFilters(row) {
  if (targetState.searchQuery && !row.__search.includes(targetState.searchQuery)) {
    return false;
  }
  if (!targetState.statusFilter.has(targetGetStatus(row))) {
    return false;
  }
  if (!targetState.levelFilter.has(row.original_level)) {
    return false;
  }
  if (!targetState.difficultyFilter.has(row.difficulty)) {
    return false;
  }
  if (!targetFeatureFilterMatches(row)) {
    return false;
  }
  const bpmMin = targetGetNumericValue(row.bpm_min);
  const bpmMax = targetGetNumericValue(row.bpm_max);
  if (bpmMin !== null && bpmMin < targetState.bpmMinFilter) {
    return false;
  }
  if (bpmMax !== null && bpmMax > targetState.bpmMaxFilter) {
    return false;
  }
  if (row.calibrated_pred_skill < targetState.predMinFilter || row.calibrated_pred_skill > targetState.predMaxFilter) {
    return false;
  }
  const adjustedPred = targetGetAdjustedPred(row);
  if (adjustedPred < targetState.adjustedPredMinFilter || adjustedPred > targetState.adjustedPredMaxFilter) {
    return false;
  }
  return true;
}

function targetCompareNumeric(left, right) {
  const leftNumber = targetGetNumericValue(left);
  const rightNumber = targetGetNumericValue(right);
  if (leftNumber === null && rightNumber === null) {
    return 0;
  }
  if (leftNumber === null) {
    return 1;
  }
  if (rightNumber === null) {
    return -1;
  }
  return leftNumber - rightNumber;
}

function targetCompareRows(left, right) {
  let comparison = 0;
  if (targetState.sortKey === "adjusted_pred") {
    comparison = targetCompareNumeric(targetGetAdjustedPred(left), targetGetAdjustedPred(right));
  } else if (targetState.sortKey === "bpm") {
    const key = targetState.sortDirection === "desc" ? "bpm_max" : "bpm_min";
    comparison = targetCompareNumeric(left[key], right[key]);
  } else if (targetState.sortKey === "status") {
    const leftIndex = targetStatuses.findIndex(({ value }) => value === targetGetStatus(left));
    const rightIndex = targetStatuses.findIndex(({ value }) => value === targetGetStatus(right));
    comparison = leftIndex - rightIndex;
  } else if (targetState.sortKey === "original_level" || targetState.sortKey === "calibrated_pred_skill") {
    comparison = targetCompareNumeric(left[targetState.sortKey], right[targetState.sortKey]);
  } else {
    comparison = String(left[targetState.sortKey] ?? "").localeCompare(String(right[targetState.sortKey] ?? ""), "ja");
  }
  if (comparison === 0) {
    comparison = left.__order - right.__order;
  }
  return targetState.sortDirection === "desc" ? -comparison : comparison;
}

function targetGetFilteredRows() {
  return targetState.rows.filter(targetMatchesFilters).sort(targetCompareRows);
}

function targetGetChartHref(row) {
  return "chart-pages/" + encodeURIComponent(row.chart_id) + ".html";
}

function targetGetDifficultyClass(difficulty) {
  return targetDifficultyClasses[difficulty] ?? "";
}

function targetRenderFeatureChips(row) {
  const features = targetGetRawRowFeatures(row);
  if (features.length === 0) {
    return "";
  }
  const chips = features.map((feature) => {
    const plusMatch = feature.match(/\++$/);
    const plusCount = plusMatch ? plusMatch[0].length : 0;
    const baseName = feature.replace(/\++$/, "").trim();
    const className = baseName === targetFeatureNone
      ? "feature-chip feature-chip--none"
      : "feature-chip feature-chip--plus-" + Math.min(plusCount, 2);
    return '<span class="' + className + '">' + targetEscapeHtml(feature) + "</span>";
  }).join("");
  return '<div class="feature-chips">' + chips + "</div>";
}

function targetHslToRgbString(hue, saturation, lightness) {
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const segment = hue / 60;
  const x = chroma * (1 - Math.abs((segment % 2) - 1));
  let red = 0;
  let green = 0;
  let blue = 0;
  if (segment < 1) {
    red = chroma;
    green = x;
  } else if (segment < 2) {
    red = x;
    green = chroma;
  } else if (segment < 3) {
    green = chroma;
    blue = x;
  } else if (segment < 4) {
    green = x;
    blue = chroma;
  } else if (segment < 5) {
    red = x;
    blue = chroma;
  } else {
    red = chroma;
    blue = x;
  }
  const match = l - chroma / 2;
  return "rgb(" + Math.round((red + match) * 255) + ", " + Math.round((green + match) * 255) + ", " + Math.round((blue + match) * 255) + ")";
}

function targetClampUnit(value) {
  return Math.min(1, Math.max(0, value));
}

function targetGetNumericColor(value, minimum, maximum) {
  const numeric = targetGetNumericValue(value);
  if (numeric === null || !Number.isFinite(minimum) || !Number.isFinite(maximum)) {
    return "";
  }
  const position = maximum > minimum
    ? targetClampUnit((numeric - minimum) / (maximum - minimum))
    : 0.5;
  const yellowPosition = maximum > minimum
    ? targetClampUnit(Math.max(0.1, Math.min(0.45, (9 - minimum) / (maximum - minimum))))
    : 0.25;
  const stops = [
    { position: 0, hue: 221, saturation: 83, lightness: 53 },
    { position: yellowPosition, hue: 48, saturation: 92, lightness: 40 },
    { position: 0.5, hue: 0, saturation: 80, lightness: 50 },
    { position: 1, hue: 262, saturation: 72, lightness: 55 },
  ];
  let lower = stops[0];
  let upper = stops[stops.length - 1];
  for (let index = 1; index < stops.length; index += 1) {
    if (position <= stops[index].position) {
      upper = stops[index];
      lower = stops[index - 1];
      break;
    }
  }
  const span = upper.position - lower.position;
  const ratio = span === 0 ? 0 : (position - lower.position) / span;
  const hueDelta = ((upper.hue - lower.hue + 540) % 360) - 180;
  const hue = (lower.hue + hueDelta * ratio + 360) % 360;
  const saturation = lower.saturation + (upper.saturation - lower.saturation) * ratio;
  const lightness = lower.lightness + (upper.lightness - lower.lightness) * ratio;
  return targetHslToRgbString(hue, saturation, lightness);
}

function targetGetNumericColorStyle(value) {
  return ' style="--numeric-color:' + targetGetNumericColor(value, targetState.predDataMin, targetState.predDataMax) + '"';
}

function targetRenderMemoCheckbox(row) {
  const chartId = targetEscapeHtml(row.chart_id);
  const title = targetEscapeHtml(row.title ?? "");
  const checked = targetState.manualMemoIds.has(String(row.chart_id));
  const action = checked ? "手動メモから削除" : "手動メモに登録";
  return '<input class="memo-checkbox target-memo-checkbox" type="checkbox" data-chart-id="'
    + chartId + '"' + (checked ? " checked" : "")
    + ' aria-label="' + title + "を" + action + '" title="' + action + '">';
}

function targetRenderTableRow(row) {
  const rawPred = targetFormatPredValue(row.calibrated_pred_skill);
  const adjustedPredValue = targetGetAdjustedPred(row);
  const adjustedPred = targetFormatPredValue(adjustedPredValue);
  const adjustedPredDifference = targetFormatPredDifference(adjustedPredValue - row.calibrated_pred_skill);
  const levelText = "☆" + targetFormatPredValue(row.original_level).replace(".0", "");
  const difficulty = targetNormalizeDifficulty(row.difficulty);
  return "<tr>"
    + '<td class="memo-cell">' + targetRenderMemoCheckbox(row) + "</td>"
    + '<td class="mono numeric-value numeric-value--level">' + targetEscapeHtml(levelText) + "</td>"
    + '<td class="chart-title-cell"><a class="chart-link ' + targetGetDifficultyClass(difficulty) + '" href="' + targetEscapeHtml(targetGetChartHref(row)) + '"><span class="chart-title-cell__name">' + targetEscapeHtml(row.title) + '</span> <span class="chart-title-cell__difficulty">[' + targetEscapeHtml(difficulty) + "]</span></a></td>"
    + '<td class="mono numeric-value numeric-value--pred target-adjusted-pred"' + targetGetNumericColorStyle(adjustedPredValue) + '><span class="target-adjusted-pred__value">'
    + targetEscapeHtml(adjustedPred)
    + '</span> <span class="target-adjusted-pred__difference">('
    + targetEscapeHtml(adjustedPredDifference)
    + ")</span></td>"
    + '<td class="mono numeric-value numeric-value--pred"' + targetGetNumericColorStyle(row.calibrated_pred_skill) + ">" + targetEscapeHtml(rawPred) + "</td>"
    + '<td class="target-status-cell">' + targetRenderStatusSelect(row) + "</td>"
    + "<td>" + targetFormatBpmCell(row) + "</td>"
    + '<td class="feature-cell">' + targetRenderFeatureChips(row) + "</td>"
    + "</tr>";
}

function targetUpdateSortIndicators() {
  document.querySelectorAll(".target-table thead button[data-sort-key]").forEach((button) => {
    const isActive = button.dataset.sortKey === targetState.sortKey;
    const mark = button.querySelector(".sort-mark");
    button.classList.toggle("is-sorted", isActive);
    button.dataset.sortDirection = isActive ? targetState.sortDirection : "";
    button.setAttribute("aria-sort", isActive ? (targetState.sortDirection === "asc" ? "ascending" : "descending") : "none");
    if (mark) {
      mark.textContent = isActive ? (targetState.sortDirection === "asc" ? "▲" : "▼") : "";
    }
  });
}

function targetUpdateTableOverflow() {
  [targetElements.autoTableShell, targetElements.manualTableShell, targetElements.tableShell]
    .filter(Boolean)
    .forEach((shell) => {
      shell.classList.toggle("is-overflowing", shell.scrollWidth > shell.clientWidth + 1);
    });
}

function targetGetAutoCandidateRows() {
  const settings = targetState.recommendationSettings;
  return targetState.rows.filter((row) => {
    if (!settings.statuses.includes(targetGetStatus(row))
      || !settings.levels.includes(row.original_level)) {
      return false;
    }
    const probability = targetGetExpectedClearProbability(row);
    if (probability === null) {
      return false;
    }
    const probabilityPercent = probability * 100;
    return probabilityPercent >= settings.probabilityMin
      && probabilityPercent <= settings.probabilityMax;
  });
}

function targetGenerateAutoRecommendations() {
  const candidates = targetGetAutoCandidateRows();
  targetState.autoRecommendationIds = targetShuffleRows(candidates)
    .slice(0, targetState.recommendationSettings.count)
    .map((row) => String(row.chart_id));
  targetState.autoRecommendationCandidateCount = candidates.length;
  targetState.autoRecommendationsInitialized = true;
}

function targetRenderAutoRecommendations() {
  const recommendedRows = targetState.autoRecommendationIds
    .map((chartId) => targetState.rowsByChartId.get(chartId))
    .filter(Boolean)
    .sort(targetCompareRows);
  targetElements.autoRowCount.textContent = recommendedRows.length.toLocaleString()
    + "件表示 / " + targetState.autoRecommendationCandidateCount.toLocaleString() + "件中";
  targetElements.autoTableBody.innerHTML = recommendedRows.map(targetRenderTableRow).join("");
  targetElements.autoTableShell.hidden = recommendedRows.length === 0;
  targetElements.autoEmpty.hidden = recommendedRows.length > 0;
}

function targetRenderManualMemos() {
  const memoRows = targetState.rows
    .filter((row) => targetState.manualMemoIds.has(String(row.chart_id)))
    .sort(targetCompareRows);
  targetElements.manualRowCount.textContent = memoRows.length.toLocaleString() + "件";
  targetElements.manualTableBody.innerHTML = memoRows.map(targetRenderTableRow).join("");
  targetElements.manualTableShell.hidden = memoRows.length === 0;
  targetElements.manualEmpty.hidden = memoRows.length > 0;
}

function targetRenderMainTable() {
  const filteredRows = targetGetFilteredRows();
  const visibleRows = filteredRows.slice(0, targetState.visibleLimit);
  targetElements.rowCount.textContent = visibleRows.length.toLocaleString()
    + "件表示 / " + filteredRows.length.toLocaleString() + "件中";
  targetElements.tableBody.innerHTML = visibleRows.map(targetRenderTableRow).join("");
  targetElements.loadMore.hidden = visibleRows.length >= filteredRows.length;
  targetUpdateSortIndicators();
}

function targetRender() {
  if (!targetState.autoRecommendationsInitialized && targetCanShowContent()) {
    targetGenerateAutoRecommendations();
  }
  targetRenderAutoRecommendations();
  targetRenderManualMemos();
  targetRenderMainTable();
  requestAnimationFrame(targetUpdateTableOverflow);
}
function targetScheduleRender() {
  if (targetState.renderTimer !== null) {
    window.clearTimeout(targetState.renderTimer);
  }
  targetState.renderTimer = window.setTimeout(() => {
    targetState.renderTimer = null;
    targetRender();
  }, 60);
}

function targetSetSort(key) {
  if (targetState.sortKey === key) {
    targetState.sortDirection = targetState.sortDirection === "asc" ? "desc" : "asc";
  } else {
    targetState.sortKey = key;
    targetState.sortDirection = "asc";
  }
  targetState.visibleLimit = targetPageSize;
  targetRender();
}

function targetSigmoid(value) {
  if (value >= 0) {
    const exponential = Math.exp(-value);
    return 1 / (1 + exponential);
  }
  const exponential = Math.exp(value);
  return exponential / (1 + exponential);
}

function targetStatusOptions(selected) {
  return targetStatuses.map(({ value, label }) => (
    '<option value="' + value + '"' + (value === selected ? ' selected' : '') + ">" + label + "</option>"
  )).join("");
}

function targetRenderStatusSelect(row) {
  const status = targetGetStatus(row);
  return '<select class="target-status-select" data-status="' + targetEscapeHtml(status)
    + '" data-chart-id="' + targetEscapeHtml(row.chart_id)
    + '" aria-label="' + targetEscapeHtml(row.title) + 'のクリア状況">'
    + targetStatusOptions(status) + "</select>";
}

function targetUpdateStatusSelect(select) {
  select.dataset.status = select.value;
}

function targetGetStatus(row) {
  const status = String(targetState.records.get(String(row.chart_id))?.status ?? "").toLowerCase();
  return targetStatusValues.has(status) ? status : "unregistered";
}

function targetGetDefaultRecommendationSettings() {
  return {
    probabilityMin: targetDefaultRecommendationSettings.probabilityMin,
    probabilityMax: targetDefaultRecommendationSettings.probabilityMax,
    count: targetDefaultRecommendationSettings.count,
    levels: [...targetDefaultRecommendationSettings.levels],
    statuses: [...targetDefaultRecommendationSettings.statuses],
  };
}

function targetNormalizeRecommendationProbability(value, fallback) {
  const numeric = Number(value);
  return Number.isInteger(numeric)
    ? Math.min(100, Math.max(0, numeric))
    : fallback;
}

function targetNormalizeRecommendationCount(value, fallback) {
  const numeric = Number(value);
  return targetRecommendationCountValues.includes(numeric) ? numeric : fallback;
}

function targetReadRecommendationSettings() {
  const fallback = targetGetDefaultRecommendationSettings();
  try {
    const parsed = JSON.parse(window.localStorage?.getItem(targetRecommendationSettingsKey) ?? "null");
    if (Array.isArray(parsed)) {
      return {
        ...fallback,
        statuses: [...new Set(parsed.filter((value) => targetStatusValues.has(value)))],
      };
    }
    if (!parsed || typeof parsed !== "object") {
      return fallback;
    }

    let probabilityMin = targetNormalizeRecommendationProbability(
      parsed.probabilityMin,
      fallback.probabilityMin,
    );
    let probabilityMax = targetNormalizeRecommendationProbability(
      parsed.probabilityMax,
      fallback.probabilityMax,
    );
    const count = targetNormalizeRecommendationCount(parsed.count, fallback.count);
    if (probabilityMin > probabilityMax) {
      [probabilityMin, probabilityMax] = [probabilityMax, probabilityMin];
    }
    const levels = Array.isArray(parsed.levels)
      ? [...new Set(parsed.levels
        .map((value) => Number(value))
        .filter((value) => targetRecommendationLevelValues.includes(value)))]
      : [...fallback.levels];
    const statuses = Array.isArray(parsed.statuses)
      ? [...new Set(parsed.statuses.filter((value) => targetStatusValues.has(value)))]
      : [...fallback.statuses];
    return { probabilityMin, probabilityMax, count, levels, statuses };
  } catch (error) {
    // Fall back to the default when local storage is unavailable or invalid.
  }
  return fallback;
}
function targetShuffleRows(rows) {
  const shuffled = [...rows];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function targetGetPredObservations() {
  const observations = [];
  targetState.records.forEach((record, chartId) => {
    const row = targetState.rowsByChartId.get(String(chartId));
    if (!row) {
      return;
    }
    const status = String(record?.status ?? "").toLowerCase();
    const outcome = targetClearStatuses.has(status)
      ? 1
      : targetNotClearStatuses.has(status)
        ? 0
        : null;
    if (outcome === null) {
      return;
    }
    observations.push({ row, pred: row.calibrated_pred_skill, outcome });
  });
  return observations;
}

function targetFitBaseModel(observations) {
  const clearObservations = observations.filter((observation) => observation.outcome === 1);
  const notClearObservations = observations.filter((observation) => observation.outcome === 0);
  if (observations.length < 5 || clearObservations.length === 0 || notClearObservations.length === 0) {
    return null;
  }

  const center = observations.reduce((total, observation) => total + observation.pred, 0) / observations.length;
  const variance = observations.reduce((total, observation) => total + (observation.pred - center) ** 2, 0) / observations.length;
  const scale = Math.max(Math.sqrt(variance), 0.25);
  const clearAverage = clearObservations.reduce((total, observation) => total + observation.pred, 0) / clearObservations.length;
  const notClearAverage = notClearObservations.reduce((total, observation) => total + observation.pred, 0) / notClearObservations.length;
  if (clearAverage > notClearAverage) {
    return null;
  }

  const clearRate = Math.min(0.95, Math.max(0.05, clearObservations.length / observations.length));
  let intercept = Math.log(clearRate / (1 - clearRate));
  let slope = -1;
  const regularization = 0.03;

  for (let iteration = 0; iteration < 80; iteration += 1) {
    let gradientIntercept = 0;
    let gradientSlope = regularization * slope;
    let hessianIntercept = 0;
    let hessianCross = 0;
    let hessianSlope = regularization;

    observations.forEach((observation) => {
      const normalizedPred = (observation.pred - center) / scale;
      const probability = targetSigmoid(intercept + slope * normalizedPred);
      const weight = Math.max(probability * (1 - probability), 0.00001);
      const residual = probability - observation.outcome;
      gradientIntercept += residual;
      gradientSlope += residual * normalizedPred;
      hessianIntercept += weight;
      hessianCross += weight * normalizedPred;
      hessianSlope += weight * normalizedPred * normalizedPred;
    });

    const determinant = hessianIntercept * hessianSlope - hessianCross * hessianCross;
    if (!Number.isFinite(determinant) || determinant <= 0) {
      return null;
    }
    const stepIntercept = (hessianSlope * gradientIntercept - hessianCross * gradientSlope) / determinant;
    const stepSlope = (-hessianCross * gradientIntercept + hessianIntercept * gradientSlope) / determinant;
    if (!Number.isFinite(stepIntercept) || !Number.isFinite(stepSlope)) {
      return null;
    }
    intercept = Math.max(-30, Math.min(30, intercept - stepIntercept));
    slope = Math.max(-30, Math.min(30, slope - stepSlope));
    if (Math.max(Math.abs(stepIntercept), Math.abs(stepSlope)) < 0.00001) {
      break;
    }
  }

  const fittedSlope = slope;
  slope = Math.min(-0.05, slope);
  const threshold = center + (-intercept / slope) * scale;
  const range = targetState.predDataMax - targetState.predDataMin;
  if (
    !Number.isFinite(intercept)
    || !Number.isFinite(slope)
    || fittedSlope >= 0
    || !Number.isFinite(threshold)
    || range <= 0
    || threshold <= targetState.predDataMin
    || threshold >= targetState.predDataMax
  ) {
    return null;
  }
  return { intercept, slope, center, scale };
}

function targetGetFeatureVector(row) {
  const vector = new Array(targetFeatureNames.length).fill(0);
  targetGetFeatureDetails(row).forEach((feature) => {
    const index = targetFeatureNames.indexOf(feature.name);
    if (index >= 0) {
      vector[index] += targetFeatureStrength(feature.plusCount);
    }
  });
  return vector;
}

function targetSolveLinearSystem(matrix, values) {
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

function targetFitFeatureDeltas(observations, model) {
  const deltas = new Array(targetFeatureNames.length).fill(0);
  if (!model) {
    return deltas;
  }
  const samples = observations
    .map((observation) => ({
      pred: observation.pred,
      outcome: observation.outcome,
      vector: targetGetFeatureVector(observation.row),
    }))
    .filter((sample) => sample.vector.some((value) => value > 0));
  if (samples.length === 0) {
    return deltas;
  }

  const modelDerivativePerPred = model.slope / model.scale;
  for (let iteration = 0; iteration < targetFeatureDeltaIterations; iteration += 1) {
    const gradient = new Array(targetFeatureNames.length).fill(0);
    const hessian = Array.from(
      { length: targetFeatureNames.length },
      () => new Array(targetFeatureNames.length).fill(0),
    );

    samples.forEach((sample) => {
      const adjustment = sample.vector.reduce((total, strength, index) => total + deltas[index] * strength, 0);
      const normalizedPred = (sample.pred + adjustment - model.center) / model.scale;
      const probability = targetSigmoid(model.intercept + model.slope * normalizedPred);
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

    for (let index = 0; index < targetFeatureNames.length; index += 1) {
      gradient[index] += 2 * targetFeatureDeltaLambda * deltas[index];
      hessian[index][index] += 2 * targetFeatureDeltaLambda;
    }

    const step = targetSolveLinearSystem(hessian, gradient);
    if (!step) {
      break;
    }
    let largestStep = 0;
    for (let index = 0; index < deltas.length; index += 1) {
      const next = deltas[index] - step[index];
      if (!Number.isFinite(next)) {
        return new Array(targetFeatureNames.length).fill(0);
      }
      deltas[index] = next;
      largestStep = Math.max(largestStep, Math.abs(step[index]));
    }
    if (largestStep < targetFeatureDeltaTolerance) {
      break;
    }
  }
  return deltas;
}

function targetGetAdjustedPred(row) {
  const stored = targetState.adjustedPredById.get(String(row.chart_id));
  return stored ?? row.calibrated_pred_skill;
}

function targetGetExpectedClearProbability(row) {
  if (!targetState.model) {
    return null;
  }
  const stored = targetState.expectedProbabilityById.get(String(row.chart_id));
  return stored ?? null;
}

function targetRecalculateModel() {
  const observations = targetGetPredObservations();
  targetState.model = targetFitBaseModel(observations);
  targetState.deltas = targetFitFeatureDeltas(observations, targetState.model);
  targetState.adjustedPredById = new Map();
  targetState.expectedProbabilityById = new Map();
  targetState.rows.forEach((row) => {
    const vector = targetGetFeatureVector(row);
    const adjustedPred = row.calibrated_pred_skill + vector.reduce((total, strength, index) => total + targetState.deltas[index] * strength, 0);
    targetState.adjustedPredById.set(String(row.chart_id), adjustedPred);
    if (targetState.model) {
      const normalizedPred = (adjustedPred - targetState.model.center) / targetState.model.scale;
      targetState.expectedProbabilityById.set(
        String(row.chart_id),
        targetSigmoid(targetState.model.intercept + targetState.model.slope * normalizedPred),
      );
    }
  });
  targetSetAdjustedPredBounds();
}

function targetCanShowContent() {
  const observations = targetGetPredObservations();
  const clearCount = observations.filter((observation) => observation.outcome === 1).length;
  const notClearCount = observations.length - clearCount;
  return observations.length >= 10 && clearCount >= 3 && notClearCount >= 3;
}

function targetUpdateAvailability() {
  const available = targetCanShowContent();
  targetElements.content.hidden = !available;
  targetElements.insufficientMessage.hidden = available;
}

function targetOpenDatabase() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("IndexedDB is not available"));
      return;
    }
    const request = window.indexedDB.open(targetDatabaseName, targetDatabaseVersion);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(targetStoreName)) {
        database.createObjectStore(targetStoreName, { keyPath: "chartId" });
      }
      if (!database.objectStoreNames.contains(targetManualMemoStoreName)) {
        database.createObjectStore(targetManualMemoStoreName, { keyPath: "chartId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open IndexedDB"));
  });
}

function targetReadAllRecords() {
  return new Promise((resolve, reject) => {
    const transaction = targetState.db.transaction(targetStoreName, "readonly");
    const request = transaction.objectStore(targetStoreName).getAll();
    request.onsuccess = () => resolve(request.result ?? []);
    request.onerror = () => reject(request.error ?? new Error("Unable to read records"));
  });
}

function targetApplyRecords(records) {
  targetState.records = new Map();
  records.forEach((record) => {
    const chartId = String(record?.chartId ?? "").trim();
    const status = String(record?.status ?? "").toLowerCase();
    if (/^\d+$/.test(chartId) && targetStatusValues.has(status)) {
      targetState.records.set(chartId, { ...(record ?? {}), chartId, status });
    }
  });
}

function targetReadAllManualMemos() {
  return new Promise((resolve, reject) => {
    const transaction = targetState.db.transaction(targetManualMemoStoreName, "readonly");
    const request = transaction.objectStore(targetManualMemoStoreName).getAll();
    request.onsuccess = () => resolve(request.result ?? []);
    request.onerror = () => reject(request.error ?? new Error("Unable to read manual memos"));
  });
}

function targetApplyManualMemos(memos) {
  targetState.manualMemoIds = new Set(
    memos
      .map((memo) => String(memo?.chartId ?? "").trim())
      .filter((chartId) => targetState.rowsByChartId.has(chartId)),
  );
}

function targetWriteManualMemo(chartId, registered) {
  return new Promise((resolve, reject) => {
    if (!targetState.db) {
      reject(new Error("ローカル保存を開けませんでした。"));
      return;
    }
    const transaction = targetState.db.transaction(targetManualMemoStoreName, "readwrite");
    const store = transaction.objectStore(targetManualMemoStoreName);
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

function targetWriteStatus(chartId, status) {
  return new Promise((resolve, reject) => {
    if (!targetState.db) {
      reject(new Error("ローカル保存を開けませんでした。"));
      return;
    }
    const transaction = targetState.db.transaction(targetStoreName, "readwrite");
    const store = transaction.objectStore(targetStoreName);
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

async function targetHandleStatusChange(event) {
  const select = event.target.closest?.(".target-status-select");
  if (!select || !targetStatusValues.has(select.value)) {
    return;
  }

  const chartId = String(select.dataset.chartId ?? "").trim();
  const row = targetState.rowsByChartId.get(chartId);
  if (!row) {
    return;
  }
  const previousStatus = targetGetStatus(row);
  const status = select.value;
  select.disabled = true;
  try {
    await targetWriteStatus(chartId, status);
    if (status === "unregistered") {
      targetState.records.delete(chartId);
    } else {
      targetState.records.set(chartId, {
        chartId,
        status,
        updatedAt: new Date().toISOString(),
      });
    }
    targetRecalculateModel();
    targetUpdateAvailability();
    targetState.visibleLimit = targetPageSize;
    targetRender();
    targetShowError("");
  } catch (error) {
    select.value = previousStatus;
    targetUpdateStatusSelect(select);
    targetShowError(error.message || "記録を保存できませんでした。");
  } finally {
    select.disabled = false;
  }
}

async function targetHandleManualMemoChange(event) {
  const checkbox = event.target.closest?.(".target-memo-checkbox");
  if (!checkbox) {
    return;
  }

  const chartId = String(checkbox.dataset.chartId ?? "").trim();
  const row = targetState.rowsByChartId.get(chartId);
  if (!row || !targetState.db) {
    checkbox.checked = false;
    return;
  }

  const previousValue = targetState.manualMemoIds.has(chartId);
  const nextValue = checkbox.checked;
  checkbox.disabled = true;
  try {
    await targetWriteManualMemo(chartId, nextValue);
    if (nextValue) {
      targetState.manualMemoIds.add(chartId);
    } else {
      targetState.manualMemoIds.delete(chartId);
    }
    targetRender();
    targetShowError("");
  } catch (error) {
    checkbox.checked = previousValue;
    targetShowError(error.message || "手動メモを保存できませんでした。");
  } finally {
    checkbox.disabled = false;
  }
}

function targetInitializeElements() {
  targetElements.autoEmpty = document.getElementById("targetAutoEmpty");
  targetElements.autoRowCount = document.getElementById("targetAutoRowCount");
  targetElements.autoRegenerate = document.getElementById("targetAutoRegenerateButton");
  targetElements.autoTableShell = document.getElementById("targetAutoTableShell");
  targetElements.autoTableBody = document.getElementById("targetAutoTableBody");
  targetElements.searchInput = document.getElementById("targetSearchInput");
  targetElements.statusMenu = document.getElementById("targetStatusFilterMenu");
  targetElements.statusSummary = document.getElementById("targetStatusFilterSummary");
  targetElements.levelMenu = document.getElementById("targetLevelFilterMenu");
  targetElements.levelSummary = document.getElementById("targetLevelFilterSummary");
  targetElements.difficultyMenu = document.getElementById("targetDifficultyFilterMenu");
  targetElements.difficultySummary = document.getElementById("targetDifficultyFilterSummary");
  targetElements.featureMenu = document.getElementById("targetFeatureFilterMenu");
  targetElements.featureSummary = document.getElementById("targetFeatureFilterSummary");
  targetElements.content = document.getElementById("targetContent");
  targetElements.insufficientMessage = document.getElementById("targetInsufficientMessage");
  targetElements.advancedSummary = document.getElementById("targetAdvancedFilterSummary");
  targetElements.bpmMinInput = document.getElementById("targetBpmMinInput");
  targetElements.bpmMaxInput = document.getElementById("targetBpmMaxInput");
  targetElements.predMinInput = document.getElementById("targetPredMinInput");
  targetElements.predMaxInput = document.getElementById("targetPredMaxInput");
  targetElements.adjustedPredMinInput = document.getElementById("targetAdjustedPredMinInput");
  targetElements.adjustedPredMaxInput = document.getElementById("targetAdjustedPredMaxInput");
  targetElements.error = document.getElementById("targetError");
  targetElements.rowCount = document.getElementById("targetRowCount");
  targetElements.tableShell = document.getElementById("targetTableShell");
  targetElements.table = targetElements.tableShell.querySelector("table");
  targetElements.tableBody = document.getElementById("targetTableBody");
  targetElements.loadMore = document.getElementById("targetLoadMoreButton");
  targetElements.manualEmpty = document.getElementById("targetManualEmpty");
  targetElements.manualRowCount = document.getElementById("targetManualRowCount");
  targetElements.manualTableShell = document.getElementById("targetManualTableShell");
  targetElements.manualTableBody = document.getElementById("targetManualTableBody");
  targetElements.scrollTop = document.getElementById("targetScrollTopButton");
}
function targetPopulateFilters() {
  const levels = targetGetLevelOptions();
  const difficulties = targetGetDifficultyOptions();
  targetState.levelFilter = new Set(levels);
  targetState.difficultyFilter = new Set(difficulties);
  targetFillMultiFilterOptions(targetElements.levelMenu, levels, "levelFilter", (value) => "☆" + value, targetElements.levelSummary);
  targetFillMultiFilterOptions(targetElements.difficultyMenu, difficulties, "difficultyFilter", (value) => targetDifficultyLabels[value] ?? value, targetElements.difficultySummary);
  targetFillMultiFilterOptions(
    targetElements.statusMenu,
    targetStatuses.map(({ value }) => value),
    "statusFilter",
    (value) => targetStatuses.find((status) => status.value === value)?.label ?? value,
    targetElements.statusSummary,
  );
  targetFillFeatureFilterOptions(targetElements.featureMenu);
}

function targetSetupFilterDetails() {
  document.querySelectorAll(".target-filter-details").forEach((detail) => {
    detail.addEventListener("toggle", () => {
      if (!detail.open) {
        return;
      }
      document.querySelectorAll(".target-filter-details").forEach((otherDetail) => {
        if (otherDetail !== detail) {
          otherDetail.open = false;
        }
      });
    });
  });
}

function targetBindEvents() {
  targetElements.autoRegenerate.addEventListener("click", () => {
    targetGenerateAutoRecommendations();
    targetRender();
  });
  targetElements.searchInput.addEventListener("input", () => {
    targetState.searchQuery = targetElements.searchInput.value.trim().toLocaleLowerCase("ja");
    targetState.visibleLimit = targetPageSize;
    targetScheduleRender();
  });
  targetElements.bpmMinInput.addEventListener("input", targetUpdateBpmFilters);
  targetElements.bpmMaxInput.addEventListener("input", targetUpdateBpmFilters);
  targetElements.bpmMinInput.addEventListener("blur", targetCommitBpmFilters);
  targetElements.bpmMaxInput.addEventListener("blur", targetCommitBpmFilters);
  targetElements.predMinInput.addEventListener("input", targetUpdatePredFilters);
  targetElements.predMaxInput.addEventListener("input", targetUpdatePredFilters);
  targetElements.predMinInput.addEventListener("blur", targetCommitPredFilters);
  targetElements.predMaxInput.addEventListener("blur", targetCommitPredFilters);
  targetElements.adjustedPredMinInput.addEventListener("input", targetUpdateAdjustedPredFilters);
  targetElements.adjustedPredMaxInput.addEventListener("input", targetUpdateAdjustedPredFilters);
  targetElements.adjustedPredMinInput.addEventListener("blur", targetCommitAdjustedPredFilters);
  targetElements.adjustedPredMaxInput.addEventListener("blur", targetCommitAdjustedPredFilters);
  document.querySelectorAll(".target-table thead button[data-sort-key]").forEach((button) => {
    button.addEventListener("click", () => targetSetSort(button.dataset.sortKey));
  });
  targetElements.autoTableBody.addEventListener("change", targetHandleStatusChange);
  targetElements.autoTableBody.addEventListener("change", targetHandleManualMemoChange);
  targetElements.tableBody.addEventListener("change", targetHandleStatusChange);
  targetElements.tableBody.addEventListener("change", targetHandleManualMemoChange);
  targetElements.manualTableBody.addEventListener("change", targetHandleStatusChange);
  targetElements.manualTableBody.addEventListener("change", targetHandleManualMemoChange);
  targetElements.loadMore.addEventListener("click", () => {
    targetState.visibleLimit += targetPageSize;
    targetRender();
  });
  targetElements.scrollTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
  window.addEventListener("scroll", () => {
    targetElements.scrollTop.hidden = window.scrollY < 360;
  }, { passive: true });
  window.addEventListener("resize", targetUpdateTableOverflow);
}
function targetSetPredBounds() {
  const values = targetState.rows.map((row) => row.calibrated_pred_skill).filter(Number.isFinite);
  targetState.predDataMin = values.length > 0 ? Math.min(...values) : 0;
  targetState.predDataMax = values.length > 0 ? Math.max(...values) : 999;
  targetState.predMinFilter = targetState.predDataMin;
  targetState.predMaxFilter = targetState.predDataMax;
  targetElements.predMinInput.min = String(targetState.predDataMin);
  targetElements.predMinInput.max = String(targetState.predDataMax);
  targetElements.predMaxInput.min = String(targetState.predDataMin);
  targetElements.predMaxInput.max = String(targetState.predDataMax);
  targetElements.predMinInput.value = targetFormatPredValue(targetState.predMinFilter);
  targetElements.predMaxInput.value = targetFormatPredValue(targetState.predMaxFilter);
  targetUpdateAdvancedSummary();
}

function targetSetAdjustedPredBounds() {
  const values = Array.from(targetState.adjustedPredById.values()).filter(Number.isFinite);
  const nextMin = values.length > 0 ? Math.min(...values) : 0;
  const nextMax = values.length > 0 ? Math.max(...values) : 999;
  const isDefault = targetState.adjustedPredMinFilter === targetState.adjustedPredDataMin
    && targetState.adjustedPredMaxFilter === targetState.adjustedPredDataMax;
  targetState.adjustedPredDataMin = nextMin;
  targetState.adjustedPredDataMax = nextMax;
  if (isDefault) {
    targetState.adjustedPredMinFilter = nextMin;
    targetState.adjustedPredMaxFilter = nextMax;
  }
  targetElements.adjustedPredMinInput.min = String(nextMin);
  targetElements.adjustedPredMinInput.max = String(nextMax);
  targetElements.adjustedPredMaxInput.min = String(nextMin);
  targetElements.adjustedPredMaxInput.max = String(nextMax);
  targetElements.adjustedPredMinInput.value = targetFormatPredValue(targetState.adjustedPredMinFilter);
  targetElements.adjustedPredMaxInput.value = targetFormatPredValue(targetState.adjustedPredMaxFilter);
  targetUpdateAdvancedSummary();
}

function targetShowError(message) {
  targetElements.error.textContent = message;
  targetElements.error.hidden = !message;
}

async function targetInitialize() {
  targetInitializeElements();
  targetState.recommendationSettings = targetReadRecommendationSettings();
  targetState.statusFilter = new Set(targetDefaultStatusFilter);
  targetSetupFilterDetails();
  try {
    if (typeof window.__CSV_BUNDLE__ !== "string") {
      throw new Error("データを読み込めませんでした。");
    }
    targetState.rows = targetNormalizeRows(targetParseCsv(window.__CSV_BUNDLE__));
    targetState.rowsByChartId = new Map(targetState.rows.map((row) => [String(row.chart_id), row]));
    targetSetPredBounds();
    targetPopulateFilters();
    targetBindEvents();
    targetRecalculateModel();
    targetUpdateAvailability();
    targetRender();
  } catch (error) {
    targetShowError(error instanceof Error ? error.message : "データを読み込めませんでした。");
    return;
  }

  try {
    targetState.db = await targetOpenDatabase();
    targetApplyRecords(await targetReadAllRecords());
    targetApplyManualMemos(await targetReadAllManualMemos());
    targetRecalculateModel();
    targetUpdateAvailability();
    targetRender();
  } catch (error) {
    targetState.records = new Map();
    targetRecalculateModel();
    targetUpdateAvailability();
    targetRender();
  }
}

document.addEventListener("DOMContentLoaded", targetInitialize);
