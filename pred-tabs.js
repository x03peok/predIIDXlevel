"use strict";

const predSummarySortStorageKey = "cpi-next-pred-summary-sort-direction";
const predSummarySelectionStorageKey = "cpi-next-pred-summary-selection-v1";
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
  const groups = predSummaryBuildGroups(state.rows, levels, mode, predSummarySortDirection);
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

document.addEventListener("DOMContentLoaded", () => {
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
