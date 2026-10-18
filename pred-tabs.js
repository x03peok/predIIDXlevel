"use strict";

const predSummarySortStorageKey = "cpi-next-pred-summary-sort-direction";
const predSummarySelectionStorageKey = "cpi-next-pred-summary-selection-v1";
const predSummarySettingsStorageKey = "cpi-next-pred-summary-settings-v1";
const predSummaryFeatureNames = ["同時押し", "単鍵ラッシュ", "物量", "連打", "連皿", "皿複合", "チャージノート", "BPM変化", "ラスト難", "特徴なし"];
const predSummaryDifficulties = ["N", "H", "A", "L"];

function predSummaryDefaultSettings() {
  return {
    difficulties: [...predSummaryDifficulties],
    features: Object.fromEntries(predSummaryFeatureNames.map(name => [name, { include: true, exclude: true }])),
  };
}

function predSummaryReadSettings() {
  const defaults = predSummaryDefaultSettings();
  try {
    const raw = window.localStorage.getItem(predSummarySettingsStorageKey);
    const saved = raw && raw.length <= 8000 ? JSON.parse(raw) : null;
    if (saved?.version !== 1 || !Array.isArray(saved.difficulties)
      || saved.difficulties.length > 4 || saved.difficulties.some(value => !predSummaryDifficulties.includes(value))) return defaults;
    defaults.difficulties = [...new Set(saved.difficulties)];
    for (const name of predSummaryFeatureNames) {
      for (const mode of ["include", "exclude"]) {
        if (typeof saved.features?.[name]?.[mode] === "boolean") defaults.features[name][mode] = saved.features[name][mode];
      }
    }
  } catch { /* Invalid or unavailable storage uses unrestricted filters. */ }
  return defaults;
}

let predSummarySettings = predSummaryReadSettings();

function predSummaryMatchesSettings(row) {
  const difficulty = difficultyLabels[normalizeDifficulty(row.difficulty)];
  if (!predSummarySettings.difficulties.includes(difficulty)) return false;
  const features = new Set(getRowFeatures(row));
  return predSummaryFeatureNames.every(name => (
    predSummarySettings.features[name][features.has(name) ? "include" : "exclude"]
  ));
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
  for (const name of predSummaryFeatureNames) {
    const row = document.createElement("div");
    row.className = "pred-summary-settings__feature-row multi-filter__option feature-filter__option";
    const title = document.createElement("span");
    title.className = "feature-filter__name";
    title.textContent = name;
    row.append(title);
    for (const [mode, text] of [["include", "含む"], ["exclude", "含まない"]]) {
      const label = document.createElement("label");
      label.className = "feature-filter__mode";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.dataset.predFeature = name;
      input.dataset.featureMode = mode;
      input.setAttribute("aria-label", name + "を" + text);
      label.append(input, document.createTextNode(text));
      row.append(label);
    }
    featureContainer.append(row);
  }
  const featureInputs = [...dialog.querySelectorAll("input[data-pred-feature]")];
  const syncAll = () => {
    const selected = featureInputs.filter(input => input.checked).length;
    allInput.checked = selected === featureInputs.length;
    allInput.indeterminate = selected > 0 && selected < featureInputs.length;
  };
  allInput.addEventListener("change", () => {
    featureInputs.forEach(input => { input.checked = allInput.checked; });
    syncAll();
  });
  featureInputs.forEach(input => input.addEventListener("change", syncAll));
  const fill = (settings) => {
    dialog.querySelectorAll("input[data-pred-difficulty]").forEach(input => { input.checked = settings.difficulties.includes(input.dataset.predDifficulty); });
    dialog.querySelectorAll("input[data-pred-feature]").forEach(input => { input.checked = settings.features[input.dataset.predFeature][input.dataset.featureMode]; });
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
    dialog.querySelectorAll("input[data-pred-feature]").forEach(input => { next.features[input.dataset.predFeature][input.dataset.featureMode] = input.checked; });
    predSummarySettings = next;
    try {
      window.localStorage.setItem(predSummarySettingsStorageKey, JSON.stringify({ version: 1, ...next }));
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
