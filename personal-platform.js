"use strict";

(() => {
  const key = "cpi-next-record-platform";
  const url = new URL(window.location.href);
  const explicit = url.searchParams.get("platform");
  let saved;
  try { saved = window.localStorage.getItem(key); } catch { /* Optional persistence. */ }
  const platform = explicit === "ac" || explicit === "inf" ? explicit : saved === "inf" ? "inf" : "ac";
  const suffix = platform === "inf" ? "-inf" : "";
  const label = platform === "inf" ? "INFINITAS" : "AC";
  const next = platform === "inf" ? "ac" : "inf";
  const nextLabel = next === "inf" ? "INFINITAS" : "AC";
  const href = (path) => {
    const target = new URL(path, window.location.href);
    target.searchParams.set("platform", platform);
    return target.href;
  };
  const excludedChartIds = new Set();
  function includesChart(value) {
    const platforms = String(value ?? "").trim().toLowerCase();
    return !platforms || platforms.split("|").includes(platform);
  }
  window.cpiPersonalPlatform = Object.freeze({
    platform,
    event: name => name + suffix,
    key: name => name + suffix,
    href,
    chartHref: path => path + (platform === "inf" ? "?platform=inf" : ""),
    includesChart,
    filterCharts(rows) {
      return rows.filter(row => {
        if (includesChart(row.platforms)) return true;
        excludedChartIds.add(String(row.chart_id).trim());
        return false;
      });
    },
    filterRecords(records) {
      return records.filter(record => !excludedChartIds.has(String(record?.chartId ?? record?.chart_id ?? "").trim()));
    },
  });
  document.body.dataset.platform = platform;
  const badge = document.getElementById("personalPlatformBadge");
  badge.textContent = label;
  badge.setAttribute("aria-label", "現在の版：" + label + "。" + nextLabel + "に切り替える");
  badge.disabled = false;
  window.addEventListener("pageshow", () => { badge.disabled = false; });
  badge.addEventListener("click", () => {
    badge.disabled = true;
    try { window.localStorage.setItem(key, next); } catch { /* The URL carries the selected platform. */ }
    const destination = new URL(window.location.href);
    destination.searchParams.set("platform", next);
    window.location.assign(destination.href);
  });
  document.addEventListener("DOMContentLoaded", () => {
    for (const item of document.querySelectorAll('#siteMenu :is([data-page="record"], [data-page="mypage"], [data-page="target"], [data-page="settings"])')) {
      item.dataset.href = href(item.dataset.href);
    }
    for (const link of document.querySelectorAll("[data-personal-platform-link]")) link.href = href(link.getAttribute("href"));
  });
})();
