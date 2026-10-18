"use strict";

(() => {
  const elements = () => ({
    loading: document.getElementById("pageLoading"),
    text: document.getElementById("pageLoadingText"),
    retry: document.getElementById("pageLoadingRetry"),
    content: document.getElementById("personalPageContent"),
  });
  window.cpiPageLoading = Object.freeze({
    ready() {
      const { loading, content } = elements();
      if (content) {
        content.hidden = false;
        content.inert = false;
        content.setAttribute("aria-busy", "false");
      }
      if (loading) loading.hidden = true;
    },
    fail(message) {
      const { loading, text, retry, content } = elements();
      if (content) {
        content.hidden = true;
        content.inert = true;
        content.setAttribute("aria-busy", "false");
      }
      if (loading) {
        loading.hidden = false;
        loading.dataset.state = "error";
      }
      if (text) text.textContent = message || "データを読み込めませんでした。再試行してください。";
      if (retry) retry.hidden = false;
    },
  });
  document.addEventListener("DOMContentLoaded", () => {
    elements().retry?.addEventListener("click", () => window.location.reload());
  }, { once: true });
})();
