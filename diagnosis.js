const diagnosisAptitudeOptions = [
  { value: "8-lower", label: "☆8下位", level: "8", percentile: 0.17 },
  { value: "8-middle", label: "☆8中位", level: "8", percentile: 0.5 },
  { value: "8-upper", label: "☆8上位", level: "8", percentile: 0.83 },
  { value: "9-lower", label: "☆9下位", level: "9", percentile: 0.17 },
  { value: "9-middle", label: "☆9中位", level: "9", percentile: 0.5 },
  { value: "9-upper", label: "☆9上位", level: "9", percentile: 0.83 },
  { value: "10-lower", label: "☆10下位", level: "10", percentile: 0.17 },
  { value: "10-middle", label: "☆10中位", level: "10", percentile: 0.5 },
  { value: "10-upper", label: "☆10上位", level: "10", percentile: 0.83 },
  { value: "11-lower", label: "☆11下位", level: "11", percentile: 0.17 },
  { value: "11-middle", label: "☆11中位", level: "11", percentile: 0.5 },
  { value: "11-upper", label: "☆11上位", level: "11", percentile: 0.83 },
  { value: "12-lower", label: "☆12下位", level: "12", percentile: 0.17 },
  { value: "12-middle", label: "☆12中位", level: "12", percentile: 0.5 },
  { value: "12-upper", label: "☆12上位", level: "12", percentile: 0.83 },
];

const diagnosisDifficultyLabels = {
  NORMAL: "N",
  HYPER: "H",
  ANOTHER: "A",
  LEGGENDARIA: "L",
};

const diagnosisFeatureOrder = [
  "特徴なし",
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

const diagnosisBatchSize = 10;
const diagnosisFeaturelessQuota = 8;
const diagnosisPredSpread = 1.5;
const diagnosisAdaptiveStep = 0.5;
const diagnosisMinimumRounds = 3;
const diagnosisEnoughKnownAnswers = 30;
const diagnosisMaximumRounds = 6;
const diagnosisSpreadOffsets = [-1.5, -1, -0.5, 0, 0.5, 1, 1.5];

const diagnosisState = {
  rows: [],
  selectedAptitude: null,
  selectedCharts: [],
  responses: new Map(),
  provisionalPred: null,
  round: 0,
  lastAdjustment: "",
};
const diagnosisEntityDecoder = document.createElement("textarea");

function diagnosisParseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inQuotes) {
      if (character === "\"" && text[index + 1] === "\"") {
        cell += "\"";
        index += 1;
      } else if (character === "\"") {
        inQuotes = false;
      } else {
        cell += character;
      }
      continue;
    }

    if (character === "\"") {
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
  if (rows.at(-1)?.length === 1 && rows.at(-1)[0] === "") {
    rows.pop();
  }
  return rows;
}

function diagnosisDecodeEntities(value) {
  diagnosisEntityDecoder.innerHTML = String(value ?? "");
  return diagnosisEntityDecoder.value;
}

function diagnosisNormalizeTitle(value) {
  const decoded = diagnosisDecodeEntities(value);
  const stripped = decoded.replace(/<\/?[A-Za-z][^>]*>/g, "");
  return diagnosisDecodeEntities(stripped);
}

function diagnosisEscapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function diagnosisFormatPred(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? (Math.round(numeric * 10) / 10).toFixed(1) : String(value ?? "");
}

function diagnosisFormatBpm(row) {
  const min = String(row.bpm_min ?? "").trim();
  const max = String(row.bpm_max ?? "").trim();
  return min && min === max ? min : `${min}~${max}`;
}

function diagnosisGetFeatureNames(row) {
  const raw = String(row.features ?? "").trim();
  if (!raw || raw === "特徴なし") {
    return ["特徴なし"];
  }
  return raw
    .split("、")
    .map((feature) => feature.trim().replace(/\++$/, ""))
    .filter(Boolean);
}

function diagnosisIsFeatureless(row) {
  const features = diagnosisGetFeatureNames(row);
  return features.length === 1 && features[0] === "特徴なし";
}
function diagnosisLoadRows() {
  const csvText = window.__CSV_BUNDLE__;
  if (typeof csvText !== "string") {
    throw new Error("データを読み込めませんでした。");
  }

  const parsed = diagnosisParseCsv(csvText);
  const headers = parsed.shift().map((header) => header.trim());
  const headerIndex = new Map(headers.map((header, index) => [header, index]));
  const requiredHeaders = [
    "chart_id",
    "title",
    "difficulty",
    "original_level",
    "calibrated_pred_skill",
    "features",
    "bpm_min",
    "bpm_max",
  ];

  for (const header of requiredHeaders) {
    if (!headerIndex.has(header)) {
      throw new Error(`必要な列がありません: ${header}`);
    }
  }

  return parsed.map((cells) => ({
    chart_id: (cells[headerIndex.get("chart_id")] ?? "").trim(),
    title: diagnosisNormalizeTitle((cells[headerIndex.get("title")] ?? "").trim()),
    difficulty: (cells[headerIndex.get("difficulty")] ?? "").trim().toUpperCase(),
    original_level: (cells[headerIndex.get("original_level")] ?? "").trim(),
    calibrated_pred_skill: (cells[headerIndex.get("calibrated_pred_skill")] ?? "").trim(),
    features: (cells[headerIndex.get("features")] ?? "").trim(),
    bpm_min: (cells[headerIndex.get("bpm_min")] ?? "").trim(),
    bpm_max: (cells[headerIndex.get("bpm_max")] ?? "").trim(),
  }));
}

function diagnosisPredNumber(row) {
  const value = Number(row.calibrated_pred_skill);
  return Number.isFinite(value) ? value : null;
}

function diagnosisRowKey(row) {
  return row.chart_id || row.title + "|" + row.difficulty + "|" + row.original_level;
}

function diagnosisSortRows(left, right) {
  const predDifference = diagnosisPredNumber(left) - diagnosisPredNumber(right);
  return predDifference || left.title.localeCompare(right.title, "ja");
}

function diagnosisGetAptitudeRows(option) {
  return diagnosisState.rows
    .filter((row) => row.original_level === option.level)
    .filter((row) => diagnosisPredNumber(row) !== null)
    .sort(diagnosisSortRows);
}

function diagnosisGetCandidateRows(excludeAnswered = false) {
  return diagnosisState.rows
    .filter((row) => diagnosisPredNumber(row) !== null)
    .filter((row) => !excludeAnswered || !diagnosisState.responses.has(diagnosisRowKey(row)))
    .sort(diagnosisSortRows);
}

function diagnosisGetLevelBounds() {
  const rows = diagnosisGetCandidateRows();
  if (!rows.length) {
    return { min: 0, max: 999 };
  }
  return {
    min: diagnosisPredNumber(rows[0]),
    max: diagnosisPredNumber(rows.at(-1)),
  };
}

function diagnosisClampPred(value) {
  const bounds = diagnosisGetLevelBounds();
  return Math.min(bounds.max, Math.max(bounds.min, value));
}

function diagnosisInitialPred(option) {
  const rows = diagnosisGetAptitudeRows(option);
  if (!rows.length) {
    return null;
  }
  const targetIndex = Math.round((rows.length - 1) * option.percentile);
  return diagnosisPredNumber(rows[targetIndex]);
}
function diagnosisClosestRow(pool, target, selectedIds) {
  return pool
    .filter((row) => !selectedIds.has(diagnosisRowKey(row)))
    .sort((left, right) => {
      const distance = Math.abs(diagnosisPredNumber(left) - target) - Math.abs(diagnosisPredNumber(right) - target);
      return distance || diagnosisSortRows(left, right);
    })[0] ?? null;
}

function diagnosisSelectCharts(option, provisionalPred) {
  const rows = diagnosisGetCandidateRows(true);
  const featurelessRows = rows.filter(diagnosisIsFeatureless);
  const featuredRows = rows.filter((row) => !diagnosisIsFeatureless(row));
  const selected = [];
  const selectedIds = new Set();
  const center = Number.isFinite(provisionalPred) ? provisionalPred : diagnosisInitialPred(option);
  const targets = diagnosisSpreadOffsets.map((offset) => center + offset);

  function addRow(row) {
    if (!row || selected.length >= diagnosisBatchSize) {
      return;
    }
    const key = diagnosisRowKey(row);
    if (selectedIds.has(key)) {
      return;
    }
    selected.push(row);
    selectedIds.add(key);
  }

  // Sample the full +/-1.5 band first, with featureless charts as the baseline.
  for (const target of targets) {
    addRow(diagnosisClosestRow(featurelessRows, target, selectedIds));
  }

  while (selected.length < Math.min(diagnosisFeaturelessQuota, diagnosisBatchSize)) {
    addRow(diagnosisClosestRow(featurelessRows, center, selectedIds));
    if (!featurelessRows.some((row) => !selectedIds.has(diagnosisRowKey(row)))) {
      break;
    }
  }

  // Keep a small number of featured charts so later feature tendencies remain observable.
  for (let index = 0; index < diagnosisFeatureOrder.length; index += 1) {
    if (selected.length >= diagnosisBatchSize) {
      break;
    }
    const feature = diagnosisFeatureOrder[index];
    if (feature === "特徴なし") {
      continue;
    }
    const target = targets[index % targets.length];
    addRow(diagnosisClosestRow(
      featuredRows.filter((row) => diagnosisGetFeatureNames(row).includes(feature)),
      target,
      selectedIds,
    ));
  }

  // Fill the remainder while preserving the spread around the provisional Pred.
  while (selected.length < diagnosisBatchSize) {
    const candidate = rows
      .filter((row) => !selectedIds.has(diagnosisRowKey(row)))
      .sort((left, right) => {
        const leftDistance = Math.min(...targets.map((target) => Math.abs(diagnosisPredNumber(left) - target)));
        const rightDistance = Math.min(...targets.map((target) => Math.abs(diagnosisPredNumber(right) - target)));
        return leftDistance - rightDistance || diagnosisSortRows(left, right);
      })[0];
    if (!candidate) {
      break;
    }
    addRow(candidate);
  }

  return selected.sort(diagnosisSortRows);
}
function diagnosisRenderAptitudeOptions() {
  const container = document.getElementById("aptitudeOptions");
  const groups = new Map();
  for (const option of diagnosisAptitudeOptions) {
    if (!groups.has(option.level)) {
      groups.set(option.level, []);
    }
    groups.get(option.level).push(option);
  }

  container.innerHTML = [...groups.values()].map((options) => (
    "<div class=\"diagnosis-aptitude-group\">" +
      options.map((option) => (
        "<div class=\"diagnosis-aptitude-option\">" +
          "<input id=\"aptitude-" + option.value + "\" type=\"radio\" name=\"aptitude\" value=\"" + option.value + "\">" +
          "<label for=\"aptitude-" + option.value + "\">" + diagnosisEscapeHtml(option.label) + "</label>" +
        "</div>"
      )).join("") +
    "</div>"
  )).join("");

  container.addEventListener("change", (event) => {
    if (event.target.name === "aptitude") {
      diagnosisState.selectedAptitude = diagnosisAptitudeOptions.find((option) => option.value === event.target.value) ?? null;
      document.getElementById("levelNextButton").disabled = !diagnosisState.selectedAptitude;
    }
  });
}
function diagnosisRenderQuestions() {
  const container = document.getElementById("diagnosisChartQuestions");
  container.innerHTML = diagnosisState.selectedCharts.map((row, index) => {
    const difficulty = diagnosisDifficultyLabels[row.difficulty] ?? row.difficulty;
    const title = "☆" + row.original_level + " " + row.title + (difficulty ? " [" + difficulty + "]" : "");
    return [
      "<article class=\"diagnosis-chart\">",
      "  <div class=\"diagnosis-chart__heading\">",
      "    <div class=\"diagnosis-chart__title\">" + diagnosisEscapeHtml(title) + "</div>",
      "  </div>",
      "  <fieldset class=\"diagnosis-status\">",
      "    <legend class=\"sr-only\">" + diagnosisEscapeHtml(title) + "のクリア状況</legend>",
      "    <div class=\"diagnosis-status-option\"><input id=\"diagnosis-status-" + index + "-clear\" data-diagnosis-question=\"" + index + "\" type=\"radio\" name=\"diagnosis-status-" + index + "\" value=\"clear\"><label for=\"diagnosis-status-" + index + "-clear\">クリア</label></div>",
      "    <div class=\"diagnosis-status-option\"><input id=\"diagnosis-status-" + index + "-not-clear\" data-diagnosis-question=\"" + index + "\" type=\"radio\" name=\"diagnosis-status-" + index + "\" value=\"not-clear\"><label for=\"diagnosis-status-" + index + "-not-clear\">未クリア</label></div>",
      "  </fieldset>",
      "</article>",
    ].join("");
  }).join("");
  diagnosisUpdateProgress();
}
function diagnosisGetCurrentStatuses() {
  return diagnosisState.selectedCharts.map((row, index) => ({
    row,
    status: document.querySelector("input[data-diagnosis-question=\"" + index + "\"]:checked")?.value ?? null,
  }));
}

function diagnosisGetKnownObservations() {
  const rowByKey = new Map(diagnosisState.rows.map((row) => [diagnosisRowKey(row), row]));
  return [...diagnosisState.responses.entries()]
    .filter(([, status]) => status === "clear" || status === "not-clear")
    .map(([key, status]) => ({ row: rowByKey.get(key), status }))
    .filter((observation) => observation.row && diagnosisPredNumber(observation.row) !== null);
}
function diagnosisGetKnownCounts(option = diagnosisState.selectedAptitude) {
  const observations = diagnosisGetKnownObservations(option);
  return {
    total: observations.length,
    clear: observations.filter(({ status }) => status === "clear").length,
    notClear: observations.filter(({ status }) => status === "not-clear").length,
  };
}

function diagnosisUpdateProgress() {
  const counts = diagnosisGetKnownCounts();
  document.getElementById("diagnosisProgress").textContent =
    "有効回答" + counts.total + "件 / およそ" + diagnosisEnoughKnownAnswers + "件集まると診断に進みます";
}
function diagnosisShowError(message) {
  const error = document.getElementById("diagnosisError");
  error.textContent = message;
  error.hidden = false;
}
function diagnosisShowChartStep() {
  const option = diagnosisState.selectedAptitude;
  diagnosisState.provisionalPred = diagnosisInitialPred(option);
  diagnosisState.responses = new Map();
  diagnosisState.round = 0;
  diagnosisState.lastAdjustment = "";
  diagnosisState.selectedCharts = diagnosisSelectCharts(option, diagnosisState.provisionalPred);
  if (!Number.isFinite(diagnosisState.provisionalPred) || diagnosisState.selectedCharts.length === 0) {
    diagnosisShowError("この適正レベルの譜面を選べませんでした。");
    return;
  }

  document.getElementById("diagnosisError").hidden = true;
  diagnosisRenderQuestions();
  document.getElementById("diagnosisLevelStep").hidden = true;
  document.getElementById("diagnosisResultStep").hidden = true;
  document.getElementById("diagnosisChartStep").hidden = false;
  document.getElementById("diagnosisChartTitle").focus();
}

function diagnosisShowLevelStep() {
  document.getElementById("diagnosisChartStep").hidden = true;
  document.getElementById("diagnosisResultStep").hidden = true;
  document.getElementById("diagnosisLevelStep").hidden = false;
  document.getElementById("diagnosisError").hidden = true;
  document.getElementById("diagnosisLevelTitle").focus();
}

function diagnosisSigmoid(value) {
  if (value >= 0) {
    return 1 / (1 + Math.exp(-value));
  }
  const exponential = Math.exp(value);
  return exponential / (1 + exponential);
}

function diagnosisFormatPredRange(lower, upper) {
  const lowerText = diagnosisFormatPred(lower);
  const upperText = diagnosisFormatPred(upper);
  return lowerText === upperText ? lowerText : lowerText + "-" + upperText;
}

function diagnosisFitLogisticRegression(option) {
  const observations = diagnosisGetKnownObservations(option);
  const counts = diagnosisGetKnownCounts(option);
  if (observations.length < 6 || counts.clear === 0 || counts.notClear === 0) {
    return {
      pred: diagnosisState.provisionalPred,
      range: diagnosisFormatPred(diagnosisState.provisionalPred),
      model: null,
      usedLogistic: false,
      observations,
      counts,
    };
  }

  const xValues = observations.map(({ row }) => diagnosisPredNumber(row));
  const center = xValues.reduce((sum, value) => sum + value, 0) / xValues.length;
  const variance = xValues.reduce((sum, value) => sum + (value - center) ** 2, 0) / xValues.length;
  const scale = Math.max(Math.sqrt(variance), 0.25);
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
      const normalizedPred = (diagnosisPredNumber(observation.row) - center) / scale;
      const outcome = observation.status === "clear" ? 1 : 0;
      const probability = diagnosisSigmoid(intercept + slope * normalizedPred);
      const weight = Math.max(probability * (1 - probability), 1e-5);
      const residual = probability - outcome;
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

  // Clear probability should decrease as Pred rises. Keep that domain constraint
  // when a small sample produces an inverted or nearly flat fit.
  slope = Math.min(-0.05, slope);
  const bounds = diagnosisGetLevelBounds();
  const threshold = center + (-intercept / slope) * scale;
  const predAt60 = center + (Math.log(0.6 / 0.4) - intercept) / slope * scale;
  const predAt40 = center + (Math.log(0.4 / 0.6) - intercept) / slope * scale;
  const rangeValues = [predAt60, predAt40];
  const hasValidRange = rangeValues.every(Number.isFinite);
  const lower = hasValidRange
    ? Math.min(bounds.max, Math.max(bounds.min, Math.min(...rangeValues)))
    : diagnosisState.provisionalPred;
  const upper = hasValidRange
    ? Math.min(bounds.max, Math.max(bounds.min, Math.max(...rangeValues)))
    : diagnosisState.provisionalPred;
  const pred = Number.isFinite(threshold)
    ? Math.min(bounds.max, Math.max(bounds.min, threshold))
    : diagnosisState.provisionalPred;

  return {
    pred,
    range: hasValidRange ? diagnosisFormatPredRange(lower, upper) : diagnosisFormatPred(pred),
    model: Number.isFinite(threshold) && hasValidRange
      ? { intercept, slope, center, scale }
      : null,
    usedLogistic: Number.isFinite(threshold) && hasValidRange,
    observations,
    counts,
  };
}
function diagnosisShouldFinish() {
  const counts = diagnosisGetKnownCounts();
  return (diagnosisState.round >= diagnosisMinimumRounds && counts.total >= diagnosisEnoughKnownAnswers)
    || diagnosisState.round >= diagnosisMaximumRounds;
}

function diagnosisBuildLevelClearRateText(model) {
  if (!model) {
    return "";
  }

  const messages = [];
  for (const level of ["8", "9", "10", "11", "12"]) {
    const rows = diagnosisState.rows
      .filter((row) => row.original_level === level)
      .filter((row) => diagnosisPredNumber(row) !== null);

    if (!rows.length) {
      continue;
    }

    const averageProbability = rows.reduce((sum, row) => {
      const normalizedPred = (diagnosisPredNumber(row) - model.center) / model.scale;
      return sum + diagnosisSigmoid(model.intercept + model.slope * normalizedPred);
    }, 0) / rows.length;
    const roundedPercent = Math.round(averageProbability * 100);

    if (roundedPercent <= 0) {
      continue;
    }

    const resultText = roundedPercent >= 100
      ? "ほぼ全て"
      : "約" + roundedPercent + "%";
    messages.push("☆" + level + "が" + resultText);
  }

  return messages.length > 0
    ? messages.join("、") + "クリアできる水準です。"
    : "";
}

function diagnosisShowResult() {
  const result = diagnosisFitLogisticRegression(diagnosisState.selectedAptitude);
  const counts = result.counts;
  const unknown = diagnosisState.responses.size - counts.total;
  const levelRates = document.getElementById("diagnosisLevelClearRates");
  const levelRateText = result.usedLogistic
    ? diagnosisBuildLevelClearRateText(result.model)
    : "";

  document.getElementById("diagnosisResultPred").textContent = result.range;
  document.getElementById("diagnosisResultMethod").textContent = result.usedLogistic
    ? "クリア確率40%-60%のPred幅（ロジスティック回帰）"
    : "有効回答が少ないため、暫定Predを表示";
  levelRates.textContent = levelRateText;
  levelRates.hidden = !levelRateText;
  document.getElementById("diagnosisResultSummary").textContent =
    counts.clear + "件クリア / " + counts.notClear + "件未クリア / " + unknown + "件未プレイ・不明（" + diagnosisState.responses.size + "譜面）";
  document.getElementById("diagnosisChartStep").hidden = true;
  document.getElementById("diagnosisLevelStep").hidden = true;
  document.getElementById("diagnosisResultStep").hidden = false;
  document.getElementById("diagnosisResultTitle").focus();
}
function diagnosisSubmitBatch() {
  const statuses = diagnosisGetCurrentStatuses();

  for (const { row, status } of statuses) {
    diagnosisState.responses.set(diagnosisRowKey(row), status ?? "unknown");
  }

  const batchClear = statuses.filter(({ status }) => status === "clear").length;
  const batchNotClear = statuses.filter(({ status }) => status === "not-clear").length;
  const previousPred = diagnosisState.provisionalPred;
  if (batchClear > batchNotClear) {
    diagnosisState.provisionalPred = diagnosisClampPred(previousPred + diagnosisAdaptiveStep);
    diagnosisState.lastAdjustment = "クリア優勢のため暫定Predを" + diagnosisFormatPred(diagnosisState.provisionalPred) + "へ上げました。";
  } else if (batchNotClear > batchClear) {
    diagnosisState.provisionalPred = diagnosisClampPred(previousPred - diagnosisAdaptiveStep);
    diagnosisState.lastAdjustment = "未クリア優勢のため暫定Predを" + diagnosisFormatPred(diagnosisState.provisionalPred) + "へ下げました。";
  } else {
    diagnosisState.lastAdjustment = "クリアと未クリアが同数のため暫定Predは据え置きです。";
  }
  diagnosisState.round += 1;

  if (diagnosisShouldFinish()) {
    diagnosisShowResult();
    return;
  }

  diagnosisState.selectedCharts = diagnosisSelectCharts(
    diagnosisState.selectedAptitude,
    diagnosisState.provisionalPred,
  );
  if (diagnosisState.selectedCharts.length === 0) {
    diagnosisShowResult();
    return;
  }

  document.getElementById("diagnosisError").hidden = true;
  diagnosisRenderQuestions();
  document.getElementById("diagnosisChartTitle").focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function diagnosisReset() {
  diagnosisState.selectedAptitude = null;
  diagnosisState.selectedCharts = [];
  diagnosisState.responses = new Map();
  diagnosisState.provisionalPred = null;
  diagnosisState.round = 0;
  diagnosisState.lastAdjustment = "";
  document.getElementById("diagnosisForm").reset();
  document.getElementById("levelNextButton").disabled = true;
  document.getElementById("diagnosisChartQuestions").innerHTML = "";
  diagnosisShowLevelStep();
}

function diagnosisInit() {
  try {
    diagnosisState.rows = diagnosisLoadRows();
    diagnosisRenderAptitudeOptions();
    document.getElementById("levelNextButton").addEventListener("click", diagnosisShowChartStep);
    document.getElementById("diagnosisSubmitButton").addEventListener("click", diagnosisSubmitBatch);
    document.getElementById("diagnosisBackButton").addEventListener("click", diagnosisShowLevelStep);
    document.getElementById("diagnosisResetButton").addEventListener("click", diagnosisReset);
    document.getElementById("diagnosisResultResetButton").addEventListener("click", diagnosisReset);
    document.getElementById("diagnosisChartQuestions").addEventListener("change", diagnosisUpdateProgress);
  } catch (error) {
    console.error(error);
    diagnosisShowError(error.message || "診断ページを読み込めませんでした。");
  }
}

document.addEventListener("DOMContentLoaded", diagnosisInit);
