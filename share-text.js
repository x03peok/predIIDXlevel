"use strict";

(() => {
  window.cpiShareText = Object.freeze({
    formatTitle(title) {
      return String(title ?? "")
        .replace(/\b(BLACK)\.\s*(by)\b/gi, "$1. $2")
        .replace(/\b(D\.C\.)\s*(fish)\b/gi, "$1 $2");
    },
  });
})();
