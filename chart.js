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

const chartFeatureDescriptions = {
  "特徴なし": "既定の譜面特徴に強く当てはまらない譜面です。",
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

function getChartNumericScale(rows) {
  const values = [...rows]
    .map((row) => toFiniteChartNumber(row.calibrated_pred_skill))
    .filter((value) => value !== null);
  return values.length
    ? { min: Math.min(...values), max: Math.max(...values) }
    : null;
}

function getChartNumericScaleColor(value, scale) {
  const numeric = toFiniteChartNumber(value);
  if (numeric === null || !scale) {
    return "";
  }

  const position = scale.max > scale.min
    ? Math.min(1, Math.max(0, (numeric - scale.min) / (scale.max - scale.min)))
    : 0.5;
  const yellowPosition = scale.max > scale.min
    ? Math.min(0.45, Math.max(0.1, (9 - scale.min) / (scale.max - scale.min)))
    : 0.25
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
  return hslToRgbString(hue, saturation, lightness);
}

function hslToRgbString(hue, saturation, lightness) {
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
function getChartNumericColorStyle(value, scale) {
  const color = getChartNumericScaleColor(value, scale);
  return color ? ' style="--numeric-color:' + color + '"' : "";
}
function setChartNumericColor(element, value, scale) {
  const color = getChartNumericScaleColor(value, scale);
  if (color) {
    element.style.setProperty("--numeric-color", color);
  } else {
    element.style.removeProperty("--numeric-color");
  }
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

function renderChartHistogramAxis(predPosition, numericScale) {
  const axis = document.getElementById("chartPredHistogramAxis");
  const range = predPosition.max - predPosition.min;
  if (!axis || !Number.isFinite(range) || range <= 0) {
    if (axis) {
      axis.textContent = "";
    }
    return;
  }

  const firstTick = Math.ceil(predPosition.min - 1e-9);
  const lastTick = Math.floor(predPosition.max + 1e-9);
  const labels = [];
  for (let value = firstTick; value <= lastTick; value += 1) {
    const position = ((value - predPosition.min) / range) * 100;
    let edgeClass = "";
    if (position <= 0) {
      edgeClass = " chart-pred-position__axis-label--start";
    } else if (position >= 100) {
      edgeClass = " chart-pred-position__axis-label--end";
    }
    const color = getChartNumericScaleColor(value, numericScale);
    const colorStyle = color ? ' --numeric-color:' + color + ';' : '';
    labels.push('<span class="chart-pred-position__axis-label' + edgeClass + '" style="left:' + position.toFixed(2) + '%;' + colorStyle + '">' + formatChartAxisValue(value) + "</span>");
  }
  axis.innerHTML = labels.join("");
}

function renderChartPredPosition(predPosition, row, numericScale) {
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
  renderChartHistogramAxis(predPosition, numericScale);


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

function renderChartFeatureChips(row, showEmpty = false) {
  const features = String(row.features ?? "")
    .split("、")
    .map((feature) => feature.trim())
    .filter(Boolean);
  if (features.length === 0) {
    if (!showEmpty) {
      return "";
    }
    const description = chartFeatureDescriptions["特徴なし"];
    return '<div class="feature-chips"><span class="feature-chip feature-chip--none" data-tooltip="' + escapeChartHtml(description) + '" tabindex="0" role="button" aria-label="特徴の説明">特徴なし</span></div>';
  }

  return '<div class="feature-chips">' + features.map((feature) => {
    const plusCount = (feature.match(/\+/g) ?? []).length;
    const colorLevel = Math.min(3, plusCount);
    const baseFeature = feature.replace(/\++$/, "");
    const description = chartFeatureDescriptions[baseFeature] ?? "";
    const tooltip = description ? ' data-tooltip="' + escapeChartHtml(description) + '" tabindex="0" role="button" aria-label="特徴の説明"' : "";
    return '<span class="feature-chip feature-chip--plus-' + colorLevel + '"' + tooltip + '>' + escapeChartHtml(feature) + "</span>";
  }).join("") + "</div>";
}
function normalizeChartId(value) {
  const text = String(value ?? "").trim();
  return text.replace(/^0+(?=\d)/, "");
}

function getChartPageHref(chartId) {
  const encodedId = encodeURIComponent(normalizeChartId(chartId));
  return document.body?.dataset.staticChartPage === "true"
    ? encodedId + ".html"
    : "chart-pages/" + encodedId + ".html";
}

function getPublicChartUrl(chartId) {
  const encodedId = encodeURIComponent(normalizeChartId(chartId));
  if (/^https?:$/.test(window.location.protocol)) {
    return new URL(getChartPageHref(chartId), window.location.href).href;
  }
  return "https://x03peok.github.io/predIIDXlevel/chart-pages/" + encodedId + ".html";
}

function getTextageTwoPlayerUrl(url) {
  const text = String(url ?? "");
  if (text.length < 5 || text.slice(-5, -4) !== "1") {
    return "";
  }
  return text.slice(0, -5) + "2" + text.slice(-4);
}

function setTextageLink(element, url) {
  if (!element) {
    return;
  }
  if (url) {
    element.href = url;
    element.removeAttribute("aria-disabled");
    element.removeAttribute("tabindex");
    return;
  }
  element.removeAttribute("href");
  element.setAttribute("aria-disabled", "true");
  element.tabIndex = -1;
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
  const numericScale = getChartNumericScale(rows.values());

  body.innerHTML = similarRows.map((row) => {
    const difficulty = String(row.difficulty ?? "").trim().toUpperCase();
    const difficultyClass = chartDifficultyClasses[difficulty] ?? "";
    const difficultyText = chartDifficultyLabels[difficulty] ?? difficulty;
    const originalText = "☆" + (row.original_level ?? "");
    const predictedText = formatChartPred(row.calibrated_pred_skill) ?? row.calibrated_pred_skill ?? "";
    const titleText = row.title ?? "";
    const levelColorStyle = getChartNumericColorStyle(row.original_level, numericScale);
    const predictedColorStyle = getChartNumericColorStyle(row.calibrated_pred_skill, numericScale);

    return [
      "<tr>",
      '<td class="mono numeric-value numeric-value--level"' + levelColorStyle + '>' + escapeChartHtml(originalText) + "</td>",
      '<td class="chart-title-cell"><a class="chart-link ' + difficultyClass + '" href="' + getChartPageHref(row.chart_id) + '"><span class="chart-title-cell__name">' + escapeChartHtml(titleText) + '</span>' + (difficultyText ? ' <span class="chart-title-cell__difficulty">[' + escapeChartHtml(difficultyText) + ']</span>' : "") + "</a></td>",
      '<td class="mono numeric-value numeric-value--pred"' + predictedColorStyle + '>' + escapeChartHtml(predictedText) + "</td>",
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
  const chartId = new URLSearchParams(window.location.search).get("id") || document.body?.dataset.chartId || "";

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
    titleElement.textContent = row.title;
    const difficultyElement = document.getElementById("chartDifficulty");
    difficultyElement.className = "chart-detail__difficulty " + (chartDifficultyClasses[difficulty] ?? "");
    difficultyElement.textContent = chartDifficultyNames[difficulty] ?? difficulty;

    const numericScale = getChartNumericScale(rows);
    const chartLevelElement = document.getElementById("chartLevel");
    const chartPredElement = document.getElementById("chartPred");
    chartLevelElement.textContent = "☆" + row.original_level;
    chartPredElement.textContent = formatChartPred(row.calibrated_pred_skill);
    setChartNumericColor(chartLevelElement, row.original_level, numericScale);
    setChartNumericColor(chartPredElement, row.calibrated_pred_skill, numericScale);
    const predPosition = getChartPredPosition(row, rows);
    document.getElementById("chartPredPercentile").textContent = formatChartPredPercentile(predPosition, row);
    renderChartPredPosition(predPosition, row, numericScale);
    document.getElementById("chartFeatures").innerHTML = renderChartFeatureChips(row, true);
    document.getElementById("chartBpm").textContent = formatChartBpm(row.bpm_min, row.bpm_max);
    const textageOnePlayerUrl = window.__TEXTAGE_URLS__?.[normalizeChartId(row.chart_id)] ?? "";
    setTextageLink(document.getElementById("textage1pLink"), textageOnePlayerUrl);
    setTextageLink(document.getElementById("textage2pLink"), getTextageTwoPlayerUrl(textageOnePlayerUrl));
    const shareButton = document.getElementById("chartShareButton");
    if (shareButton) {
      const shareDifficultyLabel = chartDifficultyLabels[difficulty] ?? difficulty;
      const sharePred = formatChartPred(row.calibrated_pred_skill);
      const sharePercentile = formatChartPredPercentile(predPosition, row).replace("（", "(").replace("）", ")");
      const shareFeatureValues = String(row.features ?? "")
        .split("、")
        .map((feature) => feature.trim())
        .filter(Boolean)
        .join("、");
      const shareFeatures = !shareFeatureValues || shareFeatureValues === "特徴なし" ? "―" : shareFeatureValues;
      const shareUrl = getPublicChartUrl(chartId);
      const shareText = [
        "☆" + (row.original_level ?? "") + " " + row.title + (shareDifficultyLabel ? " [" + shareDifficultyLabel + "]" : ""),
        "",
        "Pred: " + sharePred + " " + sharePercentile,
        "",
        "Feature: " + shareFeatures,
        "",
        shareUrl,
      ].join("\n");
      const shareParams = new URLSearchParams({ text: shareText });
      shareButton.href = "https://x.com/intent/tweet?" + shareParams.toString();
      shareButton.hidden = false;
    }
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
