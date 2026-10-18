"use strict";

(() => {
  const key = "cpi-next-auto-recommendation-selection-v1";
  window.cpiRecommendationCache = Object.freeze({
    key,
    read(settings) {
      try {
        const raw = window.localStorage.getItem(key);
        if (!raw || raw.length > 10000) return null;
        const cache = JSON.parse(raw);
        if (cache.version !== 1 || cache.settings !== JSON.stringify(settings)
          || !Array.isArray(cache.items) || cache.items.length > 20
          || !Number.isSafeInteger(cache.candidateCount) || cache.candidateCount < 0) return null;
        const seen = new Set();
        for (const item of cache.items) {
          const id = item?.chartId;
          const identity = id + ":" + item?.goal;
          if (typeof id !== "string" || !/^\d{1,32}$/.test(id)
            || !["easy", "clear", "hard"].includes(item.goal) || seen.has(identity)) return null;
          seen.add(identity);
        }
        return cache;
      } catch { return null; }
    },
    write(settings, items, candidateCount) {
      try {
        window.localStorage.setItem(key, JSON.stringify({
          version: 1, settings: JSON.stringify(settings), items, candidateCount,
        }));
      } catch { /* The current page still retains its selection when storage is unavailable. */ }
    },
    invalidate() {
      try { window.localStorage.removeItem(key); } catch { /* Storage may be unavailable. */ }
    },
  });
})();
