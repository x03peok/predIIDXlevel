"use strict";

const shareFeatureLabels = Object.freeze({
  b: "BPM変化",
  c: "チャージノート",
  l: "ラスト難",
  s: "皿複合",
  k: "単鍵ラッシュ",
  d: "同時押し",
  m: "物量",
  r: "連皿",
  j: "連打",
});
const shareFeatureOrder = Object.freeze(["b", "c", "l", "s", "k", "d", "m", "r", "j"]);
const sharePredLabels = Object.freeze({
  o: "総合",
  e: "イージーPred",
  n: "ノマゲPred",
  h: "ハードPred",
});
const shareStatusLabels = Object.freeze({
  assisted: "ASSISTED",
  easy: "EASY",
  clear: "CLEAR",
  hard: "HARD以上",
});
const shareStatusMarkers = Object.freeze({
  assisted: "🟪",
  easy: "🟩",
  clear: "🟦",
  hard: "🟥",
});
const shareDifficultyLabels = Object.freeze({
  NORMAL: "N",
  HYPER: "H",
  ANOTHER: "A",
  LEGGENDARIA: "L",
  N: "N",
  H: "H",
  A: "A",
  L: "L",
});
const shareEntityDecoder = document.createElement("textarea");

function shareDecodeHtml(value) {
  shareEntityDecoder.innerHTML = String(value ?? "");
  return shareEntityDecoder.value || shareEntityDecoder.textContent || "";
}

function shareNormalizeTitle(value) {
  return shareDecodeHtml(String(value ?? "").replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

function shareParseCsv(text) {
  const source = String(text ?? "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (quoted) {
      if (character === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\r" || character === "\n") {
      if (character === "\r" && next === "\n") index += 1;
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
  if (rows.length < 2) return [];
  const headers = rows[0].map((value) => String(value).trim());
  return rows.slice(1).map((values) => {
    const result = {};
    headers.forEach((header, index) => {
      result[header] = String(values[index] ?? "").trim();
    });
    result.chart_id = String(result.chart_id ?? "").trim();
    result.title = shareNormalizeTitle(result.title);
    return result;
  }).filter((row) => row.chart_id);
}

const shareRows = shareParseCsv(window.__CSV_BUNDLE__);
const shareRowsById = new Map(shareRows.map((row) => [String(row.chart_id), row]));

function shareCreate(tag, className, text = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== "") element.textContent = text;
  return element;
}

function shareSafeId(value) {
  const id = String(value ?? "").trim();
  return id && id.length <= 80 && /^[A-Za-z0-9._-]+$/.test(id) ? id : "";
}

function shareSafeNumber(value, minimum = -100, maximum = 100) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
}

function shareSafeText(value, maximum = 100) {
  if (typeof value !== "string") return "";
  const text = value;
  return text.length <= maximum ? text : text.slice(0, maximum);
}

function shareFormatPred(value) {
  const number = shareSafeNumber(value, -100, 100);
  return number === null ? "ー" : number.toFixed(2);
}

function sharePredClass(value) {
  const number = shareSafeNumber(value, -100, 100);
  if (number === null) return "";
  if (number < 9) return "share-pred--blue";
  if (number < 10) return "share-pred--orange";
  if (number < 11) return "share-pred--green";
  if (number < 12) return "share-pred--red";
  if (number < 13) return "share-pred--purple";
  if (number < 14) return "share-pred--dark-purple";
  return "share-pred--deep-purple";
}

function shareFormatDate(value) {
  const match = String(value ?? "").match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  return match ? match.slice(1).map(Number).join("-") : String(value ?? "");
}

function shareChartHref(chartId) {
  const id = shareSafeId(chartId);
  return id && shareRowsById.has(id) ? "chart-pages/" + encodeURIComponent(id) + ".html" : "";
}

function shareAppendChartTitle(parent, chartId, fallback = "譜面") {
  const row = shareRowsById.get(String(chartId ?? ""));
  const title = shareCreate("span", "share-chart__title", row?.title || fallback);
  const difficultyValue = String(row?.difficulty ?? "").trim().toUpperCase();
  const difficulty = shareDifficultyLabels[difficultyValue] ?? "";
  const titleLine = shareCreate("div", "share-chart__title-line");
  const href = shareChartHref(chartId);
  if (href) {
    const link = shareCreate("a", "share-chart__link");
    link.href = href;
    link.append(title);
    titleLine.append(link);
  } else {
    titleLine.append(title);
  }
  if (difficulty) {
    titleLine.append(shareCreate("span", "share-chart__difficulty", " [" + difficulty + "]"));
  }
  parent.append(titleLine);
  return row;
}

function shareAppendPred(parent, label, value, className = "") {
  const line = shareCreate("div", "share-pred-line " + className);
  line.append(
    shareCreate("span", "share-pred-line__label", label),
    shareCreate("strong", "share-pred " + sharePredClass(value), shareFormatPred(value)),
  );
  parent.append(line);
}

function shareAppendBestClear(parent, best, heading = "ベストクリア") {
  const section = shareCreate("section", "share-best");
  section.append(shareCreate("h2", "share-section-title", heading));
  if (!best || !shareSafeId(best.i)) {
    section.append(shareCreate("p", "share-muted", "データがありません。"));
    parent.append(section);
    return;
  }
  const status = String(best.s ?? "").toLowerCase();
  const card = shareCreate("article", "share-best__card");
  const marker = shareStatusMarkers[status] ?? "";
  const statusLabel = shareStatusLabels[status] ?? "";
  const statusLine = shareCreate("div", "share-best__status", marker + (marker ? " " : "") + statusLabel);
  card.append(statusLine);
  const row = shareAppendChartTitle(card, best.i);
  const level = row?.original_level ? "☆" + row.original_level : "☆";
  const meta = shareCreate("div", "share-chart__meta");
  meta.append(shareCreate("span", "", level));
  meta.append(shareCreate("span", "share-chart__pred-label", "Pred"));
  meta.append(shareCreate("strong", "share-pred " + sharePredClass(best.p), shareFormatPred(best.p)));
  card.append(meta);
  section.append(card);
  parent.append(section);
}

const shareFeatureDescriptions = Object.freeze({
  "BPM変化": "激しいBPM変化と、変化周辺の難しい配置が特徴です。",
  "チャージノート": "CN/HCN/BSS/HBSS/MSSと、同時に来る難しい配置が特徴です。",
  "ラスト難": "ラスト数十秒の難易度がそれ以前の平均と比べて高いことが特徴です。",
  "皿複合": "スクラッチと同時に来る鍵盤の難しい配置が特徴です。",
  "単鍵ラッシュ": "1個～2個押し主体の細かい配置が特徴です。",
  "同時押し": "3個以上の横に広い同時押し主体の配置が特徴です。",
  "物量": "曲全体を平均した1秒あたりのノーツ数の多さが特徴です。",
  "連皿": "短い時間に連続するスクラッチの難しさが特徴です。",
  "連打": "同じ鍵盤に連続して降ってくるノーツの難しさが特徴です。",
});
const shareFeatureNoneDescription = "既定の譜面特徴に強く当てはまらない譜面です。";
const shareDifficultyClasses = Object.freeze({
  NORMAL: "difficulty--normal",
  HYPER: "difficulty--hyper",
  ANOTHER: "difficulty--another",
  LEGGENDARIA: "difficulty--leggendaria",
});

function sharePredColor(value) {
  const numeric = shareSafeNumber(value, -100, 100);
  if (numeric === null) return "";
  const stops = [
    [8, [37, 99, 235]], [9, [249, 115, 22]], [10, [22, 163, 74]],
    [11, [220, 38, 38]], [12, [147, 51, 234]], [13, [109, 40, 217]], [14, [76, 29, 149]],
  ];
  const valueAt = Math.min(14, Math.max(8, numeric));
  let lower = stops[0];
  let upper = stops[stops.length - 1];
  for (let index = 1; index < stops.length; index += 1) {
    if (valueAt <= stops[index][0]) {
      lower = stops[index - 1];
      upper = stops[index];
      break;
    }
  }
  const ratio = (valueAt - lower[0]) / (upper[0] - lower[0]);
  const channels = lower[1].map((channel, index) => Math.round(
    channel + (upper[1][index] - channel) * ratio,
  ));
  return "rgb(" + channels.join(", ") + ")";
}

function shareApplyPredColor(element, value) {
  const color = sharePredColor(value);
  if (color) element.style.setProperty("--numeric-color", color);
}

function shareAppendPredRange(parent, value) {
  parent.replaceChildren();
  const text = shareSafeText(String(value ?? "").trim(), 80) || "ー";
  const matches = Array.from(text.matchAll(/\d+(?:\.\d+)?/g));
  if (!matches.length) {
    parent.textContent = text;
    return;
  }
  let cursor = 0;
  matches.forEach((match) => {
    const before = text.slice(cursor, match.index);
    if (before) {
      parent.append(shareCreate(
        "span",
        before === "-" ? "mypage-pred-estimate__separator" : "",
        before,
      ));
    }
    const valueElement = shareCreate("span", "mypage-pred-estimate__value-part", match[0]);
    shareApplyPredColor(valueElement, match[0]);
    parent.append(valueElement);
    cursor = match.index + match[0].length;
  });
  if (cursor < text.length) parent.append(document.createTextNode(text.slice(cursor)));
}

function shareRenderFeatureChips(parent, row) {
  const features = String(row?.features ?? "").split("、").map((feature) => feature.trim()).filter(Boolean);
  const wrapper = shareCreate("div", "feature-chips");
  if (!features.length) {
    const chip = shareCreate("span", "feature-chip feature-chip--none", "特徴なし");
    chip.dataset.tooltip = shareFeatureNoneDescription;
    chip.tabIndex = 0;
    chip.setAttribute("role", "button");
    chip.setAttribute("aria-label", "特徴の説明");
    wrapper.append(chip);
  } else {
    features.forEach((feature) => {
      const plusCount = Math.min(3, (feature.match(/\+/g) ?? []).length);
      const name = feature.replace(/\+{1,2}$/, "");
      const chip = shareCreate("span", "feature-chip feature-chip--plus-" + plusCount, feature);
      const description = shareFeatureDescriptions[name] ?? "";
      if (description) {
        chip.dataset.tooltip = description;
        chip.tabIndex = 0;
        chip.setAttribute("role", "button");
        chip.setAttribute("aria-label", feature + "の説明");
      }
      wrapper.append(chip);
    });
  }
  return wrapper;
}

function shareAppendRecommendationTitle(parent, chartId, fallback = "譜面") {
  const row = shareRowsById.get(String(chartId ?? ""));
  const difficulty = String(row?.difficulty ?? "").trim().toUpperCase();
  const difficultyText = shareDifficultyLabels[difficulty] ?? difficulty;
  const className = "chart-link " + (shareDifficultyClasses[difficulty] ?? "")
    + " mypage-recommendation-card__title";
  const href = shareChartHref(chartId);
  const title = shareCreate("span", "chart-title-cell__name", row?.title || fallback);
  const difficultyElement = shareCreate("span", "chart-title-cell__difficulty", "[" + difficultyText + "]");
  const link = shareCreate(href ? "a" : "div", className);
  if (href) link.href = href;
  link.append(title, document.createTextNode(" "), difficultyElement);
  parent.append(link);
  return row;
}

function shareAppendHighPredCard(parent, best) {
  const card = shareCreate(
    "article",
    "mypage-recommendation-card mypage-recommendation-card--high-pred mypage-recommendation-card--summary",
  );
  const status = String(best?.s ?? "").toLowerCase();
  const header = shareCreate("div", "mypage-recommendation-card__header");
  header.dataset.status = status;
  header.setAttribute("aria-label", "クリアランプ");
  const statusLine = shareCreate("div", "mypage-recommendation-card__status-line");
  const statusElement = shareCreate(
    "span",
    "target-recommendation-status target-recommendation-status--" + status,
  );
  if (status === "hard") {
    statusElement.append(
      shareCreate("span", "", "HARD"),
      shareCreate("span", "target-recommendation-status__suffix", "以上"),
    );
  } else {
    statusElement.textContent = shareStatusLabels[status] ?? "未登録";
  }
  statusLine.append(statusElement);
  header.append(statusLine);
  card.append(header);

  const row = shareAppendRecommendationTitle(card, best?.i);
  const levelPred = shareCreate("div", "mypage-recommendation-card__level-pred");
  levelPred.append(
    shareCreate("span", "mypage-recommendation-card__level", "☆" + String(row?.original_level ?? "")),
    shareCreate("span", "mypage-recommendation-card__pred-label", "Pred"),
  );
  const pred = shareCreate("strong", "numeric-value numeric-value--pred", shareFormatPred(best?.p));
  shareApplyPredColor(pred, best?.p);
  levelPred.append(pred);
  card.append(levelPred);
  shareAppendHistoryPredHistogram(card, best, row);
  shareRenderFeatureChips(card, row);
  parent.append(card);
}

function shareRenderFeatureBars(features, parent) {
  const values = shareFeatureOrder.map((code, order) => ({
    name: shareFeatureLabels[code],
    score: shareSafeNumber(features?.[code], 0, 100) ?? 50,
    order,
  })).sort((left, right) => right.score - left.score || left.order - right.order);

  const scale = shareCreate("div", "mypage-feature-bars__scale");
  scale.setAttribute("aria-hidden", "true");
  scale.append(shareCreate("span"));
  const scaleTrack = shareCreate("div", "mypage-feature-bars__scale-track");
  scaleTrack.append(shareCreate("span", "", "不得意"), shareCreate("span", "", "得意"));
  scale.append(scaleTrack);
  parent.append(scale);

  values.forEach((value) => {
    const chip = shareCreate("span", "feature-chip feature-chip--plus-0", value.name);
    const description = shareFeatureDescriptions[value.name] ?? "";
    if (description) {
      chip.dataset.tooltip = description;
      chip.tabIndex = 0;
      chip.setAttribute("role", "button");
      chip.setAttribute("aria-label", value.name + "の説明");
    }
    const label = shareCreate("div", "mypage-feature-bar-row__label");
    label.append(chip);

    const bar = shareCreate("div", "mypage-feature-bar");
    bar.setAttribute("role", "img");
    bar.setAttribute(
      "aria-label",
      value.name + "、" + (value.score >= 55 ? "得意寄り" : value.score <= 45 ? "不得意寄り" : "標準"),
    );
    const track = shareCreate("span", "mypage-feature-bar__track");
    const leftHalf = shareCreate("span", "mypage-feature-bar__half mypage-feature-bar__half--left");
    const leftFill = shareCreate("span", "mypage-feature-bar__fill mypage-feature-bar__fill--left");
    leftFill.style.width = (value.score < 50 ? Math.min(100, (50 - value.score) * 2) : 0).toFixed(1) + "%";
    leftHalf.append(leftFill);
    const rightHalf = shareCreate("span", "mypage-feature-bar__half mypage-feature-bar__half--right");
    const rightFill = shareCreate("span", "mypage-feature-bar__fill mypage-feature-bar__fill--right");
    rightFill.style.width = (value.score > 50 ? Math.min(100, (value.score - 50) * 2) : 0).toFixed(1) + "%";
    rightHalf.append(rightFill);
    track.append(leftHalf, rightHalf, shareCreate("span", "mypage-feature-bar__center"));
    bar.append(track);
    const row = shareCreate("div", "mypage-feature-bar-row");
    row.append(label, bar);
    parent.append(row);
  });
}

function shareRenderOverview(payload, content) {
  content.classList.add("share-page__content--overview");
  const heading = shareCreate("h2", "mypage-section-heading mypage-pred-section-heading");
  heading.append(shareCreate("span", "", "適正Pred"));
  content.append(heading);

  content.append(shareCreate("p", "share-overview-description", "Predは譜面情報から推定したCPI:Next独自の難易度指標です。ここでは共有したプレイヤーのクリア状況をもとに、クリア確率が40%～60%の範囲を表示しています。"));

  const predEstimate = shareCreate("div", "mypage-pred-estimate");
  const summary = shareCreate("div", "mypage-pred-summary");
  const preds = payload.p && typeof payload.p === "object" ? payload.p : {};
  const overall = shareCreate("div", "mypage-pred-summary__item mypage-pred-summary__item--overall");
  overall.append(shareCreate("span", "mypage-pred-summary__label", "総合："));
  const overallValue = shareCreate("span", "mypage-pred-estimate__value");
  shareAppendPredRange(overallValue, preds.o);
  overall.append(overallValue);

  const lampEstimates = shareCreate("div", "mypage-pred-lamp-estimates");
  [["easy", "イージー", "e"], ["normal", "ノマゲ", "n"], ["hard", "ハード", "h"]].forEach(([mode, label, key]) => {
    const item = shareCreate("div", "mypage-pred-lamp-row mypage-pred-lamp-row--" + mode);
    item.append(shareCreate("span", "mypage-pred-lamp-row__label", label));
    const value = shareCreate("span", "mypage-pred-lamp-row__value mypage-pred-estimate__value");
    shareAppendPredRange(value, preds[key]);
    item.append(value);
    lampEstimates.append(item);
  });
  summary.append(overall, lampEstimates);
  predEstimate.append(summary);
  content.append(predEstimate);

  const highSection = shareCreate(
    "section",
    "mypage-recommendation-block mypage-recommendation-block--plain mypage-recommendation-block--start share-summary-section",
  );
  highSection.setAttribute("aria-labelledby", "shareHighPredTitle");
  const highTitle = shareCreate("h3", "mypage-feature-result__title", "最高Predクリアランプ");
  highTitle.id = "shareHighPredTitle";
  highSection.append(highTitle);
  const highCards = shareCreate("div", "mypage-recommendation-cards");
  const best = payload.b && typeof payload.b === "object" ? payload.b : null;
  if (best && shareSafeId(best.i) && shareRowsById.has(shareSafeId(best.i))) {
    shareAppendHighPredCard(highCards, best);
  } else {
    highCards.append(shareCreate("p", "mypage-recommendation-block__message", "データがありません。"));
  }
  highSection.append(highCards);
  content.append(highSection);

  const featureSection = shareCreate(
    "section",
    "mypage-status-distribution mypage-feature-result share-summary-feature",
  );
  featureSection.append(
    shareCreate("h3", "mypage-status-distribution__title mypage-feature-result__title", "譜面傾向"),
    shareCreate("p", "mypage-feature-result__note", "同程度のPredの譜面と比べた、譜面特徴ごとの得意・不得意の傾向です。"),
  );
  const bars = shareCreate("div", "mypage-feature-bars");
  const features = payload.f && typeof payload.f === "object" ? payload.f : {};
  if (Object.keys(features).length) {
    shareRenderFeatureBars(features, bars);
  } else {
    bars.append(shareCreate("p", "share-muted", "データがありません。"));
  }
  featureSection.append(bars);
  content.append(featureSection);
}
const shareHistoryStatusLabels = Object.freeze({
  unregistered: "未登録",
  unowned: "未所持・未解禁",
  "no-play": "NO PLAY",
  failed: "FAILED",
  assisted: "ASSISTED",
  easy: "EASY",
  clear: "CLEAR",
  hard: "HARD以上",
});

function shareCreateHistoryStatus(status) {
  const normalized = Object.prototype.hasOwnProperty.call(shareHistoryStatusLabels, status)
    ? status
    : "unregistered";
  const chip = shareCreate("span", "mypage-history__status", shareHistoryStatusLabels[normalized]);
  chip.dataset.status = normalized;
  return chip;
}

const shareHistogramFineStepWidth = 520;

function shareGetHistoryHistogramBinStep() {
  const sharePage = document.querySelector(".share-page");
  const width = sharePage?.getBoundingClientRect().width ?? 0;
  return width >= shareHistogramFineStepWidth ? 0.05 : 0.1;
}

const shareHistoryPredModes = Object.freeze({
  easy: { key: "easy_pred_skill", label: "イージーPred" },
  clear: { key: "calibrated_pred_skill", label: "ノマゲPred" },
  hard: { key: "hard_pred_skill", label: "ハードPred" },
});

function shareCreateHistoryPredHistogram(best, row) {
  const status = String(best?.s ?? "").trim().toLowerCase();
  const mode = shareHistoryPredModes[status];
  const targetPred = shareSafeNumber(best?.p);
  if (!mode || targetPred === null || !row) return;

  const level = String(row.original_level ?? "").trim();
  const levelPreds = shareRows
    .filter((item) => String(item.original_level ?? "").trim() === level)
    .map((item) => shareSafeNumber(item[mode.key]))
    .filter((value) => value !== null);
  if (!levelPreds.length) return;

  const binStep = shareGetHistoryHistogramBinStep();
  const binScale = Math.round(1 / binStep);

  const counts = new Map();
  levelPreds.forEach((value) => {
    const bin = Math.round(value * binScale) / binScale;
    counts.set(bin, (counts.get(bin) ?? 0) + 1);
  });

  const minBin = Math.floor(Math.min(...levelPreds) * binScale);
  const maxBin = Math.ceil(Math.max(...levelPreds) * binScale);
  const histogramItems = [];
  for (let bin = minBin; bin <= maxBin; bin += 1) {
    const value = bin / binScale;
    histogramItems.push({ value, count: counts.get(value) ?? 0 });
  }
  const maxCount = Math.max(...histogramItems.map((item) => item.count));
  const targetBin = Math.round(targetPred * binScale) / binScale;

  const wrapper = shareCreate("div", "share-history-pred-histogram");
  wrapper.append(
    shareCreate("div", "share-history-pred-histogram__label", "同じ☆" + level + "内の" + mode.label + "分布"),
  );

  const histogram = shareCreate("div", "chart-pred-histogram");
  histogram.setAttribute("role", "img");
  histogram.setAttribute("aria-label", "同じ☆" + level + "内の" + mode.label + "分布");
  histogramItems.forEach((item) => {
    const height = item.count === 0 ? 0 : Math.max(4, (item.count / maxCount) * 100);
    const currentClass = item.value === targetBin ? " chart-pred-histogram__bar--current" : "";
    const bar = shareCreate("span", "chart-pred-histogram__bar" + currentClass);
    bar.style.height = height.toFixed(2) + "%";
    bar.title = "Pred " + item.value.toFixed(2) + ": " + item.count + "譜面";
    histogram.append(bar);
  });

  const axis = shareCreate("div", "chart-pred-position__axis chart-pred-position__axis--histogram");
  axis.setAttribute("aria-hidden", "true");
  const minValue = minBin / binScale;
  const maxValue = maxBin / binScale;
  const range = maxValue - minValue;
  if (range > 0) {
    const firstTick = Math.ceil(minValue - 1e-9);
    const lastTick = Math.floor(maxValue + 1e-9);
    for (let value = firstTick; value <= lastTick; value += 1) {
      const position = ((value - minValue) / range) * 100;
      let edgeClass = "";
      if (position <= 0) {
        edgeClass = " chart-pred-position__axis-label--start";
      } else if (position >= 100) {
        edgeClass = " chart-pred-position__axis-label--end";
      }
      const label = shareCreate("span", "chart-pred-position__axis-label" + edgeClass, value.toFixed(2));
      label.style.left = position.toFixed(2) + "%";
      const color = sharePredColor(value);
      if (color) label.style.setProperty("--numeric-color", color);
      axis.append(label);
    }
  }

  wrapper.append(histogram, axis);
  return wrapper;
}

function shareAppendHistoryPredHistogram(parent, best, row) {
  const wrapper = shareCreateHistoryPredHistogram(best, row);
  if (!wrapper) return;
  wrapper.__shareHistoryPredHistogram = { best, row };
  parent.append(wrapper);
}

function shareRefreshHistoryPredHistograms() {
  document.querySelectorAll(".share-history-pred-histogram").forEach((wrapper) => {
    const data = wrapper.__shareHistoryPredHistogram;
    if (!data) return;
    const replacement = shareCreateHistoryPredHistogram(data.best, data.row);
    if (!replacement) return;
    replacement.__shareHistoryPredHistogram = data;
    wrapper.replaceWith(replacement);
  });
}

let shareHistoryHistogramResizeTimer = null;

function scheduleShareHistoryHistogramResize() {
  if (shareHistoryHistogramResizeTimer !== null) {
    window.clearTimeout(shareHistoryHistogramResizeTimer);
  }
  shareHistoryHistogramResizeTimer = window.setTimeout(() => {
    shareHistoryHistogramResizeTimer = null;
    shareRefreshHistoryPredHistograms();
  }, 100);
}
function shareAppendHistoryBestEvent(parent, best, showBestClearUpdate) {
  const article = shareCreate("article", "mypage-history__event");
  const body = shareCreate("div", "mypage-history__event-body");
  const row = shareRowsById.get(String(best?.i ?? ""));
  const songLine = shareCreate("div", "mypage-history__song-line");
  const difficultyValue = String(row?.difficulty ?? "").trim().toUpperCase();
  const difficultyLabel = shareDifficultyLabels[difficultyValue] ?? difficultyValue;
  const songChip = shareCreate(
    "span",
    "mypage-history__song-chip " + (shareDifficultyClasses[difficultyValue] ?? ""),
  );
  const title = shareCreate(
    shareChartHref(best?.i) ? "a" : "span",
    "mypage-history__title",
    row?.title || "譜面",
  );
  const href = shareChartHref(best?.i);
  if (href) {
    title.href = href;
  } else {
    title.className += " is-unlinked";
  }
  songChip.append(title);
  if (difficultyLabel) {
    songChip.append(shareCreate("span", "mypage-history__difficulty", " [" + difficultyLabel + "]"));
  }
  songLine.append(songChip);

  const levelPredLine = shareCreate("div", "mypage-history__level-pred");
  levelPredLine.append(
    shareCreate("span", "mypage-history__level", row?.original_level ? "☆" + row.original_level : "☆"),
    document.createTextNode("　"),
  );
  const pred = shareSafeNumber(best?.p, -100, 100);
  if (pred === null) {
    levelPredLine.append(shareCreate("span", "mypage-history__pred mypage-history__pred--missing", "－"));
  } else {
    const predLabel = shareCreate("span", "mypage-history__pred-label", "Pred");
    const predValue = shareCreate("strong", "mypage-history__pred numeric-value numeric-value--pred", pred.toFixed(2));
    shareApplyPredColor(predValue, pred);
    const predGroup = shareCreate("span", "mypage-history__pred-group");
    predGroup.append(predLabel, predValue);
    levelPredLine.append(predGroup);
  }

  body.append(songLine, levelPredLine);
  shareAppendHistoryPredHistogram(body, best, row);
  if (showBestClearUpdate) {
    body.append(shareCreate("div", "mypage-history__best-clear-update", "ベストクリア更新🎉"));
  }

  const transition = shareCreate("div", "mypage-history__transition");
  const beforeStatus = String(best?.b ?? "").trim().toLowerCase();
  if (beforeStatus) {
    transition.append(
      shareCreateHistoryStatus(beforeStatus),
      document.createTextNode("→"),
    );
  }
  transition.append(shareCreateHistoryStatus(String(best?.s ?? "").trim().toLowerCase()));
  body.append(transition);

  article.append(body);
  parent.append(article);
}

function shareRenderHistory(payload, content) {
  const section = shareCreate("section", "mypage-history-panel share-history-panel");
  section.append(shareCreate("p", "share-muted share-history-description", "共有したプレイヤーの" + shareFormatDate(payload.d) + "の更新概要と最高クリアを表示しています。"));


  const counts = payload.c && typeof payload.c === "object" ? payload.c : {};
  const day = shareCreate("div", "mypage-history__day share-history-day");
  const summary = shareCreate("div", "mypage-history__day-summary share-history-day-summary");
  const overview = shareCreate("span", "mypage-history__day-overview");
  for (const code of ["a", "e", "c", "h"]) {
    const count = Number(counts[code]);
    if (!Number.isInteger(count) || count <= 0 || count > 9999) continue;
    const status = { a: "assisted", e: "easy", c: "clear", h: "hard" }[code];
    const item = shareCreate("span", "mypage-history__day-overview-item");
    item.append(
      shareCreateHistoryStatus(status),
      shareCreate("strong", "mypage-history__day-count", "+" + count),
    );
    overview.append(item);
  }
  summary.append(overview);
  day.append(summary);

  const dayEvents = shareCreate("div", "mypage-history__day-events");
  const best = payload.b && typeof payload.b === "object" ? payload.b : null;
  const bestId = shareSafeId(best?.i);
  if (best && bestId) {
    shareAppendHistoryBestEvent(dayEvents, best, payload.u === 1);
  } else {
    dayEvents.append(shareCreate("p", "share-muted", "共有された更新がありません。"));
  }

  const totalCount = ["a", "e", "c", "h"].reduce((total, code) => {
    const count = Number(counts[code]);
    return total + (Number.isInteger(count) && count > 0 && count <= 9999 ? count : 0);
  }, 0);
  if (bestId && totalCount > 1) {
    dayEvents.append(shareCreate("p", "share-history-other", "他" + (totalCount - 1) + "曲"));
  }
  day.append(dayEvents);
  const events = shareCreate("div", "mypage-history__events");
  events.append(day);
  section.append(events);
  content.append(section);
}
const shareDailyGoalLabels = Object.freeze({
  easy: "EASY",
  clear: "CLEAR",
  hard: "HARD以上",
});
const shareDailyPredKeys = Object.freeze({
  easy: "easy_pred_skill",
  clear: "calibrated_pred_skill",
  hard: "hard_pred_skill",
});
const shareStartUrl = "https://cpi-next.com/record.html";
const shareCtaTitles = Object.freeze({
  overview: "あなたの適正Predも調べてみませんか？",
  history: "あなたのプレイもCPI:Nextで記録",
  daily: "あなたも挑戦しませんか？",
});
const shareCtaDescriptions = Object.freeze({
  overview: "クリアランプを登録すると、適正Pred・得意傾向を自動分析し、あなたに合った練習曲をリコメンドします。",
  history: "クリアランプを記録すると、最近の成長やベストクリアを振り返れます。",
  daily: "登録したクリア状況やPredから目標曲を選び、「今日の10曲」として挑戦できます。",
});

function shareCopyStartUrl() {
  const showResult = (message) => {
    const status = document.getElementById("shareCtaCopyMessage");
    if (!status) return;
    status.hidden = false;
    status.textContent = message;
  };
  const copyFallback = () => {
    const input = document.createElement("textarea");
    input.value = shareStartUrl;
    input.setAttribute("readonly", "true");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.append(input);
    input.select();
    const copied = document.execCommand?.("copy");
    input.remove();
    if (!copied) throw new Error("copy failed");
  };
  const copyPromise = navigator.clipboard?.writeText
    ? navigator.clipboard.writeText(shareStartUrl)
    : Promise.resolve().then(copyFallback);
  Promise.resolve(copyPromise)
    .then(() => {
      showResult("コピーしました。普段使っているブラウザのアドレス欄に貼り付けてください。");
      window.cpiAnalytics?.track("share_url_copy", { destination: "record" });
    })
    .catch(() => showResult("コピーできませんでした。URLを手動でコピーしてください。"));
}

function shareConfigureCta(type) {
  const cta = document.getElementById("shareCta");
  const title = document.getElementById("shareCtaTitle");
  const description = document.getElementById("shareCtaDescription");
  const copyButton = document.getElementById("shareCtaCopy");
  const copyMessage = document.getElementById("shareCtaCopyMessage");
  if (!cta || !title || !description || !copyButton) return;
  title.textContent = shareCtaTitles[type] ?? "あなたのIIDXもCPI:Nextで記録・分析";
  description.textContent = shareCtaDescriptions[type] ?? "クリアランプを記録して、CPI:Nextを始めてみませんか？";
  if (copyMessage) {
    copyMessage.hidden = true;
    copyMessage.textContent = "";
  }
  copyButton.onclick = shareCopyStartUrl;
  cta.hidden = false;
}


function shareAppendDailyTitleCell(parent, chartId, fallback = "譜面") {
  const row = shareRowsById.get(String(chartId ?? ""));
  const difficulty = String(row?.difficulty ?? "").trim().toUpperCase();
  const difficultyText = shareDifficultyLabels[difficulty] ?? difficulty;
  const className = "chart-link " + (shareDifficultyClasses[difficulty] ?? "")
    + " share-daily-table__title-link";
  const href = shareChartHref(chartId);
  const link = shareCreate(href ? "a" : "span", className);
  if (href) link.href = href;
  link.append(
    shareCreate("span", "chart-title-cell__name", row?.title || fallback),
    document.createTextNode(" "),
    shareCreate("span", "chart-title-cell__difficulty", difficultyText ? "[" + difficultyText + "]" : ""),
  );
  parent.append(link);
  return row;
}

function shareRenderDaily(payload, content) {
  const section = shareCreate("section", "share-section share-daily-share-section");
  const entries = Array.isArray(payload.i) ? payload.i : [];
  const validEntries = entries.slice(0, 10).filter((entry) => {
    const chartId = shareSafeId(entry?.i);
    const goal = ["easy", "clear", "hard"].includes(String(entry?.g));
    return Boolean(chartId && goal);
  });
  const achievedCount = validEntries.filter((entry) => entry?.a === 1).length;
  const isComplete = validEntries.length > 0 && achievedCount === validEntries.length;
  const progressText = achievedCount + "/" + validEntries.length + "達成" + (isComplete ? "🎉" : "");
  section.append(shareCreate("h2", "share-daily-progress", progressText));
  section.append(shareCreate("p", "share-muted share-daily-date", "共有したプレイヤーが" + shareFormatDate(payload.d) + "に作成した挑戦曲リストです。"));

  const tableShell = shareCreate("div", "table-shell share-daily-table-shell");
  const table = shareCreate("table", "chart-table share-daily-table");
  const colgroup = document.createElement("colgroup");
  ["level", "title", "goal", "achieved", "pred", "feature"].forEach((name) => {
    colgroup.append(shareCreate("col", "share-daily-col share-daily-col--" + name));
  });
  table.append(colgroup);

  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  ["Level", "Title", "目標", "達成", "Pred", "Feature"].forEach((label) => {
    headRow.append(shareCreate("th", "", label));
  });
  head.append(headRow);
  table.append(head);

  const body = document.createElement("tbody");
  validEntries.forEach((entry) => {
    const chartId = shareSafeId(entry?.i);
    const goal = ["easy", "clear", "hard"].includes(String(entry?.g)) ? String(entry.g) : "";
    if (!chartId || !goal) return;

    const row = shareRowsById.get(chartId);
    const tableRow = document.createElement("tr");
    const levelCell = shareCreate(
      "td",
      "mono share-daily-table__level",
      row?.original_level ? "☆" + String(row.original_level).replace(/\.0$/, "") : "—",
    );
    const titleCell = shareCreate("td", "chart-title-cell share-daily-table__title");
    shareAppendDailyTitleCell(titleCell, chartId, "譜面データなし");

    const goalCell = shareCreate("td", "share-daily-table__goal");
    const goalElement = shareCreate("span", "share-daily-goal", shareDailyGoalLabels[goal]);
    goalElement.dataset.status = goal;
    goalCell.append(goalElement);

    const achievedCell = shareCreate("td", "share-daily-table__achieved");
    achievedCell.append(shareCreate(
      "span",
      "share-daily-achieved " + (entry?.a === 1 ? "is-achieved" : "is-pending"),
      entry?.a === 1 ? "達成" : "未達成",
    ));

    const predCell = shareCreate("td", "mono share-daily-table__pred");
    const predValue = row ? row[shareDailyPredKeys[goal]] : null;
    const pred = shareCreate("span", "numeric-value numeric-value--pred", shareFormatPred(predValue));
    shareApplyPredColor(pred, predValue);
    predCell.append(pred);

    const featureCell = shareCreate("td", "feature-cell share-daily-table__feature");
    if (row) shareRenderFeatureChips(featureCell, row);
    else featureCell.textContent = "—";

    tableRow.append(levelCell, titleCell, goalCell, achievedCell, predCell, featureCell);
    body.append(tableRow);
  });

  if (!body.childElementCount) {
    section.append(shareCreate("p", "share-muted", "共有された譜面がありません。"));
    content.append(section);
    return;
  }
  table.append(body);
  tableShell.append(table);
  section.append(tableShell);
  content.append(section);
}

function shareRender() {
  const message = document.getElementById("shareMessage");
  const content = document.getElementById("shareContent");
  const pageTitle = document.getElementById("sharePageTitle");
  let shareType;
  try {
    const decoded = window.cpiSharePayload.decodeUrl();
    shareType = decoded.type;
    content.replaceChildren();
    if (decoded.type === "overview") {
      document.title = "共有されたマイページ概要｜CPI:Next";
      if (pageTitle) pageTitle.textContent = "CPI:Next マイページ";
      shareRenderOverview(decoded.payload, content);
    } else if (decoded.type === "history") {
      document.title = "共有された更新履歴｜CPI:Next";
      if (pageTitle) pageTitle.textContent = "CPI:Next 更新履歴";
      shareRenderHistory(decoded.payload, content);
    } else {
      document.title = "共有された今日の10曲｜CPI:Next";
      if (pageTitle) pageTitle.textContent = "CPI:Next 今日の10曲";
      shareRenderDaily(decoded.payload, content);
    }
    shareConfigureCta(decoded.type);
    message.hidden = true;
  } catch (error) {
    content.replaceChildren();
    const cta = document.getElementById("shareCta");
    if (cta) cta.hidden = true;
    message.hidden = false;
    message.textContent = "この共有URLは無効か、内容が壊れています。";
    window.cpiAnalytics?.reportShare(shareType, shareType ? "error" : "invalid");
    return;
  }
  window.cpiAnalytics?.reportShare(shareType, "valid");
}

window.addEventListener("resize", scheduleShareHistoryHistogramResize, { passive: true });
document.addEventListener("DOMContentLoaded", shareRender);
