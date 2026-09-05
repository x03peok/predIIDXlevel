(function initializeCpiAnalytics() {
  "use strict";

  const measurementId = "G-M0BX4638PS";
  const dataLayer = window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag() {
    dataLayer.push(arguments);
  };

  window.gtag("js", new Date());
  window.gtag("config", measurementId, { send_page_view: false });

  if (!document.querySelector("script[data-cpi-google-tag]")) {
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://www.googletagmanager.com/gtag/js?id=" + measurementId;
    script.dataset.cpiGoogleTag = "true";
    document.head.append(script);
  }

  function getPageType() {
    return document.body?.dataset.page || "unknown";
  }

  function track(name, params = {}) {
    if (!name || typeof window.gtag !== "function") {
      return;
    }

    const cleanParams = { page_type: getPageType() };
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === "") {
        continue;
      }
      cleanParams[key] = typeof value === "string" && value.length > 100
        ? value.slice(0, 100)
        : value;
    }
    window.gtag("event", name, cleanParams);
  }

  function getChartIdFromLink(link) {
    const href = String(link.getAttribute("href") || "");
    const match = href.match(/(?:^|\/)chart-pages\/([^/?#]+)\.html(?:[?#].*)?$|^([^/?#]+)\.html(?:[?#].*)?$/);
    const chartId = match?.[1] ?? match?.[2];
    return chartId ? decodeURIComponent(chartId) : undefined;
  }

  function getFilterName(element) {
    const id = element.closest("details")?.id || element.id || "";
    return id
      .replace(/^(mypage|record)/i, "")
      .replace(/Filter(?:Details|Options|Summary)?$/i, "")
      .replace(/^([A-Z])/, (match) => match.toLowerCase())
      || "unknown";
  }

  function getDiagnosisQuestion(element) {
    const questionIndex = element.dataset.diagnosisQuestion
      ?? element.dataset.diagnosisFeatureQuestion;
    return questionIndex === undefined ? undefined : Number(questionIndex) + 1;
  }

  window.cpiAnalytics = { track };

  document.addEventListener("DOMContentLoaded", () => {
    window.setTimeout(() => {
      track("page_view", {
        page_title: document.title,
        page_location: window.location.href,
        page_path: window.location.pathname,
      });
    }, 0);
  }, { once: true });

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element
      ? event.target.closest("a, button")
      : null;
    if (!target) {
      return;
    }

    if (target.matches(".menu-button")) {
      track("menu_toggle", {
        open: target.getAttribute("aria-expanded") === "true",
      });
      return;
    }

    if (target.matches(".menu-item")) {
      track("menu_navigation", { destination: target.dataset.page });
      return;
    }

    if (target.matches(".chart-link, .record-title-link")) {
      track("chart_open", {
        chart_id: getChartIdFromLink(target),
        link_location: getPageType(),
      });
      return;
    }

    if (target.matches(".home-link, .home-intro__availability a")) {
      track("home_cta_click", {
        destination: target.dataset.homeDestination,
        link_type: target.dataset.homeLinkType || "card",
      });
      return;
    }
    if (target.matches(".chart-share-button, .diagnosis-share__button, .mypage-share__button")) {
      track("share_click", { share_type: "x" });
      return;
    }

    if (target.matches(".textage-button")) {
      track("textage_open", { side: target.dataset.textageSide });
      return;
    }

    if (target.matches(".chart-back-link")) {
      track("back_to_table");
      return;
    }

    if (target.matches("thead button[data-sort-key]")) {
      track("sort_change", {
        sort_key: target.dataset.sortKey,
        page: getPageType(),
      });
      return;
    }

    const buttonEvents = {
      loadMoreButton: "load_more",
      recordLoadMoreButton: "load_more",
      recordCsvImportButton: "record_csv_import",
      mypageLoadMoreButton: "load_more",
      scrollTopButton: "scroll_to_top",
      mypageScrollTopButton: "scroll_to_top",
      settingsExportButton: "data_export_start",
      settingsImportButton: "data_import_start",
      settingsResetButton: "data_reset_start",
      diagnosisSubmitButton: "diagnosis_batch_submit",
      diagnosisFeatureSubmitButton: "diagnosis_feature_batch_submit",
      diagnosisFeatureButton: "diagnosis_feature_start",
      diagnosisResetButton: "diagnosis_reset",
      diagnosisResultResetButton: "diagnosis_reset",
      diagnosisFeatureResetButton: "diagnosis_reset",
      diagnosisFeatureResultResetButton: "diagnosis_reset",
    };
    const eventName = buttonEvents[target.id];
    if (eventName) {
      track(eventName, { button_id: target.id });
    }
  });

  document.addEventListener("change", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) {
      return;
    }

    if (target.matches(".record-status-select, .mypage-status-select")) {
      track("status_change", {
        chart_id: target.dataset.chartId,
        status: target.value,
        source: getPageType(),
      });
      return;
    }

    if (target.matches("input[data-diagnosis-question], input[data-diagnosis-feature-question]")) {
      track("diagnosis_answer", {
        diagnosis_type: target.hasAttribute("data-diagnosis-feature-question") ? "feature" : "pred",
        question: getDiagnosisQuestion(target),
        answer: target.value,
      });
      return;
    }

    if (target.matches('input[name="aptitude"]')) {
      track("diagnosis_level_selected", { level: target.value });
      return;
    }

    if (target.matches("#mypageIncludeUnregistered, #mypageIncludeUnowned")) {
      track("status_distribution_option", {
        option: target.id,
        included: target.checked,
      });
      return;
    }


    const filterContainer = target.closest(".multi-filter, .advanced-filter");
    if (filterContainer && target.matches("input, select")) {
      track("filter_change", {
        filter_name: getFilterName(target),
        selected_value: target.type === "checkbox" ? String(target.checked) : target.value,
      });
    }

    if (target.matches("#recordCsvInput")) {
      track("record_csv_file_selected");
      return;
    }
    if (target.matches("#settingsImportInput")) {
      track("data_import_file_selected");
    }
  });

  const searchTimers = new WeakMap();
  const lastSearches = new WeakMap();
  document.addEventListener("input", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.matches('input[type="search"]')) {
      return;
    }

    const previousTimer = searchTimers.get(target);
    if (previousTimer !== undefined) {
      window.clearTimeout(previousTimer);
    }
    const timer = window.setTimeout(() => {
      const term = target.value.trim();
      if (!term || term === lastSearches.get(target)) {
        if (!term) {
          lastSearches.delete(target);
        }
        return;
      }
      track("search", { has_search_term: true, search_length: term.length });
      lastSearches.set(target, term);
    }, 600);
    searchTimers.set(target, timer);
  });
})();