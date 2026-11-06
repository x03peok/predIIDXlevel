"use strict";

const predSummarySortStorageKey = "cpi-next-pred-summary-sort-direction";
const predSummarySelectionStorageKey = "cpi-next-pred-summary-selection-v1";
const predSummarySettingsStorageKey = "cpi-next-pred-summary-settings-v2";
const predSummaryLegacySettingsStorageKey = "cpi-next-pred-summary-settings-v1";
const predSummaryFeatureNames = ["同時押し", "単鍵ラッシュ", "物量", "連打", "連皿", "皿複合", "チャージノート", "BPM変化", "ラスト難", "特徴なし"];
const predSummaryRegularFeatures = predSummaryFeatureNames.filter(name => name !== FEATURE_NONE);
const predSummaryFeatureLevels = ["含まない", "無印", "+", "++"];
const predSummaryFeatureLegend = ["なし", "あり", "+", "++"];
const predSummaryDifficulties = ["N", "H", "A", "L"];

function predSummaryDefaultSettings() {
  return {
    difficulties: [...predSummaryDifficulties],
    features: Object.fromEntries(predSummaryFeatureNames.map(name => [
      name,
      name === FEATURE_NONE ? { include: true, exclude: true } : { min: 0, max: 3 },
    ])),
  };
}

function predSummaryReadSettings() {
  const defaults = predSummaryDefaultSettings();
  try {
    const raw = window.localStorage.getItem(predSummarySettingsStorageKey)
      ?? window.localStorage.getItem(predSummaryLegacySettingsStorageKey);
    const saved = raw && raw.length <= 8000 ? JSON.parse(raw) : null;
    if (![1, 2].includes(saved?.version) || !Array.isArray(saved.difficulties)
      || saved.difficulties.length > 4 || saved.difficulties.some(value => !predSummaryDifficulties.includes(value))) return defaults;
    defaults.difficulties = [...new Set(saved.difficulties)];
    for (const name of predSummaryFeatureNames) {
      const value = saved.features?.[name];
      if (name === FEATURE_NONE) {
        for (const mode of ["include", "exclude"]) {
          if (typeof value?.[mode] === "boolean") defaults.features[name][mode] = value[mode];
        }
      } else if (saved.version === 2) {
        if (Number.isInteger(value?.min) && Number.isInteger(value?.max)
          && value.min >= 0 && value.min <= 3 && value.max >= 0 && value.max <= 3
          && (value.min <= value.max || (value.min === 1 && value.max === 0))) {
          defaults.features[name] = { min: value.min, max: value.max };
        }
      } else if (typeof value?.include === "boolean" && typeof value?.exclude === "boolean") {
        defaults.features[name] = value.include && value.exclude
          ? { min: 0, max: 3 }
          : value.include
            ? { min: 1, max: 3 }
            : value.exclude
              ? { min: 0, max: 0 }
              : { min: 1, max: 0 };
      }
    }
  } catch { /* Invalid or unavailable storage uses unrestricted filters. */ }
  return defaults;
}

let predSummarySettings = predSummaryReadSettings();

function predSummaryMatchesSettings(row) {
  const difficulty = difficultyLabels[normalizeDifficulty(row.difficulty)];
  if (!predSummarySettings.difficulties.includes(difficulty)) return false;
  const features = new Map();
  for (const feature of getRawRowFeatures(row)) {
    const name = normalizeFeature(feature);
    if (!name || name === FEATURE_NONE) continue;
    const plusCount = (String(feature).match(/\+/g) ?? []).length;
    features.set(name, Math.min(3, plusCount + 1));
  }
  const noneSettings = predSummarySettings.features[FEATURE_NONE];
  if (!noneSettings[features.size === 0 ? "include" : "exclude"]) return false;
  return predSummaryRegularFeatures.every(name => {
    const range = predSummarySettings.features[name];
    if (range.min > range.max) return false;
    const strength = features.get(name) ?? 0;
    return strength >= range.min && strength <= range.max;
  });
}
let predSummarySortDirection = "asc";
try {
  if (window.localStorage.getItem(predSummarySortStorageKey) === "desc") predSummarySortDirection = "desc";
} catch { /* Use ascending order when browser storage is unavailable. */ }

function predSummaryGetBin(value) {
  const text = String(value ?? "").trim();
  const numeric = getNumericValue(text);
  if (numeric === null) return null;
  // Read decimal digits directly so binary rounding cannot put 8.2 in 8.1.
  const decimal = text.match(/^(\d+)(?:\.(\d*))?$/);
  return decimal
    ? Number(decimal[1]) * 10 + Number((decimal[2] || "0")[0])
    : Math.floor(numeric * 10);
}

function predSummaryBuildGroups(rows, levels, mode, direction = "asc") {
  const predKeys = { easy: "easy_pred_skill", normal: "calibrated_pred_skill", hard: "hard_pred_skill" };
  const key = predKeys[mode] ?? predKeys.normal;
  const groups = new Map();
  const collator = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });
  for (const row of rows) {
    if (!levels.has(getNumericValue(row.original_level))) continue;
    const bin = predSummaryGetBin(row[key]);
    if (!groups.has(bin)) groups.set(bin, []);
    groups.get(bin).push(row);
  }
  return [...groups].sort(([left], [right]) => {
    if (left === null) return right === null ? 0 : 1;
    if (right === null) return -1;
    return direction === "desc" ? right - left : left - right;
  }).map(([bin, charts]) => ({
    bin,
    charts: charts.sort((left, right) => collator.compare(left.title, right.title)
      || difficultyOrder.indexOf(normalizeDifficulty(left.difficulty)) - difficultyOrder.indexOf(normalizeDifficulty(right.difficulty))
      || collator.compare(String(left.chart_id), String(right.chart_id))),
  }));
}

function predSummaryRenderSongList(charts) {
  const list = document.createElement("ul");
  list.className = "pred-summary__songs";
  charts.forEach(row => {
    const item = document.createElement("li");
    const link = document.createElement("a");
    const difficulty = normalizeDifficulty(row.difficulty);
    link.className = "pred-summary__song chart-link " + (difficultyClasses[difficulty] ?? "");
    link.href = getChartPageHref(row.chart_id);
    link.textContent = row.title;
    link.setAttribute("aria-label", row.title + " [" + (difficultyLabels[difficulty] ?? difficulty) + "]");
    link.dataset.chartId = row.chart_id;
    item.append(link);
    list.append(item);
  });
  return list;
}

function predSummaryRender() {
  const container = document.getElementById("predSummaryGroups");
  const message = document.getElementById("predSummaryEmpty");
  if (!container || !message) return;
  const levels = new Set([...document.querySelectorAll('input[name="predSummaryLevel"]:checked')].map(input => Number(input.value)));
  const mode = document.querySelector('input[name="predSummaryLamp"]:checked')?.value ?? "normal";
  const groups = predSummaryBuildGroups(state.rows.filter(predSummaryMatchesSettings), levels, mode, predSummarySortDirection);
  const displayed = groups.reduce((total, group) => total + group.charts.length, 0);
  const total = state.rows.filter(row => levels.has(getNumericValue(row.original_level))).length;
  const count = document.getElementById("predSummaryCount");
  if (count) count.textContent = displayed.toLocaleString() + "件表示 / " + total.toLocaleString() + "件中";
  const fragment = document.createDocumentFragment();
  groups.forEach(({ bin, charts }, index) => {
    const section = document.createElement("section");
    section.className = "pred-summary__group";
    const heading = document.createElement("h2");
    heading.className = "pred-summary__heading";
    heading.id = "predSummaryGroup" + index;
    heading.textContent = bin === null ? "未算出" : (bin / 10).toFixed(1);
    if (bin !== null) {
      heading.style.setProperty("--numeric-color", getNumericScaleColor(bin / 10, state.predDataMin, state.predDataMax));
    }
    section.setAttribute("aria-labelledby", heading.id);
    section.append(heading);
    if (levels.size > 1) {
      const levelGroups = document.createElement("div");
      levelGroups.className = "pred-summary__level-groups";
      [...levels].sort((left, right) => left - right).forEach(level => {
        const levelCharts = charts.filter(row => getNumericValue(row.original_level) === level);
        if (!levelCharts.length) return;
        const levelGroup = document.createElement("section");
        levelGroup.className = "pred-summary__level-group";
        levelGroup.dataset.level = String(level);
        const levelHeading = document.createElement("h3");
        levelHeading.className = "pred-summary__level-heading";
        levelHeading.textContent = "☆" + level;
        levelGroup.append(levelHeading, predSummaryRenderSongList(levelCharts));
        levelGroups.append(levelGroup);
      });
      section.append(levelGroups);
    } else {
      section.append(predSummaryRenderSongList(charts));
    }
    fragment.append(section);
  });
  container.replaceChildren(fragment);
  message.hidden = groups.length > 0;
  message.textContent = levels.size ? "該当する譜面はありません。" : "Levelを選択してください。";
}

function predSummaryNextFeatureRange(range, value) {
  const { min, max } = range;
  if (min > max) return { min: value, max: value };
  if (value < min) return { min: value, max };
  if (value > max) return { min, max: value };
  if (value === min && min < max) return { min: min + 1, max };
  if (value === max && max > min) return { min, max: max - 1 };
  return value - min < max - value
    ? { min: value, max }
    : { min, max: value };
}

function predSummaryFindFeatureRangeValue(group, clientX) {
  let nearestValue = 0;
  let nearestDistance = Infinity;
  group.querySelectorAll("[data-range-value]").forEach(button => {
    const rect = button.getBoundingClientRect();
    const distance = Math.abs(clientX - (rect.left + rect.width / 2));
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestValue = Number(button.dataset.rangeValue);
    }
  });
  return nearestValue;
}

function predSummaryUpdateFeatureRange(group, range) {
  const min = Number(range.min);
  const max = Number(range.max);
  const empty = min > max;
  group.dataset.min = String(min);
  group.dataset.max = String(max);
  group.classList.toggle("is-empty", empty);
  group.style.setProperty("--range-start", `${min / 3 * 100}%`);
  group.style.setProperty("--range-end", `${max / 3 * 100}%`);
  group.setAttribute("aria-label", empty
    ? `${group.dataset.featureName}: 対象なし`
    : `${group.dataset.featureName}: ${predSummaryFeatureLevels[min]}～${predSummaryFeatureLevels[max]}`);
  group.querySelectorAll("[data-range-value]").forEach(button => {
    const value = Number(button.dataset.rangeValue);
    const selected = !empty && value >= min && value <= max;
    button.classList.toggle("is-selected", selected);
    button.classList.toggle("is-boundary", selected && (value === min || value === max));
    button.setAttribute("aria-pressed", String(selected));
  });
}

function predSummaryUpdateNoneFeatureGroup(group, settings) {
  const bothSelected = Boolean(settings.include && settings.exclude);
  group.classList.toggle("is-connection-selected", bothSelected);
  for (const mode of ["include", "exclude"]) {
    const selected = Boolean(settings[mode]);
    group.dataset[mode] = String(selected);
    const button = group.querySelector(`[data-feature-mode="${mode}"]`);
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
}

function predSummaryInitializeSettings() {
  const opener = document.getElementById("predSummarySettingsButton");
  if (!opener) return;
  const dialog = document.createElement("dialog");
  dialog.id = "predSummarySettings";
  dialog.className = "pred-summary-settings";
  dialog.setAttribute("aria-labelledby", "predSummarySettingsTitle");
  dialog.innerHTML = '<div class="pred-summary-settings__header"><h2 id="predSummarySettingsTitle">難易度表の設定</h2>'
    + '<button type="button" data-settings-close aria-label="設定を閉じる">×</button></div>'
    + '<fieldset class="pred-summary-settings__features"><legend>Feature</legend><div id="predSummaryFeatureOptions"></div></fieldset>'
    + '<fieldset class="pred-summary-settings__difficulty"><legend>難易度</legend><div id="predSummaryDifficultyOptions"></div></fieldset>'
    + '<p id="predSummarySettingsMessage" role="status" hidden></p>'
    + '<div class="pred-summary-settings__actions"><button type="button" data-settings-save>保存</button>'
    + '<button type="button" data-settings-reset>デフォルトに戻す</button></div>';
  document.body.append(dialog);
  const difficultyContainer = dialog.querySelector("#predSummaryDifficultyOptions");
  for (const code of predSummaryDifficulties) {
    const label = document.createElement("label");
    label.className = "multi-filter__option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.dataset.predDifficulty = code;
    label.append(input, document.createTextNode(code));
    difficultyContainer.append(label);
  }
  const featureContainer = dialog.querySelector("#predSummaryFeatureOptions");
  const allLabel = document.createElement("label");
  allLabel.className = "multi-filter__option pred-summary-settings__all";
  const allInput = document.createElement("input");
  allInput.type = "checkbox";
  allInput.dataset.predFeatureAll = "true";
  allInput.setAttribute("aria-label", "Featureをすべて選択・解除");
  allLabel.append(allInput, document.createTextNode("all"));
  featureContainer.append(allLabel);
  const legend = document.createElement("div");
  legend.className = "pred-summary-settings__feature-legend";
  const legendSpacer = document.createElement("span");
  legendSpacer.setAttribute("aria-hidden", "true");
  const legendValues = document.createElement("div");
  for (const labelText of predSummaryFeatureLegend) {
    const label = document.createElement("span");
    label.textContent = labelText;
    legendValues.append(label);
  }
  legend.append(legendSpacer, legendValues);
  featureContainer.append(legend);
  for (const name of predSummaryFeatureNames) {
    const row = document.createElement("div");
    row.className = "pred-summary-settings__feature-row multi-filter__option feature-filter__option";
    const title = document.createElement("span");
    title.className = "feature-filter__name";
    title.textContent = name;
    row.append(title);
    if (name === FEATURE_NONE) {
      row.classList.add("pred-summary-settings__feature-row--none");
      const rangeGroup = document.createElement("div");
      rangeGroup.className = "pred-summary-settings__feature-range pred-summary-settings__feature-range--none";
      rangeGroup.dataset.predFeatureNoneGroup = "true";
      rangeGroup.dataset.featureName = name;
      rangeGroup.setAttribute("role", "group");
      rangeGroup.setAttribute("aria-label", "特徴なしの譜面と特徴がある譜面の表示設定");
      for (const mode of ["include", "exclude"]) {
        const button = document.createElement("button");
        const labelText = mode === "include" ? "特徴なしの譜面を含む" : "特徴がある譜面を含む";
        button.type = "button";
        button.className = "pred-summary-settings__feature-dot";
        button.dataset.featureMode = mode;
        button.setAttribute("aria-label", labelText);
        button.setAttribute("aria-pressed", "false");
        button.addEventListener("click", () => {
          const selected = rangeGroup.dataset[mode] !== "true";
          const settings = {
            include: rangeGroup.dataset.include === "true",
            exclude: rangeGroup.dataset.exclude === "true",
          };
          settings[mode] = selected;
          predSummaryUpdateNoneFeatureGroup(rangeGroup, settings);
          syncAll();
        });
        rangeGroup.append(button);
      }
      for (let slot = 2; slot < 4; slot += 1) {
        const placeholder = document.createElement("span");
        placeholder.className = "pred-summary-settings__feature-dot-placeholder";
        placeholder.setAttribute("aria-hidden", "true");
        rangeGroup.append(placeholder);
      }
      row.append(rangeGroup);
    } else {
      const rangeGroup = document.createElement("div");
      rangeGroup.className = "pred-summary-settings__feature-range";
      rangeGroup.dataset.predFeatureRangeGroup = "true";
      rangeGroup.dataset.featureName = name;
      rangeGroup.setAttribute("role", "group");
      let pointerDrag = null;
      let pendingPointerClickValue = null;
      let suppressNextClick = false;
      for (let value = 0; value < predSummaryFeatureLevels.length; value += 1) {
        const button = document.createElement("button");
        const labelText = predSummaryFeatureLevels[value];
        button.type = "button";
        button.className = "pred-summary-settings__feature-dot";
        button.dataset.rangeValue = String(value);
        button.setAttribute("aria-label", name + "：" + (value === 0 ? "含まない" : "含む（" + labelText + "）"));
        button.setAttribute("aria-pressed", "false");
        button.append(document.createElement("span"));
        rangeGroup.append(button);
      }
      rangeGroup.addEventListener("pointerdown", event => {
        const button = event.target.closest("[data-range-value]");
        if (!button || (event.pointerType === "mouse" && event.button !== 0)) return;
        const startValue = Number(button.dataset.rangeValue);
        const min = Number(rangeGroup.dataset.min);
        const max = Number(rangeGroup.dataset.max);
        const empty = min > max;
        const edge = empty || min === max
          ? "anchor"
          : startValue === min
            ? "min"
            : startValue === max
              ? "max"
              : startValue - min <= max - startValue ? "min" : "max";
        pointerDrag = { pointerId: event.pointerId, startValue, lastValue: startValue, min, max, edge, moved: false };
        pendingPointerClickValue = startValue;
        rangeGroup.classList.add("is-dragging");
        try { rangeGroup.setPointerCapture(event.pointerId); } catch { /* Pointer capture may be unavailable. */ }
      });
      rangeGroup.addEventListener("pointermove", event => {
        if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
        const value = predSummaryFindFeatureRangeValue(rangeGroup, event.clientX);
        if (value === pointerDrag.lastValue) return;
        pointerDrag.moved = true;
        pointerDrag.lastValue = value;
        let range;
        if (pointerDrag.edge === "min") {
          range = { min: Math.min(value, pointerDrag.max), max: pointerDrag.max };
        } else if (pointerDrag.edge === "max") {
          range = { min: pointerDrag.min, max: Math.max(value, pointerDrag.min) };
        } else {
          range = {
            min: Math.min(pointerDrag.startValue, value),
            max: Math.max(pointerDrag.startValue, value),
          };
        }
        predSummaryUpdateFeatureRange(rangeGroup, range);
        syncAll();
      });
      const finishPointerDrag = event => {
        if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
        if (pointerDrag.moved) {
          suppressNextClick = true;
          window.setTimeout(() => { suppressNextClick = false; }, 0);
        } else {
          pendingPointerClickValue = pointerDrag.startValue;
        }
        pointerDrag = null;
        rangeGroup.classList.remove("is-dragging");
      };
      rangeGroup.addEventListener("pointerup", finishPointerDrag);
      rangeGroup.addEventListener("pointercancel", event => {
        finishPointerDrag(event);
        pendingPointerClickValue = null;
      });
      rangeGroup.addEventListener("click", event => {
        if (suppressNextClick) {
          suppressNextClick = false;
          pendingPointerClickValue = null;
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        const button = event.target.closest("[data-range-value]");
        const value = button ? Number(button.dataset.rangeValue) : pendingPointerClickValue;
        pendingPointerClickValue = null;
        if (value === null || value === undefined) return;
        const range = predSummaryNextFeatureRange(
          { min: Number(rangeGroup.dataset.min), max: Number(rangeGroup.dataset.max) },
          value,
        );
        predSummaryUpdateFeatureRange(rangeGroup, range);
        syncAll();
      });
      row.append(rangeGroup);
    }
    featureContainer.append(row);
  }
  const rangeGroups = [...dialog.querySelectorAll("[data-pred-feature-range-group]")];
  const noneGroup = dialog.querySelector("[data-pred-feature-none-group]");
  const syncAll = () => {
    const allRanges = rangeGroups.every(group => group.dataset.min === "0" && group.dataset.max === "3");
    const noneSelected = noneGroup.dataset.include === "true" && noneGroup.dataset.exclude === "true";
    const allOff = rangeGroups.every(group => Number(group.dataset.min) > Number(group.dataset.max))
      && noneGroup.dataset.include !== "true" && noneGroup.dataset.exclude !== "true";
    allInput.checked = allRanges && noneSelected;
    allInput.indeterminate = !allInput.checked && !allOff;
  };
  allInput.addEventListener("change", () => {
    rangeGroups.forEach(group => predSummaryUpdateFeatureRange(group, allInput.checked
      ? { min: 0, max: 3 }
      : { min: 1, max: 0 }));
    predSummaryUpdateNoneFeatureGroup(noneGroup, { include: allInput.checked, exclude: allInput.checked });
    syncAll();
  });
  const fill = (settings) => {
    dialog.querySelectorAll("input[data-pred-difficulty]").forEach(input => { input.checked = settings.difficulties.includes(input.dataset.predDifficulty); });
    rangeGroups.forEach(group => predSummaryUpdateFeatureRange(group, settings.features[group.dataset.featureName]));
    predSummaryUpdateNoneFeatureGroup(noneGroup, settings.features[FEATURE_NONE]);
    syncAll();
  };
  opener.addEventListener("click", () => {
    fill(predSummarySettings);
    dialog.querySelector("#predSummarySettingsMessage").hidden = true;
    dialog.showModal();
    opener.setAttribute("aria-expanded", "true");
  });
  dialog.addEventListener("close", () => { opener.setAttribute("aria-expanded", "false"); });
  dialog.querySelector("[data-settings-close]").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  dialog.querySelector("[data-settings-reset]").addEventListener("click", () => fill(predSummaryDefaultSettings()));
  dialog.querySelector("[data-settings-save]").addEventListener("click", () => {
    const next = predSummaryDefaultSettings();
    next.difficulties = [...dialog.querySelectorAll("input[data-pred-difficulty]:checked")].map(input => input.dataset.predDifficulty);
    rangeGroups.forEach(group => {
      next.features[group.dataset.featureName] = { min: Number(group.dataset.min), max: Number(group.dataset.max) };
    });
    next.features[FEATURE_NONE] = {
      include: noneGroup.dataset.include === "true",
      exclude: noneGroup.dataset.exclude === "true",
    };
    predSummarySettings = next;
    try {
      window.localStorage.setItem(predSummarySettingsStorageKey, JSON.stringify({ version: 2, ...next }));
    } catch {
      predSummaryRender();
      const message = dialog.querySelector("#predSummarySettingsMessage");
      message.textContent = "この画面には適用しましたが、ブラウザに設定を保存できませんでした。";
      message.hidden = false;
      return;
    }
    predSummaryRender();
    dialog.close();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  predSummaryInitializeSettings();
  const levelInputs = [...document.querySelectorAll('input[name="predSummaryLevel"]')];
  const lampInputs = [...document.querySelectorAll('input[name="predSummaryLamp"]')];
  try {
    const raw = window.localStorage.getItem(predSummarySelectionStorageKey);
    const selection = raw && raw.length <= 512 ? JSON.parse(raw) : null;
    if (selection?.version === 1 && Array.isArray(selection.levels)
      && selection.levels.length <= 5
      && selection.levels.every(level => [8, 9, 10, 11, 12].includes(level))
      && ["easy", "normal", "hard"].includes(selection.lamp)) {
      levelInputs.forEach(input => { input.checked = selection.levels.includes(Number(input.value)); });
      lampInputs.forEach(input => { input.checked = input.value === selection.lamp; });
    }
  } catch { /* Keep the default selection when storage is unavailable or invalid. */ }
  const sortButton = document.getElementById("predSummarySort");
  const updateSortButton = () => {
    if (!sortButton) return;
    const descending = predSummarySortDirection === "desc";
    sortButton.textContent = descending ? "Pred 降順↓" : "Pred 昇順↑";
    sortButton.setAttribute("aria-pressed", String(descending));
    sortButton.setAttribute("aria-label", descending ? "Predの並び順を昇順に切り替える" : "Predの並び順を降順に切り替える");
  };
  updateSortButton();
  sortButton?.addEventListener("click", () => {
    predSummarySortDirection = predSummarySortDirection === "asc" ? "desc" : "asc";
    try {
      window.localStorage.setItem(predSummarySortStorageKey, predSummarySortDirection);
    } catch { /* Keep the selected order for this page even if saving fails. */ }
    updateSortButton();
    predSummaryRender();
  });
  [...levelInputs, ...lampInputs].forEach(input => {
    input.addEventListener("change", () => {
      try {
        window.localStorage.setItem(predSummarySelectionStorageKey, JSON.stringify({
          version: 1,
          levels: levelInputs.filter(input => input.checked).map(input => Number(input.value)),
          lamp: lampInputs.find(input => input.checked)?.value ?? "normal",
        }));
      } catch { /* Filtering still works when saving is unavailable. */ }
      predSummaryRender();
    });
  });
  predSummaryRender();
  const tabs = [...document.querySelectorAll(".pred-tab[role='tab']")];
  const activate = (selected) => {
    for (const tab of tabs) {
      const active = tab === selected;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      tab.classList.toggle("is-active", active);
      const panel = document.getElementById(tab.getAttribute("aria-controls"));
      if (panel) panel.hidden = !active;
    }
    if (selected.id === "predDetailTab") {
      requestAnimationFrame(() => {
        if (typeof updateTableOverflowState === "function") updateTableOverflowState();
      });
    }
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => activate(tab));
    tab.addEventListener("keydown", (event) => {
      let next;
      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = tabs.length - 1;
      else return;
      event.preventDefault();
      activate(tabs[next]);
      tabs[next].focus();
    });
  });
});
