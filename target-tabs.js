"use strict";

function targetSetupRecommendationTabs() {
  const highlights = document.querySelector("#targetContent .target-highlights");
  const autoPanel = document.getElementById("targetAutoPanel");
  const manualPanel = document.getElementById("targetManualPanel");
  const dailyPanel = document.getElementById("targetDailyPanel");
  if (!highlights || !autoPanel || !manualPanel || !dailyPanel || document.getElementById("targetAutoTab")) return;

  const switcher = document.createElement("div");
  switcher.className = "target-mode-switch";
  switcher.setAttribute("role", "tablist");
  switcher.setAttribute("aria-label", "マイターゲットの表示切り替え");
  switcher.innerHTML = [
    '<button id="targetAutoTab" class="target-mode-switch__button is-active" type="button" role="tab" aria-selected="true" aria-controls="targetAutoPanel">自動リコメンド</button>',
    '<button id="targetManualTab" class="target-mode-switch__button" type="button" role="tab" aria-selected="false" aria-controls="targetManualPanel">手動メモ</button>',
    '<button id="targetDailyTab" class="target-mode-switch__button" type="button" role="tab" aria-selected="false" aria-controls="targetDailyPanel">今日の10曲</button>',
  ].join("");
  highlights.parentNode.insertBefore(switcher, highlights);

  [autoPanel, manualPanel, dailyPanel].forEach((panel) => {
    panel.classList.add("target-mode-panel");
    panel.setAttribute("role", "tabpanel");
  });
  autoPanel.setAttribute("aria-labelledby", "targetAutoTab");
  manualPanel.setAttribute("aria-labelledby", "targetManualTab");
  dailyPanel.setAttribute("aria-labelledby", "targetDailyTab");

  const autoTab = switcher.querySelector("#targetAutoTab");
  const manualTab = switcher.querySelector("#targetManualTab");
  const dailyTab = switcher.querySelector("#targetDailyTab");

  const setActiveTab = (mode, updateHash = false) => {
    const isManual = mode === "manual";
    const isDaily = mode === "daily";
    autoTab.classList.toggle("is-active", !isManual && !isDaily);
    manualTab.classList.toggle("is-active", isManual);
    dailyTab.classList.toggle("is-active", isDaily);
    autoTab.setAttribute("aria-selected", String(!isManual && !isDaily));
    manualTab.setAttribute("aria-selected", String(isManual));
    dailyTab.setAttribute("aria-selected", String(isDaily));
    autoPanel.hidden = isManual || isDaily;
    manualPanel.hidden = !isManual;
    dailyPanel.hidden = !isDaily;
    if (updateHash) {
      const nextHash = isDaily ? "#daily" : "";
      window.history.replaceState(null, "", window.location.pathname + window.location.search + nextHash);
      window.dispatchEvent(new Event("cpi:target-mode-changed"));
    }
    if (isDaily) window.dispatchEvent(new Event("cpi:daily-target-visible"));
  };

  const setActiveFromHash = () => setActiveTab(window.location.hash === "#daily" ? "daily" : "auto");
  autoTab.addEventListener("click", () => setActiveTab("auto", true));
  manualTab.addEventListener("click", () => setActiveTab("manual", true));
  dailyTab.addEventListener("click", () => setActiveTab("daily", true));
  window.addEventListener("hashchange", setActiveFromHash);
  setActiveFromHash();
}

document.addEventListener("DOMContentLoaded", targetSetupRecommendationTabs);