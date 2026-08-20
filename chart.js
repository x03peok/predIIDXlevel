const chartDifficultyNames = {
  NORMAL: "NORMAL",
  HYPER: "HYPER",
  ANOTHER: "ANOTHER",
  LEGGENDARIA: "LEGGENDARIA",
};

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
    "features",
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
    features: (cells[headerIndex.get("features")] ?? "").trim(),
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

function getChartPredPosition(row, rows) {
  const targetPred = toFiniteChartNumber(row.calibrated_pred_skill);
  if (targetPred === null) {
    return null;
  }

  const levelPreds = rows
    .filter((item) => item.original_level === row.original_level)
    .map((item) => toFiniteChartNumber(item.calibrated_pred_skill))
    .filter((value) => value !== null);

  if (!levelPreds.length) {
    return null;
  }

  const counts = new Map();
  levelPreds.forEach((value) => {
    const bin = Math.round(value * 10) / 10;
    counts.set(bin, (counts.get(bin) ?? 0) + 1);
  });

  const minBin = Math.floor(Math.min(...levelPreds) * 10);
  const maxBin = Math.ceil(Math.max(...levelPreds) * 10);
  const histogram = [];
  for (let bin = minBin; bin <= maxBin; bin += 1) {
    const value = bin / 10;
    histogram.push({ value, count: counts.get(value) ?? 0 });
  }

  const percentile = Math.round(
    (levelPreds.filter((value) => value <= targetPred).length / levelPreds.length) * 1000,
  ) / 10;
  return {
    targetPred,
    targetBin: Math.round(targetPred * 10) / 10,
    percentile,
    min: minBin / 10,
    max: maxBin / 10,
    maxCount: Math.max(...histogram.map((item) => item.count)),
    histogram,
  };
}

function formatChartPredPercentile(predPosition, row) {
  if (!predPosition) {
    return "";
  }

  const percentile = predPosition.percentile;
  const side = percentile < 50 ? "下位" : "上位";
  const percentage = percentile < 50 ? percentile : 100 - percentile;
  return "（☆" + row.original_level + side + percentage.toFixed(1) + "%）";
}

function formatChartAxisValue(value) {
  return Number.isFinite(value) ? value.toFixed(1) : "";
}

function renderChartPredPosition(predPosition, row) {
  const container = document.getElementById("chartPredPosition");
  if (!predPosition) {
    container.hidden = true;
    return;
  }

  const histogram = document.getElementById("chartPredHistogram");
  const bars = predPosition.histogram.map((item) => {
    const height = item.count === 0 ? 0 : Math.max(4, (item.count / predPosition.maxCount) * 100);
    const currentClass = item.value === predPosition.targetBin ? " chart-pred-histogram__bar--current" : "";
    return '<span class="chart-pred-histogram__bar' + currentClass + '" style="height:' + height.toFixed(2) + '%" title="Pred ' + item.value.toFixed(1) + ': ' + item.count + '譜面"></span>';
  }).join("");

  histogram.innerHTML = bars;
  histogram.setAttribute("aria-label", "同じ☆" + row.original_level + "内のPred分布。現在のPredは" + formatChartPred(predPosition.targetPred) + "です。");
  document.getElementById("chartPredHistogramMin").textContent = formatChartAxisValue(predPosition.min);
  document.getElementById("chartPredHistogramMid").textContent = formatChartAxisValue((predPosition.min + predPosition.max) / 2);
  document.getElementById("chartPredHistogramMax").textContent = formatChartAxisValue(predPosition.max);

  const bar = document.getElementById("chartPredPercentileBar");
  const marker = document.getElementById("chartPredPercentileMarker");
  const markerPosition = Math.min(100, Math.max(0, predPosition.percentile));
  marker.style.left = markerPosition + "%";
  marker.title = formatChartPredPercentile(predPosition, row);
  bar.setAttribute("aria-label", formatChartPredPercentile(predPosition, row));
  container.hidden = false;
}

function formatChartBpm(minValue, maxValue) {
  const min = String(minValue ?? "").trim();
  const max = String(maxValue ?? "").trim();
  const minNumber = toFiniteChartNumber(min);
  const maxNumber = toFiniteChartNumber(max);

  if (minNumber === null && maxNumber === null) {
    return "";
  }
  if (minNumber === null) {
    return max;
  }
  if (maxNumber === null || minNumber === maxNumber) {
    return min;
  }
  return min + "~" + max;
}

function escapeChartHtml(value) {
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

function formatChartBpmCell(minValue, maxValue) {
  const text = formatChartBpm(minValue, maxValue);
  if (!text.includes("~")) {
    return escapeChartHtml(text);
  }

  const [minText, maxText] = text.split("~", 2);
  return [
    '<span class="bpm-range">',
    '<span class="bpm-range__min">' + escapeChartHtml(minText) + "~</span>",
    '<span class="bpm-range__max">' + escapeChartHtml(maxText) + "</span>",
    "</span>",
  ].join("");
}

function renderChartFeatureChips(row) {
  const features = String(row.features ?? "")
    .split("、")
    .map((feature) => feature.trim())
    .filter(Boolean);
  if (features.length === 0) {
    return "";
  }

  return '<div class="feature-chips">' + features.map((feature) => {
    const plusCount = (feature.match(/\+/g) ?? []).length;
    const colorLevel = Math.min(3, plusCount);
    return '<span class="feature-chip feature-chip--plus-' + colorLevel + '">' + escapeChartHtml(feature) + "</span>";
  }).join("") + "</div>";
}
function normalizeChartId(value) {
  const text = String(value ?? "").trim();
  return text.replace(/^0+(?=\d)/, "");
}

function getSimilarChartRows(targetRow, rowsById) {
  const similarMap = window.__SIMILAR_CHARTS__ ?? {};
  const similarIds = similarMap[normalizeChartId(targetRow.chart_id)] ?? [];
  return similarIds
    .map((chartId) => rowsById.get(normalizeChartId(chartId)))
    .filter(Boolean)
    .slice(0, 10);
}

function renderSimilarChartRows(targetRow, rows) {
  const section = document.getElementById("similarChartsSection");
  const body = document.getElementById("similarChartsBody");
  const similarRows = getSimilarChartRows(targetRow, rows);

  body.innerHTML = similarRows.map((row) => {
    const difficulty = String(row.difficulty ?? "").trim().toUpperCase();
    const difficultyClass = chartDifficultyClasses[difficulty] ?? "";
    const difficultyText = chartDifficultyLabels[difficulty] ?? difficulty;
    const originalText = "☆" + (row.original_level ?? "");
    const predictedText = formatChartPred(row.calibrated_pred_skill) ?? row.calibrated_pred_skill ?? "";
    const titleText = (row.title ?? "") + (difficultyText ? " [" + difficultyText + "]" : "");

    return [
      "<tr>",
      '<td class="mono">' + escapeChartHtml(originalText) + "</td>",
      '<td class="chart-title-cell"><a class="chart-link ' + difficultyClass + '" href="chart.html?id=' + encodeURIComponent(row.chart_id) + '">' + escapeChartHtml(titleText) + "</a></td>",
      '<td class="mono">' + escapeChartHtml(predictedText) + "</td>",
      '<td class="mono">' + formatChartBpmCell(row.bpm_min, row.bpm_max) + "</td>",
      "<td>" + renderChartFeatureChips(row) + "</td>",
      "</tr>",
    ].join("");
  }).join("");

  section.hidden = similarRows.length === 0;
  updateSimilarTableOverflowState();
}

function updateSimilarTableOverflowState() {
  const shell = document.getElementById("similarChartsShell");
  if (!shell) {
    return;
  }
  shell.classList.toggle("is-overflowing", shell.scrollWidth > shell.clientWidth + 1);
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
    const rowsById = new Map(rows.map((item) => [normalizeChartId(item.chart_id), item]));
    const row = rows.find((item) => item.chart_id === chartId);
    if (!row) {
      showChartError("譜面が見つかりません。");
      return;
    }

    const difficulty = String(row.difficulty ?? "").trim().toUpperCase();
    const titleElement = document.getElementById("chartTitle");
    titleElement.textContent = row.title + " ";
    const difficultyElement = document.createElement("span");
    difficultyElement.className = "chart-detail__note chart-detail__title-note";
    difficultyElement.textContent = chartDifficultyNames[difficulty] ?? difficulty;
    titleElement.appendChild(difficultyElement);
    document.getElementById("chartLevel").textContent = "☆" + row.original_level;
    document.getElementById("chartPred").textContent = formatChartPred(row.calibrated_pred_skill);
    const predPosition = getChartPredPosition(row, rows);
    document.getElementById("chartPredPercentile").textContent = formatChartPredPercentile(predPosition, row);
    renderChartPredPosition(predPosition, row);
    document.getElementById("chartFeatures").textContent = row.features || "特徴なし";
    document.getElementById("chartBpm").textContent = formatChartBpm(row.bpm_min, row.bpm_max);
    document.getElementById("chartDetail").hidden = false;
    renderSimilarChartRows(row, rowsById);
    if (typeof window.addEventListener === "function") {
      window.addEventListener("resize", updateSimilarTableOverflowState, { passive: true });
    }
    document.title = row.title + " | 譜面詳細";
  } catch (error) {
    console.error(error);
    showChartError("譜面データを読み込めませんでした。");
  }
}

document.addEventListener("DOMContentLoaded", renderChart);
