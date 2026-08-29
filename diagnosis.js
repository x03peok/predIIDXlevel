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
const diagnosisFeatureMinimumAnswers = 10;
const diagnosisFeatureEnoughAnswers = 50;
const diagnosisFeatureMaximumRounds = 10;
const diagnosisSpreadOffsets = [-1.5, -1, -0.5, 0, 0.5, 1, 1.5];
const diagnosisFeatureNames = diagnosisFeatureOrder.filter((feature) => feature !== "特徴なし");

const diagnosisFeatureDescriptions = {
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
const diagnosisState = {
  rows: [],
  selectedAptitude: null,
  selectedCharts: [],
  responses: new Map(),
  seenChartIds: new Set(),
  provisionalPred: null,
  round: 0,
  lastAdjustment: "",
  predModel: null,
  featureSelectedCharts: [],
  featureResponses: new Map(),
  featureRound: 0,
  featurePredCenter: null,
};const diagnosisEntityDecoder = document.createElement("textarea");

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

function diagnosisGetNumericScaleColor(value, scaleMin, scaleMax) {
  const numeric = Number(value);
  const min = Number(scaleMin);
  const max = Number(scaleMax);
  if (!Number.isFinite(numeric) || !Number.isFinite(min) || !Number.isFinite(max)) {
    return "";
  }

  const position = max > min
    ? Math.min(1, Math.max(0, (numeric - min) / (max - min)))
    : 0.5;
  const yellowPosition = max > min
    ? Math.min(0.45, Math.max(0.1, (9 - min) / (max - min)))
    : 0.25;
  const stops = [
    { position: 0, hue: 221, saturation: 83, lightness: 53 },
    { position: yellowPosition, hue: 48, saturation: 92, lightness: 40 },
    { position: 0.5, hue: 0, saturation: 80, lightness: 50 },
    { position: 1, hue: 262, saturation: 72, lightness: 55 },
  ];
  let start = stops[0];
  let end = stops[stops.length - 1];
  for (let index = 1; index < stops.length; index += 1) {
    if (position <= stops[index].position) {
      start = stops[index - 1];
      end = stops[index];
      break;
    }
  }
  const localPosition = end.position > start.position
    ? (position - start.position) / (end.position - start.position)
    : 0;
  const hueDelta = ((end.hue - start.hue + 540) % 360) - 180;
  const hue = (start.hue + hueDelta * localPosition + 360) % 360;
  const saturation = start.saturation + (end.saturation - start.saturation) * localPosition;
  const lightness = start.lightness + (end.lightness - start.lightness) * localPosition;
  return diagnosisHslToRgbString(hue, saturation, lightness);
}

function diagnosisHslToRgbString(hue, saturation, lightness) {
  const normalizedHue = ((hue % 360) + 360) % 360;
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const sector = normalizedHue / 60;
  const x = chroma * (1 - Math.abs((sector % 2) - 1));
  const rgb = sector < 1 ? [chroma, x, 0]
    : sector < 2 ? [x, chroma, 0]
      : sector < 3 ? [0, chroma, x]
        : sector < 4 ? [0, x, chroma]
          : sector < 5 ? [x, 0, chroma]
            : [chroma, 0, x];
  const match = l - chroma / 2;
  return "rgb(" + rgb.map((channel) => Math.round((channel + match) * 255)).join(", ") + ")";
}
function diagnosisFormatBpm(row) {
  const min = String(row.bpm_min ?? "").trim();
  const max = String(row.bpm_max ?? "").trim();
  return min && min === max ? min : `${min}~${max}`;
}

function diagnosisGetFeatureDetails(row) {
  const raw = String(row.features ?? "").trim();
  if (!raw || raw === "特徴なし") {
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

function diagnosisGetFeatureNames(row) {
  const details = diagnosisGetFeatureDetails(row);
  return details.length ? details.map(({ name }) => name) : ["特徴なし"];
}

function diagnosisIsFeatureless(row) {
  return diagnosisGetFeatureDetails(row).length === 0;
}function diagnosisLoadRows() {
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

function diagnosisGetCandidateRows(excludeSeen = false) {
  return diagnosisState.rows
    .filter((row) => diagnosisPredNumber(row) !== null)
    .filter((row) => !excludeSeen || !diagnosisState.seenChartIds.has(diagnosisRowKey(row)))
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

  const sorted = selected.sort(diagnosisSortRows);
  for (const row of sorted) {
    diagnosisState.seenChartIds.add(diagnosisRowKey(row));
  }
  return sorted;
}
function diagnosisGetFeatureStrength(row, feature) {
  return diagnosisGetFeatureDetails(row)
    .filter((detail) => detail.name === feature)
    .reduce((maximum, detail) => Math.max(maximum, detail.plusCount), 0);
}

function diagnosisGetRowFeatureStrength(row) {
  return diagnosisGetFeatureDetails(row)
    .reduce((maximum, detail) => Math.max(maximum, detail.plusCount), 0);
}
function diagnosisGetFeatureKnownCount(feature) {
  return diagnosisGetKnownFeatureObservations()
    .filter(({ row }) => diagnosisGetFeatureDetails(row).some((detail) => detail.name === feature))
    .length;
}

function diagnosisSelectFeatureCharts() {
  const rows = diagnosisGetCandidateRows(true)
    .filter((row) => diagnosisGetFeatureDetails(row).length > 0);
  const selected = [];
  const selectedIds = new Set();
  const center = Number.isFinite(diagnosisState.featurePredCenter)
    ? diagnosisState.featurePredCenter
    : diagnosisState.provisionalPred;
  const targets = diagnosisSpreadOffsets.map((offset) => center + offset);
  const featureKnownCounts = new Map(
    diagnosisFeatureNames.map((feature) => [feature, diagnosisGetFeatureKnownCount(feature)]),
  );
  const featuresByNeed = [...diagnosisFeatureNames].sort((left, right) => (
    featureKnownCounts.get(left) - featureKnownCounts.get(right)
      || diagnosisFeatureNames.indexOf(left) - diagnosisFeatureNames.indexOf(right)
  ));

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

  // Give every named feature a chance to appear, preferring ++ and + charts.
  for (let index = 0; index < featuresByNeed.length; index += 1) {
    if (selected.length >= diagnosisBatchSize) {
      break;
    }
    const feature = featuresByNeed[index];
    const target = targets[index % targets.length];
    const candidate = rows
      .filter((row) => !selectedIds.has(diagnosisRowKey(row)))
      .filter((row) => diagnosisGetFeatureStrength(row, feature) > 0)
      .sort((left, right) => {
        const strengthDifference = diagnosisGetFeatureStrength(right, feature)
          - diagnosisGetFeatureStrength(left, feature);
        const distanceDifference = Math.abs(diagnosisPredNumber(left) - target)
          - Math.abs(diagnosisPredNumber(right) - target);
        return strengthDifference || distanceDifference || diagnosisSortRows(left, right);
      })[0];
    addRow(candidate);
  }

  // Fill the batch with the strongest remaining feature charts near the Pred.
  while (selected.length < diagnosisBatchSize) {
    const candidate = rows
      .filter((row) => !selectedIds.has(diagnosisRowKey(row)))
      .sort((left, right) => {
        const leftNeed = Math.min(...diagnosisGetFeatureDetails(left)
          .map((detail) => featureKnownCounts.get(detail.name) ?? Infinity));
        const rightNeed = Math.min(...diagnosisGetFeatureDetails(right)
          .map((detail) => featureKnownCounts.get(detail.name) ?? Infinity));
        const strengthDifference = diagnosisGetRowFeatureStrength(right)
          - diagnosisGetRowFeatureStrength(left);
        const leftDistance = Math.min(...targets.map((target) => Math.abs(diagnosisPredNumber(left) - target)));
        const rightDistance = Math.min(...targets.map((target) => Math.abs(diagnosisPredNumber(right) - target)));
        return leftNeed - rightNeed
          || strengthDifference
          || leftDistance - rightDistance
          || diagnosisSortRows(left, right);
      })[0];
    if (!candidate) {
      break;
    }
    addRow(candidate);
  }

  const sorted = selected.sort(diagnosisSortRows);
  for (const row of sorted) {
    diagnosisState.seenChartIds.add(diagnosisRowKey(row));
  }
  return sorted;
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
function diagnosisRenderFeatureQuestions() {
  const container = document.getElementById("diagnosisFeatureQuestions");
  container.innerHTML = diagnosisState.featureSelectedCharts.map((row, index) => {
    const difficulty = diagnosisDifficultyLabels[row.difficulty] ?? row.difficulty;
    const title = "☆" + row.original_level + " " + row.title + (difficulty ? " [" + difficulty + "]" : "");
    return [
      '<article class="diagnosis-chart">',
      '  <div class="diagnosis-chart__heading">',
      '    <div class="diagnosis-chart__title">' + diagnosisEscapeHtml(title) + '</div>',
      '  </div>',
      '  <fieldset class="diagnosis-status">',
      '    <legend class="sr-only">' + diagnosisEscapeHtml(title) + 'のクリア状況</legend>',
      '    <div class="diagnosis-status-option"><input id="diagnosis-feature-status-' + index + '-clear" data-diagnosis-feature-question="' + index + '" type="radio" name="diagnosis-feature-status-' + index + '" value="clear"><label for="diagnosis-feature-status-' + index + '-clear">クリア</label></div>',
      '    <div class="diagnosis-status-option"><input id="diagnosis-feature-status-' + index + '-not-clear" data-diagnosis-feature-question="' + index + '" type="radio" name="diagnosis-feature-status-' + index + '" value="not-clear"><label for="diagnosis-feature-status-' + index + '-not-clear">未クリア</label></div>',
      '  </fieldset>',
      '</article>',
    ].join("");
  }).join("");
  diagnosisUpdateFeatureProgress();
}

function diagnosisGetCurrentFeatureStatuses() {
  return diagnosisState.featureSelectedCharts.map((row, index) => ({
    row,
    status: document.querySelector('input[data-diagnosis-feature-question="' + index + '"]:checked')?.value ?? null,
  }));
}
function diagnosisGetKnownFeatureObservations() {
  const rowByKey = new Map(diagnosisState.rows.map((row) => [diagnosisRowKey(row), row]));
  return [...diagnosisState.featureResponses.entries()]
    .filter(([, status]) => status === "clear" || status === "not-clear")
    .map(([key, status]) => ({ row: rowByKey.get(key), status }))
    .filter((observation) => observation.row && diagnosisPredNumber(observation.row) !== null);
}

function diagnosisGetProgressPercent(rounds, knownCount, maximumRounds, enoughAnswers) {
  const roundProgress = Math.min(1, Math.max(0, rounds / maximumRounds));
  const answerProgress = Math.min(1, Math.max(0, knownCount / enoughAnswers));
  return Math.round(Math.max(roundProgress, answerProgress) * 100);
}

function diagnosisUpdateProgressBar(elementId, rounds, knownCount, maximumRounds, enoughAnswers) {
  const progressBar = document.getElementById(elementId);
  if (!progressBar) {
    return;
  }

  const percent = diagnosisGetProgressPercent(
    rounds,
    knownCount,
    maximumRounds,
    enoughAnswers,
  );
  progressBar.style.setProperty("--progress", percent + "%");
  progressBar.setAttribute("aria-valuenow", String(percent));
  progressBar.setAttribute("aria-valuetext", percent + "%");
}
function diagnosisUpdateFeatureProgress() {
  const count = diagnosisGetKnownFeatureObservations().length;
  diagnosisUpdateProgressBar(
    "diagnosisFeatureProgressBar",
    diagnosisState.featureRound,
    count,
    diagnosisFeatureMaximumRounds,
    diagnosisFeatureEnoughAnswers,
  );
  document.getElementById("diagnosisFeatureProgress").textContent =
    "有効回答" + count + "件 / 最大" + diagnosisFeatureMaximumRounds + "回または"
      + diagnosisFeatureEnoughAnswers + "件で診断します";
}

function diagnosisFeatureShouldFinish() {
  const count = diagnosisGetKnownFeatureObservations().length;
  return count >= diagnosisFeatureEnoughAnswers
    || diagnosisState.featureRound >= diagnosisFeatureMaximumRounds;
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
  diagnosisUpdateProgressBar(
    "diagnosisProgressBar",
    diagnosisState.round,
    counts.total,
    diagnosisMaximumRounds,
    diagnosisEnoughKnownAnswers,
  );
  document.getElementById("diagnosisProgress").textContent =
    "有効回答" + counts.total + "件 / およそ" + diagnosisEnoughKnownAnswers + "件集まると診断に進みます";
}
function diagnosisBindStatusDeselect(container, selector, update) {
  const resolveInput = (event) => (
    event.target.closest?.(selector)
      ?? event.target.closest?.("label")?.control
  );
  let pendingDeselect = null;

  container.addEventListener("pointerdown", (event) => {
    const input = resolveInput(event);
    pendingDeselect = input?.checked ? input : null;
  });

  container.addEventListener("pointercancel", () => {
    pendingDeselect = null;
  });

  container.addEventListener("click", (event) => {
    const input = resolveInput(event);
    if (!input || pendingDeselect !== input) {
      pendingDeselect = null;
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    input.checked = false;
    pendingDeselect = null;
    update();
  });

  container.addEventListener("keydown", (event) => {
    if (event.key !== " " && event.key !== "Spacebar") {
      return;
    }
    const input = resolveInput(event);
    if (!input || !input.checked) {
      return;
    }
    event.preventDefault();
    input.checked = false;
    update();
  });
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
  diagnosisState.seenChartIds = new Set();
  diagnosisState.round = 0;
  diagnosisState.lastAdjustment = "";
  diagnosisState.predModel = null;
  diagnosisState.featureSelectedCharts = [];
  diagnosisState.featureResponses = new Map();
  diagnosisState.featureRound = 0;
  diagnosisState.featurePredCenter = null;
  diagnosisState.selectedCharts = diagnosisSelectCharts(option, diagnosisState.provisionalPred);
  if (!Number.isFinite(diagnosisState.provisionalPred) || diagnosisState.selectedCharts.length === 0) {
    diagnosisShowError("この適正レベルの譜面を選べませんでした。");
    return;
  }

  document.getElementById("diagnosisError").hidden = true;
  diagnosisRenderQuestions();
  document.getElementById("diagnosisLevelStep").hidden = true;
  document.getElementById("diagnosisResultStep").hidden = true;
  document.getElementById("diagnosisFeatureStep").hidden = true;
  document.getElementById("diagnosisFeatureResultStep").hidden = true;
  document.getElementById("diagnosisChartStep").hidden = false;
  document.getElementById("diagnosisChartTitle").focus();
}
function diagnosisShowLevelStep() {
  document.getElementById("diagnosisChartStep").hidden = true;
  document.getElementById("diagnosisResultStep").hidden = true;
  document.getElementById("diagnosisFeatureStep").hidden = true;
  document.getElementById("diagnosisFeatureResultStep").hidden = true;
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

function diagnosisRenderResultPred(element, result, bounds) {
  element.textContent = "";
  if (!Number.isFinite(result.rangeLower)) {
    element.textContent = result.range || "ー";
    return;
  }

  const appendValue = (value) => {
    const valueElement = document.createElement("span");
    valueElement.className = "diagnosis-result-pred__value";
    valueElement.textContent = diagnosisFormatPred(value);
    const color = diagnosisGetNumericScaleColor(value, bounds.min, bounds.max);
    if (color) {
      valueElement.style.setProperty("--numeric-color", color);
    }
    element.append(valueElement);
  };

  appendValue(result.rangeLower);
  if (Number.isFinite(result.rangeUpper) && result.rangeUpper !== result.rangeLower) {
    const separator = document.createElement("span");
    separator.className = "diagnosis-result-pred__separator";
    separator.textContent = "-";
    element.append(separator);
    appendValue(result.rangeUpper);
  }
  if (result.rangeQualifier) {
    element.append(document.createTextNode(result.rangeQualifier));
  }
}
function diagnosisBuildInsufficientResult(observations, counts) {
  return {
    pred: null,
    range: "ー",
    rangeLower: null,
    rangeUpper: null,
    rangeQualifier: "",
    fallbackMessage: "プレイ曲数不足により推定できませんでした",
    model: null,
    usedLogistic: false,
    observations,
    counts,
  };
}
function diagnosisBuildFallbackResult(observations, counts) {
  if (counts.total < 6) {
    return diagnosisBuildInsufficientResult(observations, counts);
  }

  if (counts.clear === 0) {
    const provisionalPred = diagnosisFormatPred(diagnosisState.provisionalPred);
    return {
      pred: diagnosisState.provisionalPred,
      range: provisionalPred + "未満",
      rangeLower: diagnosisState.provisionalPred,
      rangeUpper: null,
      rangeQualifier: "未満",
      fallbackMessage: "クリア曲数不足により推定できませんでした",
      model: null,
      usedLogistic: false,
      observations,
      counts,
    };
  }

  if (counts.notClear === 0) {
    const provisionalPred = diagnosisFormatPred(diagnosisState.provisionalPred);
    return {
      pred: diagnosisState.provisionalPred,
      range: provisionalPred + "以上",
      rangeLower: diagnosisState.provisionalPred,
      rangeUpper: null,
      rangeQualifier: "以上",
      fallbackMessage: diagnosisState.provisionalPred < 13
        ? "プレイ曲数不足により推定できませんでした"
        : "当サイトではこれ以上のクリア力を推定できません",
      model: null,
      usedLogistic: false,
      observations,
      counts,
    };
  }

  return {
    pred: diagnosisState.provisionalPred,
    range: diagnosisFormatPred(diagnosisState.provisionalPred),
    rangeLower: diagnosisState.provisionalPred,
    rangeUpper: null,
    rangeQualifier: "",
    fallbackMessage: "有効回答不足により暫定値を表示",
    model: null,
    usedLogistic: false,
    observations,
    counts,
  };
}
function diagnosisFitLogisticRegression(option) {
  const observations = diagnosisGetKnownObservations(option);
  const counts = diagnosisGetKnownCounts(option);
  if (observations.length < 6 || counts.clear === 0 || counts.notClear === 0) {
    return diagnosisBuildFallbackResult(observations, counts);
  }

  const xValues = observations.map(({ row }) => diagnosisPredNumber(row));
  const center = xValues.reduce((sum, value) => sum + value, 0) / xValues.length;
  const variance = xValues.reduce((sum, value) => sum + (value - center) ** 2, 0) / xValues.length;
  const scale = Math.max(Math.sqrt(variance), 0.25);
  const clearPredAverage = observations
    .filter(({ status }) => status === "clear")
    .reduce((sum, { row }) => sum + diagnosisPredNumber(row), 0) / counts.clear;
  const notClearPredAverage = observations
    .filter(({ status }) => status === "not-clear")
    .reduce((sum, { row }) => sum + diagnosisPredNumber(row), 0) / counts.notClear;
  if (clearPredAverage > notClearPredAverage) {
    return diagnosisBuildInsufficientResult(observations, counts);
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
  const fittedSlope = slope;
  slope = Math.min(-0.05, slope);
  const bounds = diagnosisGetLevelBounds();
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
    return diagnosisBuildInsufficientResult(observations, counts);
  }
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
    rangeLower: hasValidRange ? lower : pred,
    rangeUpper: hasValidRange ? upper : null,
    rangeQualifier: "",
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

  const levelMessages = [];
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
    const rawPercent = averageProbability * 100;
    if (rawPercent <= 5) {
      continue;
    }
    const roundedPercent = Math.round(rawPercent / 10) * 10;
    const resultText = rawPercent >= 95
      ? "ほぼ全て"
      : "約" + roundedPercent + "%";
    levelMessages.push({ level, resultText });
  }

  const messages = [];
  for (const current of levelMessages) {
    const previous = messages[messages.length - 1];
    if (
      previous
      && previous.resultText === current.resultText
      && Number(previous.endLevel) + 1 === Number(current.level)
    ) {
      previous.endLevel = current.level;
      continue;
    }
    messages.push({
      startLevel: current.level,
      endLevel: current.level,
      resultText: current.resultText,
    });
  }

  const text = messages.map((message) => {
    const levelText = message.startLevel === message.endLevel
      ? "☆" + message.startLevel
      : "☆" + message.startLevel + "～☆" + message.endLevel;
    return levelText + "が" + message.resultText;
  });

  return text.length > 0
    ? text.join("、") + "クリアできる水準です。"
    : "";
}
function diagnosisGetPublicUrl() {
  return "https://cpi-next.com/diagnosis.html";
}

function diagnosisBuildShareText(result, levelRateText) {
  const lines = [
    "適正Pred診断（β）",
    "",
    "推定適正Pred: " + (result.range || "ー"),
  ];

  if (result.fallbackMessage) {
    lines.push(result.fallbackMessage);
  }
  if (levelRateText) {
    lines.push(levelRateText);
  }

  lines.push("", diagnosisGetPublicUrl());
  return lines.join("\n");
}

function diagnosisUpdateShare(shareText) {

  const button = document.getElementById("diagnosisShareButton");
  if (!button) {
    return;
  }


  button.href = "https://x.com/intent/tweet?"
    + new URLSearchParams({ text: shareText }).toString();
  button.hidden = false;
}

function diagnosisUpdateFeatureShare(shareText) {

  const button = document.getElementById("diagnosisFeatureShareButton");
  if (!button) {
    return;
  }


  button.href = "https://x.com/intent/tweet?"
    + new URLSearchParams({ text: shareText }).toString();
  button.hidden = false;
}
function diagnosisShowResult() {
  const result = diagnosisFitLogisticRegression(diagnosisState.selectedAptitude);
  const counts = result.counts;
  const unknown = diagnosisState.responses.size - counts.total;
  const levelRates = document.getElementById("diagnosisLevelClearRates");
  const levelRateText = result.usedLogistic
    ? diagnosisBuildLevelClearRateText(result.model)
    : "";

  diagnosisState.predModel = result.model;
  diagnosisState.featurePredCenter = Number.isFinite(result.pred)
    ? result.pred
    : diagnosisState.provisionalPred;

  const resultPredElement = document.getElementById("diagnosisResultPred");
  const resultPredContainer = resultPredElement.parentElement;
  const predBounds = diagnosisGetLevelBounds();
  diagnosisRenderResultPred(resultPredElement, result, predBounds);
  const predColor = diagnosisGetNumericScaleColor(result.pred, predBounds.min, predBounds.max);
  if (predColor) {
    resultPredContainer.style.setProperty("--numeric-color", predColor);
  } else {
    resultPredContainer.style.removeProperty("--numeric-color");
  }
  document.getElementById("diagnosisResultMethod").textContent = result.usedLogistic
    ? "クリア確率40%-60%のPred範囲を表示"
    : result.fallbackMessage;
  levelRates.textContent = levelRateText;
  levelRates.hidden = !levelRateText;
  document.getElementById("diagnosisResultSummary").textContent =
    "選択内訳：クリア" + counts.clear + "譜面/未クリア" + counts.notClear + "譜面";
  diagnosisUpdateShare(diagnosisBuildShareText(result, levelRateText));

  const featureButton = document.getElementById("diagnosisFeatureButton");
  featureButton.disabled = !result.usedLogistic;
  featureButton.title = result.usedLogistic
    ? ""
    : "有効回答が増えると特徴診断を開始できます。";

  document.getElementById("diagnosisChartStep").hidden = true;
  document.getElementById("diagnosisLevelStep").hidden = true;
  document.getElementById("diagnosisFeatureStep").hidden = true;
  document.getElementById("diagnosisFeatureResultStep").hidden = true;
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

function diagnosisGetFeatureScores() {
  const model = diagnosisState.predModel;
  const observations = diagnosisGetKnownFeatureObservations();

  return diagnosisFeatureNames.map((feature) => {
    let totalWeight = 0;
    let observedTotal = 0;
    let expectedTotal = 0;
    let known = 0;

    for (const observation of observations) {
      const detail = diagnosisGetFeatureDetails(observation.row)
        .find((item) => item.name === feature);
      if (!detail) {
        continue;
      }

      const pred = diagnosisPredNumber(observation.row);
      const normalizedPred = model
        ? (pred - model.center) / model.scale
        : 0;
      const baselineProbability = model
        ? diagnosisSigmoid(model.intercept + model.slope * normalizedPred)
        : 0.5;
      const weight = 1 + Math.min(detail.plusCount, 2);
      const outcome = observation.status === "clear" ? 1 : 0;
      totalWeight += weight;
      observedTotal += weight * outcome;
      expectedTotal += weight * baselineProbability;
      known += 1;
    }

    if (totalWeight === 0) {
      return { name: feature, score: 50, known: 0 };
    }

    const effect = observedTotal / totalWeight - expectedTotal / totalWeight;
    const score = Math.max(0, Math.min(100, 50 + effect * 100));
    return { name: feature, score, known };
  });
}

function diagnosisGetFeatureShareTendencies(scores) {
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
function diagnosisBuildFeatureShareText(scores) {
  const resultPred = document.getElementById("diagnosisResultPred");
  const predText = resultPred && resultPred.textContent.trim()
    ? resultPred.textContent.trim()
    : "ー";
  const tendencies = diagnosisGetFeatureShareTendencies(scores);
  const lines = [
    "適正Pred・得意傾向診断（β）",
    "",
    "推定適正Pred: " + predText,
  ];

  if (tendencies.strong.length) {
    lines.push("得意傾向: " + tendencies.strong.join("、"));
  }
  if (tendencies.weak.length) {
    lines.push("不得意傾向: " + tendencies.weak.join("、"));
  }

  lines.push("", diagnosisGetPublicUrl());
  return lines.join("\n");
}
function diagnosisRenderFeatureResult() {
  const knownCount = diagnosisGetKnownFeatureObservations().length;
  const notice = document.getElementById("diagnosisFeatureResultNotice");
  const bars = document.getElementById("diagnosisFeatureBars");
  const featureShare = document.getElementById("diagnosisFeatureShare");

  const featureShareButton = document.getElementById("diagnosisFeatureShareButton");
  if (knownCount < diagnosisFeatureMinimumAnswers) {
    notice.textContent = "有効回答が10譜面未満のため、得意傾向を診断できませんでした。";
    notice.hidden = false;
    bars.innerHTML = "";
    if (featureShare) {
      featureShare.hidden = true;
    }
    if (featureShareButton) {
      featureShareButton.hidden = true;
    }
    return;
  }
  notice.hidden = true;
  if (featureShare) {
    featureShare.hidden = false;
  }
  const scores = diagnosisGetFeatureScores()
    .map((score, order) => ({ ...score, order }))
    .sort((left, right) => right.score - left.score || left.order - right.order);

  const scale = [
    '<div class="diagnosis-feature-bars__scale" aria-hidden="true">',
    '  <span></span>',
    '  <div class="diagnosis-feature-bars__scale-track"><span>不得意</span><span>得意</span></div>',
    '</div>',
  ].join("");

  const rows = scores.map((score) => {
    const description = diagnosisFeatureDescriptions[score.name] ?? "";
    const tooltip = description
      ? ' data-tooltip="' + diagnosisEscapeHtml(description) + '"'
        + ' tabindex="0" role="button" aria-label="' + diagnosisEscapeHtml(score.name + "の説明") + '"'
      : "";
    const chip = '<span class="feature-chip feature-chip--plus-0"' + tooltip + '>' +
      diagnosisEscapeHtml(score.name) + "</span>";
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
      '<div class="diagnosis-feature-bar-row">',
      '  <div class="diagnosis-feature-bar-row__label">' + chip + '</div>',
      '  <div class="diagnosis-feature-bar" role="img" aria-label="' + diagnosisEscapeHtml(ariaLabel) + '">',
      '    <span class="diagnosis-feature-bar__track">',
      '      <span class="diagnosis-feature-bar__half diagnosis-feature-bar__half--left"><span class="diagnosis-feature-bar__fill diagnosis-feature-bar__fill--left" style="width:' + leftWidth.toFixed(1) + '%"></span></span>',
      '      <span class="diagnosis-feature-bar__half diagnosis-feature-bar__half--right"><span class="diagnosis-feature-bar__fill diagnosis-feature-bar__fill--right" style="width:' + rightWidth.toFixed(1) + '%"></span></span>',
      '      <span class="diagnosis-feature-bar__center"></span>',
      '    </span>',
      '  </div>',
      '</div>',
    ].join("");
  }).join("");

  bars.innerHTML = scale + rows;
  diagnosisUpdateFeatureShare(diagnosisBuildFeatureShareText(scores));
}
function diagnosisShowFeatureStep() {
  if (!diagnosisState.predModel) {
    diagnosisShowError("Pred診断の有効回答が不足しているため、特徴診断を開始できません。");
    return;
  }

  diagnosisState.featureResponses = new Map();
  diagnosisState.featureRound = 0;
  diagnosisState.featurePredCenter = Number.isFinite(diagnosisState.featurePredCenter)
    ? diagnosisState.featurePredCenter
    : diagnosisState.provisionalPred;
  diagnosisState.featureSelectedCharts = diagnosisSelectFeatureCharts();
  if (diagnosisState.featureSelectedCharts.length === 0) {
    diagnosisShowError("特徴のある譜面を選べませんでした。");
    return;
  }

  document.getElementById("diagnosisError").hidden = true;
  diagnosisRenderFeatureQuestions();
  document.getElementById("diagnosisLevelStep").hidden = true;
  document.getElementById("diagnosisChartStep").hidden = true;
  document.getElementById("diagnosisResultStep").hidden = true;
  document.getElementById("diagnosisFeatureResultStep").hidden = true;
  document.getElementById("diagnosisFeatureStep").hidden = false;
  document.getElementById("diagnosisFeatureTitle").focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function diagnosisReturnToPredResult() {
  document.getElementById("diagnosisLevelStep").hidden = true;
  document.getElementById("diagnosisChartStep").hidden = true;
  document.getElementById("diagnosisFeatureStep").hidden = true;
  document.getElementById("diagnosisFeatureResultStep").hidden = true;
  document.getElementById("diagnosisResultStep").hidden = false;
  document.getElementById("diagnosisError").hidden = true;
  document.getElementById("diagnosisResultTitle").focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function diagnosisShowFeatureResult() {
  diagnosisRenderFeatureResult();
  document.getElementById("diagnosisLevelStep").hidden = true;
  document.getElementById("diagnosisChartStep").hidden = true;
  document.getElementById("diagnosisResultStep").hidden = true;
  document.getElementById("diagnosisFeatureStep").hidden = true;
  document.getElementById("diagnosisFeatureResultStep").hidden = false;
  document.getElementById("diagnosisFeatureResultTitle").focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function diagnosisSubmitFeatureBatch() {
  const statuses = diagnosisGetCurrentFeatureStatuses();

  for (const { row, status } of statuses) {
    diagnosisState.featureResponses.set(diagnosisRowKey(row), status ?? "unknown");
  }
  diagnosisState.featureRound += 1;

  if (diagnosisFeatureShouldFinish()) {
    diagnosisShowFeatureResult();
    return;
  }

  diagnosisState.featureSelectedCharts = diagnosisSelectFeatureCharts();
  if (diagnosisState.featureSelectedCharts.length === 0) {
    diagnosisShowFeatureResult();
    return;
  }

  diagnosisRenderFeatureQuestions();
  document.getElementById("diagnosisFeatureTitle").focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function diagnosisReset() {
  diagnosisState.selectedAptitude = null;
  diagnosisState.selectedCharts = [];
  diagnosisState.responses = new Map();
  diagnosisState.seenChartIds = new Set();
  diagnosisState.provisionalPred = null;
  diagnosisState.round = 0;
  diagnosisState.lastAdjustment = "";
  diagnosisState.predModel = null;
  diagnosisState.featureSelectedCharts = [];
  diagnosisState.featureResponses = new Map();
  diagnosisState.featureRound = 0;
  diagnosisState.featurePredCenter = null;
  document.getElementById("diagnosisForm").reset();
  document.getElementById("levelNextButton").disabled = true;
  document.getElementById("diagnosisFeatureButton").disabled = true;
  document.getElementById("diagnosisChartQuestions").innerHTML = "";
  document.getElementById("diagnosisFeatureQuestions").innerHTML = "";
  document.getElementById("diagnosisFeatureBars").innerHTML = "";
  document.getElementById("diagnosisShareButton").hidden = true;
  document.getElementById("diagnosisFeatureShare").hidden = true;
  document.getElementById("diagnosisFeatureShareButton").hidden = true;

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
    document.getElementById("diagnosisFeatureButton").addEventListener("click", diagnosisShowFeatureStep);
    document.getElementById("diagnosisFeatureSubmitButton").addEventListener("click", diagnosisSubmitFeatureBatch);
    document.getElementById("diagnosisFeatureBackButton").addEventListener("click", diagnosisReturnToPredResult);
    document.getElementById("diagnosisFeatureResultBackButton").addEventListener("click", diagnosisReturnToPredResult);
    document.getElementById("diagnosisFeatureResetButton").addEventListener("click", diagnosisReset);
    document.getElementById("diagnosisFeatureResultResetButton").addEventListener("click", diagnosisReset);

    const chartQuestions = document.getElementById("diagnosisChartQuestions");
    chartQuestions.addEventListener("change", diagnosisUpdateProgress);
    diagnosisBindStatusDeselect(
      chartQuestions,
      "input[data-diagnosis-question]",
      diagnosisUpdateProgress,
    );

    const featureQuestions = document.getElementById("diagnosisFeatureQuestions");
    featureQuestions.addEventListener("change", diagnosisUpdateFeatureProgress);
    diagnosisBindStatusDeselect(
      featureQuestions,
      "input[data-diagnosis-feature-question]",
      diagnosisUpdateFeatureProgress,
    );
  } catch (error) {
    console.error(error);
    diagnosisShowError(error.message || "診断ページを読み込めませんでした。");
  }
}
document.addEventListener("DOMContentLoaded", diagnosisInit);
