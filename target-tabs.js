"use strict";

function targetSetupRecommendationTabs() {
  const highlights = document.querySelector("#targetContent .target-highlights");
  const autoPanel = document.getElementById("targetAutoPanel");
  const manualPanel = document.getElementById("targetManualPanel");
  if (!highlights || !autoPanel || !manualPanel || document.getElementById("targetAutoTab")) {
    return;
  }

  const switcher = document.createElement("div");
  switcher.className = "target-mode-switch";
  switcher.setAttribute("role", "tablist");
  switcher.setAttribute("aria-label", "これを狙えの表示切り替え");
  switcher.innerHTML = [
    '<button id="targetAutoTab" class="target-mode-switch__button is-active" type="button" role="tab" aria-selected="true" aria-controls="targetAutoPanel">自動リコメンド</button>',
    '<button id="targetManualTab" class="target-mode-switch__button" type="button" role="tab" aria-selected="false" aria-controls="targetManualPanel">手動メモ</button>',
  ].join("");
  highlights.parentNode.insertBefore(switcher, highlights);

  autoPanel.classList.add("target-mode-panel");
  manualPanel.classList.add("target-mode-panel");
  autoPanel.setAttribute("role", "tabpanel");
  autoPanel.setAttribute("aria-labelledby", "targetAutoTab");
  manualPanel.setAttribute("role", "tabpanel");
  manualPanel.setAttribute("aria-labelledby", "targetManualTab");

  const autoTab = switcher.querySelector("#targetAutoTab");
  const manualTab = switcher.querySelector("#targetManualTab");

  const setActiveTab = (mode) => {
    const isManual = mode === "manual";
    autoTab.classList.toggle("is-active", !isManual);
    manualTab.classList.toggle("is-active", isManual);
    autoTab.setAttribute("aria-selected", String(!isManual));
    manualTab.setAttribute("aria-selected", String(isManual));
    autoPanel.hidden = isManual;
    manualPanel.hidden = !isManual;
  };

  autoTab.addEventListener("click", () => setActiveTab("auto"));
  manualTab.addEventListener("click", () => setActiveTab("manual"));
  setActiveTab("auto");
}

document.addEventListener("DOMContentLoaded", targetSetupRecommendationTabs);
