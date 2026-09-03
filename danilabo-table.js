(function initializeDanilaboTable() {
  "use strict";

  const danilaboRows = Array.isArray(window.__DANILABO_ROWS__)
    ? window.__DANILABO_ROWS__
    : [];
  const versionTabs = Array.from(document.querySelectorAll("[data-version]"));
  const tables = document.getElementById("danilaboTables");

  if (!versionTabs.length || !tables) {
    return;
  }

  const classOrder = ["四段", "五段", "六段", "七段", "八段", "九段", "十段", "中伝", "皆伝"];
  let selectedVersion = versionTabs.find((tab) => tab.getAttribute("aria-selected") === "true")?.dataset.version
    ?? versionTabs[0]?.dataset.version
    ?? "";
  const difficultyLabels = {
    NORMAL: "N",
    HYPER: "H",
    ANOTHER: "A",
    LEGGENDARIA: "L",
  };
  const difficultyClasses = {
    NORMAL: "difficulty--normal",
    HYPER: "difficulty--hyper",
    ANOTHER: "difficulty--another",
    LEGGENDARIA: "difficulty--leggendaria",
  };

  function parseCsv(text) {
    if (!text) {
      return [];
    }
    if (text.charCodeAt(0) === 0xfeff) {
      text = text.slice(1);
    }

    const rows = [];
    let row = [];
    let cell = "";
    let inQuotes = false;
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (inQuotes) {
        if (character === '"') {
          if (text[index + 1] === '"') {
            cell += '"';
            index += 1;
          } else {
            inQuotes = false;
          }
        } else {
          cell += character;
        }
        continue;
      }
      if (character === '"') {
        inQuotes = true;
      } else if (character === ",") {
        row.push(cell);
        cell = "";
      } else if (character === "\r" || character === "\n") {
        if (character === "\r" && text[index + 1] === "\n") index += 1;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += character;
      }
    }
    if (cell !== "" || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows;
  }

  function records(text) {
    const parsed = parseCsv(text);
    if (!parsed.length) {
      return [];
    }
    const headers = parsed.shift().map((header) => header.trim());
    return parsed
      .filter((row) => row.length > 1 || row[0] !== "")
      .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
  }

  const siteRows = records(window.__CSV_BUNDLE__);
  const siteById = new Map(siteRows.map((row) => [String(row.chart_id).trim(), row]));
  const sitePreds = siteRows
    .map((row) => Number(row.calibrated_pred_skill))
    .filter((value) => Number.isFinite(value));
  const predDataMin = Math.min(...sitePreds);
  const predDataMax = Math.max(...sitePreds);
  const rows = danilaboRows.map((row) => {
    const chartId = String(row.chart_id ?? "").trim();
    const siteRow = siteById.get(chartId);
    return {
      ...row,
      chart_id: chartId,
      title: siteRow?.title || row.title,
      difficulty: siteRow?.difficulty || row.difficulty,
      pred: siteRow?.calibrated_pred_skill || "",
      bpm_min: siteRow?.bpm_min || "",
      bpm_max: siteRow?.bpm_max || "",
      features: siteRow?.features || "",
    };
  });

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[character]);
  }

  function chartPageHref(chartId) {
    return "chart-pages/" + encodeURIComponent(String(chartId).trim()) + ".html";
  }

  function formatPred(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? (Math.round(numeric * 10) / 10).toFixed(1) : "";
  }

  function getNumericScaleColor(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || !Number.isFinite(predDataMin) || !Number.isFinite(predDataMax)) {
      return "";
    }
    const position = predDataMax > predDataMin
      ? Math.min(1, Math.max(0, (numeric - predDataMin) / (predDataMax - predDataMin)))
      : 0.5;
    const yellowPosition = predDataMax > predDataMin
      ? Math.min(0.45, Math.max(0.1, (9 - predDataMin) / (predDataMax - predDataMin)))
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
    return hslToRgbString(hue, saturation, lightness);
  }

  function hslToRgbString(hue, saturation, lightness) {
    const normalizedHue = ((hue % 360) + 360) % 360;
    const saturationRatio = saturation / 100;
    const lightnessRatio = lightness / 100;
    const chroma = (1 - Math.abs(2 * lightnessRatio - 1)) * saturationRatio;
    const sector = normalizedHue / 60;
    const x = chroma * (1 - Math.abs((sector % 2) - 1));
    const rgb = sector < 1 ? [chroma, x, 0]
      : sector < 2 ? [x, chroma, 0]
        : sector < 3 ? [0, chroma, x]
          : sector < 4 ? [0, x, chroma]
            : sector < 5 ? [x, 0, chroma]
              : [chroma, 0, x];
    const match = lightnessRatio - chroma / 2;
    return "rgb(" + rgb.map((channel) => Math.round((channel + match) * 255)).join(", ") + ")";
  }

  function numericStyle(value) {
    const color = getNumericScaleColor(value);
    return color ? " style=\"--numeric-color:" + color + "\"" : "";
  }

  function formatBpmCell(minValue, maxValue) {
    const minText = String(minValue ?? "").trim();
    const maxText = String(maxValue ?? "").trim();
    const min = Number(minText);
    const max = Number(maxText);
    if (!minText && !maxText) {
      return "";
    }
    if (!Number.isFinite(min) && Number.isFinite(max)) {
      return escapeHtml(maxText);
    }
    if (!Number.isFinite(max) || min === max) {
      return escapeHtml(minText);
    }
    return [
      "<span class=\"bpm-range\">",
      "<span class=\"bpm-range__min\">" + escapeHtml(minText) + "~</span>",
      "<span class=\"bpm-range__max\">" + escapeHtml(maxText) + "</span>",
      "</span>",
    ].join("");
  }

  function renderFeatureChips(value) {
    const features = String(value ?? "")
      .split("、")
      .map((feature) => feature.trim())
      .filter(Boolean);
    if (features.length === 0) {
      return "";
    }
    return "<div class=\"feature-chips\">" + features.map((feature) => {
      const plusCount = (feature.match(/\+/g) ?? []).length;
      const colorLevel = Math.min(3, plusCount);
      return "<span class=\"feature-chip feature-chip--plus-" + colorLevel + "\">"
        + escapeHtml(feature) + "</span>";
    }).join("") + "</div>";
  }

  function renderRankTable(rank, rankRows, rankIndex) {
    const cardsHtml = rankRows.map((row) => {
      const difficulty = String(row.difficulty ?? "").trim().toUpperCase();
      const difficultyClass = difficultyClasses[difficulty] ?? "";
      const difficultyLabel = difficultyLabels[difficulty] ?? difficulty;
      const chartId = String(row.chart_id ?? "").trim();
      const titleContent = "<span class=\"chart-title-cell__name\">" + escapeHtml(row.title) + "</span>"
        + (difficultyLabel ? " <span class=\"chart-title-cell__difficulty\">["
          + escapeHtml(difficultyLabel) + "]</span>" : "");
      const titleHtml = chartId
        ? "<a class=\"chart-link " + difficultyClass + "\" href=\"" + chartPageHref(chartId) + "\">"
          + titleContent + "</a>"
        : "<span class=\"chart-link " + difficultyClass + "\">" + titleContent + "</span>";
      const rawPredText = String(row.pred ?? "").trim();
      const formattedPredText = rawPredText ? formatPred(row.pred) : "";
      const predText = formattedPredText || "－";
      const predStyle = formattedPredText ? numericStyle(row.pred) : "";
      const predHtml = "<span class=\"danilabo-stage-card__pred\">Pred <span class=\"mono numeric-value numeric-value--pred\""
        + predStyle + ">" + escapeHtml(predText) + "</span></span>";

      return [
        "<article class=\"danilabo-stage-card\">",
        "<div class=\"danilabo-stage-card__stage\">" + escapeHtml(row.stage) + " Stage</div>",
        "<div class=\"danilabo-stage-card__content\">",
        "<div class=\"chart-title-cell danilabo-stage-card__title\">" + titleHtml + "</div>",
        "<div class=\"danilabo-stage-card__metrics\">",
        "<span class=\"mono numeric-value numeric-value--level\"" + numericStyle(row.level) + ">☆"
          + escapeHtml(row.level) + "</span>",
        predHtml,
        "</div>",
        "<div class=\"danilabo-stage-card__feature\">" + renderFeatureChips(row.features) + "</div>",
        "</div>",
        "</article>",
      ].join("");
    }).join("");

    const predValues = rankRows
      .map((row) => String(row.pred ?? "").trim())
      .filter(Boolean)
      .map(Number)
      .filter((value) => Number.isFinite(value));
    const averagePred = predValues.length > 0
      ? predValues.reduce((sum, value) => sum + value, 0) / predValues.length
      : null;
    const averagePredHtml = averagePred === null
      ? ""
      : " <span class=\"danilabo-rank__average\"><span class=\"danilabo-rank__average-label\">平均Pred</span> <span class=\"numeric-value numeric-value--pred\"" + numericStyle(averagePred) + ">" + averagePred.toFixed(2) + "</span></span>";

    return [
      "<section class=\"danilabo-rank\" aria-labelledby=\"danilabo-rank-" + rankIndex + "\">",
      "<h2 id=\"danilabo-rank-" + rankIndex + "\" class=\"danilabo-rank__title\" data-rank=\"" + escapeHtml(rank) + "\"><span class=\"danilabo-rank__name\">" + escapeHtml(rank) + "</span>" + averagePredHtml + "</h2>",
      "<div class=\"danilabo-stage-list\">" + cardsHtml + "</div>",
      "</section>",
    ].join("");
  }

  function updateOverflowState() {
    tables.querySelectorAll(".danilabo-table-shell").forEach((shell) => {
      shell.classList.toggle("is-overflowing", shell.scrollWidth > shell.clientWidth);
    });
  }

  function render() {
    const visibleRows = rows.filter((row) => row.version === selectedVersion);
    const sections = classOrder.map((rank, rankIndex) => {
      const rankRows = visibleRows.filter((row) => row.class === rank);
      return rankRows.length > 0 ? renderRankTable(rank, rankRows, rankIndex) : "";
    }).join("");

    tables.innerHTML = sections;
    updateOverflowState();
  }

  function setActiveVersion(version, track = false) {
    selectedVersion = version;
    versionTabs.forEach((tab) => {
      const isActive = tab.dataset.version === version;
      tab.classList.toggle("is-active", isActive);
      tab.setAttribute("aria-selected", String(isActive));
      tab.tabIndex = isActive ? 0 : -1;
    });
    render();
    if (track) {
      window.cpiAnalytics?.track("danilabo_version_change", {
        version: selectedVersion,
      });
    }
  }

  versionTabs.forEach((tab) => {
    tab.addEventListener("click", () => setActiveVersion(tab.dataset.version, true));
    tab.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const currentIndex = versionTabs.indexOf(tab);
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const nextIndex = (currentIndex + direction + versionTabs.length) % versionTabs.length;
      const nextTab = versionTabs[nextIndex];
      nextTab.focus();
      setActiveVersion(nextTab.dataset.version, true);
    });
  });

  setActiveVersion(selectedVersion);
})();
