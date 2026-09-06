(function initializeDanilabo() {
  "use strict";

  const rows = Array.isArray(window.__DANILABO_ROWS__)
    ? window.__DANILABO_ROWS__
    : [];
  const versionSelect = document.getElementById("danilaboVersion");
  const tables = document.getElementById("danilaboTables");
  const summary = document.getElementById("danilaboSummary");

  if (!versionSelect || !tables || !summary) {
    return;
  }

  const classOrder = ["四段", "五段", "六段", "七段", "八段", "九段", "十段", "中伝", "皆伝"];
  const difficultyClasses = {
    NORMAL: "difficulty--normal",
    HYPER: "difficulty--hyper",
    ANOTHER: "difficulty--another",
    LEGGENDARIA: "difficulty--leggendaria",
  };

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

  function renderRankTable(rank, rankRows, rankIndex) {
    const rowsHtml = rankRows.map((row) => {
      const difficulty = String(row.difficulty ?? "").trim().toUpperCase();
      const difficultyClass = difficultyClasses[difficulty] ?? "";
      const chartId = String(row.chart_id ?? "").trim();
      const title = escapeHtml(row.title);
      const titleHtml = chartId
        ? "<a class=\"danilabo-title-link\" href=\"" + chartPageHref(chartId) + "\">" + title + "</a>"
        : title;
      const chartIdHtml = chartId
        ? "<a class=\"danilabo-chart-id-link\" href=\"" + chartPageHref(chartId) + "\">" + escapeHtml(chartId) + "</a>"
        : "";

      return [
        "<tr>",
        "<td>" + escapeHtml(row.stage) + "</td>",
        "<td>" + titleHtml + "</td>",
        "<td><span class=\"danilabo-difficulty " + difficultyClass + "\">" + escapeHtml(difficulty) + "</span></td>",
        "<td class=\"mono\">" + escapeHtml(row.level) + "</td>",
        "<td class=\"mono\">" + chartIdHtml + "</td>",
        "</tr>",
      ].join("");
    }).join("");

    return [
      "<section class=\"danilabo-rank\" aria-labelledby=\"danilabo-rank-" + rankIndex + "\">",
      "<h2 id=\"danilabo-rank-" + rankIndex + "\" class=\"danilabo-rank__title\">" + escapeHtml(rank) + "</h2>",
      "<div class=\"table-shell danilabo-table-shell\">",
      "<table class=\"chart-table danilabo-table\">",
      "<colgroup>",
      "<col class=\"danilabo-col-stage\">",
      "<col class=\"danilabo-col-title\">",
      "<col class=\"danilabo-col-difficulty\">",
      "<col class=\"danilabo-col-level\">",
      "<col class=\"danilabo-col-chart-id\">",
      "</colgroup>",
      "<thead><tr><th scope=\"col\">Stage</th><th scope=\"col\">Title</th><th scope=\"col\">Difficulty</th><th scope=\"col\">Level</th><th scope=\"col\">chart_id</th></tr></thead>",
      "<tbody>" + rowsHtml + "</tbody>",
      "</table>",
      "</div>",
      "</section>",
    ].join("");
  }

  function render() {
    const selectedVersion = versionSelect.value;
    const visibleRows = rows.filter((row) => row.version === selectedVersion);
    const sections = classOrder.map((rank, rankIndex) => {
      const rankRows = visibleRows.filter((row) => row.class === rank);
      return rankRows.length > 0 ? renderRankTable(rank, rankRows, rankIndex) : "";
    }).join("");

    summary.textContent = visibleRows.length.toLocaleString() + "譜面";
    tables.innerHTML = sections;
  }

  versionSelect.addEventListener("change", () => {
    render();
    window.cpiAnalytics?.track("danilabo_version_change", {
      version: versionSelect.value,
    });
  });

  render();
})();
