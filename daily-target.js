"use strict";

const dailyDatabaseName = "cpi-next-clear-status";
const dailyDatabaseVersion = 3;
const dailyStatusStoreName = "chart-statuses";
const dailyTargetsStoreName = "daily-targets";
const dailyPageSize = 100;
const dailyFeatureNone = "特徴なし";
const dailyFeatureNames = ["BPM変化", "チャージノート", "ラスト難", "皿複合", "単鍵ラッシュ", "同時押し", "物量", "連皿", "連打"];
const dailyNotClearStatuses = new Set(["failed", "assisted", "easy"]);
const dailyClearStatuses = new Set(["clear", "hard"]);
const dailyPredModes = {
  easy: { key: "easyPred", label: "イージーPred" },
  normal: { key: "pred", label: "ノマゲPred" },
  hard: { key: "hardPred", label: "ハードPred" },
};

function dailyGetPredValue(row, mode = "normal") {
  return row[dailyPredModes[mode]?.key ?? dailyPredModes.normal.key] ?? row.pred;
}

function dailyGetPredModeForGoal(goal) {
  if (goal === "easy") return "easy";
  if (goal === "hard") return "hard";
  return "normal";
}
const dailyFeatureDeltaLambda = 10;
const dailyFeatureDeltaIterations = 50;
const dailyFeatureDeltaTolerance = 0.00001;
const dailyDifficultyOrder = ["N", "H", "A", "L"];
const dailyDifficultyLabels = {
  N: "[N] NORMAL",
  H: "[H] HYPER",
  A: "[A] ANOTHER",
  L: "[L] LEGGENDARIA",
};
const dailyDifficultyClasses = {
  N: "difficulty--normal",
  H: "difficulty--hyper",
  A: "difficulty--another",
  L: "difficulty--leggendaria",
};
const dailyStatuses = [
  { value: "unregistered", label: "未登録" },
  { value: "unowned", label: "未所持・未解禁" },
  { value: "no-play", label: "NO PLAY" },
  { value: "failed", label: "FAILED" },
  { value: "assisted", label: "ASSISTED" },
  { value: "easy", label: "EASY" },
  { value: "clear", label: "CLEAR" },
  { value: "hard", label: "HARD以上" },
];
const dailyStatusValues = new Set(dailyStatuses.map(({ value }) => value));
const dailyStatusRank = {
  unregistered: 0,
  unowned: 0,
  "no-play": 0,
  failed: 1,
  assisted: 1,
  easy: 2,
  clear: 3,
  hard: 4,
};
const dailyGoalStatuses = [
  { value: "easy", label: "EASY" },
  { value: "clear", label: "CLEAR" },
  { value: "hard", label: "HARD以上" },
];
const dailyRecommendationSettingsKey = "cpi-next-target-recommendation-statuses";
const dailyRecommendationLevelValues = [8, 9, 10, 11, 12];
const dailyDefaultRecommendationSettings = {
  probabilityMin: 40,
  probabilityMax: 60,
  levels: [...dailyRecommendationLevelValues],
  statuses: ["unregistered", "no-play", "failed", "assisted", "easy"],
  targetGoals: dailyGoalStatuses.map(({ value }) => value),
};
const dailyEntityDecoder = document.createElement("textarea");

const dailyState = {
  rows: [], rowsById: new Map(), records: new Map(), manualMemoIds: new Set(), today: null, completionNoticeShownDate: "", selected: new Map(), manualGoalById: new Map(), query: "",
  recommendationSettings: null,
  statusFilter: new Set(dailyStatuses.filter(({ value }) => !["unowned", "hard"].includes(value)).map(({ value }) => value)),
  levelFilter: new Set(), difficultyFilter: new Set(), featureFilter: new Map(), visibleLimit: dailyPageSize,
  bpmMinFilter: 0, bpmMaxFilter: 999, predMinFilter: 0, predMaxFilter: 999, predDataMin: 0, predDataMax: 999,
  adjustedPredMinFilter: 0, adjustedPredMaxFilter: 999, adjustedPredDataMin: 0, adjustedPredDataMax: 999,
  model: null, deltas: new Array(dailyFeatureNames.length).fill(0), adjustedPredById: new Map(), database: null, ready: false, refreshPromise: null,
};

const dailyElements = {};

function dailyEscapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function dailyDecodeHtmlEntities(value) {
  dailyEntityDecoder.innerHTML = String(value ?? "");
  return dailyEntityDecoder.value || dailyEntityDecoder.textContent || "";
}

function dailyNormalizeTitle(value) {
  return dailyDecodeHtmlEntities(String(value ?? "").replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

function dailyNormalizeDifficulty(value) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "NORMAL" || normalized === "N") return "N";
  if (normalized === "HYPER" || normalized === "H") return "H";
  if (normalized === "ANOTHER" || normalized === "A") return "A";
  if (normalized === "LEGGENDARIA" || normalized === "L") return "L";
  return normalized;
}

function dailyParseCsv(text) {
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
      if (character === "\r" && nextCharacter === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    if (row.some((value) => value !== "")) rows.push(row);
  }
  if (rows.length === 0) return [];
  const headers = rows[0].map((header) => String(header).trim());
  return rows.slice(1).map((values, index) => {
    const parsed = { __order: index };
    headers.forEach((header, headerIndex) => {
      parsed[header] = values[headerIndex] ?? "";
    });
    return parsed;
  });
}

function dailyGetNumber(value) {
  const number = Number.parseFloat(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(number) ? number : null;
}

function dailyNormalizeRows(parsedRows) {
  return parsedRows.map((source, index) => {
    const chartId = String(source.chart_id ?? "").trim();
    const title = dailyNormalizeTitle(source.title);
    const difficulty = dailyNormalizeDifficulty(source.difficulty);
    const level = dailyGetNumber(source.original_level);
    const easyPred = dailyGetNumber(source.easy_pred_skill);
    const pred = dailyGetNumber(source.calibrated_pred_skill);
    const hardPred = dailyGetNumber(source.hard_pred_skill);
    if (!/^\d+$/.test(chartId) || !title || level === null || pred === null) return null;
    const features = dailyDecodeHtmlEntities(String(source.features ?? "").replace(/<[^>]*>/g, "")).trim();
    return {
      chartId,
      title,
      difficulty,
      level,
      easyPred,
      pred,
      hardPred,
      bpmMin: dailyGetNumber(source.bpm_min),
      bpmMax: dailyGetNumber(source.bpm_max),
      features,
      order: Number.isFinite(source.__order) ? source.__order : index,
      search: (title + " " + difficulty).toLocaleLowerCase("ja"),
    };
  }).filter(Boolean);
}

function dailyGetRawFeatures(row) {
  const features = String(row.features ?? "")
    .split("、")
    .map((feature) => feature.trim())
    .filter(Boolean);
  return features.length > 0 ? features : [dailyFeatureNone];
}

function dailyRenderFeatureChips(row) {
  return '<div class="feature-chips">' + dailyGetRawFeatures(row).map((feature) => {
    const plusMatch = feature.match(/\++$/);
    const plusCount = plusMatch ? plusMatch[0].length : 0;
    const name = feature.replace(/\++$/, "").trim();
    const className = name === dailyFeatureNone
      ? "feature-chip feature-chip--none"
      : "feature-chip feature-chip--plus-" + Math.min(3, plusCount);
    return '<span class="' + className + '">' + dailyEscapeHtml(feature) + "</span>";
  }).join("") + "</div>";
}


function dailyGetFeatureDetails(row) {
  const rawFeatures = dailyGetRawFeatures(row);
  if (rawFeatures.length === 0 || (rawFeatures.length === 1 && rawFeatures[0] === dailyFeatureNone)) return [];
  return rawFeatures.map((feature) => {
    const plusMatch = feature.match(/\++$/);
    const plusCount = plusMatch ? plusMatch[0].length : 0;
    const name = feature.replace(/\++$/, "").trim();
    return name ? { name, plusCount } : null;
  }).filter(Boolean);
}

function dailyGetRowFeatures(row) {
  const names = dailyGetFeatureDetails(row).map((feature) => feature.name);
  return names.length > 0 ? names : [dailyFeatureNone];
}

function dailyGetFeatureOptions() {
  const available = new Set([dailyFeatureNone]);
  dailyState.rows.forEach((row) => dailyGetFeatureDetails(row).forEach((feature) => available.add(feature.name)));
  return [
    dailyFeatureNone,
    ...dailyFeatureNames.filter((feature) => available.has(feature)),
    ...Array.from(available).filter((feature) => feature !== dailyFeatureNone && !dailyFeatureNames.includes(feature)),
  ];
}

function dailyGetDifficultyOptions() {
  const available = new Set(dailyState.rows.map((row) => row.difficulty));
  return dailyDifficultyOrder.filter((difficulty) => available.has(difficulty));
}

function dailyGetLevelOptions() {
  return Array.from(new Set(dailyState.rows.map((row) => row.level))).sort((left, right) => left - right);
}

function dailyBuildCheckbox(id, label, checked, className, dataAttributes) {
  const attributes = Object.entries(dataAttributes ?? {})
    .map(([key, value]) => 'data-' + key + '="' + dailyEscapeHtml(value) + '"')
    .join(" ");
  return '<label class="multi-filter__option ' + (className ?? "") + '"><input id="' + id + '" type="checkbox" ' + (checked ? "checked" : "") + " " + attributes + '><span>' + dailyEscapeHtml(label) + "</span></label>";
}

function dailyUpdateMultiFilterSummary(summary, selectedValues, values, formatLabel) {
  if (!summary) return;
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
  const labels = values.filter((value) => selectedValues.has(value)).map(formatLabel);
  summary.textContent = labels.length === 1 ? labels[0] : labels.length + " selected";
  summary.title = labels.join(", ");
}

function dailyFillMultiFilterOptions(container, values, stateKey, formatLabel, summary) {
  const selectedValues = dailyState[stateKey];
  container.innerHTML = [
    dailyBuildCheckbox("daily-" + stateKey + "-all", "all", selectedValues.size === values.length, "multi-filter__all", { filter: "all" }),
    ...values.map((value, index) => dailyBuildCheckbox(
      "daily-" + stateKey + "-" + index,
      formatLabel(value),
      selectedValues.has(value),
      "",
      { filter: "value", value },
    )),
  ].join("");
  container.querySelectorAll('input[data-filter="value"]').forEach((input) => {
    input.addEventListener("change", () => {
      const value = typeof values[0] === "number" ? Number(input.dataset.value) : input.dataset.value;
      if (input.checked) selectedValues.add(value);
      else selectedValues.delete(value);
      const allInput = container.querySelector('input[data-filter="all"]');
      if (allInput) allInput.checked = selectedValues.size === values.length;
      dailyUpdateMultiFilterSummary(summary, selectedValues, values, formatLabel);
      dailyState.visibleLimit = dailyPageSize;
      dailyRenderCandidateTable();
    });
  });
  const allInput = container.querySelector('input[data-filter="all"]');
  if (allInput) {
    allInput.addEventListener("change", () => {
      selectedValues.clear();
      if (allInput.checked) values.forEach((value) => selectedValues.add(value));
      container.querySelectorAll('input[data-filter="value"]').forEach((input) => {
        input.checked = allInput.checked;
      });
      dailyUpdateMultiFilterSummary(summary, selectedValues, values, formatLabel);
      dailyState.visibleLimit = dailyPageSize;
      dailyRenderCandidateTable();
    });
  }
  dailyUpdateMultiFilterSummary(summary, selectedValues, values, formatLabel);
}

function dailyFillFeatureFilterOptions(container) {
  const values = dailyGetFeatureOptions();
  dailyState.featureFilter = new Map(values.map((feature) => [feature, { include: true, exclude: true }]));
  container.innerHTML = [
    '<label class="multi-filter__option multi-filter__option--all"><input type="checkbox" data-feature-all checked><span>all</span></label>',
    ...values.map((feature, index) => '<div class="multi-filter__option feature-filter__option"><span class="feature-filter__name">' + dailyEscapeHtml(feature) + '</span><label class="feature-filter__mode"><input type="checkbox" data-feature-index="' + index + '" data-feature-mode="include" checked><span>を含む</span></label><label class="feature-filter__mode"><input type="checkbox" data-feature-index="' + index + '" data-feature-mode="exclude" checked><span>を含まない</span></label></div>'),
  ].join("");
  const updateFeatureMode = (input) => {
    const feature = values[Number(input.dataset.featureIndex)];
    const setting = dailyState.featureFilter.get(feature);
    if (!setting) return;
    setting[input.dataset.featureMode] = input.checked;
    const allInput = container.querySelector("input[data-feature-all]");
    if (allInput) allInput.checked = dailyAreAllFeatureModesSelected(values);
    dailyUpdateFeatureFilterSummary(dailyElements.featureSummary, values);
    dailyState.visibleLimit = dailyPageSize;
    dailyRenderCandidateTable();
  };
  container.querySelectorAll("input[data-feature-index]").forEach((input) => {
    input.addEventListener("change", () => updateFeatureMode(input));
  });
  const allInput = container.querySelector("input[data-feature-all]");
  if (allInput) {
    allInput.addEventListener("change", () => {
      values.forEach((feature) => {
        const setting = dailyState.featureFilter.get(feature);
        if (setting) {
          setting.include = allInput.checked;
          setting.exclude = allInput.checked;
        }
      });
      container.querySelectorAll("input[data-feature-mode]").forEach((input) => {
        input.checked = allInput.checked;
      });
      dailyUpdateFeatureFilterSummary(dailyElements.featureSummary, values);
      dailyState.visibleLimit = dailyPageSize;
      dailyRenderCandidateTable();
    });
  }
  dailyUpdateFeatureFilterSummary(dailyElements.featureSummary, values);
}

function dailyAreAllFeatureModesSelected(values) {
  return values.every((feature) => {
    const setting = dailyState.featureFilter.get(feature);
    return setting?.include === true && setting?.exclude === true;
  });
}

function dailyUpdateFeatureFilterSummary(summary, values) {
  if (!summary) return;
  if (values.every((feature) => {
    const setting = dailyState.featureFilter.get(feature);
    return !setting || setting.include === setting.exclude;
  })) {
    summary.textContent = "all";
    summary.title = "";
    return;
  }
  const selectedModes = values.map((feature) => {
    const setting = dailyState.featureFilter.get(feature);
    if (!setting || setting.include === setting.exclude) return "";
    return feature + ":" + (setting.include ? "含む" : "含まない");
  }).filter(Boolean);
  summary.textContent = selectedModes.join(", ");
  summary.title = summary.textContent;
}

function dailyFeatureFilterMatches(row) {
  if (dailyState.featureFilter.size === 0) return true;
  const rowFeatures = new Set(dailyGetRowFeatures(row));
  return Array.from(dailyState.featureFilter.entries()).every(([feature, setting]) => {
    if (setting.include === setting.exclude) return true;
    return setting.include ? rowFeatures.has(feature) : !rowFeatures.has(feature);
  });
}

function dailyClampNumber(value, fallback, minimum, maximum) {
  const numeric = dailyGetNumber(value);
  if (numeric === null) return fallback;
  return Math.min(maximum, Math.max(minimum, numeric));
}

function dailyUpdateAdvancedSummary() {
  const isDefault = dailyState.bpmMinFilter === 0
    && dailyState.bpmMaxFilter === 999
    && dailyState.predMinFilter === dailyState.predDataMin
    && dailyState.predMaxFilter === dailyState.predDataMax
    && dailyState.adjustedPredMinFilter === dailyState.adjustedPredDataMin
    && dailyState.adjustedPredMaxFilter === dailyState.adjustedPredDataMax;
  dailyElements.advancedSummary.textContent = isDefault
    ? "詳細絞り込み"
    : "BPM:" + dailyState.bpmMinFilter + "~" + dailyState.bpmMaxFilter
      + " / Pred:" + dailyFormatPred(dailyState.predMinFilter) + "~" + dailyFormatPred(dailyState.predMaxFilter)
      + " / 目標補正Pred:" + dailyFormatPred(dailyState.adjustedPredMinFilter) + "~" + dailyFormatPred(dailyState.adjustedPredMaxFilter);
}

function dailyCommitBpmFilters() {
  dailyState.bpmMinFilter = dailyClampNumber(dailyElements.bpmMinInput.value, 0, 0, 999);
  dailyState.bpmMaxFilter = dailyClampNumber(dailyElements.bpmMaxInput.value, 999, 0, 999);
  dailyElements.bpmMinInput.value = String(dailyState.bpmMinFilter);
  dailyElements.bpmMaxInput.value = String(dailyState.bpmMaxFilter);
  dailyState.visibleLimit = dailyPageSize;
  dailyUpdateAdvancedSummary();
  dailyRenderCandidateTable();
}

function dailyUpdateBpmFilters() {
  dailyState.bpmMinFilter = dailyClampNumber(dailyElements.bpmMinInput.value, 0, 0, 999);
  dailyState.bpmMaxFilter = dailyClampNumber(dailyElements.bpmMaxInput.value, 999, 0, 999);
  dailyState.visibleLimit = dailyPageSize;
  dailyUpdateAdvancedSummary();
  dailyRenderCandidateTable();
}

function dailyCommitPredFilters() {
  dailyState.predMinFilter = dailyClampNumber(dailyElements.predMinInput.value, dailyState.predDataMin, dailyState.predDataMin, dailyState.predDataMax);
  dailyState.predMaxFilter = dailyClampNumber(dailyElements.predMaxInput.value, dailyState.predDataMax, dailyState.predDataMin, dailyState.predDataMax);
  dailyElements.predMinInput.value = dailyFormatPred(dailyState.predMinFilter);
  dailyElements.predMaxInput.value = dailyFormatPred(dailyState.predMaxFilter);
  dailyState.visibleLimit = dailyPageSize;
  dailyUpdateAdvancedSummary();
  dailyRenderCandidateTable();
}

function dailyUpdatePredFilters() {
  dailyState.predMinFilter = dailyClampNumber(dailyElements.predMinInput.value, dailyState.predDataMin, dailyState.predDataMin, dailyState.predDataMax);
  dailyState.predMaxFilter = dailyClampNumber(dailyElements.predMaxInput.value, dailyState.predDataMax, dailyState.predDataMin, dailyState.predDataMax);
  dailyState.visibleLimit = dailyPageSize;
  dailyUpdateAdvancedSummary();
  dailyRenderCandidateTable();
}

function dailyCommitAdjustedPredFilters() {
  dailyState.adjustedPredMinFilter = dailyClampNumber(dailyElements.adjustedPredMinInput.value, dailyState.adjustedPredDataMin, dailyState.adjustedPredDataMin, dailyState.adjustedPredDataMax);
  dailyState.adjustedPredMaxFilter = dailyClampNumber(dailyElements.adjustedPredMaxInput.value, dailyState.adjustedPredDataMax, dailyState.adjustedPredDataMin, dailyState.adjustedPredDataMax);
  dailyElements.adjustedPredMinInput.value = dailyFormatPred(dailyState.adjustedPredMinFilter);
  dailyElements.adjustedPredMaxInput.value = dailyFormatPred(dailyState.adjustedPredMaxFilter);
  dailyState.visibleLimit = dailyPageSize;
  dailyUpdateAdvancedSummary();
  dailyRenderCandidateTable();
}

function dailyUpdateAdjustedPredFilters() {
  dailyState.adjustedPredMinFilter = dailyClampNumber(dailyElements.adjustedPredMinInput.value, dailyState.adjustedPredDataMin, dailyState.adjustedPredDataMin, dailyState.adjustedPredDataMax);
  dailyState.adjustedPredMaxFilter = dailyClampNumber(dailyElements.adjustedPredMaxInput.value, dailyState.adjustedPredDataMax, dailyState.adjustedPredDataMin, dailyState.adjustedPredDataMax);
  dailyState.visibleLimit = dailyPageSize;
  dailyUpdateAdvancedSummary();
  dailyRenderCandidateTable();
}

function dailyFormatPred(value) {
  return Number.isFinite(value) ? value.toFixed(1) : "-";
}

function dailyGetNumericColor(value) {
  const numeric = Number(value);
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

function dailyGetStatus(chartId) {
  const status = String(dailyState.records.get(String(chartId))?.status ?? "").toLowerCase();
  return dailyStatusValues.has(status) ? status : "unregistered";
}

function dailyGetStatusLabel(status) {
  return dailyStatuses.find((item) => item.value === status)?.label ?? status;
}

function dailyGetStatusRank(status) {
  return dailyStatusRank[status] ?? 0;
}

function dailyGetGoalOptions(status) {
  const rank = dailyGetStatusRank(status);
  const targetGoals = dailyState.recommendationSettings?.targetGoals
    ?? dailyGetDefaultRecommendationSettings().targetGoals;
  return dailyGoalStatuses.filter((goal) => (
    dailyGetStatusRank(goal.value) > rank && targetGoals.includes(goal.value)
  ));
}

function dailyGetManualGoalOptions(status) {
  const rank = dailyGetStatusRank(status);
  return dailyGoalStatuses.filter((goal) => dailyGetStatusRank(goal.value) > rank);
}

function dailyGetDefaultManualGoal(status) {
  return dailyGetManualGoalOptions(status)[0]?.value ?? null;
}
function dailyGetDefaultGoal(status) {
  return dailyGetGoalOptions(status)[0]?.value ?? null;
}

function dailyGetDefaultRecommendationSettings() {
  return {
    probabilityMin: dailyDefaultRecommendationSettings.probabilityMin,
    probabilityMax: dailyDefaultRecommendationSettings.probabilityMax,
    levels: [...dailyDefaultRecommendationSettings.levels],
    statuses: [...dailyDefaultRecommendationSettings.statuses],
    targetGoals: [...dailyDefaultRecommendationSettings.targetGoals],
  };
}

function dailyNormalizeRecommendationProbability(value, fallback) {
  const numeric = Number(value);
  return Number.isInteger(numeric) ? Math.min(100, Math.max(0, numeric)) : fallback;
}

function dailyReadRecommendationSettings() {
  const fallback = dailyGetDefaultRecommendationSettings();
  try {
    const parsed = JSON.parse(window.localStorage?.getItem(dailyRecommendationSettingsKey) ?? "null");
    if (Array.isArray(parsed)) {
      return { ...fallback, statuses: [...new Set(parsed.filter((value) => dailyStatusValues.has(value)))] };
    }
    if (!parsed || typeof parsed !== "object") return fallback;
    let probabilityMin = dailyNormalizeRecommendationProbability(parsed.probabilityMin, fallback.probabilityMin);
    let probabilityMax = dailyNormalizeRecommendationProbability(parsed.probabilityMax, fallback.probabilityMax);
    if (probabilityMin > probabilityMax) [probabilityMin, probabilityMax] = [probabilityMax, probabilityMin];
    const levels = Array.isArray(parsed.levels)
      ? [...new Set(parsed.levels.map((value) => Number(value)).filter((value) => dailyRecommendationLevelValues.includes(value)))]
      : [...fallback.levels];
    const statuses = Array.isArray(parsed.statuses)
      ? [...new Set(parsed.statuses.filter((value) => dailyStatusValues.has(value)))]
      : [...fallback.statuses];
    const targetGoals = Array.isArray(parsed.targetGoals)
      ? [...new Set(parsed.targetGoals.filter((value) => dailyGoalStatuses.some((goal) => goal.value === value)))]
      : [...fallback.targetGoals];
    return { probabilityMin, probabilityMax, levels, statuses, targetGoals };
  } catch {
    return fallback;
  }
}

function dailyGetExpectedClearProbability(row, mode = "normal") {
  if (!dailyState.model) return null;
  const adjustedPred = dailyGetAdjustedPred(row, mode);
  const normalizedPred = (adjustedPred - dailyState.model.center) / dailyState.model.scale;
  return dailySigmoid(dailyState.model.intercept + dailyState.model.slope * normalizedPred);
}


function dailyShuffleRows(rows) {
  const shuffled = [...rows];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function dailyGetAutoFillCandidates() {
  const settings = dailyReadRecommendationSettings();
  dailyState.recommendationSettings = settings;
  return dailyState.rows.filter((row) => {
    if (dailyState.selected.has(String(row.chartId))) return false;
    const status = dailyGetStatus(row.chartId);
    if (!settings.statuses.includes(status) || !settings.levels.includes(row.level)) return false;
    if (dailyGetGoalOptions(status).length === 0) return false;
    const goal = dailyGetDefaultGoal(status);
    if (!goal || !settings.targetGoals.includes(goal)) return false;
    const probability = goal ? dailyGetExpectedClearProbability(row, dailyGetPredModeForGoal(goal)) : null;
    if (probability === null) return false;
    const probabilityPercent = probability * 100;
    return probabilityPercent >= settings.probabilityMin && probabilityPercent <= settings.probabilityMax;
  });
}

function dailyGetChartHref(row) {
  return "chart-pages/" + encodeURIComponent(row.chartId) + ".html";
}

function dailyRenderChartLink(row) {
  const difficulty = dailyNormalizeDifficulty(row.difficulty);
  return '<a class="chart-link ' + (dailyDifficultyClasses[difficulty] ?? "") + '" href="' + dailyEscapeHtml(dailyGetChartHref(row)) + '"><span class="chart-title-cell__name">' + dailyEscapeHtml(row.title) + '</span> <span class="chart-title-cell__difficulty">[' + dailyEscapeHtml(difficulty) + "]</span></a>";
}

function dailyRenderTitle(row) {
  return '<td class="chart-title-cell">' + dailyRenderChartLink(row) + '</td>';
}

function dailyRenderStatus(status) {
  return '<span class="daily-status" data-status="' + dailyEscapeHtml(status) + '">' + dailyEscapeHtml(dailyGetStatusLabel(status)) + "</span>";
}

function dailyRenderStatusOptions(status) {
  return dailyStatuses.map((item) => '<option value="' + item.value + '"' + (item.value === status ? " selected" : "") + ">" + dailyEscapeHtml(item.label) + "</option>").join("");
}

function dailyRenderStatusSelect(row, status) {
  return '<select class="daily-locked-status-select" data-status="' + dailyEscapeHtml(status) + '" data-daily-status-chart-id="' + dailyEscapeHtml(row.chartId) + '" aria-label="' + dailyEscapeHtml(row.title) + 'のクリア状況">'
    + dailyRenderStatusOptions(status)
    + "</select>";
}

function dailyGetCandidateGoal(row, status) {
  const options = dailyGetManualGoalOptions(status);
  const stored = dailyState.manualGoalById.get(String(row.chartId));
  if (stored && options.some((goal) => goal.value === stored)) return stored;
  const automatic = dailyGetDefaultGoal(status);
  if (automatic && options.some((goal) => goal.value === automatic)) return automatic;
  return options[0]?.value ?? null;
}

function dailyRenderGoalSelect(row, status, selectedGoal) {
  const options = dailyGetManualGoalOptions(status);
  if (options.length === 0) return '<span class="daily-target-placeholder">ー</span>';
  const value = options.some((goal) => goal.value === selectedGoal) ? selectedGoal : options[0].value;
  return '<select class="daily-target-goal-select daily-goal" data-daily-goal-chart-id="' + dailyEscapeHtml(row.chartId) + '" data-status="' + dailyEscapeHtml(value) + '" aria-label="' + dailyEscapeHtml(row.title) + 'の目標">'
    + options.map((goal) => '<option value="' + goal.value + '"' + (goal.value === value ? " selected" : "") + ">" + dailyEscapeHtml(goal.label) + "</option>").join("")
    + "</select>";
}

function dailyRenderSelectedSongs() {
  const selectedRows = Array.from(dailyState.selected.entries()).map(([chartId, selectedGoal]) => {
    const row = dailyState.rowsById.get(String(chartId));
    if (!row) return null;
    const status = dailyGetStatus(chartId);
    return { row, status, selectedGoal };
  }).filter(Boolean);
  dailyElements.selectedSongs.hidden = selectedRows.length === 0;
  dailyElements.selectedSongsList.innerHTML = selectedRows.map(({ row, status, selectedGoal }) => {
    const levelText = "☆" + String(row.level).replace(/\.0$/, "");
    const adjustedPred = dailyGetAdjustedPred(row, dailyGetPredModeForGoal(selectedGoal));
    return '<div class="daily-target-selected-song">'
      + '<input class="memo-checkbox daily-target-selected-checkbox" type="checkbox" checked data-daily-selected-chart-id="' + dailyEscapeHtml(row.chartId) + '" aria-label="' + dailyEscapeHtml(row.title) + 'を今日の10曲から外す">'
      + '<div class="daily-target-selected-song__body">'
      + '<div class="chart-title-cell daily-target-selected-song__title">' + dailyRenderChartLink(row) + '</div>'
      + '<div class="daily-target-selected-song__meta"><span class="daily-target-selected-song__level mono numeric-value numeric-value--level">' + dailyEscapeHtml(levelText) + '</span><span aria-hidden="true">　</span><span class="daily-target-selected-song__adjusted-pred-label">目標補正Pred</span><span aria-hidden="true"> </span><strong class="daily-target-selected-song__adjusted-pred mono numeric-value numeric-value--pred" style="--numeric-color:' + dailyGetNumericColor(adjustedPred) + '">' + dailyEscapeHtml(dailyFormatPred(adjustedPred)) + '</strong></div>'
      + '<div class="daily-target-selected-song__state-labels" aria-hidden="true"><span>現在</span><span>→</span><span>目標</span></div>'
      + '<div class="daily-target-selected-song__state-values"><span class="daily-target-selected-song__status">' + dailyRenderStatus(status) + '</span><span aria-hidden="true"></span><span class="daily-target-selected-song__goal">' + dailyRenderGoalSelect(row, status, selectedGoal) + '</span></div>'
      + '</div>'
      + '</div>';
  }).join("");
}

function dailyRenderPredStack(row, adjusted = false) {
  return `<div class="daily-pred-stack">${Object.entries(dailyPredModes).map(([mode, definition]) => {
    const raw = dailyGetPredValue(row, mode);
    const value = adjusted ? dailyGetAdjustedPred(row, mode) : raw;
    const difference = adjusted ? " (" + dailyFormatPredDifference(value - raw) + ")" : "";
    return `<span class="daily-pred-stack__item"><span>${definition.label}</span><strong class="numeric-value numeric-value--pred" style="--numeric-color:${dailyGetNumericColor(value)}">${dailyEscapeHtml(dailyFormatPred(value))}</strong>${difference ? `<small>${dailyEscapeHtml(difference)}</small>` : ""}</span>`;
  }).join("")}</div>`;
}

function dailyRenderAdjustedPredCell(row, mode = "all") {
  if (mode === "all") return '<td class="daily-pred daily-adjusted-pred">' + dailyRenderPredStack(row, true) + "</td>";
  const raw = dailyGetPredValue(row, mode);
  const adjustedValue = dailyGetAdjustedPred(row, mode);
  const adjustedText = dailyFormatPred(adjustedValue);
  const difference = dailyFormatPredDifference(adjustedValue - raw);
  return '<td class="mono daily-pred daily-adjusted-pred" style="--numeric-color:' + dailyGetNumericColor(adjustedValue) + '"><span class="daily-adjusted-pred__value">'
    + dailyEscapeHtml(adjustedText) + '</span> <span class="daily-adjusted-pred__difference">('
    + dailyEscapeHtml(difference) + ")</span></td>";
}

function dailyRenderOriginalPredCell(row, mode = "all") {
  if (mode === "all") return '<td class="daily-pred">' + dailyRenderPredStack(row, false) + "</td>";
  const value = dailyGetPredValue(row, mode);
  return '<td class="mono daily-pred" style="--numeric-color:' + dailyGetNumericColor(value) + '">' + dailyFormatPred(value) + "</td>";
}


function dailyFormatBpmPart(value) {
  const numeric = dailyGetNumber(value);
  return numeric === null ? String(value ?? "").trim() : String(numeric);
}

function dailyFormatBpmCell(row) {
  const minText = dailyFormatBpmPart(row.bpmMin);
  const maxText = dailyFormatBpmPart(row.bpmMax);
  if (!minText && !maxText) return "";
  if (minText === maxText || !maxText) return dailyEscapeHtml(minText);
  return '<span class="bpm-range"><span class="bpm-range__min">' + dailyEscapeHtml(minText) + '~</span><span class="bpm-range__max">' + dailyEscapeHtml(maxText) + "</span></span>";
}
function dailyRenderCandidateRow(row) {
  const status = dailyGetStatus(row.chartId);
  const goals = dailyGetManualGoalOptions(status);
  const checked = dailyState.selected.has(row.chartId);
  const selectedGoal = dailyState.selected.get(row.chartId) ?? dailyGetCandidateGoal(row, status);
  const predMode = dailyGetPredModeForGoal(selectedGoal);
  const levelText = "☆" + String(row.level).replace(/\.0$/, "");
  const selectionLabel = checked ? "選択中" : "選択";
  return "<tr>"
    + '<td class="daily-select-cell"><button class="daily-target-select-button' + (checked ? " is-selected" : "") + '" type="button" data-daily-select-chart-id="' + dailyEscapeHtml(row.chartId) + '" aria-pressed="' + (checked ? "true" : "false") + '"' + (goals.length === 0 ? " disabled" : "") + ' aria-label="' + dailyEscapeHtml(row.title) + 'を今日の10曲に選択">' + selectionLabel + "</button></td>"
    + '<td class="mono daily-level">' + dailyEscapeHtml(levelText) + "</td>"
    + dailyRenderTitle(row)
    + '<td class="daily-target-current-cell">' + dailyRenderStatus(status) + "</td>"
    + '<td class="daily-target-goal-cell">' + dailyRenderGoalSelect(row, status, selectedGoal) + "</td>"
    + dailyRenderAdjustedPredCell(row, predMode)
    + dailyRenderOriginalPredCell(row, predMode)
    + '<td class="mono daily-target-bpm">' + dailyFormatBpmCell(row) + "</td>"
    + '<td class="feature-cell">' + dailyRenderFeatureChips(row) + "</td>"
    + "</tr>";
}

function dailyRenderLockedRow(entry, row) {
  const currentStatus = dailyGetStatus(row.chartId);
  const achieved = dailyGetStatusRank(currentStatus) >= dailyGetStatusRank(entry.targetStatus);
  const levelText = "☆" + String(row.level).replace(/\.0$/, "");
  return "<tr>"
    + '<td>' + dailyRenderStatusSelect(row, currentStatus) + "</td>"
    + '<td class="mono daily-level">' + dailyEscapeHtml(levelText) + "</td>"
    + dailyRenderTitle(row)
    + '<td class="daily-target-start-goal">' + dailyRenderStatus(entry.initialStatus)
    + '<span class="daily-target-goal-arrow" aria-hidden="true">→</span><span class="daily-goal" data-status="' + dailyEscapeHtml(entry.targetStatus) + '">' + dailyEscapeHtml(dailyGetStatusLabel(entry.targetStatus)) + "</span></td>"
    + '<td><span class="daily-target-progress--' + (achieved ? "achieved" : "pending") + '">' + (achieved ? "達成" : "未達成") + "</span></td>"
    + dailyRenderAdjustedPredCell(row, dailyGetPredModeForGoal(entry.targetStatus))
    + dailyRenderOriginalPredCell(row, dailyGetPredModeForGoal(entry.targetStatus))
    + '<td class="feature-cell">' + dailyRenderFeatureChips(row) + "</td>"
    + "</tr>";
}





function dailySigmoid(value) {
  if (value >= 0) {
    const exponential = Math.exp(-value);
    return 1 / (1 + exponential);
  }
  const exponential = Math.exp(value);
  return exponential / (1 + exponential);
}

function dailyGetPredObservations() {
  const observations = [];
  dailyState.records.forEach((record, chartId) => {
    const row = dailyState.rowsById.get(String(chartId));
    if (!row) return;
    const status = String(record?.status ?? "").toLowerCase();
    const outcome = dailyClearStatuses.has(status)
      ? 1
      : dailyNotClearStatuses.has(status)
        ? 0
        : null;
    if (outcome === null) return;
    observations.push({ row, pred: row.pred, outcome });
  });
  return observations;
}

function dailyFitBaseModel(observations) {
  const clearObservations = observations.filter((observation) => observation.outcome === 1);
  const notClearObservations = observations.filter((observation) => observation.outcome === 0);
  if (observations.length < 5 || clearObservations.length === 0 || notClearObservations.length === 0) return null;
  const center = observations.reduce((total, observation) => total + observation.pred, 0) / observations.length;
  const variance = observations.reduce((total, observation) => total + (observation.pred - center) ** 2, 0) / observations.length;
  const scale = Math.max(Math.sqrt(variance), 0.25);
  const clearAverage = clearObservations.reduce((total, observation) => total + observation.pred, 0) / clearObservations.length;
  const notClearAverage = notClearObservations.reduce((total, observation) => total + observation.pred, 0) / notClearObservations.length;
  if (clearAverage > notClearAverage) return null;
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
      const probability = dailySigmoid(intercept + slope * normalizedPred);
      const weight = Math.max(probability * (1 - probability), 0.00001);
      const residual = probability - observation.outcome;
      gradientIntercept += residual;
      gradientSlope += residual * normalizedPred;
      hessianIntercept += weight;
      hessianCross += weight * normalizedPred;
      hessianSlope += weight * normalizedPred * normalizedPred;
    });
    const determinant = hessianIntercept * hessianSlope - hessianCross * hessianCross;
    if (!Number.isFinite(determinant) || determinant <= 0) return null;
    const stepIntercept = (hessianSlope * gradientIntercept - hessianCross * gradientSlope) / determinant;
    const stepSlope = (-hessianCross * gradientIntercept + hessianIntercept * gradientSlope) / determinant;
    if (!Number.isFinite(stepIntercept) || !Number.isFinite(stepSlope)) return null;
    intercept = Math.max(-30, Math.min(30, intercept - stepIntercept));
    slope = Math.max(-30, Math.min(30, slope - stepSlope));
    if (Math.max(Math.abs(stepIntercept), Math.abs(stepSlope)) < 0.00001) break;
  }
  const fittedSlope = slope;
  slope = Math.min(-0.05, slope);
  const threshold = center + (-intercept / slope) * scale;
  const range = dailyState.predDataMax - dailyState.predDataMin;
  if (!Number.isFinite(intercept) || !Number.isFinite(slope) || fittedSlope >= 0 || !Number.isFinite(threshold) || range <= 0 || threshold <= dailyState.predDataMin || threshold >= dailyState.predDataMax) return null;
  return { intercept, slope, center, scale };
}

function dailyGetFeatureVector(row) {
  const vector = new Array(dailyFeatureNames.length).fill(0);
  dailyGetFeatureDetails(row).forEach((feature) => {
    const index = dailyFeatureNames.indexOf(feature.name);
    if (index >= 0) vector[index] += feature.plusCount >= 2 ? 2 : feature.plusCount === 1 ? 1.5 : 1;
  });
  return vector;
}

function dailySolveLinearSystem(matrix, values) {
  const size = values.length;
  const augmented = matrix.map((row, index) => [...row, values[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivotRow = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivotRow][column])) pivotRow = row;
    }
    if (Math.abs(augmented[pivotRow][column]) < 0.0000000001) return null;
    [augmented[column], augmented[pivotRow]] = [augmented[pivotRow], augmented[column]];
    const pivot = augmented[column][column];
    for (let index = column; index <= size; index += 1) augmented[column][index] /= pivot;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      if (factor === 0) continue;
      for (let index = column; index <= size; index += 1) augmented[row][index] -= factor * augmented[column][index];
    }
  }
  return augmented.map((row) => row[size]);
}

function dailyFitFeatureDeltas(observations, model) {
  const deltas = new Array(dailyFeatureNames.length).fill(0);
  if (!model) return deltas;
  const samples = observations.map((observation) => ({
    pred: observation.pred,
    outcome: observation.outcome,
    vector: dailyGetFeatureVector(observation.row),
  })).filter((sample) => sample.vector.some((value) => value > 0));
  if (samples.length === 0) return deltas;
  const modelDerivativePerPred = model.slope / model.scale;
  for (let iteration = 0; iteration < dailyFeatureDeltaIterations; iteration += 1) {
    const gradient = new Array(dailyFeatureNames.length).fill(0);
    const hessian = Array.from({ length: dailyFeatureNames.length }, () => new Array(dailyFeatureNames.length).fill(0));
    samples.forEach((sample) => {
      const adjustment = sample.vector.reduce((total, strength, index) => total + deltas[index] * strength, 0);
      const normalizedPred = (sample.pred + adjustment - model.center) / model.scale;
      const probability = dailySigmoid(model.intercept + model.slope * normalizedPred);
      const residual = probability - sample.outcome;
      const curvature = Math.max(probability * (1 - probability), 0.00001);
      sample.vector.forEach((leftStrength, leftIndex) => {
        gradient[leftIndex] += residual * modelDerivativePerPred * leftStrength;
        sample.vector.forEach((rightStrength, rightIndex) => {
          hessian[leftIndex][rightIndex] += curvature * modelDerivativePerPred * modelDerivativePerPred * leftStrength * rightStrength;
        });
      });
    });
    for (let index = 0; index < dailyFeatureNames.length; index += 1) {
      gradient[index] += 2 * dailyFeatureDeltaLambda * deltas[index];
      hessian[index][index] += 2 * dailyFeatureDeltaLambda;
    }
    const step = dailySolveLinearSystem(hessian, gradient);
    if (!step) break;
    let largestStep = 0;
    for (let index = 0; index < deltas.length; index += 1) {
      const next = deltas[index] - step[index];
      if (!Number.isFinite(next)) return new Array(dailyFeatureNames.length).fill(0);
      deltas[index] = next;
      largestStep = Math.max(largestStep, Math.abs(step[index]));
    }
    if (largestStep < dailyFeatureDeltaTolerance) break;
  }
  return deltas;
}

function dailyGetAdjustedPred(row, mode = "normal") {
  const raw = dailyGetPredValue(row, mode);
  if (mode !== "normal") {
    const vector = dailyGetFeatureVector(row);
    return raw + vector.reduce((total, strength, index) => total + dailyState.deltas[index] * strength, 0);
  }
  return dailyState.adjustedPredById.get(String(row.chartId)) ?? raw;
}


function dailyFormatPredDifference(value) {
  const numeric = dailyGetNumber(value);
  if (numeric === null) return "";
  const rounded = Number(numeric.toFixed(1));
  return (rounded >= 0 ? "+" : "") + rounded.toFixed(1);
}

function dailyRecalculateModel() {
  const observations = dailyGetPredObservations();
  dailyState.model = dailyFitBaseModel(observations);
  dailyState.deltas = dailyFitFeatureDeltas(observations, dailyState.model);
  dailyState.adjustedPredById = new Map();
  dailyState.rows.forEach((row) => {
    const vector = dailyGetFeatureVector(row);
    const adjustedPred = row.pred + vector.reduce((total, strength, index) => total + dailyState.deltas[index] * strength, 0);
    dailyState.adjustedPredById.set(String(row.chartId), adjustedPred);
  });
  dailySetAdjustedPredBounds();
}

function dailySetAdjustedPredBounds() {
  const values = Array.from(dailyState.adjustedPredById.values()).filter(Number.isFinite);
  const nextMin = values.length > 0 ? Math.min(...values) : 0;
  const nextMax = values.length > 0 ? Math.max(...values) : 999;
  const isDefault = dailyState.adjustedPredMinFilter === dailyState.adjustedPredDataMin
    && dailyState.adjustedPredMaxFilter === dailyState.adjustedPredDataMax;
  dailyState.adjustedPredDataMin = nextMin;
  dailyState.adjustedPredDataMax = nextMax;
  if (isDefault) {
    dailyState.adjustedPredMinFilter = nextMin;
    dailyState.adjustedPredMaxFilter = nextMax;
  }
  if (!dailyElements.adjustedPredMinInput) return;
  dailyElements.adjustedPredMinInput.min = String(nextMin);
  dailyElements.adjustedPredMinInput.max = String(nextMax);
  dailyElements.adjustedPredMaxInput.min = String(nextMin);
  dailyElements.adjustedPredMaxInput.max = String(nextMax);
  dailyElements.adjustedPredMinInput.value = dailyFormatPred(dailyState.adjustedPredMinFilter);
  dailyElements.adjustedPredMaxInput.value = dailyFormatPred(dailyState.adjustedPredMaxFilter);
  dailyUpdateAdvancedSummary();
}

function dailyGetFilteredRows() {
  const settings = dailyReadRecommendationSettings();
  dailyState.recommendationSettings = settings;
  return dailyState.rows.filter((row) => {
    if (dailyState.query && !row.search.includes(dailyState.query)) return false;
    const status = dailyGetStatus(row.chartId);
    if (dailyGetStatusRank(status) >= dailyGetStatusRank("hard")) return false;
    if (!dailyState.statusFilter.has(status)) return false;
    if (!dailyState.levelFilter.has(row.level)) return false;
    if (!dailyState.difficultyFilter.has(row.difficulty)) return false;
    if (!dailyFeatureFilterMatches(row)) return false;
    const bpmMin = dailyGetNumber(row.bpmMin);
    const bpmMax = dailyGetNumber(row.bpmMax);
    if (bpmMin !== null && bpmMin < dailyState.bpmMinFilter) return false;
    if (bpmMax !== null && bpmMax > dailyState.bpmMaxFilter) return false;
    if (row.pred < dailyState.predMinFilter || row.pred > dailyState.predMaxFilter) return false;
    const adjustedPred = dailyGetAdjustedPred(row);
    if (adjustedPred < dailyState.adjustedPredMinFilter || adjustedPred > dailyState.adjustedPredMaxFilter) return false;
    return true;
  });
}

function dailyRenderCandidateTable() {
  const rows = dailyGetFilteredRows();
  const visibleRows = rows.slice(0, dailyState.visibleLimit);
  dailyElements.candidateCount.textContent = visibleRows.length.toLocaleString() + "件表示 / " + rows.length.toLocaleString() + "件中";
  dailyElements.candidateBody.innerHTML = visibleRows.map(dailyRenderCandidateRow).join("");
  dailyElements.loadMore.hidden = visibleRows.length >= rows.length;
  dailyElements.selectedCount.textContent = dailyState.selected.size + " / 10曲選択中";
  dailyElements.confirmButton.disabled = dailyState.selected.size === 0;
  dailyElements.resetButton.hidden = dailyState.selected.size === 0;
  dailyElements.autoFillButton.disabled = dailyState.selected.size >= 10;
  dailyElements.manualAutoFillButton.disabled = dailyState.selected.size >= 10;
  dailyRenderSelectedSongs();
}

function dailyGetMissingSavedIds() {
  const missingIds = new Set();
  [...dailyState.records.keys(), ...dailyState.manualMemoIds].forEach((chartId) => {
    const normalizedChartId = String(chartId ?? "").trim();
    if (normalizedChartId && !dailyState.rowsById.has(normalizedChartId)) {
      missingIds.add(normalizedChartId);
    }
  });
  return missingIds;
}

function dailyUpdateMissingDataMessage() {
  const message = dailyElements.missingDataMessage;
  if (!message) return;
  const count = dailyGetMissingSavedIds().size;
  message.hidden = count === 0;
  message.textContent = count === 0
    ? ""
    : "譜面データなし: " + count.toLocaleString() + "譜面。保存されたクリアランプ・手動メモは保持されていますが、現在の譜面データがないため、表・Pred推定・リコメンドの対象外です。";
}

function dailyRenderMissingLockedRow(entry) {
  const chartId = String(entry?.chartId ?? "");
  const initialStatus = String(entry?.initialStatus ?? "unregistered").toLowerCase();
  const targetStatus = String(entry?.targetStatus ?? "easy").toLowerCase();
  const currentStatus = dailyGetStatus(chartId);
  return '<tr class="daily-target-missing-row">'
    + '<td>' + dailyRenderStatus(currentStatus) + "</td>"
    + '<td class="mono daily-level">—</td>'
    + '<td class="chart-title-cell"><span class="daily-target-missing-title">譜面データなし</span><small class="daily-target-missing-title__id">chart ID: ' + dailyEscapeHtml(chartId) + "</small></td>"
    + '<td class="daily-target-start-goal">' + dailyRenderStatus(initialStatus)
    + '<span class="daily-target-goal-arrow" aria-hidden="true">→</span>' + dailyRenderStatus(targetStatus) + "</td>"
    + '<td><span class="daily-target-progress--pending">対象外</span></td>'
    + '<td class="mono">—</td><td class="mono">—</td><td class="feature-cell">—</td>'
    + "</tr>";
}

function dailyRenderLocked() {
  if (!dailyState.today) {
    dailyElements.selection.hidden = false;
    dailyElements.locked.hidden = true;
    dailyRenderCandidateTable();
    return;
  }
  dailyElements.selection.hidden = true;
  dailyElements.locked.hidden = false;
  const entries = Array.isArray(dailyState.today.charts) ? dailyState.today.charts : [];
  let achievedCount = 0;
  let missingCount = 0;
  const renderedRows = entries.map((entry) => {
    const row = dailyState.rowsById.get(String(entry.chartId));
    if (!row) {
      missingCount += 1;
      return { entry, row: null };
    }
    const achieved = dailyGetStatusRank(dailyGetStatus(row.chartId)) >= dailyGetStatusRank(entry.targetStatus);
    if (achieved) achievedCount += 1;
    return { entry, row };
  });
  const validCount = renderedRows.length - missingCount;
  const completed = validCount > 0 && missingCount === 0 && achievedCount === validCount;
  const progressText = validCount > 0
    ? achievedCount + " / " + validCount + "達成" + (missingCount > 0 ? "（譜面データなし " + missingCount + "件）" : "")
    : missingCount > 0 ? "譜面データなし " + missingCount + "件" : "0 / 0達成";
  dailyElements.progress.textContent = completed ? progressText + " 🎉" : progressText;
  dailyElements.abandon.textContent = completed ? "挑戦を終了する" : "挑戦をやめる";
  dailyElements.abandon.classList.toggle("daily-target-abandon-all--completed", completed);
  dailyElements.abandon.dataset.completed = String(completed);
  dailyElements.lockedBody.innerHTML = renderedRows.map(({ entry, row }) => row
    ? dailyRenderLockedRow(entry, row)
    : dailyRenderMissingLockedRow(entry)).join("");
  if (completed && dailyState.completionNoticeShownDate !== dailyState.today.date) {
    dailyState.completionNoticeShownDate = dailyState.today.date;
    dailyOpenCompletionNotice();
  }
}

function dailyRender() {
  dailyUpdateMissingDataMessage();
  if (dailyState.today) dailyRenderLocked();
  else {
    dailyElements.selection.hidden = false;
    dailyElements.locked.hidden = true;
    dailyRenderCandidateTable();
  }
  requestAnimationFrame(() => {
    document.querySelectorAll(".daily-target-table-shell").forEach((shell) => {
      shell.classList.toggle("is-overflowing", shell.scrollWidth > shell.clientWidth + 1);
    });
  });
}

function dailyShowError(message) {
  dailyElements.error.textContent = message;
  dailyElements.error.hidden = !message;
}

function dailySetLoading(loading, message = "読み込み中です。") {
  dailyState.ready = !loading;
  if (dailyElements.panel) {
    dailyElements.panel.hidden = loading;
    dailyElements.panel.inert = loading;
    dailyElements.panel.setAttribute("aria-busy", String(loading));
  }
  if (dailyElements.loading) {
    dailyElements.loading.hidden = !loading;
    dailyElements.loading.textContent = message;
  }
}

function dailySetUnavailable(message) {
  dailyState.ready = false;
  if (dailyElements.panel) {
    dailyElements.panel.hidden = true;
    dailyElements.panel.inert = true;
    dailyElements.panel.setAttribute("aria-busy", "true");
  }
  if (dailyElements.loading) {
    dailyElements.loading.hidden = false;
    dailyElements.loading.textContent = message;
  }
}

function dailyPopulateFilters() {
  const levels = dailyGetLevelOptions();
  const difficulties = dailyGetDifficultyOptions();
  dailyState.levelFilter = new Set(levels);
  dailyState.difficultyFilter = new Set(difficulties);
  dailyFillMultiFilterOptions(dailyElements.levelMenu, levels, "levelFilter", (value) => "☆" + String(value).replace(/\.0$/, ""), dailyElements.levelSummary);
  dailyFillMultiFilterOptions(dailyElements.difficultyMenu, difficulties, "difficultyFilter", (value) => dailyDifficultyLabels[value] ?? value, dailyElements.difficultySummary);
  dailyFillMultiFilterOptions(dailyElements.statusMenu, dailyStatuses.filter(({ value }) => value !== "hard").map(({ value }) => value), "statusFilter", (value) => dailyGetStatusLabel(value), dailyElements.statusSummary);
  dailyFillFeatureFilterOptions(dailyElements.featureMenu);
  dailyElements.bpmMinInput.value = String(dailyState.bpmMinFilter);
  dailyElements.bpmMaxInput.value = String(dailyState.bpmMaxFilter);
  dailyElements.predMinInput.value = dailyFormatPred(dailyState.predMinFilter);
  dailyElements.predMaxInput.value = dailyFormatPred(dailyState.predMaxFilter);
  dailyElements.adjustedPredMinInput.value = dailyFormatPred(dailyState.adjustedPredMinFilter);
  dailyElements.adjustedPredMaxInput.value = dailyFormatPred(dailyState.adjustedPredMaxFilter);
  dailyUpdateAdvancedSummary();
}

function dailyReadRecords() {
  return new Promise((resolve, reject) => {
    const request = dailyState.database.transaction(dailyStatusStoreName, "readonly").objectStore(dailyStatusStoreName).getAll();
    request.onsuccess = () => resolve(request.result ?? []);
    request.onerror = () => reject(request.error ?? new Error("クリア状況を読み込めませんでした。"));
  });
}

function dailyWriteStatus(chartId, status) {
  return new Promise((resolve, reject) => {
    const transaction = dailyState.database.transaction(dailyStatusStoreName, "readwrite");
    const store = transaction.objectStore(dailyStatusStoreName);
    if (status === "unregistered") {
      store.delete(String(chartId));
    } else {
      store.put({ chartId: String(chartId), status, updatedAt: new Date().toISOString() });
    }
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error ?? new Error("記録を保存できませんでした。"));
    transaction.onabort = () => reject(transaction.error ?? new Error("記録を保存できませんでした。"));
  });
}

function dailyReadManualMemos() {
  return new Promise((resolve, reject) => {
    const request = dailyState.database.transaction("manual-targets", "readonly").objectStore("manual-targets").getAll();
    request.onsuccess = () => resolve(request.result ?? []);
    request.onerror = () => reject(request.error ?? new Error("手動メモを読み込めませんでした。"));
  });
}

function dailyBuildManualMemoIds(memos) {
  return new Set(
    memos
      .map((memo) => String(memo?.chartId ?? "").trim())
      .filter((chartId) => /^\d+$/.test(chartId)),
  );
}

function dailyRecordsChanged(nextRecords) {
  if (nextRecords.length !== dailyState.records.size) return true;
  return nextRecords.some((record) => {
    const chartId = String(record?.chartId ?? "");
    const current = dailyState.records.get(chartId);
    return !current || String(current.status ?? "") !== String(record?.status ?? "");
  });
}

function dailySetsEqual(left, right) {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

async function dailyRefreshPersistedState() {
  if (!dailyState.ready || !dailyState.database) return;
  if (dailyState.refreshPromise) return dailyState.refreshPromise;
  dailyState.refreshPromise = Promise.all([
    dailyReadRecords(),
    dailyReadManualMemos(),
    dailyReadToday(dailyGetDateKey()),
  ]).then(([records, manualMemos, today]) => {
    const nextRecords = new Map(records.map((record) => [String(record.chartId), record]));
    const nextManualMemoIds = dailyBuildManualMemoIds(manualMemos);
    const changed = dailyRecordsChanged(records)
      || !dailySetsEqual(dailyState.manualMemoIds, nextManualMemoIds)
      || JSON.stringify(dailyState.today) !== JSON.stringify(today);
    dailyState.records = nextRecords;
    dailyState.manualMemoIds = nextManualMemoIds;
    dailyState.today = today;
    if (changed) {
      dailyRecalculateModel();
      dailyRender();
    }
  }).catch((error) => {
    dailyShowError(error instanceof Error ? error.message : "クリア状況を更新できませんでした。");
  }).finally(() => {
    dailyState.refreshPromise = null;
  });
  return dailyState.refreshPromise;
}

function dailyReadToday(date) {
  return new Promise((resolve, reject) => {
    const request = dailyState.database.transaction(dailyTargetsStoreName, "readonly").objectStore(dailyTargetsStoreName).get(date);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error ?? new Error("今日の10曲を読み込めませんでした。"));
  });
}

function dailyWriteToday(record) {
  return new Promise((resolve, reject) => {
    const transaction = dailyState.database.transaction(dailyTargetsStoreName, "readwrite");
    transaction.objectStore(dailyTargetsStoreName).put(record);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error ?? new Error("今日の10曲を保存できませんでした。"));
    transaction.onabort = () => reject(transaction.error ?? new Error("今日の10曲を保存できませんでした。"));
  });
}

function dailyOpenDatabase() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("このブラウザでは今日の10曲を保存できません。"));
      return;
    }
    const request = window.indexedDB.open(dailyDatabaseName, dailyDatabaseVersion);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(dailyStatusStoreName)) database.createObjectStore(dailyStatusStoreName, { keyPath: "chartId" });
      if (!database.objectStoreNames.contains("manual-targets")) database.createObjectStore("manual-targets", { keyPath: "chartId" });
      if (!database.objectStoreNames.contains(dailyTargetsStoreName)) database.createObjectStore(dailyTargetsStoreName, { keyPath: "date" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("ローカル保存を開けませんでした。"));
    request.onblocked = () => reject(new Error("別のページがローカル保存を使用中です。ページを閉じてから再読み込みしてください。"));
  });
}

function dailyGetDateKey(date = new Date()) {
  const values = [date.getFullYear(), date.getMonth() + 1, date.getDate()];
  return values.map((value, index) => index === 0 ? String(value) : String(value).padStart(2, "0")).join("-");
}

function dailyCleanupOldTargets() {
  const cutoffDate = new Date();
  cutoffDate.setHours(0, 0, 0, 0);
  cutoffDate.setDate(cutoffDate.getDate() - 29);
  const cutoffKey = dailyGetDateKey(cutoffDate);
  return new Promise((resolve, reject) => {
    const transaction = dailyState.database.transaction(dailyTargetsStoreName, "readwrite");
    const request = transaction.objectStore(dailyTargetsStoreName).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const date = String(cursor.value?.date ?? cursor.key ?? "");
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date < cutoffKey) {
        cursor.delete();
      }
      cursor.continue();
    };
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error ?? new Error("古い今日の10曲を削除できませんでした。"));
    transaction.onabort = () => reject(transaction.error ?? new Error("古い今日の10曲を削除できませんでした。"));
  });
}

function dailyAutoFillSelection() {
  if (!dailyState.ready) return;
  const remaining = Math.max(0, 10 - dailyState.selected.size);
  if (remaining === 0) {
    dailyShowError("今日の10曲はすでに10曲選択されています。");
    return;
  }
  if (!dailyState.model) {
    dailyShowError("有効な登録譜面が不足しているため、自動選択できません。");
    return;
  }
  const selectedRows = dailyShuffleRows(dailyGetAutoFillCandidates()).slice(0, remaining);
  if (selectedRows.length === 0) {
    dailyShowError("自動リコメンド設定に合う譜面がありません。");
    return;
  }
  selectedRows.forEach((row) => {
    const status = dailyGetStatus(row.chartId);
    const goal = dailyGetDefaultGoal(status);
    if (goal) dailyState.selected.set(String(row.chartId), goal);
  });
  dailyShowError("");
  dailyRenderCandidateTable();
}

function dailyAutoFillFromManualMemos() {
  if (!dailyState.ready) return;
  const remaining = Math.max(0, 10 - dailyState.selected.size);
  if (remaining === 0) {
    dailyShowError("今日の10曲はすでに10曲選択されています。");
    return;
  }
  const candidates = dailyShuffleRows(dailyState.rows.filter((row) => {
    const chartId = String(row.chartId);
    if (!dailyState.manualMemoIds.has(chartId) || dailyState.selected.has(chartId)) return false;
    const status = dailyGetStatus(row.chartId);
    return dailyGetStatusRank(status) < dailyGetStatusRank("hard") && dailyGetGoalOptions(status).length > 0;
  })).slice(0, remaining);
  if (candidates.length === 0) {
    dailyShowError("手動メモに、選択可能な譜面がありません。");
    return;
  }
  candidates.forEach((row) => {
    const status = dailyGetStatus(row.chartId);
    const goal = dailyGetDefaultGoal(status);
    if (goal) dailyState.selected.set(String(row.chartId), goal);
  });
  dailyShowError("");
  dailyRenderCandidateTable();
}

function dailyResetSelection() {
  if (!dailyState.ready || dailyState.selected.size === 0) return;
  dailyState.selected.clear();
  dailyShowError("");
  dailyRenderCandidateTable();
}
async function dailyHandleLockedStatusChange(event) {
  if (!dailyState.ready) return;
  const select = event.target.closest?.(".daily-locked-status-select");
  if (!select || !dailyStatusValues.has(select.value)) return;
  const chartId = select.dataset.dailyStatusChartId;
  const previousStatus = dailyGetStatus(chartId);
  const status = select.value;
  select.disabled = true;
  try {
    await dailyWriteStatus(chartId, status);
    if (status === "unregistered") {
      dailyState.records.delete(chartId);
    } else {
      dailyState.records.set(chartId, { chartId, status, updatedAt: new Date().toISOString() });
    }
    dailyShowError("");
    if (typeof window.cpiAnalytics?.track === "function") {
      window.cpiAnalytics.track("status_change", { source: "daily_target", status });
    }
    dailyRender();
    window.cpiStatusToast?.show({
      onUndo: async () => {
        await dailyWriteStatus(chartId, previousStatus);
        if (previousStatus === "unregistered") {
          dailyState.records.delete(chartId);
        } else {
          dailyState.records.set(chartId, {
            chartId,
            status: previousStatus,
            updatedAt: new Date().toISOString(),
          });
        }
        dailyRender();
      },
    });
  } catch (error) {
    select.value = previousStatus;
    select.dataset.status = previousStatus;
    select.disabled = false;
    dailyShowError(error instanceof Error ? error.message : "記録を保存できませんでした。");
  }
}

function dailyHandleCandidateChange(event) {
  if (!dailyState.ready) return;
  const button = event.target.closest?.("[data-daily-select-chart-id]");
  if (!button) return;
  const chartId = button.dataset.dailySelectChartId;
  const row = dailyState.rowsById.get(chartId);
  if (!row) return;
  const nextSelected = button.getAttribute("aria-pressed") !== "true";
  if (nextSelected) {
    if (dailyState.selected.size >= 10) {
      dailyShowError("今日の10曲は最大10曲まで選択できます。");
      return;
    }
    const rowStatus = dailyGetStatus(chartId);
    const goal = dailyGetCandidateGoal(row, rowStatus);
    if (!goal) return;
    dailyState.selected.set(chartId, goal);
  } else {
    dailyState.selected.delete(chartId);
  }
  dailyShowError("");
  dailyRenderCandidateTable();
}

function dailyHandleSelectedSongChange(event) {
  if (!dailyState.ready) return;
  const checkbox = event.target.closest?.("[data-daily-selected-chart-id]");
  if (!checkbox || checkbox.checked) return;
  const chartId = checkbox.dataset.dailySelectedChartId;
  if (!dailyState.selected.has(chartId)) return;
  dailyState.selected.delete(chartId);
  dailyShowError("");
  dailyRenderCandidateTable();
}

function dailyHandleGoalChange(event) {
  if (!dailyState.ready) return;
  const select = event.target.closest?.("[data-daily-goal-chart-id]");
  if (!select) return;
  const chartId = select.dataset.dailyGoalChartId;
  const valid = dailyGetManualGoalOptions(dailyGetStatus(chartId)).some((goal) => goal.value === select.value);
  if (valid) {
    dailyState.manualGoalById.set(chartId, select.value);
    if (dailyState.selected.has(chartId)) dailyState.selected.set(chartId, select.value);
    select.dataset.status = select.value;
    dailyRenderCandidateTable();
  }
}

function dailyDeleteToday() {
  return new Promise((resolve, reject) => {
    const transaction = dailyState.database.transaction(dailyTargetsStoreName, "readwrite");
    transaction.objectStore(dailyTargetsStoreName).delete(dailyState.today.date);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error ?? new Error("今日の10曲を削除できませんでした。"));
    transaction.onabort = () => reject(transaction.error ?? new Error("今日の10曲を削除できませんでした。"));
  });
}

async function dailyAbandonToday() {
  if (!dailyState.ready) return;
  const completed = dailyElements.abandon.dataset.completed === "true";
  if (!dailyState.today || (!completed && !window.confirm("今日の10曲への挑戦をやめますか？"))) return;
  try {
    await dailyDeleteToday();
    dailyState.today = null;
    dailyState.completionNoticeShownDate = "";
    dailyState.selected.clear();
    dailyShowError("");
    dailyRender();
  } catch (error) {
    dailyShowError(error instanceof Error ? error.message : "挑戦をやめられませんでした。");
  }
}

function dailyOpenConfirmNotice() {
  if (!dailyElements.confirmNotice) return;
  dailyElements.confirmNotice.hidden = false;
  document.body.classList.add("daily-target-modal-open");
  dailyElements.confirmNoticeClose?.focus();
}

function dailyCloseConfirmNotice() {
  if (!dailyElements.confirmNotice) return;
  dailyElements.confirmNotice.hidden = true;
  document.body.classList.remove("daily-target-modal-open");
}

function dailyHandleConfirmNoticeBackdropClick(event) {
  if (event.target === dailyElements.confirmNotice) dailyCloseConfirmNotice();
}

function dailyOpenCompletionNotice() {
  if (!dailyElements.completionNotice) return;
  dailyElements.completionNotice.hidden = false;
  document.body.classList.add("daily-target-modal-open");
  dailyElements.completionNoticeClose?.focus();
}

function dailyCloseCompletionNotice() {
  if (!dailyElements.completionNotice) return;
  dailyElements.completionNotice.hidden = true;
  document.body.classList.remove("daily-target-modal-open");
}

function dailyHandleCompletionNoticeBackdropClick(event) {
  if (event.target === dailyElements.completionNotice) dailyCloseCompletionNotice();
}
async function dailyConfirmSelection() {
  if (!dailyState.ready) return;
  if (dailyState.selected.size === 0) {
    dailyShowError("1譜面以上選択してください。");
    return;
  }
  const charts = [];
  for (const [chartId, targetStatus] of dailyState.selected) {
    const row = dailyState.rowsById.get(chartId);
    if (!row) continue;
    const initialStatus = dailyGetStatus(chartId);
    if (!dailyGetManualGoalOptions(initialStatus).some((goal) => goal.value === targetStatus)) {
      dailyShowError("選択中の譜面のStatusが変わったため、目標を設定し直してください。");
      return;
    }
    charts.push({ chartId, initialStatus, targetStatus });
  }
  if (charts.length === 0) {
    dailyShowError("有効な譜面を選択してください。");
    return;
  }
  dailyElements.confirmButton.disabled = true;
  try {
    const record = { date: dailyGetDateKey(), lockedAt: new Date().toISOString(), charts };
    await dailyWriteToday(record);
    dailyState.today = record;
    dailyState.selected.clear();
    dailyShowError("");
    if (typeof window.cpiAnalytics?.track === "function") window.cpiAnalytics.track("daily_target_confirm", { chart_count: charts.length });
    dailyRender();
    dailyOpenConfirmNotice();
  } catch (error) {
    dailyShowError(error instanceof Error ? error.message : "今日の10曲を保存できませんでした。");
    dailyElements.confirmButton.disabled = false;
  }
}

const dailyShareWeightedLimit = 275;
const dailyShareUrl = "https://cpi-next.com/daily-target.html";
const dailyShareUrlLength = 23;
const dailyShareWeightedRanges = [
  [0x0000, 0x10ff],
  [0x2000, 0x200d],
  [0x2010, 0x201f],
  [0x2032, 0x2037],
];
const dailyShareEmojiPattern = /[\p{Emoji_Presentation}\p{Extended_Pictographic}\p{Regional_Indicator}]/u;
const dailyShareGraphemeSegmenter = typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
  : null;

function dailyGetShareCharacters(value) {
  const text = String(value ?? "");
  if (!dailyShareGraphemeSegmenter) return Array.from(text);
  return Array.from(dailyShareGraphemeSegmenter.segment(text), (item) => item.segment);
}

function dailyIsShareWeightedRangeCodePoint(codePoint) {
  return dailyShareWeightedRanges.some(([start, end]) => codePoint >= start && codePoint <= end);
}

function dailyGetShareCharacterLength(character) {
  if (dailyShareEmojiPattern.test(character)) return 2;
  let length = 0;
  for (const symbol of character) {
    length += dailyIsShareWeightedRangeCodePoint(symbol.codePointAt(0)) ? 1 : 2;
  }
  return length;
}

function dailyGetShareLength(value) {
  return dailyGetShareCharacters(value)
    .reduce((total, character) => total + dailyGetShareCharacterLength(character), 0);
}

function dailyGetShareLengthForLimit(value) {
  const text = String(value ?? "");
  const urlIndex = text.indexOf(dailyShareUrl);
  if (urlIndex < 0) return dailyGetShareLength(text);
  return dailyGetShareLength(text.slice(0, urlIndex))
    + dailyShareUrlLength
    + dailyGetShareLength(text.slice(urlIndex + dailyShareUrl.length));
}

function dailyShortenShareTitleToLength(title, maxLength) {
  const value = String(title ?? "");
  if (dailyGetShareLength(value) <= maxLength) return value;
  if (maxLength <= 0) return "";
  const ellipsis = "…";
  const ellipsisLength = dailyGetShareLength(ellipsis);
  const characters = dailyGetShareCharacters(value);
  if (maxLength <= ellipsisLength) {
    let prefix = "";
    for (const character of characters) {
      const candidate = prefix + character;
      if (dailyGetShareLength(candidate) > maxLength) break;
      prefix = candidate;
    }
    return prefix;
  }
  let prefix = "";
  for (const character of characters) {
    const candidate = prefix + character + ellipsis;
    if (dailyGetShareLength(candidate) > maxLength) break;
    prefix += character;
  }
  return prefix ? prefix + ellipsis : ellipsis;
}

function dailyFitShareTitlesToLength(lines, availableLength) {
  if (lines.length === 0) return;
  const originalTitles = lines.map((line) => String(line.title ?? ""));
  const originalLengths = originalTitles.map((title) => dailyGetShareLength(title));
  const limits = lines.map(() => Math.max(0, Math.floor(availableLength / lines.length)));

  lines.forEach((line, index) => {
    line.title = dailyShortenShareTitleToLength(originalTitles[index], limits[index]);
  });

  let usedLength = lines.reduce((total, line) => total + dailyGetShareLength(line.title), 0);
  let remainingLength = Math.max(0, availableLength - usedLength);

  while (remainingLength > 0) {
    let best = null;

    lines.forEach((_line, index) => {
      const currentLength = dailyGetShareLength(lines[index].title);
      if (currentLength >= originalLengths[index]) return;

      let nextLimit = limits[index] + 1;
      let nextTitle = dailyShortenShareTitleToLength(originalTitles[index], nextLimit);
      let nextLength = dailyGetShareLength(nextTitle);

      while (nextLength <= currentLength && nextLimit < originalLengths[index]) {
        nextLimit += 1;
        nextTitle = dailyShortenShareTitleToLength(originalTitles[index], nextLimit);
        nextLength = dailyGetShareLength(nextTitle);
      }

      const cost = nextLength - currentLength;
      if (cost <= 0 || cost > remainingLength) return;
      if (!best || currentLength < best.currentLength || (currentLength === best.currentLength && index < best.index)) {
        best = { index, nextLimit, nextTitle, currentLength, cost };
      }
    });

    if (!best) break;
    lines[best.index].title = best.nextTitle;
    limits[best.index] = best.nextLimit;
    remainingLength -= best.cost;
  }
}

function dailyBuildShareText() {
  const entries = Array.isArray(dailyState.today?.charts) ? dailyState.today.charts : [];
  let achieved = 0;
  let missingCount = 0;
  const lines = entries.map((entry) => {
    const row = dailyState.rowsById.get(String(entry.chartId));
    if (!row) {
      missingCount += 1;
      return null;
    }
    const done = dailyGetStatusRank(dailyGetStatus(row.chartId)) >= dailyGetStatusRank(entry.targetStatus);
    if (done) achieved += 1;
    const difficulty = dailyNormalizeDifficulty(row.difficulty);
    return {
      prefix: done ? "✅" : "⬜",
      title: row.title,
      suffix: difficulty === "A" ? "" : " [" + difficulty + "]",
    };
  }).filter(Boolean);
  const validCount = entries.length - missingCount;
  const completed = validCount > 0 && missingCount === 0 && achieved === validCount;
  const progressText = validCount > 0
    ? achieved + "/" + validCount + "達成" + (missingCount > 0 ? "（譜面データなし " + missingCount + "件）" : "")
    : missingCount > 0 ? "譜面データなし " + missingCount + "件" : "0/0達成";
  const progressLine = progressText === "0/0達成" ? "" : progressText;
  const buildText = () => [
    "今日の10曲に挑戦！",
    ...(progressLine ? [progressLine] : []),
    "",
    ...lines.map((line) => line.prefix + line.title + line.suffix),
    "",
    "https://cpi-next.com/daily-target.html",
    "",
    "#CPINext",
  ].join("\n");

  const fullText = buildText();
  if (dailyGetShareLengthForLimit(fullText) <= dailyShareWeightedLimit || lines.length === 0) {
    return fullText;
  }
  const fixedText = [
    "今日の10曲に挑戦！",
    ...(progressLine ? [progressLine] : []),
    "",
    ...lines.map((line) => line.prefix + line.suffix),
    "",
    "https://cpi-next.com/daily-target.html",
    "",
    "#CPINext",
  ].join("\n");
  const availableTitleLength = Math.max(0, dailyShareWeightedLimit - dailyGetShareLengthForLimit(fixedText));
  dailyFitShareTitlesToLength(lines, availableTitleLength);
  return buildText();
}

function dailyShare() {
  if (!dailyState.ready) return;
  const url = "https://twitter.com/intent/tweet?text=" + encodeURIComponent(dailyBuildShareText());
  window.open(url, "_blank", "noopener,noreferrer");
  if (typeof window.cpiAnalytics?.track === "function") window.cpiAnalytics.track("share_click", { share_type: "x", share_context: "daily_target" });
}

function dailyBindEvents() {
  dailyElements.search.addEventListener("input", () => {
    dailyState.query = dailyElements.search.value.trim().toLocaleLowerCase("ja");
    dailyState.visibleLimit = dailyPageSize;
    dailyRenderCandidateTable();
  });
  dailyElements.bpmMinInput.addEventListener("input", dailyUpdateBpmFilters);
  dailyElements.bpmMaxInput.addEventListener("input", dailyUpdateBpmFilters);
  dailyElements.bpmMinInput.addEventListener("blur", dailyCommitBpmFilters);
  dailyElements.bpmMaxInput.addEventListener("blur", dailyCommitBpmFilters);
  dailyElements.predMinInput.addEventListener("input", dailyUpdatePredFilters);
  dailyElements.predMaxInput.addEventListener("input", dailyUpdatePredFilters);
  dailyElements.predMinInput.addEventListener("blur", dailyCommitPredFilters);
  dailyElements.predMaxInput.addEventListener("blur", dailyCommitPredFilters);
  dailyElements.adjustedPredMinInput.addEventListener("input", dailyUpdateAdjustedPredFilters);
  dailyElements.adjustedPredMaxInput.addEventListener("input", dailyUpdateAdjustedPredFilters);
  dailyElements.adjustedPredMinInput.addEventListener("blur", dailyCommitAdjustedPredFilters);
  dailyElements.adjustedPredMaxInput.addEventListener("blur", dailyCommitAdjustedPredFilters);
  document.querySelectorAll(".daily-target-filter-details").forEach((detail) => {
    detail.addEventListener("toggle", () => {
      if (!detail.open) return;
      document.querySelectorAll(".daily-target-filter-details").forEach((otherDetail) => {
        if (otherDetail !== detail) otherDetail.open = false;
      });
    });
  });
  dailyElements.lockedBody.addEventListener("change", dailyHandleLockedStatusChange);
  dailyElements.candidateBody.addEventListener("click", dailyHandleCandidateChange);
  dailyElements.candidateBody.addEventListener("change", dailyHandleGoalChange);
  dailyElements.selectedSongsList.addEventListener("change", dailyHandleSelectedSongChange);
  dailyElements.selectedSongsList.addEventListener("change", dailyHandleGoalChange);
  dailyElements.autoFillButton.addEventListener("click", dailyAutoFillSelection);
  dailyElements.manualAutoFillButton.addEventListener("click", dailyAutoFillFromManualMemos);
  dailyElements.confirmButton.addEventListener("click", dailyConfirmSelection);
  dailyElements.confirmNoticeClose.addEventListener("click", dailyCloseConfirmNotice);
  dailyElements.confirmNoticeShare.addEventListener("click", dailyShare);
  dailyElements.confirmNotice.addEventListener("click", dailyHandleConfirmNoticeBackdropClick);
  dailyElements.completionNoticeClose.addEventListener("click", dailyCloseCompletionNotice);
  dailyElements.completionNoticeShare.addEventListener("click", dailyShare);
  dailyElements.completionNotice.addEventListener("click", dailyHandleCompletionNoticeBackdropClick);
  dailyElements.resetButton.addEventListener("click", dailyResetSelection);
  dailyElements.loadMore.addEventListener("click", () => {
    dailyState.visibleLimit += dailyPageSize;
    dailyRenderCandidateTable();
  });
  dailyElements.share.addEventListener("click", dailyShare);
  dailyElements.abandon.addEventListener("click", dailyAbandonToday);
  const refreshOnReturn = () => {
    if (document.visibilityState === "visible") void dailyRefreshPersistedState();
  };
  document.addEventListener("visibilitychange", refreshOnReturn);
  window.addEventListener("focus", refreshOnReturn);
  window.addEventListener("pageshow", refreshOnReturn);
  window.addEventListener("scroll", () => {
    dailyElements.scrollTop.hidden = window.scrollY < 360;
  }, { passive: true });
  dailyElements.scrollTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
}

function dailyInitializeElements() {
  dailyElements.error = document.getElementById("dailyTargetError");
  dailyElements.loading = document.getElementById("dailyTargetLoading");
  dailyElements.missingDataMessage = document.getElementById("dailyTargetMissingDataMessage");
  dailyElements.panel = document.getElementById("dailyTargetPanel");
  dailyElements.selection = document.getElementById("dailyTargetSelection");
  dailyElements.locked = document.getElementById("dailyTargetLocked");
  dailyElements.selectedCount = document.getElementById("dailyTargetSelectedCount");
  dailyElements.selectedSongs = document.getElementById("dailyTargetSelectedSongs");
  dailyElements.selectedSongsList = document.getElementById("dailyTargetSelectedSongsList");
  dailyElements.autoFillButton = document.getElementById("dailyTargetAutoFillButton");
  dailyElements.manualAutoFillButton = document.getElementById("dailyTargetManualAutoFillButton");
  dailyElements.confirmButton = document.getElementById("dailyTargetConfirmButton");
  dailyElements.confirmNotice = document.getElementById("dailyTargetConfirmNotice");
  dailyElements.confirmNoticeClose = document.getElementById("dailyTargetConfirmNoticeClose");
  dailyElements.confirmNoticeShare = document.getElementById("dailyTargetConfirmNoticeShare");
  dailyElements.completionNotice = document.getElementById("dailyTargetCompletionNotice");
  dailyElements.completionNoticeClose = document.getElementById("dailyTargetCompletionNoticeClose");
  dailyElements.completionNoticeShare = document.getElementById("dailyTargetCompletionNoticeShare");
  dailyElements.resetButton = document.getElementById("dailyTargetResetButton");
  dailyElements.search = document.getElementById("dailyTargetSearch");
  dailyElements.statusMenu = document.getElementById("dailyTargetStatusFilterMenu");
  dailyElements.statusSummary = document.getElementById("dailyTargetStatusFilterSummary");
  dailyElements.levelMenu = document.getElementById("dailyTargetLevelFilterMenu");
  dailyElements.levelSummary = document.getElementById("dailyTargetLevelFilterSummary");
  dailyElements.difficultyMenu = document.getElementById("dailyTargetDifficultyFilterMenu");
  dailyElements.difficultySummary = document.getElementById("dailyTargetDifficultyFilterSummary");
  dailyElements.featureMenu = document.getElementById("dailyTargetFeatureFilterMenu");
  dailyElements.featureSummary = document.getElementById("dailyTargetFeatureFilterSummary");
  dailyElements.advancedSummary = document.getElementById("dailyTargetAdvancedFilterSummary");
  dailyElements.bpmMinInput = document.getElementById("dailyTargetBpmMinInput");
  dailyElements.bpmMaxInput = document.getElementById("dailyTargetBpmMaxInput");
  dailyElements.predMinInput = document.getElementById("dailyTargetPredMinInput");
  dailyElements.predMaxInput = document.getElementById("dailyTargetPredMaxInput");
  dailyElements.adjustedPredMinInput = document.getElementById("dailyTargetAdjustedPredMinInput");
  dailyElements.adjustedPredMaxInput = document.getElementById("dailyTargetAdjustedPredMaxInput");
  dailyElements.candidateCount = document.getElementById("dailyTargetCandidateCount");
  dailyElements.candidateBody = document.getElementById("dailyTargetCandidateBody");
  dailyElements.loadMore = document.getElementById("dailyTargetLoadMore");
  dailyElements.progress = document.getElementById("dailyTargetProgress");
  dailyElements.lockedBody = document.getElementById("dailyTargetLockedBody");
  dailyElements.share = document.getElementById("dailyTargetShare");
  dailyElements.abandon = document.getElementById("dailyTargetAbandon");
  dailyElements.scrollTop = document.getElementById("dailyTargetScrollTop");
}

async function dailyInitialize() {
  dailyInitializeElements();
  dailyState.recommendationSettings = dailyReadRecommendationSettings();
  dailySetLoading(true);
  dailyBindEvents();
  try {
    const bundledCsv = typeof window.__CSV_BUNDLE__ === "string" ? window.__CSV_BUNDLE__ : window.__CSV_BUNDLE__?.value;
    if (typeof bundledCsv !== "string" || bundledCsv.length === 0) throw new Error("譜面データを読み込めませんでした。");
    dailyState.rows = dailyNormalizeRows(dailyParseCsv(bundledCsv));
    dailyState.rowsById = new Map(dailyState.rows.map((row) => [row.chartId, row]));
    const predValues = dailyState.rows.map((row) => row.pred).filter(Number.isFinite);
    dailyState.predDataMin = predValues.length > 0 ? Math.min(...predValues) : 0;
    dailyState.predDataMax = predValues.length > 0 ? Math.max(...predValues) : 999;
    dailyState.predMinFilter = dailyState.predDataMin;
    dailyState.predMaxFilter = dailyState.predDataMax;
    dailyPopulateFilters();
    dailyRecalculateModel();
  } catch (error) {
    dailySetUnavailable(error instanceof Error ? error.message : "譜面データを読み込めませんでした。");
    return;
  }
  try {
    dailyState.database = await dailyOpenDatabase();
    await dailyCleanupOldTargets();
    const records = await dailyReadRecords();
    dailyState.records = new Map(records.map((record) => [String(record.chartId), record]));
    const manualMemos = await dailyReadManualMemos();
    dailyState.manualMemoIds = dailyBuildManualMemoIds(manualMemos);
    dailyState.today = await dailyReadToday(dailyGetDateKey());
    dailyRecalculateModel();
    dailySetLoading(false);
    dailyRender();
  } catch (error) {
    dailySetUnavailable(error instanceof Error ? error.message : "今日の10曲を読み込めませんでした。");
  }
}

document.addEventListener("DOMContentLoaded", dailyInitialize);
