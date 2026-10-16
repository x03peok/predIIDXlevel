"use strict";

(() => {
  const storeName = "chart-option-memos";
  const definitions = Object.freeze([
    Object.freeze({ value: "regular", label: "正規" }),
    Object.freeze({ value: "mirror", label: "鏡" }),
    Object.freeze({ value: "random", label: "乱" }),
    Object.freeze({ value: "r-random", label: "R乱" }),
    Object.freeze({ value: "s-random", label: "S乱" }),
  ]);
  const allowed = new Set(definitions.map(item => item.value));
  function validateRecords(records) {
    if (!Array.isArray(records) || records.length > 100000) throw new Error("オプションメモの形式が不正です。");
    const ids = new Set();
    return records.map(record => {
      const chartId = String(record?.chartId ?? "");
      const options = record?.options;
      if (!/^\d{1,32}$/.test(chartId) || ids.has(chartId) || !Array.isArray(options)
        || options.length < 1 || options.length > definitions.length || new Set(options).size !== options.length
        || options.some(option => !allowed.has(option)) || typeof record.updatedAt !== "string"
        || record.updatedAt.length > 100 || !Number.isFinite(Date.parse(record.updatedAt))) {
        throw new Error("オプションメモの形式が不正です。");
      }
      ids.add(chartId);
      return { chartId, options: definitions.map(item => item.value).filter(option => options.includes(option)), updatedAt: new Date(record.updatedAt).toISOString() };
    });
  }
  function read(database, chartId) {
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, "readonly");
      const request = transaction.objectStore(storeName).get(String(chartId));
      let options = [];
      request.onsuccess = () => {
        try { options = request.result ? validateRecords([request.result])[0].options : []; }
        catch (error) { reject(error); }
      };
      transaction.oncomplete = () => resolve(options);
      transaction.onerror = transaction.onabort = () => reject(transaction.error ?? new Error("オプションメモを読み込めませんでした。"));
    });
  }
  function toggle(database, chartId, option) {
    chartId = String(chartId);
    if (!/^\d{1,32}$/.test(chartId) || !allowed.has(option)) throw new Error("オプションメモの指定が不正です。");
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      const request = store.get(chartId);
      let options;
      request.onsuccess = () => {
        try {
          const current = new Set(request.result ? validateRecords([request.result])[0].options : []);
          if (current.has(option)) current.delete(option);
          else current.add(option);
          options = definitions.map(item => item.value).filter(value => current.has(value));
          if (options.length) store.put({ chartId, options, updatedAt: new Date().toISOString() });
          else store.delete(chartId);
        } catch (error) {
          transaction.abort();
          reject(error);
        }
      };
      transaction.oncomplete = () => resolve(options);
      transaction.onerror = transaction.onabort = () => reject(transaction.error ?? new Error("オプションメモを保存できませんでした。"));
    });
  }
  window.cpiChartOptions = Object.freeze({ definitions, storeName, validateRecords, read, toggle });
})();
