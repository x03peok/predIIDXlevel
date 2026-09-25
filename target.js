"use strict";

const targetDatabaseName = "cpi-next-clear-status";
const targetDatabaseVersion = 3;
const targetStoreName = "chart-statuses";
const targetManualMemoStoreName = "manual-targets";
const targetDailyTargetsStoreName = "daily-targets";
const targetPageSize = 100;
const targetFeatureNone = "特徴なし";
const targetUnlockEventStorageKey = "cpi-next-target-unlocked-event-sent";
const targetFeatureNames = [
  "同時押し",
  "単鍵ラッシュ",
  "物量",
  "連打",
  "連皿",
  "皿複合",
  "チャージノート",
  "BPM変化",
  "ラスト難",
];
const targetNotClearStatuses = new Set(["failed", "assisted", "easy"]);
const targetClearStatuses = new Set(["clear", "hard"]);
const targetPredModes = {
  easy: { key: "easy_pred_skill", label: "イージーPred" },
  normal: { key: "calibrated_pred_skill", label: "ノマゲPred" },
  hard: { key: "hard_pred_skill", label: "ハードPred" },
};
const targetPredModeOutcomes = {
  easy: {
    clear: new Set(["easy", "clear", "hard"]),
    notClear: new Set(["failed", "assisted"]),
  },
  normal: {
    clear: new Set(["clear", "hard"]),
    notClear: new Set(["failed", "assisted", "easy"]),
  },
  hard: {
    clear: new Set(["hard"]),
    notClear: new Set(["failed", "assisted", "easy", "clear"]),
  },
};
function targetGetPredValue(row, mode = "normal") {
  return row[targetPredModes[mode]?.key ?? targetPredModes.normal.key] ?? row.calibrated_pred_skill;
}

function targetGetPredModeForGoal(goal) {
  if (goal === "easy") return "easy";
  if (goal === "hard") return "hard";
  return "normal";
}
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
const targetGoalStatuses = [
  { value: "easy", label: "EASY" },
  { value: "clear", label: "CLEAR" },
  { value: "hard", label: "HARD以上" },
];
const targetStatusValues = new Set(targetStatuses.map(({ value }) => value));
const targetDefaultStatusFilter = targetStatuses
  .filter(({ value }) => !["unowned", "clear", "hard"].includes(value))
  .map(({ value }) => value);
const targetRecommendationSettingsKey = "cpi-next-target-recommendation-statuses";
const targetEmptyTargetGoalsConfirmedKey = "cpi-next-target-recommendation-empty-target-goals-confirmed";
const targetAutoRecommendationNoticeStorageKey = "cpi-next-target-auto-recommendation-notice-dismissed";
const targetRecommendationLevelValues = [8, 9, 10, 11, 12];
const targetRecommendationCountMin = 1;
const targetRecommendationCountMax = 20;
const targetRecommendationReasonWeights = [
  { key: "opportunity", weight: 1 },
  { key: "slight-opportunity", weight: 2 },
  { key: "appropriate", weight: 4 },
  { key: "slight-challenge", weight: 2 },
  { key: "challenge", weight: 1 },
];
const targetRecommendationReasonLabels = {
  opportunity: "狙い目",
  "slight-opportunity": "やや狙い目",
  appropriate: "適正",
  "slight-challenge": "やや挑戦",
  challenge: "挑戦",
};
const targetRecommendationFeatureLabels = {
  favorable: "得意",
  "slight-favorable": "やや得意",
  balanced: "普通",
  "slight-unfavorable": "やや苦手",
  unfavorable: "苦手",
};const targetRecommendationDifficultyValues = Object.keys(targetRecommendationReasonLabels);
const targetRecommendationFeatureReasonValues = Object.keys(targetRecommendationFeatureLabels);
const targetDefaultRecommendationSettings = {
  difficultyReasons: ["slight-opportunity", "appropriate", "slight-challenge"],
  featureReasons: [...targetRecommendationFeatureReasonValues],
  features: [targetFeatureNone, ...targetFeatureNames],
  featureFilters: targetGetDefaultRecommendationFeatureFilters(),
  count: 10,
  // Keep these defaults for the existing candidate scope and old saved settings.
  levels: [...targetRecommendationLevelValues],
  statuses: ["unregistered", "no-play", "failed", "assisted", "easy"],
  targetGoals: targetGoalStatuses.map(({ value }) => value),
};const targetDifficultyOrder = ["N", "H", "A", "L"];
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
  autoRecommendationMetaById: new Map(),
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
  modelsByMode: { easy: null, normal: null, hard: null },
  deltas: new Array(targetFeatureNames.length).fill(0),
  adjustedPredById: new Map(),
  goalById: new Map(),
  expectedProbabilityById: new Map(),
  targetWasAvailable: false,
  analyticsStateTracked: false,
};

const targetElements = {};
let targetRecommendationDraft = null;

function targetReadAutoRecommendationNoticeDismissed() {
  try {
    return window.localStorage.getItem(targetAutoRecommendationNoticeStorageKey) === "1";
  } catch {
    return false;
  }
}
function targetDismissAutoRecommendationNotice() {
  try {
    window.localStorage.setItem(targetAutoRecommendationNoticeStorageKey, "1");
  } catch {
    // Continue hiding the notice even when storage is unavailable.
  }
  if (targetElements.autoNotice) targetElements.autoNotice.hidden = true;
}

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
      const easyPred = targetGetNumericValue(source.easy_pred_skill);
      const calibratedPred = targetGetNumericValue(source.calibrated_pred_skill);
      const hardPred = targetGetNumericValue(source.hard_pred_skill);
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
        easy_pred_skill: easyPred,
        calibrated_pred_skill: calibratedPred,
        hard_pred_skill: hardPred,
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
    ...targetFeatureNames.filter((feature) => available.has(feature)),
    ...Array.from(available).filter((feature) => feature !== targetFeatureNone && !targetFeatureNames.includes(feature)),
    targetFeatureNone,
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
    ...values.map((feature, index) => '<div class="multi-filter__option feature-filter__option"><span class="feature-filter__name">' + targetEscapeHtml(feature) + '</span><label class="feature-filter__mode"><input type="checkbox" data-feature-index="' + index + '" data-feature-mode="include" checked><span>含む</span></label><label class="feature-filter__mode"><input type="checkbox" data-feature-index="' + index + '" data-feature-mode="exclude" checked><span>含まない</span></label></div>'),
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
  const targetGoal = targetGetGoal(row);
  if (!targetGoal || !targetState.recommendationSettings.targetGoals.includes(targetGoal)) {
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
    const leftMode = targetGetPredModeForGoal(targetGetGoal(left));
    const rightMode = targetGetPredModeForGoal(targetGetGoal(right));
    comparison = targetCompareNumeric(
      targetGetAdjustedPred(left, leftMode),
      targetGetAdjustedPred(right, rightMode),
    );
  } else if (targetState.sortKey === "bpm") {
    const key = targetState.sortDirection === "desc" ? "bpm_max" : "bpm_min";
    comparison = targetCompareNumeric(left[key], right[key]);
  } else if (targetState.sortKey === "status") {
    const leftIndex = targetStatuses.findIndex(({ value }) => value === targetGetStatus(left));
    const rightIndex = targetStatuses.findIndex(({ value }) => value === targetGetStatus(right));
    comparison = leftIndex - rightIndex;
  } else if (targetState.sortKey === "calibrated_pred_skill") {
    const leftMode = targetGetPredModeForGoal(targetGetGoal(left));
    const rightMode = targetGetPredModeForGoal(targetGetGoal(right));
    comparison = targetCompareNumeric(
      targetGetPredValue(left, leftMode),
      targetGetPredValue(right, rightMode),
    );
  } else if (targetState.sortKey === "original_level") {
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
  if (!Number.isFinite(numeric)) {
    return "";
  }

  const stops = [
    { value: 8, color: [37, 99, 235] },
    { value: 9, color: [249, 115, 22] },
    { value: 10, color: [22, 163, 74] },
    { value: 11, color: [220, 38, 38] },
    { value: 12, color: [147, 51, 234] },
    { value: 13, color: [109, 40, 217] },
    { value: 14, color: [76, 29, 149] },
  ];
  const clamped = Math.min(stops[stops.length - 1].value, Math.max(stops[0].value, numeric));
  let start = stops[0];
  let end = stops[stops.length - 1];
  for (let index = 1; index < stops.length; index += 1) {
    if (clamped <= stops[index].value) {
      start = stops[index - 1];
      end = stops[index];
      break;
    }
  }
  const ratio = end.value > start.value
    ? (clamped - start.value) / (end.value - start.value)
    : 0;
  const channels = start.color.map((channel, index) => Math.round(
    channel + (end.color[index] - channel) * ratio,
  ));
  return "rgb(" + channels.join(", ") + ")";
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

function targetRenderPredStack(row, adjusted = false, mode = null) {
  const entries = mode && targetPredModes[mode]
    ? [[mode, targetPredModes[mode]]]
    : Object.entries(targetPredModes);
  const values = entries.map(([predMode, definition]) => {
    const raw = targetGetPredValue(row, predMode);
    const value = adjusted ? targetGetAdjustedPred(row, predMode) : raw;
    const difference = adjusted ? targetFormatPredDifference(value - raw) : "";
    const differenceText = adjusted ? " (" + difference + ")" : "";
    const label = mode ? "" : '<span>' + definition.label + '</span>';
    return '<span class="target-pred-stack__item target-pred-stack__item--' + predMode + '">' + label + '<strong class="numeric-value numeric-value--pred"' + targetGetNumericColorStyle(value) + '>' + targetEscapeHtml(targetFormatPredValue(value)) + '</strong>' + (differenceText ? '<small>' + targetEscapeHtml(differenceText) + '</small>' : "") + '</span>';
  }).join("");
  return '<div class="target-pred-stack">' + values + '</div>';
}

function targetRenderTableRow(row, tableType = "default") {
  const levelText = "☆" + targetFormatPredValue(row.original_level).replace(".0", "");
  const difficulty = targetNormalizeDifficulty(row.difficulty);
  const predMode = targetGetPredModeForGoal(targetGetGoal(row));
  const cells = [
    '<td class="memo-cell">' + targetRenderMemoCheckbox(row) + "</td>",
    '<td class="mono numeric-value numeric-value--level">' + targetEscapeHtml(levelText) + "</td>",
    '<td class="chart-title-cell"><a class="chart-link ' + targetGetDifficultyClass(difficulty) + '" href="' + targetEscapeHtml(targetGetChartHref(row)) + '"><span class="chart-title-cell__name">' + targetEscapeHtml(row.title) + '</span> <span class="chart-title-cell__difficulty">[' + targetEscapeHtml(difficulty) + "]</span></a></td>",
    '<td class="target-status-cell">' + targetRenderStatusSelect(row) + "</td>",
    '<td class="target-goal-cell">' + targetRenderGoalSelect(row, true) + "</td>",
    '<td class="mono target-adjusted-pred">' + targetRenderPredStack(row, true, predMode) + "</td>",
    '<td class="mono target-raw-pred">' + targetRenderPredStack(row, false, predMode) + "</td>",
    "<td>" + targetFormatBpmCell(row) + "</td>",
    '<td class="feature-cell">' + targetRenderFeatureChips(row) + "</td>",
  ];
  return "<tr>" + cells.join("") + "</tr>";
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
  [targetElements.manualTableShell, targetElements.tableShell]
    .filter(Boolean)
    .forEach((shell) => {
      shell.classList.toggle("is-overflowing", shell.scrollWidth > shell.clientWidth + 1);
    });
}


function targetGetStatusRank(status) {
  return targetStatuses.findIndex(({ value }) => value === status);
}

function targetGetGoalOptions(status) {
  const currentRank = targetGetStatusRank(status);
  const targetGoals = targetState.recommendationSettings.targetGoals;
  return targetGoalStatuses.filter(({ value }) => (
    targetGetStatusRank(value) > currentRank && targetGoals.includes(value)
  ));
}

function targetGetGoal(row) {
  const status = targetGetStatus(row);
  const options = targetGetGoalOptions(status);
  const stored = targetState.goalById.get(String(row.chart_id));
  if (stored && options.some(({ value }) => value === stored)) {
    return stored;
  }
  return options[0]?.value ?? null;
}

function targetRenderGoalSelect(row, disabled = false) {
  const status = targetGetStatus(row);
  const options = targetGetGoalOptions(status);
  if (options.length === 0) {
    return '<span class="target-goal-empty">ー</span>';
  }
  const selected = targetGetGoal(row);
  return '<select class="target-status-select target-goal-select" data-status="' + targetEscapeHtml(selected ?? "")
    + '" data-target-goal-chart-id="' + targetEscapeHtml(row.chart_id)
    + '" aria-label="' + targetEscapeHtml(row.title) + "の目標ランプ" + (disabled ? '" disabled' : '"') + '>'
    + options.map(({ value, label }) => '<option value="' + value + '"' + (value === selected ? ' selected' : '') + '>' + label + '</option>').join("")
    + '</select>';
}

function targetGetDefaultGoalForStatus(status) {
  return targetGetGoalOptions(status)[0]?.value ?? null;
}

function targetGetRecommendationProbabilityBand(probabilityPercent) {
  if (probabilityPercent > 75) {
    return "opportunity";
  }
  if (probabilityPercent >= 60) {
    return "slight-opportunity";
  }
  if (probabilityPercent >= 40) {
    return "appropriate";
  }
  if (probabilityPercent >= 25) {
    return "slight-challenge";
  }
  return "challenge";
}

function targetGetRecommendationFeatureBand(delta) {
  const numericDelta = targetGetNumericValue(delta);
  if (numericDelta === null) {
    return "balanced";
  }
  if (numericDelta < -0.2) {
    return "favorable";
  }
  if (numericDelta < -0.1) {
    return "slight-favorable";
  }
  if (numericDelta <= 0.1) {
    return "balanced";
  }
  if (numericDelta <= 0.2) {
    return "slight-unfavorable";
  }
  return "unfavorable";
}

function targetRecommendationFeatureMatches(row, featureFilters) {
  const rowFeatures = new Set(targetGetRowFeatures(row));
  if (featureFilters && typeof featureFilters === "object" && !Array.isArray(featureFilters)) {
    return Object.entries(featureFilters).every(([feature, setting]) => {
      if (!setting || setting.include === setting.exclude) {
        return true;
      }
      const hasFeature = rowFeatures.has(feature);
      return setting.include ? hasFeature : !hasFeature;
    });
  }

  const selected = new Set(Array.isArray(featureFilters) ? featureFilters : []);
  if (selected.size === 0) {
    return false;
  }
  return [...rowFeatures].some((feature) => selected.has(feature));
}
function targetGetAutoCandidateDetails() {
  if (!targetState.model) {
    return [];
  }
  const settings = targetState.recommendationSettings;
  const difficultyReasons = Array.isArray(settings.difficultyReasons)
    ? settings.difficultyReasons
    : targetDefaultRecommendationSettings.difficultyReasons;
  const featureReasons = Array.isArray(settings.featureReasons)
    ? settings.featureReasons
    : targetDefaultRecommendationSettings.featureReasons;
  return targetState.rows.map((row) => {
    const status = targetGetStatus(row);
    if (!settings.statuses.includes(status) || !settings.levels.includes(row.original_level)) {
      return null;
    }
    if (!targetRecommendationFeatureMatches(row, settings.featureFilters ?? settings.features)) {
      return null;
    }
    const goal = targetGetDefaultGoalForStatus(status);
    if (!goal || !settings.targetGoals.includes(goal)) {
      return null;
    }
    const predMode = targetGetPredModeForGoal(goal);
    const rawPred = targetGetNumericValue(targetGetPredValue(row, predMode));
    const adjustedPred = targetGetNumericValue(targetGetAdjustedPred(row, predMode));
    const probability = targetGetExpectedClearProbability(row, predMode, adjustedPred);
    const probabilityPercent = probability === null ? null : probability * 100;
    if (!Number.isFinite(probabilityPercent) || rawPred === null || adjustedPred === null) {
      return null;
    }
    const appropriatePred = targetGetRecommendationAppropriatePred(predMode);
    const appropriateDifference = appropriatePred === null ? null : adjustedPred - appropriatePred;
    const correctionDifference = adjustedPred - rawPred;
    const probabilityReason = targetGetRecommendationProbabilityBand(probabilityPercent);
    const featureReason = targetGetRecommendationFeatureBand(correctionDifference);
    if (!difficultyReasons.includes(probabilityReason) || !featureReasons.includes(featureReason)) {
      return null;
    }
    return {
      row,
      goal,
      predMode,
      probability,
      probabilityPercent,
      probabilityReason,
      featureReason,
      rawPred,
      adjustedPred,
      appropriateDifference,
      correctionDifference,
    };
  }).filter(Boolean);
}

function targetRenderRecommendationReasonTag(axis, value) {
  const isFeature = axis === "feature";
  const labels = isFeature ? targetRecommendationFeatureLabels : targetRecommendationReasonLabels;
  const label = labels[value] ?? (isFeature ? "普通" : "適正");
  const prefix = isFeature ? "譜面傾向: " : "難易度: ";
  return '<span class="target-recommendation-reason target-recommendation-reason--'
    + targetEscapeHtml(value)
    + '">'
    + targetEscapeHtml(prefix + label)
    + '</span>';
}
function targetRenderRecommendationCard(row, candidate) {
  const difficulty = targetNormalizeDifficulty(row.difficulty);
  const levelText = "☆" + targetFormatPredValue(row.original_level).replace(".0", "");
  const goal = candidate.goal ?? targetGetGoal(row);
  const predMode = targetGetPredModeForGoal(goal);
  const goalDefinition = targetGoalStatuses.find(({ value }) => value === goal);
  const goalLabel = goalDefinition?.value === "hard"
    ? "HARD"
    : (goalDefinition?.label ?? "ー");
  const adjustedPred = targetGetNumericValue(candidate.adjustedPred ?? targetGetAdjustedPred(row, predMode));
  const appropriateDifference = targetGetNumericValue(candidate.appropriateDifference);
  const correctionDifference = targetGetNumericValue(candidate.correctionDifference);
  const predDifferenceMarkup = Number.isFinite(appropriateDifference) && Number.isFinite(correctionDifference)
    ? '<div class="target-recommendation-card__pred-differences">'
      + '<span>適正' + targetEscapeHtml(targetFormatPredDifference(appropriateDifference)) + '</span>'
      + '<span aria-hidden="true"> / </span>'
      + '<span>補正' + targetEscapeHtml(targetFormatPredDifference(correctionDifference)) + '</span>'
      + '</div>'
    : "";
  const featureMarkup = targetRenderFeatureChips(row)
    || '<div class="feature-chips"><span class="feature-chip feature-chip--none">特徴なし</span></div>';
  return '<article class="target-recommendation-card" data-chart-id="'
    + targetEscapeHtml(row.chart_id) + '">'
    + '<div class="target-recommendation-card__stage">'
    + targetRenderRecommendationReasonTag("probability", candidate.probabilityReason)
    + '<span class="target-recommendation-card__stage-separator" aria-hidden="true">｜</span>'
    + targetRenderRecommendationReasonTag("feature", candidate.featureReason)
    + '</div>'
    + '<div class="target-recommendation-card__content">'
    + '<a class="target-recommendation-card__title chart-link ' + targetGetDifficultyClass(difficulty) + '" href="'
    + targetEscapeHtml(targetGetChartHref(row)) + '">'
    + '<span class="target-recommendation-card__name">' + targetEscapeHtml(row.title) + '</span> '
    + '<span class="target-recommendation-card__difficulty">[' + targetEscapeHtml(difficulty) + ']</span>'
    + '</a>'
    + '<div class="target-recommendation-card__metrics">'
    + '<span class="mono numeric-value numeric-value--level"'
    + targetGetNumericColorStyle(row.original_level) + '>' + targetEscapeHtml(levelText) + '</span>'
    + '<div class="target-recommendation-card__pred-group">'
    + '<span class="target-recommendation-card__pred-value"><span>補正Pred</span> '
    + '<strong class="mono numeric-value numeric-value--pred"'
    + targetGetNumericColorStyle(adjustedPred) + '>' + targetEscapeHtml(targetFormatPredValue(adjustedPred))
    + '</strong>'
    + '</span>'
    + predDifferenceMarkup
    + '</div>'
    + '</div>'
    + '<div class="target-recommendation-card__feature">' + featureMarkup + '</div>'
    + '<div class="target-recommendation-card__status-flow">'
    + '<div class="target-recommendation-card__status-block">'
    + targetRenderStatusSelect(row)
    + '</div>'
    + '<span class="target-recommendation-card__status-arrow" aria-hidden="true">→</span>'
    + '<div class="target-recommendation-card__status-block target-recommendation-card__status-block--goal"><span class="target-recommendation-card__status-label">目標</span>'
    + '<span class="target-recommendation-status target-recommendation-status--goal target-recommendation-status--'
    + targetEscapeHtml(goal) + '">' + targetEscapeHtml(goalLabel) + '</span>'
    + '</div>'
    + '</div>'
    + '</div>'
    + '</article>';
}
function targetGenerateAutoRecommendations() {
  const candidates = targetGetAutoCandidateDetails();
  const count = targetNormalizeRecommendationCount(targetState.recommendationSettings.count);
  const selected = targetShuffleRows(candidates)
    .slice(0, count)
    .sort((left, right) => {
      const comparison = targetCompareNumeric(left.adjustedPred, right.adjustedPred);
      if (comparison !== 0) {
        return comparison;
      }
      return (left.row.__order ?? 0) - (right.row.__order ?? 0);
    });

  targetState.autoRecommendationCandidateCount = candidates.length;
  targetState.autoRecommendationIds = selected.map(({ row }) => String(row.chart_id));
  targetState.autoRecommendationMetaById = new Map(
    selected.map((candidate) => [String(candidate.row.chart_id), candidate]),
  );
  targetState.autoRecommendationsInitialized = true;
}
function targetRenderAutoRecommendations() {
  const recommendedRows = targetState.autoRecommendationIds
    .map((chartId) => ({
      row: targetState.rowsByChartId.get(chartId),
      candidate: targetState.autoRecommendationMetaById.get(chartId),
    }))
    .filter(({ row, candidate }) => row && candidate);
  targetElements.autoRowCount.textContent = recommendedRows.length.toLocaleString()
    + "件表示 / " + targetState.autoRecommendationCandidateCount.toLocaleString() + "件中";
  targetElements.autoCards.innerHTML = recommendedRows
    .map(({ row, candidate }) => targetRenderRecommendationCard(row, candidate))
    .join("");
  targetElements.autoCards.hidden = recommendedRows.length === 0;
  targetElements.autoEmpty.hidden = recommendedRows.length > 0;
}

function targetRenderManualMemos() {
  const memoRows = targetState.rows
    .filter((row) => targetState.manualMemoIds.has(String(row.chart_id)))
    .filter((row) => {
      const targetGoal = targetGetGoal(row);
      return targetGoal && targetState.recommendationSettings.targetGoals.includes(targetGoal);
    })
    .sort(targetCompareRows);
  targetElements.manualRowCount.textContent = memoRows.length.toLocaleString() + "件";
  targetElements.manualTableBody.innerHTML = memoRows.map((row) => targetRenderTableRow(row)).join("");
  targetElements.manualTableShell.hidden = memoRows.length === 0;
  targetElements.manualEmpty.hidden = memoRows.length > 0;
}

function targetRenderMainTable() {
  const filteredRows = targetGetFilteredRows();
  const visibleRows = filteredRows.slice(0, targetState.visibleLimit);
  targetElements.rowCount.textContent = visibleRows.length.toLocaleString()
    + "件表示 / " + filteredRows.length.toLocaleString() + "件中";
  targetElements.tableBody.innerHTML = visibleRows.map((row) => targetRenderTableRow(row)).join("");
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

function targetRenderStatusSelect(row, disabled = false) {
  const status = targetGetStatus(row);
  return '<select class="target-status-select" data-status="' + targetEscapeHtml(status)
    + '" data-chart-id="' + targetEscapeHtml(row.chart_id)
    + '" aria-label="' + targetEscapeHtml(row.title) + "の目標ランプ" + (disabled ? '" disabled' : '"') + '>'
    + targetStatusOptions(status) + "</select>";
}

function targetUpdateStatusSelect(select) {
  select.dataset.status = select.value;
}

function targetGetStatus(row) {
  const status = String(targetState.records.get(String(row.chart_id))?.status ?? "").toLowerCase();
  return targetStatusValues.has(status) ? status : "unregistered";
}

function targetGetRecommendationFeatureValues() {
  return [targetFeatureNone, ...targetFeatureNames];
}

function targetGetDefaultRecommendationFeatureFilters() {
  return Object.fromEntries(targetGetRecommendationFeatureValues().map((feature) => [
    feature,
    { include: true, exclude: true },
  ]));
}

function targetNormalizeRecommendationFeatureFilters(values, fallback = targetGetDefaultRecommendationFeatureFilters()) {
  const source = values && typeof values === "object" && !Array.isArray(values) ? values : {};
  const keys = new Set([
    ...targetGetRecommendationFeatureValues(),
    ...Object.keys(fallback ?? {}),
    ...Object.keys(source),
  ]);
  return Object.fromEntries([...keys].map((feature) => {
    const setting = source[feature] ?? fallback?.[feature];
    return [feature, {
      include: setting?.include === true,
      exclude: setting?.exclude === true,
    }];
  }));
}

function targetCloneRecommendationFeatureFilters(values) {
  return targetNormalizeRecommendationFeatureFilters(values);
}
function targetGetDefaultRecommendationSettings() {
  return {
    difficultyReasons: [...targetDefaultRecommendationSettings.difficultyReasons],
    featureReasons: [...targetDefaultRecommendationSettings.featureReasons],
    features: [...targetDefaultRecommendationSettings.features],
    featureFilters: targetCloneRecommendationFeatureFilters(targetDefaultRecommendationSettings.featureFilters),
    count: targetDefaultRecommendationSettings.count,
    levels: [...targetDefaultRecommendationSettings.levels],
    statuses: [...targetDefaultRecommendationSettings.statuses],
    targetGoals: [...targetDefaultRecommendationSettings.targetGoals],
  };
}

function targetNormalizeRecommendationProbability(value, fallback) {
  const numeric = Number(value);
  return Number.isInteger(numeric)
    ? Math.min(100, Math.max(0, numeric))
    : fallback;
}

function targetNormalizeRecommendationSelection(values, options, fallback) {
  if (!Array.isArray(values)) {
    return [...fallback];
  }
  return [...new Set(values)].filter((value) => options.includes(value));
}

function targetNormalizeRecommendationFeatures(values, fallback) {
  if (!Array.isArray(values)) {
    return [...fallback];
  }
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function targetGetRecommendationReasonsFromProbabilityRange(min, max) {
  const numericMin = Number.isFinite(min) ? min : 40;
  const numericMax = Number.isFinite(max) ? max : 60;
  if (numericMin === numericMax) {
    return [targetGetRecommendationProbabilityBand(numericMin)];
  }
  const ranges = [
    { key: "challenge", min: 0, max: 25 },
    { key: "slight-challenge", min: 25, max: 40 },
    { key: "appropriate", min: 40, max: 60 },
    { key: "slight-opportunity", min: 60, max: 75 },
    { key: "opportunity", min: 75, max: 100 },
  ];
  const selected = ranges
    .filter(({ min: rangeMin, max: rangeMax }) => numericMax > rangeMin && numericMin < rangeMax)
    .map(({ key }) => key);
  return selected.length > 0 ? selected : ["appropriate"];
}

function targetNormalizeRecommendationCount(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric)
    && numeric >= targetRecommendationCountMin
    && numeric <= targetRecommendationCountMax
    ? numeric
    : 10;
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

    const legacyMin = targetNormalizeRecommendationProbability(parsed.probabilityMin, 40);
    const legacyMax = targetNormalizeRecommendationProbability(parsed.probabilityMax, 60);
    const difficultyReasons = Array.isArray(parsed.difficultyReasons)
      ? targetNormalizeRecommendationSelection(
        parsed.difficultyReasons,
        targetRecommendationDifficultyValues,
        fallback.difficultyReasons,
      )
      : targetGetRecommendationReasonsFromProbabilityRange(legacyMin, legacyMax);
    const featureReasons = Array.isArray(parsed.featureReasons)
      ? targetNormalizeRecommendationSelection(
        parsed.featureReasons,
        targetRecommendationFeatureReasonValues,
        fallback.featureReasons,
      )
      : [...fallback.featureReasons];
    const features = targetNormalizeRecommendationFeatures(parsed.features, fallback.features);
    const featureFilters = targetNormalizeRecommendationFeatureFilters(parsed.featureFilters, fallback.featureFilters);
    const count = targetNormalizeRecommendationCount(parsed.count);
    const levels = Array.isArray(parsed.levels)
      ? [...new Set(parsed.levels
        .map((value) => Number(value))
        .filter((value) => targetRecommendationLevelValues.includes(value)))]
      : [...fallback.levels];
    const statuses = Array.isArray(parsed.statuses)
      ? [...new Set(parsed.statuses.filter((value) => targetStatusValues.has(value)))]
      : [...fallback.statuses];
    const targetGoals = Array.isArray(parsed.targetGoals)
      ? [...new Set(parsed.targetGoals.filter((value) => targetGoalStatuses.some((goal) => goal.value === value)))]
      : [...fallback.targetGoals];
    const emptyGoalsConfirmed = window.localStorage?.getItem(targetEmptyTargetGoalsConfirmedKey) === "1";
    const effectiveTargetGoals = targetGoals.length === 0 && !emptyGoalsConfirmed
      ? [...fallback.targetGoals]
      : targetGoals;
    return {
      difficultyReasons,
      featureReasons,
      features,
      featureFilters,
      count,
      levels,
      statuses,
      targetGoals: effectiveTargetGoals,
    };
  } catch (error) {
    // Fall back to the default when local storage is unavailable or invalid.
  }
  return fallback;
}

function targetCloneRecommendationSettings(settings) {
  const source = settings ?? targetGetDefaultRecommendationSettings();
  return {
    difficultyReasons: [...(source.difficultyReasons ?? targetDefaultRecommendationSettings.difficultyReasons)],
    featureReasons: [...(source.featureReasons ?? targetDefaultRecommendationSettings.featureReasons)],
    features: [...(source.features ?? targetDefaultRecommendationSettings.features)],
    featureFilters: targetCloneRecommendationFeatureFilters(source.featureFilters ?? targetDefaultRecommendationSettings.featureFilters),
    count: targetNormalizeRecommendationCount(source.count),
    levels: [...(source.levels ?? targetDefaultRecommendationSettings.levels)],
    statuses: [...(source.statuses ?? targetDefaultRecommendationSettings.statuses)],
    targetGoals: [...(source.targetGoals ?? targetDefaultRecommendationSettings.targetGoals)],
  };
}
function targetSetRecommendationSettingsMessage(message, isError = false) {
  if (!targetElements.autoSettingsMessage) {
    return;
  }
  targetElements.autoSettingsMessage.textContent = message;
  targetElements.autoSettingsMessage.dataset.state = isError ? "error" : "ok";
}

function targetAreAllRecommendationValuesSelected(selectedValues, options) {
  return selectedValues.size === options.length
    && options.every(({ value }) => selectedValues.has(value));
}

function targetUpdateRecommendationSummary(summary, selectedValues, options) {
  if (!summary) {
    return;
  }
  if (targetAreAllRecommendationValuesSelected(selectedValues, options)) {
    summary.textContent = "all";
    summary.title = "";
    return;
  }
  if (selectedValues.size === 0) {
    summary.textContent = "none";
    summary.title = "";
    return;
  }
  const labels = options
    .filter(({ value }) => selectedValues.has(value))
    .map(({ label }) => label);
  summary.textContent = labels.length === 1 ? labels[0] : labels.length + " selected";
  summary.title = labels.join(", ");
}

function targetRenderRecommendationFilter({ container, summary, options, settingKey, includeAll = true }) {
  if (!container || !targetRecommendationDraft) {
    return;
  }
  const values = options.map(({ value }) => value);
  const selectedValues = new Set(targetRecommendationDraft[settingKey]);
  const convertValue = (value) => typeof values[0] === "number" ? Number(value) : value;

  const syncCheckboxes = () => {
    const allInput = container.querySelector("input[data-filter-all]");
    if (allInput) {
      allInput.checked = targetAreAllRecommendationValuesSelected(selectedValues, options);
    }
    container.querySelectorAll("input[data-filter-option]").forEach((input) => {
      input.checked = selectedValues.has(convertValue(input.value));
    });
    targetUpdateRecommendationSummary(summary, selectedValues, options);
  };

  const fragment = document.createDocumentFragment();
  let allInput = null;
  if (includeAll) {
    const allLabel = document.createElement("label");
    allLabel.className = "multi-filter__option multi-filter__option--all";
    allInput = document.createElement("input");
    allInput.type = "checkbox";
    allInput.dataset.filterAll = "true";
    const allText = document.createElement("span");
    allText.textContent = "all";
    allLabel.append(allInput, allText);
    fragment.append(allLabel);
  }

  for (const option of options) {
    const label = document.createElement("label");
    label.className = "multi-filter__option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.dataset.filterOption = "true";
    input.value = String(option.value);
    const text = document.createElement("span");
    text.textContent = option.label;
    label.append(input, text);
    fragment.append(label);
  }
  container.replaceChildren(fragment);
  syncCheckboxes();

  if (allInput) {
    allInput.addEventListener("change", () => {
      selectedValues.clear();
      if (allInput.checked) {
        values.forEach((value) => selectedValues.add(value));
      }
      targetRecommendationDraft[settingKey] = [...selectedValues];
      syncCheckboxes();
    });
  }
  container.querySelectorAll("input[data-filter-option]").forEach((input) => {
    input.addEventListener("change", () => {
      selectedValues.clear();
      container.querySelectorAll("input[data-filter-option]:checked").forEach((checkedInput) => {
        selectedValues.add(convertValue(checkedInput.value));
      });
      targetRecommendationDraft[settingKey] = [...selectedValues];
      syncCheckboxes();
    });
  });
}
function targetRenderRecommendationFeatureFilter() {
  const container = targetElements.recommendationFeatureOptions;
  if (!container || !targetRecommendationDraft) {
    return;
  }
  const values = targetGetFeatureOptions();
  const featureFilters = targetNormalizeRecommendationFeatureFilters(
    targetRecommendationDraft.featureFilters,
  );
  values.forEach((feature) => {
    if (!featureFilters[feature]) {
      featureFilters[feature] = { include: true, exclude: true };
    }
  });
  targetRecommendationDraft.featureFilters = featureFilters;

  const fragment = document.createDocumentFragment();
  const allLabel = document.createElement("label");
  allLabel.className = "multi-filter__option multi-filter__option--all";
  const allInput = document.createElement("input");
  allInput.type = "checkbox";
  allInput.dataset.recommendationFeatureAll = "true";
  const allText = document.createElement("span");
  allText.textContent = "all";
  allLabel.append(allInput, allText);
  fragment.append(allLabel);

  for (const feature of values) {
    const row = document.createElement("div");
    row.className = "multi-filter__option feature-filter__option";
    const name = document.createElement("span");
    name.className = "feature-filter__name";
    name.textContent = feature;
    row.append(name);
     for (const [mode, labelText] of [["include", "含む"], ["exclude", "含まない"]]) {
      const label = document.createElement("label");
      label.className = "feature-filter__mode";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.recommendationFeatureMode = mode;
      checkbox.dataset.recommendationFeatureValue = feature;
      checkbox.checked = featureFilters[feature][mode];
      const text = document.createElement("span");
      text.textContent = labelText;
      label.append(checkbox, text);
      row.append(label);

      checkbox.addEventListener("change", () => {
        featureFilters[feature][mode] = checkbox.checked;
        syncCheckboxes();
      });
    }
    fragment.append(row);
  }

  const syncCheckboxes = () => {
    allInput.checked = values.every((feature) => {
      const setting = featureFilters[feature];
      return setting?.include === true && setting?.exclude === true;
    });
    container.querySelectorAll("input[data-recommendation-feature-mode]").forEach((input) => {
      const setting = featureFilters[input.dataset.recommendationFeatureValue];
      input.checked = setting?.[input.dataset.recommendationFeatureMode] === true;
    });
  };

  container.replaceChildren(fragment);
  syncCheckboxes();
  allInput.addEventListener("change", () => {
    values.forEach((feature) => {
      featureFilters[feature].include = allInput.checked;
      featureFilters[feature].exclude = allInput.checked;
    });
    syncCheckboxes();
  });
}
function targetUpdateRecommendationInputs() {
  if (!targetRecommendationDraft) {
    return;
  }
  targetElements.recommendationCount.value = String(targetRecommendationDraft.count);
}

function targetRenderRecommendationSettings() {
  if (!targetRecommendationDraft) {
    targetRecommendationDraft = targetCloneRecommendationSettings(targetState.recommendationSettings);
  }
  targetUpdateRecommendationInputs();
  targetRenderRecommendationFilter({
    container: targetElements.recommendationDifficultyOptions,
    summary: targetElements.recommendationDifficultySummary,
    options: targetRecommendationDifficultyValues.map((value) => ({
      value,
      label: targetRecommendationReasonLabels[value],
    })),
    settingKey: "difficultyReasons",
    includeAll: false,
  });
  targetRenderRecommendationFilter({
    container: targetElements.recommendationFeatureReasonOptions,
    summary: targetElements.recommendationFeatureReasonSummary,
    options: targetRecommendationFeatureReasonValues.map((value) => ({
      value,
      label: targetRecommendationFeatureLabels[value],
    })),
    settingKey: "featureReasons",
    includeAll: false,
  });
  targetRenderRecommendationFeatureFilter();
  targetRenderRecommendationFilter({
    container: targetElements.recommendationGoalOptions,
    summary: null,
    options: targetGoalStatuses,
    settingKey: "targetGoals",
    includeAll: false,
  });

}

function targetCommitRecommendationCount() {
  if (!targetRecommendationDraft) {
    return;
  }
  targetRecommendationDraft.count = targetNormalizeRecommendationCount(
    targetElements.recommendationCount.value,
  );
  targetUpdateRecommendationInputs();
}
function targetOpenRecommendationSettings() {
  targetRecommendationDraft = targetCloneRecommendationSettings(targetState.recommendationSettings);
  targetRenderRecommendationSettings();
  targetElements.autoSettingsOverlay.hidden = false;
  targetElements.autoSettingsPanel.hidden = false;
  document.body.classList.add("target-settings-modal-open");
  targetElements.autoSettingsButton?.setAttribute("aria-expanded", "true");
  targetSetRecommendationSettingsMessage("");
}

function targetCloseRecommendationSettings() {
  targetElements.autoSettingsOverlay.hidden = true;
  targetElements.autoSettingsPanel.hidden = true;
  document.body.classList.remove("target-settings-modal-open");
  targetElements.autoSettingsButton?.setAttribute("aria-expanded", "false");
  targetRecommendationDraft = null;
}

function targetSaveRecommendationSettings() {
  const draft = targetRecommendationDraft
    ? targetCloneRecommendationSettings(targetRecommendationDraft)
    : targetCloneRecommendationSettings(targetState.recommendationSettings);
  draft.count = targetNormalizeRecommendationCount(targetElements.recommendationCount.value);
  if (draft.targetGoals.length === 0
    && !window.confirm("マイターゲットに曲が表示されなくなります。よろしいですか？")) {
    return;
  }
  try {
    window.localStorage?.setItem(targetRecommendationSettingsKey, JSON.stringify(draft));
    targetState.recommendationSettings = targetCloneRecommendationSettings(draft);
    targetRecommendationDraft = targetCloneRecommendationSettings(draft);
    targetRenderRecommendationSettings();
    targetState.autoRecommendationsInitialized = false;
    targetRender();
    window.dispatchEvent(new Event("cpi:recommendation-settings-changed"));
    targetSetRecommendationSettingsMessage("自動リコメンド設定を保存しました。");
  } catch (error) {
    targetSetRecommendationSettingsMessage("自動リコメンド設定を保存できませんでした。", true);
  }
}

function targetResetRecommendationSettings() {
  targetRecommendationDraft = targetGetDefaultRecommendationSettings();
  targetRenderRecommendationSettings();
  targetSetRecommendationSettingsMessage("設定をデフォルトに戻しました。");
}

function targetShuffleRows(rows) {
  const shuffled = [...rows];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function targetGetPredObservations(mode = "normal") {
  const observations = [];
  const modes = mode === "overall"
    ? Object.keys(targetPredModes)
    : [targetPredModes[mode] ? mode : "normal"];
  targetState.records.forEach((record, chartId) => {
    const row = targetState.rowsByChartId.get(String(chartId));
    if (!row) {
      return;
    }
    const status = String(record?.status ?? "").toLowerCase();
    modes.forEach((predMode) => {
      const definition = targetPredModes[predMode];
      const outcomes = targetPredModeOutcomes[predMode];
      const pred = targetGetNumericValue(row[definition.key]);
      const outcome = outcomes.clear.has(status)
        ? 1
        : outcomes.notClear.has(status)
          ? 0
          : null;
      if (pred !== null && outcome !== null) {
        observations.push({ row, pred, outcome, mode: predMode });
      }
    });
  });
  return observations;
}
function targetGetModelBounds(mode, observations) {
  const keys = mode === "overall"
    ? Object.values(targetPredModes).map((definition) => definition.key)
    : [targetPredModes[mode]?.key ?? targetPredModes.normal.key];
  const values = targetState.rows
    .flatMap((row) => keys.map((key) => targetGetNumericValue(row[key])))
    .filter((value) => value !== null);
  const observedValues = observations.map((observation) => observation.pred).filter(Number.isFinite);
  const fallbackValues = values.length > 0 ? values : observedValues;
  return {
    min: fallbackValues.length > 0 ? Math.min(...fallbackValues) : 0,
    max: fallbackValues.length > 0 ? Math.max(...fallbackValues) : 0,
  };
}
function targetFitBaseModel(observations, mode = "normal") {
  const observedChartCount = new Set(observations.map((observation) => String(observation.row?.chart_id ?? "").trim())).size;
  const clearObservations = observations.filter((observation) => observation.outcome === 1);
  const notClearObservations = observations.filter((observation) => observation.outcome === 0);
  if (observedChartCount < 5 || clearObservations.length === 0 || notClearObservations.length === 0) {
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
  const bounds = targetGetModelBounds(mode, observations);
  const range = bounds.max - bounds.min;
  const predAt60 = center + (Math.log(0.6 / 0.4) - intercept) / slope * scale;
  const predAt40 = center + (Math.log(0.4 / 0.6) - intercept) / slope * scale;
  const rangeValues = [predAt60, predAt40];
  const hasValidRange = rangeValues.every(Number.isFinite);
  const rangeWidth = hasValidRange ? Math.abs(predAt40 - predAt60) : Infinity;
  if (
    !Number.isFinite(intercept)
    || !Number.isFinite(slope)
    || fittedSlope >= 0
    || !Number.isFinite(threshold)
    || range <= 0
    || !hasValidRange
    || rangeWidth >= range
    || threshold <= bounds.min
    || threshold >= bounds.max
  ) {
    return null;
  }
  return { intercept, slope, center, scale };
}


function targetApplyCalculationClearRules(observations, modelsByMode = new Map()) {
  const highestClearPredByMode = new Map();
  observations.forEach((observation) => {
    if (observation.outcome !== 1) {
      return;
    }
    const modeKey = observation.mode ?? targetPredModes.normal.key;
    const highest = highestClearPredByMode.get(modeKey);
    if (!Number.isFinite(highest) || observation.pred > highest) {
      highestClearPredByMode.set(modeKey, observation.pred);
    }
  });

  return observations.map((observation) => {
    const modeKey = observation.mode ?? targetPredModes.normal.key;
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
      const probability = targetSigmoid(model.intercept + model.slope * normalizedPred);
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

function targetGetPredModeNameFromKey(modeKey) {
  const entry = Object.entries(targetPredModes)
    .find(([, definition]) => definition.key === modeKey);
  return entry?.[0] ?? "normal";
}

function targetFitPreliminaryModels(observations) {
  const grouped = new Map();
  observations.forEach((observation) => {
    const modeKey = observation.mode ?? targetPredModes.normal.key;
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
    const mode = targetGetPredModeNameFromKey(modeKey);
    const model = targetFitBaseModel(group, mode);
    if (model) {
      modelsByMode.set(modeKey, model);
    }
  });
  return modelsByMode;
}

function targetPreparePredObservations(mode = "normal") {
  const rawObservations = targetGetPredObservations(mode);
  const thresholdedObservations = targetApplyCalculationClearRules(rawObservations);
  const preliminaryModels = targetFitPreliminaryModels(thresholdedObservations);
  return targetApplyCalculationClearRules(rawObservations, preliminaryModels);
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

function targetGetAdjustedPred(row, mode = "normal") {
  const raw = targetGetPredValue(row, mode);
  if (mode !== "normal") {
    const vector = targetGetFeatureVector(row);
    return raw + vector.reduce((total, strength, index) => total + targetState.deltas[index] * strength, 0);
  }
  const stored = targetState.adjustedPredById.get(String(row.chart_id));
  return stored ?? raw;
}


function targetGetRecommendationModel(mode = "normal") {
  const modeModel = targetState.modelsByMode[mode] ?? null;
  return modeModel ?? targetState.model;
}

function targetGetRecommendationAppropriatePred(mode = "normal") {
  const model = targetGetRecommendationModel(mode);
  if (!model
    || !Number.isFinite(model.center)
    || !Number.isFinite(model.scale)
    || !Number.isFinite(model.intercept)
    || !Number.isFinite(model.slope)
    || model.slope === 0) {
    return null;
  }
  return model.center + (-model.intercept / model.slope) * model.scale;
}

function targetGetExpectedClearProbability(row, mode = "normal", adjustedPredOverride = null) {
  const model = targetGetRecommendationModel(mode);
  if (!model) {
    return null;
  }
  const adjustedPred = adjustedPredOverride ?? targetGetAdjustedPred(row, mode);
  const normalizedPred = (adjustedPred - model.center) / model.scale;
  return targetSigmoid(model.intercept + model.slope * normalizedPred);
}
function targetRecalculateModel() {
  const overallObservations = targetPreparePredObservations("overall");
  targetState.model = targetFitBaseModel(overallObservations, "overall");
  targetState.modelsByMode = Object.fromEntries(
    Object.keys(targetPredModes).map((mode) => [mode, targetFitBaseModel(targetPreparePredObservations(mode), mode)]),
  );
  targetState.deltas = targetFitFeatureDeltas(overallObservations, targetState.model);
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
function targetGetAvailability() {
  // Unlocking is based on saved registrations, not only rows still present in
  // the current chart data. Missing chart data is reported separately.
  const registeredRecords = [...targetState.records.entries()]
    .map(([chartId, record]) => ({
      chartId: String(chartId ?? "").trim(),
      status: String(record?.status ?? "").trim().toLowerCase(),
    }))
    .filter(({ status }) => targetClearStatuses.has(status) || targetNotClearStatuses.has(status));
  const chartCount = registeredRecords.length;
  const clearCount = registeredRecords.filter(({ status }) => targetClearStatuses.has(status)).length;
  const notClearCount = registeredRecords.filter(({ status }) => targetNotClearStatuses.has(status)).length;
  return {
    available: chartCount >= 10 && clearCount >= 3 && notClearCount >= 3,
    observationCount: chartCount,
    clearCount,
    notClearCount,
    clearShortage: Math.max(0, 3 - clearCount),
    notClearShortage: Math.max(0, 3 - notClearCount),
    totalShortage: Math.max(0, 10 - chartCount),
  };
}
function targetGetMissingSavedIds() {
  const missingIds = new Set();
  [...targetState.records.keys(), ...targetState.manualMemoIds].forEach((chartId) => {
    const normalizedChartId = String(chartId ?? "").trim();
    if (normalizedChartId && !targetState.rowsByChartId.has(normalizedChartId)) {
      missingIds.add(normalizedChartId);
    }
  });
  return missingIds;
}

function targetUpdateMissingDataMessage() {
  const message = targetElements.missingDataMessage;
  if (!message) return;
  const count = targetGetMissingSavedIds().size;
  message.hidden = count === 0;
  message.textContent = count === 0
    ? ""
     : "未登録データ " + count.toLocaleString() + "件が見つかりません。保存されたクリアランプ・手動メモは保持されていますが、現在の譜面データがないため、表・Pred判定・リコメンドの対象外です。";
}

function targetCanShowContent() {
  return targetGetAvailability().available;
}

function targetTrackUnlockEvent(availability) {
  if (typeof window.cpiAnalytics?.track !== "function") {
    return;
  }
  try {
    if (window.localStorage.getItem(targetUnlockEventStorageKey) === "1") {
      return;
    }
    window.localStorage.setItem(targetUnlockEventStorageKey, "1");
  } catch (error) {
    return;
  }
  window.cpiAnalytics.track("target_unlocked", {
    observation_count: availability.observationCount,
    clear_count: availability.clearCount,
    not_clear_count: availability.notClearCount,
  });
}

function targetTrackStateEvent() {
  if (targetState.analyticsStateTracked || typeof window.cpiAnalytics?.track !== "function") {
    return;
  }
  const availability = targetGetAvailability();
  window.cpiAnalytics.track("target_state", {
    state: availability.available ? "ready" : "locked",
    registered_count: availability.observationCount,
    clear_count: availability.clearCount,
    not_clear_count: availability.notClearCount,
  });
  targetState.analyticsStateTracked = true;
}
function targetUpdateAvailability() {
  const availability = targetGetAvailability();
  targetUpdateMissingDataMessage();
  const available = availability.available;
  const dailyRoute = window.location.hash === "#daily";
  if (!available) {
     targetElements.insufficientMessageText.textContent = "あとクリア" + availability.clearShortage.toLocaleString() + "件、未クリア" + availability.notClearShortage.toLocaleString() + "件、合計" + availability.totalShortage.toLocaleString() + "件登録で、マイターゲットが利用可能になります。";
  }
  targetElements.content.hidden = !(available || dailyRoute);
  targetElements.insufficientMessage.hidden = available || dailyRoute;
  if (available && !targetState.targetWasAvailable) {
    targetTrackUnlockEvent(availability);
  }
  targetState.targetWasAvailable = available;
}

function targetEnsureDatabaseStores(database) {
  if (!database.objectStoreNames.contains(targetStoreName)) {
    database.createObjectStore(targetStoreName, { keyPath: "chartId" });
  }
  if (!database.objectStoreNames.contains(targetManualMemoStoreName)) {
    database.createObjectStore(targetManualMemoStoreName, { keyPath: "chartId" });
  }
  if (!database.objectStoreNames.contains(targetDailyTargetsStoreName)) {
    database.createObjectStore(targetDailyTargetsStoreName, { keyPath: "date" });
  }
}

function targetDatabaseHasRequiredStores(database) {
  return [
    targetStoreName,
    targetManualMemoStoreName,
    targetDailyTargetsStoreName,
  ].every((storeName) => database.objectStoreNames.contains(storeName));
}

function targetOpenDatabase() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("ローカル保存を開けませんでした。"));
      return;
    }

    const rejectRequest = (request, fallbackMessage) => {
      reject(request.error ?? new Error(fallbackMessage));
    };

    const openAtCurrentVersion = () => {
      const request = window.indexedDB.open(targetDatabaseName);
      request.onupgradeneeded = () => {
        targetEnsureDatabaseStores(request.result);
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => database.close();
        if (targetDatabaseHasRequiredStores(database)) {
          resolve(database);
          return;
        }

        const nextVersion = Math.max(database.version + 1, targetDatabaseVersion);
        database.close();
        const upgradeRequest = window.indexedDB.open(targetDatabaseName, nextVersion);
        upgradeRequest.onupgradeneeded = () => {
          targetEnsureDatabaseStores(upgradeRequest.result);
        };
        upgradeRequest.onsuccess = () => {
          const upgradedDatabase = upgradeRequest.result;
          upgradedDatabase.onversionchange = () => upgradedDatabase.close();
          resolve(upgradedDatabase);
        };
        upgradeRequest.onerror = () => rejectRequest(upgradeRequest, "ローカル保存を開けませんでした。");
        upgradeRequest.onblocked = () => reject(new Error("ローカル保存が別の画面で使用中です。"));
      };
      request.onerror = () => rejectRequest(request, "ローカル保存を開けませんでした。");
      request.onblocked = () => reject(new Error("ローカル保存が別の画面で使用中です。"));
    };

    openAtCurrentVersion();
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
    const chartId = String(record?.chartId ?? record?.chart_id ?? "").trim();
    const status = String(record?.status ?? record?.clearType ?? "").trim().toLowerCase();
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
      .filter((chartId) => /^\d+$/.test(chartId)),
  );
}

async function targetRefreshFromExternalDataChange(event) {
  if (event.detail?.source !== "daily-target" || !targetState.db) return;
  try {
    targetApplyRecords(await targetReadAllRecords());
    targetApplyManualMemos(await targetReadAllManualMemos());
    targetRecalculateModel();
    targetUpdateAvailability();
    targetState.autoRecommendationsInitialized = false;
    targetRender();
  } catch (error) {
    console.warn("外部画面のデータ更新を反映できませんでした。", error);
  }
}

window.addEventListener("cpi:status-changed", targetRefreshFromExternalDataChange);
window.addEventListener("cpi:manual-memo-changed", targetRefreshFromExternalDataChange);
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
    transaction.oncomplete = () => {
      resolve();
      window.dispatchEvent(new CustomEvent("cpi:manual-memo-changed", {
        detail: { source: "target", chartId, registered },
      }));
    };
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
    transaction.oncomplete = () => {
      resolve();
      window.dispatchEvent(new CustomEvent("cpi:status-changed", {
        detail: { source: "target", chartId, status },
      }));
    };
    transaction.onerror = () => reject(
       transaction.error ?? new Error("記録を保存できませんでした。"),
    );
  });
}

async function targetHandleStatusChange(event) {
  const select = event.target.closest?.(".target-status-select");
  if (!select || select.classList.contains("target-goal-select") || !targetStatusValues.has(select.value)) {
    return;
  }

  const chartId = String(select.dataset.chartId ?? "").trim();
  const row = targetState.rowsByChartId.get(chartId);
  if (!row) {
    return;
  }
  const previousStatus = targetGetStatus(row);
  const previousGoal = targetState.goalById.get(chartId);
  const status = select.value;
  select.disabled = true;
  try {
    await targetWriteStatus(chartId, status);
    if (status === "unregistered") {
      targetState.records.delete(chartId);
      targetState.goalById.delete(chartId);
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
    window.cpiStatusToast?.show({
      onUndo: async () => {
        await targetWriteStatus(chartId, previousStatus);
        if (previousStatus === "unregistered") {
          targetState.records.delete(chartId);
        } else {
          targetState.records.set(chartId, {
            chartId,
            status: previousStatus,
            updatedAt: new Date().toISOString(),
          });
        }
        if (previousGoal === undefined) {
          targetState.goalById.delete(chartId);
        } else {
          targetState.goalById.set(chartId, previousGoal);
        }
        targetRecalculateModel();
        targetUpdateAvailability();
        targetState.visibleLimit = targetPageSize;
        targetRender();
        targetShowError("");
      },
    });
  } catch (error) {
    select.value = previousStatus;
    targetUpdateStatusSelect(select);
     targetShowError(error.message || "データを保存できませんでした。");
  } finally {
    select.disabled = false;
  }
}


function targetHandleGoalChange(event) {
  const select = event.target.closest?.(".target-goal-select");
  if (!select) {
    return;
  }
  const chartId = String(select.dataset.targetGoalChartId ?? "").trim();
  const row = targetState.rowsByChartId.get(chartId);
  if (!row) {
    return;
  }
  const allowed = targetGetGoalOptions(targetGetStatus(row)).some(({ value }) => value === select.value);
  if (!allowed) {
    targetRender();
    return;
  }
  targetState.goalById.set(chartId, select.value);
  targetRender();
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
     targetShowError(error.message || "データを保存できませんでした。");
  } finally {
    checkbox.disabled = false;
  }
}

function targetInitializeElements() {
  targetElements.autoNotice = document.getElementById("targetAutoNotice");
  targetElements.autoNoticeClose = document.getElementById("targetAutoNoticeClose");
  targetElements.autoNoticeSettings = document.getElementById("targetAutoNoticeSettings");
  targetElements.autoSettingsButton = document.getElementById("targetAutoSettingsButton");
  targetElements.autoSettingsOverlay = document.getElementById("targetAutoSettingsOverlay");
  targetElements.autoSettingsPanel = document.getElementById("targetAutoSettingsPanel");
  targetElements.autoSettingsClose = document.getElementById("targetAutoSettingsCloseButton");
  targetElements.autoSettingsMessage = document.getElementById("targetAutoSettingsMessage");
  // Keep the fixed modal outside the filtered page panel so it is positioned against the viewport.
  if (targetElements.autoSettingsOverlay && targetElements.autoSettingsOverlay.parentElement !== document.body) {
    document.body.appendChild(targetElements.autoSettingsOverlay);
  }
  targetElements.recommendationDifficultyOptions = document.getElementById("targetRecommendationDifficultyOptions");
  targetElements.recommendationDifficultySummary = document.getElementById("targetRecommendationDifficultySummary");
  targetElements.recommendationFeatureReasonOptions = document.getElementById("targetRecommendationFeatureReasonOptions");
  targetElements.recommendationFeatureReasonSummary = document.getElementById("targetRecommendationFeatureReasonSummary");
  targetElements.recommendationFeatureOptions = document.getElementById("targetRecommendationFeatureOptions");
  targetElements.recommendationGoalOptions = document.getElementById("targetRecommendationGoalOptions");
  targetElements.recommendationFeatureSummary = document.getElementById("targetRecommendationFeatureSummary");
  targetElements.recommendationCount = document.getElementById("targetRecommendationCount");
  targetElements.recommendationSave = document.getElementById("targetRecommendationSaveButton");
  targetElements.recommendationReset = document.getElementById("targetRecommendationResetButton");
  targetElements.autoEmpty = document.getElementById("targetAutoEmpty");
  targetElements.autoRowCount = document.getElementById("targetAutoRowCount");
  targetElements.autoRegenerate = document.getElementById("targetAutoRegenerateButton");
  targetElements.autoCards = document.getElementById("targetAutoCards");




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
  targetElements.insufficientMessageText = document.getElementById("targetInsufficientMessageText");
  targetElements.missingDataMessage = document.getElementById("targetMissingDataMessage");
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
  if (targetElements.autoNoticeClose) {
    targetElements.autoNoticeClose.addEventListener("click", targetDismissAutoRecommendationNotice);
  }
  if (targetElements.autoNoticeSettings) {
    targetElements.autoNoticeSettings.addEventListener("click", (event) => {
      event.preventDefault();
      targetOpenRecommendationSettings();
    });
  }
  if (targetElements.autoSettingsOverlay) {
    document.addEventListener("click", (event) => {
      const settingsButton = event.target.closest?.("#targetAutoSettingsButton");
      if (!settingsButton) {
        return;
      }
      targetElements.autoSettingsButton = settingsButton;
      if (targetElements.autoSettingsOverlay.hidden) {
        targetOpenRecommendationSettings();
      } else {
        targetCloseRecommendationSettings();
      }
    });
  }
  if (targetElements.autoSettingsClose) {
    targetElements.autoSettingsClose.addEventListener("click", targetCloseRecommendationSettings);
  }
  if (targetElements.autoNoticeSettings) {
    targetElements.autoNoticeSettings.addEventListener("click", (event) => {
      event.preventDefault();
      targetOpenRecommendationSettings();
    });
  }
  if (targetElements.autoSettingsOverlay) {
    targetElements.autoSettingsOverlay.addEventListener("click", (event) => {
      if (event.target === targetElements.autoSettingsOverlay) {
        targetCloseRecommendationSettings();
      }
    });
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && targetElements.autoSettingsOverlay && !targetElements.autoSettingsOverlay.hidden) {
      targetCloseRecommendationSettings();
    }
  });
  if (targetElements.recommendationSave) {
    targetElements.recommendationSave.addEventListener("click", targetSaveRecommendationSettings);
  }
  if (targetElements.recommendationReset) {
    targetElements.recommendationReset.addEventListener("click", targetResetRecommendationSettings);
  }


  if (targetElements.recommendationCount) {
    targetElements.recommendationCount.addEventListener("change", targetCommitRecommendationCount);
  }
  targetElements.autoRegenerate.addEventListener("click", () => {
    targetGenerateAutoRecommendations();
    targetRender();
    targetElements.autoCards?.scrollIntoView({ behavior: "smooth", block: "start" });
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
  if (targetElements.autoCards) {

    targetElements.autoCards.addEventListener("change", targetHandleStatusChange);
  }
  targetElements.tableBody.addEventListener("change", targetHandleGoalChange);
  targetElements.manualTableBody.addEventListener("change", targetHandleGoalChange);
  targetElements.tableBody.addEventListener("change", targetHandleStatusChange);
  targetElements.tableBody.addEventListener("change", targetHandleManualMemoChange);
  targetElements.manualTableBody.addEventListener("change", targetHandleStatusChange);
  targetElements.manualTableBody.addEventListener("change", targetHandleManualMemoChange);
  targetElements.loadMore.addEventListener("click", () => {
    targetState.visibleLimit += targetPageSize;
    targetRender();
  });
  if (targetElements.scrollTop) {
    targetElements.scrollTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
    window.addEventListener("scroll", () => {
      targetElements.scrollTop.hidden = window.scrollY < 360;
    }, { passive: true });
  }
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
  if (targetElements.autoNotice) {
    targetElements.autoNotice.hidden = targetReadAutoRecommendationNoticeDismissed();
  }
  targetState.recommendationSettings = targetReadRecommendationSettings();
  targetRecommendationDraft = targetCloneRecommendationSettings(targetState.recommendationSettings);
  targetRenderRecommendationSettings();
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
    targetRenderRecommendationSettings();
    targetBindEvents();
    targetRecalculateModel();
    targetUpdateAvailability();
    targetRender();
  } catch (error) {
     targetShowError(error instanceof Error ? error.message : "データを読み込めませんでした。");
    return;
  }

  let storageError = null;
  try {
    targetState.db = await targetOpenDatabase();
    window.dispatchEvent(new Event("cpi:target-storage-ready"));
    try {
      targetApplyRecords(await targetReadAllRecords());
    } catch (error) {
      storageError = error;
      targetState.records = new Map();
    }
    try {
      targetApplyManualMemos(await targetReadAllManualMemos());
    } catch (error) {
      storageError = storageError ?? error;
      targetState.manualMemoIds = new Set();
    }
  } catch (error) {
    storageError = error;
    targetState.records = new Map();
    targetState.manualMemoIds = new Set();
  }

  try {
    targetRecalculateModel();
    targetUpdateAvailability();
    targetRender();
    targetTrackStateEvent();
  } catch (error) {
    console.error("マイターゲットの表示更新に失敗しました。", error, storageError);
    targetShowError(error instanceof Error ? error.message : "マイターゲットを表示できませんでした。");
  }
}

window.addEventListener("cpi:target-mode-changed", targetUpdateAvailability);

document.addEventListener("DOMContentLoaded", targetInitialize);




