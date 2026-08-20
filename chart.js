const chartDifficultyLabels = {
  NORMAL: "N",
  HYPER: "H",
  ANOTHER: "A",
  LEGGENDARIA: "L",
};

const chartDifficultyClasses = {
  NORMAL: "difficulty--normal",
  HYPER: "difficulty--hyper",
  ANOTHER: "difficulty--another",
  LEGGENDARIA: "difficulty--leggendaria",
};

const chartEntityDecoder = document.createElement("textarea");

function parseChartCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    const ch = text[i];

    if (inQuotes) {
      if (ch === "\"" && text[i + 1] === "\"") {
        cell += "\"";
        i += 1;
      } else if (ch === "\"") {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === "\"") {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (code === 13 || code === 10) {
      if (code === 13 && text.charCodeAt(i + 1) === 10) {
        i += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }

  row.push(cell);
  rows.push(row);

  if (
    rows.length > 1 &&
    rows[rows.length - 1].length === 1 &&
    rows[rows.length - 1][0] === "" &&
    (text.charCodeAt(text.length - 1) === 10 || text.charCodeAt(text.length - 1) === 13)
  ) {
    rows.pop();
  }

  return rows;
}

function decodeChartEntities(value) {
  chartEntityDecoder.innerHTML = value;
  return chartEntityDecoder.value;
}

function normalizeChartTitle(value) {
  const decoded = decodeChartEntities(value);
  const stripped = decoded.replace(/<\/?[A-Za-z][^>]*>/g, "");
  return decodeChartEntities(stripped);
}

function getChartRows(csvText) {
  const parsed = parseChartCsv(csvText);
  const headers = parsed.shift().map((value) => value.trim());
  const headerIndex = new Map(headers.map((header, index) => [header, index]));
  const requiredHeaders = [
    "chart_id",
    "title",
    "difficulty",
    "original_level",
    "calibrated_pred_skill",
    "bpm_min",
    "bpm_max",
  ];

  for (const header of requiredHeaders) {
    if (!headerIndex.has(header)) {
      throw new Error("Missing required column: " + header);
    }
  }

  return parsed.map((cells) => ({
    chart_id: (cells[headerIndex.get("chart_id")] ?? "").trim(),
    title: normalizeChartTitle((cells[headerIndex.get("title")] ?? "").trim()),
    difficulty: (cells[headerIndex.get("difficulty")] ?? "").trim(),
    original_level: (cells[headerIndex.get("original_level")] ?? "").trim(),
    calibrated_pred_skill: (cells[headerIndex.get("calibrated_pred_skill")] ?? "").trim(),
    bpm_min: (cells[headerIndex.get("bpm_min")] ?? "").trim(),
    bpm_max: (cells[headerIndex.get("bpm_max")] ?? "").trim(),
  }));
}

function formatChartPred(value) {
  const numeric = toFiniteChartNumber(value);
  return Number.isFinite(numeric) ? (Math.round(numeric * 10) / 10).toFixed(1) : value;
}

function toFiniteChartNumber(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return null;
  }
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatChartPredPercentile(row, rows) {
  const targetPred = toFiniteChartNumber(row.calibrated_pred_skill);
  if (targetPred === null) {
    return "";
  }

  const levelPreds = rows
    .filter((item) => item.original_level === row.original_level)
    .map((item) => toFiniteChartNumber(item.calibrated_pred_skill))
    .filter((value) => value !== null);

  if (!levelPreds.length) {
    return "";
  }

  const percentile = Math.round(
    (levelPreds.filter((value) => value <= targetPred).length / levelPreds.length) * 1000,
  ) / 10;
  const position = percentile < 50 ? "下位" : "上位";
  const percentage = percentile < 50 ? percentile : 100 - percentile;
  return "（☆" + row.original_level + position + percentage.toFixed(1) + "%）";
}

function formatChartBpm(minValue, maxValue) {
  const min = String(minValue ?? "").trim();
  const max = String(maxValue ?? "").trim();
  const minNumber = Number(min);
  const maxNumber = Number(max);

  if (Number.isFinite(minNumber) && Number.isFinite(maxNumber) && minNumber === maxNumber) {
    return min;
  }
  return min + "~" + max;
}

function showChartError(message) {
  document.getElementById("chartDetail").hidden = true;
  const error = document.getElementById("chartError");
  error.textContent = message;
  error.hidden = false;
}

function renderChart() {
  const csvText = window.__CSV_BUNDLE__;
  const chartId = new URLSearchParams(window.location.search).get("id");

  if (typeof csvText !== "string" || !chartId) {
    showChartError("譜面が見つかりません。");
    return;
  }

  try {
    const rows = getChartRows(csvText);
    const row = rows.find((item) => item.chart_id === chartId);
    if (!row) {
      showChartError("譜面が見つかりません。");
      return;
    }

    const difficulty = row.difficulty;
    const difficultyLabel = chartDifficultyLabels[difficulty] ?? difficulty;
    document.getElementById("chartTitle").textContent = row.title + " " + difficultyLabel;
    document.getElementById("chartLevel").textContent = "☆" + row.original_level;
    document.getElementById("chartPred").textContent = formatChartPred(row.calibrated_pred_skill);
    document.getElementById("chartPredPercentile").textContent = formatChartPredPercentile(row, rows);
    document.getElementById("chartBpm").textContent = formatChartBpm(row.bpm_min, row.bpm_max);
    document.title = row.title + " | 譜面詳細";
    document.getElementById("chartDetail").hidden = false;
  } catch (error) {
    console.error(error);
    showChartError("譜面データを読み込めませんでした。");
  }
}

document.addEventListener("DOMContentLoaded", renderChart);
